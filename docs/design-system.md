# Design System — Dark Intelligence Terminal

> A portable design language extracted from a production financial-analytics dashboard.
> Written to be dropped into an unrelated codebase. Dark-first, numeric-first, calm.
> Everything here is stack-neutral: raw values first, then CSS custom properties,
> Tailwind keys, and Chart.js options.

---

## 0. Design Thesis

The feel is **an institutional terminal that happens to be beautiful** — not a consumer app
dressed in dark mode.

Four forces define it:

1. **Calm near-black canvas.** The background is a desaturated blue-black (`#0d1117`), not
   pure black. Surfaces step up in lightness rather than by shadow alone, so depth reads as
   *material*, not as decoration.
2. **Numeric-first typography.** Every live value uses tabular figures and tight tracking.
   Micro-labels are uppercase, wide-tracked, and muted. Numbers are the hero; labels are
   scaffolding.
3. **Translucent fill as a language.** Status is expressed with 15–34% alpha tints of the
   semantic palette over dark surfaces — never with saturated blocks. The only solid fills
   are small badges and active controls.
4. **Motion that confirms, never entertains.** Short (100–250ms) transitions on color and
   lift; a single longer (400ms) structural reveal. One signature "flash" when a value
   changes. Nothing loops.

If you only copy one thing: **the uppercase micro-label + tabular number pair**, sitting on a
card with a 2px gradient top-bar. That combination *is* the brand.

---

## 1. Color System

### 1.1 Core surfaces & text

| Token | Hex | RGBA | Role | Rule of use |
|---|---|---|---|---|
| `--bg` | `#0d1117` | — | Page canvas | Never inside a card |
| `--surface` | `#161b22` | — | Primary card / header / bar | Solid panels, sticky chrome |
| `--surface2` | `#21262d` | — | Elevated / inset control bg | Inputs, table headers, pills, slider track |
| `--border` | `#30363d` | — | Hairline divider | Always exactly 1px |
| `--text` | `#e6edf3` | — | Primary text | Body + all values |
| `--text-muted` | `#8b949e` | — | Secondary text | Labels, hints, axis ticks, footnotes |

These six are the entire neutral ramp. Do not introduce additional grays.

### 1.2 Accent palette

| Token | Hex | Chart fill (10%) | Primary association |
|---|---|---|---|
| `--accent` | `#388bfd` | `rgba(56,139,253,0.10)` | Interactive / selection / focus / primary series |
| `--accent-orange` | `#fb8f44` | `rgba(251,143,68,0.10)` | Secondary series, "kicker" labels, margin |
| `--accent-green` | `#3fb950` | `rgba(63,185,80,0.10)` | Profit, safe, live, positive |
| `--accent-red` | `#f85149` | `rgba(248,81,73,0.10)` | Loss, danger, hike, negative |
| `--accent-yellow` | `#d29922` | `rgba(210,153,34,0.10)` | Warning, delayed, open interest |
| `--accent-purple` | `#a371f7` | `rgba(163,113,247,0.10)` | Tertiary series, composite/derived metrics |

**Accent discipline:** at most **two** accents appear in one card region. Blue is the default
"interactive" accent and may appear everywhere. The other five are *semantic* — they earn
their place by meaning something.

### 1.3 Brand gradient

Used for the wordmark and for the default top-bar on stat tiles:

```
linear-gradient(90deg, #58a6ff, #a371f7)
```

Text form (`background-clip: text`, transparent fill):
`linear-gradient(90deg, #58a6ff, #a371f7)`.

The related "holographic hairline" used on glass borders is `rgba(88,166,255,0.3)` — a
lighter cyan-blue than `--accent`. Use it only on floating glass surfaces.

### 1.4 Semantic ladders

**Regime / severity ladder** (calm → crisis):

| Level | Hex | Use |
|---|---|---|
| calm | `#3fb950` | nominal |
| elevated | `#d29922` | watch |
| stressed | `#fb8f44` | act |
| crisis | `#f85149` | alert |

**Freshness ladder** (staleness dot):

| State | Hex | Threshold guide |
|---|---|---|
| LIVE | `#3fb950` | < 1 day |
| DELAYED | `#d29922` | 1–5 days |
| STALE | `#f85149` | > 5 days |

The freshness dot is a **10px solid circle** with a text label beside it. Keep the three
thresholds and their exact hexes together — they always appear as a set.

### 1.5 The alpha convention (most important rule)

Status and interaction states are expressed as **alpha over dark surfaces**, never as new hues.
The house alphas:

| Alpha | Where |
|---|---|
| `0.02` | Barely-there row/card hover wash (`rgba(255,255,255,0.02)`) |
| `0.04` | Table row hover tint (`rgba(56,139,253,0.04)`) |
| `0.05` | Card top highlight (`inset 0 1px 0 rgba(255,255,255,0.05)`) |
| `0.10` | Line-chart area fill under a series |
| `0.15` | Soft badge background (safe / warn / danger) |
| `0.18` | Focus ring halo; active chip background |
| `0.24`–`0.34` | Heatmap cell fills |
| `0.28` | Status-ribbon border tint |
| `0.35`–`0.55` | Hover border tint on cards, dashed reference lines |
| `0.85`–`0.95` | Glass / gradient surface opacity |

