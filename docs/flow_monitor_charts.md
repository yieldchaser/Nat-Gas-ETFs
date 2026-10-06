# Flow Monitor — Charts & Components Reference

> **File:** `docs/flows.html` · **Page title:** BLUE MERIDIAN — Flow Monitor

---

## Overview

The **Flow Monitor** tab tracks daily capital inflows and outflows across all 6 leveraged Natural Gas ETFs:

| Side | Tickers | Leverage |
|------|---------|----------|
| **Long (Bull)** | BOIL, HNU, 3NGL | 2× / 3× |
| **Short (Bear)** | KOLD, HND, 3NGS | 2× / 3× |

**Color conventions used everywhere on the page:**
- 🟢 **Green** — Bullish rotation / accumulation (long-side leads)
- 🔴 **Red** — Bearish rotation / distribution (short-side leads)
- 🔵 **Cyan** — Institutional confirmation / price overlays

---

## Section 1 — Sentiment Banner (`#sentiment-banner`)

A horizontal summary bar at the very top of the page that gives an at-a-glance view of cross-ETF capital balance over the trailing 30 days.

### Sub-components

| Element | ID | Description |
|---------|----|-------------|
| **Long Side Flows** | `#sent-long` | Net 30-day capital flow into BOIL, HNU, 3NGL. Positive = smart money going bullish on Nat Gas. |
| **Short Side Flows** | `#sent-short` | Net 30-day capital flow into KOLD, HND, 3NGS. Positive = inflows (accumulation), negative = outflows (distribution). |
| **Long Progress Meter** | `#sent-bar-long` / `#sent-pct-long` | Horizontal fill bar. Width = long side's share of total absolute 30-day flow. |
| **Short Progress Meter** | `#sent-bar-short` / `#sent-pct-short` | Horizontal fill bar. Width = short side's share of total absolute 30-day flow. |
| **Status Badge** | `#sent-status` | Aggregate sentiment label (e.g., *BULLISH*, *BEARISH*, *NEUTRAL*) derived from 30-day cross-ETF balance. |

---

## Section 2 — ETF Summary Cards (`#col-long` / `#col-short`)

Two-column grid of compact per-ETF summary cards, one column for each side.

### Per-card metrics (`.flow-card`)

| Metric | Description |
|--------|-------------|
| **Ticker** | ETF symbol (BOIL, HNU, 3NGL on left; KOLD, HND, 3NGS on right). |
| **NAV** | Latest adjusted Net Asset Value price. |
| **Regime badge** | Current flow regime label (e.g., *ACCUMULATION*, *DISTRIBUTION*). |
| **Net Flow** | Total net capital flow over the selected period. |
| **Flow Z-Score** | Standardized flow intensity vs. 30-day rolling baseline. |
| **Avg/Day** | Average daily dollar flow. |
| **Streak** | Consecutive inflow or outflow days. |
| **Pressure gauge** | Bidirectional bar (`.fc-pres-bar-fill`): the composite pressure score (−100 to +100). Extends left (bearish) or right (bullish) from a center zero mark. |
| **Signal tag** | `LEADING` (cyan) or `REACTIVE` (amber) — indicates whether the ETF's flows are leading or following price. |

---

## Section 3 — Deep Dive Panel

**Title:** `DEEP DIVE`  
**Controls:** ETF selector tabs (BOIL, HNU, 3NGL, KOLD, HND, 3NGS) · Time-range buttons (1W / 1M / 3M / 6M / 1Y / 2Y / 3Y / 5Y / ALL) · Range slider brush

Shows two stacked charts for a single selected ETF.

---

### Chart A — Cumulative Flow + Price (`#chartA`)

**Canvas ID:** `chartA` · **Height:** 290 px (desktop)

| Series | Color | Axis |
|--------|-------|------|
| Split-adjusted NAV price | Cyan line | Left Y |
| Cumulative net inflow | Green area fill | Left Y (secondary) |
| Cumulative net outflow | Red area fill | Left Y (secondary) |

