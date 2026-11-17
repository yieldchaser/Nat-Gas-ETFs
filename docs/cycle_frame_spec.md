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
| R `PVT_RECOVERY` | z63(KOLD) today > −1 AND z63(KOLD) yesterday ≤ −1 AND min of z63(KOLD) over the last 20 sessions (today included) ≤ −2 | buy KOLD |
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

## 5b. Second round of tests (2026-11-16): what else was tried and what it means for the build

All figures are for KOLD unless stated, entry at the close of the first trigger day, with a −20% closing stop. "Any day" is the same measurement on every session.

**Targets and stops for setup A.** The advantage grows with the size of the target.

| Target (stop −20%) | A reached it | Any day | Average result per A trade | Any day average |
|---|---|---|---|---|
| +10% | 75% | 66% | — | — |
| +20% | 62% | 52% | +3.2% | −0.6% |
| +30% | 58% | 45% | +7.4% | +1.0% |
| +50% | 50% | 35% | +14.2% | +3.4% |
| +80% | 33% | 25% | +16.0% | +5.8% |

Stop width at a +50% target: −10% stop averages +9.6% per trade, −15% +11.7%, −20% +14.2%, −30% +13.1%. A −20% stop is the best of the four. Winners reach +30% in a median 18 sessions (middle half 7–28); losers hit the stop in a median 22. A closing stop can be gapped: the worst single trade lost 40%.

**Exit rules on the 52 setup-A trades** (stop −20% always on)

| Exit | Average per trade | Share positive | Median hold |
|---|---|---|---|
| Sell at +30% | +10.5% | 58% | 18 sessions |
| Sell at +50% | +16.7% | 52% | 38 |
| Sell when the PVT high marker fires on KOLD, once the trade is up 15% | +16.8% | 54% | 33 |
| Sell after 21 sessions | +14.7% | 69% | 21 |
| Sell on a close below the 20-session average, once up 20% | +13.8% | 62% | 24 |
| Trail 15–25% below the peak | +10.0% to +12.7% | 48–58% | 28–38 |

The PVT high marker is as good an exit as a +50% target and adapts to the size of the move. Trailing stops were the weakest.

**Options data with setup A** (2013-10 onward; A alone 60%, any day 46%)

| Added condition | Trades | Reached +30% |
|---|---|---|
| Call skew at or above its 80th percentile in the last 10 sessions | 28 | 61% |
| Implied volatility at or above its 70th percentile | 31 | 58% |
| Options state UPSIDE_STRESS in the last 10 sessions | 12 | 50%, typical worst point −38% |
| Call skew at or below its 30th percentile | 10 | 30% |
| Implied volatility at or below its 40th percentile | 8 | 38% |

Options data does not improve the setup. It gives two cautions: the setup is poor in a quiet market (low skew or low implied volatility), and risky while options show upside stress.

**Fund flows with setup A** (2017-06 onward; A alone 58%, any day 43%). No flow condition improved it (50–60% across eight variants). On their own, heavy KOLD creations are a negative: buying KOLD when its five-session creations are at or above their 90th percentile reached +30% only 35% of the time. Volume in the short ETFs helps; money chasing into them does not.

**Position in the cycle.** KOLD's declines from peak to trough: middle half 37–57% (median 46%) over 13–44 sessions (median 25). Its rallies: middle half +47% to +129% (median +81%) over 10–43 sessions (median 32). BOIL declines: 37–64% (median 54%) over 19–49 sessions (median 34); rallies +41% to +90% (median +60%) over 10–42 sessions (median 23). Requiring a deep decline or a long time since the high did not raise setup A (52–61%). Without the volume cluster, buying KOLD less than 20 sessions after its high worked 33%: too early.

**Three venues together, and quiet volume at peaks.** Requiring 3NGS to surge with KOLD and HND gave 43–57% against 64% for the same rule on KOLD and HND only. All three going quiet near a KOLD high happened 10 times in 14 years and marked the cycle high no better than price alone. Heat-map volume valleys: buying KOLD worked 42%, selling KOLD was no better than any day, buying BOIL worked 28%. None of these is built.

