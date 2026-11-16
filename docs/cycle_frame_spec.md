# Cycle-frame upgrade — implementation spec

Written 2026-11-16 for the agent that will implement it. Everything needed is in this file; no further research is required. Delete this file once the work is merged.

## 1. What changes and why

The site was scoring signals by "is NG higher 10 or 21 sessions later". The owner trades trough to peak, a few cycles a year, with variable holding time. Signals are now judged on the same cycles the Trough-to-Peak page draws: was the entry near a cycle low of the ETF being bought, did the trade reach its target before its stop, how far did it run to the next peak.

Judged that way, three things change:

1. **Short-side volume matters, with one condition.** When KOLD and HND trade at 1.5× their normal dollar volume on 3 of 5 sessions *while the short ETF is falling*, buying the short ETF has worked 58–60% of the time against 43–45% for an ordinary day. The same volume surge while the short ETF is rising carries nothing. The heat-map caption added in the last round ("peaks and valleys did not change the odds") was true only for the exact trigger day and is to be removed.
2. **The 21-session PVT oscillator is not selective.** It sits at one extreme or the other most of the time (a quarter of all days are below −64), so every low happens "below the line", but buying below the line is no better than buying on any day. Stretched over 63 sessions and combined with a turn, the same series marks highs and lows two to three times as often as an ordinary day. PVT stays; its window and its states change.
3. **The research wording comes off the site.** No "TESTED · NO EDGE", no p-values, no method captions. Cards show a trading record.

## 2. Rules for the implementer

- No research vocabulary in any user-facing string: no "tested", "edge", "p-value", "IC", "significant", "sample", "base rate", "backtest". Use "worked", "any day", "typical run", "typical heat".
- No explanatory paragraphs on the pages. A card gets at most one status sentence, one rule line and one risk line. Captions under charts are a legend only.
- No comment blocks longer than three lines in code. Reasoning lives in this file, not in the source.
- Do not remove any existing panel, tab or study. Only the items listed in W3 are deleted.
- Do not touch the trade ledger under Active Alerts.
- No emojis. Labels in capitals follow the existing style.

**The build is held to this spec by `tools/test_cycle_acceptance.mjs`, which already runs in CI.**

- That test recomputes every figure from raw data with its own code and compares the site's engine with it: trigger days must match session for session, counts must match exactly, tiers and card labels are checked, and the wording list is scanned. Hard-coding numbers into the engine cannot pass it.
- Do not edit `tools/test_cycle_acceptance.mjs` or `tools/cycle_acceptance_frozen.json`. The pull request must show no diff on either file. If a check looks wrong, stop and report it instead of changing the check.
- The engine checks switch on when `docs/js/cycle-engine.js` exists. A pull request without that file has not implemented the spec.
- Do not add conditions, change thresholds or windows, or add setups beyond section 4. Section 5a explains why: tuned combinations did not hold up.
- Do not skip, weaken or delete any existing test to get green.

## 3. The cycle scorer (exact definition)

Inputs: one ETF's daily bars from `docs/data/dashboard_data.json` (`etfs[T].history`, bars with a close), dates ≥ 2012-06-01.

- **Pivots.** Run the Trough-to-Peak ZigZag (`detectCycles` in `docs/trough-peak.html`, line ~1664) on closes with threshold 30%. Keep confirmed pivots only; drop the provisional last pivot the page appends.
- **Episodes.** A signal is a boolean per session. Ignore the first 60 sessions. An episode starts on a true day when the previous true day is more than 10 sessions back. The entry is the close of the episode's first day.
- **Per entry `t`** (skip entries with no confirmed peak after them):
  - `run` = close at the next confirmed peak ÷ close[t] − 1
  - `heat` = lowest close from t to that peak ÷ close[t] − 1
  - `nearLow` = a confirmed trough lies within 10 sessions either side and close[t] ≤ 1.15 × that trough's close
  - `worked` = closes reach +30% before −20%, looking at most 250 sessions ahead; neither reached counts as not worked
