# Active Alerts — what the volume, flow and options data can and cannot call

*Study date 2026-11-16. Data: BOIL / KOLD daily OHLCV 2011-10 → 2026-11 (3,799 sessions), BOIL / KOLD
fund flows 2016 → 2026, CME CVOL 2013-10 → 2026-11. Reproduce with `python tools/alerts_research.py`;
the live panel recomputes everything in `docs/js/alert-engine.js` (checked by `node tools/test_alert_engine.mjs`).*

## How things are measured

Forward returns are on the **tradeable NG index**, the roll-adjusted unlevered return implied by the
BOIL / KOLD pair, `(r_BOIL − r_KOLD) / 4`. On that basis NG was higher 21 sessions later on 41–42% of
days (average −1.5%), so a random short wins about 58% of 21-session holds and a random long 42%.
That is the bar. A signal that "wins 55% short" is worse than doing nothing clever.

Every rule is scored two ways: day by day, and as **non-overlapping trades** (enter at the close of
the first day the rule is true, hold N sessions, then look for the next entry) with an exact
binomial p-value against the any-day benchmark for the same side and hold. Percentiles are
expanding, so nothing looks ahead; the test suite truncates the history and checks that no earlier
signal changes.

## 1. The alert feed that was removed

| Rule (as the feed fired it) | Share of all days | NG higher 21 sessions later | Average 21-session move |
|---|---|---|---|
| BOIL VCVI ≥ 88 in any window — badged "↑ BOTTOM" | 20.5% | 47% (base 41%) | −0.7% (base −1.6%) |
| KOLD VCVI ≥ 88 in any window — badged "↓ TOP" | 13.1% | 43% | −1.5% |
| BOIL MWCA | 7.3% | 35% | −3.6% |
| KOLD MWCA | 4.2% | 46% | −0.7% |
| BOIL RVOL ≥ 3.5x | 8.1% | 31% | −5.0% |
| KOLD RVOL ≥ 3.5x | 9.4% | 40% | −2.9% |

The "BOTTOM" badge was on one day in five and NG still lost money on average afterwards. The "TOP"
badge did not separate from a random day. The one thing in the feed with information pointed the
other way from how it read: **a BOIL volume spike is followed by lower NG, not a bottom.** That is
kept, with its sign corrected, inside the CROWDED RALLY setup.

## 2. What actually has information

Rank correlation with the 21-session forward return, full sample and by half:

| Feature | IC | First half | Second half |
|---|---|---|---|
| Implied vol level (NGVL percentile) | −0.20 | −0.22 | −0.22 |
| Realized vol, 21 sessions | −0.13 | −0.12 | −0.14 |
| **CMF-21 of KOLD** | **+0.14** | +0.17 | +0.13 |
| **CMF-21 of BOIL** | **−0.11** | −0.06 | −0.16 |
| Call-skew ratio percentile | −0.13 | −0.17 | −0.12 |
| PVT trend / z-score, either ETF | ±0.06–0.08 | unstable or small | |
| Volume spikes (RVOL, percentile, z-score) | −0.01 to −0.09 | small | |
| Capitulation indices (CVI / VCVI) | −0.03 to −0.08 | small, wrong sign for a "bottom" | |
| Fund flows, 1 / 5 / 20 sessions, either ETF | ±0.00–0.06 | **sign mostly flips between halves** | |
| KOLD share of dollar volume | −0.02 | −0.13 | +0.14 |
| Past 5 / 10 / 21-session return | ≈ 0 | | |

Three things carry a stable signal: the level of volatility (options or realized), the options skew,
and — the new one — **where NG closes within its daily range, weighted by volume** (Chaikin Money
Flow, already one of the Price-Volume Studies). Raw volume, PVT, capitulation indices and fund flows
do not, on their own.

### Closing pressure

`CP = (CMF21_BOIL − CMF21_KOLD) / 2` on dollar volume. High = NG has been closing near its daily
highs on volume for a month. It is **contrarian**:

- 21-session forward return by CP quintile (weakest closes → strongest): +1.0%, −0.4%, −0.8%, −2.7%, −4.0%;
  NG higher 50%, 45%, 44%, 39%, 34%.
- The sign is the same in every 3-year block from 2011 to 2026 (IC between +0.08 and +0.36 on the
  weak-close orientation), in both seasons relative to their own base, and inside each
  realized-vol tercile.