**A tested alternative to A that is not built:** KOLD and HND each at 1.5× on 2 of 5 sessions with KOLD 20% or more below its 63-session high: 2.6 a year, 63% (75% in 2012–19 on 12 trades, 58% after). It is close to A with the `atLow` flag and adds nothing the flag does not.

**When setup A fails, and when it is at its best** (all 52 trades: 58%)

| Split | Trades | Reached +30% | Typical worst point |
|---|---|---|---|
| NG made a 126-session high within the last 10 sessions | 13 | 46% | −36% |
| NG not at a 126-session high | 50 | 60% | −15% |
| First trigger since KOLD's latest 126-session high | 38 | 53% | −25% |
| Second or later trigger in the same KOLD decline | 14 | 71% (57% in 2012–19, 86% after) | −7% |
| NG above / below its 200-session average | 26 / 32 | 58% / 62% | −23% / −13% |
| November–March / April–October | 30 / 27 | 60% / 52% | −18% / −14% |
| Next trade after a losing trade / after a winning trade | 22 / 29 | 55% / 62% | — |

The broad trend of NG and the season do not separate good trades from bad. Two things do, on small counts: a first surge while NG is still printing six-month highs is early and painful, and a second surge later in the same KOLD decline has been the best entry. A loss does not make the next trigger worse. NG here means the tradeable index the alert engine already builds (`f.li`).

**Long side** (BOIL; any day 35%)

| Condition | Trades | Reached +30% |
|---|---|---|
| K short-leg reversal | 32 | 47% (both periods) |
| CAPITULATION (existing) | 18 | 50% |
| Put skew extreme (skew at or below its 10th percentile) with BOIL 30% or more below its 63-session high | 19 | 58% (44% in 2012–19, 70% after) |
| Long-side volume cluster while BOIL is falling (dip buying) | 35 | 23–32%, typical worst point about −50% |
| BOIL five-session creations at or above their 90th percentile | 46 | 35% |
| BOIL heavy redemptions (at or below 10th percentile) | 55 | 42% |

**Price-volume trend, third pass** (KOLD any day 45%, BOIL any day 35%; target +30% before −20%)

About 60 PVT readings were scored on each of KOLD and BOIL: the 21-, 42-, 63- and 126-session oscillator crossing up through low, middle and high levels, the cumulative line crossing its 21-session average, new 63-session highs in the line, and price/line divergences.

| Reading on KOLD | Trades | Reached +30% |
|---|---|---|
| 21-session oscillator crossing up through −60, −25, 0 or +25 | 101–110 each | 44–50% |
| Cumulative line crossing above its 21-session average | 103 | 43% |
| 63-session oscillator crossing up through 0 | 68 | 46% |
| 63-session oscillator crossing up through +1 (buying strength) | 57 | 33% |
| 126-session oscillator crossing up through +1 | 37 | 24% |
| First day the 63-session oscillator is at +1 or higher | 44 | 34% |
| Cumulative line at a new 63-session high | 38 | 32% |
| **63-session oscillator recovering through −1 after being at −2 or lower in the last 20 sessions (setup R)** | 31 | 65% (62% in 2012–19, 67% after; HND 63%) |

- Setup R is the owner's reading made precise: deeply below the line and coming back is a good KOLD entry; above the line is a bad one. It holds across neighbouring settings (recovery level −1.25 to −0.75, depth −1.75 to −2, look-back 20 to 30 sessions: 51–65%, 36 variants, nearly all above any day). It is mostly separate from setup A: 20 of its 31 trades had no A trigger in the previous 10 sessions, and those worked 65%.
- It is a confirmation entry, not a bottom call: only 7% of entries were within ten sessions of the cycle low, the typical run to the next peak was +50% and the typical worst point −8%.
- The 21-session oscillator shown today does not separate anything at any level, in either direction.
- **On BOIL none of the 60 readings worked**: 19–39% against 35%. PVT is a KOLD-side tool. On BOIL it is shown for location only.

**Where the money is.** Average result per trade with a fixed plan:

