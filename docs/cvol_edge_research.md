# CVOL — what the options data actually says about direction

*Research and rebuild, 2026-11-15. Data: CME NGVL history 2013-10-01 → 2026-11-13 (3,304 trading days).
Every number here is reproduced by `python tools/cvol_edge_research.py`; the live page recomputes the
edge-state statistics in the browser on every load.*

---

## 1. The foundation was measuring the wrong thing

The `UNDERLYING` column in `ngvl_cvol_history.csv` is the front options-month future. It switches
contract around the 16th–21st of each month. In contango that switch prints as a one-day gain that
nobody earns:

| Date | Raw column | What a holder got |
|---|---|---|
| 2025-10-20 | +34% | +6% |
| 2024-10-21 | +24% | +1% |
| 2020-10-19 | +18% | +1% |

Over the full history the raw column lost 10%. A holder of rolled futures — which is what BOIL and
KOLD are — lost 97.5%. Every forward return, hit rate and realized-vol figure on the CVOL tab was
computed on the raw column, so:

- **Base rates were wrong.** "NG is higher 21 sessions later" is 50.4% on the raw column and 42.0%
  on a tradeable basis. Mean 21-session return: +1.0% raw, −1.7% tradeable.
- **The bias is worst exactly when signals fire.** Contango is steepest October–December, which is
  also when skew and vol are highest. The tab's one advertised directional edge
  (`UPSIDE_TAIL_BID`, "59% vs 51% base") was largely the autumn roll. On tradeable returns it is
  48% against a 42% base and no longer clears the page's own bar.
- **Realized vol was inflated by roll jumps**, which made implied look cheap. `VOL_UNDERPRICED`
  was the most common state on the page (28% of days). On a roll-free series trailing realized
  exceeds NGVL on 23% of days, and forward realized exceeds it on 24%.

**Fix.** `scripts/build_cvol_tradeable.py` writes `data/cvol/ng_tradeable.csv` with two level series:
`idx_px`, the roll-adjusted unlevered NG index implied by the BOIL/KOLD pair (`(r_BOIL − r_KOLD)/4`,
fees cancel), and `fm_px`, a roll-free front-month level (daily median of the raw column, Yahoo
`NG=F` and beta × index — the two front-month sources roll on different days, so the median discards
whichever is rolling). The engine now uses `idx_px` for every forward return and `fm_px` for every
realized vol, and falls back to the raw column — visibly labelled — if the file is missing.

## 2. Two data-pipeline defects, both since April 2026

1. **Sunday rows.** Since the source switched to intraday data, `fetch_cvol.py` grouped points by UTC
   calendar date, so each Sunday-evening Globex session became its own row. There are 26 of them.
   Each one counted as a trading day in every rolling window and forward horizon.
2. **Rows frozen mid-session.** The fetcher only appended dates newer than the last row, and the job
   runs at 16:00 UTC — two and a half hours *before* the 14:30 New York settlement, not after it as
   the workflow comment claimed. Through 2026-Q1 the `UNDERLYING` column matched the NG=F settle
   to the cent on every day. Since 2026-Q2, 26–40% of days differ by more than 0.5% (2026-11-11 by
   3.75%, captured at 07:25 New York). The implied-vol columns on those rows are snapshots too.

**Fix.** The fetcher now maps intraday points to CME trade dates (18:00 New York cutoff, weekends
dropped) and *overwrites* the rolling window it fetches, so a later run finalises an earlier partial
day; the workflow gains a 22:30 UTC run after the Globex close. The JS parser skips weekend rows
already in the file. **Not fixed, and not fixable from here:** the mid-session values already stored
for April–November 2026. They can only be repaired by re-downloading EOD history from CME.

*The fetcher change is unit-tested on synthetic intraday data but has not been run against CME
(no credentials in this environment). Watch the first scheduled run.*

## 3. What survives on tradeable returns

A scan of ~50 surface features against 1/5/10/21-session tradeable returns found that almost
everything the tab computes — 21-day z-scores of skew, variance wings, convexity, VRP, vol-of-vol,
the SAD/CI/CVC/RDS composites — carries no stable directional information. What does:

### Blow-off fade (bearish) — the one strong result

Skew ratio ≥ 95th **and** NGVL ≥ 90th percentile, both measured against all prior history
(expanding, no look-ahead; today that is skew ratio ≥ 1.67 and NGVL ≥ 88).

| Horizon | Mean | Median | Higher | Base higher | Permutation p |
|---|---|---|---|---|---|
| 5D | −3.7% | −3.4% | 30% | 46% | 0.007 |
| 10D | −8.1% | −9.4% | 24% | 44% | <0.001 |
| 21D | −13.2% | −12.7% | 15% | 42% | 0.007 |
| 42D | −15.5% | −17.8% | 18% | 35% | 0.060 |

161 days in 11 separate episodes; 8 of 10 completed episodes were lower 21 sessions after their
*first* day and 9 of 10 at 42. It held in both halves of the sample (−15.6% before June 2020,
−11.8% after) and inside winter months alone (skew ratio > 1.7 in Nov–Feb: −12.3% against a −5.2%
winter base), so it is not just seasonality. Skew extreme *without* vol extreme carried nothing
(21 days, −1.4%).

The mechanism is plausible: record call skew is utilities and shorts paying up for upside during a
weather spike; the spike usually passes and the contango bleed resumes.

**The risk is real.** December 2024 ran +30% against the read within 21 sessions and +42% by 42.
January 2026 ran +24% against before resolving lower. The median adverse excursion is +4%, the
worst +30%. This is an edge with a fat tail, not a free trade.