**Key readings:**
- **Price rising, flow falling** → Distribution (smart money selling into strength).
- **Price falling, flow rising** → Accumulation (smart money buying weakness).
- **Drag to measure** — click & drag across the canvas to compute exact % price return vs. net \$ flow accumulation between any two dates.

**Legend items:** `PRICE (ADJ)` · `CUM. FLOW (IN)` · `CUM. FLOW (OUT)`

---

### Chart B — Daily Flow Bars (`#chartB`)

**Canvas ID:** `chartB` · **Height:** 130 px (desktop)

| Bar color | Meaning |
|-----------|---------|
| Green | Net inflow day — bullish for long ETFs / bearish for short ETFs |
| Red | Net outflow day — opposite signal |

Taller bars indicate high-conviction institutional block orders.

**Legend items:** `DAILY INFLOW` · `DAILY OUTFLOW`

**Shared controls:**  
A dual-handle **Range Slider Brush** (`#range-start` / `#range-end`) below both charts zooms Chart A and Chart B simultaneously by dragging the cyan-highlighted region.

---

## Section 4 — Flow vs Price Divergence Table

**Title:** `Flow vs Price Divergence`  
**Controls:** Multi-window toggle · Lookback filter (90D / 6M / 1Y / ALL) · ETF selector chips · Download CSV

Scans for instances where price and capital flow moved in **opposite directions** over rolling windows of 5–30 trading days.

### Table columns

| Column | Description |
|--------|-------------|
| **DATE** | Exact trading session date on which the divergence window ended. |
| **WIN** | Lookback window length in trading days (5D to 30D). |
| **TYPE** | `BULLISH DIV` (price fell, flow positive → smart money accumulating) or `BEARISH DIV` (price rose, flow negative → smart money distributing). |
| **PRICE Δ** | Split-adjusted cumulative NAV price return over the window. |
| **NET FLOW** | Total net dollar capital flow accumulated during the window. |
| **AVG/DAY** | Daily average dollar flow over the window (normalises for window length). |
| **Z-SCORE** | Standardized flow intensity at window end vs. 30-day baseline. ≥±2.0σ = extreme anomaly. |
| **PRESS.** | Composite pressure score (−100 to +100): blends Z-score + momentum + streak bonus. |
| **LOCAL AVG** | Average daily flow from 3 days before window start → 3 days after window end (s−3 → e+3). Broad local context. |
| **POST-3D** | Average daily flow for 3 trading days **after** window closes (e+1 → e+3). Measures post-signal follow-through. |
| **PRE-3D** | Average daily flow for 3 trading days **before** window opens (s−3 → s−1). Reveals whether imbalance was already building. |
| **DAY FLOW** | Net capital flow on the exact end-date of the window. Isolates single-day spikes. |
| **BASE-30D** | Average daily flow over 30 trading days prior to window start. Prevailing regime benchmark. |
| **SIGNAL** | Actionable interpretation implied by the divergence pattern. |
| **STR** | Divergence strength score (0–100): blends price magnitude × flow magnitude × window length. |

**Multi-window mode:** When enabled, all matched lookback windows per date are shown; when disabled, only the first matched window per date is shown (legacy behaviour).

---

## Section 5 — Flow Z-Score History (`#chartZ`)

**Title:** `Flow Z-Score History`  
**Canvas ID:** `chartZ` · **Height:** 300 px (desktop)  
**Controls:** ETF selector chips · Time-range buttons (1W – ALL) · Independent Range Slider

Plots the **30-day rolling standardized flow Z-score** for a selected ETF over time.

| Series | Color | Description |
|--------|-------|-------------|
| Flow Z-Score | Cyan line | Daily Z-score of net capital flow vs. 30-day mean/std. |
| ±1.5σ thresholds | Dashed white lines | Signal anomaly boundaries — above +1.5σ = bullish anomaly, below −1.5σ = bearish. |

