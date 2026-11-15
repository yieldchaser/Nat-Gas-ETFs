const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function createMockContext() {
    const elements = {};
    const noop = function() {};
    const ctx = new Proxy({}, {
        get: function(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'measureText') return function(text) { return { width: String(text || '').length * 6 }; };
            target[prop] = noop;
            return target[prop];
        },
        set: function(target, prop, value) { target[prop] = value; return true; },
    });
    function makeElement(id) {
        return {
            id,
            innerHTML: '',
            textContent: '',
            style: {},
            dataset: {},
            classList: { add: noop, remove: noop, contains: () => false },
            addEventListener: noop,
            appendChild: noop,
            setAttribute: noop,
            querySelectorAll: () => [],
            querySelector: () => null,
            closest: () => null,
            getBoundingClientRect: () => ({ width: 980, height: 420, left: 0, top: 0, right: 980, bottom: 420 }),
            getContext: () => ctx,
        };
    }
    const document = {
        getElementById: function(id) {
            if (!elements[id]) elements[id] = makeElement(id);
            return elements[id];
        },
        querySelectorAll: () => [],
        createElement: (tag) => makeElement(tag),
        body: makeElement('body'),
    };
    const context = {
        console,
        assert,
        document,
        window: { devicePixelRatio: 1, addEventListener: noop },
        setTimeout,
        clearTimeout,
        elements,
    };
    context.global = context;
    return context;
}

function loadBrowserScripts() {
    const context = createMockContext();
    vm.createContext(context);
    const cvolJs = fs.readFileSync('docs/js/cvol.js', 'utf8');
    const uiJs = fs.readFileSync('docs/js/cvol-ui.js', 'utf8').split('(async function()')[0];
    const renderJs = fs.readFileSync('docs/js/cvol-render.js', 'utf8');
    vm.runInContext(cvolJs + '\nthis.__cvol = { CvolState, parseCvolCsv, computeComposites, classifySurfaceDay, SURFACE_STATES, surfaceStateColor, parseTradeableCsv, attachTradeable, cvolForwardReturn, expandingPercentile, EDGE_STATES, EDGE_CFG, edgeBinomTail };', context, { filename: 'docs/js/cvol.js' });
    vm.runInContext(renderJs, context, { filename: 'docs/js/cvol-render.js' });
    vm.runInContext(uiJs + '\nthis.__ui = { renderBanner, renderConvictionBanner, renderEdgePanel, renderKpiCards, renderRegimePanel, renderSurfaceAnalogPanel, renderTimeline, renderMainChart };', context, { filename: 'docs/js/cvol-ui.js' });
    return context;
}