- **Any-day figures.** The same four numbers with every session from index 60 treated as an entry.
- **Turns caught.** Share of confirmed troughs with a signal day within 10 sessions either side.
- **Record for a setup** = count worked / count entries, median `run`, median `heat`, share `nearLow`, turns caught.

Any-day figures to reproduce (30% cycles, about three cycles a year per ETF):

| ETF | cycles | worked | near a low | typical run | typical heat |
|---|---|---|---|---|---|
| BOIL | 45 | 35% | 12% | +21% | −16% |
| KOLD | 41 | 45% | 10% | +31% | −12% |
| HNU.TO | 45 | 37% | 12% | +23% | −17% |
| HND.TO | 44 | 43% | 9% | +28% | −14% |

## 4. Signal definitions

`rvol(T)[i]` = dollar volume (close × volume) ÷ median dollar volume of the previous 63 sessions (today excluded).
`SV[i]` = mean of `rvol(KOLD)` and `rvol(HND.TO)`; `LV[i]` = mean of `rvol(BOIL)` and `rvol(HNU.TO)`. Toronto values are matched by date and carried forward at most 2 sessions; if Toronto is missing or stale use the US leg alone. London tickers are excluded (3NGS has no volume on 16% of sessions, 3NGL on 38%).
All features are computed on the full price history; only scoring is limited to sessions from 2012-06-01.
`ipvt(T)` = running sum of `impulse` from `VolumeStudies.computeInvariantPVTEngine`. `z63(T)[i]` = (ipvt − 63-session mean) ÷ 63-session sample standard deviation.

| Key | Definition | Trade |
|---|---|---|
| A `SHORT_ACCUMULATION` | SV ≥ 1.5 on at least 3 of the last 5 sessions AND KOLD close ≤ its close 10 sessions earlier | buy KOLD |
| B (already live as `CROWDED_RALLY`, keep its current rule) | long-side volume climax in a rally | buy KOLD |
| A flag `atLow` (chip on the A card, not a separate setup) | A is true AND KOLD close ≤ 1.10 × its lowest close of the last 63 sessions | buy KOLD |
| K `SHORT_LEG_REVERSAL` | max of z63(KOLD) over the last 10 sessions ≥ +1.5 AND KOLD impulse today < −0.5 | buy BOIL |
| PVT high marker (display only, per ETF) | max z63 over last 10 ≥ +1.5 AND z63 today ≥ +0.75 AND impulse today < −0.5 | exit prompt for holders of that ETF |
| PVT low marker (display only, per ETF) | min z63 over last 10 ≤ −1.5 AND impulse today > +0.5 | low watch for that ETF |

## 5. Results to reproduce

Format is setup / any day. Implementation is correct when entry counts are within ±4 and percentages within ±4 points.

**Short-ETF entries**

| Setup | ETF | entries | worked | near a low | typical run | typical heat | lows caught |
|---|---|---|---|---|---|---|---|
| A short-side accumulation | KOLD | 50 | 58% / 45% | 22% / 10% | +45% / +31% | −9% / −12% | 64% |
| A | HND.TO | 52 | 60% / 43% | 23% / 9% | +43% / +28% | −10% / −14% | 67% |
| same volume, short ETF rising | KOLD | 43 | 49% / 45% | 9% / 10% | +35% | −10% | 33% |
| CLOSE_EXHAUSTION | KOLD | 38 | 50% / 45% | 24% / 10% | +44% | −14% | 48% |
| CLOSE_EXHAUSTION | HND.TO | 38 | 50% / 43% | 29% / 9% | +44% | −20% | 53% |
| CROWDED_RALLY | KOLD | 28 | 57% / 45% | 21% / 10% | +47% | −12% | 38% |
| CROWDED_RALLY | HND.TO | 29 | 48% / 43% | 21% / 9% | +47% | −12% | 42% |
| OPT_BLOWOFF | KOLD | 8 | 62% / 45% | 25% / 10% | +65% | −13% | 24% |
| OPT_BLOWOFF | HND.TO | 10 | 50% / 43% | 20% / 9% | +35% | −13% | 24% |
| CHASED_RALLY | KOLD | 21 | 48% / 45% | 14% / 10% | +45% | −8% | 26% |
| CHASED_RALLY | HND.TO | 21 | 38% / 43% | 14% / 9% | +32% | −9% | 27% |

