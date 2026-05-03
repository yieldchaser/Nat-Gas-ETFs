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
    vm.runInContext(cvolJs + '\nthis.__cvol = { CvolState, parseCvolCsv, computeComposites, classifySurfaceDay, SURFACE_STATES, surfaceStateColor };', context, { filename: 'docs/js/cvol.js' });
    vm.runInContext(renderJs, context, { filename: 'docs/js/cvol-render.js' });
    vm.runInContext(uiJs + '\nthis.__ui = { renderBanner, renderConvictionBanner, renderKpiCards, renderRegimePanel, renderSurfaceAnalogPanel, renderTimeline, renderMainChart };', context, { filename: 'docs/js/cvol-ui.js' });
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
const { CvolState, parseCvolCsv, computeComposites, classifySurfaceDay, SURFACE_STATES } = context.__cvol;
const csv = fs.readFileSync('docs/data/cvol/ngvl_cvol_history.csv', 'utf8');
const data = parseCvolCsv(csv);
const comp = computeComposites(data);

assert.ok(data.length > 3000, 'parser loads full CVOL history');
const latestCsv = csv.trim().split(/\r?\n/).at(-1).split(',');
const latest = data.at(-1);
assert.strictEqual(latest.date, '2026-05-01', 'latest row date matches fixture expectation');
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
context.__ui.renderKpiCards(data, comp);
context.__ui.renderRegimePanel(data, comp);
context.__ui.renderSurfaceAnalogPanel(comp);
context.__ui.renderTimeline(comp, 'all');
context.__ui.renderMainChart();
assert.ok(context.elements['cvol-kpi-grid'].innerHTML.length > 100, 'KPI cards render');
assert.ok(context.elements['regime-dashboard-grid'].innerHTML.length > 100, 'options market read renders');
assert.ok(context.elements['surface-analog-panel'].innerHTML.length > 100, 'surface analog panel renders');
assert.ok(context.elements['cvol-event-body'].innerHTML.length > 100, 'event timeline renders');

console.log('CVOL tests passed');
