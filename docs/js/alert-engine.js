/* ============================================
   Active Alerts — evidence-scored setups
   ============================================
   Replaces the old VCVI / MWCA / RVOL threshold feed. Those rules fired on roughly one day in
   five and their forward returns did not separate from the base rate (docs/alerts_research.md).

   Every alert here is a named setup that:
     * is built from causal inputs only (expanding percentiles, no look-ahead),
     * is scored as NON-OVERLAPPING trades on the tradeable NG index — the roll-adjusted,
       unlevered return implied by the BOIL / KOLD pair, (r_BOIL - r_KOLD) / 4,
     * is compared with the any-day benchmark for the same side and hold (being short NG on a
       random day already wins ~58% of 21-session holds, so 58% is the bar, not 50%).
   All statistics are recomputed from history on every load. Nothing is hard-coded except the
   setup definitions and a tier cap for setups that were found by scanning combinations.

   Inputs
     Closing pressure (CP): (CMF21_BOIL - CMF21_KOLD) / 2 on dollar volume. Positive = NG has
       been closing in the upper part of its daily range on volume. This is the one volume-side
       input with a stable relationship to forward returns (same sign in every 3-year block
       2011-2026), and it is contrarian: persistent strong closes precede declines.
     Realized-vol regime: 21-session realized vol of the tradeable index, expanding percentile.
     BOIL volume climax: the existing MWCA / RVOL spike logic on BOIL share volume.
     Options state: CALL-SKEW EXTREME / UPSIDE STRESS / VOL-SPIKE SELLOFF, same definitions as the
       CVOL tab (internal keys BLOWOFF / UPSIDE_STRESS / PANIC_FLUSH).
     Fund flows: BOIL 5-session net creations, lagged one session (shares outstanding publish T+1).
     Toronto cross-check: the same closing-pressure measure on HNU / HND. It is not a rule input.
       It tracks the US reading closely, so a disagreement points at a data problem or a
       single-venue distortion rather than at a different view of gas.
*/