Setup A by year on KOLD (worked/entries): 2013 1/4, 2014 1/2, 2015 3/3, 2016 2/4, 2017 5/5, 2018 0/4, 2019 2/3, 2020 3/4, 2021 1/4, 2022 3/6, 2023 1/1, 2024 4/6, 2025 3/3. It fails when NG trends up for months.

Waiting for a breakout after the zone (close above the prior 3-session high) lowered the result to 53%. The record is for entering inside the zone.

**Which short-side legs to use** (volume at 1.5× on 3 of 5 sessions, KOLD lower than 10 sessions ago; any day 45%)

| Volume measured on | entries / year | worked on KOLD | 2012–19 | 2019–26 | worked on HND |
|---|---|---|---|---|---|
| KOLD alone | 3.5 | 57% | 64% | 48% | 56% |
| HND alone | 3.2 | 57% | 52% | 61% | 53% |
| KOLD + HND (the setup) | 3.5 | 58% | 52% | 64% | 56% |
| 3NGS alone | 2.5 | 39% | 33% | 40% | 42% |
| all three averaged | 3.6 | 48% | 46% | 50% | 48% |
| any two of the three | 2.6 | 57% | 53% | 59% | 57% |

London volume makes the result worse and is left out. A single-day spike of 3× or more did not work (44%); it is the cluster over several sessions that matters.

**Setup A at the low** (flag `atLow`): about 2 entries a year, 17 of 29 worked (59%; 50% in 2012–19, 67% in 2019–26; HND 55%), 28% within ten sessions of the cycle low, typical run +47%, typical heat −10%. Neighbouring settings (5–14% above a 42-, 63- or 84-session low) gave 50–64%. Being near the low without the volume cluster gave 41%, below any day.

**Long-ETF entries**

| Setup | ETF | entries | worked | near a low | typical run | typical heat | lows caught |
|---|---|---|---|---|---|---|---|
| CAPITULATION | BOIL | 18 | 50% / 35% | 28% / 12% | +30% / +21% | −13% / −16% | 20% |
| CAPITULATION | HNU.TO | 18 | 56% / 37% | 28% / 12% | +35% / +23% | −14% / −17% | 17% |
| WASHOUT | BOIL | 16 | 38% / 35% | 25% / 12% | +32% | −23% | 27% |
| WASHOUT | HNU.TO | 16 | 50% / 37% | 31% / 12% | +33% | −20% | 24% |
| K short-leg reversal | BOIL | 32 | 47% / 35% | 28% / 12% | +34% / +21% | −16% / −16% | 36% |
| K | HNU.TO | 27 | 44% / 37% | 37% / 12% | +35% / +23% | −15% / −17% | 41% |

Things that did not help on the long side and must not be built: buying BOIL on a long-side volume surge (27–33% worked against 35–37%), buying on low closing pressure alone (28–30%), long-side volume drought, share-of-volume extremes.

**PVT**

| Reading | ETF | entries | near the turn | worked |
|---|---|---|---|---|
| 21-session z ≤ −60, buy | BOIL / KOLD / HNU / HND | 79–87 each | 12% / 9% / 18% / 7% (any day 12 / 10 / 12 / 9) | 38 / 43 / 38 / 38 (any day 35 / 45 / 37 / 43) |
| 63-session low marker, buy | BOIL / KOLD / HNU / HND | 42–51 each | 22% / 29% / 24% / 24% | 41 / 52 / 46 / 48 |
| 63-session high marker, exit | BOIL / KOLD / HNU / HND | 24–33 each | 27% / 26% / 31% / 42% (any day 10 / 11 / 9 / 12) | — |