| Trade | Plan | Reached target | Average per trade | Any day, same plan |
|---|---|---|---|---|
| KOLD on setup A | stop −20%, target +50% | 50% | +14.2% | +3.4% |
| KOLD on setup A | stop −20%, target +30% | 58% | +7.4% | +1.0% |
| BOIL on setup K | stop −15%, target +30% | 47% | +4.6% | about −4% |
| BOIL on setup K | stop −20%, target +30% | 47% | +2.9% | −4.3% |
| BOIL on setup K | stop −20%, target +50% | 31% | +1.0% | −4.2% |

BOIL loses money on an ordinary day under any of these plans, and its best setup only lifts it to a small gain. Long entries are short tactical trades with a tight stop and a +30% target; they are not held for more. The short side is where a position can be held for size.

**Fund flows as an exit signal.** Heavy KOLD creations, heavy KOLD redemptions, heavy BOIL creations and heavy BOIL redemptions were each tested as a reason to sell the ETF near a high. None marked highs better than price alone or produced a better exit than an ordinary day (31–56% against 42–52%). Flows are shown as context and as the two entry warnings in W10, never as an exit prompt. The one volume reading that marks BOIL highs is the existing long-side climax (a long-side volume cluster in a rally: 25% of cases within ten sessions of the cycle high against 10% for any day).

Heavy volume or creations into a falling BOIL is the clearest "do not buy" reading in the whole study. The put-skew reading is promising but rests on 19 trades and one good period; it is shown as a caution-free watch line, not a setup.

The 63-session markers locate turns; on their own they raise the win rate only a few points, so they are shown as location and exit prompts, not as alerts.

## 5c. All twelve Price-Volume Studies, and a chance test for every setup (2026-11-17)

**Sweep.** Every numeric output of the twelve studies (VOLUME, VOL OSC, NET VOL, CMF, OBV, PVT; BVC-VPIN, ILLIQ-Z, ESVD, LMSW, VWAP-Z, TKVF, plus the engine states) was turned into six signals from its rolling 252-session percentile rank: ≤5th, ≤10th, ≥90th, ≥95th, and the turn back out of the bottom or top decile. Each was scored with the cycle scorer (section 3) as an entry on its own ETF, an entry on the mirror ETF, and an exit, on BOIL/KOLD and again on HNU.TO/HND.TO. 1,242 signals in all. Scripts: scratch `sweep12.py`, `esvd.py` (not in the repo; the rule that came out of them is fully specified below).

