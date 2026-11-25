// Fetch Taskmarket public API data on the server (or in CI) and write data.json.
// No key, no wallet, no signing. Read-only GET requests only.
// Run: node scripts/fetch.mjs  (Node 18+, no dependencies, global fetch)
// Output: data.json next to the site root.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.taskmarket.dev";
const CHAINS = [
  { chainId: 4217, name: "Tempo", token: "OUSD" },
  { chainId: 8453, name: "Base", token: "USDC" },
];
const MAX_TASKS = 2000;
const PAGE = 100;
const DECIMALS = 1_000_000; // stablecoin raw units, 6 decimals (see methods note)

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "data.json");

async function getJson(path, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(API + path, {
        signal: ctrl.signal,
        headers: { Accept: "application/json", "User-Agent": "taskmarket-live-dashboard/1.0" },
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      clearTimeout(t);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

function weekStart(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function shortTitle(desc) {
  const first = String(desc || "").split("\n")[0].trim();
  return first.slice(0, 140);
}

async function fetchTasks(chainId) {
  const tasks = [];
  let cursor = null;
  while (tasks.length < MAX_TASKS) {
    const q = `/api/tasks?chainId=${chainId}&sort=newest&limit=${PAGE}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const page = await getJson(q);
    if (!page || !Array.isArray(page.tasks) || page.tasks.length === 0) break;
    for (const t of page.tasks) {
      tasks.push({
        id: t.id,
        referenceCode: t.referenceCode || null,
        requester: t.requester || null,
        requesterDisplayName: t.requesterDisplayName || null,
        createdAt: t.createdAt,
        expiryTime: t.expiryTime || null,
        status: t.status,
        mode: t.mode,
        reward: String(t.reward ?? "0"),
        submissionCount: t.submissionCount ?? 0,
        awardCount: t.awardCount ?? 0,
        title: shortTitle(t.description),
      });
    }
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
    if (page.tasks.length < PAGE) break;
  }
  return tasks;
}

function postersWeekly(tasks) {
  // weekStart -> Set of requester addresses
  const byWeek = new Map();
  const taskCount = new Map();
  for (const t of tasks) {
    if (!t.requester || !t.createdAt) continue;
    const w = weekStart(t.createdAt);
    if (!byWeek.has(w)) byWeek.set(w, new Set());
    byWeek.get(w).add(t.requester.toLowerCase());
    taskCount.set(w, (taskCount.get(w) || 0) + 1);
  }
  const weeks = [...byWeek.keys()].sort();
  return {
    weeks: weeks.map((w) => ({
      weekStart: w,
      distinctPosters: byWeek.get(w).size,
      tasks: taskCount.get(w) || 0,
    })),
    // Full poster lists per week, so the counts can be reproduced from data.json.
    postersByWeek: Object.fromEntries(weeks.map((w) => [w, [...byWeek.get(w)].sort()])),
  };
}

function concentration(tasks, totalFromBreakdowns) {
  const counts = new Map();
  for (const t of tasks) {
    if (!t.requester) continue;
    const k = t.requester.toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const fetched = tasks.length;
  const top1 = top[0] ? top[0][1] / fetched : 0;
  const top5 = top.slice(0, 5).reduce((s, [, c]) => s + c, 0) / (fetched || 1);
  return {
    fetchedTasks: fetched,
    platformTotalFromBreakdowns: totalFromBreakdowns,
    distinctPostersInSample: counts.size,
    topPosters: top.map(([requester, count]) => ({ requester, tasks: count, share: count / (fetched || 1) })),
    top1Share: top1,
    top5Share: top5,
  };
}

function sumSeries(series, field) {
  return series.reduce((s, b) => s + Number(b[field] || 0), 0);
}

async function fetchChain(chain) {
  const { chainId } = chain;
  const [stats, breakdowns, ts7, ts30, ts90, tsAll, heatMode, heatHour, feed] = await Promise.all([
    getJson(`/api/market/stats?chainId=${chainId}`),
    getJson(`/api/stats/breakdowns?chainId=${chainId}`),
    getJson(`/api/stats/platform-time-series?chainId=${chainId}&range=7d&bucket=day`),
    getJson(`/api/stats/platform-time-series?chainId=${chainId}&range=30d&bucket=day`),
    getJson(`/api/stats/platform-time-series?chainId=${chainId}&range=90d&bucket=day`),
    getJson(`/api/stats/platform-time-series?chainId=${chainId}&range=all&bucket=week`),
    getJson(`/api/stats/activity-heatmap?chainId=${chainId}&range=30d&dimension=mode`),
    getJson(`/api/stats/activity-heatmap?chainId=${chainId}&range=30d&dimension=hourOfWeek`),
    getJson(`/api/stats/activity-feed?chainId=${chainId}&limit=50`),
  ]);
  const tasks = await fetchTasks(chainId);
  const totalFromBreakdowns =
    (breakdowns.status || []).reduce((s, r) => s + (r.count || 0), 0) +
    (breakdowns.mode || []).reduce((s, r) => s + 0, 0); // status sum is the task total
  const pw = postersWeekly(tasks);
  const conc = concentration(tasks, totalFromBreakdowns);

  // Flow numbers, 30 days, reproducible from the time series in this file.
  const putUp = sumSeries(ts30, "rewardVolume") / DECIMALS;
  const paid = sumSeries(ts30, "paidVolume") / DECIMALS;
  const tasksCreated30 = sumSeries(ts30, "tasksCreated");
  const completed30 = sumSeries(ts30, "completedTasks");
  const settlements30 = sumSeries(ts30, "settlements");
  const openTasks = tasks.filter((t) => t.status === "open");
  const openEscrowSample = openTasks.reduce((s, t) => s + Number(t.reward || 0), 0) / DECIMALS;
  const dead = tasks.filter((t) => (t.status === "expired" || t.status === "cancelled") && t.submissionCount === 0).length;
  const statusCounts = Object.fromEntries((breakdowns.status || []).map((r) => [r.status, r.count]));
  const deadTotal = (statusCounts.expired || 0) + (statusCounts.cancelled || 0);

  // Busiest hour-of-week cell, as returned.
  let busiest = null;
  for (const c of heatHour.cells || []) {
    if (!busiest || c.count > busiest.count) busiest = c;
  }
  const modeCounts = Object.fromEntries((breakdowns.mode || []).map((r) => [r.mode, r.count]));
  const modeTotal = Object.values(modeCounts).reduce((s, n) => s + n, 0);
  const dominantMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0] || ["", 0];

  return {
    chainId,
    name: chain.name,
    token: chain.token,
    stats,
    breakdowns,
    timeSeries: { "7d": ts7, "30d": ts30, "90d": ts90, all: tsAll },
    heatmaps: { mode30d: heatMode, hourOfWeek30d: heatHour },
    feed: { items: feed.items || [], nextCursor: feed.nextCursor || null },
    tasksSample: tasks.slice(0, 60),
    tasksFetched: tasks.length,
    postersWeekly: pw.weeks,
    postersByWeek: pw.postersByWeek,
    concentration: conc,
    flow: {
      range: "30d",
      putUp,
      paid,
      paidShareOfPutUp: putUp ? paid / putUp : 0,
      tasksCreated: tasksCreated30,
      completedTasks: completed30,
      settlements: settlements30,
      openTaskCount: statusCounts.open || 0,
      openEscrowInSample: openEscrowSample,
      openTasksInSample: openTasks.length,
      deadWithNoSubmissionsInSample: dead,
      deadTotalFromBreakdowns: deadTotal,
      totalTasksFromBreakdowns: totalFromBreakdowns,
      deadShareOfAll: totalFromBreakdowns ? deadTotal / totalFromBreakdowns : 0,
    },
    insights: {
      dominantMode: dominantMode[0],
      dominantModeShare: modeTotal ? dominantMode[1] / modeTotal : 0,
      busiestDay: busiest ? Number(busiest.row) : null,
      busiestHour: busiest ? Number(busiest.col) : null,
      busiestCount: busiest ? busiest.count : 0,
      paidShareOfPutUp30d: putUp ? paid / putUp : 0,
      completedShare30d: tasksCreated30 ? completed30 / tasksCreated30 : 0,
    },
  };
}

const fetchedAt = new Date().toISOString();
const chainData = {};
for (const chain of CHAINS) {
  chainData[String(chain.chainId)] = await fetchChain(chain);
  console.log(`chain ${chain.chainId}: ${chainData[String(chain.chainId)].tasksFetched} tasks fetched`);
}

// Combined distinct posters per week: union of addresses across both chains.
{
  const byWeek = new Map();
  const taskCount = new Map();
  for (const cid of Object.keys(chainData)) {
    for (const [w, posters] of Object.entries(chainData[cid].postersByWeek)) {
      if (!byWeek.has(w)) byWeek.set(w, new Set());
      for (const p of posters) byWeek.get(w).add(p);
    }
    for (const row of chainData[cid].postersWeekly) {
      taskCount.set(row.weekStart, (taskCount.get(row.weekStart) || 0) + row.tasks);
    }
  }
  const weeks = [...byWeek.keys()].sort();
  var combinedPosters = {
    weeks: weeks.map((w) => ({ weekStart: w, distinctPosters: byWeek.get(w).size, tasks: taskCount.get(w) || 0 })),
    postersByWeek: Object.fromEntries(weeks.map((w) => [w, [...byWeek.get(w)].sort()])),
  };
}

const data = {
  fetchedAt,
  apiBase: API,
  decimals: 6,
  moneyNote: "rewardVolume and paidVolume are raw stablecoin units with 6 decimals; this file stores them converted by dividing by 1,000,000 in the flow object. Time series buckets keep the raw values as returned.",
  endpoints: [
    "/api/market/stats?chainId=…",
    "/api/stats/breakdowns?chainId=…",
    "/api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day|week",
    "/api/stats/activity-heatmap?chainId=…&range=30d&dimension=mode|hourOfWeek",
    "/api/stats/activity-feed?chainId=…&limit=50",
    "/api/tasks?chainId=…&sort=newest&limit=100&cursor=…",
  ],
  chains: chainData,
  combinedPosters,
};

mkdirSync(root, { recursive: true });
writeFileSync(outPath, JSON.stringify(data) + "\n");
console.log(`wrote ${outPath} fetchedAt=${fetchedAt}`);