## 5a. Combinations tested, and why the list above is final

For each side, 2,908 combinations were scored: every volume variant (US, Toronto, London, US + Toronto, all three, two of three; cluster, double spike, single spike) alone, with one, and with two of sixteen context conditions (direction over 10 sessions, drawdown, distance from the 63-session low, closing pressure high or low, PVT washed out or stretched, turn day, breakout, opposite-side volume). Each was scored on KOLD or BOIL, on the Toronto mirror, and separately on 2012–19 and 2019–26. Only combinations giving 1.4 to 5.2 entries a year were kept (790 short side, 565 long side).

- **Short side.** The twelve best-looking combinations of 2012–19 beat any day by only 4 points in 2019–26, while the average of all 790 beat it by 9. Picking the fanciest combination loses to the plain theme. The theme that held in both periods and on both pairs is setup A, and its tighter form at the 63-session low.
- **Long side.** The twelve best of 2012–19 beat any day by 0 points in 2019–26; the average of all 565 by 1. No volume combination finds BOIL lows. The only stable entries are K (47% in both periods, 50% on HNU, against 35–37%) and the existing CAPITULATION setup.
- One long-side momentum pattern looked good (long-side volume cluster with closing pressure above its 90th percentile and an up-impulse day: 12 of 21 worked) but it buys strength, not a low, rests on 21 trades and its looser forms fall to 48%. Do not build it.

Entries per year with the final list: A 3.5 (2.0 with the `atLow` flag), K 2.2, CAPITULATION 1.2, CLOSE_EXHAUSTION 2.6, CROWDED_RALLY 1.9. Several of these overlap in time, so the count of distinct trade zones is lower.

The 63-session markers locate turns; on their own they raise the win rate only a few points, so they are shown as location and exit prompts, not as alerts.

## 6. Work items

### W1 — `docs/js/cycle-engine.js` (new) and `tools/test_cycle_engine.mjs` (new)

Pure functions, no DOM, exported for Node the same way `alert-engine.js` is:

```js
CycleEngine.pivots(closes, pct = 30)            // [{ i, type: 'T' | 'P' }], confirmed only
CycleEngine.episodes(mask, gap = 10, skip = 60) // entry indexes
CycleEngine.entry(closes, pivots, t)            // { run, heat, nearLow, worked } or null
CycleEngine.anyDay(closes, pivots)              // { worked, nearLow, run, heat } (shares and medians)
CycleEngine.record(closes, mask)                // { n, worked, workedPct, nearLowPct, run, heat, caughtPct, any, byYear }
```

`record` returns `run` and `heat` in percent and `nearLowPct` / `workedPct` as percentages, as the acceptance test expects. `alert-engine.js` reads `CycleEngine` and `VolumeStudies` from the global scope in both the browser and Node.

Tests: a hand-built price series with known pivots; an entry exactly at a trough (heat 0, run = cycle gain); episode spacing; the four any-day rows of section 3 within one point. Add the suite to `.github/workflows/test-suites.yml` (the acceptance test is already there). Load the script in `docs/js/auth.js` before `alert-engine.js` and bump the `?v=` strings.

### W2 — `docs/js/alert-engine.js`

1. `buildFrame`: add `f.sv`, `f.lv` (section 4), `f.kold10` (KOLD 10-session return), and, when `VolumeStudies` is defined, `f.zK` (z63 of KOLD ipvt), `f.zKmax10`, `f.impK`. When `VolumeStudies` is absent leave them null and the K setup never fires.
2. `SETUPS`: add
   - `SHORT_ACCUMULATION`, label `SHORT-SIDE ACCUMULATION`, side `short`, family `VOLUME`, maxTier `STRONG`, rule text `KOLD and HND dollar volume at 1.5× normal on 3 of the last 5 sessions while KOLD is lower than 10 sessions ago`, risk text `Fails when NG trends up for months (2013, 2018, 2021).`
   - `SHORT_LEG_REVERSAL`, label `SHORT-LEG REVERSAL`, side `long`, family `PRICE-VOLUME`, maxTier `MODERATE`, rule text `KOLD price-volume trend stretched above its 63-session range, followed by a heavy down session`, risk text `Catches about one low in three.`