**Key readings:**
- **Spikes ≥ ±2.0σ** — statistically rare institutional accumulation or distribution events.
- **Short ETFs (KOLD, HND, 3NGS):** Positive Z = short accumulation (bearish gas signal); Negative Z = short unwinding (bullish gas signal).
- **Multi-ETF selector** — click ETF chips to isolate individual fund flow volatility.

**Legend:** `FLOW Z-SCORE` · `±1.5σ THRESHOLD`

---

## Section 6 — Cross-ETF Cumulative Flow Comparison (`#chartCross`)

**Title:** `Cross-ETF Cumulative Flow Comparison`  
**Canvas ID:** `chartCross` · **Height:** 340 px (desktop)  
**Controls:** Scale toggle (USD / % AUM) · Time-range buttons (1W – ALL) · ALL / LONG / SHORT filter · Individual ETF toggle chips · Overlay strip · Independent Range Slider

Plots **cumulative capital flows** for all 6 ETFs simultaneously on a single chart.

| Scale mode | Description |
|------------|-------------|
| **USD** | Raw cumulative dollar flows — shows absolute magnitude. |
| **% AUM** | Daily flow ÷ constant AUM, cumulated — normalises smaller ETFs for comparison. |

**ETF color coding:**
| Ticker | Color |
|--------|-------|
| BOIL | Deep gold `#F5C542` |
| HNU | Amber `#E8924A` |
| 3NGL | Copper `#C4773A` |
| KOLD | Electric blue `#4A9CF5` |
| HND | Ice cyan `#4DD4EA` |
| 3NGS | Violet-indigo `#A07AF5` |

### Overlays (`.cross-overlay-strip`)

| Overlay chip | Color | Description |
|--------------|-------|-------------|
| **NET SPREAD** | Cyan dashed | Aggregate Long minus Short cumulative flow. Positive = complex is net-long gas; Negative = net-short. |
| **INFLECTIONS** | Amber triangles | Marks sudden ≥2σ rate-of-change accelerations or decelerations — regime shift detection. Fires when 30-day rolling rate-of-change exceeds its own 30-day history by 2σ. |
| **CORRELATION** | Purple | Toggles the Rolling Flow Correlation Heatmap sidebar. |

### Correlation Heatmap Sidebar (`#corrHeatCanvas`)

Rendered as a canvas. Shows rolling **pairwise flow correlation** between all 6 ETFs over the visible window.

- **Red cells** (+1) — correlated (both ETFs flowing in the same direction simultaneously).
- **Blue cells** (−1) — anti-correlated (opposite direction, expected for BOIL vs KOLD).
- **Positive BOIL–KOLD correlation** → unusual regime — both long and short investors acting at the same time, signalling institutional hedging.
- Click a cell to isolate those two tickers on the main chart.

### Pinned Snapshot Card (`#cross-snapshot-card`)

Click anywhere on the chart to pin a date. A card appears showing per-ETF flow details for that date, with copy-to-clipboard and close buttons.

**Legend:** `LONGS` · `SHORTS` · `NET SPREAD`

---

## Section 6.1 — Cross-ETF Composite Z-Score (`#chartCompZ`)

**Title:** `Cross-ETF Composite Z-Score`  
**Canvas ID:** `chartCompZ` · **Height:** 340 px (desktop)  
**Controls:** Time-range buttons (1W – ALL) · Independent Range Slider

A **unified directional pressure oscillator**. Computed as the equal-weighted average of all 6 ETF flow Z-scores, with **short-side sign inversion** (KOLD, HND, 3NGS scores are flipped). Result: positive = upward pressure on gas; negative = downward pressure.

**Current reading indicator** (`#comp-z-current`): Large readout showing the most recent composite Z value, its label (e.g., *STRONG BULLISH PRESSURE*), and a glowing color dot.

| Series | Color/Style | Description |
|--------|-------------|-------------|
| Composite Z bars | Green (positive) / Red (negative) area | Daily composite Z-score, positive = net upward pressure. |
| Zero line | White dashed | Neutral baseline. |
| ±1.5σ thresholds | Cyan dashed | Signal zone boundaries. |

