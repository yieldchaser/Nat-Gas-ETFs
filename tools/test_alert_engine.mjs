// Node test for docs/js/alert-engine.js. Run from the repo root: node tools/test_alert_engine.mjs
import { createRequire } from 'module';
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
const require = createRequire(import.meta.url);
const AE = require('../docs/js/alert-engine.js');

const dash = JSON.parse(fs.readFileSync('data/dashboard_data.json', 'utf8'));
const boil = dash.etfs.BOIL.history, kold = dash.etfs.KOLD.history;
const cvolText = fs.readFileSync('data/cvol/ngvl_cvol_history.csv', 'utf8');
const cvol = AE.parseCvolCsv(cvolText);
const flows = AE.flowMap(JSON.parse(fs.readFileSync('data/flows/BOIL_flows.json', 'utf8')));

// helpers
assert(Math.abs(AE.binomTail(17, 20, 0.56) - 0.0063) < 0.001, 'binomial tail');
assert.deepStrictEqual(AE.expandingPercentile([1, 2, 3, 4], 2), [null, 100, 100, 100]);
assert(cvol.length > 3000 && cvol.every(r => { const d = new Date(r.date + 'T00:00:00Z').getUTCDay(); return d !== 0 && d !== 6; }), 'cvol parse skips weekends');

const m = AE.compute(boil, kold, cvol, flows);
const f = m.frame;
assert(m.ready && f.n > 3500, 'model ready');
assert.strictEqual(m.setups.length, AE.SETUPS.length);

// tradeable index must match the sidecar the CVOL tab uses (same construction)
const side = fs.readFileSync('data/cvol/ng_tradeable.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
const sidx = Object.fromEntries(side.map(p => [p[0], parseFloat(p[1])]));
const d0 = f.dates.findIndex(d => sidx[d] != null), d1 = f.n - 1;
const eng = Math.exp(f.li[d1] - f.li[d0]), ref = sidx[f.dates[d1]] / sidx[f.dates[d0]];
assert(Math.abs(eng / ref - 1) < 1e-6, `index parity with ng_tradeable.csv (${eng} vs ${ref})`);

// option states must match the CVOL tab engine on every shared date
const ctx = { console, Math, Date, isFinite, parseFloat, parseInt, Number, Array, Object, JSON, String, Infinity, NaN };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('docs/js/cvol.js', 'utf8') + '\nthis.__c = { parseCvolCsv, parseTradeableCsv, attachTradeable, computeEdgeModel };', ctx);
const cdata = ctx.__c.parseCvolCsv(cvolText);
ctx.__c.attachTradeable(cdata, ctx.__c.parseTradeableCsv(fs.readFileSync('data/cvol/ng_tradeable.csv', 'utf8')));
const edge = ctx.__c.computeEdgeModel(cdata, {});
const tabState = Object.fromEntries(cdata.map((r, i) => [r.date, edge.daily[i]]));
let shared = 0, same = 0;
for (let i = 0; i < f.n; i++) if (f.optState[i] != null && tabState[f.dates[i]] != null) { shared++; if (f.optState[i] === tabState[f.dates[i]]) same++; }
assert(shared > 3000 && same / shared > 0.995, `option-state parity with cvol.js: ${same}/${shared}`);

// invariants on every setup
for (const s of m.setups) {
    const def = AE.SETUPS.find(x => x.key === s.key);
    let prevExit = -1;
    for (const t of s.trades) {
        assert(t.entryIdx >= AE.CFG.minHistory, `${s.key}: entry after warm-up`);
        assert(def.test(f, t.entryIdx), `${s.key}: entry day satisfies the rule`);
        assert(t.entryIdx > prevExit, `${s.key}: trades do not overlap`);
        assert(t.sessions <= s.hold && (t.open || t.sessions === s.hold), `${s.key}: hold length`);
        const ng = (Math.exp(f.li[t.exitIdx] - f.li[t.entryIdx]) - 1) * 100;
        assert(Math.abs(t.pnl - (s.side === 'short' ? -ng : ng)) < 1e-9, `${s.key}: P&L sign`);
        prevExit = t.exitIdx;
    }
    assert(['STRONG', 'MODERATE', 'WEAK', 'NONE'].includes(s.tier));
    const order = ['NONE', 'WEAK', 'MODERATE', 'STRONG'];
    assert(order.indexOf(s.tier) <= order.indexOf(s.maxTier), `${s.key}: tier cap respected`);
    assert(['ACTIVE', 'IN_WINDOW', 'OFF'].includes(s.status));
    if (s.status === 'ACTIVE') assert(s.mask[f.n - 1]);
}