### 1.6 Intensity / heatmap scale

Two divergent ramps, both as **multi-stop CSS gradients** used in tiny 10px-tall legend strips:

Risk / danger ramp (good → bad):
```
linear-gradient(to right, #0d4a1a, #d29922, #7f1d1d)
```

Smooth four-stop meter (used with a white notch indicator):
```
linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)
```

**Heatmap cell fills** are computed from a score in `0–100`:

| Mode | Score ≥ 75 | Score ≥ 45–50 | Below | Null |
|---|---|---|---|---|
| "good-is-green" | `rgba(63,185,80,0.30)` | `rgba(210,153,34,0.30)` | `rgba(248,81,73,0.30)` | `rgba(139,148,158,0.14)` |
| "bad-is-red" | `rgba(248,81,73,0.34)` | `rgba(210,153,34,0.30)` | `rgba(63,185,80,0.24)` | `rgba(139,148,158,0.14)` |

Note the asymmetry: the "hot" end of each ramp is slightly stronger (0.34 / 0.30) than the
"cool" end (0.24 / 0.30). Null data is always the muted gray at 0.14.

Legend dots are 9px solid circles: low `#3fb950`, mid `#d29922`, high `#f85149`.

### 1.7 Cross-stack mapping

| Concept | Value | CSS var | Tailwind `theme.extend.colors` | Chart.js |
|---|---|---|---|---|
| canvas | `#0d1117` | `--bg` | `canvas: '#0d1117'` | — |
| surface | `#161b22` | `--surface` | `surface: '#161b22'` | — |
| surface-2 | `#21262d` | `--surface2` | `surface2: '#21262d'` | `Chart.defaults.borderColor` (as `#30363d`) |
| border | `#30363d` | `--border` | `line: '#30363d'` | `Chart.defaults.borderColor` |
| text | `#e6edf3` | `--text` | `ink: '#e6edf3'` | — |
| muted | `#8b949e` | `--text-muted` | `muted: '#8b949e'` | `Chart.defaults.color` |
| accent | `#388bfd` | `--accent` | `accent: '#388bfd'` | primary series |
| orange | `#fb8f44` | `--accent-orange` | `flame: '#fb8f44'` | price series |
| green | `#3fb950` | `--accent-green` | `profit: '#3fb950'` | positive |
| red | `#f85149` | `--accent-red` | `risk: '#f85149'` | negative |
| yellow | `#d29922` | `--accent-yellow` | `caution: '#d29922'` | volume/OI |
| purple | `#a371f7` | `--accent-purple` | `violet: '#a371f7'` | derived series |

---

## 2. Typography

### 2.1 Families

- **UI / body / display:** `Inter`, weights 400 / 500 / 600 / 700. Fallback `sans-serif`.
- **Numerics / code / axis labels:** `'SF Mono', 'Consolas', monospace` (optionally `'Fira Code'`
  for range labels). Applied via a `.mono` utility class.

Load Inter with `display=swap`. Do not add a second sans-serif.

### 2.2 Scale

| px | Weight | Tracking | Case | Usage |
|---|---|---|---|---|
| 9 | 600 | `0.08em` | UPPERCASE | Densest stat labels |
| 10 | 600 | `0.06–0.08em` | UPPERCASE | Card titles, table headers, KPI labels, chart ticks |
| 11 | 500–600 | `0.02–0.07em` | Mixed / UPPER | Badges, hints, unit suffixes, footnote, tooltip titles |
| 12 | 400–500 | normal | Sentence | Table cells, sub-values, meta rows, slider labels |
| 13 | 500–700 | `0.04em` | Sentence | Buttons, inputs, tab labels, tooltip body |
| 14 | 400 | normal | Sentence | Body default (`line-height: 1.5`) |
| 16 | 700 | normal | — | Measurement callout values |
| 18 | 700 | `-0.02em` | — | Compact stat values |
| 20 | 700 | `-0.02em` | — | KPI stat values (header bar) |
| 22 | 700 | `-0.02em` | — | Hero stat values (calculator) |

### 2.3 The signature move: the micro-label

This single rule creates most of the "institutional" feel:

```css
.micro-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
```

Variants: `9px / 0.08em` for the densest tiles, `11px / 0.06em` for input labels, and an
accent-colored "kicker" at `11px / 0.08em / 600` in `--accent-orange` for section eyebrows.

### 2.4 Numbers

All values that can change must use:

```css
.value {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  letter-spacing: -0.02em;
}
```

Unit suffixes are **not** part of the value. They render as a separate span:
`11px / 600 / uppercase / var(--text-muted) / opacity: 0.8`, sitting on the baseline beside
the number.

Signed values color themselves: `.is-positive { color: var(--accent-green) }`,
`.is-negative { color: var(--accent-red) }`. Neutral stays `--text`.

---

## 3. Layout & Spacing

### 3.1 Shell architecture

```
┌─ header (sticky, 52px, z-100) ────────────────────────────┐
│  logo + gradient wordmark            freshness dot + time │
├─ stats bar (KPI rail, horizontal scroll on mobile) ───────┤
│  stat-card │ stat-card │ stat-card │ stat-card │ ...      │
├─ tab nav (sticky top:52px, z-90) ─────────────────────────┤
│  Tab A │ Tab B │ Tab C │ ...                              │
├─ content well (padding: 20px) ────────────────────────────┤
│  .card / .mkt-card grids                                  │
└───────────────────────────────────────────────────────────┘
```