**Key readings:**
- **≥ +1.5σ (green glow zone)** — aggregate complex-wide long accumulation and short unwinding.
- **≤ −1.5σ (red glow zone)** — aggregate short accumulation and long distribution.
- **Zero-line crossings** — bullish recovery (cross above 0) or bearish breakdown (cross below 0).

**Methodology:** Equal-weighted average of 6 ETF Z-scores (30-day rolling window), with short-side sign inversion.

**Legend:** `UPWARD PRESSURE` · `DOWNWARD PRESSURE` · `ZERO LINE` · `±1.5σ THRESHOLDS`

---

## Section 6.1b-2 — Flow Acceleration & Exhaustion Engine (`#chartFlowVelocity`)

**Title:** `FLOW ACCELERATION & EXHAUSTION ENGINE`  
**Canvas ID:** `chartFlowVelocity` · **Height:** 300 px (desktop)  
**Controls:** Time-range buttons (1M – ALL) · Independent Range Slider

Measures **rate-of-change of composite ETF flows** (first derivative of flow Z-score). Flags:

1. **Long acceleration impulses** — sudden spikes in long ETF buying velocity.
2. **Short acceleration impulses** — sudden spikes in short ETF buying velocity.
3. **Flow exhaustion warnings** — price near 30-day highs while velocity Z drains (30–60 day leading warning before tops).

| Series | Color | Description |
|--------|-------|-------------|
| Long acceleration bars | Green (`rgba(61,184,122,0.8)`) | 1-day velocity Z ≥ +2.0σ — institutional accumulation impulse near price lows. |
| Short acceleration bars | Red (`rgba(239,68,68,0.8)`) | 1-day velocity Z ≤ −2.0σ — downside breakdown momentum. |
| Exhaustion zones | Amber fill (`rgba(245,158,11,0.3)`) | Buyer depletion while price is near 30-day highs — 30–60 day lead warning. |
| 3D Velocity Z line | Steel blue `#4ab8d8` | 3-day smoothed rate of change of composite Z-score. |

**Trading signals:**
- **Amber zones** → exit BOIL / prepare KOLD (30–60 days ahead of tops).
- **Green bars ≥+2σ** → buy BOIL (1–5 day early trough entry).
- **Red bars ≤−2σ** → downside breakdown momentum active.

**Legend:** `LONG ACCELERATION` · `SHORT ACCELERATION` · `EXHAUSTION ZONE` · `3D VELOCITY Z`

---

## Section 6.1b — Flow Activity Heat Map (`#flow-activity-heat`)

**Title:** `FLOW ACTIVITY HEAT MAP`  
**Container:** `#flow-heat-panel`

A calendar-style **grid of day cells** (18 columns × N rows), each cell representing one trading day. Color encodes the **daily Composite Z-score** (flow pressure).

| Cell color | Meaning |
|-----------|---------|
| Deep red | Strong bearish outflow |
| Light red | Mild bearish outflow |
| Dark background | Neutral / near-zero |
| Light green | Mild bullish inflow |
| Deep green | Strong bullish inflow |

**Opacity** scales with Z-score magnitude. Each cell shows the day-of-month number. Small dots mark divergence dates.

### Controls

| Control | Description |
|---------|-------------|
| **← / → Pagination** | Navigate in 90-day windows through history. |
| **PEAKS toggle** | Outlier spotlight mode: dims all non-extreme cells. Compares absolute Z-scores to global historical percentiles. |
| **p90 / p95 / p99** | Threshold for PEAKS mode — 90th, 95th, or 99th percentile of the full 5+ year history. |
| **DISPLAY MODE** | `UNIFIED` (composite Z + divergence dots) / `COMPOSITE` (raw averaged Z) / `DIVERGENCES` (only cells with a divergence signal). |
| **FLOW SOURCE** | `ALL ETFs` (equal-weighted average, short-side inverted) / `LONGS (Bull)` (BOIL, HNU, 3NGL only) / `SHORTS (Bear)` (KOLD, HND, 3NGS only). |

