# Archived Signal Studies — Conviction Events · Elevated Watch · Historical Echoes

*Archived 2026-10-17. These three panels were removed from the Volume Monitor
dashboard (`index.html`) because they were retrospective research tables rather
than live trading signals. The nightly pipeline still computes and stores the
data in `dashboard_data.json`; the panel frontend is preserved in git history.*

---

## What these studies were

All three were historical scans over each ETF's full lifetime that displayed
(a) a ledger of past signal dates and (b) forward-return statistics measured
from the signal close.

| Study | Filter | Displayed |
|---|---|---|
| **Conviction Events** | strict 5-gate filter + extreme override | last 15 events per ETF + median / win-rate forward returns (5/10/21/42/63d) |
| **Elevated Watch** | 3-gate softer filter | last 10 events per ETF + same forward-return table |
| **Historical Echoes** | VCVI ≥ 55 and VolRegime ≤ 60th pct | 5/10/21/42/63/126/252d medians, win rates, best/worst (±200% clip), regime-stratified table, median lead time, last 5 instances |

## Gate definitions

### Conviction Events — `scripts/data_pipeline.py` (`_detect_conviction_events`)

| Gate | Condition |
|---|---|
| 1 — Volatility capitulation | VCVI-21d ≥ 72 (short-side bar raised to 85 when NG seasonal z > 0 — momentum guard) |
| Extreme override | VCVI ≥ 90 **and** daily move > 2× ATR-14 (bypasses Gate 1 only) |
| 2 — Multi-window breadth | ≥ 3 of 5 volume-percentile windows ≥ 85th pct |
| 3 — Price dislocation | \|daily move\| > 1.5× ATR-14 |
| 4 — Regime context | vol regime ≤ 70th percentile |
| 5 — NG directional | long: seasonal z ≤ −0.5 · short: seasonal z ≥ +0.2 |
| 6 — VDDS advisory | non-blocking; VDDS value annotated per event |

Dedup: ≥ 15 calendar days between distinct events.

### Elevated Watch — `_detect_elevated_watch_events`

| Gate | Condition |
|---|---|
| 1 | VCVI-21d ≥ 60 |
| 2 | ≥ 2 windows ≥ 75th pct |
| 3 | \|daily move\| > 1.2× ATR-14 |

No vol-regime gate; dates within ±3 days of a Conviction Event are excluded.
Dedup: ≥ 7 calendar days.

### Historical Echoes — `_compute_historical_echoes`

VCVI-21d ≥ 55 and vol regime ≤ 60th pct, dedup ≥ 10 calendar days.
Forward windows: 5/10/21/42/63/126/252d. Mean / best / worst clipped at ±200%
(split-adjusted artifacts); median unclipped. Results stratified by NG=F
volatility regime (normal / elevated / extreme). "Signal edge" window = the
≤ 63d window maximising |median| × (win_rate − 50)²; lead time = median days to
the best forward return within 63d.

## Caveats that motivated the removal

- **In-sample calibration** — gate thresholds were tuned on the same history
  the tables evaluate (see `tools/calibrate.mjs`, `tools/count_signals.mjs`).
- **Small samples** — some ETF cells contain single-digit event counts.
- **Leveraged-decay contamination** — forward returns beyond ~63 sessions are
  dominated by ETF decay / roll costs, which is why the edge window is capped.
- **Episodes, not independent draws** — min-gap dedup collapses clusters; win
  rates over overlapping windows overstate statistical independence.
- Live decision inputs are unaffected and stay on the dashboard: Active Alerts
  (VCVI / MWCA / RVOL), Inverse Pair Stress Matrix, Volume Heat Map, SWVC.

## Where the data lives

- Per ETF in `docs/data/dashboard_data.json`: `conviction_events`,
  `elevated_watch`, `historical_echoes` (pipeline steps 5–7 of the volume
  pipeline). Still updated nightly — no frontend consumes it.

## How to restore the UI

Search history for the removal, e.g.
`git log -S renderConvictionEvents -- docs/js/signals.js`, then revert that
commit. It re-adds:

- `docs/index.html` panels: `#conviction-panel`, `#elevated-watch-panel`, `#echoes-panel`
- renderers in `docs/js/signals.js` + `Charts.drawForwardReturnCurve` in `docs/js/charts.js`
- panel CSS in `docs/css/signals.css` and the data pass-throughs in `docs/js/app.js`