Sticky stacking is deliberate: header `z-index: 100`, tab nav `z-index: 90` with
`top: 52px`, table headers `z-index: 10`, floating overlays `z-index: 9999`+.

### 3.2 Spacing scale

`4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32`

| Where | Value |
|---|---|
| Content well padding | `20px` (desktop), `12px` (≤768px) |
| Card padding | `20px` (`.card`), `14px` (`.mkt-card`, `.calc-stat`) |
| Card grid gap | `16px` (desktop), `12px` (mobile) |
| Field stack gap (label → input) | `6px` |
| Section stack gap | `14px` |
| Calculator column gap | `24px` |
| Stat grid gap | `8–10px` |
| Button row gap | `4–6px` |
| Header horizontal padding | `20px` |

### 3.3 Grids

- `.grid-2` → `1fr 1fr`, gap 16
- `.grid-3` → `1fr 1fr 1fr`, gap 16
- Hero three-column (calculator) →
  `minmax(280px, 1.05fr) minmax(320px, 1.25fr) minmax(280px, 1fr)`, gap 24, `align-items: start`
- Stat tiles → `repeat(5, 1fr)` → `repeat(3, 1fr)` at ≤900px → `repeat(2, 1fr)` at ≤480px
- Heatmap tiles → `repeat(auto-fit, minmax(150px, 1fr))`, gap 8
- Sub-grids inside forms: `1fr 1fr` (duo) and `1fr 1fr 1.5fr` (triple), gap 8–10

### 3.4 Breakpoints

| Width | Behaviour |
|---|---|
| `≤ 900px` | Tab nav becomes horizontally scrollable; 5-col stat grid → 3; hero grid stacks |
| `≤ 768px` | `grid-2/3` → single column; content padding 12; stat cards shrink to min 100px; stat values 16px |
| `≤ 640px` | Chart height 300 → 240; table cell padding 8px / font 11px; KPI grids → 2 then 1 col |
| `≤ 480px` | Stat tile grids → 2 col; measurement tiles drop min-height |

Mobile scroll rails (KPI bar, tab nav) hide their scrollbars:
`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`, with
`-webkit-overflow-scrolling: touch`.

---

## 4. Surfaces & Elevation

Depth is built from **three ingredients**: a 1px hairline, a top inner highlight, and a soft
drop shadow. Together they read as "backlit panel".

### 4.1 Solid card

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 4px 12px rgba(0,0,0,0.15);
}
```

### 4.2 Gradient card (the workhorse)

```css
.mkt-card {
  background: linear-gradient(145deg, rgba(33,38,45,0.8) 0%, rgba(22,27,34,0.8) 100%);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.mkt-card:hover {
  transform: translateY(-2px);
  border-color: rgba(56,139,253,0.4);
  box-shadow:
    0 6px 16px rgba(0,0,0,0.4),
    inset 0 1px 0 rgba(255,255,255,0.1);
}
```

Opacity of the gradient is the depth dial: `0.8` normal, `0.85` featured panels,
`0.92` hero/immersive panels. Higher opacity = more present.

### 4.3 Hero panel

Same gradient at `0.92`, with a larger ambient shadow:

```css
.hero-panel {
  border: 1px solid var(--border);
  background: linear-gradient(145deg, rgba(33,38,45,0.92) 0%, rgba(22,27,34,0.92) 100%);
  box-shadow:
    0 8px 32px rgba(0,0,0,0.3),
    inset 0 1px 0 rgba(255,255,255,0.05);
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
}
.hero-panel:hover {
  border-color: rgba(56,139,253,0.45);
  box-shadow: 0 12px 32px rgba(0,0,0,0.35);
}
```

### 4.4 The 2px gradient top-bar

A signature detail. Every stat tile carries a 2px gradient strip flush to its top edge,
fading left → transparent:

```css
.stat-tile {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}
.stat-tile::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--bar, linear-gradient(90deg, rgba(56,139,253,0.6), rgba(163,113,247,0.2), transparent));
  opacity: 0.85;
}
```

Semantic variants of `--bar`:

| Modifier | Gradient |
|---|---|
| default | `rgba(56,139,253,0.6) → rgba(163,113,247,0.2) → transparent` |
| profit | `rgba(63,185,80,0.85) → rgba(63,185,80,0.1) → transparent` |
| risk | `rgba(248,81,73,0.85) → rgba(248,81,73,0.1) → transparent` |
| lots | `rgba(56,139,253,0.85) → rgba(56,139,253,0.1) → transparent` |
| margin | `rgba(251,143,68,0.85) → rgba(251,143,68,0.1) → transparent` |
| util | `rgba(163,113,247,0.85) → rgba(163,113,247,0.1) → transparent` |

Pattern: **0.85 alpha at the origin → 0.1 at 60% → transparent**. Same shape, hue swapped.

### 4.5 Glass (floating overlays)

```css
.glass {
  background: rgba(22, 27, 34, 0.95);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(88,166,255,0.3);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.6);
}
```

A lighter variant for pinned measurement callouts: `rgba(13,17,23,0.9)` + `blur(4px)`, a solid
`--accent` 1px border, 8px radius, `0 4px 15px rgba(0,0,0,0.5)`.

Glass rule: **only for things that float over content** (tooltips, callouts, popovers).
Never for in-flow cards.

### 4.6 Subtle gradients on chrome

Toolbars and filter strips get a barely-there top-down accent wash instead of a solid fill:

```css
.toolbar {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(56,139,253,0.06), rgba(56,139,253,0.01));
}
```

---

## 5. Components

### 5.1 Buttons

**Base / secondary (pill button)**
```css
.btn {
  background: var(--surface2);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.btn:hover { color: var(--text); border-color: rgba(139,148,158,0.55); }
.btn:active { transform: scale(0.95); }
.btn.is-active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(56,139,253,0.18);
}
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