// no look-ahead: truncating the history must not change any earlier mask value
const cut = f.n - 300, cutDate = f.dates[cut - 1];
const m2 = AE.compute(boil.filter(b => b.date <= cutDate), kold.filter(b => b.date <= cutDate), cvol.filter(r => r.date <= cutDate),
    Object.fromEntries(Object.entries(flows).filter(([d]) => d <= cutDate)));
for (const s of m.setups) {
    const s2 = m2.setups.find(x => x.key === s.key);
    for (let i = 0; i < cut; i++) assert.strictEqual(s2.mask[i], s.mask[i], `${s.key}: causal at ${f.dates[i]}`);
}

// evidence must stay in the neighbourhood the research found (docs/alerts_research.md)
const by = Object.fromEntries(m.setups.map(s => [s.key, s]));
assert(by.CLOSE_EXHAUSTION.stats.n >= 35 && by.CLOSE_EXHAUSTION.stats.winRate > 65, 'close exhaustion evidence');
assert(by.OPT_BLOWOFF.stats.n >= 10 && by.OPT_BLOWOFF.stats.winRate > 70, 'blow-off evidence');
assert(by.CAPITULATION.stats.n >= 15 && by.CAPITULATION.stats.winRate > 60, 'capitulation evidence');
assert(m.bench.short[21].winRate > 55 && m.bench.long[21].winRate < 45, 'benchmarks reflect the roll bleed');

// render into a stub element
const el = { innerHTML: '' };
AE.render(m, el);
assert(el.innerHTML.includes('aa-head') && el.innerHTML.includes('All setups'), 'render');
AE.render(AE.compute(boil.slice(0, 100), kold.slice(0, 100), null, null), el);
assert(el.innerHTML.includes('not available'), 'render fallback');
// engine must degrade without options or flows
const m3 = AE.compute(boil, kold, null, null);
assert(m3.ready && m3.setups.find(s => s.key === 'OPT_BLOWOFF').unavailable && m3.setups.find(s => s.key === 'CHASED_RALLY').unavailable);

if (process.argv.includes('--report')) {
    console.log('as of', m.asOf, '| bench short21', m.bench.short[21].winRate.toFixed(1), 'long21', m.bench.long[21].winRate.toFixed(1), '| option parity', same + '/' + shared);
    for (const s of m.setups) {
        const st = s.stats, o = s.otherStats;
        console.log(`${s.label.padEnd(24)} ${s.side.padEnd(5)} h${s.hold} ${s.tier.padEnd(8)} ${s.status.padEnd(9)} days ${String(s.days).padStart(4)} trades ${st.wins}/${st.n} (${st.winRate?.toFixed(0)}% vs ${st.benchWinRate.toFixed(0)}%) avg ${st.mean?.toFixed(1)}% leg ${st.legMean?.toFixed(1)}% p ${st.p?.toFixed(3)} halves ${st.h1Rate?.toFixed(0)}(${st.h1n})/${st.h2Rate?.toFixed(0)}(${st.h2n}) worst ${st.worst?.toFixed(0)} heat ${st.worstHeat?.toFixed(0)} | h${s.otherHold}: ${o.wins}/${o.n} (${o.winRate?.toFixed(0)}% vs ${o.benchWinRate.toFixed(0)}%) p ${o.p?.toFixed(3)} | last ${s.lastFired}`);
    }
    console.log('inputs', JSON.stringify(m.inputs));
}
console.log('Alert engine tests passed');
