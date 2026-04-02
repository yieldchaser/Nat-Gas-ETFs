const fs = require('fs');

// Mock DOM
global.document = {
    getElementById: function(id) {
        return {
            id: id,
            innerHTML: '',
            style: {},
            textContent: '',
            addEventListener: function() {},
            appendChild: function() {},
            setAttribute: function() {},
        };
    },
    querySelectorAll: function() { return []; },
    createElement: function() { return { style: {}, setAttribute: function() {}, className: '', textContent: '' }; }
};
global.window = { devicePixelRatio: 1, addEventListener: function() {} };
global.toRgba = function() { return ''; };
global.ngvlRegime = function(pct) {
    if (pct == null) return { label: '--', cls: 'cvol-reg-unknown', color: '#666' };
    if (pct >= 90) return { label: 'EXTREME', cls: 'cvol-reg-extreme', color: '#c04040' };
    if (pct >= 75) return { label: 'ELEVATED', cls: 'cvol-reg-elevated', color: '#c07828' };
    if (pct >= 25) return { label: 'NORMAL', cls: 'cvol-reg-normal', color: '#3db87a' };
    return { label: 'LOW', cls: 'cvol-reg-low', color: '#4a80b8' };
};

// Load scripts (simulate <script> tags)
const cvolJs = fs.readFileSync('docs/js/cvol.js', 'utf8');
const cvolUiJs = fs.readFileSync('docs/js/cvol-ui.js', 'utf8');

eval(cvolJs);

// Mock CvolState
global.CvolState = { activeSeries: [] };

eval(cvolUiJs);

const csv = fs.readFileSync('docs/data/cvol/ngvl_cvol_history.csv', 'utf8');
const data = parseCvolCsv(csv);
const comp = computeComposites(data);

try {
    renderKpiCards(data, comp);
    console.log("renderKpiCards SUCCEEDED");
} catch (e) {
    console.error("renderKpiCards FAILED:");
    console.error(e);
}