Sizes: `padding: 3px 10px; font-size: 11px` (compact preset), `4px 10px; 12px` (default),
`5px 13px; 12px` (segment group). Radius is always `4px` for buttons.

**Primary / summary badge**
```css
.badge-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 3px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.badge-primary.is-loss   { background: var(--accent-red); }
.badge-primary.is-profit { background: var(--accent-green); color: #0d1117; }
```

Note: green badges take the **canvas color** as text (`#0d1117`), not white — green is too
light for white text.

### 5.2 Segmented toggle with sliding pill

The single most distinctive control. A two-option switch where a colored pill slides behind
the labels.

```css
.toggle {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  isolation: isolate;
}
.toggle__pill {
  position: absolute;
  top: 3px; left: 3px;
  width: calc(50% - 3px);
  height: calc(100% - 6px);
  background: var(--accent);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(56,139,253,0.35);
  transition: transform 0.28s cubic-bezier(0.4,0,0.2,1), background 0.2s ease;
  z-index: 0;
}
.toggle[data-value="alt"] .toggle__pill {
  transform: translateX(100%);
  background: var(--accent-red);
  box-shadow: 0 2px 8px rgba(248,81,73,0.35);
}
.toggle__option {
  position: relative;
  z-index: 1;
  background: none;
  border: none;
  padding: 6px 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: center;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.2s ease;
}
.toggle__option[aria-checked="true"] { color: #fff; }
```

The pill glow is always a **colored 8px shadow at 0.35 alpha** matching the pill fill.

### 5.3 Inputs & selects

```css
.input, .select {
  width: 100%;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--text);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.input:hover, .select:hover { border-color: rgba(139,148,158,0.55); }
.input:focus, .select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(56,139,253,0.18);
}
.input[aria-invalid="true"] {
  border-color: var(--accent-red);
  box-shadow: 0 0 0 3px rgba(248,81,73,0.18);
}
.input--mono { font-family: 'SF Mono', 'Consolas', monospace; }
```