3. Scoring: for every setup compute `CycleEngine.record` on the traded leg (KOLD for `short`, BOIL for `long`) and on the Toronto mirror (HND.TO, HNU.TO). Tier from the two records, where `lift` = worked% − any-day worked%:
   - `STRONG`: lift ≥ 10 on both and entries ≥ 30 on both
   - `MODERATE`: lift ≥ 5 on both, or lift ≥ 0 on both with near-low share at least twice the any-day share on both
   - `WATCH`: anything else (listed in the table, never in the headline, no heat-map mark)
   - fewer than 20 entries on the US leg: cap at `MODERATE` and show the existing `SMALL SAMPLE` chip renamed `FEW TRADES`
   Each entry of `model.setups` gains `cycle: { us: record, ca: record }` (the two `CycleEngine.record` results) and keeps `mask` aligned to `model.frame.dates`; `tier` holds the cycle tier.
   Expected tiers with today's data: SHORT_ACCUMULATION STRONG; CLOSE_EXHAUSTION, CROWDED_RALLY, SHORT_LEG_REVERSAL MODERATE; OPT_BLOWOFF, CAPITULATION, WASHOUT MODERATE with FEW TRADES; CHASED_RALLY WATCH. The old fixed-horizon evaluator stays only to feed the ledger.
4. Card stat grid (`_statGrid`), six cells, replacing WIN RATE / ANY-DAY RATE / AVG RETURN / LEG / P-VALUE / WORST TRADE:
   `WORKED` "29 of 50" · `ANY DAY` "45%" · `TYPICAL RUN` "+45%" · `TYPICAL HEAT` "−9%" · `TURNS CAUGHT` "64%" · `TORONTO` "31 of 52".
   One tooltip on the grid: `Record of buying the leg at the close of the first trigger day: worked means +30% was reached before −20%.` Add the risk line under the rule line.
5. Setup table: columns become `SETUP · SIDE · TIER · WORKED · LAST TRIGGER`. Remove the `P-VALUE` column.
6. Active-state sentence for A: `KOLD and HND volume has run at 1.5× normal on {k} of the last 5 sessions with KOLD {x}% lower over 10 sessions.` For K: `KOLD's price-volume trend peaked {d} sessions ago and today was a heavy down session.`
7. When A is active and `atLow` is true, show the chip `AT 63-SESSION LOW` on its card.
8. Add `SHORT-SIDE VOLUME` to the gauge row: value `{SV:.1f}×`, sub-label `accumulation at 1.5× on 3 of 5`, highlighted when A is true.
9. Update `tools/test_alert_engine.mjs`: tier expectations above, A and K masks on a synthetic frame, records within tolerance of section 5.

### W3 — remove the research surface

Already done on main: the evidence line under Price-Volume Studies, the heat-map sentence and tooltip, `docs/data/indicator_evidence.json`, `tools/indicator_evidence.mjs`, `tools/heatmap_evidence.mjs`.

Still to do:

- `docs/css/signals.css`: delete the unused `.vs-evidence`, `.vs-ev-*`, `.heat-evidence-note` rules.
- `docs/js/alert-engine.js`: the wording in W2 items 4–5; rename `SMALL SAMPLE` to `FEW TRADES`; remove "binomial", "base rate" and "significant" from every tooltip and sentence.
- `docs/js/signals.js`: remove "Spearman" and "base rate" from user-facing strings.
- `docs/upgrade_backlog.md`: items E2 (evidenceHtml part), E3 and E4 are void.

### W4 — heat map

`Signals.markHeatSetups` already draws a dot on every cell where a MODERATE or STRONG setup was true, through `AlertEngine.setupsOn`. With W2 the new setups appear automatically. Two additions:

