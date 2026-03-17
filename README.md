# Nat Gas ETF Volume Monitor

A real-time dashboard for tracking volume flow and price-volume dynamics across natural gas ETFs. Combines daily pipeline data from Yahoo Finance with a multi-timeframe volatility engine to surface statistically significant volume events.

**Live Dashboard:** [https://yieldchaser.github.io/Nat-Gas-ETFs/](https://yieldchaser.github.io/Nat-Gas-ETFs/)

## Overview

This project implements a multi-timeframe volume analysis engine that:

- **Detects volume anomalies** across 6 windows (5d/10d/21d/63d/126d/252d) using percentile ranking and Z-scores
- **Models volatility** with historical volatility (HV), vol regime percentiles, ATR, and VoV (vol-of-vol)
- **Synthesizes signals** via the **Volume Pressure Score (VPS)** — a 5-component composite metric
- **Tracks historical echoes** — patterns showing price action following capitulation signals, with lead-time calibration
- **Monitors capitulation** with the **VCVI (Vol-Adjusted Capitulation Volume Index)** — CVI adjusted for volatility regime
- **Detects weather spikes** with a 5d fast-window VCVI + ATR sharp-spike flag
- **Gates signals** with a **seasonally-adjusted NG=F price z-score** (more meaningful than raw percentile for this commodity)
- **Corrects for leveraged ETF decay** to prevent structural price drift from contaminating percentile signals
- **Weights by season** (winter premium ×1.3, summer discount ×0.85)
- **Measures price-volume correlation** across instruments — tracking the inverse relationship between volume spikes and price direction

## Instruments Tracked

**LONG SIDE** (Bull):
- **BOIL** – ProShares Ultra Bloomberg NG (2x leveraged, NYSE)
- **HNU.TO** – BetaPro Natural Gas 2x Bull (2x leveraged, TSX)
- **3NGL.L** – WisdomTree NG 3x Daily Long (3x leveraged, LSE)

**SHORT SIDE** (Bear):
- **KOLD** – ProShares UltraShort Bloomberg NG (2x inverse, NYSE)
- **HND.TO** – BetaPro Natural Gas 2x Bear (2x inverse, TSX)
- **3NGS.L** – WisdomTree NG 3x Daily Short (3x inverse, LSE)

**Underlying futures context:**
- **NG=F** – NYMEX Henry Hub Natural Gas Futures (signal gate only — not traded)

## Dashboard Features

### ETF Cards

Each card shows:

1. **Price & Change** — Current price, % daily change
2. **Season Badge** — ❄ ×1.3 / ✿ ×1.0 / ☀ ×0.85 / ◈ ×1.0 (seasonal signal weight)
3. **⚡ SPIKE Badge** — Flashes when 5d VCVI > 45 AND |move| > 2×ATR (weather event candidate)
4. **Volume Metrics** — RVOL-21d, Z-Score, VROC-10d
5. **Volume Percentile Bars** — 6 timeframes (5/10/21/63/126/252d)
6. **Volatility Panel** — HV-10d/21d/63d, Vol Regime, ATR-14, Term Structure, VoV-21
7. **VCVI Indicators** — 5d (fast), 21d (with decay-corrected †value), 63d
8. **VPS + MWCA** — Composite score and multi-window alarm
9. **Dollar Volume**

### Signal Command Center

#### NG=F Gas Price Context Bar

Sits at the top of the Signal Command Center. Shows the current NG=F price alongside a **seasonal z-score** bar — how many standard deviations above or below the typical price for this calendar month.

**Why seasonal z-score instead of raw percentile?** Natural gas is one of the most volatile commodities on earth. It regularly traverses its entire 2-year price range in a single season. A 2-year percentile would show "mid" almost constantly and be meaningless. The seasonally-adjusted z-score answers the actionable question: *"Is gas anomalously high or low for this time of year?"*

| Gate | Condition | Meaning |
|------|-----------|---------|
| **LONG ✓** | Seasonal z ≤ −1.5σ | Gas is unusually cheap for this month → long-side signals credible |
| **SHORT ✓** | Seasonal z ≥ +1.5σ | Gas is unusually expensive for this month → short-side signals credible |
| **Both ✗** | −1.5 < z < +1.5 | Gas is within its seasonal norm → signals are context-less, interpret with caution |

The bar also shows raw 2yr percentile for reference (in the tooltip).

#### Stress Matrix

| Column | Description |
|--------|-------------|
| PAIR | ETF pair with season emoji |
| LONG RVOL | Long-side 21d relative volume |
| SHORT RVOL | Short-side 21d relative volume |
| L-CAP | Long-side VCVI-63d (gas bottom signal) |
| S-CAP | Short-side VCVI-63d (gas top signal) |
| **FAST-5d** | 5d fast-window VCVI for L/S — catches weather spikes early |
| **SPIKE** | ⚡ flag when 5d VCVI > 45 AND move > 2×ATR |
| IPSI | Short RVOL ÷ Long RVOL ratio |
| VOL REGIME | HV-21d vs its 252d history |
| STATUS | QUIET / ELEVATED / STRESS / CRITICAL |

#### Side-Wide Volume Convergence (SWVC)

Tracks whether all 3 ETFs on the same side (e.g., KOLD + HND.TO + 3NGS.L) independently showed elevated volume within a rolling 10-trading-day window — even if the spikes did not occur on the same day.

**The signal:** BOIL, HNU.TO, and 3NGL.L are listed on NYSE, TSX, and LSE respectively, trading in different time zones and held by different investor bases. When all three independently spike within ~2 weeks, it means separate market participant cohorts in the US, Canada, and UK are all acting — independent corroborating evidence.

| Status | Meaning |
|--------|---------|
| **CONVERGED** | All 3 ETFs on same side spiked within 10 trading days |
| **PARTIAL** | 2 of 3 ETFs active, or all 3 but spread > 10 days |
| **SINGLE** | Only 1 ETF elevated |
| **QUIET** | No spikes in last 15 days |

#### Conviction Events — 4-Gate Filter (~1–2 events/ETF/year)

A strict multi-gate filter designed to isolate true anomalies. **ALL 4 gates must fire simultaneously:**

| Gate | Condition | Rationale |
|------|-----------|-----------|
| **Volume Capitulation** | VCVI-21d ≥ 72 | Must reach "critical" vol-adjusted level |
| **Multi-Window Breadth** | ≥ 3 of 5 windows ≥ 85th pct | Broad-based surge, not single-window noise |
| **Price Dislocation** | \|Daily move\| > 1.5× ATR-14 | Actual price shock, not just volume |
| **Regime Context** | Vol regime ≤ 70th percentile | Non-turbulent env required (signals meaningful) |

Each event shows date, VCVI, daily move, ATR multiple, breadth count, price — plus season emoji and forward return stats.

#### Elevated Watch — 3-Gate Filter (~4–8 events/ETF/year)

A softer variant that catches slow-building peaks that conviction events miss. **Requires only 3 gates, no vol-regime constraint:**

| Gate | Condition | vs Conviction |
|------|-----------|---------------|
| **Volume Capitulation** | VCVI-21d ≥ 60 | Softer (60 vs 72) |
| **Multi-Window Breadth** | ≥ 2 windows ≥ 75th pct | Softer (2/75 vs 3/85) |
| **Price Dislocation** | \|Daily move\| > 1.2× ATR | Softer (1.2× vs 1.5×) |

Dates within ±3 days of a full conviction event are excluded to prevent double-counting. Season tags and forward return stats included.

#### Historical Echoes

Pattern study of all past VCVI capitulation signals (VCVI ≥ 55, vol regime ≤ 60th):

- **Forward windows** — 5/10/21/42/63/126/252 days
- **Per-window stats** — Median return, win rate, best/worst (±200% clipped)
- **Edge window** — Highlighted bar showing the window with the strongest historical edge
- **⏱ Lead-time annotation** — "Peak ~Xd (IQR A–Bd)" showing median days from signal to peak, derived from all historical instances
- **Yellow dashed marker** on the forward return chart at the median lead-time day
- **Season tags** on occurrence dates — instantly shows if past signals clustered in winter vs summer
- **Occurrence tooltips** — hover any date pill: VCVI, vol regime, price, forward return, season, peak day

## Core Metrics Explained

### Volume Metrics
- **RVOL** – Relative volume: today ÷ N-day average. 2x = twice normal participation.
- **Z-Score** – Standard deviations from mean. >2σ = statistically unusual (~2.5% probability).
- **VROC** – Volume rate of change. Captures acceleration vs deceleration.
- **Vol Percentile** – Rank vs own rolling history. 90th+ triggers MWCA window contribution.

### Volatility Metrics
- **HV** – Realized historical volatility: std dev of log returns × √252 × 100 (annualized %).
  - HV-10d = most recent (sensitive), HV-21d = regime classification, HV-63d = trend
- **Vol Regime** – Where HV-21d sits in its 252-day history. 0th = calm (signals boosted), 100th = turbulent (signals discounted).
- **HV Term Structure** – HV10 ÷ HV63. <0.65 = calming; >1.35 = accelerating.
- **VoV-21** – Volatility of volatility. Std dev of the 10d HV series over 21 days.
- **ATR-14** – Average true range as % of price. Expected daily trading range.

### Composite Metrics
- **CVI** – Capitulation Volume Index. `vol_percentile × (1 − price_percentile / 100)`. High when volume is elevated AND price is depressed — captures capitulation divergence.
- **VCVI** – Vol-adjusted CVI. `CVI × (1.5 − vol_regime_pct / 100)`. Quiet environments boost the signal ×1.5; turbulent environments discount it ×0.5.
- **VCVI-5d** – Fast-window VCVI. Same formula but over 5 trading days. Fires on weather event spikes before longer windows catch up. Alert threshold: 45 (lower than standard 55).
- **Decay-adj VCVI-21d (†)** – VCVI recomputed using decay-corrected price percentile (see below).
- **VPS** – Volume Pressure Score: RVOL (25%) + Z-Score (20%) + Vol%ile (25%) + VROC (10%) + Inv Vol Regime (20%). Composite 0–100 scale.
- **MWCA** – Volume ≥90th percentile across ALL 6 windows simultaneously. Extremely rare.

### Seasonality Weighting
Natural gas demand peaks in winter (heating) and troughs in summer. Volume signals carry different informational content by season:

| Season | Months | Weight | Rationale |
|--------|--------|--------|-----------|
| Winter | Nov–Feb | ×1.30 | Peak demand season — capitulation signals more reliable |
| Spring/Fall | Mar–May, Sep–Oct | ×1.00 | Transition — baseline reliability |
| Summer | Jun–Aug | ×0.85 | Low demand — volume spikes less sustained |

Seasonally-adjusted VCVI is displayed on cards and used in forward-return context.

### Leveraged ETF Decay Correction

Leveraged and inverse ETFs lose value daily through path-dependent rebalancing — unrelated to the underlying commodity's actual price. Without correction, historical price percentiles are contaminated: a 2x ETF that has decayed 40%+ over a year will appear "cheap" even when gas is genuinely high.

**Annual decay estimates used:**

| ETF Type | Approximate Decay |
|----------|------------------|
| 2x long/short (BOIL, KOLD, HNU.TO, HND.TO) | ~35–40%/yr |
| 3x long/short (3NGL.L, 3NGS.L) | ~55%/yr |

**Method:** For each historical price point at age `t` days, the adjusted price is:
```
adj_price[t] = raw_price[t] × (1 + annual_decay/252)^t
```
Today's current price is then ranked against the decay-adjusted historical distribution. This makes "low price" actually mean "gas is high" rather than "time has passed." The correction is shown on cards as `†XX` alongside the raw VCVI-21d.

## Architecture

### Frontend
```
docs/
├── index.html          # Dashboard structure
├── css/
│   ├── styles.css      # Global theme, grid, tooltips
│   ├── cards.css       # ETF card styling
│   └── signals.css     # Signal panel styling
└── js/
    ├── app.js          # App controller, data loading
    ├── data.js         # Yahoo Finance API fallback
    ├── cards.js        # Card rendering (decay-adj VCVI, season badge, spike flag)
    ├── charts.js       # Canvas rendering (sparklines, forward return curve, lead-time marker)
    ├── signals.js      # NG bar, stress matrix, SWVC, conviction, elevated watch, echoes
    ├── metrics.js      # Live calculations (RVOL, Z-Score, CVI, VCVI, HV, etc.)
    └── config.js       # Thresholds, windows, ETF metadata, decay rates, season display
```

### Backend
```
scripts/
└── data_pipeline.py    # Nightly ETL:
                        #   - Fetches OHLCV for 6 ETFs + NG=F futures
                        #   - Computes all metrics (6 windows: 5/10/21/63/126/252d)
                        #   - Seasonal z-score gate for NG=F
                        #   - Decay-corrected price percentile per ETF
                        #   - Historical echoes with lead-time + season per occurrence
                        #   - Conviction events (4-gate) + elevated watch (3-gate)
                        #   - Writes dashboard_data.json + latest_signals.json

data/
├── dashboard_data.json      # Pre-computed metrics for all ETFs
└── latest_signals.json      # Current alert state

docs/data/                   # GitHub Pages copy (synced by Actions)
```

### Data Flow

1. **GitHub Actions Trigger** (nightly) → `data_pipeline.py`
2. **Fetch OHLCV** for 6 ETFs via Yahoo Finance + **NG=F** futures
3. **Compute per-ETF metrics:**
   - Volume: RVOL, Z-Score, VROC, percentiles across 6 windows (5–252d)
   - Volatility: HV, vol regime, ATR, VoV, term structure
   - Signals: CVI, VCVI per window, VCVI-5d fast, VPS composite
   - Decay-corrected price percentile → decay-adj VCVI-21d
   - Seasonality block: month, season, weight, adj_vcvi_21d
   - Sharp spike flag: |move| > 2×ATR AND VCVI-5d > 45
4. **Compute NG=F seasonal z-score** — compare current price to same-month historical distribution
5. **Compute SWVC** — cross-market spike convergence
6. **Detect Conviction Events** (4 gates) + **Elevated Watch** (3 gates, softer)
7. **Generate Historical Echoes** — with days_to_peak, season, seasonality_weight per occurrence; lead_time aggregate stats
8. **Write JSON** → `data/` and sync to `docs/data/`

## Development

### Local Setup
```bash
pip install pandas numpy

python scripts/data_pipeline.py

cp data/dashboard_data.json docs/data/
cp data/latest_signals.json docs/data/

# Serve locally (required for fetch() to work)
python -m http.server 8080 --directory docs
# Then open http://localhost:8080
```

### Key Constants (`data_pipeline.py`)
```python
# Fast spike detection
FAST_VCVI_THRESHOLD = 45      # 5d VCVI threshold
SHARP_SPIKE_ATR_MULT = 2.0    # |move| must exceed N × ATR-14

# NG=F seasonal z-score gate
NG_SEASONAL_Z_GATE = 1.5      # σ threshold (gates fire at ±1.5σ from seasonal norm)

# Elevated watch gates
WATCH_VCVI_MIN = 60
WATCH_BREADTH_MIN = 2
WATCH_BREADTH_PCT = 75
WATCH_ATR_MULT = 1.2

# Conviction event gates
CONVICTION_VCVI_MIN = 72
CONVICTION_BREADTH_MIN = 3
CONVICTION_BREADTH_PCT = 85
CONVICTION_ATR_MULT = 1.5
CONVICTION_VOL_REGIME_MAX = 70

# Leveraged ETF decay rates (annual)
ETF_ANNUAL_DECAY = {
    "BOIL": 0.35, "KOLD": 0.35,
    "HNU.TO": 0.40, "HND.TO": 0.40,
    "3NGL.L": 0.55, "3NGS.L": 0.55,
}
```

## Tech Stack

- **Frontend:** Vanilla JS (ES6+), Canvas API, CSS3 Grid/Flexbox
- **Backend:** Python 3, Pandas, NumPy
- **Data:** Yahoo Finance v8 chart API (no external dependencies)
- **Deployment:** GitHub Pages (docs/) + GitHub Actions (data pipeline)
- **No frameworks** — lightweight, fast, single-page load

## License

MIT — Free for personal and commercial use.

---

**Questions?** Hover any metric label on the dashboard for detailed explanations — the dashboard is self-documenting.
