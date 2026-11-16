// Scores the twelve Price-Volume Studies against forward natural-gas returns and writes
// docs/data/indicator_evidence.json, which the Price-Volume Studies panel reads.
//
//   node tools/indicator_evidence.mjs            write the JSON
//   node tools/indicator_evidence.mjs --report   also print the table
//
// Method (same conventions as docs/js/alert-engine.js):
//   * Each study is computed with the site's own code (docs/js/volume-studies.js), so what is
//     scored is exactly what the panel draws.
//   * Target: the unlevered, roll-adjusted NG return implied by the ETF's own long / short pair,
//     (r_long - r_short) / (2 * leverage), over the next 21 sessions.
//   * Rank correlation (Spearman) between today's reading and that forward return, for the full
//     history and for each half. A study is only credited when the sign is the same in both
//     halves on every ETF with usable bars.
//   * Tail test: non-overlapping 21-session trades entered when the reading is at or above its
//     90th expanding percentile (and at or below its 10th), against the any-day rate.
//   * The two built-in position models (OBV and PVT tabs) are scored on the ETF's own daily
//     return in position against out of position.
//   * Bar quality is measured per ETF. London bars fail it, so London results are reported but
//     excluded from the verdict.
import fs from 'fs';
import vm from 'vm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const AE = require('../docs/js/alert-engine.js');

const HOLD = 21, MIN_HIST = 252, LEVERAGE = { 'BOIL': 2, 'KOLD': 2, 'HNU.TO': 2, 'HND.TO': 2, '3NGL.L': 3, '3NGS.L': 3 };
const ctx = { console, Math, Date, JSON, Map, Set, Float64Array, Array, Object, Number, isFinite, parseFloat, parseInt };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('docs/js/config.js', 'utf8') + '\n;globalThis.__CFG = CONFIG;', ctx);
vm.runInContext(fs.readFileSync('docs/js/volume-studies.js', 'utf8') + '\n;globalThis.__VS = VolumeStudies;', ctx);
const VS = ctx.__VS, CFG = ctx.__CFG;
const ETFS = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8')).etfs;

// ── statistics ───────────────────────────────────────────────────────────────
function ranks(a) {
    const idx = a.map((v, i) => i).sort((x, y) => a[x] - a[y]), r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
        let j = i;
        while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
        for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1;
        i = j + 1;
    }
    return r;
}
function pearson(x, y) {
    const n = x.length; if (n < 3) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]; }
    const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    return den > 0 ? (n * sxy - sx * sy) / den : null;
}
const spearman = (x, y) => (x.length < 30 ? null : pearson(ranks(x), ranks(y)));
const r3 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000);
const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);

// ── per-pair NG index on the pair's shared calendar ──────────────────────────
function pairIndex(longHist, shortHist, lev) {
    const sMap = {}; for (const b of shortHist) if (b && b.close > 0) sMap[b.date] = b;
    const dates = [], li = [];
    let prevL = null, prevS = null, level = 0;
    for (const b of longHist) {
        if (!b || !(b.close > 0) || !sMap[b.date]) continue;
        const s = sMap[b.date];
        if (prevL != null) {
            const rl = b.close / prevL - 1, rs = s.close / prevS - 1;
            let r = (rl - rs) / (2 * lev);
            if (Math.abs(rl / lev + rs / lev) > 0.08) r = Math.abs(rl) < Math.abs(rs) ? rl / lev : -rs / lev;
            r = Math.max(-0.3, Math.min(0.3, r));
            level += Math.log(1 + r);
        }
        dates.push(b.date); li.push(level); prevL = b.close; prevS = s.close;
    }
    const map = {}; dates.forEach((d, i) => { map[d] = i; });
    return { dates, li, map };
}

// ── bar quality ──────────────────────────────────────────────────────────────
function quality(hist) {
    const h = hist.filter((b) => b && b.close > 0).slice(-2520);
    let zero = 0, pinned = 0, flat = 0;
    for (const b of h) {
        if (!b.volume) zero++;
        const hi = b.high ?? b.close, lo = b.low ?? b.close;
        if (hi === lo) flat++;
        else if (b.close === hi || b.close === lo) pinned++;
    }
    const q = { sessions: h.length, zeroVolumePct: r1(zero / h.length * 100), flatRangePct: r1(flat / h.length * 100), pinnedClosePct: r1(pinned / h.length * 100) };
    q.reliable = q.zeroVolumePct < 5 && q.pinnedClosePct + q.flatRangePct < 12;
    return q;
}