- While setup A is true, draw the dot on every cell of the zone (all sessions where the rule holds), not only the first day. `setupsOn` already works per date; confirm it does not collapse to episode starts.
- Tooltip line for A on a cell: `SHORT-SIDE ACCUMULATION · SV {x}× · KOLD {r}% / 10 sessions`.

### W5 — PVT tab (`docs/js/volume-studies.js`)

- Compute `z63` from the engine's `impulse` and return it with the engine output.
- Header chips for the selected ETF: `63-SESSION POSITION` = `WASHED OUT` (z63 ≤ −1.5), `LOW` (≤ −0.75), `NEUTRAL`, `HIGH` (≥ 0.75), `STRETCHED` (≥ 1.5); `TURN` = `UP` when the low marker is true, `DOWN` when the high marker is true, otherwise blank.
- Reading sentence, one of:
  - high marker: `Stretched and turning down. Past cycle highs in {ETF} clustered here; holders should tighten stops.`
  - low marker: `Washed out and turning up. Past cycle lows in {ETF} clustered here; watch for a setup in Active Alerts.`
  - otherwise: `No turn signal. The 21-session oscillator swings between extremes most weeks and is not a timing tool on its own.`
- Draw small markers on the price pane at high-marker and low-marker sessions (reuse the existing divergence marker style, one colour each).
- Keep the 21-session oscillator, its state machine and its labels as they are.

### W7 — Options (CVOL) page wording

Nothing is deleted. Wording changes, and the research panels are folded away.

- Wrap everything below the `Research Layer` divider (raw surface inputs, signal filter, scorecard, event timeline) in one `<details>` element, closed by default, summary text `HISTORY AND METHODS`.
- Replace in `docs/cvol.html`, `docs/js/cvol-ui.js`, `docs/js/cvol.js` (user-facing strings only; keys and ids stay):

| Now | Becomes |
|---|---|
| `NO EDGE` (state label) | `NO SETUP` |
| `BACKTEST SCORECARD`, `Backtest` | `TRACK RECORD` |
| `hit rate`, `HIT RATE`, `SEASONAL HIT RATE` | `worked`, `WORKED`, `WORKED BY SEASON` |
| `base rate`, `ANY-DAY` rate wording | `any day` |
| `SIG` / `MARGINAL` / `NS` | `RELIABLE` / `MIXED` / `UNRELIABLE` |
| `p-value`, `binomial`, `significant`, `significance`, `sample size` | remove the clause; where a count matters write `{n} trades` |

- The directional panel's ledger and gauges keep their numbers; only labels change.

### W6 — verification before opening the PR

- `node tools/test_cycle_acceptance.mjs` prints `PASS cycle acceptance` with no `BUILD PENDING` line, and `git diff origin/main -- tools/test_cycle_acceptance.mjs tools/cycle_acceptance_frozen.json` is empty.
- `node tools/test_cycle_engine.mjs`, `test_alert_engine.mjs`, `test_cvol.js`, `test_contract_ledger.mjs`, `test_pair_stress_and_vdds.mjs`, `test_volume_studies.mjs`, `test_heatmap_pipeline_e2e.mjs`, `test_card_simulation.mjs` all pass.
- Section 3 and section 5 numbers reproduce within tolerance (the acceptance test prints the two reference lines).
- `docs/index.html` loads with no console errors at 1500px and 420px, no horizontal overflow; grep the built page text for the banned words in section 2.
- Screenshot Active Alerts, the PVT tab and the heat map and check each against this spec.

## 7. Limits to keep in mind (not for the site)

About 45 cycles per ETF since 2012, and the Toronto pair tracks the same commodity as the US pair, so the two columns are a consistency check rather than two independent results. The short-side record is a tendency of roughly six in ten against four and a half in ten, with clustered failures in trending years; the −20% stop is part of the record, not an optional extra. The long side has no setup that catches more than about a third of the lows.
