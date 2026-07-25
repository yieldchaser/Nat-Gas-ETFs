# Blue Meridian

A real-time dashboard for tracking volume flow and price-volume dynamics across natural gas ETFs. Combines daily pipeline data from Yahoo Finance and TrackInsight with a multi-timeframe volatility engine to surface statistically significant volume and capital flow events.

**Live Dashboard:** [https://yieldchaser.github.io/Nat-Gas-ETFs/](https://yieldchaser.github.io/Nat-Gas-ETFs/)

---

## Overview

This project implements five interconnected analytical engines:

1. **Volume Monitor** (`index.html`) — Multi-timeframe volume anomaly detection, volatility modeling, and conviction event filtering across 6 leveraged ETFs.
2. **Flow Monitor** (`flows.html`) — Daily capital flow tracking (AUM in/out), Z-Score history, pressure scoring, divergence detection, and cross-ETF comparison.
3. **Trough-to-Peak Analyzer** (`trough-peak.html`) — Institutional-grade ZigZag recovery cycle identification with robust median metrics and 60-day statistical stability.
4. **Volatility Intelligence** (`cvol.html`) — Regime-first CME NGVL options-surface intelligence. Reads aggregate implied vol (NGVL/ATM), variance wings (UpVar/DnVar), skew ratio, convexity, realized vs implied (VRP), and classifies an options-surface state machine. Raw inputs (SAD/CI/CVC/RDS) are retained as research layers, not direct buy/sell calls.
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

## Outlier Spotlight (PEAKS Mode)

To cut through visual noise during periods of extreme volatility or congestion, all heatmaps and activity matrices across the dashboards support **PEAKS Mode** (Outlier Spotlight). When toggled:
- **Lights Off (Dimming):** Non-outlying days, months, or years are dimmed to near-black (`opacity: 0.15` or `#0b0b14`), making normal conditions recede into the background.
- **Spotlight Glow:** Key statistical outliers are highlighted with harmonized glowing borders, vibrant backdrops, and interactive entry animations:
  - **Notable Peaks (P90):** Amber/gold glow.
  - **Significant Peaks (P95):** Orange/copper glow.
  - **Extreme Peaks (P99):** Red/crimson intense glow.
- **Outlier Counter Badge:** Displays the exact count of outliers currently spotlighted in the view window.

### Lookback Window & Percentile Methodologies

To ensure mathematical consistency and maximum usefulness for market analysis, each heatmap uses a lookback window tailored to the statistical properties of its underlying metric:

| Heatmap | Primary Metric | Statistical Property | Lookback Window | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Volume Heat Map** (`index.html`) | **Capitulation Volume Index (CVI / DVCVI)** | **Stationary** (bounded product of rolling 21d volume & price ranks) | **Global Historical** (Full 5+ Year History) | Since CVI is already locally normalized, its scale is stationary across years. Using a global baseline prevents "false alarms" (highlighting normal days in quiet years) and ensures a CVI score has the same visual intensity across different years. |
| **Flow Activity Heat Map** (`flows.html`) | **Composite Flow Z-Score** | **Stationary** (rolling 30d mean/std dev standardized flow average) | **Global Historical** (Full 5+ Year History) | Z-scores have a stable, stationary probability distribution. Using global absolute thresholds (e.g., p95 $\approx 1.5 - 2.0\sigma$) ensures that only historically extreme capital movements are highlighted, maintaining consistent visual scale across the timeline. |
| **CVOL Signal Activity Heatmap** (`cvol.html`) | **Implied Volatility (NGVL)** | **Non-Stationary** (raw index value; regime-dependent with long-term drift) | **Rolling 252-Day** (Trailing 1 Year) | Implied volatility shifts structural regimes (e.g., quiet years at 30% vs energy crisis spikes at 120%). Comparing raw vol globally would drown out all spikes in normal years. A rolling 1-year window evaluates volatility expansion relative to the current market environment. |
| **CVOL Monthly Regime Heatmap** (`cvol.html`) | **Monthly Average NGVL** | **Stationary Grouping** (aggregated monthly averages) | **Global Historical** (All months in history) | Ranks the average NGVL of each month against the distribution of all historical months, highlighting the top 10% highest-volatility months on record to reveal seasonal macro-regimes. |

#### Detailed Lookback Rationale

1. **Global Historical Window (Volume & Flow)**
   - **Lookahead Bias vs. Comparability:** While global lookbacks technically incorporate future data, they are the mathematically correct choice for rendering historical timelines. If we used rolling or visible lookbacks for stationary metrics like CVI or Z-scores, the thresholds would constantly shift. In a low-flow period, a minor noise day would be flagged as an "extreme outlier" (false positive), whereas in a high-activity period, a massive capitulation spike would be ignored because it was preceded by other spikes (false negative).
   - **Double-Normalization:** Metrics like CVI and Z-scores are already locally normalized (rolling 21-day and 30-day windows). Applying another rolling normalization layer on top introduces mathematical redundancy and distorting noise.

2. **Rolling Historical Window (Implied Volatility)**
   - **Regime Shifts:** Natural Gas Implied Volatility (NGVL) is highly non-stationary. If evaluated globally, the extreme peaks of the 2022 energy crisis (NGVL > 120%) would set the baseline so high that no volatility expansion in 2024, 2025, or 2026 would ever trigger a highlight.
   - **Option Trading Standard:** Options traders evaluate volatility rank (IV Rank or IV Percentile) relative to a trailing 1-year (252 trading days) window. This tells the trader: *"Is volatility high or low relative to options priced over the last year?"* This is the exact context needed to judge if option premiums are cheap or expensive today.

PEAKS Mode is supported on:
1. **Volume Heat Map (Days 1–90)** (`index.html`): Filterable by P90, P95, or P99 thresholds. Uses global historical percentiles computed over all active daily maximum ETF CVIs.
2. **CVOL Signal Activity Heatmap** (`cvol.html`): Filterable by P90, P95, or P99 thresholds. Uses trailing 252-day rolling percentiles to identify volatility outliers.
3. **Regime Heatmap (Monthly NGVL)** (`cvol.html`): Spotlight threshold fixed at P90 (top 10% of monthly average NGVL values in global history).
4. **Yearly Flow Activity Matrix** (`flows.html`): Filterable by P90, P95, or P99 thresholds. Uses global historical percentiles of absolute composite flow Z-scores.

---

## Dashboard Pages

## CVOL: Reproducible Audit

The CVOL tab includes a small read-only audit script so you don’t have to trust visuals:

- Run surface audit: `node tools/cvol_surface_audit.mjs`
- Run CVOL tests: `node test_cvol.js`

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
#### Flow Acceleration & Exhaustion Engine (`chartFlowVelocity`)

An institutional momentum early-warning system that tracks 1-day velocity Z-scores ($Z_{\text{vel}, 1d}$) and 3-day smoothed velocity Z-scores ($Z_{\text{vel}, 3d}$) of composite ETF capital flows.

- **1D Velocity Bars (Green/Red)**: Daily standardized acceleration of composite flow Z-score ($Z_{\text{vel}, 1d}$). Spikes above $+2.0\sigma$ flag aggressive long-side inflow surges; spikes below $-2.0\sigma$ flag short-side breakdown acceleration.
- **3D Velocity Z Line (Cyan)**: 3-day smoothed rate of change ($Z_{\text{vel}, 3d}$) tracking directional institutional capital momentum.
- **Amber Exhaustion Zones (30–60 Day Lead Warning)**: Highlights windows where Natural Gas prices push to 30-day highs while 3-day flow velocity turns negative ($Z_{\text{vel}, 3d} < 0\sigma$). Indicates smart-money buyer depletion **30 to 60 days BEFORE price tops** (Empirical Backtest: +8.92% avg 20-day `KOLD` return, Profit Factor: 1.82).
- **Bull Launch Impulses (1–5 Day Early Trough Warning)**: Spikes in long velocity ($Z_{\text{vel}, 1d} \ge +2.0\sigma$) near 30-day price lows flag institutional accumulation **1 to 5 days BEFORE or ON price troughs** (Empirical Backtest: +104.80% avg 20-day `BOIL` return, Profit Factor: 13.09, 57.1% lead-time hit rate).

#### Flow-Price Divergence Signal Chart

**Composite Z-Score vs. Natural Gas Price** — An interactive dual-axis canvas chart showing when cross-ETF aggregate flows move *opposite* to recent NG price direction (contrarian flows = potential predictive signal).

**Left Y-Axis (Divergence Intensity):**
- **GREEN bars (above zero):** Bullish-contrarian flow — composite Z-score is positive (net long-side accumulation) *while* NG=F fell over the prior 5 trading sessions. Signals smart-money buying against weakness.
- **RED bars (below zero):** Bearish-contrarian flow — composite Z-score is negative (net short-side accumulation) *while* NG=F rose over the prior 5 sessions. Signals smart-money selling into strength.
- **FLAT (zero bars):** Reactive flows — composite Z aligns with the 5-day NG move. No signal (flows are following price, not opposing it).
- **Bar height:** Magnitude of composite Z-score (±0 to ±3σ). Taller bars = stronger divergence intensity = higher conviction contrarian positioning.

**Right Y-Axis (NG Price Context):**
- **Cyan line:** NYMEX Henry Hub NG=F spot price ($/MMBtu). Provides price context for interpreting the divergence bars.

**Reference Zones:**
- **Green shaded band:** ±1.5σ zone (moderate to strong bullish divergence threshold)
- **Red shaded band:** ±1.5σ zone (moderate to strong bearish divergence threshold)
- **Zero line (dashed white):** Marks the boundary between reactive (no bar) and divergent flows

**Audit Finding:**
The underlying audit of 2,500+ trading days revealed that **95% of flows are reactive** (follow price with a 3–5 day lag; r ≈ −0.30, p < 0.001). This chart *filters out the reactive 95%* and surfaces only the rare contrarian 5%, which showed marginally better 21-day forward accuracy. The chart is intentionally sparse — when bars appear, they warrant attention.

**Interactive Features:**
- **Time range tabs:** 1M / 3M / 6M / 1Y / 2Y / 3Y / 5Y / ALL
- **Independent zoom range slider:** Zoom the divergence chart independently from other panels
- **Hover crosshair & tooltip:** 
  - Divergence value (σ) and direction (BULLISH/BEARISH DIVERGENCE or REACTIVE)
  - Underlying composite Z-score
  - NG 5-day return (%)
  - NG=F spot price ($)
- **Scroll-wheel zoom:** Zoom in/out while hovering over the chart

**Why This Matters:**
Divergence bars represent moments when institutional flows moved *counter* to the crowd. Historical analysis shows these setups have modest but measurable 21-day forward edge, especially when bars exceed 1.5σ intensity.

---

#### Flow Reactivity Intensity (Mean-Reversion Signal)

**Opposite of Divergence: Momentum Chasing as a Mean-Reversion Setup** — A companion chart showing when cross-ETF aggregate flows are *most reactive* (aligned with recent NG price direction). Intended to identify crowded momentum trades that often reverse on longer horizons.

**Y-Axis (Reactivity Intensity):**
- **Gray bars:** Flow reactivity magnitude — appears only when composite Z-score *aligns* with the 5-day NG move (opposite of the divergence chart). Bar height = |Z-score| magnitude at that moment.
- **Zero bars:** Contrarian flows (see Divergence Signal chart above). No reactivity bar drawn.
- **Bar color:** Neutral gray (no directional signal). This is a *strength metric*, not a trade direction.

**What Reactivity Means:**
- Flows are momentum-chasing — crowds accumulating/distributing in the same direction as recent price action
- High reactivity intensity = crowds are acting on recent momentum with high confidence
- Mean-reversion principle: Crowded momentum often reverses at 21-day horizons when extremes are reached

**Reference Zones:**
- **Shaded band at ±1.5σ:** Highlights the range where reactivity is strongest (moderate to extreme momentum chasing)
- **Zero line:** Separates reactive bars from contrarian flows

**Audit Finding:**
The underlying audit showed that:
- Short-term (1–5d) directional accuracy was near-random (hit rate ≈ 50%) regardless of flow direction
- However, *magnitude* of flows (|Z-score|) correlated with subsequent move *size*: when 3NGL/3NGS flows were extreme, the reversals — when they came — were larger
- At 21-day horizons, extreme reactivity + mean-reversion setup often produced the largest reversals
- This chart surfaces those high-magnitude reactive moments as potential reversal confidence signals

**Interactive Features:**
- **Time range tabs:** 1M / 3M / 6M / 1Y / 2Y / 3Y / 5Y / ALL
- **Independent zoom range slider:** Zoom independently from other panels
- **Hover crosshair & tooltip:**
  - Reactivity magnitude (σ) and intensity level (MODERATE MOMENTUM / EXTREME MOMENTUM / NO REACTIVITY)
  - Underlying composite Z-score
  - NG 5-day return (%)
  - Mean-reversion setup confidence note
- **Scroll-wheel zoom:** Zoom in/out while hovering

**How to Use:**
1. Look for **tall gray bars** (high reactivity, |Z| > 1.5σ)
2. Check the **NG 5-day return** — confirm flows are chasing that direction
3. Cross-reference with **volatility regime** (from Vol Monitor) — mean-reversion works best when vol is elevated
4. Compare to the **Divergence Signal chart** — when reactivity is extreme and divergence is sparse, you have a momentum-driven crowd without contrarian smart money offsetting
5. **Action on 21-day horizon:** Size reversals off the intensity of reactivity, not directional confidence (which is near-random at short lags)

**Why This Works:**
Extremes in either direction (strong reactivity *or* strong contrarian divergence) can signal turning points. Reactivity-based mean-reversion is the inverse thesis: crowds are most wrong when they're most confident in recent momentum.

---

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
- **USD / % AUM Scale Modes**: Toggle between raw cumulative USD flows (absolute dollar magnitude) and % AUM flows (normalized daily flow divided by constant AUM) to compare small and large funds on equal footing.
- **ETF Toggle Chips**: Click to show/hide individual ETFs; filters by side (ALL / LONG / SHORT) quickly align active groups.
- **Dynamic Net Spread Overlay**: Toggle a dashed line and green/red shaded area showing the net capital positioning (Long side minus Short side cumulative flow) of active ETFs.
- **Regime Shift Inflections**: Marks sudden flow accelerations or decelerations (triangular markers) when the 5-day Rate of Change (ROC) deviates by $\ge 2\sigma$ from its trailing 30-day baseline.
- **Interactive Rolling Flow Correlation Sidebar**: Displays a rolling pairwise Pearson correlation heatmap of daily flows over the visible timeframe. Cells show correlation coefficients (−1 to +1) with hover tooltips and support click-to-isolate ticker flows on the main chart.
- **Pinned Date Snapshot Card**: Click any point on the chart to pin a shareable snapshot card of all active and inactive ETF flows, net spread, and L/S ratio, complete with a copy-to-clipboard summary action.
- **HTML Legend**: Displayed below the chart to prevent canvas overlap, dynamically highlighting the active ETF with a thicker path.
- **Global & Wheel Zoom**: Zoom the visible date window using the independent range slider or mouse wheel.

#### Cross-Side Flow Divergence Scanner

Scans for windows (5d / 10d / 21d) where aggregate long-side capital (BOIL + HNU + 3NGL) and short-side capital (KOLD + HND + 3NGS) move in opposite directions — one side accumulating while the other distributes. Reveals institutional rotation between bull and bear positioning.

| Column | Description |
|--------|-------------|
| **TYPE** | `LONG LEADS` (Long-side accumulation: Bullish) or `SHORT LEADS` (Short-side accumulation: Bearish) |
| **LONG Σ / SHORT Σ** | Aggregate net flow for each side over the window |
| **Δ SPREAD** | Capital imbalance: `LONG Σ − SHORT Σ` |
| **BREADTH** | Individual ETF agreement count (0–6). ≥4 = strong consensus. |
| **SENTIMENT** | 30-day aggregate sentiment at window end |
| **SIGNAL** | `CONFIRMED` (breadth ≥ 4 + above-median spread) or `WATCH` |
| **STR** | Strength score 0–100: spread magnitude (40%) + breadth (30%) + window (15%) + consistency (15%) |

Features summary strip (event counts, confirmed count, average strength), filterable lookback (30D / 90D / 6M / 1Y / ALL), and CSV export. Color convention follows the dashboard: `LONG LEADS` = green (bullish for gas), `SHORT LEADS` = red (bearish for gas).

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
- **Tracks flow divergence** with **VDDS** (Volume-Dollar Divergence Score) — DV-RVOL ÷ S-RVOL per ETF. The VDDS panel includes a **VOL / $ flip toggle** mirroring the heatmap's mode toggle:
  - **VOL mode** (default) — shows S-RVOL-21d (pure share volume relative to 21-day average) as a left-anchored bar per ETF. Color: dim=sub-normal, white=normal, blue=mild surge, yellow=notable, orange=high, red=extreme, purple=absolute extreme.
  - **$ mode** — shows the original VDDS ratio (DV-RVOL-21d ÷ S-RVOL-21d) as a centered divergence bar (green=capitulation, red=momentum).
- **Detects weather spikes** via 5d fast-window VCVI + ATR sharp-spike flag
- **Gates signals** with a **log-transformed rolling 10-year seasonal Z-score** on NG=F (corrects for right-skewed gas price distribution; raw Z-scores were non-triggerable at low prices due to 2022 spike inflating σ)
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

Panels are ordered by **signal recency and actionability** — real-time / current-state panels first, historical analysis last:

1. **NG=F Price Context Bar** — seasonal log-Z-score gate (always visible, top of center column)
2. **Active Alerts** — real-time feed (VCVI, MWCA, RVOL)
3. **Volume Heat Map (Days 1–90)** — 90-day rolling heatmap, immediately actionable at a glance
4. **Inverse Pair Stress Matrix** — per-pair IPSI, vol regime, real-time stress status
5. **VDDS Panel** — per-ETF volume bar with VOL / $ flip toggle
6. **Side-Wide Convergence (SWVC)** — cross-market tri-ETF spike tracker
7. **Multi-Window Convergence** — gauges across all 6 timeframes
8. **Conviction Events** — strictest historical filter
9. **Elevated Watch** — softer pre-conviction historical filter
10. **Historical Echoes** — base-rate forward returns for past VCVI signals

#### Active Alerts

The alert feed fires on three signals only — all directly test the trough/peak volume spike hypothesis:

| Alert | Trigger |
|-------|---------|
| **VCVI** | VCVI-21d ≥ 55 (watch) / 72 (critical) / 88 (extreme) |
| **MWCA** | Volume ≥ 90th pct across **all 6 windows simultaneously** |
| **RVOL** | 21d relative volume ≥ 1.5× (elevated) up to ≥ 5.0× (extreme) |

CVI, VPS, ATR breakout, VoV-21, and vol-regime warnings are computed and visible on ETF cards but do not fire alerts — they were removed from the alert feed to reduce noise.

#### Signal Command Center

**NG=F Price Context Bar** — Log-transformed seasonal Z-score gate:

The seasonal Z-score uses **log-prices** and a **rolling 10-year same-month lookback** rather than raw prices. This corrects for natural gas's right-skewed price distribution (2022 spike inflates the raw standard deviation, making the gate nearly unfireable at low prices). The log transformation normalises the distribution and produces calibrated, triggerable signals:

| Gate | Condition | Meaning |
|------|-----------|---------|
| **LONG ✓** | Log-seasonal z ≤ −1.5σ | Gas anomalously cheap for the month (log-scale) → long signals credible |
| **SHORT ✓** | Log-seasonal z ≥ +1.5σ | Gas anomalously expensive → short signals credible |
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
- **Leveraged ETF Cycle Tax & Compounding Calculator** — Advanced Indian LRS compounding model with interactive modal UI, dynamic tooltips, and deep-link serialization (detailed below).

#### Leveraged ETF Cycle Tax & Compounding Calculator

An institutional-grade compounding simulator that models the real-world friction of trading offshore leveraged ETFs from India under Liberalised Remittance Scheme (LRS) guidelines. 

##### ⚖️ Regulatory & Tax Context (Indian LRS Guidelines)
*   **LRS & FEMA Gray Area:** The RBI Liberalised Remittance Scheme (LRS) prohibits the use of remitted funds for margin trading, leveraged instruments, or derivatives abroad. Because daily-reset leveraged ETFs achieve leverage internally using swaps/derivatives rather than exposing the investor to margin calls, their classification remains an unsettled gray area. The worst-case FEMA consequence is typically a compounding settlement fee (capped at ₹2 Lakh under RBI 2025 guidelines) rather than prosecution.
*   **Holding Period & Tax Treatment:** Offshore unlisted foreign shares are classified as Short-Term Capital Assets if held for $<24$ months, and Long-Term Capital Assets if held for $\ge 24$ months. 
    *   **STCG:** Taxed at the investor's progressive income tax slab rate (e.g., 30% base slab + surcharge + 4% cess). Surcharges are progressive based on total taxable income: 10% ($>50$L), 15% ($>1$Cr), and 25% ($>2$Cr).
    *   **LTCG:** Taxed at a flat 12.5% rate (Budget 2024/2026), with the surcharge capped at 15%.
*   **LRS TCS:** Under LRS, outward remittances exceeding ₹7 Lakh per PAN per FY trigger a 20% Tax Collected at Source (TCS) (or 5% if for education/medical). While TCS is refundable or offsettable against regular tax liability at the end of the fiscal year, it creates a severe intraday/intrayear cash flow lockup.

##### 🔌 Platform & Cost Structures
The calculator models two distinct brokerage platform tiers and dynamically pivots between them based on portfolio growth:

| Parameter | INDmoney (Domestic Neo-Broker) | Interactive Brokers - IBKR (Direct Offshore) |
| :--- | :--- | :--- |
| **Brokerage per Side** | 0.25% ($C_{brk\_ind} = 0.0025$) | 0.05% ($C_{brk\_ibkr} = 0.0005$) |
| **FX Conversion Spread** | 0.70% ($C_{fx\_ind} = 0.0070$) | 0.40% ($C_{fx\_ibkr} = 0.0040$) |
| **Outbound Wire Fee** | ₹0 | ₹1,000 per remittance ($Wire_{ibkr}$) |
| **Execution Proxy Fee** | $0 | $2 per trade ($Proxy_{ibkr}$) |

*   **The IBKR Pivot:** Direct offshore platforms like IBKR offer significantly lower transaction fees but require manual outward wires (which carry fixed bank fees) and direct compliance overhead, making them impractical for small capital sizes. The calculator lets users specify a **Pivot Threshold (default ₹2 Crore)**. The simulation starts compounding using the high-friction INDmoney tier, and instantly switches to the low-friction IBKR tier the exact year the corpus crosses the threshold.

##### 🧮 Mathematical Model & Fee Drag
The simulation compounds the capital year-by-year, factoring in brokerage fees, exchange rate markups, and structural drift:

1.  **Net Return per Trade Swing ($R_{net}$):**
    $$R_{net} = \frac{(1 + R_{gross}) \times (1 - C_{brk})}{1 + C_{brk} + C_{fx}} - 1$$
    Where $C_{brk}$ is the brokerage percentage per side, and $C_{fx}$ is the currency markup. 
    $R_{gross}$ is the gross captured return per cycle. By default, it is:
    $$R_{gross} = \text{Historical Cycle Gain} \times \text{Capture Fraction}$$
    *The Capture Fraction (default 40%) accounts for the fact that perfect entry at absolute troughs and exit at absolute peaks is physically impossible due to signal lag and execution slippage.*
    
    *Alternatively, users can enter a **Gross Return Override** (either a single number or a comma-separated list of values like `60, 70` representing different returns for individual trade swings).*

2.  **Capital Risked / Trade ($f_{risk}$):**
    Specifies the fraction of active capital deployed in each trade (default $100\%$ or $f_{risk}=1.0$). The unrisked portion ($1 - f_{risk}$) remains in idle cash. For a swing with gross return $R_{gross}$ and transaction-adjusted net return $R_{net}$:
    *   **Net Swing Factor:** $1 + f_{risk} \times R_{net}$ (brokerage/FX markups are paid only on the risked portion).
    *   **Gross Swing Factor:** $1 + f_{risk} \times R_{gross}$ (gross gains compile only on the risked portion).

3.  **Annual Compounding with FX Drift:**
    $$Corpus_{y} = StartCorpus_{y} \times \text{Compounded Factor} \times (1 + FX_{drift})$$
    Where $FX_{drift}$ is the annual depreciation of INR against the USD (e.g., 3.0% annual tailwind). The currency gains compound into the INR corpus, making them fully taxable under capital gains rules.

##### 🔄 Compounding Frequency (Decimal Swings)
The historical average frequency of complete cycles is derived as:
$$\text{Cycles / Year} = \frac{365 \text{ days}}{\text{Average Cycle Duration (Days)} + \text{Average Waiting/Gap Days}}$$
To prevent step-function rounding errors over long horizons, **Swings / Year** is modeled as a decimal number (e.g., 2.5 swings/year). If the user enters a list of overrides $R_{gross, 1}, R_{gross, 2}, \dots, R_{gross, k}$:
*   **Auto-Syncing:** If not manually overridden, **Swings / Year** automatically synchronizes to the list length $k$.
*   **Compounding Multiplier:** The annual compounding factor is calculated as the product of all swing elements, raised to the exponent scaling for `Swings / Year`:
    $$\text{Compounded Net Factor} = \left(\prod_{j=1}^{k} (1 + f_{risk} \times R_{net, j})\right)^{\frac{SwingsPerYear}{k}}$$
    $$\text{Compounded Gross Factor} = \left(\prod_{j=1}^{k} (1 + f_{risk} \times R_{gross, j})\right)^{\frac{SwingsPerYear}{k}}$$
    Where $R_{net, j} = \text{calcNetPerf}(R_{gross, j}, \text{stack})$.
    
    If it is a single override $R_{gross}$:
    $$\text{Compounded Net Factor} = (1 + f_{risk} \times R_{net})^{SwingsPerYear}$$
    $$\text{Compounded Gross Factor} = (1 + f_{risk} \times R_{gross})^{SwingsPerYear}$$

##### ⏳ TCS Cash Drag Modeling
TCS acts as an interest-free loan to the government, temporarily draining investable capital:
*   **Start of Year 1:** The initial remittance is reduced by the TCS paid:
    $$TCS_{initial} = \max(0, Remittance - Exemption) \times TCS_{rate}$$
    The active capital starting the compounding loop is $Corpus - TCS_{initial}$.
*   **Fiscal Year Transition (Year $y$ to Year $y+1$):** At the start of Year $y+1$, the locked TCS from Year $y$ is credited/refunded back into the compounding active corpus. Concurrently, if the **USD Vault** is OFF (annual repatriation), the new TCS on the gains remitted back is computed and locked up for that year.
*   **Net Wealth:** At the end of Year $y$, the user's Net Wealth is defined as the active compounding corpus plus any currently locked TCS:
    $$NetWealth_y = ActiveCorpus_y + TCS_{locked, y}$$

##### 📈 Scenario Probability Cones
Rather than relying on static average returns, the calculator derives historical cycle gain distributions:
*   **ZigZag Distribution:** The P25 (25th percentile / Conservative), P50 (Median / Expected), and P75 (75th percentile / Optimistic) gains are computed directly from the confirmed trough-to-peak cycles.
*   **Translucent Cones:** Runs three parallel simulations (P25, P50, P75). On the *Corpus Growth* tab, it renders the Expected path as a solid cyan line, while plotting the P25 and P75 bounds as dashed lines. The region between them is filled with a translucent shadow (`rgba(80, 144, 160, 0.08)`) to represent the confidence range.
*   **Hover Interactivity:** Hovering over any year on the chart renders dots on the P25, P50, and P75 curves and displays their exact values in the floating tooltip card.

##### 📉 Tax Wedge & Drag Decomposition
On the *Gross vs Net* tab, the calculator visualizes how the wealth gets eroded over the horizon:
*   **Gross Wealth:** The theoretical wealth if the captured return compounded with zero taxes, zero brokerage fees, and zero currency markups.
*   **Net Wealth:** The actual wealth remaining after all costs and taxes are deducted.
*   **Drag Decomposition:** Renders a stacked translucent area chart decomposing:
    $$GrossWealth_y = NetWealth_y + Tax_{cumulative, y} + Cost_{cumulative, y}$$
    Where $Tax_{cumulative}$ is filled in translucent red and $Cost_{cumulative}$ is filled in translucent gold, showing the relative impact of tax vs. transaction drag over time.

##### 📊 Comparative Metrics
*   **Leakage Saved by IBKR Pivot:** Quantifies the financial advantage of pivoting platforms. It compares the terminal wealth of the active simulation (with pivot) against a simulation forced to stay on the higher-friction domestic neo-broker (INDmoney) for the entire horizon:
    $$\text{Leakage Saved} = \text{Terminal Wealth}_{\text{withPivot}} - \text{Terminal Wealth}_{\text{forcedINDmoney}}$$
*   **Unlevered Equivalent Comparison:** Plots the performance of a 1x equivalent strategy (same capture, but cycle gains divided by the leverage factor: 2× for BOIL/KOLD, 3× for 3NGL/3NGS). Since 1x ETFs do not use internal swaps, they are fully permitted under LRS (avoiding FEMA risks). This comparison allows users to judge whether the excess returns of the leveraged strategy outweigh the added regulatory risks and daily rebalancing decay.

##### 🔀 Step-by-Step Simulation Algorithm
For each year $y \in [1, Horizon]$:
1.  **Check Platform State:** Compare active corpus against `pivotINR`. Set fees to IBKR if $Corpus_{y-1} \ge \text{pivotINR}$, else INDmoney.
2.  **Calculate compounded swing factors:**
    Determine the annual multiplier factoring in capital risked fraction ($f_{risk}$) and potential swing-by-swing return lists:
    *   If using a list of overrides $R_{gross, 1}, \dots, R_{gross, k}$:
        $$\text{netMult} = \left(\prod_{j=1}^{k} (1 + f_{risk} \times R_{net, j})\right)^{\frac{swingsPerYear}{k}}$$
        $$\text{grossMult} = \left(\prod_{j=1}^{k} (1 + f_{risk} \times R_{gross, j})\right)^{\frac{swingsPerYear}{k}}$$
    *   If using a single gross return $R_{gross}$ (or data-default auto):
        $$\text{netMult} = (1 + f_{risk} \times R_{net})^{swingsPerYear}$$
        $$\text{grossMult} = (1 + f_{risk} \times R_{gross})^{swingsPerYear}$$
3.  **Compound active corpus and apply FX Drift:**
    $$Corpus_{net\_year} = Corpus_{y-1} \times \text{netMult} \times (1 + FX_{drift})$$
    $$Corpus_{gross\_year} = Corpus_{y-1} \times \text{grossMult} \times (1 + FX_{drift})$$
5.  **Compute Capital Gain for the year:**
    $$Gain_y = Corpus_{net\_year} - Corpus_{start\_of\_year}$$
6.  **Calculate Progressive Surcharges & Taxes:**
    Combine capital gain ($Gain_y$) with domestic other income ($OtherIncome$) to find the total income bracket. Compute effective tax rate ($Rate_{eff}$):
    *   **STCG (unlisted foreign shares):** Taxed at progressive slab rates (default 30% base + surcharge + 4% cess):
        *   Income $\le$ ₹50L: $30\% \times 1.00 \times 1.04 = \mathbf{31.20\%}$
        *   Income ₹50L–₹1Cr: $30\% \times 1.10 \times 1.04 = \mathbf{34.32\%}$
        *   Income ₹1Cr–₹2Cr: $30\% \times 1.15 \times 1.04 = \mathbf{35.88\%}$
        *   Income $>$ ₹2Cr: $30\% \times 1.25 \times 1.04 = \mathbf{39.00\%}$
    *   **LTCG (held $\ge 24$ months):** Flat 12.5% rate + capped 15% surcharge + 4% cess:
        *   Income $\le$ ₹2Cr: $12.5\% \times 1.00 \times 1.04 = \mathbf{13.00\%}$
        *   Income $>$ ₹2Cr: $12.5\% \times 1.15 \times 1.04 = \mathbf{14.95\%}$
    Subtract tax from corpus: $Corpus_y = Corpus_{net\_year} - (Gain_y \times Rate_{eff})$.
7.  **Apply TCS Cash Drag (If Enabled):**
    *   If **USD Vault** is OFF (annual repatriation): Calculate new TCS on year gains: $TCS_y = \max(0, Gain_y - Exemption) \times TCS_{rate}$. Reduce active corpus by $TCS_y$.
    *   Add locked TCS from prior year ($TCS_{y-1}$) back into the active compounding corpus.
8.  **Record year metrics:** Save gross wealth, net wealth, cumulative tax, and platform costs. Repeat for next year.


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
- **TREND RATIO** — Weekly-sampled RV ÷ daily-sampled RV (see below)

**Regime classification:**

| Label | Percentile | Colour |
|-------|-----------|--------|
| LOW | < 25th | Blue |
| NORMAL | 25–75th | Green |
| ELEVATED | 75–90th | Orange |
| SPIKE | ≥ 90th | Red |

Percentiles computed against the full available history for each instrument.

#### Trend Ratio (TR) Signal

**Formula:** TR = weekly-sampled RV ÷ daily-sampled RV, computed over a rolling 20-session window.

- **Weekly RV** — four non-overlapping 5-day log returns, annualised with `√(252/5)` (= 7.10×)
- **Daily RV** — 20 daily log returns, annualised with `√252` (= 15.87×)

When sustained directional moves dominate, weekly sampling captures more variance than daily sampling (TR > 1.0). When intraday noise dominates and the weekly move cancels out, TR falls below 1.0.

| TR Value | Label | Meaning |
|----------|-------|---------|
| ≥ 1.2 | TRENDING (green) | Weekly moves dominate — sustained directional regime |
| 1.0–1.2 | MIXED (neutral) | Transitional — no clear character |
| 0.8–1.0 | CHOPPY (amber) | Intraday noise dominates — chop/mean-reversion regime |
| < 0.8 | EXTREME CHOP (red) | Strong intraday noise with weekly cancellation |

**Audit findings (Welch t-test on BOIL daily data):**
- t = 3.42, p < 0.001 — TR is statistically significant
- Low TR periods (< 0.8) show **+4.1% better 21-day forward returns** vs high TR periods
- Low TR + High HV is the **worst** forward return environment for long ETFs (crash/chop zone)
- Signal classifies *regime character*, not direction — does not predict which way price moves

**Note on leveraged ETFs:** Daily rebalancing decay structurally amplifies daily-sampled noise vs weekly, so raw TR for leveraged products is typically centred near 0.9 rather than 1.0. The absolute thresholds above remain valid post correct annualisation; use TR as a relative measure.

#### Composite Regime Signal Badge

A 5-state badge displayed in the card header that combines HV percentile, Trend Ratio, and term structure:

| Badge | Trigger Condition | Interpretation |
|-------|------------------|----------------|
| ⚡ **VOL SURGE** | HV ≥ p90 AND term structure > 1.35× | Volatility spiking with near-term acceleration — highest risk/reward |
| → **TRENDING VOL** | HV ≥ p75 AND TR ≥ 1.2 | Elevated vol with sustained directional moves — trend-following environment |
| ↔ **CHOPPY VOL** | HV ≥ p75 AND TR < 1.0 | Elevated vol but intraday noise dominates — dangerous for leveraged long |
| ↗ **QUIET TREND** | HV < p25 AND TR ≥ 1.2 | Low vol with directional drift — breakout watch |
| ◎ **COILING** | HV < p25 AND TR < 1.2 | Low vol, no trend character — energy building, watch for expansion |

No badge is shown when HV is in the 25th–75th percentile range (normal regime, no strong character signal). Each badge includes a hover tooltip with a detailed plain-language explanation of current conditions.

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

#### Variance Decomposition & Inflection Radar

An advanced quantitative visualization suite breaking down the directional pressures driving volatility:

| Metric | Description |
|--------|-------------|
| **VAR SPREAD** | Net Directional Imbalance (UpVar minus DnVar). Positive = calls richer; Negative = puts richer. Z-score filters seasonal noise to isolate genuine conviction shifts. |
| **WING DIV** | Wing Divergence Index (`\|UpVarZ - DnVarZ\|`). High values signal the market is picking a side with conviction; low values indicate two-way uncertainty or complacency. |
| **TENSION** | Regime Tension Score (`ConvexityZ × \|VarSpreadZ\| × SkewAccel`). A composite pressure gauge; elevated levels (compressing the spring) precede explosive directional breakouts. |
| **SKEW ACCEL** | Skew Momentum 2nd Derivative. Detects the acceleration of the 5-day skew rate of change for early inflection detection. |
| **PRICE-SKEW** | Dislocation monitor tracking the 5-day correlation between absolute NG price and skew. Flags when volatility pricing decouples from underlying price trends. |
| **VRP-SKEW CROSS** | Critical structural warning when Implied Volatility drops severely below Realized Volatility (`VRP < -5`) while Skew is simultaneously at a statistical extreme (`\|Z\| > 0.75`). |

**Interactive Features:**
- **Inflection Radar Strip:** A 5-cell diagnostic strip at the chart base providing instant, at-a-glance reads on Skew Regime, Wing Bias, Momentum, Tension, and Price-Skew status.
- **Dynamic Tooltips:** "Advanced Diagnostics" hover panels dynamically display active signal readouts matched exactly to the chart series currently toggled on by the user, ensuring clean, modular analysis.

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

#### Signal Activity Heatmap
A dynamic 180-day visual calendar that maps the intersection of volatility regime and signal generation:
- **Regime-Colored Days** — Daily blocks color-coded by the 252D volatility percentile.
- **Signal Overlays** — Visual dots map exact days where composite signals fired.
- **Pagination Navigation** — Glassmorphism toggles allow paging between recent 90-day and historical 90-day intervals.
- **Clustering Analysis** — Instantly highlights periods of signal clustering during extreme regimes.

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
| **VDDS** | Volume-Dollar Divergence Score: `DV-RVOL-21d ÷ S-RVOL-21d`; `< 1` = share vol outpacing dollar vol (capitulation); `> 1` = dollar vol outpacing share vol (momentum/accumulation). Panel has VOL/$ toggle — VOL mode shows raw S-RVOL-21d per ETF as an intuitive surge bar. |

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
7. Set `updated` date in `all_flows_summary.json` to **the actual latest data date** (min across all tickers) — not the script run date. TrackInsight data lags 1–4 business days; using today's date would show a false "Updated: today" when data is 4 days old. `flows.html` reads this date to display the correct data cutoff.
8. Write per-ticker JSON + summary JSON → sync to `docs/data/flows/`

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

**Questions?** Hover any metric label on the dashboard for detailed explanations — all four dashboards are self-documenting via comprehensive dynamic tooltips.