// ── studies: the series each tab draws ───────────────────────────────────────
function studySeries(t) {
    const hist = ETFS[t].history.filter((b) => b && b.close != null);
    const sis = ETFS[CFG.etfs[t].pair].history;
    const o = [], h = [], l = [], c = [], v = [], dv = [], dates = [];
    for (const b of hist) { const cc = b.close; dates.push(b.date); o.push(b.open ?? cc); h.push(b.high ?? cc); l.push(b.low ?? cc); c.push(cc); v.push(b.volume || 0); dv.push(cc * (b.volume || 0)); }
    const s = VS.computeUpgradedVolumeSuite(hist, t, sis), p = VS.computeInvariantPVTEngine(hist, t, sis);
    const bv = VS.bvcVpin(c, dv, 21, 10), am = VS.amihudIlliqLai(h, l, c, dv, 21, 5), ar = VS.abdiRanaldoEsvd(o, h, l, c, dv, 10, 21);
    const vw = VS.rollingVwapZ(h, l, c, dv, 21, 5), tk = VS.tkvfOscillator(h, l, c, dv, 21, 13, 34, 9);
    return {
        dates, closes: c, volumes: v,
        studies: {
            vol:   { label: 'Relative volume', series: s.rvol },
            osc:   { label: 'The dollar-volume oscillator', series: s.dvOsc },
            net:   { label: '21-session net volume', series: s.ewNet21 },
            cmf:   { label: 'The adaptive CMF drawn here (ACMF-14)', series: s.acmf, alt: { label: 'CMF-21 on dollar volume', series: VS.cmf(h, l, c, dv, 21) } },
            obv:   { label: 'The OBV z-score', series: s.zObv },
            pvt:   { label: 'The PVT z-score', series: p.zScore },
            vpin:  { label: 'VPIN', series: bv.vpin, alt: { label: 'Order-flow imbalance', series: bv.ofi } },
            illiq: { label: 'The Amihud illiquidity z-score', series: am.illiqZ },
            esvd:  { label: 'The Abdi-Ranaldo spread z-score', series: ar.zSpread },
            lmsw:  { label: 'The return-volume correlation', series: VS.lmswRho(c, dv, 21, 21) },
            vwapz: { label: 'The VWAP z-score', series: vw.vwapZ },
            tkvf:  { label: 'The Klinger volume force', series: tk.tkvf },
        },
        engines: { obv: s.inPosition, pvt: p.inPosition },
    };
}

function scoreSeries(series, dates, idx) {
    // align to the pair index and drop the warm-up where the ETF did not trade
    const x = [], y = [], pos = [];
    let traded = 0;
    for (let i = 0; i < dates.length; i++) {
        const k = idx.map[dates[i]];
        if (k == null) continue;
        traded++;
        const val = series[i];
        if (traded <= MIN_HIST || val == null || !isFinite(val) || k + HOLD >= idx.li.length) continue;
        x.push(val); y.push(idx.li[k + HOLD] - idx.li[k]); pos.push(k);
    }
    if (x.length < 500) return null;
    const half = x.length >> 1;
    const out = { n: x.length, ic: r3(spearman(x, y)), h1: r3(spearman(x.slice(0, half), y.slice(0, half))), h2: r3(spearman(x.slice(half), y.slice(half))) };
    out.stable = out.ic != null && out.h1 != null && out.h2 != null && Math.sign(out.h1) === Math.sign(out.ic) && Math.sign(out.h2) === Math.sign(out.ic) && Math.abs(out.ic) >= 0.05;
    // tail trades on the expanding percentile of the reading
    const pe = AE.expandingPercentile(x, MIN_HIST);
    const base = y.filter((v) => v > 0).length / y.length * 100;
    const tail = (test) => {
        let n = 0, up = 0, next = -1;
        for (let i = 0; i < x.length; i++) {
            if (pe[i] == null || !test(pe[i]) || pos[i] < next) continue;
            n++; if (y[i] > 0) up++; next = pos[i] + HOLD + 1;
        }
        if (n < 8) return { n };
        const lo = AE.binomTail(up, n, base / 100), hi = 1 - AE.binomTail(up + 1, n, base / 100);
        return { n, up, upRate: r1(up / n * 100), p: r3(Math.min(1, 2 * Math.min(lo, hi))) };
    };
    out.baseUpRate = r1(base);
    out.high = tail((p) => p >= 90);
    out.low = tail((p) => p <= 10);
    return out;
}

function scoreEngine(inPos, closes) {
    const a = [], b = [];
    for (let i = MIN_HIST; i < closes.length; i++) {
        if (!(closes[i - 1] > 0)) continue;
        const r = closes[i] / closes[i - 1] - 1;
        if (!isFinite(r) || Math.abs(r) > 0.9) continue;
        (inPos[i - 1] ? a : b).push(r);
    }
    if (a.length < 30 || b.length < 30) return { inPositionPct: r1(a.length / (a.length + b.length) * 100), sessionsIn: a.length };
    const mean = (z) => z.reduce((s, v) => s + v, 0) / z.length;
    const sd = (z, m) => Math.sqrt(z.reduce((s, v) => s + (v - m) * (v - m), 0) / (z.length - 1));
    const ma = mean(a), mb = mean(b), t = (ma - mb) / Math.sqrt(sd(a, ma) ** 2 / a.length + sd(b, mb) ** 2 / b.length);
    return { inPositionPct: r1(a.length / (a.length + b.length) * 100), sessionsIn: a.length, meanInPct: r3(ma * 100), meanOutPct: r3(mb * 100), t: r3(t) };
}