function assertNear(actual, expected, tolerance, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

function syntheticComp(overrides) {
    const i = 252;
    function arr(value) {
        const out = new Array(253).fill(null);
        out[i] = value;
        return out;
    }
    const values = Object.assign({
        ngvlPct252: 50,
        atmPct252: 50,
        convPct63: 50,
        upVarZ21: 0,
        dnVarZ21: 0,
        skewRatioZ21: 0,
        skewRatioRoc5: 0,
        ngvlZ21: 0,
        convZ21: 0,
        vrp: 0,
        vrpZ21: 0,
        realVol: 45,
        vov: 1.2,
        varianceSpread: 0,
        varianceSpreadZ: 0,
        ngvlRoc5: 0,
    }, overrides || {});
    return {
        comp: {
            ngvlPct252: arr(values.ngvlPct252),
            atmPct252: arr(values.atmPct252),
            convPct63: arr(values.convPct63),
            upVarZ21: arr(values.upVarZ21),
            dnVarZ21: arr(values.dnVarZ21),
            skewRatioZ21: arr(values.skewRatioZ21),
            skewRatioRoc5: arr(values.skewRatioRoc5),
            ngvlZ21: arr(values.ngvlZ21),
            convZ21: arr(values.convZ21),
            vrp: arr(values.vrp),
            vrpZ21: arr(values.vrpZ21),
            realVol: arr(values.realVol),
            vov: arr(values.vov),
        },
        extra: {
            varianceSpread: arr(values.varianceSpread),
            varianceSpreadZ: arr(values.varianceSpreadZ),
            ngvlRoc5: arr(values.ngvlRoc5),
        },
    };
}

const context = loadBrowserScripts();
const { CvolState, parseCvolCsv, computeComposites, classifySurfaceDay, SURFACE_STATES, parseTradeableCsv, attachTradeable, cvolForwardReturn, expandingPercentile, EDGE_STATES, EDGE_CFG } = context.__cvol;
const csv = fs.readFileSync('docs/data/cvol/ngvl_cvol_history.csv', 'utf8');

// ── Raw-column fallback: engine must still run without the tradeable sidecar ──
const rawData = parseCvolCsv(csv);
assert.strictEqual(attachTradeable(rawData, null), false, 'attachTradeable reports failure without a sidecar');
const rawComp = computeComposites(rawData);
assert.strictEqual(rawComp.edge.tradeable, false, 'edge model flags the raw-column fallback');
assert.strictEqual(rawComp.decay, null, 'holding-cost model is withheld without tradeable returns');
assert.ok(rawComp.edge.current && EDGE_STATES[rawComp.edge.current.state], 'edge model still classifies on the raw column');

// ── Parser: weekend rows (Sunday-evening Globex snapshots) are not trading days ──
rawData.forEach((row) => {
    const dow = new Date(row.date + 'T00:00:00Z').getUTCDay();
    assert.ok(dow >= 1 && dow <= 5, `weekend row leaked through the parser: ${row.date}`);
});
assert.strictEqual(parseCvolCsv('Timestamp,a,b,c,d,e,f,g,h\n06-11-2026,1,1,1,1,1,1,1,3\n08-11-2026,1,1,1,1,1,1,1,3\n09-11-2026,1,1,1,1,1,1,1,3').length, 2, 'Sunday row is dropped');

// ── Tradeable sidecar ──
const data = parseCvolCsv(csv);
const tradeable = parseTradeableCsv(fs.readFileSync('docs/data/cvol/ng_tradeable.csv', 'utf8'));
assert.strictEqual(attachTradeable(data, tradeable), true, 'tradeable sidecar attaches');
data.forEach((row) => assert.ok(row.tpx > 0 && row.fmpx > 0, `tradeable levels present on ${row.date}`));
// Roll contamination: the raw column must show far better long-run returns than the tradeable index.
const rawTotal = data.at(-1).underlying / data[0].underlying - 1;
const tradeTotal = data.at(-1).tpx / data[0].tpx - 1;
assert.ok(tradeTotal < rawTotal - 0.5, `tradeable index (${tradeTotal.toFixed(2)}) must sit far below the roll-inflated raw column (${rawTotal.toFixed(2)})`);
// Roll-free front month: no single-day move anywhere near the +34% roll print of 2025-10-20.
const rollIdx = data.findIndex((row) => row.date === '2025-10-20');
assert.ok(rollIdx > 0, 'known roll day present');
assert.ok(data[rollIdx].underlying / data[rollIdx - 1].underlying - 1 > 0.25, 'raw column shows the roll jump');
// (the true front-month move that day was +12.9% per NG=F; the raw column printed +34%)
assert.ok(Math.abs(data[rollIdx].fmpx / data[rollIdx - 1].fmpx - 1) < 0.15, 'roll-free series removes the roll jump');
assert.ok(Math.abs(data[rollIdx].tpx / data[rollIdx - 1].tpx - 1) < 0.12, 'tradeable index removes the roll jump');
// Stale sidecar: rows it does not cover are chained on with the raw daily change.
const stale = parseCvolCsv(csv);
const staleMap = Object.assign({}, tradeable);
delete staleMap[stale.at(-1).date];
assert.strictEqual(attachTradeable(stale, staleMap), true, 'stale sidecar still attaches');
assertNear(stale.at(-1).tpx / stale.at(-2).tpx, stale.at(-1).underlying / stale.at(-2).underlying, 1e-9, 'uncovered newest row is chained with the raw daily change');

const comp = computeComposites(data);

// ── Directional edge model ──
const edge = comp.edge;
assert.strictEqual(edge.tradeable, true, 'edge model runs on the tradeable basis');
assert.strictEqual(edge.daily.length, data.length, 'edge state covers every row');
assert.ok(edge.current && EDGE_STATES[edge.current.state], 'current edge state is valid');
assert.ok(edge.thresholds.skewStress < edge.thresholds.skewBlow, 'skew thresholds are ordered');
assertNear(expandingPercentile([1, 2, 3, 2, 5, 0], 2)[3], 75, 1e-9, 'expanding percentile ranks against history up to today only');
edge.daily.forEach((state, i) => {
    if (i < EDGE_CFG.minHistory) { assert.strictEqual(state, 'NEUTRAL', 'no classification before a year of history'); return; }
    if (state === 'BLOWOFF') assert.ok(edge.skewPe[i] >= EDGE_CFG.skewBlow && edge.ngvlPe[i] >= EDGE_CFG.volGate, `blow-off needs skew AND vol extreme (${data[i].date})`);
    if (state === 'UPSIDE_STRESS') assert.ok(edge.skewPe[i] >= EDGE_CFG.skewStress && edge.skewPe[i] < EDGE_CFG.skewBlow && edge.ngvlPe[i] >= EDGE_CFG.volGate, `upside stress band (${data[i].date})`);
    if (state === 'PANIC_FLUSH') assert.ok(edge.move5[i] <= EDGE_CFG.flushSigma && edge.volChg5[i] > EDGE_CFG.flushVolRise, `panic flush needs a drop with rising vol (${data[i].date})`);
    if (state !== 'NEUTRAL') assert.ok(edge.persist[i] >= 1 && edge.persist[i] <= EDGE_CFG.persistWindow, 'persistence count is bounded');
});
[5, 10, 21, 42].forEach((h) => {
    assert.ok(edge.base[h].n > 2500, `${h}D base sample exists`);
    assert.ok(edge.base[h].upRate < 50, `${h}D tradeable base up-rate reflects contango bleed`);
});
const blow = edge.states.BLOWOFF;
assert.strictEqual(blow.days, blow.confirmed.days + blow.fresh.days, 'confirmed and fresh partition the state');
assert.ok(blow.episodeCount >= 8 && blow.episodes.every((e) => e.adverse21 >= 0), 'blow-off episodes carry a non-negative adverse excursion');
// ── Trades: non-overlapping, entered only on actionable days, scored against the any-day benchmark ──
['BLOWOFF', 'UPSIDE_STRESS', 'PANIC_FLUSH'].forEach((key) => {
    const s = edge.states[key];
    assert.strictEqual(s.days, s.confirmed.days + s.fresh.days, `${key}: actionable and first-day sets partition the state`);
    assert.ok(s.trades.length >= 8, `${key}: enough trades to list`);
    s.trades.forEach((tr, k) => {
        assert.strictEqual(edge.daily[tr.entryIdx], key, `${key}: trade enters on a day in the state`);
        assert.ok(edge.persist[tr.entryIdx] >= s.confirm, `${key}: trade enters only once the state is actionable`);
        assert.ok(tr.sessions <= s.hold && tr.heat <= 0, `${key}: hold and heat are bounded`);
        if (k > 0) assert.ok(tr.entryIdx > s.trades[k - 1].exitIdx, `${key}: trades do not overlap`);
        if (!tr.open) assertNear(tr.pnl, (s.bias === 'DOWNSIDE' ? -1 : 1) * (data[tr.exitIdx].tpx / data[tr.entryIdx].tpx - 1) * 100, 1e-9, `${key}: trade result uses the tradeable index`);
    });
    const ts = s.tradeStats;
    assert.strictEqual(ts.n, s.trades.filter((tr) => !tr.open).length, `${key}: open trades are not scored`);
    assert.ok(ts.benchWinRate > 0 && ts.benchWinRate < 100 && ts.p >= 0 && ts.p <= 1, `${key}: benchmark and p-value are sane`);
});
assert.ok(edge.states.BLOWOFF.tradeStats.benchWinRate > 50, 'being short NG on any day wins more than half the time on a tradeable basis');
assert.strictEqual(edge.states.NEUTRAL.trades, undefined, 'no trades are defined for the no-edge state');
assert.ok(blow.horizons[21].p != null && blow.horizons[21].p >= 0 && blow.horizons[21].p <= 1, 'permutation p-value is a probability');
// The reported forward return must be the tradeable one, not the raw column.
const ep0 = blow.episodes[0];
assertNear(ep0.fwd21, (data[ep0.startIdx + 21].tpx / data[ep0.startIdx].tpx - 1) * 100, 1e-9, 'episode forward return uses the tradeable index');
assertNear(cvolForwardReturn(data, 300, 21), (data[321].tpx / data[300].tpx - 1) * 100, 1e-9, 'forward returns use the tradeable index');
assert.ok(comp.decay && comp.decay.n >= 20 && comp.decay.koldMedian < comp.decay.boilMedian && comp.decay.boilMedian < 0, 'KOLD drag exceeds BOIL drag and both are costs');

assert.ok(data.length > 3000, 'parser loads full CVOL history');
const latestCsv = csv.trim().split(/\r?\n/).at(-1).split(',');
const latest = data.at(-1);
const [dDay, dMonth, dYear] = latestCsv[0].split('-');
const formattedCsvDate = `${dYear}-${dMonth}-${dDay}`;
assert.strictEqual(latest.date, formattedCsvDate, 'latest row date matches CSV expectation');
assertNear(latest.ngvl, Number(latestCsv[1]), 1e-9, 'latest NGVL matches CSV');
['dnVar', 'upVar', 'skew', 'skewRatio', 'atm', 'convexity', 'underlying'].forEach((field) => {
    assert.ok(Number.isFinite(latest[field]), `${field} parses as finite number`);
});

assert.strictEqual(comp.surfaceDaily.length, data.length, 'surfaceDaily covers every row');
assert.ok(comp.surfaceEvents.length > 20, 'surfaceEvents emits meaningful transition history');
assert.ok(comp.currentSurfaceRead && SURFACE_STATES[comp.currentSurfaceRead.state], 'current read has valid surface state');

const featureIdx = data.findIndex((row, idx) => idx > 252 && row.upVar != null && row.dnVar != null && comp.varianceRatio[idx] != null);
assert.ok(featureIdx > 252, 'feature test row exists');
assertNear(comp.varianceSpread[featureIdx], data[featureIdx].upVar - data[featureIdx].dnVar, 1e-9, 'variance spread is upVar minus dnVar');
assertNear(comp.varianceRatio[featureIdx], data[featureIdx].upVar / data[featureIdx].dnVar, 1e-9, 'variance ratio is upVar over dnVar');
assert.ok(comp.realVol[featureIdx] == null || comp.realVol[featureIdx] >= 0, 'realized vol is non-negative when available');
assert.ok(comp.vrp[featureIdx] == null || Number.isFinite(comp.vrp[featureIdx]), 'VRP is finite when available');

const fixture = Array.from({ length: 253 }, (_, idx) => ({
    date: `2025-01-${String((idx % 28) + 1).padStart(2, '0')}`,
    ngvl: 50,
    atm: 45,
    upVar: 50,
    dnVar: 50,
    skewRatio: 1,
    convexity: 1,
    underlying: 3,
}));
let synthetic = syntheticComp({ upVarZ21: 1.3, dnVarZ21: 1.2, convPct63: 95, convZ21: 1.4 });
assert.strictEqual(classifySurfaceDay(fixture, synthetic.comp, synthetic.extra, 252).state, 'TWO_SIDED_STRESS', 'synthetic two-sided stress classifies correctly');
synthetic = syntheticComp({ ngvlPct252: 12, atmPct252: 18, convPct63: 45 });
assert.strictEqual(classifySurfaceDay(fixture, synthetic.comp, synthetic.extra, 252).state, 'CALM_COMPRESSION', 'synthetic calm compression classifies correctly');
synthetic = syntheticComp({});
assert.strictEqual(classifySurfaceDay(fixture, synthetic.comp, synthetic.extra, 252).state, 'NO_EDGE', 'synthetic neutral surface classifies as NO_EDGE');

[5, 10, 21].forEach((horizon) => {
    assert.ok(comp.surfaceAnalogs.base[horizon].count > 1000, `${horizon}D base-rate sample exists`);
});
Object.values(comp.surfaceAnalogs.states).forEach((state) => {
    Object.values(state.horizons).forEach((row) => {
        if (!row.directionalEdge) return;
        assert.ok(row.n >= 30, `${state.state} directional edge requires sufficient sample`);
        assert.ok(row.dirHitRate >= 52, `${state.state} directional edge beats absolute floor`);
        assert.ok(row.dirHitRate >= row.baseDirRate + 3, `${state.state} directional edge beats base rate`);
    });
});

const cvolSource = fs.readFileSync('docs/js/cvol.js', 'utf8') + fs.readFileSync('docs/js/cvol-ui.js', 'utf8') + fs.readFileSync('docs/js/cvol-render.js', 'utf8');
assert.ok(!cvolSource.includes('trough_' + 'peak_data.json'), 'CVOL no longer fetches legacy turn-window JSON');
assert.ok(!(('turningPoint' + 'Replay') in comp), 'CVOL composites do not expose legacy replay fields');

CvolState.data = data;
CvolState.composites = comp;
CvolState.activeSeries = ['ngvl', 'underlying'];
CvolState.markerMode = 'surface';
context.__ui.renderBanner(data, comp);
context.__ui.renderConvictionBanner(data, comp);
context.__ui.renderEdgePanel(data, comp);
context.__ui.renderKpiCards(data, comp);
context.__ui.renderRegimePanel(data, comp);
context.__ui.renderSurfaceAnalogPanel(comp);
context.__ui.renderTimeline(comp, 'all');
context.__ui.renderMainChart();
assert.ok(context.elements['cvol-kpi-grid'].innerHTML.length > 100, 'KPI cards render');
assert.ok(context.elements['cvol-edge-panel'].innerHTML.includes('EVIDENCE BY STATE') && context.elements['cvol-edge-panel'].innerHTML.includes('TRADE LEDGER'), 'directional edge panel renders');
assertNear(context.__cvol.edgeBinomTail(17, 20, 0.56), 0.0063, 2e-4, 'binomial tail matches a known value');
context.__ui.renderEdgePanel(rawData, rawComp);
assert.ok(context.elements['cvol-edge-basis'].textContent.includes('ROLL-CONTAMINATED'), 'raw-column fallback is labelled');
assert.ok(context.elements['regime-dashboard-grid'].innerHTML.length > 100, 'options market read renders');
assert.ok(context.elements['surface-analog-panel'].innerHTML.length > 100, 'surface analog panel renders');
assert.ok(context.elements['cvol-event-body'].innerHTML.length > 100, 'event timeline renders');

console.log('CVOL tests passed');
