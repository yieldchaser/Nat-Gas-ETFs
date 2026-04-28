# Blue Meridian

A real-time dashboard for tracking volume flow and price-volume dynamics across natural gas ETFs. Combines daily pipeline data from Yahoo Finance and TrackInsight with a multi-timeframe volatility engine to surface statistically significant volume and capital flow events.

**Live Dashboard:** [https://yieldchaser.github.io/Nat-Gas-ETFs/](https://yieldchaser.github.io/Nat-Gas-ETFs/)

---

## Overview

This project implements five interconnected analytical engines:

1. **Volume Monitor** (`index.html`) — Multi-timeframe volume anomaly detection, volatility modeling, and conviction event filtering across 6 leveraged ETFs.
2. **Flow Monitor** (`flows.html`) — Daily capital flow tracking (AUM in/out), Z-Score history, pressure scoring, divergence detection, and cross-ETF comparison.
3. **Trough-to-Peak Analyzer** (`trough-peak.html`) — Institutional-grade ZigZag recovery cycle identification with robust median metrics and 60-day statistical stability.
4. **Volatility Intelligence** (`cvol.html`) — Institutional convexity analysis, variance decomposition (UpVar vs DnVar), and Proprietary Composite Signals (SAD, CI, CVC, RDS) with integrated backtest scoring.
5. **Vol Regime Monitor** (embedded in `trough-peak.html`) — Full-lifetime historical volatility chart (5D/21D/63D/252D HV) with regime classification.

---

## Instruments Tracked

**LONG SIDE** (Bull — profit when Nat Gas rises):
- **BOIL** – ProShares Ultra Bloomberg NG (2×, NYSE)
- **HNU.TO** – BetaPro Natural Gas 2× Bull (2×, TSX)
- **3NGL.L** – WisdomTree NG 3× Daily Long (3×, LSE)

**SHORT SIDE — Primary signal anchor** (Bear — profit when Nat Gas falls):
- **KOLD** – ProShares UltraShort Bloomberg NG (2× inverse, NYSE)
- **HND.TO** – BetaPro Natural Gas 2× Bear (2× inverse, TSX)
- **3NGS.L** – WisdomTree NG 3× Daily Short (3× inverse, LSE)

> Short ETF trough volume spikes are the strongest and most reliable turning-point signal in this system. Statistical validation across n=166 cycles: volume spikes at short ETF price troughs at median 1.55× baseline (z=5.4). A short ETF price trough = gas price peak candidate.

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

#### Cross-Side Flow Divergence Scanner

Scans for windows (5d / 10d / 21d) where aggregate long-side capital (BOIL + HNU + 3NGL) and short-side capital (KOLD + HND + 3NGS) move in opposite directions — one side accumulating while the other distributes. Reveals institutional rotation between bull and bear positioning.

| Column | Description |
|--------|-------------|
| **TYPE** | `LONG LEADS` (longs accumulating, shorts distributing) or `SHORT LEADS` (shorts distributing, longs pulling back — bullish for gas) |
| **LONG Σ / SHORT Σ** | Aggregate net flow for each side over the window |
| **Δ SPREAD** | Capital imbalance: `LONG Σ − SHORT Σ` |
| **BREADTH** | Individual ETF agreement count (0–6). ≥4 = strong consensus. |
| **SENTIMENT** | 30-day aggregate sentiment at window end |
| **SIGNAL** | `CONFIRMED` (breadth ≥ 4 + above-median spread) or `WATCH` |
| **STR** | Strength score 0–100: spread magnitude (40%) + breadth (30%) + window (15%) + consistency (15%) |

Features summary strip (event counts, confirmed count, average strength), filterable lookback (30D / 90D / 6M / 1Y / ALL), and CSV export. Color convention follows the dashboard: `SHORT LEADS` = green (bullish for gas), `LONG LEADS` = red (bearish for gas).

#### Yearly Flow Activity Matrix

Heatmap-style table showing the count of significant flow events (|Z-Score| ≥ 1.5) per year per ETF, alongside average Z-Score magnitude. Useful for identifying which years had the most active capital flow signals.

---

### 2. Volume Monitor (`index.html`)

Multi-timeframe volume anomaly detection engine covering both **share volume** and **dollar volume** (capital flow intensity):

- **Detects volume anomalies** across 6 windows (5d/10d/21d/63d/126d/252d) using percentile ranking and Z-scores
- **Models volatility** with HV, vol regime percentiles, ATR, and VoV
- **Synthesizes signals** via the **VPS (Volume Pressure Score)** — a 5-component composite
- **Tracks historical echoes** — patterns showing price action following capitulation signals, with lead-time calibration and regime-stratified forward returns
- **Monitors capitulation** with **VCVI** (Vol-Adjusted Capitulation Volume Index)
- **Monitors dollar-flow capitulation** with **DVCVI** — same formula as VCVI but using dollar volume percentile; doubly penalised in capitulation because low price already suppresses dollar volume
- **Scores capital flow intensity** with **DV-VPS** — parallel to VPS but computed on dollar volume metrics
- **Tracks flow divergence** with **VDDS** (Volume-Dollar Divergence Score) — DV-RVOL ÷ S-RVOL per ETF and cross-ETF comparison bar
- **Detects weather spikes** via 5d fast-window VCVI + ATR sharp-spike flag
- **Gates signals** with a seasonally-adjusted NG=F price Z-score
- **Corrects for leveraged ETF decay** to prevent structural price drift contaminating percentile signals
- **Weights by season** (winter ×1.3, summer ×0.85)
- **Classifies NG=F volatility regime** (normal / elevated / extreme)

#### ETF Cards — Share / Dollar Toggle

Each card has an **`[S] [$]`** pill in the header. **S mode** (default) shows share-volume metrics; **`$` mode** swaps all three data sections in-place with dollar-volume equivalents at zero added card height.

**S mode (share volume):**

1. Price & daily change, season badge, ⚡ SPIKE badge
2. Share metrics: VOL, RVOL-21d, Z-Score, VROC-10d
3. Share volume percentile bars: 5 timeframes (10/21/63/126/252d)
4. Volatility panel: HV-10/21/63d, vol regime, ATR-14, term structure, VoV-21
5. VCVI indicators: 5d fast, 21d (with decay-corrected †value), 63d
6. VPS composite score + MWCA alarm
7. $ VOL TRADED footer

**`$` mode (dollar volume):**

1. Price & daily change, season badge, ⚡ SPIKE badge (unchanged)
2. Dollar metrics: $ VOL, DV-RVOL-21d, DV-Z, DV-VROC-10d
3. Dollar volume percentile bars: 5 timeframes (10/21/63/126/252d)
4. Volatility panel (unchanged — regime context is the same for both modes)
5. DVCVI indicators: 5d, 21d, 63d
6. DV-VPS composite score + VDDS ratio
7. $ VOL TRADED footer

> Toggle state is preserved across data refreshes and live price overlays — switching to `$` mode persists until the user switches back.

#### Top-of-Page Convergence Flash Banner

When all 3 ETFs on either side spike within a 10-calendar-day window (SWVC `CONVERGED` state), a full-width pulsing banner appears **immediately below the header** — visible without scrolling:

- **RED** (short-side convergence): `⚡ SHORT SIDE CONVERGED — ↓ SHORT / INVERSE SETUP — gas TOP candidate`
- **GREEN** (long-side convergence): `⚡ LONG SIDE CONVERGED — ↑ LONG / LEVERAGED SETUP — gas BOTTOM candidate`

Each banner shows the individual ETF spike dates, days-ago, and RVOL levels inline. Hidden entirely when no convergence is active — zero noise on normal days.

#### Signal Column Layout (top to bottom)

Panels are ordered by signal priority:

1. **VDDS Bar** — per-ETF volume-dollar divergence (DV-RVOL ÷ S-RVOL), always visible
2. **NG=F Price Context Bar** — seasonal Z-score gate (always visible)
3. **Conviction Events** — strictest filter, shown first as the primary actionable signal
4. **Elevated Watch** — softer pre-conviction filter
5. **Active Alerts** — real-time feed (VCVI, MWCA, RVOL only — see below)
6. **Stress Matrix** — per-pair IPSI, vol regime, status
7. **Side-Wide Convergence (SWVC)** — cross-market tri-ETF spike tracker
8. **Historical Echoes** — base-rate forward returns for past VCVI signals
9. **Volume Heat Calendar** — 90-day volume heatmap
10. **Multi-Window Convergence** — gauges across all 6 timeframes

#### Active Alerts

The alert feed fires on three signals only — all directly test the trough/peak volume spike hypothesis:

| Alert | Trigger |
|-------|---------|
| **VCVI** | VCVI-21d ≥ 55 (watch) / 72 (critical) / 88 (extreme) |
| **MWCA** | Volume ≥ 90th pct across **all 6 windows simultaneously** |
| **RVOL** | 21d relative volume ≥ 1.5× (elevated) up to ≥ 5.0× (extreme) |

CVI, VPS, ATR breakout, VoV-21, and vol-regime warnings are computed and visible on ETF cards but do not fire alerts — they were removed from the alert feed to reduce noise.

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

**Conviction Events (5-gate filter + advisory annotation, ~1–2/ETF/year):**

| Gate | Condition |
|------|-----------|
| 1 — Volume Capitulation | VCVI-21d ≥ 72 (or Extreme Override) |
| 2 — Multi-Window Breadth | ≥ 3 of 5 windows ≥ 85th pct |
| 3 — Price Dislocation | \|Daily move\| > 1.5× ATR-14 |
| 4 — Regime Context | Vol regime ≤ 70th percentile |
| 5 — NG Directional | Long: z ≤ −0.5σ · Short: z ≥ +0.2σ |
| Gate 6 — VDDS Advisory | Non-blocking: VDDS at event date annotated on each conviction event for context (can be tightened to a hard gate after validation) |

**Elevated Watch (3-gate, ~4–8/ETF/year):** softer thresholds (VCVI ≥ 60, 2/75 breadth, 1.2× ATR), no vol-regime constraint.

**Side-Wide Volume Convergence (SWVC):** scans the last 15 trading days for each of the 3 ETFs on a side. If all 3 hit RVOL ≥ 2× within any rolling 10-calendar-day window — even on different days — the side is marked `CONVERGED`. Spikes staggered 2–5 days apart across US/CA/UK exchanges fully qualify. Status ladder: `CONVERGED` → `PARTIAL` (2–3 ETFs, or all 3 outside window) → `SINGLE` → `QUIET`. When converged, the top-of-page flash banner fires automatically.

**Historical Echoes:** forward return study (5/10/21/42/63/126/252d windows) for all past VCVI ≥ 55 signals, with median lead-time to peak, season tags, regime-stratified return tables.

---

### 3. Trough-to-Peak Analyzer + Vol Regime Monitor (`trough-peak.html`)

Professional-grade recovery cycle identification:

- **Parameterized ZigZag** — Adjustable % rally threshold (0–300%) to confirm trough-to-peak moves
- **Institutional Micro-Analytics:** Cyc/Regime (maturity tagging), Stretch Index (60-day Z-score), 1M/3M/6M percentile ranks, and range compression
- **Wait-Time Analysis (GAP)** — Idle days between cycles (peak to next trough)
- **Enhanced KPI Summary Grid** — Mean and **Median** Gain (robust vs outliers), Avg Days, and Avg Gap across all 6 ETFs
- **Price & Cycle Map** — High-performance interactive canvas with **ImageData caching** for 0-latency hover, crosshair, click-drag measurement, quick-range buttons, and dual-brush slider
- **Visual Turn Identification:** Volume bars are color-accented (Red = Trough, Green = Peak) to highlight high-conviction turning points
- **Cycle Detail Table:** Filterable history with **Summary Footer row** (aggregate count, avg/med gain, avg duration) and CSV export
- **Yearly Opportunity Matrix:** Heatmap of cycle count and avg gain per year per ETF with side-aware color coding (3NGS corrected to Red)

#### Vol Regime Monitor

Embedded below the Price & Cycle Map. Displays full-lifetime historical volatility for all 6 ETFs and NG=F:

**Selector modes:**
- **1-UP** — One instrument at a time (7 chips: NG=F, BOIL, HNU, 3NGL, KOLD, HND, 3NGS)
- **PAIR** — Long vs short side-by-side with 21D ΔHV spread (BOIL↔KOLD, HNU↔HND, 3NGL↔3NGS)

**HV Stat Boxes (per instrument):**

| Window | Purpose |
|--------|---------|
| **5D HV** | Ultra-short spike detector — catches weather events before 21D registers |
| **21D HV** | Monthly baseline — primary regime signal, standard for ETF sizing |
| **63D HV** | Seasonal-quarter — aligns with NG injection/withdrawal cycles |
| **252D HV** | Annual baseline — full NG seasonal cycle reference |

Each box shows the annualised HV %, its percentile vs full available history, and a colour-coded regime pip.

**Chart features (matching Price & Cycle Map):**
- Interactive multi-selection: Toggle any combination of 5D, 21D, 63D, and 252D HV series to view them overlaid
- Full-lifetime HV line charts (3,300–4,500+ sessions depending on ETF) dynamically color-segmented by their respective regime percentiles
- Background regime zones (Low / Normal / Elevated / Spike)
- Area-fill gradient under the primary selected line
- 5-level evenly-spaced Y-axis grid with left-side HV% labels
- Right-side percentile threshold labels (p25 / p75 / p90)
- X-axis date labels — adaptive to zoom: daily (≤14 bars), weekly (≤35), biweekly (≤65), monthly, or yearly-boundary mode
- Vertical grid lines from every x-axis tick
- **Crosshair + hover tooltip** — vertical dashed line, dot on line, floating card with date / HV-21 / daily change
- **Click-drag measurement tool** — tinted band + card showing HV Δ and date range
- **Horizon quick-range buttons** (1W / 1M / 3M / 6M / 1Y / ALL)
- **Dual range-slider brush** — label shows actual start–end date strings
- Current-value pulse dot (when viewing latest data)

**Footer stats (per card):**
- **TERM STRUCT** — 5D/63D HV ratio; flags when near-term vol is accelerating (>1.35×)
- **VoV-21** — Vol-of-vol (std of rolling HV-10 over 21 days); STABLE / MODERATE / SHIFTING / UNSTABLE
- **EFF VOL N×** — HV-21 × leverage multiplier; realistic annual swing band

**Regime classification:**

| Label | Percentile | Colour |
|-------|-----------|--------|
| LOW | < 25th | Blue |
| NORMAL | 25–75th | Green |
| ELEVATED | 75–90th | Orange |
| SPIKE | ≥ 90th | Red |

Percentiles computed against the full available history for each instrument.

### 4. Volatility Intelligence (`cvol.html`)

An institutional-grade volatility research terminal and decision-support system. This dashboard decomposes the natural gas options surface (via CME NGVL proxy) into actionable signals using ensemble confluence, regime-conditional backtesting, and realized-vs-implied divergence modeling.

#### Regime Dashboard (Decision Synthesis)

A central "at-a-glance" panel that aggregates all volatility surface dimensions into a single actionable assessment:

| Dimension | Description |
|-----------|-------------|
| **NGVL REGIME** | Current 252D percentile ranking (Low / Normal / High / Extreme). |
| **VOL TREND** | 5-day Rate of Change (ROC) in NGVL; identifies expansion/contraction. |
| **SKEW BIAS** | Directional pressure gauge (Bullish / Bearish / Neutral). |
| **VRP STATE** | Vol Risk Premium assessment (Overpriced Fear / Underpriced Risk). |
| **TERM STRUCT** | 5D/63D NGVL ratio; identifies Backwardation (Stress) vs Contango (Normal). |
| **VOL STABILITY** | VoV-21 metric; determines if current signals are reliable or prone to whipsaw. |
| **SIGNALS/SEASON** | Count of active signals in last 10 sessions + current seasonal context. |
| **CONVICTION** | Weighted synthesis of the above 6 inputs (High / Moderate / Low) with **prescriptive tactical reads** (actionable one-line directives). |

#### Proprietary Composite Signals

A multi-factor predictive array that identifies structural shifts in the options surface:

| Signal | Full Name | Logic / Alpha Source |
|--------|-----------|---------------------|
| **SAD** | **Skew-ATM Divergence** | Flags stealth repositioning where skew (tail-risk) diverges from ATM (linear) volatility. |
| **CI** | **Complacency Index** | A "Fragile Calm" warning; identifies periods of underpriced tail-risk in trending markets. |
| **CVC↓** | **Convexity-Var DOWN** | High-conviction **TOP** formation signal; flags when convexity-adjusted volatility implies exhaustive demand. |
| **CVC↑** | **Convexity-Var UP** | High-conviction **BOTTOM** formation signal; identifies "Volatility Capitulation" where convexity turns positive. |
| **RDS** | **Regime Divergence Score** | An explosive setup signal; flags when 5D/21D/252D volatility regimes are in extreme conflict. |

#### Realized vs Implied Volatility Divergence (The "Crown Jewel")

Measures the **Vol Risk Premium (VRP)** to identify market mispricing:
- **Realized Volatility (21D)** — Annualized standard deviation of actual NG price returns.
- **VRP Area Fill** — The main NGVL chart features a dynamic spread area (Green for Implied > Realized, Red for reversed).
- **VRP Z-Score** — Identifies statistically significant divergence windows where options are anomalously expensive or cheap.

#### Backtest Scorecard & Tactical Framework

Every signal is subjected to rigorous institutional-grade validation:
- **Multi-Horizon Performance Analysis** — Tracks hit rates and annualized Sharpe across 5D, 10D, 21D, and 42D windows side-by-side.
- **Optimal Horizon (OPT HZ)** — Automatically identifies the specific forward-return window where each signal historically has the highest risk-adjusted edge.
- **Low-Sample Warnings** — Signals with fewer than 20 validated events are flagged with an amber `⚠ LOW SAMPLE` badge to prevent over-reliance on statistically noisy readings.
- **Regime-Conditional Backtesting** — Filter results by NGVL regime to identify which signals perform best in complacent vs trending markets.
- **Statistical Significance Badges** — Binomial p-values (★★★ / ★★ / ★) test the null hypothesis (50% hit rate).
- **Ensemble Confluence Rows** — Metrics for **CONF ≥2** and **CONF ≥3** clusters.
- **Seasonality Bias** — Per-signal seasonal hit rates (❄️🌱☀️🍂) identify structural tailwinds.

#### Cross-Signal Framework (Integration Matrix)

A strategic reference panel that explains how to use CVOL conviction as a multiplier for other dashboards:
- **CVOL + T2P** — How vol surface extremes align with Trough-to-Peak cycle maturity.
- **CVOL + Volume** — Using Volume Monitor conviction events as a trade trigger once CVOL reaches a high-conviction regime.
- **Action Hierarchies** — Categorizes setups from `MAXIMUM CONVICTION` to `CONFLICTED`.

#### Threshold Sensitivity Analysis

A collapsible diagnostic panel for every signal that compares performance across three calibration levels:
- **TIGHTER** — Higher barrier for firing; higher quality but fewer events.
- **BASELINE** — Current institutional settings.
- **LOOSER** — Lower barrier; identifies if the signal is "near-miss" or if quality degrades rapidly with higher frequency.

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

**Share-volume metrics:**

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

**Dollar-volume metrics ($ mode):**

| Metric | Description |
|--------|-------------|
| **DV-RVOL** | `dollar_volume ÷ N-day rolling avg dollar_volume`; split-agnostic capital flow intensity |
| **DV-ZScore** | Std deviations of dollar volume from rolling mean |
| **DV-Percentile** | Rank of dollar volume vs own rolling history |
| **DV-VROC** | Dollar volume rate of change |
| **DVCVI** | `dv_percentile × (1 − price_pct/100)`; doubly penalised in capitulation because low price already suppresses dollar volume |
| **DV-VPS** | Parallel VPS composite computed on dollar-volume metrics (same weights as VPS) |
| **VDDS** | Volume-Dollar Divergence Score: `DV-RVOL-21d ÷ S-RVOL-21d`; `< 1` = share vol outpacing dollar vol (capitulation); `> 1` = dollar vol outpacing share vol (momentum/accumulation) |

### Leveraged ETF Decay Correction

| ETF Type | Approx. Decay |
|----------|--------------|
| 2× long/short (BOIL, KOLD, HNU.TO, HND.TO) | ~35–40%/yr |
| 3× long/short (3NGL.L, 3NGS.L) | ~55%/yr |

Adjusted price: `adj_price[t] = raw_price[t] × (1 + decay/252)^t`

### Volatility Intelligence Metrics (`cvol.js`)

| Metric | Formula / Description |
|--------|-----------------------|
| **Realized Vol (21D)** | `std(log_returns) × sqrt(252)` over a rolling 21-day window. Annualized baseline for price movement. |
| **VRP (Vol Risk Premium)** | `NGVL − Realized_Vol_21D`. Positive = Implied vol is richer than realized price action (Overpriced fear). |
| **VRP Z-Score** | `(VRP − 21d_mean_VRP) / 21d_std_VRP`. Identifies statistically extreme divergence events. |
| **VoV-21 (Vol-of-Vol)** | `std(NGVL) / 21` or rolling standard deviation of the NGVL index. Measures volatility regime stability. |
| **Term Struct Proxy** | `5D_NGVL_EMA / 63D_NGVL_EMA`. `> 1.03` = Short-term vol spiking relative to baseline (Backwardation/Stress). |
| **Binomial p-value** | `P(X ≥ hits)` where `X ~ Binomial(total, 0.5)`. Tests if signal hit rate is significantly better than a coin flip. |
| **Confluence Score** | Count of distinct proprietary signals (SAD, CI, CVC, RDS) firing within a `[t-5, t+5]` session window. |

---

## Architecture

### Frontend
```
docs/
├── index.html           # Volume Monitor dashboard
├── flows.html           # Flow Monitor (capital flow analytics)
├── trough-peak.html     # Trough-to-Peak analyzer
├── cvol.html            # Volatility Intelligence (CVOL) dashboard
├── css/
│   ├── styles.css       # Shared global theme, grid, tooltips
│   ├── cards.css        # ETF card styling
│   └── signals.css      # Volume Signal panels
└── js/
    ├── app.js           # App controller, data loading, live overlay, auto-refresh
    ├── data.js          # Yahoo Finance fetch layer (3-proxy CORS chain, parser)
    ├── cvol-ui.js       # Volatility Intelligence UI, Scorecard & Backtester
    ├── cvol-render.js   # Volatility Intelligence canvas rendering engine
    ├── cvol.js          # Volatility Surface & Composite Signal computation
    ├── cards.js         # Card rendering (decay-adj VCVI, season badge, spike)
    ├── charts.js        # Canvas charts (sparklines, forward return, trough-to-peak)
    ├── signals.js       # Volume Signal logic (MWCA, SWVC, echoes)
    ├── metrics.js       # Volatility & percentile calcs (HV, VoV, term structure)
    ├── vol-regime.js    # Vol Regime Monitor (HV/Trough-Peak chart logic)
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

The dashboard uses a two-layer data architecture: a pre-computed pipeline layer for deep metrics, overlaid with a live browser-side price fetch for real-time accuracy.

**Layer 1 — Pre-computed pipeline (GitHub Actions, every 15 min during market hours + daily at 21:00 UTC):**

*Volume pipeline:*
1. Fetch full-lifetime OHLCV for 6 ETFs + NG=F via Yahoo Finance (3,300–4,500+ sessions per ETF, back to 2008–2012 depending on listing date)
2. Compute NG=F context: seasonal Z-score, HV percentile, regime series
3. Compute per-ETF: volume metrics (6 windows), volatility, CVI/VCVI, VPS, decay-adj
4. Compute per-ETF dollar-volume metrics: DV-RVOL, DV-ZScore, DV-Percentile, DV-VROC, DVCVI, DV-VPS, and VDDS series (DV-RVOL-21d ÷ S-RVOL-21d per bar)
5. Detect conviction events (5-gate + extreme override + momentum guard); annotate each event with VDDS value at that date (Gate 6 advisory)
6. Detect elevated watch events (3-gate)
7. Generate historical echoes with regime-stratified forward return tables
8. Deduplicate bars by calendar date (Yahoo v8 occasionally returns two rows for the same date with different volumes — keep the last/most-updated row only)
9. Write `dashboard_data.json` + `latest_signals.json` → sync to `docs/data/`

> Full-lifetime history is stored (not capped at 252 days) so the Vol Regime Monitor can render complete HV sparklines from each ETF's inception date, and percentile rankings are computed against the full available record.

*Flow pipeline:*
1. Fetch daily AUM snapshots for all 6 ETFs from TrackInsight
2. Parse USD flow, NAV, and daily performance from snapshot fields
3. Compute cumulative flow, 30-day rolling Z-Score, 5D/20D momentum
4. Classify regime per day (Accumulation / Distribution / Balanced)
5. Compute pressure score (Z + momentum + streak bonus, clamped ±100)
6. Aggregate cross-ETF sentiment (bull vs bear 30d net flows, BULLISH/BEARISH/NEUTRAL)
7. Write per-ticker JSON + summary JSON → sync to `docs/data/flows/`

**Layer 2 — Live browser-side overlay (Volume Monitor only):**

After the pre-computed JSON renders, `app.js` immediately fires a background fetch to Yahoo Finance for real-time prices and intraday change%:

1. Fetch 2-year daily OHLCV for all 6 ETFs via Yahoo Finance v8 chart API
2. Route through a 3-proxy CORS chain: `allorigins.win` → `corsproxy.io` → `api.codetabs.com` — each proxy is tried in sequence until one succeeds
3. Derive daily change% per-ETF using that ETF's own exchange market state (not a global flag — London ETFs being open must not affect NYSE/TSX logic)
4. Always strip Yahoo's preliminary today-bar (Yahoo pre-populates it with the previous session's close even before trading starts, which would make bars[-1] = bars[-2] and yield 0% change). After stripping: compare `livePrice` vs confirmed previous session when market is open; confirmed previous session vs the one before when closed
5. Update intraday volume only when the ETF's own market is open (preliminary bars carry yesterday's volume, not today's)
6. Overlay live price, corrected change%, and intraday volume onto all rendered cards, then re-render
7. If all 3 proxies fail, retry automatically after 10 seconds
8. Auto-refresh repeats every **60 seconds** while market is open, **5 minutes** when closed

**Initial render resilience:** `processPrecomputed()` also deduplicates the JSON history by date (Yahoo occasionally returns two rows for the same calendar day with different volumes — identical closes produce 0% change). For TSX tickers (HNU.TO / HND.TO) where Yahoo omits `regularMarketPrice` / `regularMarketVolume` from the meta outside trading hours, the pipeline and JS both fall back to the last confirmed history bar's close and volume.

The header timestamp shows the pipeline JSON age. If the pipeline data is more than 2 hours old (e.g. GitHub Actions stalled), the label turns amber and displays the exact age: `STALE (3h 12m ago)`.

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
- **Deployment:** GitHub Pages (`docs/`) + GitHub Actions (pipeline every 15 min; Pages redeploys automatically via `workflow_run` trigger after each data push)
- **No frameworks** — lightweight, fast, single-page load

---

## License

MIT — Free for personal and commercial use.

---

**Questions?** Hover any metric label on the dashboard for detailed explanations — all three pages are self-documenting via tooltips.