**PEAKS spotlight tiers:**
| CSS class | Color | Threshold |
|-----------|-------|-----------|
| `heat-peak-notable` | Orange glow | p90–p94 |
| `heat-peak-significant` | Deep orange | p95–p98 |
| `heat-peak-extreme` | Bright red pulse | ≥ p99 |

---

## Section 6.2 — Flow-Price Divergence Signal (`#chartFlowNG`)

**Title:** `Flow-Price Divergence Signal`  
**Canvas ID:** `chartFlowNG` · **Height:** 380 px (desktop)  
**Controls:** Time-range buttons (1M – ALL) · Independent Range Slider

A **dual-axis chart** that isolates the *contrarian* (non-reactive) portion of the flow signal.

| Axis | Series | Description |
|------|--------|-------------|
| **Left** | Green/red bars | Composite flow Z-score magnitude — **only shown when flows OPPOSE the prior 5-session NG price direction**. |
| **Right** | Cyan line (`#5090a0`) | NG=F Henry Hub futures price (front month). |

**Bar meanings:**
| Bar color | Condition | Signal |
|-----------|-----------|--------|
| Green | Flows bullish while NG recently fell | Contrarian accumulation — smart money buying against weakness. |
| Red | Flows bearish while NG recently rose | Contrarian distribution — smart money selling into strength. |
| No bar | Flows follow price | Reactive (near-random predictive value — filtered out). |

**Why only contrarian bars?** A 2,500+ day audit found flows are primarily reactive (r ≈ −0.30 with a 3–5 day lag). Contrarian flows showed marginally better 21-day forward accuracy. The chart filters out reactive noise.

**Legend:** `NG=F PRICE (RIGHT AXIS)` · `BULLISH DIVERGENCE (LEFT)` · `BEARISH DIVERGENCE (LEFT)` · `FLAT = REACTIVE (no signal)`

---

## Section 6.3 — Flow Reactivity Intensity — Mean-Reversion Signal (`#chartReactivity`)

**Title:** `Flow Reactivity Intensity (Mean-Reversion Signal)`  
**Canvas ID:** `chartReactivity` · **Height:** 280 px (desktop)  
**Controls:** Time-range buttons (1M – ALL) · Independent Range Slider

The **complement** to the Divergence Signal chart. Shows when flows are most **reactive** (aligned with the prior 5-session NG price direction). Higher bars = stronger momentum-chasing crowd behaviour.

| Series | Color | Description |
|--------|-------|-------------|
| Reactivity intensity bars | Steel gray (`rgba(148,163,184,0.65)`) | Composite Z-score magnitude on reactive days only. |
| Zero bar | — | Flows opposing price (contrarian — see Divergence Signal chart). |

**Trading use:** High reactivity + extreme magnitude = crowds acting on momentum → mean-reversion reversal likely. 21-day reversals were largest when magnitude was highest. Pairs well with RSI extremes.

**Legend:** `REACTIVITY INTENSITY` · `ZERO = CONTRARIAN`

---

## Section 6.5 — Cross-Side Flow Divergence Scanner

**Title:** `Cross-Side Flow Divergence Scanner`  
**Controls:** Multi-window toggle · Lookback filter (30D / 90D / 6M / 1Y / ALL) · Download CSV

Scans for windows where **aggregate long-side capital** (BOIL + HNU + 3NGL) and **aggregate short-side capital** (KOLD + HND + 3NGS) diverge — one side accumulating while the other distributes. Reveals institutional rotation between bull and bear positioning.

### Table columns

