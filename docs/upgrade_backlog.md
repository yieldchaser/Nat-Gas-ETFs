# Upgrade backlog — logged 2026-11-16

Work that is worth doing but is mostly mechanical. Each item says what to change, where, and how to
know it is done. Ordered by value. The research harness for any "score it first" item is
`tools/alerts_research.py` (`day_stats` for day-level, `trade_report` for non-overlapping trades
against the any-day benchmark).

## A. Data

### A1. Repair the CVOL rows for 2026-04-01 → 2026-11-09 (about 150 sessions) — NOT fixed yet
- **Evidence.** Before April 2026 the CSV's `UNDERLYING` equals the NG=F settle on non-roll days
  (median gap 0 bp, 73–84% of rows within 20 bp). From April to 9 November the median gap is
  **39–47 bp** and only 20–30% of rows are within 20 bp: those rows are mid-session snapshots.
  Commit `84ad48b` removed the 26 Sunday rows and refreshed only 10–13 November.
- **Why the scraper cannot do it.** The QuikStrike chart endpoint returns about four trade dates of
  intraday points whatever `dsrc` is set to (run 203 log: `16,257 intraday -> 4 trade-date rows`,
  with `dsrc=Settle`). It has no history.
- **Do.** Download the NGVL end-of-day history from CME (CVOL historical data / DataMine — the
  source the pre-April rows came from) and overwrite the eight columns for those dates in
  `data/cvol/ngvl_cvol_history.csv` and `docs/data/cvol/ngvl_cvol_history.csv`, then run
  `python scripts/build_cvol_tradeable.py`. Seven rows for 18–28 September 2026 were typed in from
  chart tooltips at two decimals (`scripts/add_missing_cvol_data.py`); replace those too.
- **Done when.** Median |UNDERLYING / NG=F close − 1| on non-roll days in that range is under 5 bp,
  and `node tools/test_cvol.js` passes.
- **Size of the effect.** Up to about 2 vol points and 0.03 of skew ratio on a given day (11 Nov
  moved from 98.4 / 1.680 to 96.3 / 1.648, which took that day out of the blow-off state). It does
  not change the long-run statistics; it changes which side of a threshold recent days sit on.

### A2. Watch the first scheduled fetch after this change
`scripts/fetch_cvol.py` now keeps the last print at or before the 14:30 New York settlement instead
of the last print of the session, to match the settlement-based history (NG moved about 2% between
settle and the 17:00 close on 11 November). Tested on synthetic sessions only. Check the 22:30 UTC
run: the log should show 4 trade-date rows and the new `UNDERLYING` should be within about 10 bp of
the NG=F settle.

### A3. Add a settle sanity check to the CVOL workflow
After `fetch_cvol.py`, compare the latest `UNDERLYING` with the latest `data/ng_history.json` close
for the same date; print a warning (do not fail) when they differ by more than 1% outside the
16th–21st roll window. Ten lines in `scripts/build_cvol_tradeable.py`.

### A4. Data the repo does not have (the real ceiling on direction)
Futures curve (front vs second and twelfth month — the roll yield that makes the any-day short win
58%), weekly storage surprise versus consensus, degree-day forecasts, CFTC positioning. Volume,
flows and options are close to exhausted for direction; these are where new information would come
from. Start with the curve: daily settles for the first 13 NG contracts.

## B. Signals still carrying untested directional labels

Score each with the harness before keeping its wording. If it does not beat the any-day benchmark
as trades, relabel it as a descriptive stress reading (as was done for L-CAP / S-CAP).

- **B1. Pipeline messages** — `scripts/data_pipeline.py` lines ~1434 and ~1491 write
  "potential GAS BOTTOM — long/leveraged setup" / "potential GAS TOP" into `latest_signals.json`
  and `dashboard_data.json → signals` (consumed at `docs/js/app.js:633`). The VCVI rule behind them
  has no edge (section 1 of `docs/alerts_research.md`). Reword to "long-side capitulation stress" /
  "short-side capitulation stress" or drop.
- **B2. Convergence flash** — `docs/js/signals.js` ~1271–1301 ("GAS BOTTOM — LONG / LEVERAGED
  SETUP", "EXTREME GAS TOP PROBABILITY"). Rebuild the historical flash dates from
  `side_convergence` logic, score at 10 and 21 sessions.
- **B3. Volume heat-map PEAKS / VALLEYS** — score forward returns after p95 and p99 peak days,
  split by long-side and short-side ETFs.
- **B4. PVT engine badges** — `docs/js/volume-studies.js:2943` "SELLING CLIMAX (BOTTOM)" and the
  IPVT execution states. Plain PVT trend and z-score had IC ≈ ±0.06 and were unstable by half.
- **B5. Flows page** — `docs/js/flow-composite.js:1234` "SHORT EXHAUSTION BOTTOM" and the other
  cycle states. Fund-flow features changed sign between halves; score the cycle states as trades.
- **B6. IPSI / pair stress matrix** — score "stress" states the same way.

## C. Improvements to what was built

- **C1. CVOL tab: make PANIC FLUSH require weak closes.** Flush with closing pressure ≤ 20th
  percentile: 75–79% long wins; without: 38%. Have `scripts/build_cvol_tradeable.py` write the
  closing-pressure percentile as a fourth column `cp_pe` in `ng_tradeable.csv` (definition in
  `AlertEngine.buildFrame`), read it in `attachTradeable`, and split the state in
  `computeEdgeModel` into PANIC FLUSH (confirmed) and FLUSH, UNCONFIRMED.
- **C2. Trade ledger per setup in Active Alerts.** Clicking a row in the evidence table should list
  that setup's trades (entry, exit, NG %, ETF-leg %, heat), like the ledger on the CVOL panel. The
  data is already in `model.setups[i].trades`.
- **C3. Closing-pressure study.** Add CP and its expanding percentile to Price-Volume Studies with
  lines at the 90th / 20th / 10th percentiles and markers on setup entry days.
- **C4. Cross-exchange confirmation.** The engine uses BOIL / KOLD only. Compute CP on HNU / HND and
  3NGL / 3NGS and test whether agreement across exchanges improves CLOSE EXHAUSTION.
- **C5. Off-site alerting.** Port the engine to Python in the nightly pipeline and write the active
  setups to `latest_signals.json`, so a notification can be sent when a STRONG setup turns on.
- **C6. Demote the older CVOL composites** (SAD / CI / CVC / RDS, the eight-state surface model,
  252-session percentile bands) as listed in `docs/cvol_edge_research.md`. Still open.

## D. Housekeeping

- **D1.** `node tools/test_pair_stress_and_vdds.mjs` fails on `main` (it failed before this change
  as well). Find out whether the test or the engine drifted.
- **D2.** `scripts/fetch_cvol.py` passes `dsrc=Settle` and logs "settled data", but the server
  returns the intraday series regardless. Fix the wording so the log does not mislead.
- **D3.** There is no CI on pull requests. A workflow running `node tools/test_cvol.js` and
  `node tools/test_alert_engine.mjs` would catch engine regressions before they reach Pages.