**Chance control.** The whole sweep was rerun with each signal shifted in time by 397, 911 and 1,500 sessions (keeps the signal's clustering, breaks any link to price). Under the filter "≥30 trades, lift ≥10 on US and Toronto, both halves ≥ any day +5": real 7, shifted 2 / 3 / 4. Most single-study signals are therefore noise.

| Study | Best lift (min of US, Toronto) | Best lift by chance (3 shifts) | Verdict |
|---|---|---|---|
| ESVD (effective spread) | +16 | none / none / +2 | real; wired as SPREAD_BLOWOUT |
| VWAP-Z (slope of 21-day VWAP) | +12 | +1 / +6 / +6 | 55% vs 45% on KOLD, but a shifted copy matches it 9.5% of the time and it repeats SHORT_ACCUMULATION; not wired |
| ILLIQ-Z | +9 | −3 / +4 / +3 | same liquidity-stress family as ESVD; adds nothing beyond it |
| PVT (21-session forms) | +9 | +7 / +8 / +8 | chance level. Only the 63-session washout recovery (PVT_RECOVERY) beats chance |
| OBV, NET VOL, VOLUME, VOL OSC, VPIN, LMSW, TKVF | +2 to +10 | similar or higher | chance level |
| CMF | — | — | CMF-21 on BOIL in its bottom decile: buying BOIL worked 27% (any day 35%), Toronto 33% (37%). Used as a warning note only |

**SPREAD_BLOWOUT.** ESVD `zSpread` (Abdi-Ranaldo spread, 10-session estimate, z-scored over 21) on BOIL **or** KOLD at or above its 95th percentile of the last 252 sessions (at least 126 values) → buy BOIL. 66 entries since 2012 (4.6 a year): worked 48% vs 35% any day; HNU 54% vs 37%; run to next peak +31% vs +21%. 2012–2019 +7 points, 2019–2026 +19. A plain 10-day volatility spike at the same percentile gives 35% vs 35% (nothing), and only 22% of spread days are volatility-spike days, so this is not volatility in disguise. 37% of its episodes fall within 5 sessions of SHORT_ACCUMULATION; in those conflicts BOIL did better (46%) than KOLD (40%, heat −24%). As a KOLD exit: KOLD fell 25% before rising 20% after 58% of signals (any day 42%), HND 63% (43%). Capped at MODERATE.

**Chance test of every setup.** Each setup's own mask was shifted to 200 random offsets; the share of shifts reaching its worked% is below. A setup at or above 10% is capped at WATCH (listed in the table; no card, no headline, no TODAY line, no heat-map dot).

| Setup | Trades | Worked | Any day | Shifts ≥ this | Tier |
|---|---|---|---|---|---|
| PVT_RECOVERY | 28 | 64% | 45% | 0% | MODERATE |
| SPREAD_BLOWOUT | 66 | 48% | 35% | 0% | MODERATE |
| SHORT_ACCUMULATION | 50 | 58% | 45% | 2.5% | STRONG |
| SHORT_LEG_REVERSAL | 32 | 47% | 35% | 5.5% | MODERATE |
| CROWDED_RALLY | 28 | 57% | 45% | 9.5% | MODERATE |
| OPT_BLOWOFF | 8 | 62% | 45% | 11% | WATCH |
| CAPITULATION | 18 | 50% | 35% | 14.5% | WATCH |
| CLOSE_EXHAUSTION | 38 | 50% | 45% | 24% | WATCH |
| CHASED_RALLY | 21 | 48% | 45% | 39% | WATCH |
| WASHOUT | 16 | 38% | 35% | 53.5% | WATCH |

Rerun this table whenever a setup is added or its rule changes; a new setup must clear 10% to show as a card.

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
   - `PVT_RECOVERY`, label `PRICE-VOLUME RECOVERY`, side `short`, family `PRICE-VOLUME`, maxTier `STRONG`, rule text `KOLD's 63-session price-volume trend recovering through −1 after falling to −2 or lower in the last 20 sessions`, risk text `A confirmation entry: usually a week or more after the low.` `buildFrame` adds `f.zKmin20`. Active-state sentence: `KOLD's price-volume trend fell to {min} and has recovered through −1.`
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
  - KOLD, HND.TO or 3NGS.L selected and setup R true within the last 5 sessions: `Recovering from a deep washout. This has been one of the better KOLD entries.`
  - KOLD, HND.TO or 3NGS.L selected and z63 ≥ +1: `Price-volume trend is high. A poor point to add; wait for a washout.`
  - BOIL, HNU.TO or 3NGL.L selected, any state not covered above: `On the long ETFs this study shows location only; it has not timed entries.`
  - otherwise: `No turn signal. The 21-session oscillator swings between extremes most weeks and is not a timing tool on its own.`
- Draw the 63-session oscillator as a second line in the oscillator pane (thin, neutral colour) with reference lines at −2, −1 and +1, and a marker on the price pane at each setup-R session for the short ETFs.
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

### W8 — plan, cautions and warnings on the Active Alerts cards (`docs/js/alert-engine.js`)

Exact strings; the acceptance test looks for the capitalised labels.

1. Under the stat grid of every short-side card add one line: `PLAN  Stop −20% on a closing basis · first target +30% · hold the rest for +50% or the PVT exit marker`. Tooltip: `On past SHORT-SIDE ACCUMULATION trades: +30% was reached 58% of the time in a median 18 sessions; +50% was reached 50% of the time. A closing stop can be gapped.` Long-side cards: `PLAN  Stop −15% on a closing basis · target +30% · do not hold for more`. Tooltip: `BOIL trades held for larger targets gave back the gain: +4.6% average per trade with this plan, +1.0% when held for +50%.`
2. Caution chips on the SHORT_ACCUMULATION card, shown only while the setup is ACTIVE:
   - `CAUTION: QUIET MARKET` when `f.skewPe` ≤ 30 or `f.ngvlPe` ≤ 40 on the latest session. Tooltip: `In quiet options markets this setup reached +30% in about one trade in three.`
   - `CAUTION: OPTIONS UPSIDE STRESS` when `f.optState` was `UPSIDE_STRESS` on any of the last 10 sessions. Tooltip: `With upside stress in the options market the typical trade was down 38% at its worst.`
   A caution never changes the tier or the mask.
3. New headline note (same place as the existing notes), not a setup and not on the heat map: `LONG-SIDE DIP BUYING` when LV ≥ 1.5 on 3 of the last 5 sessions and BOIL's close is at or below its close 10 sessions earlier. Sentence: `Heavy volume is going into a falling BOIL. Past BOIL entries in this state reached +30% about one time in four.`
4. New headline note `PUT-SKEW EXTREME` when `f.skewPe` ≤ 10 and BOIL is 30% or more below its 63-session high. Sentence: `Put skew is extreme with BOIL deeply off its high. Past BOIL entries here reached +30% in 11 of 19 trades.`
5. New headline note `KOLD PRICE-VOLUME STRETCHED` when z63(KOLD) ≥ +1 on the latest session. Sentence: `KOLD's price-volume trend is high. Past KOLD entries in this state reached +30% about one time in three.` When this note is on and a short-side setup is also ACTIVE, the `TODAY` line (W11) uses its caution form with the text `KOLD price-volume trend is high`.
5a. Two more chips on the SHORT_ACCUMULATION card while it is ACTIVE:
   - `CAUTION: NG AT 6-MONTH HIGH` when `f.li` equalled its 126-session maximum on any of the last 10 sessions. Tooltip: `First surges while NG is still making six-month highs were early: the typical trade was down 36% at its worst.`
   - `SECOND SURGE` when this is not the first SHORT_ACCUMULATION episode since KOLD's most recent 126-session closing high (count episodes, 10-session gap rule, whose first day falls after the session of that high; the chip shows from the second one). Tooltip: `Second and later surges in the same KOLD decline reached +30% in 10 of 14 trades.`
6. When a SHORT_ACCUMULATION trade is open (status IN_WINDOW or ACTIVE), KOLD is 15% or more above the entry close, and the KOLD PVT high marker (section 4) is true today, show the chip `EXIT WATCH` on the card with the sentence `KOLD's price-volume trend is stretched and turning down.`

### W9 — Trough-to-Peak page: where the current leg stands (`docs/trough-peak.html`)

For each ticker card, using the cycles `detectCycles` already returns at the current threshold, add one line labelled `CURRENT LEG`:

- If the last pivot is a peak (price is falling): `CURRENT LEG  down {x}% over {n} sessions · typical decline {med}% over {medN} sessions (middle half {q25}–{q75}%)`.
- If the last pivot is a trough (price is rising): `CURRENT LEG  up {x}% over {n} sessions · typical rally +{med}% over {medN} sessions (middle half +{q25}–{q75}%)`.

`x` is close ÷ last pivot close − 1; `n` counts sessions (rows of the price array), not calendar days; the typical figures are the median and quartiles of that ticker's completed legs of the same direction at the current threshold. With the default 30% threshold and data to 2026-11-13 the typical figures are: KOLD decline 46% over 25 sessions (37–57%), rally +81% over 32 (47–129%); BOIL decline 54% over 34 (37–64%), rally +60% over 23 (41–90%). The line recomputes when the threshold slider moves. No other change to this page. Also fix `tools/test_trough_peak_drawdown.mjs`, which fails today with `computeRollingLookbackDD is not defined`, or delete it if the function no longer exists anywhere.

### W10 — Flow Monitor: one reading strip (`docs/flows.html`, `docs/js/flow-composite.js`)

Nothing on the page is removed or rearranged. Add one strip at the top of the page, above the first panel, labelled `FLOW READING`, with one line per condition that is true on the latest date, in this order, or `No flow warning today.` when none is true.

- Inputs: `docs/data/flows/KOLD_flows.json` and `BOIL_flows.json` (`data[].date`, `data[].usd_flow`). `flow5` = sum of `usd_flow` over the last 5 rows (at least 3 present). `pct` = expanding percentile rank of today's `flow5` among all earlier and current values, defined once 252 values exist.
- `KOLD CREATIONS HEAVY` when KOLD `pct` ≥ 90: `Money is chasing into KOLD. Past KOLD entries in this state reached +30% about one time in three.`
- `BOIL CREATIONS HEAVY` when BOIL `pct` ≥ 90: `Money is going into BOIL. Past BOIL entries in this state reached +30% about one time in three.`
- Each line shows the five-session figure in dollars and its percentile, for example `+$48M over 5 sessions · 93rd percentile`.
- Replace on this page any wording covered by the table in W7 (`hit rate`, `significant`, `backtest`), strings only.

### W11 — one line that says what to do today (`docs/js/alert-engine.js`)

At the very top of the Active Alerts panel, above the bias headline, add a single line labelled `TODAY`. It is built from the model, first match wins:

1. SHORT_ACCUMULATION is ACTIVE with no caution chip: `TODAY  Short-side accumulation is on. KOLD entry zone; stop −20%, first target +30%.` If the `SECOND SURGE` chip is on, append ` Second surge in this decline.`
2. SHORT_ACCUMULATION is ACTIVE with a caution chip: `TODAY  Short-side accumulation is on, with a caution: {chip text without the word CAUTION}. Half size or wait for a second surge.`
3. `EXIT WATCH` is on: `TODAY  Exit watch on the open KOLD trade.`
4. Another MODERATE or STRONG short-side setup is ACTIVE: `TODAY  {LABEL} is on. KOLD entry zone; stop −20%, first target +30%.`
5. A MODERATE long-side setup is ACTIVE: `TODAY  {LABEL} is on. Tactical BOIL entry; stop −15%, target +30%.`
6. `LONG-SIDE DIP BUYING` note is on and nothing above: `TODAY  No entry. Heavy buying into a falling BOIL has a poor record.`
7. Otherwise: `TODAY  No setup. Nothing to do.`

The line is plain text in the existing panel font, no colour block, no icon.

### W6 — verification before opening the PR

- `node tools/test_cycle_acceptance.mjs` prints `PASS cycle acceptance` with no `BUILD PENDING` line, and `git diff origin/main -- tools/test_cycle_acceptance.mjs tools/cycle_acceptance_frozen.json` is empty.
- `node tools/test_cycle_engine.mjs`, `test_alert_engine.mjs`, `test_cvol.js`, `test_contract_ledger.mjs`, `test_pair_stress_and_vdds.mjs`, `test_volume_studies.mjs`, `test_heatmap_pipeline_e2e.mjs`, `test_card_simulation.mjs` all pass.
- Section 3 and section 5 numbers reproduce within tolerance (the acceptance test prints the two reference lines).
- `docs/index.html` loads with no console errors at 1500px and 420px, no horizontal overflow; grep the built page text for the banned words in section 2.
- Screenshot Active Alerts, the PVT tab and the heat map and check each against this spec.

## 6a. Order of work and definition of done

Do the items in this order; each must leave all suites green before the next starts.

1. W1 cycle engine and its tests.
2. W2 alert engine (frame fields, two setups, cycle records, tiers, card grid, table).
3. W8 plan line, cautions, notes, exit watch.
4. W5 PVT 63-session position, markers and reading (W8 item 5 needs the high marker).
5. W4 heat-map zone dots and tooltip.
6. W3 remaining wording, then W7 Options page wording and the folded section.
7. W9 Trough-to-Peak current-leg line.
8. W10 Flow Monitor reading strip.
9. W11 the TODAY line.
10. W6 verification.

Done means: the acceptance test passes with no `BUILD PENDING` line and is unmodified; every numbered item under W1–W11 is either implemented or listed in the pull request description with the reason it could not be; no item is silently skipped; screenshots of Active Alerts, the PVT tab, the heat map, the Options page and one Trough-to-Peak card are attached to the pull request.

## 7. Limits to keep in mind (not for the site)

About 45 cycles per ETF since 2012, and the Toronto pair tracks the same commodity as the US pair, so the two columns are a consistency check rather than two independent results. The short-side record is a tendency of roughly six in ten against four and a half in ten, with clustered failures in trending years; the −20% stop is part of the record, not an optional extra. The long side has no setup that catches more than about a third of the lows.
