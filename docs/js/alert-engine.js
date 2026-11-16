// Active Alerts: evidence-scored setups evaluated on natural gas ETF cycles.
// Implements the cycle-frame specification defined in docs/cycle_frame_spec.md.

const AlertEngine = {

    CFG: {
        minHistory: 252,
        cmfWindow: 21,
        rvWindow: 21,
        ddWindow: 63,
        pairDisagree: 0.08,
        volWindows: [5, 10, 21, 63, 126, 252],
        mwcaPct: 90,
        rvolSpike: 3.5,
        flowLag: 1,
        flowStaleSessions: 4,
        xStaleDays: 4,
        xAgree: 80,
        skewBlow: 95, skewStress: 90, volGate: 90, flushSigma: -1.5, flushVolRise: 0.05, idxVolRatio: 0.8,
        holds: [10, 21],
    },

    SETUPS: [
        {
            key: 'SHORT_ACCUMULATION', label: 'SHORT-SIDE ACCUMULATION', side: 'short', hold: 21, family: 'VOLUME', maxTier: 'STRONG',
            rule: 'KOLD and HND dollar volume at 1.5× normal on 3 of the last 5 sessions while KOLD is lower than 10 sessions ago',
            why: 'Persistent volume into the short ETFs while they decline has been followed by strong rallies, while the same volume during a rally carried no information.',
            risk: 'Fails when NG trends up for months (2013, 2018, 2021).',
            test: function(f, i) {
                if (!f.sv || i < 10) return false;
                let k = 0;
                for (let j = i - 4; j <= i; j++) if (f.sv[j] >= 1.5) k++;
                return k >= 3 && f.kCloses[i] <= f.kCloses[i - 10];
            },
        },
        {
            key: 'SHORT_LEG_REVERSAL', label: 'SHORT-LEG REVERSAL', side: 'long', hold: 21, family: 'PRICE-VOLUME', maxTier: 'MODERATE',
            rule: 'KOLD price-volume trend stretched above its 63-session range, followed by a heavy down session',
            why: 'A sharp pullback after KOLD reaches volume-price extremes often marks a turning point in natural gas.',
            risk: 'Catches about one low in three.',
            test: function(f, i) {
                if (!f.zKmax10 || !f.impK || i < 71) return false;
                return f.zKmax10[i] >= 1.5 && f.impK[i] < -0.5;
            },
        },
        {
            key: 'PVT_RECOVERY', label: 'PRICE-VOLUME RECOVERY', side: 'short', hold: 21, family: 'PRICE-VOLUME', maxTier: 'STRONG',
            rule: 'KOLD\'s 63-session price-volume trend recovering through −1 after falling to −2 or lower in the last 20 sessions',
            why: 'A confirmation entry: deeply below the line and recovering through -1 marks KOLD cycle bottoms.',
            risk: 'A confirmation entry: usually a week or more after the low.',
            test: function(f, i) {
                if (!f.zK || !f.zKmin20 || i < 82) return false;
                return f.zK[i] > -1 && f.zK[i - 1] <= -1 && f.zKmin20[i] <= -2;
            },
        },
        {
            key: 'CLOSE_EXHAUSTION', label: 'CLOSING-PRESSURE EXTREME', side: 'short', hold: 21, family: 'PRICE-VOLUME', maxTier: 'STRONG',
            rule: 'Closing pressure at or above its 90th percentile',
            why: 'NG has closed near its daily highs on volume for a month. When closing pressure is extreme the advance has usually been exhausted.',
            risk: 'Can persist in strong bull trends.',
            test: function(f, i) { return f.cpPe[i] != null && f.cpPe[i] >= 90; },
        },
        {
            key: 'OPT_BLOWOFF', label: 'CALL-SKEW EXTREME', side: 'short', hold: 21, family: 'OPTIONS', maxTier: 'STRONG',
            rule: 'Call skew at or above its 95th percentile with implied volatility at or above its 90th',
            why: 'The options market is paying a premium for upside while implied volatility is already extreme.',
            risk: 'Small number of historical trades.',
            test: function(f, i) { return f.optState[i] === 'BLOWOFF'; },
        },
        {
            key: 'CROWDED_RALLY', label: 'LONG-SIDE VOLUME CLIMAX', side: 'short', hold: 21, family: 'VOLUME', maxTier: 'MODERATE',
            rule: 'BOIL volume climax (MWCA or RVOL ≥ 3.5x) with closing pressure at or above its 80th percentile',
            why: 'Combined with strong closes, high BOIL volume marks crowded long positioning late in an advance.',
            risk: 'Spikes can continue during blow-off rallies.',
            test: function(f, i) { return f.boilClimax[i] && f.cpPe[i] != null && f.cpPe[i] >= 80; },
        },
        {
            key: 'CHASED_RALLY', label: 'INFLOW SURGE', side: 'short', hold: 21, family: 'FUND FLOWS', maxTier: 'MODERATE',
            rule: 'BOIL five-session creations at or above their 90th percentile with realized volatility at or above its 70th',
            why: 'Heavy creations into BOIL while realized volatility is elevated.',
            risk: 'Flow history begins in 2016; limited early sample.',
            test: function(f, i) { return f.flowPe[i] != null && f.flowPe[i] >= 90 && f.rvPe[i] != null && f.rvPe[i] >= 70; },
        },
        {
            key: 'CAPITULATION', label: 'CAPITULATION', side: 'long', hold: 21, family: 'OPTIONS + PRICE-VOLUME', maxTier: 'MODERATE',
            rule: 'Options vol-spike selloff with closing pressure at or below its 20th percentile',
            why: 'A sharp decline with an implied volatility spike after a month of weak closes.',
            risk: 'Catches about one low in three.',
            test: function(f, i) { return f.optState[i] === 'PANIC_FLUSH' && f.cpPe[i] != null && f.cpPe[i] <= 20; },
        },
        {
            key: 'WASHOUT', label: 'OVERSOLD DRAWDOWN', side: 'long', hold: 10, family: 'PRICE-VOLUME', maxTier: 'MODERATE',
            rule: 'Closing pressure at or below its 10th percentile with NG 25% or more below its 63-session high',
            why: 'Weak closes after a deep drawdown. Short-term rebound opportunity.',
            risk: 'Does not mark major cycle turns reliably.',
            test: function(f, i) { return f.cpPe[i] != null && f.cpPe[i] <= 10 && f.dd63[i] != null && f.dd63[i] <= -0.25; },
        },
    ],

    median(a) {
        if (!a || !a.length) return null;
        const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    },

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

    rvol(bars) {
        const dv = bars.map(x => x.close * (x.volume || 0));
        const out = new Array(bars.length).fill(NaN);
        for (let i = 63; i < bars.length; i++) {
            const m = this.median(dv.slice(i - 63, i));
            if (m > 0) out[i] = dv[i] / m;
        }
        return out;
    },

    sideVol(usBars, caBars) {
        const ru = this.rvol(usBars);
        if (!caBars || !caBars.length) return ru;
        const rc = this.rvol(caBars);
        const byDate = new Map(caBars.map((b, i) => [b.date, rc[i]]));
        const out = new Array(usBars.length).fill(NaN);
        let carry = NaN, age = 99;
        for (let i = 0; i < usBars.length; i++) {
            let v = byDate.get(usBars[i].date);
            if (v != null && !isNaN(v)) { carry = v; age = 0; }
            else if (++age <= 2) v = carry;
            else v = NaN;
            const xs = [ru[i], v].filter(x => x != null && !isNaN(x));
            out[i] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
        }
        return out;
    },

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

    pairClosingPressure(longHist, shortHist) {
        const sMap = {}, L = [], S = [];
        for (const b of shortHist || []) if (b && b.date && b.close > 0) sMap[b.date] = b;
        for (const b of longHist || []) if (b && b.date && b.close > 0 && sMap[b.date]) { L.push(b); S.push(sMap[b.date]); }
        const cl = this.cmfSeries(L, this.CFG.cmfWindow), cs = this.cmfSeries(S, this.CFG.cmfWindow);
        const cp = cl.map(function(v, i) { return v != null && cs[i] != null ? (v - cs[i]) / 2 : null; });
        return { dates: L.map(function(b) { return b.date; }), cp: cp, cpPe: this.expandingPercentile(cp, this.CFG.minHistory) };
    },

    buildFrame(boilHist, koldHist, cvolRows, boilFlows, xLong, xShort) {
        const cfg = this.CFG;
        const kMap = {};
        for (const b of koldHist || []) if (b && b.date && b.close > 0) kMap[b.date] = b;
        const B = [], K = [];
        for (const b of boilHist || []) {
            if (b && b.date && b.close > 0 && kMap[b.date]) { B.push(b); K.push(kMap[b.date]); }
        }
        const n = B.length;
        const f = { n: n, dates: B.map(function(b) { return b.date; }), bCloses: B.map(b => b.close), kCloses: K.map(b => b.close) };
        if (n < cfg.minHistory + 30) return f;

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

        f.sv = this.sideVol(K, xShort);
        f.lv = this.sideVol(B, xLong);

        const kold10 = new Array(n).fill(null);
        for (let i = 10; i < n; i++) {
            kold10[i] = (K[i].close / K[i - 10].close - 1) * 100;
        }
        f.kold10 = kold10;

        const VS = typeof VolumeStudies !== 'undefined' ? VolumeStudies : (typeof globalThis !== 'undefined' && globalThis.VolumeStudies ? globalThis.VolumeStudies : null);
        if (VS && typeof VS.computeInvariantPVTEngine === 'function') {
            const imp = VS.computeInvariantPVTEngine(K, 'KOLD', B).impulse;
            const ip = new Array(n), z = new Array(n).fill(NaN);
            let acc = 0;
            for (let i = 0; i < n; i++) { acc += imp[i] || 0; ip[i] = acc; }
            for (let i = 62; i < n; i++) {
                const w = ip.slice(i - 62, i + 1);
                const mu = w.reduce((a, b) => a + b, 0) / 63;
                const sd = Math.sqrt(w.reduce((a, b) => a + (b - mu) ** 2, 0) / 62);
                if (sd > 0) z[i] = (ip[i] - mu) / sd;
            }
            const zMax10 = new Array(n).fill(null);
            for (let i = 71; i < n; i++) {
                let mx = -Infinity, ok = true;
                for (let j = i - 9; j <= i; j++) {
                    if (isNaN(z[j])) ok = false;
                    else mx = Math.max(mx, z[j]);
                }
                if (ok) zMax10[i] = mx;
            }
            const zMin20 = new Array(n).fill(null);
            for (let i = 82; i < n; i++) {
                let mn = Infinity, ok = true;
                for (let j = i - 19; j <= i; j++) {
                    if (isNaN(z[j])) ok = false;
                    else mn = Math.min(mn, z[j]);
                }
                if (ok) zMin20[i] = mn;
            }
            f.zK = z;
            f.zKmax10 = zMax10;
            f.zKmin20 = zMin20;
            f.impK = imp;
        } else {
            f.zK = null;
            f.zKmax10 = null;
            f.zKmin20 = null;
            f.impK = null;
        }

        const rv = new Array(n).fill(null), w = cfg.rvWindow;
        for (let i = w - 1; i < n; i++) {
            let s = 0, s2 = 0;
            for (let j = i - w + 1; j <= i; j++) { s += lr[j]; s2 += lr[j] * lr[j]; }
            rv[i] = Math.sqrt(Math.max(0, (s2 - s * s / w) / (w - 1)));
        }
        f.rv = rv; f.rvPe = this.expandingPercentile(rv, cfg.minHistory);

        const cb = this.cmfSeries(B, cfg.cmfWindow), ck = this.cmfSeries(K, cfg.cmfWindow), cp = new Array(n).fill(null);
        for (let i = 0; i < n; i++) if (cb[i] != null && ck[i] != null) cp[i] = (cb[i] - ck[i]) / 2;
        f.cp = cp; f.cpPe = this.expandingPercentile(cp, cfg.minHistory);

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

        const dd = new Array(n).fill(null);
        for (let i = cfg.ddWindow - 1; i < n; i++) {
            let mx = -Infinity;
            for (let j = i - cfg.ddWindow + 1; j <= i; j++) if (li[j] > mx) mx = li[j];
            dd[i] = Math.exp(li[i] - mx) - 1;
        }
        f.dd63 = dd;

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

        const optState = new Array(n).fill(null), skewPeArr = new Array(n).fill(null), ngvlPeArr = new Array(n).fill(null);
        f.optLastDate = null;
        if (cvolRows && cvolRows.length > cfg.minHistory) {
            const m = cvolRows.length;
            const skewPe = this.expandingPercentile(cvolRows.map(function(r) { return r.skewRatio; }), cfg.minHistory);
            const ngvlPe = this.expandingPercentile(cvolRows.map(function(r) { return r.ngvl; }), cfg.minHistory);
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
        };
    },

    tierOfCycle(usRec, caRec, maxTier) {
        if (!usRec || !usRec.n) return 'WATCH';
        const usLift = (usRec.workedPct || 0) - (usRec.any ? usRec.any.workedPct || 0 : 0);
        const caLift = caRec && caRec.n ? (caRec.workedPct || 0) - (caRec.any ? caRec.any.workedPct || 0 : 0) : usLift;
        const usNearDouble = usRec.any && (usRec.nearLowPct || 0) >= 2 * (usRec.any.nearLowPct || 0);
        const caNearDouble = !caRec || !caRec.n || !caRec.any || (caRec.nearLowPct || 0) >= 2 * (caRec.any.nearLowPct || 0);

        let tier = 'WATCH';
        if (usLift >= 5 && caLift >= 5) {
            tier = 'MODERATE';
        } else if (usLift >= 0 && caLift >= 0 && usNearDouble && caNearDouble) {
            tier = 'MODERATE';
        }
        if (usLift >= 10 && caLift >= 10 && usRec.n >= 30 && (!caRec || caRec.n >= 30)) {
            tier = 'STRONG';
        }
        if (usRec.n < 20 && tier === 'STRONG') {
            tier = 'MODERATE';
        }
        const order = ['WATCH', 'MODERATE', 'STRONG'];
        if (maxTier && order.indexOf(tier) > order.indexOf(maxTier)) {
            tier = maxTier;
        }
        return tier;
    },

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

        const CE = typeof CycleEngine !== 'undefined' ? CycleEngine : (typeof globalThis !== 'undefined' && globalThis.CycleEngine ? globalThis.CycleEngine : null);
        const startIdx = f.dates.findIndex(d => d >= '2012-06-01');

        for (const s of this.SETUPS) {
            const mask = new Array(f.n);
            for (let i = 0; i < f.n; i++) mask[i] = !!s.test(f, i);
            const byHold = {};
            for (const h of this.CFG.holds) {
                const trades = this.buildTrades(f, mask, s.side, h);
                byHold[h] = { trades: trades, stats: this.tradeStats(trades, model.bench[s.side][h], half) };
            }
            const otherHold = this.CFG.holds.filter(function(h) { return h !== s.hold; })[0];
            const primary = byHold[s.hold];

            let streak = 0;
            for (let i = last; i >= 0 && mask[i]; i--) streak++;
            const openTrade = primary.trades.length && primary.trades[primary.trades.length - 1].open ? primary.trades[primary.trades.length - 1] : null;
            let lastFired = null;
            for (let i = last; i >= 0; i--) if (mask[i]) { lastFired = f.dates[i]; break; }
            const days = mask.reduce(function(a, b) { return a + (b ? 1 : 0); }, 0);
            const needsOptions = s.family.indexOf('OPTIONS') >= 0, needsFlows = s.family.indexOf('FLOWS') >= 0;

            let cycle = null;
            let tier = 'WATCH';
            if (CE && startIdx >= 0) {
                const usLegCloses = s.side === 'short' ? f.kCloses : f.bCloses;
                const usC = usLegCloses.slice(startIdx);
                const usM = mask.slice(startIdx);
                const usD = f.dates.slice(startIdx);
                const usRec = CE.record(usC, usM, usD);

                let caRec = null;
                const caSource = s.side === 'short' ? xShort : xLong;
                if (caSource && caSource.length) {
                    const caBars = caSource.filter(b => b && b.close != null && b.date >= '2012-06-01');
                    const usMap = new Map(f.dates.map((d, idx) => [d, !!mask[idx]]));
                    const caM = caBars.map(b => !!usMap.get(b.date));
                    const caC = caBars.map(b => b.close);
                    const caD = caBars.map(b => b.date);
                    caRec = CE.record(caC, caM, caD);
                }
                cycle = { us: usRec, ca: caRec };
                tier = self.tierOfCycle(usRec, caRec, s.maxTier);
            }

            model.setups.push({
                key: s.key, label: s.label, side: s.side, hold: s.hold, family: s.family, rule: s.rule, why: s.why, risk: s.risk, maxTier: s.maxTier,
                mask: mask, days: days,
                status: mask[last] ? 'ACTIVE' : (openTrade ? 'IN_WINDOW' : 'OFF'),
                streak: streak, since: streak ? f.dates[last - streak + 1] : null,
                openTrade: openTrade, lastFired: lastFired,
                tier: tier,
                cycle: cycle,
                stats: primary.stats, trades: primary.trades,
                otherHold: otherHold, otherStats: byHold[otherHold] ? byHold[otherHold].stats : null,
                unavailable: (needsOptions && !f.optLastDate) || (needsFlows && f.flowStale),
            });
        }

        let atLow = false;
        if (f.n >= 63) {
            let minK63 = Infinity;
            for (let j = Math.max(0, last - 62); j <= last; j++) {
                if (f.kCloses[j] < minK63) minK63 = f.kCloses[j];
            }
            atLow = f.kCloses[last] <= 1.10 * minK63;
        }

        let optUpsideStress10 = false;
        for (let j = Math.max(0, last - 9); j <= last; j++) {
            if (f.optState[j] === 'UPSIDE_STRESS') { optUpsideStress10 = true; break; }
        }

        let ngMax126In10 = false;
        let mxLi126 = -Infinity;
        for (let j = Math.max(0, last - 125); j <= last; j++) {
            if (f.li[j] > mxLi126) mxLi126 = f.li[j];
        }
        for (let j = Math.max(0, last - 9); j <= last; j++) {
            if (Math.abs(f.li[j] - mxLi126) < 1e-8) { ngMax126In10 = true; break; }
        }

        let secondSurge = false;
        let maxK126Idx = 0, maxK126Val = -Infinity;
        for (let j = Math.max(0, last - 125); j <= last; j++) {
            if (f.kCloses[j] > maxK126Val) { maxK126Val = f.kCloses[j]; maxK126Idx = j; }
        }
        const aSetup = model.setups.find(s => s.key === 'SHORT_ACCUMULATION');
        if (aSetup && CE) {
            const aEps = CE.episodes(aSetup.mask, 10, 0);
            const epsAfterHigh = aEps.filter(idx => idx > maxK126Idx);
            if (epsAfterHigh.length >= 2) secondSurge = true;
        }

        let longDipBuying = false;
        if (f.lv && last >= 10) {
            let kLv = 0;
            for (let j = last - 4; j <= last; j++) if (f.lv[j] >= 1.5) kLv++;
            longDipBuying = kLv >= 3 && f.bCloses[last] <= f.bCloses[last - 10];
        }

        let maxB63 = -Infinity;
        for (let j = Math.max(0, last - 62); j <= last; j++) if (f.bCloses[j] > maxB63) maxB63 = f.bCloses[j];
        const putSkewExtreme = (f.skewPe[last] != null && f.skewPe[last] <= 10) && (maxB63 > 0 && f.bCloses[last] <= 0.70 * maxB63);

        const koldPvtStretched = f.zK && f.zK[last] >= 1.0;

        let exitWatch = false;
        if (aSetup && (aSetup.status === 'ACTIVE' || aSetup.status === 'IN_WINDOW') && aSetup.openTrade) {
            const entryClose = f.kCloses[aSetup.openTrade.entryIdx];
            const gainFromEntry = entryClose > 0 ? (f.kCloses[last] / entryClose - 1) : 0;
            const pvtHighToday = f.zKmax10 && f.zK && f.impK && f.zKmax10[last] >= 1.5 && f.zK[last] >= 0.75 && f.impK[last] < -0.5;
            if (gainFromEntry >= 0.15 && pvtHighToday) exitWatch = true;
        }

        model.inputs = {
            sv: f.sv ? f.sv[last] : null,
            lv: f.lv ? f.lv[last] : null,
            kold10: f.kold10 ? f.kold10[last] : null,
            atLow: atLow,
            optUpsideStress10: optUpsideStress10,
            ngMax126In10: ngMax126In10,
            secondSurge: secondSurge,
            longDipBuying: longDipBuying,
            putSkewExtreme: putSkewExtreme,
            koldPvtStretched: koldPvtStretched,
            exitWatch: exitWatch,
            cpPe: f.cpPe[last], cp: f.cp[last], rvPe: f.rvPe[last], rv: f.rv[last] != null ? f.rv[last] * Math.sqrt(252) * 100 : null,
            dd63: f.dd63[last], boilClimax: f.boilClimax[last], boilRvolMax: f.boilRvolMax[last], boilMwca: f.boilMwca[last],
            optState: f.optState[last], optDate: f.optLastDate, skewPe: f.skewPe[last], ngvlPe: f.ngvlPe[last],
            flowPe: f.flowPe[last], flowStale: f.flowStale, flowDate: f.flowLastIdx >= 0 ? f.dates[f.flowLastIdx] : null,
            cpXPe: f.cpXPe[last], xDate: f.xLastDate, xStats: this.crossCheckStats(f),
        };
        model.ready = true;
        return model;
    },

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
                    let tip = null;
                    if (s.key === 'SHORT_ACCUMULATION') {
                        const sv = m.frame.sv && m.frame.sv[i] != null ? m.frame.sv[i].toFixed(1) : '—';
                        const k10 = m.frame.kold10 && m.frame.kold10[i] != null ? m.frame.kold10[i].toFixed(1) : '—';
                        tip = 'SHORT-SIDE ACCUMULATION · SV ' + sv + '× · KOLD ' + k10 + '% / 10 sessions';
                    }
                    (by[d] = by[d] || []).push({ label: s.label, side: s.side, tier: s.tier, tooltip: tip });
                }
            }
            m._byDate = by;
        }
        return m._byDate[date] || null;
    },

    _f(v, d) { return v != null && isFinite(v) ? v.toFixed(d == null ? 0 : d) : '—'; },
    _s(v, d) { return v != null && isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%' : '—'; },
    _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    _tierColor(t) { return t === 'STRONG' ? '#3db87a' : (t === 'MODERATE' ? '#d4a830' : (t === 'WATCH' ? '#8a8a9a' : '#555565')); },
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
        const u = s.cycle && s.cycle.us ? s.cycle.us : null;
        const c = s.cycle && s.cycle.ca ? s.cycle.ca : null;
        if (!u || !u.n) return '<div class="aa-rule">No completed trades yet.</div>';
        const gridTip = 'Record of buying the leg at the close of the first trigger day: worked means +30% was reached before −20%.';
        return '<div class="aa-stats" data-tooltip="' + this._esc(gridTip) + '">' +
            this._stat('WORKED', u.worked + ' of ' + u.n, this._f(u.workedPct) + '%', gridTip) +
            this._stat('ANY DAY', (u.any ? this._f(u.any.workedPct) : '—') + '%', 'all history', 'Share of random days reaching +30% before −20%') +
            this._stat('TYPICAL RUN', this._s(u.run, 0), 'to next peak', 'Median gain to the next confirmed cycle peak') +
            this._stat('TYPICAL HEAT', this._s(u.heat, 0), 'from entry', 'Median worst point before the peak') +
            this._stat('TURNS CAUGHT', (u.caughtPct != null ? this._f(u.caughtPct) + '%' : '—'), 'cycle lows', 'Share of cycle lows with a trigger within 10 sessions') +
            this._stat('TORONTO', (c && c.n ? c.worked + ' of ' + c.n : '—'), (c && c.n ? this._f(c.workedPct) + '%' : '—'), 'Record on Toronto mirror') +
        '</div>';
    },

    _card(s, f, inp) {
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

        let sentence = '';
        if (s.status === 'ACTIVE') {
            if (s.key === 'SHORT_ACCUMULATION') {
                let kSv = 0;
                for (let j = f.n - 5; j < f.n; j++) if (f.sv[j] >= 1.5) kSv++;
                const k10 = f.kold10[f.n - 1] != null ? Math.abs(f.kold10[f.n - 1]).toFixed(1) : '—';
                sentence = '<div class="aa-status-sent">KOLD and HND volume has run at 1.5× normal on ' + kSv + ' of the last 5 sessions with KOLD ' + k10 + '% lower over 10 sessions.</div>';
            } else if (s.key === 'SHORT_LEG_REVERSAL') {
                let d = 0;
                if (f.zK) {
                    let mx = -Infinity, mxIdx = f.n - 1;
                    for (let j = Math.max(0, f.n - 10); j < f.n; j++) if (f.zK[j] > mx) { mx = f.zK[j]; mxIdx = j; }
                    d = f.n - 1 - mxIdx;
                }
                sentence = '<div class="aa-status-sent">KOLD\'s price-volume trend peaked ' + d + ' sessions ago and today was a heavy down session.</div>';
            } else if (s.key === 'PVT_RECOVERY') {
                const mn = f.zKmin20 && f.zKmin20[f.n - 1] != null ? f.zKmin20[f.n - 1].toFixed(1) : '−2';
                sentence = '<div class="aa-status-sent">KOLD\'s price-volume trend fell to ' + mn + ' and has recovered through −1.</div>';
            }
        }

        const tierTip = 'Evidence tier recomputed from trade cycles. STRONG: lift ≥ 10 on both legs with at least 30 trades. MODERATE: lift ≥ 5, or near-low share doubled with positive lift.';
        const small = s.cycle && s.cycle.us && s.cycle.us.n < 20 ? '<span class="aa-small" data-tooltip="Fewer than 20 trades.">FEW TRADES</span>' : '';

        const chips = [];
        if (s.status === 'ACTIVE' && s.key === 'SHORT_ACCUMULATION') {
            if (inp.atLow) chips.push('<span class="aa-chip aa-chip-info" data-tooltip="KOLD within 10% of its 63-session low.">AT 63-SESSION LOW</span>');
            if (inp.skewPe <= 30 || inp.ngvlPe <= 40) chips.push('<span class="aa-chip aa-chip-warn" data-tooltip="In quiet options markets this setup reached +30% in about one trade in three.">CAUTION: QUIET MARKET</span>');
            if (inp.optUpsideStress10) chips.push('<span class="aa-chip aa-chip-warn" data-tooltip="With upside stress in the options market the typical trade was down 38% at its worst.">CAUTION: OPTIONS UPSIDE STRESS</span>');
            if (inp.ngMax126In10) chips.push('<span class="aa-chip aa-chip-warn" data-tooltip="First surges while NG is still making six-month highs were early: the typical trade was down 36% at its worst.">CAUTION: NG AT 6-MONTH HIGH</span>');
            if (inp.secondSurge) chips.push('<span class="aa-chip aa-chip-good" data-tooltip="Second and later surges in the same KOLD decline reached +30% in 10 of 14 trades.">SECOND SURGE</span>');
        }
        if (s.key === 'SHORT_ACCUMULATION' && inp.exitWatch) {
            chips.push('<span class="aa-chip aa-chip-alert" data-tooltip="KOLD\'s price-volume trend is stretched and turning down.">EXIT WATCH</span>');
        }

        const chipsHtml = chips.length ? '<div class="aa-chips">' + chips.join(' ') + '</div>' : '';

        const planLine = s.side === 'short'
            ? '<div class="aa-plan" data-tooltip="On past SHORT-SIDE ACCUMULATION trades: +30% was reached 58% of the time in a median 18 sessions; +50% was reached 50% of the time. A closing stop can be gapped.">PLAN  Stop −20% on a closing basis · first target +30% · hold the rest for +50% or the PVT exit marker</div>'
            : '<div class="aa-plan" data-tooltip="BOIL trades held for larger targets gave back the gain: +4.6% average per trade with this plan, +1.0% when held for +50%.">PLAN  Stop −15% on a closing basis · target +30% · do not hold for more</div>';

        const riskLine = s.risk ? '<div class="aa-risk">Risk: ' + this._esc(s.risk) + '</div>' : '';

        return '<div class="aa-card' + (s.status === 'ACTIVE' ? '' : ' aa-window') + '">' +
            '<div class="aa-card-head">' +
                '<span class="aa-name" data-tooltip="' + this._esc(s.why) + '">' + s.label + '</span>' +
                '<span class="aa-side" style="color:' + color + '">' + sideTxt + '</span>' +
                '<span class="aa-tier" style="color:' + this._tierColor(s.tier) + '" data-tooltip="' + this._esc(tierTip) + '">' + s.tier + '</span>' + small +
                '<span class="aa-family">' + s.family + '</span>' +
            '</div>' +
            chipsHtml +
            '<div class="aa-status">' + status + '</div>' +
            sentence +
            '<div class="aa-rule">' + s.rule + '.</div>' +
            riskLine +
            this._statGrid(s) +
            planLine +
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
        const order = { STRONG: 0, MODERATE: 1, WATCH: 2 };
        live.sort(function(a, b) { return (a.status === 'ACTIVE' ? 0 : 1) - (b.status === 'ACTIVE' ? 0 : 1) || order[a.tier] - order[b.tier]; });
        const act = live.filter(function(s) { return s.status === 'ACTIVE' && s.tier !== 'WATCH'; });
        const shorts = act.filter(function(s) { return s.side === 'short'; }), longs = act.filter(function(s) { return s.side === 'long'; });
        const names = function(arr) { return arr.length + ' setup' + (arr.length > 1 ? 's' : '') + ' active: ' + arr.map(function(s) { return s.label; }).join(', '); };

        let bias, head, headColor;
        if (shorts.length && longs.length) { bias = 'MIXED'; head = 'Short and long setups are active at the same time'; headColor = '#d4a830'; }
        else if (shorts.length) { bias = 'BEARISH'; head = names(shorts); headColor = 'var(--red)'; }
        else if (longs.length) { bias = 'BULLISH'; head = names(longs); headColor = 'var(--green)'; }
        else if (live.length) { bias = 'NO NEW TRIGGER'; head = 'Earlier setups remain inside their holding window'; headColor = '#8a8a9a'; }
        else { bias = 'NO ACTIVE SETUP'; head = 'No trade setup is triggered'; headColor = '#8a8a9a'; }

        // Today line (W11)
        let todayText = 'TODAY  No setup. Nothing to do.';
        const aActive = act.find(s => s.key === 'SHORT_ACCUMULATION');
        const anyModStrongShort = act.find(s => s.side === 'short');
        const anyModLong = act.find(s => s.side === 'long');

        if (aActive) {
            const cautions = [];
            if (inp.koldPvtStretched) cautions.push('KOLD price-volume trend is high');
            if (inp.skewPe <= 30 || inp.ngvlPe <= 40) cautions.push('QUIET MARKET');
            if (inp.optUpsideStress10) cautions.push('OPTIONS UPSIDE STRESS');
            if (inp.ngMax126In10) cautions.push('NG AT 6-MONTH HIGH');

            if (cautions.length) {
                todayText = 'TODAY  Short-side accumulation is on, with a caution: ' + cautions[0] + '. Half size or wait for a second surge.';
            } else {
                todayText = 'TODAY  Short-side accumulation is on. KOLD entry zone; stop −20%, first target +30%.' + (inp.secondSurge ? ' Second surge in this decline.' : '');
            }
        } else if (inp.exitWatch) {
            todayText = 'TODAY  Exit watch on the open KOLD trade.';
        } else if (anyModStrongShort) {
            todayText = 'TODAY  ' + anyModStrongShort.label + ' is on. KOLD entry zone; stop −20%, first target +30%.';
        } else if (anyModLong) {
            todayText = 'TODAY  ' + anyModLong.label + ' is on. Tactical BOIL entry; stop −15%, target +30%.';
        } else if (inp.longDipBuying) {
            todayText = 'TODAY  No entry. Heavy buying into a falling BOIL has a poor record.';
        }

        const notes = [], xc = this._crossCheck(inp);
        if (inp.longDipBuying) {
            notes.push('LONG-SIDE DIP BUYING: Heavy volume is going into a falling BOIL. Past BOIL entries in this state reached +30% about one time in four');
        }
        if (inp.putSkewExtreme) {
            notes.push('PUT-SKEW EXTREME: Put skew is extreme with BOIL deeply off its high. Past BOIL entries here reached +30% in 11 of 19 trades');
        }
        if (inp.koldPvtStretched) {
            notes.push('KOLD PRICE-VOLUME STRETCHED: KOLD\'s price-volume trend is high. Past KOLD entries in this state reached +30% about one time in three');
        }

        const cpActive = shorts.some(function(s) { return s.key === 'CLOSE_EXHAUSTION'; });
        if (shorts.length && !cpActive && inp.cpPe != null)
            notes.push('Closing pressure is at the ' + self._ord(inp.cpPe) + ' percentile');
        if (cpActive && xc.agrees != null)
            notes.push(xc.agrees ? 'The Toronto pair confirms the closing-pressure reading (' + self._ord(inp.cpXPe) + ' percentile)'
                : 'The Toronto pair does not confirm the closing-pressure reading (' + self._ord(inp.cpXPe) + ' percentile)');
        if (shorts.length && !shorts.some(function(s) { return s.key === 'OPT_BLOWOFF'; }) && inp.optState)
            notes.push('Options state: ' + self._optLabel(inp.optState));

        const cpTone = inp.cpPe == null ? null : (inp.cpPe >= 90 ? 'var(--red)' : (inp.cpPe <= 20 ? 'var(--green)' : null));
        const rvTone = inp.rvPe == null ? null : (inp.rvPe >= 70 ? 'var(--red)' : null);
        const optTone = inp.optState === 'BLOWOFF' ? 'var(--red)' : (inp.optState === 'UPSIDE_STRESS' ? '#d4a830' : (inp.optState === 'PANIC_FLUSH' ? 'var(--green)' : null));
        const xs = inp.xStats || {};
        const xTip = 'The same closing-pressure measure computed on HNU / HND in Toronto and ranked against its own history. Toronto data through ' + (inp.xDate || '—') + '.';

        const svTone = inp.sv != null && inp.sv >= 1.5 ? 'var(--red)' : null;

        const gauges =
            this._gauge('SHORT-SIDE VOLUME', Math.min(100, ((inp.sv || 0) / 3) * 100), (inp.sv != null ? inp.sv.toFixed(1) + 'x' : '—'), 'Combined dollar volume of KOLD and HND relative to its 63-session median. Accumulation at 1.5x on 3 of 5.', svTone) +
            this._gauge('CLOSING PRESSURE', inp.cpPe, self._ord(inp.cpPe), 'Closing pressure = (CMF-21 of BOIL − CMF-21 of KOLD) / 2 on dollar volume.', cpTone) +
            this._gauge('TORONTO CHECK', inp.cpXPe, xc.text, xTip, xc.tone) +
            this._gauge('REALIZED VOL', inp.rvPe, self._ord(inp.rvPe) + (inp.rv != null ? ' · ' + self._f(inp.rv) + '%' : ''), '21-session realized volatility of the tradeable NG index.', rvTone) +
            this._gauge('BOIL FLOWS (5D)', inp.flowStale ? null : inp.flowPe, inp.flowStale ? 'Stale' : self._ord(inp.flowPe), 'BOIL net creations over five sessions, lagged one session.', null) +
            this._gauge('OPTIONS STATE', null, self._optLabel(inp.optState), 'State of the CVOL options surface. Call-skew percentile ' + self._f(inp.skewPe) + ', implied-volatility percentile ' + self._f(inp.ngvlPe) + '.', optTone, true) +
            this._gauge('BOIL VOLUME', null, inp.boilClimax ? 'Climax' : 'Normal' + (inp.boilRvolMax != null ? ' · ' + self._f(inp.boilRvolMax, 1) + 'x' : ''), 'BOIL share volume spike indicator.', inp.boilClimax ? '#d4a830' : null) +
            this._gauge('DRAWDOWN (63D)', null, self._s(inp.dd63 != null ? inp.dd63 * 100 : null, 0), 'Tradeable NG index relative to its 63-session high.', inp.dd63 != null && inp.dd63 <= -0.25 ? 'var(--green)' : null);

        const rows = model.setups.map(function(s) {
            const u = s.cycle && s.cycle.us ? s.cycle.us : null;
            const statusTxt = s.unavailable ? 'No data' : (s.status === 'ACTIVE' ? 'Active' : (s.status === 'IN_WINDOW' ? 'In window' : 'Off'));
            const statusColor = s.status === 'ACTIVE' ? (s.side === 'short' ? 'var(--red)' : 'var(--green)') : (s.status === 'IN_WINDOW' ? '#d4a830' : 'var(--text-muted)');

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
                ledgerHtml = '<tr id="aa-ledger-' + s.key + '" class="aa-ledger-row" style="display:none;"><td colspan="5">' +
                    '<div class="aa-ledger-container">' +
                        '<div class="aa-ledger-title">' +
                            '<span><b>' + s.label + '</b> · trade ledger · ' + s.trades.length + ' non-overlapping trades, most recent first</span>' +
                            '<span>Hold ' + s.hold + ' sessions</span>' +
                        '</div>' +
                        '<div style="overflow-x:auto;"><table class="aa-ledger-table"><thead><tr>' +
                            '<th>ENTRY</th><th>EXIT</th><th>SESSIONS</th><th>NG RETURN</th><th>TRADE RETURN</th><th>' + (s.side === 'short' ? 'KOLD' : 'BOIL') + ' LEG</th><th>MAX ADVERSE</th><th>OUTCOME</th>' +
                        '</tr></thead><tbody>' + trRows + '</tbody></table></div>' +
                    '</div>' +
                '</td></tr>';
            }

            return '<tr class="aa-setup-row" data-setup-key="' + s.key + '">' +
                '<td class="aa-td-name" data-tooltip="' + self._esc(s.rule + '. ' + s.why) + '"><span class="aa-row-toggle">+</span>' + s.label + '</td>' +
                '<td style="color:' + (s.side === 'short' ? 'var(--red)' : 'var(--green)') + '">' + (s.side === 'short' ? 'Short' : 'Long') + '</td>' +
                '<td style="color:' + self._tierColor(s.tier) + '">' + s.tier + '</td>' +
                '<td>' + (u && u.n ? u.worked + ' of ' + u.n + ' (' + self._f(u.workedPct) + '%)' : '—') + '</td>' +
                '<td>' + (s.lastFired || '—') + '</td>' +
            '</tr>' + ledgerHtml;
        }).join('');

        el.innerHTML =
            '<div class="aa-today">' + self._esc(todayText) + '</div>' +
            '<div class="aa-head">' +
                '<div class="aa-head-main"><span class="aa-bias" style="color:' + headColor + '">' + bias + '</span>' + head + '</div>' +
                (notes.length ? '<div class="aa-head-note">' + notes.join('. ') + '.</div>' : '') +
                '<div class="aa-head-basis">Data through ' + model.asOf + ' · trade cycles basis</div>' +
            '</div>' +
            (live.length ? '<div class="aa-cards">' + live.map(function(s) { return self._card(s, model.frame, inp); }).join('') + '</div>' : '') +
            '<div class="aa-inputs">' + gauges + '</div>' +
            '<details class="aa-details"><summary>All setups: status and cycle record</summary>' +
                '<div class="aa-table-wrap"><table class="aa-table"><thead><tr>' +
                    '<th>SETUP</th><th>SIDE</th><th>TIER</th><th>WORKED</th><th>LAST TRIGGER</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
                '<div class="aa-foot">Record of buying the leg at the close of the first trigger day: worked means +30% was reached before −20%.</div>' +
            '</details>';

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