const AlertEngine = {

    CFG: {
        minHistory: 252,          // sessions before any percentile or trade is evaluated
        cmfWindow: 21,
        rvWindow: 21,
        ddWindow: 63,
        pairDisagree: 0.08,       // |r_BOIL/2 + r_KOLD/2| above this = bad print; trust the smaller move
        volWindows: [5, 10, 21, 63, 126, 252],
        mwcaPct: 90,
        rvolSpike: 3.5,
        flowLag: 1,
        flowStaleSessions: 4,     // flows older than this many sessions are not used for a live read
        xStaleDays: 4,            // Toronto reading older than this many calendar days is not carried
        xAgree: 80,               // Toronto percentile that counts as agreeing with a US reading >= 90th
        // options states (keep in sync with EDGE_CFG in cvol.js)
        skewBlow: 95, skewStress: 90, volGate: 90, flushSigma: -1.5, flushVolRise: 0.05, idxVolRatio: 0.8,
        holds: [10, 21],
    },

    // side: 'short' = NG lower (KOLD is the leg), 'long' = NG higher (BOIL is the leg).
    // maxTier caps the evidence tier for setups that were found by scanning combinations, because
    // their p-value does not account for the search.
    SETUPS: [
        {
            key: 'CLOSE_EXHAUSTION', label: 'CLOSING-PRESSURE EXTREME', side: 'short', hold: 21, family: 'PRICE-VOLUME', maxTier: 'STRONG',
            rule: 'Closing pressure at or above its 90th percentile',
            why: 'NG has closed near its daily highs on volume for a month. Leveraged-ETF rebalancing and late momentum buying push closes in the direction of the trend; when that pressure is extreme the advance has usually been exhausted.',
            test: function(f, i) { return f.cpPe[i] != null && f.cpPe[i] >= 90; },
        },
        {
            key: 'OPT_BLOWOFF', label: 'CALL-SKEW EXTREME', side: 'short', hold: 21, family: 'OPTIONS', maxTier: 'STRONG',
            rule: 'Call skew at or above its 95th percentile with implied volatility at or above its 90th',
            why: 'The options market is paying a premium for upside while implied volatility is already extreme. Same state as the Directional Edge panel on the CVOL tab.',
            test: function(f, i) { return f.optState[i] === 'BLOWOFF'; },
        },
        {
            key: 'CROWDED_RALLY', label: 'LONG-SIDE VOLUME CLIMAX', side: 'short', hold: 21, family: 'VOLUME', maxTier: 'MODERATE',
            rule: 'BOIL volume climax (MWCA or RVOL ≥ 3.5x) with closing pressure at or above its 80th percentile',
            why: 'A BOIL volume spike is not a bottom signal: on its own, NG was lower 21 sessions later about two times in three. Combined with strong closes it marks crowded long positioning late in an advance.',
            test: function(f, i) { return f.boilClimax[i] && f.cpPe[i] != null && f.cpPe[i] >= 80; },
        },
        {
            key: 'CHASED_RALLY', label: 'INFLOW SURGE', side: 'short', hold: 21, family: 'FUND FLOWS', maxTier: 'MODERATE',
            rule: 'BOIL five-session creations at or above their 90th percentile with realized volatility at or above its 70th',
            why: 'Heavy creations into BOIL while realized volatility is elevated. Flow data begins in 2016, so the sample is short and the first half of the history has almost no trades.',
            test: function(f, i) { return f.flowPe[i] != null && f.flowPe[i] >= 90 && f.rvPe[i] != null && f.rvPe[i] >= 70; },
        },
        {
            key: 'CAPITULATION', label: 'CAPITULATION', side: 'long', hold: 21, family: 'OPTIONS + PRICE-VOLUME', maxTier: 'MODERATE',
            rule: 'Options vol-spike selloff with closing pressure at or below its 20th percentile',
            why: 'A sharp decline that implied volatility is responding to, after a month of weak closes. The volatility response separates capitulation from a gradual decline: the same selloff without weak closes recovered only 38% of the time, and weak closes on their own carried no edge.',
            test: function(f, i) { return f.optState[i] === 'PANIC_FLUSH' && f.cpPe[i] != null && f.cpPe[i] <= 20; },
        },
        {
            key: 'WASHOUT', label: 'OVERSOLD DRAWDOWN', side: 'long', hold: 10, family: 'PRICE-VOLUME', maxTier: 'MODERATE',
            rule: 'Closing pressure at or below its 10th percentile with NG 25% or more below its 63-session high',
            why: 'Persistently weak closes after a deep drawdown. The edge is on a 10-session hold and is threshold-sensitive (at the 20th percentile it disappears), so read it as a short-term rebound rather than a change of trend.',
            test: function(f, i) { return f.cpPe[i] != null && f.cpPe[i] <= 10 && f.dd63[i] != null && f.dd63[i] <= -0.25; },
        },
    ],

    // ── small numeric helpers ────────────────────────────────────────────────
    expandingPercentile(arr, minN) {
        const out = new Array(arr.length).fill(null), sorted = [];
        for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            if (v == null || !isFinite(v)) continue;
            let lo = 0, hi = sorted.length;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
            sorted.splice(lo, 0, v);
            if (sorted.length >= minN) out[i] = (lo + 1) / sorted.length * 100;
        }
        return out;
    },

    binomTail(k, n, p) {
        if (n <= 0 || p == null || p <= 0 || p >= 1) return null;
        let logC = 0, tail = 0;
        for (let i = 0; i <= n; i++) {
            if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
            if (i >= k) tail += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log(1 - p));
        }
        return Math.min(1, tail);
    },

    // ── data preparation ─────────────────────────────────────────────────────
    parseCvolCsv(text) {
        const rows = [];
        if (!text) return rows;
        const lines = text.trim().split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
            const p = lines[i].split(',');
            if (p.length < 9) continue;
            const dp = p[0].trim().split('-');
            if (dp.length !== 3) continue;
            const iso = dp[2] + '-' + dp[1] + '-' + dp[0];
            const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
            if (dow === 0 || dow === 6) continue;
            const ngvl = parseFloat(p[1]), sr = parseFloat(p[5]);
            if (!isFinite(ngvl) || !isFinite(sr)) continue;
            rows.push({ date: iso, ngvl: ngvl, skewRatio: sr });
        }
        rows.sort(function(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
        return rows;
    },

    flowMap(json) {
        const out = {};
        const rows = json && Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
        for (const r of rows) if (r && r.date && r.usd_flow != null && isFinite(r.usd_flow)) out[r.date] = r.usd_flow;
        return out;
    },

    // Chaikin money flow on dollar volume over `win` sessions. A zero-range bar contributes nothing.
    cmfSeries(H, win) {
        const n = H.length, mfv = new Float64Array(n), dv = new Float64Array(n), out = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            const h = H[i].high, l = H[i].low, c = H[i].close, v = H[i].volume || 0;
            dv[i] = c * v;
            mfv[i] = (h > l && h != null && l != null) ? ((c - l) - (h - c)) / (h - l) * dv[i] : 0;
        }
        let a = 0, d = 0;
        for (let i = 0; i < n; i++) {
            a += mfv[i]; d += dv[i];
            if (i >= win) { a -= mfv[i - win]; d -= dv[i - win]; }
            if (i >= win - 1 && d > 0) out[i] = a / d;
        }
        return out;
    },

    // Closing pressure of a long / short ETF pair on their shared calendar:
    // (CMF of the long ETF - CMF of the short ETF) / 2, with its expanding percentile.
    pairClosingPressure(longHist, shortHist) {
        const sMap = {}, L = [], S = [];
        for (const b of shortHist || []) if (b && b.date && b.close > 0) sMap[b.date] = b;
        for (const b of longHist || []) if (b && b.date && b.close > 0 && sMap[b.date]) { L.push(b); S.push(sMap[b.date]); }
        const cl = this.cmfSeries(L, this.CFG.cmfWindow), cs = this.cmfSeries(S, this.CFG.cmfWindow);
        const cp = cl.map(function(v, i) { return v != null && cs[i] != null ? (v - cs[i]) / 2 : null; });
        return { dates: L.map(function(b) { return b.date; }), cp: cp, cpPe: this.expandingPercentile(cp, this.CFG.minHistory) };
    },

    // Build the per-session feature frame on the BOIL ∩ KOLD calendar.
    // xLong / xShort (optional): HNU / HND history for the Toronto cross-check.
    buildFrame(boilHist, koldHist, cvolRows, boilFlows, xLong, xShort) {
        const cfg = this.CFG;
        const kMap = {};
        for (const b of koldHist || []) if (b && b.date && b.close > 0) kMap[b.date] = b;
        const B = [], K = [];
        for (const b of boilHist || []) {
            if (b && b.date && b.close > 0 && kMap[b.date]) { B.push(b); K.push(kMap[b.date]); }
        }
        const n = B.length;
        const f = { n: n, dates: B.map(function(b) { return b.date; }) };
        if (n < cfg.minHistory + 30) return f;

        // tradeable index (log level) and the two ETF log levels
        const li = new Float64Array(n), lr = new Float64Array(n), lb = new Float64Array(n), lk = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            lb[i] = Math.log(B[i].close); lk[i] = Math.log(K[i].close);
            if (i === 0) continue;
            const rb = B[i].close / B[i - 1].close - 1, rk = K[i].close / K[i - 1].close - 1;
            let r = (rb - rk) / 4;
            if (Math.abs(rb / 2 + rk / 2) > cfg.pairDisagree) r = Math.abs(rb) < Math.abs(rk) ? rb / 2 : -rk / 2;
            lr[i] = Math.log(1 + r);
            li[i] = li[i - 1] + lr[i];
        }
        f.li = li; f.lb = lb; f.lk = lk;

        // realized vol (sample std of the last 21 log returns) and its expanding percentile
        const rv = new Array(n).fill(null), w = cfg.rvWindow;
        for (let i = w - 1; i < n; i++) {
            let s = 0, s2 = 0;
            for (let j = i - w + 1; j <= i; j++) { s += lr[j]; s2 += lr[j] * lr[j]; }
            rv[i] = Math.sqrt(Math.max(0, (s2 - s * s / w) / (w - 1)));
        }
        f.rv = rv; f.rvPe = this.expandingPercentile(rv, cfg.minHistory);

        // closing pressure: (CMF21_BOIL - CMF21_KOLD) / 2 on dollar volume
        const cb = this.cmfSeries(B, cfg.cmfWindow), ck = this.cmfSeries(K, cfg.cmfWindow), cp = new Array(n).fill(null);
        for (let i = 0; i < n; i++) if (cb[i] != null && ck[i] != null) cp[i] = (cb[i] - ck[i]) / 2;
        f.cp = cp; f.cpPe = this.expandingPercentile(cp, cfg.minHistory);

        // Toronto cross-check: the same measure on HNU / HND, ranked on its own history and mapped to
        // the US calendar by date (a reading up to xStaleDays calendar days old is carried forward).
        const cpX = new Array(n).fill(null), cpXPe = new Array(n).fill(null);
        f.xLastDate = null;
        if (xLong && xShort) {
            const x = this.pairClosingPressure(xLong, xShort);
            let q = -1;
            for (let i = 0; i < n; i++) {
                while (q + 1 < x.dates.length && x.dates[q + 1] <= f.dates[i]) q++;
                if (q < 0 || x.cp[q] == null) continue;
                const age = (Date.parse(f.dates[i]) - Date.parse(x.dates[q])) / 86400000;
                if (age <= cfg.xStaleDays) { cpX[i] = x.cp[q]; cpXPe[i] = x.cpPe[q]; }
            }
            if (x.dates.length) f.xLastDate = x.dates[x.dates.length - 1];
        }
        f.cpX = cpX; f.cpXPe = cpXPe;

        // drawdown from the 63-session high of the tradeable index
        const dd = new Array(n).fill(null);
        for (let i = cfg.ddWindow - 1; i < n; i++) {
            let mx = -Infinity;
            for (let j = i - cfg.ddWindow + 1; j <= i; j++) if (li[j] > mx) mx = li[j];
            dd[i] = Math.exp(li[i] - mx) - 1;
        }
        f.dd63 = dd;

        // BOIL volume climax: all-window 90th percentile (MWCA) or any-window RVOL >= 3.5x
        const vol = B.map(function(b) { return b.volume || 0; });
        const climax = new Array(n).fill(false), rvolMax = new Array(n).fill(null), mwca = new Array(n).fill(false);
        const maxW = cfg.volWindows[cfg.volWindows.length - 1];
        for (let i = maxW - 1; i < n; i++) {
            let all = true, best = 0;
            for (const win of cfg.volWindows) {
                let le = 0, sum = 0;
                for (let j = i - win + 1; j <= i; j++) { if (vol[j] <= vol[i]) le++; sum += vol[j]; }
                if (le / win * 100 < cfg.mwcaPct) all = false;
                const mean = sum / win;
                if (mean > 0 && vol[i] / mean > best) best = vol[i] / mean;
            }
            mwca[i] = all && vol[i] > 0; rvolMax[i] = best;
            climax[i] = mwca[i] || best >= cfg.rvolSpike;
        }
        f.boilClimax = climax; f.boilMwca = mwca; f.boilRvolMax = rvolMax;

        // BOIL 5-session net flow, scaled by the trailing mean absolute daily flow, lagged one session
        const flowPe = new Array(n).fill(null), flow5 = new Array(n).fill(null);
        let flowLastIdx = -1;
        if (boilFlows) {
            const fl = f.dates.map(function(d) { return boilFlows[d] != null ? boilFlows[d] : null; });
            const raw = new Array(n).fill(null);
            for (let i = 0; i < n; i++) {
                if (fl[i] != null) flowLastIdx = i;
                let s = 0, c = 0;
                for (let j = Math.max(0, i - 4); j <= i; j++) if (fl[j] != null) { s += fl[j]; c++; }
                let a = 0, ac = 0;
                for (let j = Math.max(0, i - 252); j < i; j++) if (fl[j] != null) { a += Math.abs(fl[j]); ac++; }
                if (c >= 2 && ac >= 120 && a > 0) raw[i] = s / (a / ac * Math.sqrt(5));
            }
            const lagged = raw.map(function(_, i) { return i >= cfg.flowLag ? raw[i - cfg.flowLag] : null; });
            const pe = this.expandingPercentile(lagged, cfg.minHistory);
            for (let i = 0; i < n; i++) { flowPe[i] = pe[i]; flow5[i] = lagged[i]; }
        }
        f.flowPe = flowPe; f.flow5 = flow5; f.flowLastIdx = flowLastIdx;
        f.flowStale = !boilFlows || flowLastIdx < 0 || (n - 1 - flowLastIdx) > cfg.flowStaleSessions;
        if (f.flowStale && n) f.flowPe[n - 1] = null;

        // options states, computed on the CVOL calendar (as the CVOL tab does) then mapped by date
        const optState = new Array(n).fill(null), skewPeArr = new Array(n).fill(null), ngvlPeArr = new Array(n).fill(null);
        f.optLastDate = null;
        if (cvolRows && cvolRows.length > cfg.minHistory) {
            const m = cvolRows.length;
            const skewPe = this.expandingPercentile(cvolRows.map(function(r) { return r.skewRatio; }), cfg.minHistory);
            const ngvlPe = this.expandingPercentile(cvolRows.map(function(r) { return r.ngvl; }), cfg.minHistory);
            // index level on each CVOL date = last index level on or before it
            const lvl = new Array(m).fill(null);
            let p = -1;
            for (let i = 0; i < m; i++) {
                while (p + 1 < n && f.dates[p + 1] <= cvolRows[i].date) p++;
                if (p >= 0) lvl[i] = li[p];
            }
            const byDate = {};
            for (let i = 0; i < m; i++) {
                let state = 'NEUTRAL';
                if (i >= cfg.minHistory && skewPe[i] != null && ngvlPe[i] != null) {
                    const hot = ngvlPe[i] >= cfg.volGate;
                    let move5 = null, volChg5 = null;
                    if (i >= 5) {
                        const v0 = cvolRows[i - 5].ngvl, v1 = cvolRows[i].ngvl;
                        if (lvl[i] != null && lvl[i - 5] != null && v0 > 0) move5 = (lvl[i] - lvl[i - 5]) / (cfg.idxVolRatio * v0 / 100 * Math.sqrt(5 / 252));
                        if (v0 > 0 && v1 > 0) volChg5 = Math.log(v1 / v0);
                    }
                    if (hot && skewPe[i] >= cfg.skewBlow) state = 'BLOWOFF';
                    else if (hot && skewPe[i] >= cfg.skewStress) state = 'UPSIDE_STRESS';
                    else if (move5 != null && volChg5 != null && move5 <= cfg.flushSigma && volChg5 > cfg.flushVolRise) state = 'PANIC_FLUSH';
                }
                byDate[cvolRows[i].date] = { state: state, skewPe: skewPe[i], ngvlPe: ngvlPe[i] };
            }
            for (let i = 0; i < n; i++) {
                const o = byDate[f.dates[i]];
                if (o) { optState[i] = o.state; skewPeArr[i] = o.skewPe; ngvlPeArr[i] = o.ngvlPe; }
            }
            f.optLastDate = cvolRows[m - 1].date;
        }
        f.optState = optState; f.skewPe = skewPeArr; f.ngvlPe = ngvlPeArr;
        return f;
    },

    // ── trade scoring ────────────────────────────────────────────────────────
    benchmark(f, side, hold) {
        const sgn = side === 'short' ? -1 : 1, start = this.CFG.minHistory;
        let n = 0, wins = 0, sum = 0;
        for (let i = start; i + hold < f.n; i++) {
            const r = sgn * (Math.exp(f.li[i + hold] - f.li[i]) - 1);
            n++; sum += r; if (r > 0) wins++;
        }
        return { n: n, winRate: n ? wins / n * 100 : null, mean: n ? sum / n * 100 : null };
    },

    buildTrades(f, mask, side, hold) {
        const sgn = side === 'short' ? -1 : 1, leg = side === 'short' ? f.lk : f.lb, trades = [];
        let i = this.CFG.minHistory;
        while (i < f.n) {
            if (!mask[i]) { i++; continue; }
            const j = Math.min(f.n - 1, i + hold);
            let heat = 0;
            for (let k = i + 1; k <= j; k++) {
                const mv = sgn * (Math.exp(f.li[k] - f.li[i]) - 1) * 100;
                if (mv < heat) heat = mv;
            }
            trades.push({
                entryIdx: i, exitIdx: j, entry: f.dates[i], exit: f.dates[j], sessions: j - i,
                ng: (Math.exp(f.li[j] - f.li[i]) - 1) * 100,
                pnl: sgn * (Math.exp(f.li[j] - f.li[i]) - 1) * 100,
                leg: (Math.exp(leg[j] - leg[i]) - 1) * 100,
                heat: heat, open: i + hold > f.n - 1,
            });
            i = j + 1;
        }
        return trades;
    },

    tradeStats(trades, bench, half) {
        const done = trades.filter(function(t) { return !t.open; });
        const pnl = done.map(function(t) { return t.pnl; });
        const wins = pnl.filter(function(v) { return v > 0; });
        const gain = wins.reduce(function(a, b) { return a + b; }, 0);
        const loss = -pnl.filter(function(v) { return v < 0; }).reduce(function(a, b) { return a + b; }, 0);
        const rate = function(arr) { return arr.length ? arr.filter(function(t) { return t.pnl > 0; }).length / arr.length * 100 : null; };
        const h1 = done.filter(function(t) { return t.entryIdx < half; }), h2 = done.filter(function(t) { return t.entryIdx >= half; });
        const legs = done.map(function(t) { return t.leg; });
        return {
            n: done.length, wins: wins.length,
            winRate: done.length ? wins.length / done.length * 100 : null,
            mean: done.length ? pnl.reduce(function(a, b) { return a + b; }, 0) / done.length : null,
            profitFactor: loss > 0 ? gain / loss : (gain > 0 ? Infinity : null),
            worst: pnl.length ? Math.min.apply(null, pnl) : null,
            worstHeat: done.length ? Math.min.apply(null, done.map(function(t) { return t.heat; })) : null,
            legMean: legs.length ? legs.reduce(function(a, b) { return a + b; }, 0) / legs.length : null,
            legWinRate: legs.length ? legs.filter(function(v) { return v > 0; }).length / legs.length * 100 : null,
            h1n: h1.length, h1Rate: rate(h1), h2n: h2.length, h2Rate: rate(h2),
            benchWinRate: bench.winRate, benchMean: bench.mean,
            p: done.length ? this.binomTail(wins.length, done.length, bench.winRate / 100) : null,
        };
    },

    // Evidence tier from the numbers themselves, capped by the setup's maxTier.
    //   STRONG   : p <= 0.05 on the primary hold, both halves at or above the benchmark,
    //              and the other hold also beats the benchmark win rate
    //   MODERATE : p <= 0.10 on the primary hold and the win rate beats the benchmark
    //   WEAK     : anything else that still beats the benchmark; NONE otherwise
    tierOf(primary, other, maxTier) {
        const order = ['NONE', 'WEAK', 'MODERATE', 'STRONG'];
        let tier = 'NONE';
        if (primary && primary.n >= 8 && primary.winRate != null && primary.winRate > primary.benchWinRate) {
            tier = 'WEAK';
            if (primary.p != null && primary.p <= 0.10) tier = 'MODERATE';
            const halvesOk = primary.h1Rate != null && primary.h2Rate != null &&
                primary.h1Rate >= primary.benchWinRate && primary.h2Rate >= primary.benchWinRate;
            const otherOk = other && other.winRate != null && other.winRate > other.benchWinRate;
            if (primary.p != null && primary.p <= 0.05 && halvesOk && otherOk) tier = 'STRONG';
        }
        return order[Math.min(order.indexOf(tier), order.indexOf(maxTier || 'STRONG'))];
    },

    // How closely the Toronto pair has tracked the US reading, from the frame itself.
    crossCheckStats(f) {
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, hi = 0, hiAgree = 0;
        for (let i = this.CFG.minHistory; i < f.n; i++) {
            const a = f.cp[i], b = f.cpX[i];
            if (a == null || b == null) continue;
            n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
            if (f.cpPe[i] != null && f.cpPe[i] >= 90 && f.cpXPe[i] != null) { hi++; if (f.cpXPe[i] >= this.CFG.xAgree) hiAgree++; }
        }
        const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
        return { n: n, corr: n > 30 && den > 0 ? (n * sxy - sx * sy) / den : null, extremeDays: hi, extremeAgree: hiAgree };
    },

    compute(boilHist, koldHist, cvolRows, boilFlows, xLong, xShort) {
        const f = this.buildFrame(boilHist, koldHist, cvolRows, boilFlows, xLong, xShort);
        const model = { ready: false, frame: f, setups: [], asOf: f.n ? f.dates[f.n - 1] : null };
        if (!f.li) return model;
        const self = this, last = f.n - 1, half = Math.floor(f.n / 2);
        model.bench = {};
        for (const side of ['short', 'long']) {
            model.bench[side] = {};
            for (const h of this.CFG.holds) model.bench[side][h] = this.benchmark(f, side, h);
        }
        for (const s of this.SETUPS) {
            const mask = new Array(f.n);
            for (let i = 0; i < f.n; i++) mask[i] = i >= this.CFG.minHistory && !!s.test(f, i);
            const byHold = {};
            for (const h of this.CFG.holds) {
                const trades = this.buildTrades(f, mask, s.side, h);
                byHold[h] = { trades: trades, stats: this.tradeStats(trades, model.bench[s.side][h], half) };
            }
            const otherHold = this.CFG.holds.filter(function(h) { return h !== s.hold; })[0];
            const primary = byHold[s.hold];
            // status: ACTIVE (rule true today), IN_WINDOW (a trade from an earlier trigger is still open), OFF
            let streak = 0;
            for (let i = last; i >= 0 && mask[i]; i--) streak++;
            const openTrade = primary.trades.length && primary.trades[primary.trades.length - 1].open ? primary.trades[primary.trades.length - 1] : null;
            let lastFired = null;
            for (let i = last; i >= 0; i--) if (mask[i]) { lastFired = f.dates[i]; break; }
            const days = mask.reduce(function(a, b) { return a + (b ? 1 : 0); }, 0);
            const needsOptions = s.family.indexOf('OPTIONS') >= 0, needsFlows = s.family.indexOf('FLOWS') >= 0;
            model.setups.push({
                key: s.key, label: s.label, side: s.side, hold: s.hold, family: s.family, rule: s.rule, why: s.why, maxTier: s.maxTier,
                mask: mask, days: days,
                status: mask[last] ? 'ACTIVE' : (openTrade ? 'IN_WINDOW' : 'OFF'),
                streak: streak, since: streak ? f.dates[last - streak + 1] : null,
                openTrade: openTrade, lastFired: lastFired,
                tier: self.tierOf(primary.stats, byHold[otherHold] ? byHold[otherHold].stats : null, s.maxTier),
                stats: primary.stats, trades: primary.trades,
                otherHold: otherHold, otherStats: byHold[otherHold] ? byHold[otherHold].stats : null,
                unavailable: (needsOptions && !f.optLastDate) || (needsFlows && f.flowStale),
            });
        }
        model.inputs = {
            cpPe: f.cpPe[last], cp: f.cp[last], rvPe: f.rvPe[last], rv: f.rv[last] != null ? f.rv[last] * Math.sqrt(252) * 100 : null,
            dd63: f.dd63[last], boilClimax: f.boilClimax[last], boilRvolMax: f.boilRvolMax[last], boilMwca: f.boilMwca[last],
            optState: f.optState[last], optDate: f.optLastDate, skewPe: f.skewPe[last], ngvlPe: f.ngvlPe[last],
            flowPe: f.flowPe[last], flowStale: f.flowStale, flowDate: f.flowLastIdx >= 0 ? f.dates[f.flowLastIdx] : null,
            cpXPe: f.cpXPe[last], xDate: f.xLastDate, xStats: this.crossCheckStats(f),
        };
        model.ready = true;
        return model;
    },

    // Setups whose rule was true on a given date, for marking the heat map: [{label, side, tier}].
    // Only setups with a MODERATE or STRONG evidence tier are marked.
    setupsOn(date) {
        const m = this._model;
        if (!m || !m.ready) return null;
        if (!m._byDate) {
            const by = {};
            for (const s of m.setups) {
                if (s.tier !== 'MODERATE' && s.tier !== 'STRONG') continue;
                for (let i = this.CFG.minHistory; i < m.frame.n; i++) {
                    if (!s.mask[i]) continue;
                    const d = m.frame.dates[i];
                    (by[d] = by[d] || []).push({ label: s.label, side: s.side, tier: s.tier });
                }
            }
            m._byDate = by;
        }
        return m._byDate[date] || null;
    },

    // ── rendering ────────────────────────────────────────────────────────────
    _f(v, d) { return v != null && isFinite(v) ? v.toFixed(d == null ? 0 : d) : '—'; },
    _s(v, d) { return v != null && isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%' : '—'; },
    _p(v) { return v == null ? '—' : (v < 0.001 ? '<0.001' : v.toFixed(3)); },
    _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    _tierColor(t) { return t === 'STRONG' ? '#3db87a' : (t === 'MODERATE' ? '#d4a830' : (t === 'WEAK' ? '#8a8a9a' : '#555565')); },
    _optLabel(s) { return s === 'BLOWOFF' ? 'CALL-SKEW EXTREME' : (s === 'UPSIDE_STRESS' ? 'UPSIDE STRESS' : (s === 'PANIC_FLUSH' ? 'VOL-SPIKE SELLOFF' : (s === 'NEUTRAL' ? 'NEUTRAL' : '—'))); },
    _label(key) { const s = this.SETUPS.filter(function(x) { return x.key === key; })[0]; return s ? s.label : key; },
    _ord(v) {
        if (v == null || !isFinite(v)) return '—';
        const n = Math.round(v), t = n % 100;
        return n + (t >= 11 && t <= 13 ? 'th' : (n % 10 === 1 ? 'st' : (n % 10 === 2 ? 'nd' : (n % 10 === 3 ? 'rd' : 'th'))));
    },

    _stat(label, value, sub, tip) {
        return '<div class="aa-stat"' + (tip ? ' data-tooltip="' + this._esc(tip) + '"' : '') + '>' +
            '<span class="aa-stat-label">' + label + '</span><span class="aa-stat-val">' + value + '</span>' +
            (sub ? '<span class="aa-stat-sub">' + sub + '</span>' : '') + '</div>';
    },

    _statGrid(s) {
        const st = s.stats, leg = s.side === 'short' ? 'KOLD' : 'BOIL';
        if (!st || !st.n) return '<div class="aa-rule">No completed trades yet.</div>';
        return '<div class="aa-stats">' +
            this._stat('WIN RATE', this._f(st.winRate) + '%', st.wins + ' of ' + st.n + ' trades', 'Share of completed, non-overlapping trades that made money on the tradeable NG index.') +
            this._stat('ANY-DAY RATE', this._f(st.benchWinRate) + '%', 'same side and hold', 'Win rate of taking the same side for the same hold on every day in the history. This is the benchmark, not 50%.') +
            this._stat('AVG RETURN', this._s(st.mean), 'any-day ' + this._s(st.benchMean), 'Average return per trade on the unlevered, roll-adjusted NG index.') +
            this._stat(leg + ' LEG', this._s(st.legMean), this._f(st.legWinRate) + '% profitable', 'Average return of holding ' + leg + ' itself over the same trades, including leverage and volatility drag.') +
            this._stat('P-VALUE', this._p(st.p), 'vs any-day rate', 'Exact binomial probability of at least this many wins if the setup were no better than the any-day rate.') +
            this._stat('WORST TRADE', this._s(st.worst, 0), 'max adverse ' + this._s(st.worstHeat, 0), 'Worst completed trade, and the largest move against any trade while it was open (NG index basis).') +
        '</div>';
    },

    _card(s) {
        const short = s.side === 'short', color = short ? 'var(--red)' : 'var(--green)';
        const sideTxt = short ? 'SHORT NG · KOLD' : 'LONG NG · BOIL';
        let status;
        if (s.status === 'ACTIVE') {
            status = 'Active, day ' + s.streak + ' (since ' + s.since + ')';
            if (s.openTrade && s.openTrade.entry !== s.since) status += '. Holding window opened ' + s.openTrade.entry;
        } else {
            const t = s.openTrade;
            status = 'Holding window: triggered ' + t.entry + ', session ' + t.sessions + ' of ' + s.hold + ', NG ' + this._s(t.ng) + ' since entry';
        }
        const tierTip = 'Evidence tier, recomputed from history on every load. STRONG: p ≤ 0.05 on the ' + s.hold + '-session hold, both halves of the history at or above the any-day rate, and the other hold also beats it. MODERATE: p ≤ 0.10. WEAK: beats the any-day rate without statistical significance.' +
            (s.maxTier !== 'STRONG' ? ' This setup is capped at ' + s.maxTier + ' because it was found by scanning combinations, so its p-value overstates the evidence.' : '');
        const small = s.stats && s.stats.n < 20 ? '<span class="aa-small" data-tooltip="Fewer than 20 completed trades. Treat the win rate as a rough guide.">SMALL SAMPLE</span>' : '';
        return '<div class="aa-card' + (s.status === 'ACTIVE' ? '' : ' aa-window') + '">' +
            '<div class="aa-card-head">' +
                '<span class="aa-name" data-tooltip="' + this._esc(s.why) + '">' + s.label + '</span>' +
                '<span class="aa-side" style="color:' + color + '">' + sideTxt + '</span>' +
                '<span class="aa-tier" style="color:' + this._tierColor(s.tier) + '" data-tooltip="' + this._esc(tierTip) + '">' + s.tier + '</span>' + small +
                '<span class="aa-family">' + s.family + '</span>' +
            '</div>' +
            '<div class="aa-status">' + status + '</div>' +
            '<div class="aa-rule">' + s.rule + '. Hold ' + s.hold + ' sessions.</div>' +
            this._statGrid(s) +
        '</div>';
    },

    _gauge(label, pct, text, tip, tone, wide) {
        const w = pct == null ? 0 : Math.max(0, Math.min(100, pct));
        return '<div class="aa-input' + (wide ? ' aa-input-wide' : '') + '" data-tooltip="' + this._esc(tip) + '">' +
            '<span class="aa-input-label">' + label + '</span>' +
            '<span class="aa-input-val" style="color:' + (tone || 'var(--text-primary)') + '">' + text + '</span>' +
            (pct == null ? '' : '<span class="aa-input-bar"><span style="width:' + w + '%;background:' + (tone || '#5090a0') + '"></span></span>') +
        '</div>';
    },

    // Does the Toronto pair agree with the US closing-pressure reading?
    _crossCheck(inp) {
        if (inp.cpXPe == null || inp.cpPe == null) return { text: 'No data', tone: null, agrees: null };
        const gap = Math.abs(inp.cpXPe - inp.cpPe);
        const agrees = inp.cpPe >= 90 ? inp.cpXPe >= this.CFG.xAgree : (inp.cpPe <= 10 ? inp.cpXPe <= 100 - this.CFG.xAgree : gap <= 25);
        return { text: this._ord(inp.cpXPe) + (agrees ? ' · agrees' : ' · diverges'), tone: agrees ? null : '#d4a830', agrees: agrees };
    },

    render(model, el) {
        if (!el) return;
        if (!model || !model.ready) {
            el.innerHTML = '<div class="no-alerts">The alert engine requires BOIL and KOLD history, which is not available yet.</div>';
            return;
        }
        const self = this, inp = model.inputs;
        const live = model.setups.filter(function(s) { return s.status !== 'OFF' && !s.unavailable; });
        const order = { STRONG: 0, MODERATE: 1, WEAK: 2, NONE: 3 };
        live.sort(function(a, b) { return (a.status === 'ACTIVE' ? 0 : 1) - (b.status === 'ACTIVE' ? 0 : 1) || order[a.tier] - order[b.tier]; });
        const act = live.filter(function(s) { return s.status === 'ACTIVE' && s.tier !== 'NONE' && s.tier !== 'WEAK'; });
        const shorts = act.filter(function(s) { return s.side === 'short'; }), longs = act.filter(function(s) { return s.side === 'long'; });
        const names = function(arr) { return arr.length + ' setup' + (arr.length > 1 ? 's' : '') + ' active: ' + arr.map(function(s) { return s.label; }).join(', '); };

        let bias, head, headColor;
        if (shorts.length && longs.length) { bias = 'MIXED'; head = 'Short and long setups are active at the same time'; headColor = '#d4a830'; }
        else if (shorts.length) { bias = 'BEARISH'; head = names(shorts); headColor = 'var(--red)'; }
        else if (longs.length) { bias = 'BULLISH'; head = names(longs); headColor = 'var(--green)'; }
        else if (live.length) { bias = 'NO NEW TRIGGER'; head = 'Earlier setups remain inside their holding window'; headColor = '#8a8a9a'; }
        else { bias = 'NO ACTIVE SETUP'; head = 'No tested setup is triggered'; headColor = '#8a8a9a'; }

        // what the other inputs are saying
        const notes = [], xc = this._crossCheck(inp);
        const cpActive = shorts.some(function(s) { return s.key === 'CLOSE_EXHAUSTION'; });
        if (shorts.length && !cpActive && inp.cpPe != null)
            notes.push('Price-volume does not confirm: closing pressure is at the ' + self._ord(inp.cpPe) + ' percentile (trigger at the 90th)');
        if (cpActive && xc.agrees != null)
            notes.push(xc.agrees ? 'The Toronto pair confirms the closing-pressure reading (' + self._ord(inp.cpXPe) + ' percentile)'
                : 'The Toronto pair does not confirm the closing-pressure reading (' + self._ord(inp.cpXPe) + ' percentile)');
        if (shorts.length && !shorts.some(function(s) { return s.key === 'OPT_BLOWOFF'; }) && inp.optState)
            notes.push('Options state: ' + self._optLabel(inp.optState));
        if (!act.length && inp.rvPe != null)
            notes.push(inp.rvPe >= 70 ? 'Realized volatility is elevated (' + self._ord(inp.rvPe) + ' percentile), the regime in which NG has declined fastest'
                : (inp.rvPe <= 50 ? 'Realized volatility is low (' + self._ord(inp.rvPe) + ' percentile), the regime in which the short-side drift has been weakest' : 'Realized volatility is mid-range'));

        const b21s = model.bench.short[21], b21l = model.bench.long[21];
        const cpTone = inp.cpPe == null ? null : (inp.cpPe >= 90 ? 'var(--red)' : (inp.cpPe <= 20 ? 'var(--green)' : null));
        const rvTone = inp.rvPe == null ? null : (inp.rvPe >= 70 ? 'var(--red)' : null);
        const optTone = inp.optState === 'BLOWOFF' ? 'var(--red)' : (inp.optState === 'UPSIDE_STRESS' ? '#d4a830' : (inp.optState === 'PANIC_FLUSH' ? 'var(--green)' : null));
        const xs = inp.xStats || {};
        const xTip = 'The same closing-pressure measure computed on HNU / HND in Toronto and ranked against its own history. It is a cross-check, not a rule input. ' +
            (xs.corr != null ? 'Correlation with the US reading over ' + xs.n + ' sessions: ' + xs.corr.toFixed(2) + '. ' : '') +
            (xs.extremeDays ? 'On the ' + xs.extremeDays + ' sessions when the US reading was at or above its 90th percentile, Toronto was at or above its ' + self.CFG.xAgree + 'th on ' + xs.extremeAgree + '. ' : '') +
            'A divergence is rare and usually reflects a data problem or a single-venue distortion. Toronto data through ' + (inp.xDate || '—') + '.';
        const gauges =
            this._gauge('CLOSING PRESSURE', inp.cpPe, self._ord(inp.cpPe), 'Closing pressure = (CMF-21 of BOIL − CMF-21 of KOLD) / 2 on dollar volume, ranked against all history to date. A high reading means NG has been closing near its daily highs on volume. The relationship is contrarian: at or above the 90th percentile is the ' + self._label('CLOSE_EXHAUSTION') + ' short; at or below the 20th together with an options vol-spike selloff is the ' + self._label('CAPITULATION') + ' long.', cpTone) +
            this._gauge('TORONTO CHECK', inp.cpXPe, xc.text, xTip, xc.tone) +
            this._gauge('REALIZED VOL', inp.rvPe, self._ord(inp.rvPe) + (inp.rv != null ? ' · ' + self._f(inp.rv) + '%' : ''), '21-session realized volatility of the tradeable NG index (annualised), ranked against all history to date. Above the 70th percentile NG was higher 21 sessions later only 38% of the time (average −3.0%); below the 50th, 46% (−0.3%).', rvTone) +
            this._gauge('BOIL FLOWS (5D)', inp.flowStale ? null : inp.flowPe, inp.flowStale ? 'Stale' : self._ord(inp.flowPe), 'BOIL net creations over five sessions, scaled by the usual size of a daily flow, lagged one session and ranked against history. Flows through ' + (inp.flowDate || '—') + '. Fund flows carried no stable directional information on their own; they are used only inside ' + self._label('CHASED_RALLY') + '.', null) +
            this._gauge('OPTIONS STATE', null, self._optLabel(inp.optState), 'State of the CVOL options surface, using the same definitions as the Directional Edge panel on the CVOL tab. CVOL data through ' + (inp.optDate || '—') + '. Call-skew percentile ' + self._f(inp.skewPe) + ', implied-volatility percentile ' + self._f(inp.ngvlPe) + '.', optTone, true) +
            this._gauge('BOIL VOLUME', null, inp.boilClimax ? 'Climax' : 'Normal' + (inp.boilRvolMax != null ? ' · ' + self._f(inp.boilRvolMax, 1) + 'x' : ''), 'A BOIL volume climax is share volume at or above the 90th percentile in every window from 5 to 252 sessions (MWCA), or 3.5 times its average in any window. On its own, NG was lower 21 sessions later 67% of the time, so it marks crowding rather than a low.', inp.boilClimax ? '#d4a830' : null) +
            this._gauge('DRAWDOWN (63D)', null, self._s(inp.dd63 != null ? inp.dd63 * 100 : null, 0), 'Tradeable NG index relative to its 63-session high. Used by ' + self._label('WASHOUT') + ', which requires −25% or worse.', inp.dd63 != null && inp.dd63 <= -0.25 ? 'var(--green)' : null);

        const rows = model.setups.map(function(s) {
            const st = s.stats, o = s.otherStats;
            const statusTxt = s.unavailable ? 'No data' : (s.status === 'ACTIVE' ? 'Active' : (s.status === 'IN_WINDOW' ? 'In window' : 'Off'));
            const statusColor = s.status === 'ACTIVE' ? (s.side === 'short' ? 'var(--red)' : 'var(--green)') : (s.status === 'IN_WINDOW' ? '#d4a830' : 'var(--text-muted)');

            // Build trade ledger sub-table for this setup
            let ledgerHtml = '';
            if (s.trades && s.trades.length) {
                const trRows = s.trades.slice().reverse().map(function(t) {
                    const outcome = t.open ? '<span style="color:#d4a830;font-weight:700;">OPEN · ' + t.sessions + ' of ' + s.hold + '</span>'
                        : (t.pnl > 0 ? '<span style="color:var(--green);font-weight:700;">WON</span>' : '<span style="color:var(--red);font-weight:700;">LOST</span>');
                    const ngColor = t.ng > 0 ? 'var(--green)' : (t.ng < 0 ? 'var(--red)' : 'inherit');
                    const pnlColor = t.pnl > 0 ? 'var(--green)' : (t.pnl < 0 ? 'var(--red)' : 'inherit');
                    const legColor = t.leg > 0 ? 'var(--green)' : (t.leg < 0 ? 'var(--red)' : 'inherit');
                    return '<tr>' +
                        '<td>' + t.entry + '</td>' +
                        '<td>' + (t.open ? '—' : t.exit) + '</td>' +
                        '<td>' + t.sessions + '</td>' +
                        '<td style="color:' + ngColor + '">' + self._s(t.ng) + '</td>' +
                        '<td style="color:' + pnlColor + ';font-weight:700;">' + self._s(t.pnl) + '</td>' +
                        '<td style="color:' + legColor + '">' + self._s(t.leg) + '</td>' +
                        '<td>' + self._s(t.heat) + '</td>' +
                        '<td>' + outcome + '</td>' +
                    '</tr>';
                }).join('');
                ledgerHtml = '<tr id="aa-ledger-' + s.key + '" class="aa-ledger-row" style="display:none;"><td colspan="12">' +
                    '<div class="aa-ledger-container">' +
                        '<div class="aa-ledger-title">' +
                            '<span><b>' + s.label + '</b> · trade ledger · ' + s.trades.length + ' non-overlapping trades, most recent first</span>' +
                            '<span>Hold ' + s.hold + ' sessions · win rate ' + self._f(st.winRate) + '% vs any-day ' + self._f(st.benchWinRate) + '%</span>' +
                        '</div>' +
                        '<div style="overflow-x:auto;"><table class="aa-ledger-table"><thead><tr>' +
                            '<th>ENTRY</th><th>EXIT</th><th>SESSIONS</th><th>NG RETURN</th><th>TRADE RETURN</th><th>' + (s.side === 'short' ? 'KOLD' : 'BOIL') + ' LEG</th><th>MAX ADVERSE</th><th>OUTCOME</th>' +
                        '</tr></thead><tbody>' + trRows + '</tbody></table></div>' +
                    '</div>' +
                '</td></tr>';
            }

            return '<tr class="aa-setup-row" data-setup-key="' + s.key + '">' +
                '<td class="aa-td-name" data-tooltip="' + self._esc(s.rule + '. ' + s.why + ' Select the row to list every trade.') + '"><span class="aa-row-toggle">+</span>' + s.label + '</td>' +
                '<td style="color:' + (s.side === 'short' ? 'var(--red)' : 'var(--green)') + '">' + (s.side === 'short' ? 'Short' : 'Long') + ' · ' + s.hold + ' sessions</td>' +
                '<td style="color:' + self._tierColor(s.tier) + '">' + s.tier + '</td>' +
                '<td style="color:' + statusColor + '">' + statusTxt + '</td>' +
                '<td>' + (st.n ? st.wins + '/' + st.n + ' (' + self._f(st.winRate) + '%)' : '—') + '</td>' +
                '<td>' + self._f(st.benchWinRate) + '%</td>' +
                '<td>' + self._s(st.mean) + '</td>' +
                '<td>' + self._s(st.legMean) + '</td>' +
                '<td>' + self._p(st.p) + '</td>' +
                '<td data-tooltip="Win rate in the first and second half of the history (number of trades in brackets). An edge that only exists in one half is suspect.">' + self._f(st.h1Rate) + '% (' + st.h1n + ') / ' + self._f(st.h2Rate) + '% (' + st.h2n + ')</td>' +
                '<td data-tooltip="Same setup on the other hold length.">' + (o && o.n ? self._f(o.winRate) + '% vs ' + self._f(o.benchWinRate) + '% at ' + s.otherHold + ' sessions' : '—') + '</td>' +
                '<td>' + (s.lastFired || '—') + '</td>' +
            '</tr>' + ledgerHtml;
        }).join('');

        el.innerHTML =
            '<div class="aa-head">' +
                '<div class="aa-head-main"><span class="aa-bias" style="color:' + headColor + '">' + bias + '</span>' + head + '</div>' +
                (notes.length ? '<div class="aa-head-note">' + notes.join('. ') + '.</div>' : '') +
                '<div class="aa-head-basis" data-tooltip="Forward returns are measured on the roll-adjusted, unlevered NG return implied by the BOIL / KOLD pair. Because rolled NG futures lose value over time, a short taken on a random day wins more often than a long. Every setup is judged against that rate, not against 50%.">Data through ' + model.asOf +
                    ' · tradeable NG basis · any-day 21-session rate: short ' + self._f(b21s.winRate) + '%, long ' + self._f(b21l.winRate) + '%</div>' +
            '</div>' +
            (live.length ? '<div class="aa-cards">' + live.map(function(s) { return self._card(s); }).join('') + '</div>' : '') +
            '<div class="aa-inputs">' + gauges + '</div>' +
            '<details class="aa-details"><summary>All setups: evidence and current status</summary>' +
                '<div class="aa-table-wrap"><table class="aa-table"><thead><tr>' +
                    '<th>SETUP</th><th>SIDE / HOLD</th><th>TIER</th><th>STATUS</th><th>TRADES WON</th><th>ANY-DAY</th><th>AVG (NG)</th><th>AVG (ETF LEG)</th><th>P-VALUE</th><th>HALVES</th><th>OTHER HOLD</th><th>LAST TRIGGER</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
                '<div class="aa-foot">Trades do not overlap: entry is at the close of the first session on which the rule is true, the position is held for the stated number of sessions, and only then is the next entry considered. ' +
                    'The p-value is the exact binomial probability of at least that many wins if the setup were no better than the any-day rate for the same side and hold. Rules and thresholds were selected on this same history, so the figures are optimistic. ' +
                    'The former VCVI, MWCA and RVOL threshold alerts were removed because they triggered on about one session in five and did not separate from the any-day rate. Method and results: docs/alerts_research.md.</div>' +
            '</details>';

        // Bind row click toggles for trade ledgers
        if (typeof el.querySelectorAll === 'function') {
            const setupRows = el.querySelectorAll('.aa-setup-row');
            setupRows.forEach(function(row) {
                row.addEventListener('click', function() {
                    const key = this.getAttribute('data-setup-key');
                    const sub = el.querySelector('#aa-ledger-' + key);
                    const toggle = this.querySelector('.aa-row-toggle');
                    if (sub) {
                        const isHidden = sub.style.display === 'none';
                        sub.style.display = isHidden ? 'table-row' : 'none';
                        if (toggle) toggle.textContent = isHidden ? '−' : '+';
                        if (isHidden) this.classList.add('aa-expanded');
                        else this.classList.remove('aa-expanded');
                    }
                });
            });
        }
    },

    // ── page wiring ──────────────────────────────────────────────────────────
    _aux: null,
    _auxPromise: null,

    loadAux() {
        if (this._auxPromise) return this._auxPromise;
        const self = this;
        const txt = function(url) { return fetch(url).then(function(r) { return r.ok ? r.text() : null; }).catch(function() { return null; }); };
        const jsn = function(url) { return fetch(url).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }); };
        this._auxPromise = Promise.all([txt('data/cvol/ngvl_cvol_history.csv'), jsn('data/flows/BOIL_flows.json')]).then(function(res) {
            self._aux = { cvol: self.parseCvolCsv(res[0]), flows: res[1] ? self.flowMap(res[1]) : null };
            return self._aux;
        });
        return this._auxPromise;
    },

    mount(allMetrics) {
        const el = document.getElementById('alert-feed');
        if (!el) return;
        const boil = allMetrics && allMetrics.BOIL ? allMetrics.BOIL.history : null;
        const kold = allMetrics && allMetrics.KOLD ? allMetrics.KOLD.history : null;
        if (!boil || !kold) { this.render(null, el); return; }
        const self = this;
        const key = boil.length + ':' + kold.length + ':' + (boil.length ? boil[boil.length - 1].date + boil[boil.length - 1].close : '');
        const draw = function() {
            if (self._lastKey === key && self._lastAux === self._aux && self._model) { self.render(self._model, el); return; }
            const aux = self._aux || {};
            const hnu = allMetrics['HNU.TO'] ? allMetrics['HNU.TO'].history : null;
            const hnd = allMetrics['HND.TO'] ? allMetrics['HND.TO'].history : null;
            self._model = self.compute(boil, kold, aux.cvol || null, aux.flows || null, hnu, hnd);
            self._lastKey = key; self._lastAux = self._aux;
            self.render(self._model, el);
            if (typeof self.onModel === 'function') self.onModel(self._model);
        };
        if (this._aux) { draw(); return; }
        if (!this._model) el.innerHTML = '<div class="no-alerts">Scoring setups…</div>';
        this.loadAux().then(draw);
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = AlertEngine;