| Column | Description |
|--------|-------------|
| **DATE** | Date the divergence window ends. |
| **WIN** | Lookback window length in trading days. |
| **TYPE** | `LONG LEADS` (longs accumulating, shorts distributing → bearish gas signal when longs drive) or `SHORT LEADS` (shorts distributing, longs pulling back → bullish gas signal). |
| **LONG Σ** | Total net capital flow across BOIL + HNU + 3NGL during the window. |
| **SHORT Σ** | Total net capital flow across KOLD + HND + 3NGS during the window. |
| **Δ SPR** | Capital spread: LONG Σ − SHORT Σ. Large absolute values = strong side-rotation. |
| **\$/DAY** | Daily average spread over the window (normalised for length). |
| **BRD** | Breadth — how many of the 6 ETFs show flow direction consistent with the divergence (≥4 = strong consensus). |
| **CONS** | Consistency — fraction of days in the window where both sides diverged simultaneously. Higher = more persistent rotation. |
| **SENT** | Cross-ETF sentiment label at window end based on 30-day aggregate flows. |
| **PRE** | PRE-3D: avg daily aggregate spread for 3 trading days before window opens. |
| **POST** | POST-3D: avg daily aggregate spread for 3 trading days after window closes. Measures follow-through. |
| **DAY** | Exact end-date aggregate spread. Isolates single-day spikes. |
| **BASE** | BASE-30D: prevailing 30-day average daily aggregate spread before the window. |
| **SIGNAL** | `CONFIRMED Rotation` (breadth ≥ 4 + spread + consistency) or `Rotation`. |
| **STR** | Composite strength score (0–100): combines spread magnitude + breadth + window length + consistency. |

---

## Section 7 — Yearly Flow Activity Matrix

**Title:** `Yearly Flow Activity Matrix`  
**Container:** `#yearly-matrix-panel`

A cross-tabulation **table** showing, for each year × each ETF:

- **Count** of significant flow events where |Z-Score| ≥ 1.5.
- **Average Z-Score magnitude** for those events.

Helps identify which years had the most active institutional flow signals per fund.

---

## Global UI Components

### Range Slider Brush

Present below every chart. Each chart has its **own independent** dual-handle range slider:

| Chart | Slider IDs |
|-------|-----------|
| Deep Dive (A+B) | `#range-start` / `#range-end` |
| Z-Score History | `#z-range-start` / `#z-range-end` |
| Cross-ETF Comparison | `#cross-range-start` / `#cross-range-end` |
| Composite Z | `#compz-range-start` / `#compz-range-end` |
| Flow Velocity | `#flowvel-range-start` / `#flowvel-range-end` |
| Flow-Price Divergence | `#flowng-range-start` / `#flowng-range-end` |
| Flow Reactivity | `#reactivity-range-start` / `#reactivity-range-end` |

Dragging handles zooms the corresponding chart(s). The highlighted cyan track shows the active window. The **Deep Dive** slider controls both `#chartA` and `#chartB` simultaneously.

### Custom Tooltips

Every chart has a custom HTML tooltip (`div#*-tooltip`) that appears on hover, showing formatted values for the date under the crosshair — no third-party tooltip library is used.

### Zoom Indicator

A `#zoom-indicator` label appears above Chart A when zoomed in, with a **RESET** link that restores the full date range.

### Download CSV Buttons

Both the **Flow vs Price Divergence** table and the **Cross-Side Flow Divergence Scanner** table have `DOWNLOAD CSV` buttons that export the currently visible rows.

### Data Source

- Flow data: **TrackInsight** (scraped daily to `data/flows/`)
- Price data: **Yahoo Finance** (NG=F Henry Hub futures, ETF NAV prices)
- Summary file: `data/flows/all_flows_summary.json`

---

## Chart Canvas IDs — Quick Reference

| Canvas ID | Section | Height (desktop) |
|-----------|---------|-----------------|
| `chartA` | Deep Dive — Cumulative Flow + Price | 290 px |
| `chartB` | Deep Dive — Daily Flow Bars | 130 px |
| `chartZ` | Flow Z-Score History | 300 px |
| `chartCross` | Cross-ETF Cumulative Flow Comparison | 340 px |
| `corrHeatCanvas` | Flow Correlation Heatmap Sidebar | 180 px (square) |
| `chartCompZ` | Cross-ETF Composite Z-Score | 340 px |
| `chartFlowVelocity` | Flow Acceleration & Exhaustion Engine | 300 px |
| `chartFlowNG` | Flow-Price Divergence Signal | 380 px |
| `chartReactivity` | Flow Reactivity Intensity | 280 px |
