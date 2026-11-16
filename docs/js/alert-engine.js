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
     Options state: BLOW-OFF / UPSIDE STRESS / PANIC FLUSH, same definitions as the CVOL tab.
     Fund flows: BOIL 5-session net creations, lagged one session (shares outstanding publish T+1).
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
        // options states (keep in sync with EDGE_CFG in cvol.js)
        skewBlow: 95, skewStress: 90, volGate: 90, flushSigma: -1.5, flushVolRise: 0.05, idxVolRatio: 0.8,
        holds: [10, 21],
    },

    // side: 'short' = NG lower (KOLD is the leg), 'long' = NG higher (BOIL is the leg).
    // maxTier caps the evidence tier for setups that were found by scanning combinations, because
    // their p-value does not account for the search.
    SETUPS: [
        {
            key: 'CLOSE_EXHAUSTION', label: 'CLOSE EXHAUSTION', side: 'short', hold: 21, family: 'PRICE-VOLUME', maxTier: 'STRONG',
            rule: 'Closing pressure at or above its 90th percentile',
            why: 'NG has closed near its daily highs on volume for a month. Leveraged-ETF rebalancing and late chasing push closes in the direction of the trend; when that pressure is extreme the move has usually run out.',
            test: function(f, i) { return f.cpPe[i] != null && f.cpPe[i] >= 90; },
        },
        {
            key: 'OPT_BLOWOFF', label: 'OPTIONS BLOW-OFF', side: 'short', hold: 21, family: 'OPTIONS', maxTier: 'STRONG',
            rule: 'Call skew ≥ 95th percentile with implied vol ≥ 90th (CVOL tab state)',
            why: 'The options market is paying up for upside while vol is already extreme. Same state as the Directional Edge panel on the CVOL tab.',
            test: function(f, i) { return f.optState[i] === 'BLOWOFF'; },
        },
        {
            key: 'CROWDED_RALLY', label: 'CROWDED RALLY', side: 'short', hold: 21, family: 'VOLUME', maxTier: 'MODERATE',
            rule: 'BOIL volume climax (MWCA or RVOL ≥ 3.5x) while closing pressure ≥ 80th percentile',
            why: 'A BOIL volume spike is not a bottom signal: on its own NG was lower 21 sessions later two times in three. Paired with strong closes it marks late long-side crowding.',
            test: function(f, i) { return f.boilClimax[i] && f.cpPe[i] != null && f.cpPe[i] >= 80; },
        },
        {
            key: 'CHASED_RALLY', label: 'CHASED RALLY (FLOWS)', side: 'short', hold: 21, family: 'FUND FLOWS', maxTier: 'MODERATE',
            rule: 'BOIL 5-session creations ≥ 90th percentile while realized vol ≥ 70th percentile',
            why: 'Heavy money entering BOIL in a hot tape. Flows data starts in 2016, so the sample is short and the first half has almost no trades.',
            test: function(f, i) { return f.flowPe[i] != null && f.flowPe[i] >= 90 && f.rvPe[i] != null && f.rvPe[i] >= 70; },
        },
        {
            key: 'CAPITULATION', label: 'CAPITULATION REVERSAL', side: 'long', hold: 21, family: 'OPTIONS + PRICE-VOLUME', maxTier: 'MODERATE',
            rule: 'Options PANIC FLUSH while closing pressure ≤ 20th percentile',
            why: 'A sharp drop that implied vol is reacting to, after a month of weak closes. The vol response is what separates a flush from a slow bleed: a flush without weak closes bounced only 38% of the time, and weak closes on their own are a coin flip.',
            test: function(f, i) { return f.optState[i] === 'PANIC_FLUSH' && f.cpPe[i] != null && f.cpPe[i] <= 20; },
        },
        {
            key: 'WASHOUT', label: 'WASHOUT', side: 'long', hold: 10, family: 'PRICE-VOLUME', maxTier: 'MODERATE',
            rule: 'Closing pressure ≤ 10th percentile with NG down 25% or more from its 63-session high',
            why: 'Extreme weak closes after a deep drawdown. Works on a 10-session hold; threshold-sensitive (at the 20th percentile it is a coin flip), so treat it as a bounce, not a trend change.',
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

    // Build the per-session feature frame on the BOIL ∩ KOLD calendar.
    buildFrame(boilHist, koldHist, cvolRows, boilFlows) {
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
        const cmf = function(H) {
            const mfv = new Float64Array(n), dv = new Float64Array(n), out = new Array(n).fill(null);
            for (let i = 0; i < n; i++) {
                const h = H[i].high, l = H[i].low, c = H[i].close, v = H[i].volume || 0;
                dv[i] = c * v;
                mfv[i] = (h > l && h != null && l != null) ? ((c - l) - (h - c)) / (h - l) * dv[i] : 0;
            }
            let a = 0, d = 0;
            for (let i = 0; i < n; i++) {
                a += mfv[i]; d += dv[i];
                if (i >= cfg.cmfWindow) { a -= mfv[i - cfg.cmfWindow]; d -= dv[i - cfg.cmfWindow]; }
                if (i >= cfg.cmfWindow - 1 && d > 0) out[i] = a / d;
            }
            return out;
        };
        const cb = cmf(B), ck = cmf(K), cp = new Array(n).fill(null);
        for (let i = 0; i < n; i++) if (cb[i] != null && ck[i] != null) cp[i] = (cb[i] - ck[i]) / 2;
        f.cp = cp; f.cpPe = this.expandingPercentile(cp, cfg.minHistory);

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

    compute(boilHist, koldHist, cvolRows, boilFlows) {
        const f = this.buildFrame(boilHist, koldHist, cvolRows, boilFlows);
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
        };
        model.ready = true;
        return model;
    },

    // ── rendering ────────────────────────────────────────────────────────────
    _f(v, d) { return v != null && isFinite(v) ? v.toFixed(d == null ? 0 : d) : '—'; },
    _s(v, d) { return v != null && isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%' : '—'; },
    _p(v) { return v == null ? '—' : (v < 0.001 ? '<0.001' : v.toFixed(3)); },
    _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    _tierColor(t) { return t === 'STRONG' ? '#3db87a' : (t === 'MODERATE' ? '#d4a830' : (t === 'WEAK' ? '#8a8a9a' : '#555565')); },
    _optLabel(s) { return s === 'BLOWOFF' ? 'BLOW-OFF' : (s === 'UPSIDE_STRESS' ? 'UPSIDE STRESS' : (s === 'PANIC_FLUSH' ? 'PANIC FLUSH' : (s === 'NEUTRAL' ? 'NEUTRAL' : '—'))); },

    _evidenceLine(s) {
        const st = s.stats, leg = s.side === 'short' ? 'KOLD' : 'BOIL';
        if (!st || !st.n) return 'No completed trades yet.';
        return 'Won <b>' + st.wins + ' of ' + st.n + '</b> (' + this._f(st.winRate) + '%) vs ' + this._f(st.benchWinRate) + '% any-day · avg <b>' +
            this._s(st.mean) + '</b> NG-basis (any-day ' + this._s(st.benchMean) + ') · ' + leg + ' leg ' + this._s(st.legMean) +
            ' · p ' + this._p(st.p) + ' · worst ' + this._s(st.worst, 0) + ' (heat ' + this._s(st.worstHeat, 0) + ')';
    },

    _card(s, f) {
        const short = s.side === 'short', color = short ? 'var(--red)' : 'var(--green)';
        const sideTxt = short ? '↓ NG LOWER · KOLD' : '↑ NG HIGHER · BOIL';
        let status;
        if (s.status === 'ACTIVE') {
            status = 'ACTIVE · day ' + s.streak + ' (since ' + s.since + ')';
            if (s.openTrade && s.openTrade.entry !== s.since) status += ' · window opened ' + s.openTrade.entry;
        } else {
            const t = s.openTrade;
            status = 'IN WINDOW · triggered ' + t.entry + ' · session ' + t.sessions + ' of ' + s.hold + ' · NG ' + this._s(t.ng) + ' since';
        }
        const tierTip = 'Evidence tier, recomputed from history on every load. STRONG: p ≤ 0.05 on the ' + s.hold + '-session hold, both halves of the history at or above the any-day benchmark, and the other hold also beats it. MODERATE: p ≤ 0.10. WEAK: beats the benchmark without significance.' +
            (s.maxTier !== 'STRONG' ? ' This setup is capped at ' + s.maxTier + ' because it was found by scanning combinations, so its p-value overstates the evidence.' : '');
        const small = s.stats && s.stats.n < 20 ? ' <span class="aa-small" data-tooltip="Fewer than 20 completed trades. Treat the win rate as a rough guide.">SMALL SAMPLE</span>' : '';
        return '<div class="aa-card aa-' + s.side + (s.status === 'ACTIVE' ? ' aa-live' : ' aa-window') + '">' +
            '<div class="aa-card-head">' +
                '<span class="aa-side" style="color:' + color + ';border-color:' + color + '">' + sideTxt + '</span>' +
                '<span class="aa-name" data-tooltip="' + this._esc(s.why) + '">' + s.label + '</span>' +
                '<span class="aa-tier" style="color:' + this._tierColor(s.tier) + ';border-color:' + this._tierColor(s.tier) + '" data-tooltip="' + this._esc(tierTip) + '">' + s.tier + '</span>' + small +
                '<span class="aa-family">' + s.family + '</span>' +
            '</div>' +
            '<div class="aa-status">' + status + '</div>' +
            '<div class="aa-rule">' + s.rule + ' · hold ' + s.hold + ' sessions</div>' +
            '<div class="aa-evidence">' + this._evidenceLine(s) + '</div>' +
        '</div>';
    },

    _gauge(label, pct, text, tip, tone) {
        const w = pct == null ? 0 : Math.max(0, Math.min(100, pct));
        return '<div class="aa-input" data-tooltip="' + this._esc(tip) + '">' +
            '<span class="aa-input-label">' + label + '</span>' +
            '<span class="aa-input-val" style="color:' + (tone || 'var(--text-primary)') + '">' + text + '</span>' +
            (pct == null ? '' : '<span class="aa-input-bar"><span style="width:' + w + '%;background:' + (tone || '#5090a0') + '"></span></span>') +
        '</div>';
    },

    render(model, el) {
        if (!el) return;
        if (!model || !model.ready) {
            el.innerHTML = '<div class="no-alerts">Alert engine needs BOIL and KOLD history — not available yet.</div>';
            return;
        }
        const self = this, inp = model.inputs, f = model.frame;
        const live = model.setups.filter(function(s) { return s.status !== 'OFF' && !s.unavailable; });
        const order = { STRONG: 0, MODERATE: 1, WEAK: 2, NONE: 3 };
        live.sort(function(a, b) { return (a.status === 'ACTIVE' ? 0 : 1) - (b.status === 'ACTIVE' ? 0 : 1) || order[a.tier] - order[b.tier]; });
        const act = live.filter(function(s) { return s.status === 'ACTIVE' && s.tier !== 'NONE' && s.tier !== 'WEAK'; });
        const shorts = act.filter(function(s) { return s.side === 'short'; }), longs = act.filter(function(s) { return s.side === 'long'; });

        let head, headColor;
        if (shorts.length && longs.length) { head = 'CONFLICT — short and long setups are both active'; headColor = '#d4a830'; }
        else if (shorts.length) { head = 'DOWNSIDE — ' + shorts.length + ' short setup' + (shorts.length > 1 ? 's' : '') + ' active: ' + shorts.map(function(s) { return s.label; }).join(' + '); headColor = 'var(--red)'; }
        else if (longs.length) { head = 'UPSIDE — ' + longs.length + ' long setup' + (longs.length > 1 ? 's' : '') + ' active: ' + longs.map(function(s) { return s.label; }).join(' + '); headColor = 'var(--green)'; }
        else if (live.length) { head = 'NO FRESH TRIGGER — earlier setups still inside their holding window'; headColor = '#8a8a9a'; }
        else { head = 'NO ACTIVE SETUP — nothing with a tested edge is firing'; headColor = '#8a8a9a'; }

        // one-line note on what the other families are saying
        const notes = [];
        if (shorts.length && !shorts.some(function(s) { return s.key === 'CLOSE_EXHAUSTION'; }) && inp.cpPe != null)
            notes.push('volume side not confirming (closing pressure ' + self._f(inp.cpPe) + 'th pct; exhaustion needs ≥ 90th)');
        if (shorts.length && !shorts.some(function(s) { return s.key === 'OPT_BLOWOFF'; }) && inp.optState)
            notes.push('options state ' + self._optLabel(inp.optState));
        if (!act.length && inp.rvPe != null)
            notes.push(inp.rvPe >= 70 ? 'realized vol is hot (' + self._f(inp.rvPe) + 'th pct) — the regime where NG has drifted lower fastest'
                : (inp.rvPe <= 50 ? 'realized vol is calm (' + self._f(inp.rvPe) + 'th pct) — the regime where the short-side drift has been weakest' : 'realized vol mid-range'));

        const b21s = model.bench.short[21], b21l = model.bench.long[21];
        const cpTone = inp.cpPe == null ? null : (inp.cpPe >= 90 ? 'var(--red)' : (inp.cpPe <= 20 ? 'var(--green)' : null));
        const rvTone = inp.rvPe == null ? null : (inp.rvPe >= 70 ? 'var(--red)' : null);
        const optTone = inp.optState === 'BLOWOFF' ? 'var(--red)' : (inp.optState === 'UPSIDE_STRESS' ? '#d4a830' : (inp.optState === 'PANIC_FLUSH' ? 'var(--green)' : null));
        const gauges =
            this._gauge('CLOSING PRESSURE', inp.cpPe, self._f(inp.cpPe) + 'th', 'Closing pressure = (CMF21 of BOIL − CMF21 of KOLD) / 2 on dollar volume, ranked against all history to date. High = NG has been closing near its daily highs on volume. Contrarian: ≥ 90th percentile is the CLOSE EXHAUSTION short; ≤ 20th with an options panic flush is the CAPITULATION long.', cpTone) +
            this._gauge('REALIZED VOL', inp.rvPe, self._f(inp.rvPe) + 'th' + (inp.rv != null ? ' · ' + self._f(inp.rv) + '%' : ''), '21-session realized volatility of the tradeable NG index (annualised), ranked against all history to date. Above the 70th percentile NG was higher 21 sessions later only 38% of the time (average −3.0%); below the 50th, 46% (−0.3%).', rvTone) +
            this._gauge('OPTIONS STATE', null, self._optLabel(inp.optState), 'State from the CVOL options surface, same definitions as the Directional Edge panel on the CVOL tab. CVOL data through ' + (inp.optDate || '—') + '. Call-skew percentile ' + self._f(inp.skewPe) + ', implied-vol percentile ' + self._f(inp.ngvlPe) + '.', optTone) +
            this._gauge('BOIL VOLUME', null, inp.boilClimax ? 'CLIMAX' : 'normal' + (inp.boilRvolMax != null ? ' · ' + self._f(inp.boilRvolMax, 1) + 'x' : ''), 'BOIL volume climax = share volume at or above the 90th percentile in every window from 5 to 252 sessions (MWCA), or 3.5x its average in any window. On its own NG was lower 21 sessions later 67% of the time — a crowding marker, not a bottom marker.', inp.boilClimax ? '#d4a830' : null) +
            this._gauge('BOIL FLOWS 5D', inp.flowStale ? null : inp.flowPe, inp.flowStale ? 'stale' : self._f(inp.flowPe) + 'th', 'BOIL net creations over five sessions, scaled by the usual size of a daily flow, lagged one session and ranked against history. Flows through ' + (inp.flowDate || '—') + '. Fund flows carried no stable directional information on their own; they are used only inside CHASED RALLY.', null) +
            this._gauge('63D DRAWDOWN', null, self._s(inp.dd63 != null ? inp.dd63 * 100 : null, 0), 'Tradeable NG index versus its 63-session high. Used by WASHOUT (needs −25% or worse).', inp.dd63 != null && inp.dd63 <= -0.25 ? 'var(--green)' : null);

        const rows = model.setups.map(function(s) {
            const st = s.stats, o = s.otherStats;
            const statusTxt = s.unavailable ? 'no data' : (s.status === 'ACTIVE' ? 'ACTIVE' : (s.status === 'IN_WINDOW' ? 'IN WINDOW' : 'off'));
            const statusColor = s.status === 'ACTIVE' ? (s.side === 'short' ? 'var(--red)' : 'var(--green)') : (s.status === 'IN_WINDOW' ? '#d4a830' : 'var(--text-muted)');
            return '<tr>' +
                '<td class="aa-td-name" data-tooltip="' + self._esc(s.rule + '. ' + s.why) + '">' + s.label + '</td>' +
                '<td style="color:' + (s.side === 'short' ? 'var(--red)' : 'var(--green)') + '">' + (s.side === 'short' ? 'SHORT' : 'LONG') + ' ' + s.hold + 'D</td>' +
                '<td style="color:' + self._tierColor(s.tier) + '">' + s.tier + '</td>' +
                '<td style="color:' + statusColor + '">' + statusTxt + '</td>' +
                '<td>' + (st.n ? st.wins + '/' + st.n + ' (' + self._f(st.winRate) + '%)' : '—') + '</td>' +
                '<td>' + self._f(st.benchWinRate) + '%</td>' +
                '<td>' + self._s(st.mean) + '</td>' +
                '<td>' + self._s(st.legMean) + '</td>' +
                '<td>' + self._p(st.p) + '</td>' +
                '<td data-tooltip="Win rate in the first and second half of the history (number of trades in brackets). An edge that only exists in one half is suspect.">' + self._f(st.h1Rate) + '% (' + st.h1n + ') / ' + self._f(st.h2Rate) + '% (' + st.h2n + ')</td>' +
                '<td data-tooltip="Same setup on the other hold length.">' + (o && o.n ? self._f(o.winRate) + '% vs ' + self._f(o.benchWinRate) + '% @' + s.otherHold + 'D' : '—') + '</td>' +
                '<td>' + (s.lastFired || '—') + '</td>' +
            '</tr>';
        }).join('');

        el.innerHTML =
            '<div class="aa-head" style="border-left-color:' + headColor + '">' +
                '<div class="aa-head-main" style="color:' + headColor + '">' + head + '</div>' +
                (notes.length ? '<div class="aa-head-note">' + notes.join(' · ') + '</div>' : '') +
                '<div class="aa-head-basis" data-tooltip="Forward returns are measured on the roll-adjusted, unlevered NG return implied by the BOIL / KOLD pair. Because rolled NG futures bleed, a random short wins more often than a random long — every setup is judged against that, not against 50%.">Data through ' + model.asOf +
                    ' · tradeable NG basis · any-day 21-session short wins ' + self._f(b21s.winRate) + '%, long ' + self._f(b21l.winRate) + '%</div>' +
            '</div>' +
            (live.length ? '<div class="aa-cards">' + live.map(function(s) { return self._card(s, f); }).join('') + '</div>' : '') +
            '<div class="aa-inputs">' + gauges + '</div>' +
            '<details class="aa-details"><summary>All setups — evidence and current status</summary>' +
                '<div class="aa-table-wrap"><table class="aa-table"><thead><tr>' +
                    '<th>SETUP</th><th>SIDE / HOLD</th><th>TIER</th><th>NOW</th><th>TRADES WON</th><th>ANY-DAY</th><th>AVG (NG)</th><th>AVG (ETF LEG)</th><th>P</th><th>HALVES</th><th>OTHER HOLD</th><th>LAST FIRED</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
                '<div class="aa-foot">Trades are non-overlapping: enter at the close of the first day the rule is true, hold the stated number of sessions, then look for the next entry. ' +
                    'P is the exact binomial chance of that many wins if the setup were no better than a random day on the same side. Rules and thresholds were chosen on this same history, so sizes are optimistic. ' +
                    'The former VCVI / MWCA / RVOL threshold alerts were removed: they fired on about one day in five and did not separate from the base rate. Full study: docs/alerts_research.md.</div>' +
            '</details>';
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
            self._model = self.compute(boil, kold, aux.cvol || null, aux.flows || null);
            self._lastKey = key; self._lastAux = self._aux;
            self.render(self._model, el);
        };
        if (this._aux) { draw(); return; }
        if (!this._model) el.innerHTML = '<div class="no-alerts">Scoring setups…</div>';
        this.loadAux().then(draw);
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = AlertEngine;