- It is not a disguised return-reversal: the trailing 21-session return itself has an IC of −0.03.
  The information is in the close location, which is consistent with leveraged-ETF rebalancing and
  late chasing pushing closes in the direction of the trend until the move is exhausted.
- Sensitivity: the 21-session window with the top 5–10% is the sweet spot (79% / 76% short wins).
  Top 15–20% decays to the benchmark, and 10- or 42-session windows give 64–68%. Same sign
  everywhere, never below the benchmark, but the size depends on the window — expect less out of
  sample than the headline.

## 3. The setups on the panel

Numbers from the live engine (2012-10 → 2026-11):

| Setup | Side / hold | Trades won | Any-day | Avg, NG basis | Avg, ETF leg | p | Halves | Tier |
|---|---|---|---|---|---|---|---|---|
| **CLOSE EXHAUSTION** — CP ≥ 90th pct | short 21 | 32 / 42 (76%) | 58% | +5.8% | KOLD +9.9% | 0.011 | 71% / 80% | STRONG |
| **OPTIONS BLOW-OFF** — CVOL tab state | short 21 | 11 / 13 (85%) | 58% | +9.8% | KOLD +14.2% | 0.042 | 75% / 89% | STRONG, small sample |
| CROWDED RALLY — BOIL volume climax & CP ≥ 80th | short 21 | 21 / 28 (75%) | 58% | +6.7% | KOLD +11.3% | 0.047 | 82% / 71% | MODERATE (10-session hold is a coin flip) |
| CHASED RALLY — BOIL creations ≥ 90th & realized vol ≥ 70th | short 21 | 14 / 21 (67%) | 58% | +7.8% | KOLD +13.2% | 0.28 | 25% (4) / 76% | WEAK |
| **CAPITULATION REVERSAL** — options panic flush & CP ≤ 20th | long 21 | 12 / 16 (75%) | 42% | +8.1% | BOIL +15.8% | 0.008 | 71% / 78% | MODERATE (capped) |
| WASHOUT — CP ≤ 10th & 63-session drawdown ≤ −25% | long 10 | 15 / 25 (60%) | 45% | +2.8% | BOIL +5.3% | 0.088 | 60% / 60% | MODERATE |

Notes that matter for trading them:

- **Blow-off and close exhaustion are different information.** Blow-off days without strong closes:
  NG higher 17% of the time, −11.2%. Blow-off days with CP in the top 20%: 9%, −18.3%. When both
  are on, that is the highest-conviction short this data can produce.
- **The long side needs a vol response.** A panic flush without weak closes bounced 38% of the time
  (worse than random); weak closes alone are a coin flip; together 75–79%. A slow bleed with weak
  closes in calm vol keeps bleeding. This also means the PANIC FLUSH state on the CVOL tab should
  carry the closing-pressure condition (logged in the backlog).
- **Leveraged legs.** The ETF-leg averages include volatility drag; KOLD's averages look good
  because NG's own drift is negative, but the win rate on the KOLD leg is lower than on the NG basis
  (about 55–64%), because drag eats the small wins.
- **Worst cases.** Close exhaustion's worst trade was −28% on the NG basis after being 37% offside.
  These are probabilities, not stops.

## 4. Combining more indicators did not help

An equal-weight score over seven bearish conditions (strong closes at two thresholds, hot realized
vol, options blow-off / stress, BOIL volume climax, a stretched 5-session rally, heavy BOIL
creations) is monotonic by day — score 0: NG higher 48%; score 2: 36%; score 4: 17% — but as trades
it is no better than its two best components alone (score ≥ 4: 64–68% short wins over 28–40 trades,
p 0.08–0.31, versus 76% for close exhaustion alone). Leaving flows out does not hurt it. So the panel
shows named setups and a strip of inputs, not a blended score: a score would look more
sophisticated and be less reliable.

## 5. What this cannot do

- Rules and thresholds were chosen on the same history they are scored on. The two STRONG setups
  were single, round-number conditions; the others were found by scanning a few hundred pairs and
  are capped at MODERATE for that reason. There is no hold-out.
- 13 to 42 independent trades per setup in 12–15 years. Two or three bad trades move the win rate
  by ten points.
- Nothing here times entries inside the day or tells you when a setup has failed. The panel shows
  how far through the holding window a trigger is, not a stop.
- Between setups — most days — volume, flows and options carry no directional information. The
  panel then says so. That is a finding, not a gap.