Input radius is `6px` (one step larger than buttons' `4px`). Focus ring is **always**
`0 0 0 3px` at `0.18` alpha in the state's color.

Dark date pickers: `color-scheme: dark` on the input, and
`::-webkit-calendar-picker-indicator { filter: invert(0.65); cursor: pointer; }`.

Field anatomy: label (11px / 600 / 0.06em / UPPER / muted) → 6px gap → control →
optional hint (10px / 600 / 0.02em / UPPER / `--accent`).

### 5.4 Badges & chips

```css
.badge {
  display: inline-block;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
}
/* Solid — for hard events */
.badge--hike { background: var(--accent-red);   color: #fff; }
.badge--cut  { background: var(--accent-green); color: #0d1117; }
/* Tinted — for soft states */
.badge--safe   { background: rgba(63,185,80,0.15);  color: var(--accent-green); }
.badge--warn   { background: rgba(210,153,34,0.15); color: var(--accent-yellow); }
.badge--danger { background: rgba(248,81,73,0.15);  color: var(--accent-red); }
```

Rule: **solid background = the event already happened** (a hike, a cut).
**Tinted background = a state you're currently in** (safe, warned, in danger).

Mode chips (compact filter state):
```css
.mode-chip { background: rgba(139,148,158,0.15); color: var(--text-muted); }
.mode-chip.is-active { background: rgba(56,139,253,0.18); color: var(--accent); }
```

### 5.5 Status ribbon

Full-width inline banner inside a card:
```css
.status {
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text);
}
.status--warn   { color: var(--accent-yellow); border-color: rgba(210,153,34,0.28); }
.status--danger { color: var(--accent-red);    border-color: rgba(248,81,73,0.28); }
.status--info   { color: var(--text);          border-color: rgba(56,139,253,0.28); }
.status__detail { color: var(--text-muted); margin-top: 3px; font-size: 11px; }
```

Border tint is always the semantic hue at **0.28 alpha**. The detail line drops to muted 11px.

### 5.6 Data table

```css
.data-table { width: 100%; border-collapse: collapse; }
.data-table th {
  background: var(--surface2);
  padding: 9px 12px;
  text-align: left;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3), inset 0 -1px 0 var(--border);
}
.data-table td {
  padding: 9px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s ease;
}
.data-table tr:nth-child(even) td { background: rgba(33,38,45,0.5); }
.data-table tr:hover td { background: rgba(56,139,253,0.04); }
.data-table tr:hover td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
```

Three details make this table feel expensive:
1. The **sticky header shadow** (`0 4px 12px rgba(0,0,0,0.3)`) so rows slide *under* it.
2. The **zebra at 0.5 alpha of surface2**, not a second gray.
3. The **2px accent inset on the first cell of the hovered row** — a "you are here" marker.

Table shells that need a viewport get `overflow-x: auto`, a `1px solid rgba(255,255,255,0.06)`
border, 8px radius, and a slightly darker header (`rgba(33,38,45,0.9)`).

### 5.7 Stat / KPI tiles

```css
.stat-card {
  flex: 1;
  min-width: 120px;
  padding: 10px 20px;
  border-right: 1px solid var(--border);
  transition: background 0.15s ease;
}
.stat-card:hover { background: rgba(255,255,255,0.02); }
.stat-card:last-child { border-right: none; }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
              color: var(--text-muted); margin-bottom: 2px; }
.stat-value { font-size: 20px; font-weight: 700; letter-spacing: -0.02em;
              color: var(--text); text-shadow: 0 0 20px rgba(255,255,255,0.1); }
.stat-sub   { font-size: 11px; margin-top: 2px; font-weight: 500; }
.stat-sub.up   { color: var(--accent-red); }
.stat-sub.down { color: var(--accent-green); }
.stat-sub.flat { color: var(--text-muted); }
```

The faint `text-shadow: 0 0 20px rgba(255,255,255,0.1)` on values is intentional — it gives
numbers a soft internal glow against the dark surface. Keep it.

Note the **inverted delta convention** used in risk contexts: `up` = red (costlier/riskier),
`down` = green. If your domain is P&L, flip it — but pick one convention and label it.

### 5.8 Cards & section chrome

```css
.card-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin-bottom: 14px;
  font-weight: 600;
}
```

Section eyebrows ("kickers") are the same but colored: `11px / 600 / 0.08em / UPPER` in
`--accent-orange`.

### 5.9 Tooltip system

Two parts: a persistent affordance, and a floating glass panel.

**Affordance** — a 14px `?` circle appended to any labeled element:
```css
.has-tooltip { cursor: help; display: inline-flex; align-items: center; gap: 5px; }
.has-tooltip::after {
  content: '?';
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--surface2);
  border: 1px solid var(--border);
  font-size: 9px; font-weight: 700;
  color: var(--text-muted);
  display: inline-flex; align-items: center; justify-content: center;
}
.has-tooltip:hover::after {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
```

Important layout rule: when `.has-tooltip` is applied to a `tr`, `td`, `th`, or a card, the
`::after` affordance is suppressed (`content: none`) so it can't break table layout — the
tooltip is then triggered by the element itself.

**Floating panel** — the glass surface from §4.5:
```css
.tooltip {
  position: fixed;
  z-index: 9999;
  padding: 16px 20px;
  max-width: min(380px, 92vw);
  opacity: 0;
  pointer-events: none;
  transform: translateY(10px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.tooltip.visible { opacity: 1; transform: translateY(0); }
.tooltip__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(56,139,253,0.2);
}
.tooltip__body { font-size: 13px; color: var(--text); line-height: 1.65; }
.tooltip__body strong { color: var(--accent); }
.tooltip__body em     { color: var(--accent-yellow); font-style: normal; }
```

The title uses accent blue and a hairline underline; body text uses `strong` for the metric
name (blue) and `em` for the qualifier (yellow, never italic).

### 5.10 Heatmap tiles

```css
.heatmap-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}
.heatmap-cell {
  min-height: 58px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 11px;
  transition: transform 0.12s ease, border-color 0.12s ease;
}
.heatmap-cell:hover {
  transform: translateY(-1px);
  border-color: rgba(255,255,255,0.22);
}
```

Fill comes from the §1.6 alpha table. Border is a neutral `rgba(255,255,255,0.08)` — it must
not compete with the fill. Legends are 9px dots + 11px muted labels in a flex row.

### 5.11 Range slider (single & double thumb)

```css
.range-track {
  position: absolute;
  height: 4px;
  background: var(--surface2);
  border-radius: 4px;
}
.range-highlight {
  position: absolute;
  height: 4px;
  background: var(--accent);
  border-radius: 4px;
  box-shadow: 0 0 12px rgba(56,139,253,0.4);
}
.range-inputs input {
  appearance: none; -webkit-appearance: none;
  background: none;
  pointer-events: none;
  width: 100%; height: 100%;
}
.range-inputs input::-webkit-slider-thumb {
  pointer-events: auto;
  appearance: none; -webkit-appearance: none;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid var(--accent);
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: transform 0.1s;
}
.range-inputs input::-webkit-slider-thumb:hover { transform: scale(1.15); }
```

Thumb is **white with a 3px accent ring** — high contrast against the dark track. The active
range glows (`0 0 12px rgba(56,139,253,0.4)`); the inactive track stays flat `--surface2`.
Range end labels use the mono face at 12px.

### 5.12 Disclosure / accordion

Structural reveal using the grid-rows trick (animates to content height without JS measuring):

```css
.disclosure { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.4s cubic-bezier(0.4,0,0.2,1); }
.disclosure.is-open { grid-template-rows: 1fr; }
.disclosure__inner { overflow: hidden; min-height: 0; }
.disclosure.is-open .disclosure__inner {
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid var(--border);
}
.chevron {
  display: inline-block;
  font-size: 18px;
  color: var(--text-muted);
  transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
}
.disclosure.is-open .chevron { transform: rotate(180deg); }
```

### 5.13 Skeleton / loading

A shimmer sweep, not a spinner:
```css
@keyframes shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
.skeleton {
  background: linear-gradient(90deg,
    var(--surface2) 0%, rgba(255,255,255,0.06) 50%, var(--surface2) 100%);
  background-size: 200px 100%;
  background-repeat: no-repeat;
  animation: shimmer 1.2s linear infinite;
  border-radius: 4px;
  color: transparent;
}
```

### 5.14 Value-change flash

When a computed value updates, pulse a ring once:
```css
@keyframes valuePulse {
  0%   { box-shadow: 0 0 0 0 rgba(56,139,253,0.45); }
  100% { box-shadow: 0 0 0 6px rgba(56,139,253,0); }
}
.is-flashing { animation: valuePulse 0.55s ease-out; }
```

### 5.15 Empty state

```css
.empty-state {
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
```

Dashed border, muted text, centered. No illustration, no CTA.

---

## 6. Chart Language

Charts should look like **instruments**, not like marketing graphics. Thin lines, no point
markers on dense data, muted axes, colored axis titles.

### 6.1 Global defaults

```js
Chart.defaults.color       = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family = 'Inter';
```

### 6.2 Series palette

| Series | Line | Fill (10%) | Meaning |
|---|---|---|---|
| `initialMargin` | `#388bfd` | `rgba(56,139,253,0.10)` | Primary metric |
| `totalMargin` | `#a371f7` | `rgba(163,113,247,0.10)` | Composite / derived |
| `mcxClose` | `#fb8f44` | `rgba(251,143,68,0.10)` | Price |
| `henryHub` | `#3fb950` | `transparent` | External benchmark |
| `volume` | `rgba(35,178,178,0.80)` | `rgba(35,178,178,0.28)` | Activity |
| `openInterest` | `#d29922` | `transparent` | Positioning |
| `positiveRisk` | `#f85149` | — | Risk-on / adverse |
| `negativeRisk` | `#3fb950` | — | Risk-off / favorable |

Teal (`#23b2b2`) appears only as the volume series — the one hue outside the accent set.
Keep it exclusive to activity bars.

### 6.3 Line idiom

```js
{
  tension: 0.3,          // 0.25–0.3; never 0 (too rigid), never 0.5 (too bubbly)
  pointRadius: 0,        // dense series
  pointRadius: 3,        // sparse series (forward curves, key points)
  pointRadius: 4,        // hero sparse series
  borderWidth: 2,        // primary
  borderWidth: 1.5,      // secondary / dense multi-series
  fill: true,            // only with a 0.10-alpha background
}
```

Area fills are **flat alpha**, not gradients, under standard lines. Gradient fills are reserved
for hero/single-series emphasis charts.

### 6.4 Reference & threshold lines

Dashed indigo, no fill, no points:
```js
{
  borderColor: 'rgba(99,102,241,0.35)',
  borderDash: [4, 4],
  pointRadius: 0,
  tension: 0.3,
  fill: false,
}
```
Stronger variant: `rgba(99,102,241,0.55)` with `borderDash: [6, 3]`.

Note: reference lines use **indigo** (`#6366f1` family), deliberately outside the semantic
accent set so they never read as a data series.

### 6.5 Axes

```js
scales: {
  x: {
    ticks: {
      color: '#8b949e',
      font: { size: 10 },
      maxTicksLimit: 12,        // 12–16 depending on density
      maxRotation: 45,          // 45–60 for date labels
    },
  },
  y: {
    position: 'left',
    title: { display: true, text: 'Margin %', color: '#388bfd', font: { size: 10 } },
    ticks: { color: '#388bfd', font: { size: 10 }, callback: v => v.toFixed(1) + '%' },
  },
  yPrice: {
    position: 'right',
    grid: { drawOnChartArea: false },     // secondary axes never draw gridlines
    title: { display: true, text: 'Price', color: '#3fb950', font: { size: 10 } },
    ticks: { color: '#3fb950', font: { size: 10 } },
  },
}
```

Rules:
- Tick font is always **10px**.
- **Axis titles are tinted to their series color.** This is the trick that makes multi-axis
  charts readable without a legend lookup.
- Only the **left** axis draws gridlines. Every right-hand axis sets
  `grid: { drawOnChartArea: false }`.
- Tick callbacks format numbers explicitly (`toFixed(1) + '%'`) — never rely on raw floats.

### 6.6 Legend

```js
plugins: {
  legend: {
    position: 'top',
    labels: {
      color: '#8b949e',
      font: { size: 10 },        // 10–11px
      boxWidth: 12,
      padding: 14,
    },
  },
}
```

### 6.7 Tooltip

```js
plugins: {
  tooltip: {
    mode: 'index',
    intersect: false,
  },
}
```

### 6.8 Sizing

Chart containers are `position: relative; height: 300px` (240px at ≤640px), and every chart
uses `responsive: true, maintainAspectRatio: false` so it fills the shell.

### 6.9 Intensity meters (non-Chart.js)

Inline CSS gradient bars for single-value intensity (10px tall, 2–4px radius) with a white
notch marker positioned absolutely along the track. See §1.6 for the ramps.

---

## 7. Motion

### 7.1 Duration & easing scale

| Duration | Easing | Used for |
|---|---|---|
| `0.1s` | `ease` | Press scale (`0.95`) |
| `0.12s` | `ease` | Heatmap hover lift, KPI hover |
| `0.15s` | `ease` | Color / border transitions, tooltip fade-in |
| `0.18s` | `cubic-bezier(0.4,0,0.2,1)` | Stat tile hover lift |
| `0.2s` | `cubic-bezier(0.4,0,0.2,1)` | Card hover lift, toggle label color |
| `0.25s` | `ease` | Hero panel border + shadow |
| `0.28s` | `cubic-bezier(0.4,0,0.2,1)` | Toggle pill slide |
| `0.3s` | `cubic-bezier(0.4,0,0.2,1)` | Chevron rotate |
| `0.4s` | `cubic-bezier(0.4,0,0.2,1)` | Disclosure open/close |
| `0.55s` | `ease-out` | Value-change flash |

**Structural motion** (things that move or change size) uses
`cubic-bezier(0.4, 0, 0.2, 1)`. **State motion** (color, border, opacity) uses `ease`.

### 7.2 Hover lift

The universal card hover is:
```css
transform: translateY(-2px);           /* -1px for small tiles */
border-color: rgba(56,139,253,0.4);    /* 0.55 for lighter emphasis */
box-shadow: 0 6px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
```
Never more than 2px of lift. Never rotate. Never scale (except press `0.95` and slider
thumbs `1.15`).

### 7.3 The three signature moves

1. **Sliding toggle pill** (§5.2) — a colored pill translates behind the labels with a
   matching glow, 280ms.
2. **Grid-rows disclosure** (§5.12) — panels grow to their natural height over 400ms with a
   hairline separator appearing as they open.
3. **Value flash** (§5.14) — a single expanding ring on computed values, 550ms, once.

### 7.4 Enter animation for floating panels

Glass tooltips and callouts enter with `opacity 0→1` plus `translateY(10px)→0` over 150ms.
They exit instantly (or with a 150ms fade). No scale, no bounce.

---

## 8. Accessibility & Density

- **Focus is never removed.** `:focus-visible` renders `outline: 2px solid var(--accent)` with
  `outline-offset: 2px` (or `4px` on large headers).
- **Invalid inputs** use `aria-invalid="true"` and get the red border + red 3px halo.
- **Screen-reader-only text** (`.sr-only`) is used for live value announcements alongside
  visual updates.
- **Touch targets:** quick buttons are 32px tall minimum; slider thumbs 18px; toggle options
  ≥ 30px.
- **Contrast:** `--text-muted #8b949e` on `--bg #0d1117` is ~5.4:1 — acceptable for labels
  only. Never set body copy or numeric values in muted.
- **Density fallback:** at ≤640px, table padding drops to 8px and font to 11px, and chart
  height drops to 240px — information stays, chrome shrinks.

---

## 9. Voice & Micro-copy

- Micro-labels are **terse and uppercase**: `FRONT MARGIN %`, `OPEN INTEREST`, `DTE FILTER`.
- **Units live outside the number** as a muted uppercase suffix: `%`, `x`, `bps`, `d`.
- **Hints are uppercase, accent-blue, 10px**: a small "why this field exists" note under the
  label.
- **Footnotes / disclaimers** are 10px muted, sitting on a hairline-separated strip at the
  bottom of a card.
- Status words are short verbs/adjectives: `LIVE`, `DELAYED`, `STALE`, `SAFE`, `WARN`,
  `DANGER`. Never sentences in a badge.
- Tooltips are the only place for full sentences. Their body line-height is generous
  (`1.65`) because they carry explanation.

---

## 10. Appendix A — Light-mode adaptation

The system is dark-first. A light theme preserves the *hierarchy and semantics* by swapping
the neutral ramp and dialing down glow and glass.

### 10.1 Token swap

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#0d1117` | `#f6f8fa` |
| `--surface` | `#161b22` | `#ffffff` |
| `--surface2` | `#21262d` | `#eef1f4` |
| `--border` | `#30363d` | `#d0d7de` |
| `--text` | `#e6edf3` | `#1f2328` |
| `--text-muted` | `#8b949e` | `#656d76` |
| `--accent` | `#388bfd` | `#0969da` |
| `--accent-orange` | `#fb8f44` | `#bc4c00` |
| `--accent-green` | `#3fb950` | `#1a7f37` |
| `--accent-red` | `#f85149` | `#cf222e` |
| `--accent-yellow` | `#d29922` | `#9a6700` |
| `--accent-purple` | `#a371f7` | `#8250df` |

### 10.2 What must change beyond the palette

| Element | Dark treatment | Light treatment |
|---|---|---|
| Card shadow | `0 4px 12px rgba(0,0,0,0.15)` | `0 1px 3px rgba(31,35,40,0.12)` |
| Hover lift shadow | `0 6px 16px rgba(0,0,0,0.4)` | `0 4px 12px rgba(31,35,40,0.16)` |
| Top highlight | `inset 0 1px 0 rgba(255,255,255,0.05)` | drop it, or `inset 0 1px 0 rgba(255,255,255,0.7)` |
| Glass | `rgba(22,27,34,0.95)` + blur 8 | `rgba(255,255,255,0.92)` + blur 12; border `rgba(9,105,218,0.25)` |
| Value glow | `text-shadow: 0 0 20px rgba(255,255,255,0.1)` | remove |
| Pill glow | `0 2px 8px rgba(56,139,253,0.35)` | `0 1px 3px rgba(9,105,218,0.25)` |
| Zebra rows | `rgba(33,38,45,0.5)` | `rgba(246,248,250,0.8)` |
| Row hover | `rgba(56,139,253,0.04)` | `rgba(9,105,218,0.06)` |
| Heatmap fills | 0.24–0.34 alpha | raise ~0.12 (light fills need more opacity to read) |
| Chart grid | `#30363d` | `#d0d7de` |
| Gradient cards | `rgba(33,38,45,0.8)→rgba(22,27,34,0.8)` | `rgba(255,255,255,0.9)→rgba(246,248,250,0.9)` |

Semantic hexes stay *meaningful* (green/red/yellow) but darken for contrast on white.

---

## 11. Appendix B — Quick-start kits

### 11.1 CSS custom properties (paste-ready)

```css
:root {
  /* Surfaces */
  --bg: #0d1117;
  --surface: #161b22;
  --surface2: #21262d;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;

  /* Accents */
  --accent: #388bfd;
  --accent-orange: #fb8f44;
  --accent-green: #3fb950;
  --accent-red: #f85149;
  --accent-yellow: #d29922;
  --accent-purple: #a371f7;

  /* Brand */
  --brand-gradient: linear-gradient(90deg, #58a6ff, #a371f7);
  --glass-border: rgba(88,166,255,0.3);

  /* Focus ring */
  --ring: 0 0 0 3px rgba(56,139,253,0.18);
  --ring-danger: 0 0 0 3px rgba(248,81,73,0.18);

  /* Elevation */
  --shadow-card: inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 12px rgba(0,0,0,0.15);
  --shadow-lift: 0 6px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
  --shadow-glass: 0 4px 24px rgba(0,0,0,0.6);

  /* Motion */
  --ease-structural: cubic-bezier(0.4, 0, 0.2, 1);
  --dur-fast: 0.12s;
  --dur-state: 0.15s;
  --dur-lift: 0.2s;
  --dur-slide: 0.28s;
  --dur-reveal: 0.4s;

  /* Type */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'Consolas', monospace;
}
```

### 11.2 Tailwind `theme.extend`

```js
theme: {
  extend: {
    colors: {
      canvas:  '#0d1117',
      surface: '#161b22',
      surface2:'#21262d',
      line:    '#30363d',
      ink:     '#e6edf3',
      muted:   '#8b949e',
      accent:  '#388bfd',
      flame:   '#fb8f44',
      profit:  '#3fb950',
      risk:    '#f85149',
      caution: '#d29922',
      violet:  '#a371f7',
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      mono: ['SF Mono', 'Consolas', 'monospace'],
    },
    borderRadius: { DEFAULT: '4px', md: '6px', lg: '8px', xl: '12px' },
    boxShadow: {
      card: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 12px rgba(0,0,0,0.15)',
      lift: '0 6px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
      glass: '0 4px 24px rgba(0,0,0,0.6)',
      ring: '0 0 0 3px rgba(56,139,253,0.18)',
    },
    transitionTimingFunction: {
      structural: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  },
}
```

### 11.3 Chart.js defaults

```js
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family = 'Inter';
Chart.defaults.font.size = 10;

export const series = {
  primary:   { color: '#388bfd', fill: 'rgba(56,139,253,0.10)' },
  derived:   { color: '#a371f7', fill: 'rgba(163,113,247,0.10)' },
  price:     { color: '#fb8f44', fill: 'rgba(251,143,68,0.10)' },
  benchmark: { color: '#3fb950', fill: 'transparent' },
  volume:    { color: 'rgba(35,178,178,0.80)', fill: 'rgba(35,178,178,0.28)' },
  interest:  { color: '#d29922', fill: 'transparent' },
};

export const lineDefaults = {
  tension: 0.3,
  pointRadius: 0,
  borderWidth: 2,
  fill: true,
};

export const referenceLine = {
  borderColor: 'rgba(99,102,241,0.35)',
  borderDash: [4, 4],
  pointRadius: 0,
  fill: false,
};

export const axisDefaults = {
  ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 12 },
  title: { display: true, font: { size: 10 } },
};

export const secondaryAxis = {
  position: 'right',
  grid: { drawOnChartArea: false },
};
```

---

## 12. Adoption checklist

When porting this system to a new product, implement in this order:

1. **Tokens first** (§11.1) — get the six neutrals and six accents in place.
2. **Type** (§2) — Inter + the micro-label + tabular numbers. This alone shifts the feel.
3. **Surfaces** (§4) — card, gradient card, and the 2px top-bar stat tile.
4. **One interactive control** (§5.2 toggle or §5.3 input) to lock the radius/ring/easing rules.
5. **One table** (§5.6) and **one chart** (§6) — the two places the language proves itself.
6. **Motion last** (§7) — add lifts and the disclosure reveal only after static layout is right.

Skip nothing from §1.5 (the alpha convention) and §6.5 (colored axis titles). Those two carry
more of the identity than any single component.
