# Nat Gas ETF Volume Anomaly Radar 📊⚡

A real-time dashboard for detecting volume anomalies and price-volume patterns across natural gas ETFs. Combines live data from Yahoo Finance with a comprehensive volatility modelling engine to identify capitulation signals and potential reversals.

**Live Dashboard:** [https://yieldchaser.github.io/Nat-Gas-ETFs/](https://yieldchaser.github.io/Nat-Gas-ETFs/)

## Overview

This project implements a multi-timeframe volume analysis engine that:

- **Detects volume anomalies** across 5 windows (10d/21d/63d/126d/252d) using percentile ranking and Z-scores
- **Models volatility** with historical volatility (HV), vol regime percentiles, ATR, and VoV (vol-of-vol)
- **Synthesizes signals** via the **Volume Pressure Score (VPS)** — a 5-component composite metric
- **Tracks historical echoes** — patterns showing price action following capitulation signals
- **Monitors capitulation** with the **VCVI (Vol-Adjusted Capitulation Volume Index)** — CVI adjusted for volatility regime
- **Validates the hypothesis** that natural gas price-volume moves are inverse (high volume on down days, low volume on up days)

## Dashboard Features

### ETF Cards (6 instruments tracked)

**LONG SIDE** (Bull):
- **BOIL** – ProShares Ultra Bloomberg NG (2x leveraged, US)
- **HNU.TO** – BetaPro Natural Gas 2x Bull (2x leveraged, Canada)
- **3NGL.L** – WisdomTree NG 3x Daily Long (3x leveraged, UK)

**SHORT SIDE** (Bear):
- **KOLD** – ProShares UltraShort Bloomberg NG (2x inverse, US)
- **HND.TO** – BetaPro Natural Gas 2x Bear (2x inverse, Canada)
- **3NGS.L** – WisdomTree NG 3x Daily Short (3x inverse, UK)

### Each Card Shows

1. **Price & Change** – Current price, % daily change
2. **Volume Metrics**
   - Raw volume + sparkline
   - **RVOL-21d** – Relative volume (today ÷ 21-day avg). 2x = twice normal.
   - **Z-Score** – Std dev from mean volume. >2σ = statistically unusual.
   - **VROC-10d** – Volume rate of change vs 10 sessions ago
3. **Volume Percentile Bars** – Where today's volume ranks across 5 timeframes
4. **Volatility Panel**
   - **HV-10d/21d/63d** – Realized volatility (annualized %)
   - **Vol Regime** – Where HV-21d sits in its 252-day history (0th=quiet, 100th=extreme)
   - **ATR-14** – Daily trading range as % of price
   - **Term Structure** – HV10÷HV63 ratio (shows if vol is calming or building)
   - **VoV-21** – Volatility of volatility (regime instability indicator)
5. **Indicators**
   - **VCVI-21d/63d/252d** – Vol-adjusted capitulation volume index (0–100)
   - **VPS** – Composite volume pressure score (0–100)
   - **MWCA** – Multi-window convergence alarm (volume in top 90th percentile across ALL 5 windows simultaneously)
6. **Dollar Volume** – Volume traded in currency terms

### Signals Panel

**Stress Matrix** – Real-time alert grid showing:
- RVOL, VCVI, IPSI (Inverse Price Sensitivity), Vol Regime status
- Color-coded by severity (quiet/elevated/high/critical/extreme)
- Convergence gauges showing how many ETFs hit thresholds

### Conviction Events — Strict Multi-Gate Anomaly Filter

Inspired by the Excel model's strict filtering criteria that flagged only **1–2 meaningful events per ETF per year**, this is a multi-gate filter designed to isolate true anomalies from routine large moves. **ALL 4 gates must fire simultaneously:**

| Gate | Condition | Rationale |
|------|-----------|-----------|
| **Volume Capitulation** | VCVI-21d ≥ 72 | Must reach "critical" vol-adjusted level |
| **Multi-Window Breadth** | ≥ 3 of 5 vol-pct windows ≥ 85th | Broad-based surge, not single-window noise |
| **Price Dislocation** | \|Daily move\| > 1.5× ATR-14 | Actual price shock, not just volume |
| **Regime Context** | Vol regime ≤ 70th percentile | Signals meaningful (not during chronic turbulence) |

**Why it works:** A 7–10% move with high RVOL might look dramatic, but if only one window is elevated and vol regime is already in the 90th percentile, it's noise in a turbulent market. The conviction filter requires convergence across volume intensity, breadth, price action, AND regime context — eliminating false positives.

Each conviction event displays: date, VCVI level, daily move %, ATR multiple, breadth count, and price at signal. The panel also shows the annualized event rate to confirm the filter's selectivity.

### Historical Echoes

Pattern study showing forward returns after **volume capitulation signals** (VCVI ≥ 55):
- **Lookback period** – Studies all capitulation instances in history
- **Forward windows** – 5/10/21/42/63/126/252 days ahead
- **Return bars** – Shows actual price action after each signal
- **Statistics** – Win rate, avg gain, std dev, Sharpe ratio
- Reveals if capitulation truly precedes reversals

## Core Metrics Explained

### Volume Metrics
- **RVOL** – Relative volume. Captures unusual participation. Threshold: 1.5x = elevated.
- **Z-Score** – How many standard deviations above mean. >2σ rare (~2.5% probability).
- **VROC** – Rate of change. Measures if volume is accelerating or decelerating.
- **Vol Percentile** – Rank across historical window. 90th+ triggers alerts.

### Volatility Metrics
- **HV (Realized Vol)** – Std dev of log returns × √252 × 100. Annualized %.
  - 10d = most recent, sensitive to latest moves
  - 21d = used for regime classification
  - 63d = medium-term trend
- **Vol Regime %ile** – PERCENTILE of HV-21d within its 252-day history.
  - 0th = lowest in a year (historically calm) → signals are stronger
  - 100th = highest in a year (turbulent) → volume spikes expected, signals discounted
- **HV Term Structure** – Ratio HV10÷HV63
  - <0.65 = short-term calming (storm passed)
  - >1.35 = short-term surge (storm building)
- **VoV-21** – Std dev of the 10d HV series over 21 days. Measures regime *instability*.
  - High VoV = volatility itself is swinging wildly → potential vol spike risk
- **ATR-14** – Average true range as % of price. Expected daily range.

### Composite Metrics
- **CVI** – Capitulation Volume Index. Vol%ile × (1 − Price%ile/100). Captures divergence.
- **VCVI** – Vol-adjusted CVI. CVI × (1.5 − VolRegime%/100).
  - Quiet regime (low vol) → signals boosted ×1.5
  - Turbulent regime (high vol) → signals discounted ×0.5
- **VPS** – Volume Pressure Score. Weighted composite:
  - RVOL (25%) + Z-Score (20%) + Vol%ile (25%) + VROC (10%) + Inv Vol Regime (20%)
  - 0–100 scale. Higher = stronger upward volume pressure.
- **MWCA** – Extreme multi-timeframe confirmation. Volume ≥90th %ile across ALL 5 windows simultaneously. Extremely rare.

## Architecture

### Frontend (Docs Folder)
```
docs/
├── index.html          # Main dashboard
├── css/
│   ├── styles.css      # Global theme, grid, tooltips
│   ├── cards.css       # ETF card styling
│   └── signals.css     # Signal panel styling
└── js/
    ├── app.js          # App controller, data loading, hypothesis validation
    ├── data.js         # Yahoo Finance API wrapper
    ├── cards.js        # Card rendering engine
    ├── charts.js       # Canvas rendering (sparklines, volume bars, gauges, echoes)
    ├── signals.js      # Stress matrix & convergence display
    ├── metrics.js      # All calculations (RVOL, Z-Score, CVI, VCVI, VoV, HV, etc.)
    └── config.js       # Thresholds, windows, ETF metadata
```

### Backend (Scripts & Data)
```
scripts/
└── data_pipeline.py    # Nightly ETL that fetches OHLCV, computes all metrics,
                        # generates dashboard_data.json (pre-computed metrics)
                        # and latest_signals.json (current alert state)

data/
├── dashboard_data.json      # Pre-computed metrics for all ETFs & history
├── latest_signals.json      # Current signal state
└── validation_results.json  # Hypothesis validation stats

docs/data/              # Synced by GitHub Actions for GitHub Pages serving
├── dashboard_data.json
├── latest_signals.json
└── validation_results.json
```

## Data Flow

1. **GitHub Actions Trigger** (nightly) → `data_pipeline.py`
2. **Fetch OHLCV** from Yahoo Finance API (last 5 years)
3. **Compute Metrics**
   - Volume: RVOL, Z-Score, VROC, percentiles across 5 windows
   - Volatility: HV, vol regime, ATR, VoV
   - Volume Signals: CVI, VCVI per window, VPS composite
4. **Detect Conviction Events** – Strict multi-gate anomaly filter (VCVI + breadth + ATR + regime)
5. **Generate Historical Echoes** – Pattern study of post-capitulation returns
6. **Write JSON** to `data/` and sync to `docs/data/` for GitHub Pages
7. **Dashboard loads JSON** first, falls back to live Yahoo fetch if unavailable
8. **Browser computes live metrics** (if no pre-computed data) using `metrics.js`

## Tech Stack

- **Frontend:** Vanilla JS (ES6+), Canvas API, CSS3 Grid/Flexbox
- **Backend:** Python 3, Pandas, NumPy
- **Data:** Yahoo Finance API (yfinance)
- **Deployment:** GitHub Pages (docs/) + GitHub Actions (data pipeline)
- **No frameworks** – lightweight, fast, single-page load

## Customization

### Thresholds
Edit `docs/js/config.js`:
```javascript
CONFIG.thresholds = {
    rvol: { elevated: 1.5, high: 2.0, critical: 3.0, extreme: 5.0 },
    zScore: { elevated: 1.0, high: 1.5, critical: 2.0, extreme: 3.0 },
    vcvi: { elevated: 35, high: 55, critical: 70, extreme: 85 },
    // ... etc
}
```

### ETF List
Edit `docs/js/config.js`:
```javascript
CONFIG.etfs = {
    'BOIL': { name: 'ProShares 3x Nat Gas', side: 'long' },
    // Add more tickers...
}
```

### Data Windows
Edit `docs/js/config.js`:
```javascript
CONFIG.windows = {
    percentile: [10, 21, 63, 126, 252],  // Days for volume/price %ile
    rvol: [21],                          // Relative volume windows
    // ... etc
}
```

## Development

### Local Setup
```bash
# Install dependencies
pip install yfinance pandas numpy

# Run pipeline
python scripts/data_pipeline.py

# Sync data to docs/
mkdir -p docs/data
cp data/dashboard_data.json docs/data/
cp data/latest_signals.json docs/data/

# Open dashboard
open docs/index.html  # or serve locally with python -m http.server
```

### Adding a Metric
1. Implement calculation in `docs/js/metrics.js` or `scripts/data_pipeline.py`
2. Add to config thresholds/windows if needed
3. Render in `docs/js/cards.js` (ETF card) or `docs/js/signals.js` (stress matrix)
4. Style in CSS files
5. Add tooltip in HTML via `data-tooltip="..."`

### Debugging Live Data
Check browser console → App will log which data source loaded.
- ✓ Pre-computed: `[RADAR] Using pre-computed data`
- ✓ Live fallback: `[RADAR] Fetching live data from Yahoo Finance...`

## Performance Notes

- **Dashboard load:** <2s (pre-computed JSON)
- **Card rendering:** 60 FPS (Canvas sparklines/gauges)
- **Data refresh:** On-demand (manual refresh button) or auto:
  - 1 minute when market is open
  - 5 minutes when market is closed
- **Mobile-friendly:** Responsive grid layout, tooltips on hover/tap

## Credits

Built with a focus on **thesis-driven analysis** — testing the hypothesis that natural gas exhibits inverse price-volume relationships, and that volume capitulation precedes reversals.

## License

MIT — Free for personal and commercial use.

---

**Questions?** Check the tooltips (hover any metric label) for detailed explanations. The dashboard is self-documenting.
