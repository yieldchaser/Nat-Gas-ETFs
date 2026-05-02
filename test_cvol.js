const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

function createMockElement(id) {
    return {
        id,
        innerHTML: '',
        style: {},
        textContent: '',
        disabled: false,
        className: '',
        dataset: {},
        addEventListener: function() {},
        appendChild: function() {},
        setAttribute: function() {},
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        getBoundingClientRect: function() { return { width: 900, height: 360, left: 0, right: 900, top: 0, bottom: 360 }; },
        getContext: function() {
            return {
                scale: function() {}, clearRect: function() {}, fillRect: function() {}, beginPath: function() {},
                moveTo: function() {}, lineTo: function() {}, stroke: function() {}, fill: function() {},
                arc: function() {}, save: function() {}, restore: function() {}, translate: function() {},
                rotate: function() {}, strokeRect: function() {}, fillText: function() {}, setLineDash: function() {},
                closePath: function() {}, measureText: function(text) { return { width: String(text).length * 6 }; },
            };
        },
    };
}

const elementCache = {};
const context = vm.createContext({
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    window: { devicePixelRatio: 1, addEventListener: function() {}, innerWidth: 1400 },
    document: {
        body: { appendChild: function() {} },
        getElementById: function(id) {
            if (!elementCache[id]) elementCache[id] = createMockElement(id);
            return elementCache[id];
        },
        querySelectorAll: function() { return []; },
        createElement: function(tag) { return createMockElement(tag); },
    },
});

const cvolJs = fs.readFileSync('docs/js/cvol.js', 'utf8');
const cvolUiJs = fs.readFileSync('docs/js/cvol-ui.js', 'utf8').split('(async function()')[0];
const cvolRenderJs = fs.readFileSync('docs/js/cvol-render.js', 'utf8');

vm.runInContext(`${cvolJs}
globalThis.__cvol = {
  CvolState,
  parseCvolCsv,
  computeComposites,
  applyT2pDecisionLayer,
  cvolFindNearestIndex,
  decisionColor
};`, context);

vm.runInContext(`${cvolUiJs}
globalThis.__ui = {
  renderKpiCards,
  renderDataHealth,
  renderDecisionCommand,
  renderTurningPointReplay,
  renderSignalQualityAudit,
  renderKnownWindowAudit
};`, context);

vm.runInContext(`${cvolRenderJs}
globalThis.__render = { renderMainChart };`, context);

const { CvolState, parseCvolCsv, computeComposites, applyT2pDecisionLayer, cvolFindNearestIndex } = context.__cvol;
const ui = context.__ui;
const render = context.__render;

const csv = fs.readFileSync('docs/data/cvol/ngvl_cvol_history.csv', 'utf8');
const t2p = JSON.parse(fs.readFileSync('docs/data/trough_peak_data.json', 'utf8'));
const data = parseCvolCsv(csv);
const comp = computeComposites(data);
applyT2pDecisionLayer(data, comp, t2p);
CvolState.data = data;
CvolState.composites = comp;

function decisionOn(date) {
    const idx = cvolFindNearestIndex(data, date);
    return comp.decisionDaily[idx];
}

function windowHas(start, end, klass, minConviction) {
    const rank = { LOW: 1, MODERATE: 2, HIGH: 3 };
    return comp.decisionDaily.some((d) => d.date >= start && d.date <= end && d.classification === klass && rank[d.conviction] >= rank[minConviction]);
}

assert(data.length > 3000, 'CVOL parser should load full history');
assert(comp.rawFires.length > 100, 'raw CVOL fires should be preserved');
assert(comp.decisionEvents.length > 50, 'decision events should be generated');
assert(CvolState.t2pContext.clusters.length > 100, 'T2P cycle map should contain clusters');
assert(CvolState.t2pContext.dataHealth.coverage.available === 6, 'T2P should include all six ETF anchors');

assert.notStrictEqual(decisionOn('2025-01-16').classification, 'BOTTOM', 'Jan 16-17 2025 must not classify as bottom');
assert(['NO_EDGE', 'TOP', 'EXHAUSTION', 'CONFLICT'].includes(decisionOn('2025-03-10').classification), 'Mar 10 2025 should not become a bottom');
assert(windowHas('2025-10-15', '2025-10-17', 'BOTTOM', 'MODERATE'), 'Oct 15-17 2025 should classify as a quality bottom window');

const dec2024 = comp.knownWindowAudit.find((w) => w.label.indexOf('Dec 2024') >= 0);
assert(dec2024 && dec2024.verdict === 'REFERENCE_MISMATCH', 'Dec 5-10 2024 should report reference/data mismatch');

ui.renderKpiCards(data, comp);
ui.renderDataHealth(data, comp);
ui.renderDecisionCommand(data, comp);
ui.renderTurningPointReplay(comp);
ui.renderSignalQualityAudit(comp);
ui.renderKnownWindowAudit(comp);
render.renderMainChart();

assert(elementCache['cvol-kpi-grid'].innerHTML.length > 100, 'KPI cards should render');
assert(elementCache['regime-dashboard-grid'].innerHTML.includes('decision-command'), 'Decision command center should render');
assert(elementCache['cvol-turning-replay'].innerHTML.includes('table'), 'Turning point replay table should render');
assert(elementCache['cvol-quality-audit'].innerHTML.includes('Decision Layer'), 'Signal quality audit should render');
assert(elementCache['cvol-known-window-audit'].innerHTML.includes('REFERENCE_MISMATCH'), 'Known window audit should render mismatch');
assert(elementCache['cvol-canvas'].width > 0, 'Main chart canvas should render without throwing');

console.log('CVOL tests passed');
