# Nat Gas ETF Volume Monitor

A real-time dashboard for tracking volume flow and price-volume dynamics across natural gas ETFs. Combines daily pipeline data from Yahoo Finance and TrackInsight with a multi-timeframe volatility engine to surface statistically significant volume and capital flow events.

**Live Dashboard:** [https://yieldchaser.github.io/Nat-Gas-ETFs/](https://yieldchaser.github.io/Nat-Gas-ETFs/)

---

## Overview

This project implements three interconnected analytical engines:

1. **Volume Monitor** (`index.html`) — Multi-timeframe volume anomaly detection, volatility modeling, and conviction event filtering across 6 leveraged ETFs.
2. **Flow Monitor** (`flows.html`) — Daily capital flow tracking (AUM in/out), Z-Score history, pressure scoring, divergence detection, and cross-ETF comparison.
3. **Trough-to-Peak Analyzer** (`trough-peak.html`) — Parameterized ZigZag recovery cycle identification with micro-analytics and forward-return context.

---

## Instruments Tracked

**LONG SIDE** (Bull — profit when Nat Gas rises):
- **BOIL** – ProShares Ultra Bloomberg NG (2×, NYSE)
- **HNU.TO** – BetaPro Natural Gas 2× Bull (2×, TSX)
- **3NGL.L** – WisdomTree NG 3× Daily Long (3×, LSE)

**SHORT SIDE** (Bear — profit when Nat Gas falls):
- **KOLD** – ProShares UltraShort Bloomberg NG (2× inverse, NYSE)
- **HND.TO** – BetaPro Natural Gas 2× Bear (2× inverse, TSX)
- **3NGS.L** – WisdomTree NG 3× Daily Short (3× inverse, LSE)

**Underlying futures context:**
- **NG=F** – NYMEX Henry Hub Natural Gas Futures (signal gate only — not traded)

> **Color convention across all dashboards:** For SHORT ETFs, color is semantically inverted — outflows (−) are shown green (bullish: shorts being unwound) and inflows (+) are shown red (bearish: new short entries). Long ETFs follow the standard convention.

---

## Dashboard Pages

### 1. Flow Monitor (`flows.html`)

Tracks daily capital inflows and outflows (AUM changes) across all 6 ETFs via TrackInsight data. Identifies stealth accumulation, distribution events, and divergences between price and capital flow.

#### Cross-ETF Sentiment Banner

A split bar showing the balance of 30-day capital flows between long and short sides:
- **Left (green)** — long-side flow share (BOIL + HNU + 3NGL). Inflows = bullish.
- **Right (red)** — short-side flow share (KOLD + HND + 3NGS). Outflows = bullish (shorts unwinding).
- Sub-labels explain direction: *"Shorts being unwound"* vs *"Short entries rising"*.
- Overall sentiment badge: `BULLISH` / `BEARISH` / `NEUTRAL`.

#### KPI Flow Cards (Long & Short Side)

Compact cards — one per ETF — show at a glance:

| Metric | Description |
|--------|-------------|
| **30D Net Flow** | Total net capital movement over 30 trading days |
| **Z-Score** | How unusual today's flow is vs. the 30-day rolling average |
| **5D / 20D Momentum** | Rolling short- and medium-term net flow |
| **Regime** | `ACCUMULATION` (Z > +1.5) / `DISTRIBUTION` (Z < −1.5) / `BALANCED` |
| **Pressure Score** | Composite −100→+100: Z-Score (25pts) + momentum factor + consecutive-streak bonus. Displayed with a mini fill bar. |

All color logic is side-aware: short ETF cards invert green/red to reflect bullish/bearish meaning for Nat Gas price.

Clicking any card loads that ETF in the Deep Dive panel.

#### Deep Dive Chart Panel

Select any ETF + time range (1W / 1M / 3M / 6M / 1Y / 3Y / ALL). Contains:

1. **Cumulative Flow + Price chart** — Split-adjusted NAV price (white line) overlaid with cumulative net flow area (green = net inflows, red = net outflows from the visible range start). Drag to measure price and flow changes between two dates.
2. **Global Range Slider** — Immediately below the top chart. Controls the zoom of **all charts on the page simultaneously** (cumulative chart, daily bars, Z-Score history, cross-ETF comparison). Scroll-wheel zoom also syncs.
3. **Daily Flow Bars** — Green bars above zero = inflow days; red bars below = outflow days.
4. **Stats Row** — Bottom of panel: Z-Score, 5D/20D momentum, Regime, Pressure for the active ETF.

#### Flow vs Price Divergence Table

Scans the active ETF's history for windows (3d / 5d / 10d) where price and flow moved in opposite directions by meaningful thresholds:

- **Bullish Divergence** — Price fell >3% but net flow was positive (stealth accumulation).
- **Bearish Divergence** — Price rose >3% but net flow was negative (distribution behind the rally).

Filterable by lookback (90D / 6M / 1Y / ALL). Right-aligned numeric columns, alternating row tints.

Each divergence is defined as an event window `[s, e]` where `s = e − w + 1` (window start) and `e` is the end date, for `w` ∈ {3, 5, 10}.

**Context flow columns:**

| Column | Window | Notes |
|--------|--------|-------|
| **LOCAL AVG** | `s−3` → `e+3` (`w+6` days total) | Broad local context spanning 3 days before the window opens through 3 days after it closes. Length varies by `w` (9 days for 3d, 11 for 5d, 16 for 10d). Shows `—` when insufficient future data exist. |
| **PRE-3D** | `s−3` → `s−1` (3 days) | Average daily flow in the 3 days immediately before the window opens. No overlap with the event window — cleanly shows whether the imbalance was already building before the divergence started. |
| **POST-3D** | `e+1` → `e+3` (3 days) | Average daily flow in the 3 days after the window closes. Measures follow-through — did capital continue or reverse? Shows `—` for the most recent events. |
| **DAY FLOW** | `e` only | Net flow on the exact end-date. Distinct from AVG/DAY (full-window average); isolates whether the final day itself spiked or was ordinary. |
| **BASE-30D** | `s−30` → `s−1` (30 days) | Prevailing flow regime before the divergence window opened. Computed as `(cumulative_flow[s−1] − cumulative_flow[s−31]) ÷ 30`. Compare PRE-3D and AVG/DAY against this to judge whether the divergence is truly anomalous. Shows `—` when fewer than 30 days of history precede the window. |

#### Flow Z-Score History Chart

Full historical chart of the rolling flow Z-Score with:
- Green shaded zone above +1.5σ (Accumulation)
- Red shaded zone below −1.5σ (Distribution)
- Zone labels right-aligned at chart edge
- Hover crosshair with date, Z-Score, daily flow, and regime tooltip
- Controlled by the global range slider

#### Cross-ETF Cumulative Flow Comparison

Overlaid cumulative flow lines for all 6 ETFs (normalized to zero at start of visible range). Features:
- ETF toggle chips (click to show/hide individual ETFs)
- Filter by side: ALL / LONG / SHORT
- HTML legend below the chart (no canvas overlap or label collision)
- Active ETF highlighted with thicker line and bold legend entry
- Hover crosshair showing all visible ETF values at any date
- Controlled by the global range slider

#### Yearly Flow Activity Matrix

Heatmap-style table showing the count of significant flow events (|Z-Score| ≥ 1.5) per year per ETF, alongside average Z-Score magnitude. Useful for identifying which years had the most active capital flow signals.

---

### 2. Volume Monitor (`index.html`)

Multi-timeframe volume anomaly detection engine:

- **Detects volume anomalies** across 6 windows (5d/10d/21d/63d/126d/252d) using percentile ranking and Z-scores
- **Models volatility** with HV, vol regime percentiles, ATR, and VoV
- **Synthesizes signals** via the **VPS (Volume Pressure Score)** — a 5-component composite
- **Tracks historical echoes** — patterns showing price action following capitulation signals, with lead-time calibration and regime-stratified forward returns
- **Monitors capitulation** with **VCVI** (Vol-Adjusted Capitulation Volume Index)
- **Detects weather spikes** via 5d fast-window VCVI + ATR sharp-spike flag
- **Gates signals** with a seasonally-adjusted NG=F price Z-score
- **Corrects for leveraged ETF decay** to prevent structural price drift contaminating percentile signals
- **Weights by season** (winter ×1.3, summer ×0.85)
- **Classifies NG=F volatility regime** (normal / elevated / extreme)

#### ETF Cards

Each card shows:

1. Price & daily change, season badge, ⚡ SPIKE badge
2. Volume metrics: RVOL-21d, Z-Score, VROC-10d
3. Volume percentile bars: 6 timeframes (5/10/21/63/126/252d)
4. Volatility panel: HV-10/21/63d, vol regime, ATR-14, term structure, VoV-21
5. VCVI indicators: 5d fast, 21d (with decay-corrected †value), 63d
6. VPS composite score + MWCA alarm

#### Signal Command Center

**NG=F Price Context Bar** — Seasonal Z-score gate:

| Gate | Condition | Meaning |
|------|-----------|---------|
| **LONG ✓** | Seasonal z ≤ −1.5σ | Gas anomalously cheap for the month → long signals credible |
| **SHORT ✓** | Seasonal z ≥ +1.5σ | Gas anomalously expensive → short signals credible |
| **Both ✗** | −1.5 < z < +1.5 | Gas within seasonal norm → interpret with caution |

**Volatility Regime Badge:**

| Regime | Trigger | Behavior |
|--------|---------|----------|
| **● NORMAL** | Price ≤ $4.5, \|z\| < 1.5σ, NG HV < 70th pct | Signals behave as expected |
| **⚠ ELEVATED** | Price > $4.5 OR \|z\| ≥ 1.5σ OR HV ≥ 70th pct | Interpret with caution |
| **🚨 EXTREME** | Price > $7.0 OR \|z\| ≥ 2.5σ OR HV ≥ 90th pct | Outlier environment — historical patterns may invert |

**Conviction Events (5-gate filter, ~1–2/ETF/year):**

| Gate | Condition |
|------|-----------|
| 1 — Volume Capitulation | VCVI-21d ≥ 72 (or Extreme Override) |
| 2 — Multi-Window Breadth | ≥ 3 of 5 windows ≥ 85th pct |
| 3 — Price Dislocation | \|Daily move\| > 1.5× ATR-14 |
| 4 — Regime Context | Vol regime ≤ 70th percentile |
| 5 — NG Directional | Long: z ≤ −0.5σ · Short: z ≥ +0.2σ |

**Elevated Watch (3-gate, ~4–8/ETF/year):** softer thresholds (VCVI ≥ 60, 2/75 breadth, 1.2× ATR), no vol-regime constraint.

**Historical Echoes:** forward return study (5/10/21/42/63/126/252d windows) for all past VCVI ≥ 55 signals, with median lead-time to peak, season tags, regime-stratified return tables.

---

### 3. Trough-to-Peak Analyzer (`trough-peak.html`)

Professional-grade recovery cycle identification:

- **Parameterized ZigZag** — Adjustable % rally threshold (0–300%) to confirm trough-to-peak moves
- **Micro-Analytics:** Cyc/Regime (maturity tagging), Stretch Index, 1M/3M/6M percentile ranks, distance from peak/trough, range compression
- **Wait-Time Analysis (GAP)** — Idle days between cycles
- **KPI Summary Grid** — Avg Gain, Avg Days, Avg Gap, Max/Min across all 6 ETFs
- **Interactive Canvas** — Custom zoom brush, crosshair, real-time tooltips

---

## Core Metrics

### Flow Metrics (`fetch_flows.py`)

| Metric | Formula / Description |
|--------|-----------------------|
| **Daily Flow** | USD AUM change per day (TrackInsight) |
| **Cumulative Flow** | Running sum of daily flows from inception |
| **Flow Z-Score** | `(daily_flow − 30d_mean) / 30d_std` |
| **Flow 5D / 20D** | Rolling 5-day and 20-day net flow sums |
| **Regime** | `ACCUMULATION` (Z > +1.5) / `DISTRIBUTION` (Z < −1.5) / `BALANCED` |
| **Pressure Score** | `Z×25 + momentum_factor + streak_bonus`, clamped to ±100 |
| **Cross-ETF Sentiment** | Net 30d flows compared between long and short aggregates |

### Volume Metrics (`data_pipeline.py`)

| Metric | Description |
|--------|-------------|
| **RVOL** | Relative volume: today ÷ N-day avg |
| **Z-Score** | Std deviations from rolling mean |
| **VROC** | Volume rate of change |
| **Vol Percentile** | Rank vs own rolling history |
| **CVI** | `vol_pct × (1 − price_pct/100)` |
| **VCVI** | `CVI × (1.5 − vol_regime_pct/100)` |
| **VPS** | RVOL (25%) + Z (20%) + Vol% (25%) + VROC (10%) + Inv Vol Regime (20%) |
| **MWCA** | Volume ≥90th pct across all 6 windows simultaneously |

### Leveraged ETF Decay Correction

| ETF Type | Approx. Decay |
|----------|--------------|
| 2× long/short (BOIL, KOLD, HNU.TO, HND.TO) | ~35–40%/yr |
| 3× long/short (3NGL.L, 3NGS.L) | ~55%/yr |

Adjusted price: `adj_price[t] = raw_price[t] × (1 + decay/252)^t`

---

## Architecture

### Frontend
```
docs/
├── index.html           # Volume Monitor dashboard
├── flows.html           # Flow Monitor (capital flow analytics)
├── trough-peak.html     # Trough-to-Peak recovery analyzer
├── css/
│   ├── styles.css       # Shared global theme, grid, tooltips
│   ├── cards.css        # ETF card styling
│   └── signals.css      # Signal panel styling
└── js/
    ├── app.js           # App controller, data loading
    ├── data.js          # Yahoo Finance API
    ├── cards.js         # Card rendering (decay-adj VCVI, season badge, spike)
    ├── charts.js        # Canvas charts (sparklines, forward return, trough-to-peak)
    ├── signals.js       # NG bar, stress matrix, SWVC, conviction, echoes
    ├── metrics.js       # Live metric calculations
    └── config.js        # Thresholds, windows, ETF metadata, decay rates
```

### Backend
```
scripts/
├── data_pipeline.py       # Nightly ETF + volume/signals ETL (Yahoo Finance)
│                          #   → dashboard_data.json + latest_signals.json
├── fetch_flows.py         # Nightly AUM flow ETL (TrackInsight)
│                          #   → data/flows/{TICKER}_flows.json
│                          #   → data/flows/all_flows_summary.json
├── trough_peak_data.py    # Static trough-to-peak OHLCV builder
├── get_snapshots_scraper.py  # TrackInsight snapshot scraper helper
└── validate_hypothesis.py    # Backtesting / signal validation utilities

data/
├── dashboard_data.json        # Pre-computed volume metrics for all ETFs
├── latest_signals.json        # Current alert state
└── flows/
    ├── all_flows_summary.json # Cross-ETF sentiment + per-ticker summary stats
    ├── BOIL_flows.json        # Daily flow history with Z-Score, regime, pressure
    ├── KOLD_flows.json
    ├── HNU_flows.json
    ├── HND_flows.json
    ├── 3NGL_flows.json
    └── 3NGS_flows.json

docs/data/                     # GitHub Pages copy (synced by Actions)
```

### Data Flow

**Volume pipeline (nightly via GitHub Actions):**
1. Fetch OHLCV for 6 ETFs + NG=F via Yahoo Finance
2. Compute NG=F context: seasonal Z-score, HV percentile, regime series
3. Compute per-ETF: volume metrics (6 windows), volatility, CVI/VCVI, VPS, decay-adj
4. Detect conviction events (5-gate + extreme override + momentum guard)
5. Detect elevated watch events (3-gate)
6. Generate historical echoes with regime-stratified forward return tables
7. Write `dashboard_data.json` + `latest_signals.json` → sync to `docs/data/`

**Flow pipeline (nightly via GitHub Actions):**
1. Fetch daily AUM snapshots for all 6 ETFs from TrackInsight
2. Parse USD flow, NAV, and daily performance from snapshot fields
3. Compute cumulative flow, 30-day rolling Z-Score, 5D/20D momentum
4. Classify regime per day (Accumulation / Distribution / Balanced)
5. Compute pressure score (Z + momentum + streak bonus, clamped ±100)
6. Aggregate cross-ETF sentiment (bull vs bear 30d net flows, BULLISH/BEARISH/NEUTRAL)
7. Write per-ticker JSON + summary JSON → sync to `docs/data/flows/`

---

## Development

### Local Setup
```bash
pip install pandas numpy

# Volume/signals data
python scripts/data_pipeline.py
cp data/dashboard_data.json docs/data/
cp data/latest_signals.json docs/data/

# Flow data
python scripts/fetch_flows.py
cp -r data/flows docs/data/

# Serve locally (required for fetch() to work)
python -m http.server 8080 --directory docs
# Open http://localhost:8080
```

### Key Constants

**`data_pipeline.py`**
```python
FAST_VCVI_THRESHOLD       = 45    # 5d VCVI threshold for spike flag
SHARP_SPIKE_ATR_MULT      = 2.0   # |move| must exceed N × ATR-14
NG_SEASONAL_Z_GATE        = 1.5   # σ threshold for long/short gate

CONVICTION_VCVI_MIN       = 72
CONVICTION_BREADTH_MIN    = 3
CONVICTION_BREADTH_PCT    = 85
CONVICTION_ATR_MULT       = 1.5
CONVICTION_VOL_REGIME_MAX = 70

EXTREME_OVERRIDE_VCVI_MIN = 90    # Bypasses Gate 1 minimum
EXTREME_OVERRIDE_ATR_MULT = 2.0

CONVICTION_NG_Z_LONG      = -0.5  # Long: seasonal z ≤ −0.5
CONVICTION_NG_Z_SHORT     =  0.2  # Short: seasonal z ≥ +0.2

WATCH_VCVI_MIN            = 60
WATCH_BREADTH_MIN         = 2
WATCH_BREADTH_PCT         = 75
WATCH_ATR_MULT            = 1.2

MOMENTUM_GUARD_VCVI_BOOST = 13    # Short-side bar raised when seasonal z > 0
```

**`fetch_flows.py`**
```python
Z_WINDOW     = 30   # Days for rolling mean/std (flow Z-Score)
MOM_SHORT    = 5    # 5-day momentum window
MOM_LONG     = 20   # 20-day momentum window
Z_ACCUM_THR  =  1.5 # Z > +1.5 → ACCUMULATION regime
Z_DIST_THR   = -1.5 # Z < −1.5 → DISTRIBUTION regime
PRESSURE_MAX = 100  # Pressure score clamp
```

---

## Tech Stack

- **Frontend:** Vanilla JS (ES6+), Canvas API, CSS3 Grid/Flexbox
- **Backend:** Python 3, Pandas, NumPy
- **Data:** Yahoo Finance v8 chart API + TrackInsight snapshot API
- **Deployment:** GitHub Pages (`docs/`) + GitHub Actions (nightly pipeline)
- **No frameworks** — lightweight, fast, single-page load

---

## License

MIT — Free for personal and commercial use.

---

**Questions?** Hover any metric label on the dashboard for detailed explanations — all three pages are self-documenting via tooltips.
