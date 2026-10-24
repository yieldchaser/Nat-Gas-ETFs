import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('================================================================');
console.log('Starting Rigorous NG=F Physical Context & ETF Cards Test Suite');
console.log('================================================================');

let passedTests = 0;
let totalTests = 0;

function ok(cond, msg) {
    totalTests++;
    assert.ok(cond, msg);
    passedTests++;
}

function eq(actual, expected, msg) {
    totalTests++;
    assert.strictEqual(actual, expected, msg);
    passedTests++;
}

// 1. Build VM environment
const configSrc = fs.readFileSync('docs/js/config.js', 'utf8');
const metricsSrc = fs.readFileSync('docs/js/metrics.js', 'utf8');
const chartsSrc = fs.readFileSync('docs/js/charts.js', 'utf8');
const cardsSrc = fs.readFileSync('docs/js/cards.js', 'utf8');
const signalsSrc = fs.readFileSync('docs/js/signals.js', 'utf8');
const dashboardData = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8'));

class FakeElement {
    constructor(id = '', tag = 'div') {
        this.id = id;
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.innerHTML = '';
        this.classList = new Set();
        this.attributes = {};
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
}

const fakeElements = new Map();
const fakeDocument = {
    getElementById(id) {
        if (!fakeElements.has(id)) {
            fakeElements.set(id, new FakeElement(id));
        }
        return fakeElements.get(id);
    },
    createElement(tag) {
        return new FakeElement('', tag);
    },
    querySelectorAll() { return []; }
};

const sandbox = {
    console,
    Math,
    Date,
    RegExp,
    Object,
    Array,
    String,
    Number,
    document: fakeDocument,
    window: {
        App: { data: dashboardData }
    }
};

vm.createContext(sandbox);
vm.runInContext(configSrc, sandbox);
vm.runInContext(metricsSrc, sandbox);
vm.runInContext(chartsSrc, sandbox);
vm.runInContext(cardsSrc, sandbox);
vm.runInContext(signalsSrc, sandbox);

const CONFIG = vm.runInContext('CONFIG', sandbox);
const Metrics = vm.runInContext('Metrics', sandbox);
const Cards = vm.runInContext('Cards', sandbox);
const Signals = vm.runInContext('Signals', sandbox);

console.log('\n--- 1. NG=F STRIP: NEUTRAL CASE (CURRENT REAL DATA) ---');
{
    const neutralContext = {
        price: 3.047,
        seasonal_zscore: -0.27,
        percentile_2yr: 36.5,
        tier: 'seasonal_mid',
        gate_short: false,
        gate_long: false,
        history_days: 504,
        seasonal_note: 'vs 237 fall-month obs (gMean=$3.30, std_log=0.290)',
        ng_hv_21d: 54.2,
        ng_hv_pct: 38.7,
        regime: 'normal',
        season: 'fall',
        month: 10
    };

    Signals.renderNgPriceBar(neutralContext);
    const barHtml = fakeDocument.getElementById('ng-price-bar').innerHTML;

    // Check GATES: NEUTRAL
    ok(barHtml.includes('GATES: NEUTRAL'), 'Contains "GATES: NEUTRAL"');
    ok(barHtml.includes('class="ng-gate ng-gate-neutral"'), 'Has class "ng-gate ng-gate-neutral"');

    // Check Seasonal Phase Badge
    ok(barHtml.includes('FALL (Injection Phase)'), 'Renders seasonal phase: FALL (Injection Phase)');
    ok(barHtml.includes('class="ng-season-phase"'), 'Has class "ng-season-phase"');

    // Check Regime Badge
    ok(barHtml.includes('ng-regime-normal'), 'Renders normal regime badge class');
    ok(barHtml.includes('>NORMAL</span>'), 'Renders regime label NORMAL');
    ok(!barHtml.includes('🚨'), 'Zero 🚨 emojis in regime badge');
    ok(!barHtml.includes('⚠'), 'Zero ⚠ emojis in regime badge');

    // Verified NO occurrences of old tags
    ok(!barHtml.includes('LONG ✗'), 'No "LONG ✗" in DOM');
    ok(!barHtml.includes('SHORT ✗'), 'No "SHORT ✗" in DOM');
    ok(!barHtml.includes('line-through'), 'No inline "line-through" in DOM');

    // Rich Tooltips verification
    ok(barHtml.includes('data-tooltip="NYMEX Henry Hub Natural Gas Front-Month Prompt Futures'), 'Rich tooltip on NG=F ticker');
    ok(barHtml.includes('data-tooltip="Current NYMEX prompt month settlement price."'), 'Rich tooltip on price');
    ok(barHtml.includes('Seasonal Z-Score vs 10-year same-month historical norm'), 'Rich tooltip on z-score track');
    ok(barHtml.includes('Macro Gate: NEUTRAL (-1.5σ < z < +1.5σ)'), 'Rich tooltip on neutral macro gate');
    ok(barHtml.includes('Physical Gas Volatility Regime (NORMAL / ELEVATED STRESS / ULTRA-VOLATILE)'), 'Rich tooltip on regime badge');

    console.log('Passed Neutral Case checks!');
}

console.log('\n--- 2. NG=F STRIP: OVERSOLD CASE (z = -1.8σ) ---');
{
    const oversoldContext = {
        price: 2.150,
        seasonal_zscore: -1.82,
        percentile_2yr: 8.5,
        tier: 'seasonal_low',
        gate_short: false,
        gate_long: true,
        history_days: 504,
        seasonal_note: 'vs 237 fall-month obs (gMean=$3.30, std_log=0.290)',
        ng_hv_21d: 58.0,
        ng_hv_pct: 45.0,
        regime: 'normal',
        season: 'fall',
        month: 10
    };

    Signals.renderNgPriceBar(oversoldContext);
    const barHtml = fakeDocument.getElementById('ng-price-bar').innerHTML;

    ok(barHtml.includes('LONG GATE: ACTIVE ✓'), 'Displays "LONG GATE: ACTIVE ✓"');
    ok(barHtml.includes('class="ng-gate ng-gate-active-long"'), 'Has class "ng-gate ng-gate-active-long"');
    ok(barHtml.includes('SHORT: INACTIVE'), 'Displays "SHORT: INACTIVE"');
    ok(barHtml.includes('class="ng-gate ng-gate-inactive"'), 'Has class "ng-gate ng-gate-inactive"');
    ok(barHtml.includes('Macro Gate: ACTIVE LONG (z <= -1.5σ)'), 'Active long tooltip');
    ok(barHtml.includes('Macro Gate: Short gate INACTIVE'), 'Inactive short tooltip');
    ok(!barHtml.includes('LONG ✗'), 'No LONG ✗');
    ok(!barHtml.includes('SHORT ✗'), 'No SHORT ✗');

    console.log('Passed Oversold Case checks!');
}

console.log('\n--- 3. NG=F STRIP: OVERBOUGHT CASE (z = +2.0σ) ---');
{
    const overboughtContext = {
        price: 4.850,
        seasonal_zscore: 2.05,
        percentile_2yr: 94.2,
        tier: 'seasonal_high',
        gate_short: true,
        gate_long: false,
        history_days: 504,
        seasonal_note: 'vs 237 fall-month obs (gMean=$3.30, std_log=0.290)',
        ng_hv_21d: 62.0,
        ng_hv_pct: 55.0,
        regime: 'elevated',
        season: 'fall',
        month: 10
    };

    Signals.renderNgPriceBar(overboughtContext);
    const barHtml = fakeDocument.getElementById('ng-price-bar').innerHTML;

    ok(barHtml.includes('SHORT GATE: ACTIVE ✓'), 'Displays "SHORT GATE: ACTIVE ✓"');
    ok(barHtml.includes('class="ng-gate ng-gate-active-short"'), 'Has class "ng-gate ng-gate-active-short"');
    ok(barHtml.includes('LONG: INACTIVE'), 'Displays "LONG: INACTIVE"');
    ok(barHtml.includes('class="ng-gate ng-gate-inactive"'), 'Has class "ng-gate ng-gate-inactive"');
    ok(barHtml.includes('Macro Gate: ACTIVE SHORT (z >= +1.5σ)'), 'Active short tooltip');
    ok(barHtml.includes('Macro Gate: Long gate INACTIVE'), 'Inactive long tooltip');
    ok(!barHtml.includes('LONG ✗'), 'No LONG ✗');
    ok(!barHtml.includes('SHORT ✗'), 'No SHORT ✗');

    console.log('Passed Overbought Case checks!');
}

console.log('\n--- 4. NG=F STRIP: EXTREME PRICE & VOLATILITY CASE ($8.50) ---');
{
    const extremeContext = {
        price: 8.50,
        seasonal_zscore: 3.10,
        percentile_2yr: 99.8,
        tier: 'extreme_high',
        gate_short: true,
        gate_long: false,
        history_days: 504,
        seasonal_note: 'vs 237 fall-month obs (gMean=$3.30, std_log=0.290)',
        ng_hv_21d: 110.5,
        ng_hv_pct: 96.0,
        regime: 'extreme',
        season: 'winter',
        month: 1
    };

    Signals.renderNgPriceBar(extremeContext);
    const barHtml = fakeDocument.getElementById('ng-price-bar').innerHTML;

    ok(barHtml.includes('ng-regime-extreme'), 'Has class "ng-regime-extreme"');
    ok(barHtml.includes('EXTREME REGIME'), 'Renders label "EXTREME REGIME"');
    ok(barHtml.includes('WINTER (Withdrawal Phase)'), 'Renders Winter seasonal phase');
    ok(barHtml.includes('class="ng-regime-warning"'), 'Renders extreme regime warning banner');
    ok(!barHtml.includes('🚨'), 'Zero emojis in extreme regime');
    ok(!barHtml.includes('⚠'), 'Zero emojis in extreme regime warning');
    ok(barHtml.includes('ULTRA-VOLATILE'), 'Regime tooltip references ULTRA-VOLATILE classification');

    console.log('Passed Extreme Case checks!');
}

console.log('\n--- 5. SEASONAL PHASES VARIATION TESTS ---');
{
    const seasons = [
        { key: 'winter', label: 'WINTER (Withdrawal Phase)', color: '#60a8f8' },
        { key: 'spring', label: 'SPRING (Shoulder Phase)', color: '#6ddc8b' },
        { key: 'summer', label: 'SUMMER (Injection Phase)', color: '#f5c542' },
        { key: 'fall', label: 'FALL (Injection Phase)', color: '#f5a742' }
    ];

    for (const s of seasons) {
        Signals.renderNgPriceBar({
            price: 3.0, seasonal_zscore: 0.0, tier: 'seasonal_mid',
            gate_short: false, gate_long: false, seasonal_note: '',
            regime: 'normal', season: s.key
        });
        const barHtml = fakeDocument.getElementById('ng-price-bar').innerHTML;
        ok(barHtml.includes(s.label), `Correct label for ${s.key}: ${s.label}`);
        ok(barHtml.includes(s.color), `Correct color for ${s.key}: ${s.color}`);
    }
    console.log('Passed Seasonal Phase variations!');
}

function normalizeEtfData(etfData, ticker) {
    const rawCur = etfData.current || {};
    return {
        ticker: ticker,
        alertLevel: 'none',
        mwcaCount: 0,
        current: {
            price: rawCur.price ?? 10,
            changePct: rawCur.change_pct ?? rawCur.changePct ?? 0,
            volume: rawCur.volume ?? 1000,
            dollarVolume: rawCur.dollar_volume ?? rawCur.dollarVolume ?? 10000
        },
        rvol: etfData.rvol || {},
        zScore: etfData.z_score || etfData.zScore || {},
        vroc: etfData.vroc || {},
        volPercentile: etfData.vol_percentile || etfData.volPercentile || {},
        pricePercentile: etfData.price_percentile || etfData.pricePercentile || {},
        cvi:  etfData.cvi  || {},
        vcvi: etfData.vcvi || etfData.cvi || {},
        volatility: {
            volRegimePct: etfData.volatility?.vol_regime_pct ?? null,
            hvTermStructure: etfData.volatility?.hv_term_structure ?? null,
            atr14Pct: etfData.volatility?.atr14_pct ?? null,
            vov21: etfData.volatility?.vov21 ?? null,
            hv: etfData.volatility?.hv || {}
        },
        decay: etfData.decay || null,
        seasonality: etfData.seasonality || null,
        sharpSpike: etfData.sharp_spike || false,
        fastSignal: etfData.fast_signal || null,
        vps: etfData.vps || 0,
        mwca: etfData.mwca || false,
        mwcaCount: 0,
        dvRvol: etfData.dv_rvol || {},
        dvZScore: etfData.dv_zscore || {},
        dvPercentile: etfData.dv_percentile || {},
        dvVroc: etfData.dv_vroc || {},
        dvcvi: etfData.dvcvi || {},
        dvVps: etfData.dv_vps ?? null,
        vdds: etfData.vdds ?? null,
        alerts: etfData.alerts || []
    };
}

console.log('\n--- 6. ETF CARDS CLEANUP & DECAY TOOLTIPS ---');
{
    const etfExpectedDecay = {
        'BOIL':   '~35%/yr',
        'KOLD':   '~35%/yr',
        'HNU.TO': '~40%/yr',
        'HND.TO': '~40%/yr',
        '3NGL.L': '~55%/yr',
        '3NGS.L': '~55%/yr'
    };

    for (const [ticker, expectedDecay] of Object.entries(etfExpectedDecay)) {
        const rawEtf = dashboardData.etfs[ticker];
        ok(rawEtf != null, `Metrics found for ${ticker}`);
        const config = CONFIG.etfs[ticker];
        ok(config != null, `Config found for ${ticker}`);
        const metrics = normalizeEtfData(rawEtf, ticker);

        const cardHtml = Cards.renderCard(ticker, metrics, config);

        // Verify FALL ×1.00 is completely REMOVED
        ok(!cardHtml.includes('FALL ×'), `Card ${ticker} does NOT contain "FALL ×"`);
        ok(!cardHtml.includes('season-badge'), `Card ${ticker} does NOT contain "season-badge"`);
        ok(!cardHtml.includes('×1.00'), `Card ${ticker} does NOT contain "×1.00"`);
        ok(!cardHtml.includes('×1.50'), `Card ${ticker} does NOT contain seasonal multiplier`);

        // Verify no NaN or undefined bugs
        ok(!cardHtml.includes('NaN'), `Card ${ticker} has no NaN`);
        ok(!cardHtml.includes('undefined'), `Card ${ticker} has no undefined`);
        ok(!cardHtml.includes('null'), `Card ${ticker} has no null`);

        // Verify card-pill-meta and decay tooltip
        ok(cardHtml.includes('class="card-pill-meta"'), `Card ${ticker} contains .card-pill-meta`);
        ok(cardHtml.includes(`Annual rebalancing decay rate: ${expectedDecay}`), `Card ${ticker} has clean decay tooltip displaying ${expectedDecay}`);

        // Verify no empty spacing or phantom badge bugs in card-ticker-row
        const tickerRowMatch = cardHtml.match(/<div class="card-ticker-row">([\s\S]*?)<\/div>/);
        ok(tickerRowMatch != null, `Card ${ticker} has .card-ticker-row`);
        const rowContent = tickerRowMatch[1];
        ok(!rowContent.includes('<span></span>'), `Card ${ticker} .card-ticker-row has no empty spans`);
        ok(!rowContent.includes('class=""'), `Card ${ticker} .card-ticker-row has no empty classes`);
        ok(!rowContent.includes('season-badge'), `Card ${ticker} .card-ticker-row has no season badge`);
        ok(rowContent.includes(`class="card-ticker">${ticker}</span>`), `Card ${ticker} .card-ticker-row contains card-ticker`);
    }

    console.log('Passed ETF Cards Cleanup & Tooltips checks!');
}

console.log('\n--- 7. CSS CONSTRAINTS & ZERO EMOJI CHECKS ---');
{
    const signalsCss = fs.readFileSync('docs/css/signals.css', 'utf8');
    const cardsCss = fs.readFileSync('docs/css/cards.css', 'utf8');

    // Ensure .ng-gate CSS classes exist
    ok(signalsCss.includes('.ng-gate.ng-gate-neutral'), 'signals.css contains .ng-gate.ng-gate-neutral');
    ok(signalsCss.includes('.ng-gate.ng-gate-active-long'), 'signals.css contains .ng-gate.ng-gate-active-long');
    ok(signalsCss.includes('.ng-gate.ng-gate-active-short'), 'signals.css contains .ng-gate.ng-gate-active-short');
    ok(signalsCss.includes('.ng-gate.ng-gate-inactive'), 'signals.css contains .ng-gate.ng-gate-inactive');
    ok(signalsCss.includes('.ng-season-phase'), 'signals.css contains .ng-season-phase');

    // Verify NO line-through in ng-gate
    const ngGateCssBlocks = signalsCss.match(/\.ng-gate[\s\S]*?\}/g) || [];
    for (const block of ngGateCssBlocks) {
        ok(!block.includes('line-through'), `No line-through in ng-gate CSS: ${block}`);
    }

    // Verify cards.css .card-pill-meta has cursor: help
    ok(cardsCss.includes('.card-pill-meta') && cardsCss.includes('cursor: help;'), 'cards.css .card-pill-meta has cursor: help');

    console.log('Passed CSS Constraints & Styling checks!');
}

console.log('\n================================================================');
console.log(`ALL TESTS PASSED! Passed: ${passedTests} / ${totalTests} assertions.`);
console.log('================================================================');
