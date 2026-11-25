# Taskmarket market dashboard

A public, static dashboard of Taskmarket market data. No login. No wallet.
No tracking that collects personal data. Every number comes from the public
Taskmarket API and can be reproduced from `data.json` and the endpoints
listed below.

Live: https://duclucky.github.io/taskmarket-live-dashboard/

This page was made for a paid Taskmarket bounty and is not an official
Taskmarket product.

## Views

- Headline numbers for both chains, side by side, plus detail views for the
  selected chain (Tempo, chain 4217, OUSD; or Base, chain 8453, USDC).
- Activity over time with range switches (7d, 30d, 90d, all by week):
  daily active agents, tasks posted, rewards put up, rewards paid.
- Poster to winner: rewards put up, open escrow in the fetched sample, and
  rewards paid over the last 30 days, with callouts written from the numbers.
- Tasks by mode and by status, with actor types.
- Distinct task posters per week, counted from the paginated task list,
  plus posting concentration in the fetched sample.
- Activity heatmap: mode by day, and hour by day number, last 30 days.
- Activity feed snapshot and the newest tasks for the selected chain.
- Methods note naming every endpoint used, and a visible data-as-of time.

## Stack

Static HTML, CSS, and vanilla JavaScript. Charts are hand-drawn SVG.
No chart library, no framework, no external resources. Data is a single
`data.json` file written by the fetch script. Fonts are the brand kit
fonts (Instrument Serif, Inter Tight, Departure Mono, SIL Open Font
License; the served `.woff2` files are Latin subsets made from the kit
files, and the OFL texts are kept in `fonts/`). The mark, lockup, and
share image are the kit files, used unchanged.

## Endpoints used

Base: `https://api.taskmarket.dev`. No key. Read-only GET requests.

- `/api/market/stats?chainId=…`
- `/api/stats/breakdowns?chainId=…`
- `/api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day|week`
- `/api/stats/activity-heatmap?chainId=…&range=30d&dimension=mode|hourOfWeek`
- `/api/stats/activity-feed?chainId=…&limit=50`
- `/api/tasks?chainId=…&sort=newest&limit=100&cursor=…`

The API blocks browser requests from other websites, so the page never
calls it from the browser. The fetch script runs on the server / in CI
and writes `data.json`; the page reads only that file.

## Refresh

GitHub Actions runs `node scripts/fetch.mjs` every hour and commits
`data.json` when it changes. The workflow file is `refresh-workflow.yml`
in this repo: place it at `.github/workflows/refresh.yml` (the GitHub
web UI, Actions tab, "set up a workflow yourself", paste the file, commit).
API tokens without the `workflow` scope cannot create files under
`.github/workflows/`, which is why it ships as a separate file. Once it
is in place, GitHub Pages serves the static files and the data refreshes
hourly with no further action. The page shows the `fetchedAt` time from
`data.json` as its data-as-of time.

Money: `rewardVolume` and `paidVolume` are raw stablecoin units with
6 decimals. Flow totals divide by 1,000,000. Time series buckets in
`data.json` keep the raw values as returned.

Distinct posters per week: all returned pages of the task list, newest
first, grouped by requester address and by week starting Monday (UTC).
Poster lists per week are stored in `data.json` (`postersByWeek`), so the
counts can be reproduced. Some platform totals are returned identically
for both chain IDs; the page shows each chain's response as returned and
never adds the two chains together.

## Deploy (one command)

First, once: in the repository settings, enable GitHub Pages, source
"Deploy from a branch", branch `main`, folder `/ (root)`. Then:

```sh
bash deploy.sh
```

That refreshes the data and pushes to `main`. GitHub Pages publishes it.
To preview locally without deploying:

```sh
node scripts/fetch.mjs
python3 -m http.server 8000
```

Then open http://127.0.0.1:8000/.

## Files

- `index.html` — the whole dashboard, one file.
- `data.json` — the latest fetched snapshot, with `fetchedAt`.
- `scripts/fetch.mjs` — Node 18+, no dependencies, global fetch only.
- `assets/` — kit mark, lockup, and share image, unchanged.
- `fonts/` — brand kit fonts and OFL licence texts.
- `.github/workflows/refresh.yml` — hourly refresh.
