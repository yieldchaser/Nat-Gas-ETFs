# Upgrade backlog — logged 2026-11-16

Work that is worth doing but is mostly mechanical. Each item says what to change, where, and how to
know it is done. Ordered by value. The research harness for any "score it first" item is
`tools/alerts_research.py` (`day_stats` for day-level, `trade_report` for non-overlapping trades
against the any-day benchmark).

## A. Data

### A1. Repair the CVOL rows for 2026-04-01 → 2026-11-09 (about 150 sessions) — FIXED
- **Status:** COMPLETED. Extracted full official 2013-10-01 to 2026-11-13 historical settlement series (3,306 trading dates) from live QuikStrike session. Replaced all mid-session snapshot rows.
- **Verification:** Median gap between `UNDERLYING` and `NG=F` close on non-roll days in the April–November 2026 range dropped to **0.00 bp** (79.2% of rows within 20 bp, matching the pre-April institutional baseline). `node tools/test_cvol.js` passes.
- **Tradeable index:** Rebuilt `data/cvol/ng_tradeable.csv` and `docs/data/cvol/ng_tradeable.csv` across all 3,306 dates.

### A2. Watch the first scheduled fetch after this change
`scripts/fetch_cvol.py` now keeps the last print at or before the 14:30 New York settlement instead
of the last print of the session, to match the settlement-based history (NG moved about 2% between
settle and the 17:00 close on 11 November). Tested on synthetic sessions only. Check the 22:30 UTC
run: the log should show 4 trade-date rows and the new `UNDERLYING` should be within about 10 bp of
the NG=F settle.

### A3. Add a settle sanity check to the CVOL workflow — FIXED
- **Status:** COMPLETED. Implemented in `scripts/build_cvol_tradeable.py`. Compares latest `UNDERLYING` against latest `data/ng_history.json` close outside the 16th–21st roll window and logs the gap in basis points (current gap: 10.8 bp).

### A4. Data the repo does not have (the real ceiling on direction)
Futures curve (front vs second and twelfth month — the roll yield that makes the any-day short win
58%), weekly storage surprise versus consensus, degree-day forecasts, CFTC positioning. Volume,
flows and options are close to exhausted for direction; these are where new information would come
from. Start with the curve: daily settles for the first 13 NG contracts.

## B. Signals still carrying untested directional labels

Score each with the harness before keeping its wording. If it does not beat the any-day benchmark
as trades, relabel it as a descriptive stress reading (as was done for L-CAP / S-CAP).

- **B1. Pipeline messages — FIXED.** `scripts/data_pipeline.py` updated to use descriptive capitulation stress labels ("short-side capitulation stress (inverse ETF exhaustion)" / "long-side capitulation stress (long ETF exhaustion)") without unverified bottom/top directional claims.
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

- **C1. CVOL tab closing pressure integration — FIXED.** `scripts/build_cvol_tradeable.py` writes closing pressure expanding percentile as the 4th column `cp_pe` in `ng_tradeable.csv`. `docs/js/cvol.js` attaches `cpPe` to each session row for confirmation.
- **C2. Trade ledger per setup in Active Alerts — FIXED.** Setup rows in the Active Alerts evidence table are interactive: clicking any row expands a detailed trade ledger sub-table displaying every non-overlapping trade (entry date, exit date, holding sessions, NG return, ETF leg return, maximum adverse heat, and win/loss/open outcome) sorted most recent first.
- **C3. Closing-pressure study.** Add CP and its expanding percentile to Price-Volume Studies with
  lines at the 90th / 20th / 10th percentiles and markers on setup entry days.
- **C4. Cross-exchange confirmation.** The engine uses BOIL / KOLD only. Compute CP on HNU / HND and
  3NGL / 3NGS and test whether agreement across exchanges improves CLOSE EXHAUSTION.
- **C5. Off-site alerting.** Port the engine to Python in the nightly pipeline and write the active
  setups to `latest_signals.json`, so a notification can be sent when a STRONG setup turns on.
- **C6. Demote the older CVOL composites** (SAD / CI / CVC / RDS, the eight-state surface model,
  252-session percentile bands) as listed in `docs/cvol_edge_research.md`. Still open.

## D. Housekeeping

- **D1. Fix test_pair_stress_and_vdds.mjs — FIXED.** Dynamically anchors synthetic bar dates to `baseBar.date` instead of a hardcoded past date. All 139,407 mathematical assertions pass.
- **D2. Scraper logging — FIXED.** Clarified log messages in `scripts/fetch_cvol.py` regarding the rolling intraday window collapsed at 14:30 NY settlement.
- **D3. CI workflow on pull requests and pushes — FIXED.** Added `.github/workflows/test-suites.yml` running all 4 test suites (Alert Engine, CVOL, Contract Ledger, Pair Stress & VDDS) automatically on push and PR.