// ── run ──────────────────────────────────────────────────────────────────────
const tickers = Object.keys(ETFS);
const out = { generated: new Date().toISOString().slice(0, 10), horizonSessions: HOLD, asOf: null, quality: {}, studies: {}, engines: { obv: {}, pvt: {} } };
const idxCache = {};
for (const t of tickers) {
    const cfg = CFG.etfs[t], longT = cfg.side === 'long' ? t : cfg.pair, shortT = cfg.side === 'long' ? cfg.pair : t;
    const key = longT + '|' + shortT;
    if (!idxCache[key]) idxCache[key] = pairIndex(ETFS[longT].history, ETFS[shortT].history, LEVERAGE[t]);
    const idx = idxCache[key], S = studySeries(t);
    out.quality[t] = quality(ETFS[t].history);
    if (!out.asOf || S.dates[S.dates.length - 1] > out.asOf) out.asOf = S.dates[S.dates.length - 1];
    for (const [k, st] of Object.entries(S.studies)) {
        out.studies[k] = out.studies[k] || { label: st.label, etf: {} };
        out.studies[k].etf[t] = scoreSeries(st.series, S.dates, idx);
        if (st.alt) {
            out.studies[k].alt = out.studies[k].alt || { label: st.alt.label, etf: {} };
            out.studies[k].alt.etf[t] = scoreSeries(st.alt.series, S.dates, idx);
        }
    }
    out.engines.obv[t] = scoreEngine(S.engines.obv, S.closes);
    out.engines.pvt[t] = scoreEngine(S.engines.pvt, S.closes);
}

// verdict from the ETFs with usable bars only
const usable = tickers.filter((t) => out.quality[t].reliable);
const verdictOf = (etf) => {
    const rows = usable.map((t) => etf[t]).filter(Boolean);
    if (!rows.length) return { verdict: 'NONE', meanAbsIc: null, stableOn: 0, of: 0 };
    const stable = rows.filter((r) => r.stable).length, mean = rows.reduce((s, r) => s + Math.abs(r.ic || 0), 0) / rows.length;
    const verdict = stable === rows.length && mean >= 0.10 ? 'DIRECTIONAL' : (stable >= rows.length - 1 && stable >= 2 && mean >= 0.05 ? 'WEAK' : 'NONE');
    return { verdict, meanAbsIc: r3(mean), stableOn: stable, of: rows.length };
};
for (const st of Object.values(out.studies)) {
    Object.assign(st, verdictOf(st.etf));
    if (st.alt) Object.assign(st.alt, verdictOf(st.alt.etf));
}
out.usableEtfs = usable;

fs.writeFileSync('docs/data/indicator_evidence.json', JSON.stringify(out));
console.log('wrote docs/data/indicator_evidence.json  (as of ' + out.asOf + ', verdict from ' + usable.join(', ') + ')');

if (process.argv.includes('--report')) {
    const f = (v) => (v == null ? '   —  ' : (v >= 0 ? '+' : '') + v.toFixed(3));
    console.log('\nBar quality (last 10 years)');
    for (const t of tickers) { const q = out.quality[t]; console.log('  ' + t.padEnd(7) + ' zero-volume ' + String(q.zeroVolumePct).padStart(5) + '%  flat range ' + String(q.flatRangePct).padStart(5) + '%  close pinned to high/low ' + String(q.pinnedClosePct).padStart(5) + '%  ' + (q.reliable ? 'usable' : 'UNRELIABLE')); }
    console.log('\nRank correlation with the next ' + HOLD + ' sessions of NG (full history; * = same sign in both halves and |IC| >= 0.05)');
    console.log('  ' + 'study'.padEnd(34) + tickers.map((t) => t.padStart(9)).join('') + '   verdict');
    const line = (name, st) => console.log('  ' + name.padEnd(34) + tickers.map((t) => { const r = st.etf[t]; return (r ? f(r.ic) + (r.stable ? '*' : ' ') : '   —   ').padStart(9); }).join('') + '   ' + st.verdict + ' (' + st.stableOn + '/' + st.of + ', mean |IC| ' + st.meanAbsIc + ')');
    for (const [k, st] of Object.entries(out.studies)) { line(k + ' · ' + st.label, st); if (st.alt) line('    alt · ' + st.alt.label, st.alt); }
    console.log('\nReading at or above its 90th percentile: NG higher 21 sessions later, non-overlapping trades (any-day rate in brackets)');
    for (const [k, st] of Object.entries(out.studies)) console.log('  ' + k.padEnd(6) + usable.map((t) => { const r = st.etf[t]; return (t + ' ' + (r && r.high.up != null ? r.high.up + '/' + r.high.n + ' ' + r.high.upRate + '% (' + r.baseUpRate + '%) p ' + r.high.p : 'n/a')).padEnd(40); }).join(''));
    console.log('\nBuilt-in position models: ETF daily return in position vs out of position');
    for (const e of ['obv', 'pvt']) for (const t of usable) { const r = out.engines[e][t]; console.log('  ' + e.toUpperCase() + ' ' + t.padEnd(7) + ' in position ' + String(r.inPositionPct).padStart(5) + '% of sessions' + (r.t != null ? '   in ' + f(r.meanInPct) + '%  out ' + f(r.meanOutPct) + '%  t ' + r.t.toFixed(2) : '   too few sessions to score')); }
}