### Upside stress (bearish) — only once it persists

Same condition one notch down (skew 90–95th percentile). Day-weighted it looks strong (−8.5% at
21D, p = 0.018), but an isolated day means nothing (−3.3%, 42% higher — the base rate). Once the
state has been on for 3 of the last 10 sessions it is −10.0% with 23% higher. The panel splits
both skew states into *confirmed* and *fresh* for this reason.

### Panic flush (bullish) — weak, and the only long-side result

NG down ≥ 1.5 implied sigmas in 5 sessions **while NGVL rises more than 5%**.

| 5-session drop ≥ 1.5σ and… | n | 21D mean | Higher |
|---|---|---|---|
| NGVL rising > 5% | 85 | +3.7% | 61% |
| NGVL flat | 82 | −3.7% | 30% |
| NGVL falling > 5% | 51 | −0.5% | 47% |

A sell-off that makes option buyers pay up has tended to bounce over 5–21 sessions; the same drop
with no vol response has not. Permutation p = 0.03 at 21D, positive in 8 of 12 years. But at the
level of first signal days it is 57% (n = 47), the edge is gone by 42 sessions, and most of the
mean comes from a handful of large winners. Treat it as a reason not to chase a short, not as a
trough call.

### Troughs leave no signature

At the 19 swing peaks (≥ 25% reversals) in the tradeable index, the skew ratio sat at the 95th
percentile of its trailing 63 sessions (68% of peaks above the 80th, none below the 20th), NGVL had
jumped from 69 to 84 in five sessions, and spot–vol correlation was +0.57 against a +0.15 norm. At
the 19 troughs every one of those readings was indistinguishable from an ordinary day. NG tops are
option-market events; NG bottoms are not. CVOL can help with the short side and with *not* being
long at a top. It cannot time bottoms, and the page should stop implying otherwise.

## 4. What NGVL is genuinely good for: the cost of holding

- NGVL forecasts the next 21 sessions of realized vol better than trailing realized vol does
  (R² 0.68 vs 0.52; trailing adds nothing once NGVL is known). It overstates by about 13% on average.
- Leveraged-ETF volatility drag is close to mechanical in realized variance (KOLD ≈ −3σ²T, R² 0.96;
  BOIL ≈ −σ²T, R² 0.82), so NGVL prices it in advance:

| NGVL | BOIL drag / 21 sessions | KOLD drag / 21 sessions |
|---|---|---|
| < 40 | −0.8% | −1.9% |
| 40–55 | −1.4% | −3.8% |
| 55–70 | −2.1% | −5.6% |
| 70–85 | −2.6% | −7.6% |
| 85–100 | −4.6% | −11.3% |
| > 100 | −5.5% | −13.0% |

This matters most exactly when the bearish read fires. In blow-off states, long KOLD returned a
median +17.7% over 21 sessions (72% positive); short BOIL returned +25.1% (82%). At high vol a
bearish view is materially cheaper to carry as short BOIL than as long KOLD. The panel shows this
drag for today's NGVL from historical analog days.

## 5. What changed on the page

- **New Directional Edge panel** at the top: current state, how close each trigger is, evidence
  table against the base rate (with permutation p-values, episode counts and adverse excursion),
  an episode ledger, and the holding-cost strip. The top banner now leads with this read.
- **All forward returns on the tab** (surface analogs, scorecard, timeline, threshold sensitivity)
  are now on the tradeable basis; realized vol and VRP are on the roll-free series.
- `VOL_UNDERPRICED` now requires realized to actually exceed implied; a low 21-day z-score of the
  premium alone no longer triggers it (857 → 510 days).

## 6. What I would remove or demote, and have not

These are judgement calls about your page, so they are left in place:

- **SAD, CI, CVC↑/↓, RDS composites and their scorecard.** On tradeable returns none has a
  defensible directional edge; several point the wrong way (`CI` "complacency" 41% right at 21D,
  `SAD` upside-skew 30%). `RDS` downside is 75% on 48 events and worth a second look; the rest are
  five panels, five sparklines, a sensitivity table and a confluence score built on noise.
- **Regime Tension, Wing Divergence, Skew Acceleration, Convexity-Adjusted Wing Spread, Surface
  Velocity, Price-Skew Dislocation.** Products and second differences of 21-day z-scores. None
  showed up in the scan.
- **The 252-day percentile bands.** NGVL's median runs from 43 in August to 70 in December and the
  skew ratio from 1.10 to 1.39. A 252-day window half-resets every winter, which is why
  "EXTREME" lights up each autumn. The expanding percentile used by the edge model is the better
  yardstick; a same-season percentile would be better still for the vol-regime display.
- **The surface-state model's eight states.** With clean returns only `DOWNSIDE_TAIL_BID` keeps a
  directional edge (64% vs 58% base). It is a fair description of the surface but it is not a
  trading model, and it should sit below the edge panel rather than compete with it.

## 7. Limits of this work

- Thresholds (95/90 percentile, 1.5σ, +5%) were chosen after looking at the same history. Results
  are monotonic in the thresholds and stable across halves, which argues against a fluke, but the
  effect sizes are optimistic. There is no untouched hold-out sample.
- The independent sample is episodes: 11 blow-offs, 18 stress episodes, 36 flushes in 12 years.
- The tradeable index is built from BOIL/KOLD closes; its returns are close-to-close on US equity
  hours while CVOL rows are CME values (and since April 2026, intraday snapshots).
- Nothing here uses storage, weather or positioning. The December 2024 failure was a fundamental
  cold-driven repricing; the options surface alone could not have distinguished it.