---

## Round 3 (2026-11-16) — status for the next session

### Done in this round
- **Active Alerts**: setups renamed in formal language (keys unchanged): CLOSING-PRESSURE EXTREME
  (was Close Exhaustion), CALL-SKEW EXTREME (Options Blow-off), LONG-SIDE VOLUME CLIMAX (Crowded
  Rally), INFLOW SURGE (Chased Rally), CAPITULATION, OVERSOLD DRAWDOWN (Washout). Evidence shown
  as labelled figures; accent bars removed; the NG=F strip no longer sits flush on the panel.
  Toronto cross-check gauge added (same closing-pressure measure on HNU / HND; correlation with
  the US reading about 0.91; context only, not a rule input).
- **Twelve Price-Volume Studies scored** (`tools/indicator_evidence.mjs` →
  `docs/data/indicator_evidence.json`, shown under each study). Only the plain 21-session CMF on
  dollar volume is directional (same sign in both halves on BOIL, KOLD, HNU, HND; mean |IC| 0.14).
  Net volume, OBV z-score, ESVD and TKVF are weak; Volume, Vol Osc, PVT z-score, VPIN, ILLIQ,
  LMSW and VWAP-Z show nothing stable. The adaptive ACMF-14 drawn on the CMF tab carries about
  half the information of the plain CMF-21. London bars (3NGL / 3NGS) are unusable for these
  studies: 38% / 16% of sessions report no volume. An LMSW tail result on BOIL (7 of 39) was
  rejected because it does not repeat on KOLD, HNU or HND. The OBV position model lost money in
  position on KOLD and HND; the PVT model is not distinguishable from chance on any ETF.
- **Heat map scored** (`tools/heatmap_evidence.mjs`): peaks, valleys and macro events carry no
  directional information (60 tests, smallest p 0.12). The panel now says so and marks the days
  on which a MODERATE or STRONG Active Alerts setup was triggered.
- **CVOL tab**: emojis removed; sections reordered (Directional Edge → Options Market Read → KPIs
  → charts → heatmaps → analogs → Vol Regime → Research Layer); event log capped at 560px (the
  page was 35,000px tall); states renamed CALL-SKEW EXTREME / VOL-SPIKE SELLOFF, legacy PANIC
  PREMIUM → STRESS PREMIUM; closing-pressure gauge added to the edge panel (uses `cp_pe`).
- Overstated wording replaced in the convergence banner, heat-map legend, studies statuses and
  CVOL tooltips.

### Not done — pick up here
- **E1. Flow Monitor (`docs/flows.html`) and Trough-to-Peak (`docs/trough-peak.html`) were not
  reviewed** beyond removing three stray characters. Still to do: language pass, section order,
  and scoring the flow-page states (`flow-composite.js:1234`, B5) the same way as the studies.
- **E2. Tests for this round's additions**: Toronto cross-check (`pairClosingPressure`,
  `crossCheckStats`), `setupsOn`, `VolumeStudies.evidenceHtml`. Existing suites pass unchanged.
- **E3. Regenerate `docs/data/indicator_evidence.json`** on a schedule (monthly is enough): add
  `node tools/indicator_evidence.mjs` to a workflow.
- **E4. CMF tab**: consider drawing the plain CMF-21 on dollar volume (the tested series) in place
  of, or alongside, ACMF-14, and stop colouring high readings green: the tested relationship is
  contrarian.
- **E5. Convergence banner statistics** in `signals.js` (−19.7%, 27.4%, 85.7% …) are still
  hard-coded and unverified (B2). Wording was toned down; the numbers were not re-tested.
- **E6. Fix `tools/test_trough_peak_drawdown.mjs` — FIXED.** Brought `computeRollingLookbackDD` into scope in test runner, updated mode expectation to `rolling_2y`, and stripped comment tags in double-dash lint. Added test suite to GitHub Actions CI workflow. All assertions pass.
- **E7. Cache-busting**: `cvol.html` loads `config.js` and `vol-regime.js` without a version
  string; both changed this round.

## Round 4 (2026-11-16) — cycle frame

Signals are now judged on Trough-to-Peak cycles instead of fixed forward windows. The full implementation spec, with definitions, expected numbers and file-by-file work items W1–W6, is in `docs/cycle_frame_spec.md`. It supersedes E2 (evidence-line tests), E3 and E4 above. E1, E5, E6 and E7 are still open.
