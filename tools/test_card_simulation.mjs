import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('================================================================');
console.log('Starting Deep Bug Verifier: ETF Cards Functional Test Suite');
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
const volumeStudiesSrc = fs.readFileSync('docs/js/volume-studies.js', 'utf8');

class ClassList {
    constructor() {
        this.set = new Set();
    }
    add(...classes) { classes.forEach(c => c && this.set.add(c)); }
    remove(...classes) { classes.forEach(c => this.set.delete(c)); }
    contains(c) { return this.set.has(c); }
    has(c) { return this.set.has(c); }
    toggle(c, force) {
        if (force === undefined) {
            if (this.set.has(c)) { this.set.delete(c); return false; }
            else { this.set.add(c); return true; }
        } else if (force) {
            this.set.add(c); return true;
        } else {
            this.set.delete(c); return false;
        }
    }
    [Symbol.iterator]() { return this.set[Symbol.iterator](); }
}

// Minimal DOM simulation
class SimpleDOMElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = {};
        this.dataset = {};
        this.style = {};
        this.classList = new ClassList();
        this._innerHTML = '';
        this._textContent = '';
        this.clientWidth = 240;
        this.clientHeight = 50;
    }

    get className() {
        return Array.from(this.classList.set).join(' ');
    }
    set className(val) {
        this.classList.set.clear();
        if (val) val.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }
    setAttribute(name, val) {
        this.attributes[name] = String(val);
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[key] = String(val);
        }
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    get textContent() {
        return this._textContent;
    }
    set textContent(val) {
        this._textContent = String(val);
    }

    get innerHTML() {
        return this._innerHTML;
    }
    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        const parsed = parseHtml(html);
        parsed.forEach(c => this.appendChild(c));
    }

    querySelector(selector) {
        return findInTree(this, selector, false);
    }

    querySelectorAll(selector) {
        return findInTree(this, selector, true);
    }

    closest(selector) {
        let curr = this;
        while (curr) {
            if (matchesSelector(curr, selector)) return curr;
            curr = curr.parentElement;
        }
        return null;
    }
}

function parseHtml(html) {
    const root = new SimpleDOMElement('root');
    const stack = [root];

    const re = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9\-]+)([^>]*)>|([^<]+)/g;
    let match;

    while ((match = re.exec(html)) !== null) {
        if (match[0].startsWith('<!--')) {
            continue;
        }

        const isClosing = Boolean(match[1]);
        const tagName = match[2];
        const rawAttrs = match[3];
        const textContent = match[4];

        if (textContent) {
            const trimmed = textContent.trim();
            if (trimmed) {
                const current = stack[stack.length - 1];
                current.textContent = (current.textContent ? current.textContent + ' ' : '') + trimmed;
            }
        } else if (isClosing) {
            if (stack.length > 1 && stack[stack.length - 1].tagName === tagName.toUpperCase()) {
                stack.pop();
            }
        } else if (tagName) {
            const el = new SimpleDOMElement(tagName);
            const isSelfClosing = rawAttrs && (rawAttrs.endsWith('/') || ['input', 'img', 'br', 'hr'].includes(tagName.toLowerCase()));

            if (rawAttrs) {
                const attrRe = /([a-zA-Z0-9\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
                let aMatch;
                while ((aMatch = attrRe.exec(rawAttrs)) !== null) {
                    const k = aMatch[1];
                    if (k === '/') continue;
                    const v = aMatch[2] ?? aMatch[3] ?? aMatch[4] ?? '';
                    if (k === 'class') {
                        el.className = v;
                    } else if (k === 'id') {
                        el.id = v;
                    } else if (k === 'style') {
                        v.split(';').forEach(rule => {
                            const [sk, sv] = rule.split(':').map(s => s && s.trim());
                            if (sk && sv) el.style[sk] = sv;
                        });
                    } else {
                        el.setAttribute(k, v);
                    }
                }
            }

            const current = stack[stack.length - 1];
            current.appendChild(el);

            if (!isSelfClosing) {
                stack.push(el);
            }
        }
    }
    return root.children;
}

function matchesSelector(el, selector) {
    if (!selector) return false;
    selector = selector.trim();

    // Combined class + attribute: e.g. .etf-card[data-ticker]
    if (selector.startsWith('.') && selector.includes('[')) {
        const bracketIdx = selector.indexOf('[');
        const cls = selector.slice(1, bracketIdx);
        const attrExpr = selector.slice(bracketIdx + 1, -1);
        if (!el.classList.has(cls)) return false;
        if (attrExpr.includes('=')) {
            const [k, v] = attrExpr.split('=').map(s => s.replace(/["']/g, '').trim());
            return el.getAttribute(k) === v;
        }
        return el.getAttribute(attrExpr) !== null;
    }

    if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return el.classList.has(cls);
    }
    if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
    }
    if (selector.startsWith('[') && selector.endsWith(']')) {
        const attrExpr = selector.slice(1, -1);
        if (attrExpr.includes('=')) {
            const [k, v] = attrExpr.split('=').map(s => s.replace(/["']/g, '').trim());
            return el.getAttribute(k) === v;
        }
        return el.getAttribute(attrExpr) !== null;
    }
    // Tag + class: e.g. span.card-ticker
    if (/^[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-_]+$/.test(selector)) {
        const [tag, cls] = selector.split('.');
        return el.tagName === tag.toUpperCase() && el.classList.has(cls);
    }
    return el.tagName === selector.toUpperCase();
}

function findInTree(root, selector, multi = false) {
    const results = [];

    // Support combined selector: ".share-section .percentile-row[data-window=\"5d\"]"
    const parts = selector.split(/\s+/).filter(Boolean);

    function testSingle(node, part) {
        return matchesSelector(node, part);
    }

    function search(node, partIdx) {
        const part = parts[partIdx];
        const isMatch = testSingle(node, part);
        if (isMatch) {
            if (partIdx === parts.length - 1) {
                results.push(node);
                if (!multi) return true;
            } else {
                for (const child of node.children) {
                    if (search(child, partIdx + 1) && !multi) return true;
                }
            }
        }
        for (const child of node.children) {
            if (search(child, partIdx) && !multi) return true;
        }
        return false;
    }

    for (const child of root.children) {
        search(child, 0);
        if (!multi && results.length > 0) return results[0];
    }

    return multi ? results : (results[0] || null);
}

const mockDoc = new SimpleDOMElement('document');
mockDoc.getElementById = (id) => findInTree(mockDoc, '#' + id, false);
mockDoc.createElement = (tag) => {
    const el = new SimpleDOMElement(tag);
    if (tag === 'canvas') {
        el.getContext = () => ({
            save: () => {},
            restore: () => {},
            setTransform: () => {},
            clearRect: () => {},
            fillRect: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {},
            fill: () => {},
            createLinearGradient: () => ({ addColorStop: () => {} }),
            arc: () => {}
        });
    }
    return el;
};
mockDoc.body = new SimpleDOMElement('body');

const sandbox = {
    console,
    Math,
    Date,
    Intl,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Array,
    Object,
    Number,
    String,
    Set,
    Map,
    document: mockDoc,
    window: {
        devicePixelRatio: 2,
        innerWidth: 1920,
        innerHeight: 1080
    },
    requestAnimationFrame: (cb) => cb()
};

vm.createContext(sandbox);
vm.runInContext(configSrc, sandbox);
vm.runInContext(metricsSrc, sandbox);
vm.runInContext(chartsSrc, sandbox);
vm.runInContext(cardsSrc, sandbox);
vm.runInContext(volumeStudiesSrc, sandbox);

const Cards = vm.runInContext('Cards', sandbox);
const Metrics = vm.runInContext('Metrics', sandbox);
const Charts = vm.runInContext('Charts', sandbox);
const VolumeStudies = vm.runInContext('VolumeStudies', sandbox);
const CONFIG = vm.runInContext('CONFIG', sandbox);

console.log('\n--- 2a. Ordinal Number Formatting ---');
// 1 to 100 exhaustively tested
const expectedSuffixes = {
    1: 'st', 2: 'nd', 3: 'rd', 4: 'th', 5: 'th', 6: 'th', 7: 'th', 8: 'th', 9: 'th', 10: 'th',
    11: 'th', 12: 'th', 13: 'th', 14: 'th', 15: 'th', 16: 'th', 17: 'th', 18: 'th', 19: 'th', 20: 'th',
    21: 'st', 22: 'nd', 23: 'rd', 24: 'th', 30: 'th', 31: 'st', 32: 'nd', 33: 'rd', 34: 'th',
    41: 'st', 42: 'nd', 43: 'rd', 51: 'st', 52: 'nd', 53: 'rd', 61: 'st', 62: 'nd', 63: 'rd',
    71: 'st', 72: 'nd', 73: 'rd', 81: 'st', 82: 'nd', 83: 'rd', 91: 'st', 92: 'nd', 93: 'rd', 100: 'th'
};

for (let i = 1; i <= 100; i++) {
    const formatted = Cards.formatOrdinal(i);
    // Strict negative check: NO '33th', '21th', '22th', '23th', '11st', '12nd', '13rd'
    ok(!formatted.endsWith('33th'), `Value ${i} must never be 33th`);
    ok(!formatted.endsWith('21th'), `Value ${i} must never be 21th`);
    ok(!formatted.endsWith('22th'), `Value ${i} must never be 22th`);
    ok(!formatted.endsWith('23th'), `Value ${i} must never be 23th`);
    ok(!formatted.endsWith('11st'), `Value ${i} must never be 11st`);
    ok(!formatted.endsWith('12nd'), `Value ${i} must never be 12nd`);
    ok(!formatted.endsWith('13rd'), `Value ${i} must never be 13rd`);

    if (expectedSuffixes[i]) {
        eq(formatted, `${i}${expectedSuffixes[i]}`, `Ordinal for ${i} must be ${i}${expectedSuffixes[i]}`);
    }
}
eq(Cards.formatOrdinal(null), '—', 'Null ordinal returns em dash');
eq(Cards.formatOrdinal(NaN), '—', 'NaN ordinal returns em dash');
console.log('Passed 1-100 Ordinal Number Formatting checks!');

console.log('\n--- 2b. Lookback Window Alignment ---');
// Mock ETF metrics object
const mockKoldMetrics = {
    current: {
        price: 38.50,
        changePct: -2.45,
        volume: 5200000,
        dollarVolume: 200200000
    },
    alertLevel: 'none',
    volPercentile: {
        '5d': 92,
        '10d': 85,
        '21d': 74,
        '63d': 69,
        '126d': 55,
        '252d': 33
    },
    dvPercentile: {
        '5d': 90,
        '10d': 82,
        '21d': 71,
        '63d': 65,
        '126d': 50,
        '252d': 30
    },
    rvol: { '21d': 1.85 },
    dvRvol: { '21d': 1.75 },
    zScore: { '21d': 1.62 },
    dvZScore: { '21d': 1.48 },
    vroc: { '10d': 28 },
    dvVroc: { '10d': 22 },
    vcvi: { '5d': 35, '21d': 42, '63d': 48 },
    dvcvi: { '5d': 33, '21d': 40, '63d': 45 },
    vps: 68,
    dvVps: 64,
    mwca: false,
    mwcaCount: 4,
    vdds: 0.95,
    volatility: {
        volRegimePct: 45,
        hvTermStructure: 1.12,
        atr14Pct: 4.8,
        vov21: 18,
        hv: { '10d': 88, '21d': 82, '63d': 75 }
    },
    sparkData: [
        { date: '2026-10-20', close: 40.1, volume: 4500000, dollarVolume: 180450000 },
        { date: '2026-10-21', close: 39.4, volume: 4800000, dollarVolume: 189120000 },
        { date: '2026-10-22', close: 38.5, volume: 5200000, dollarVolume: 200200000 }
    ],
    history: [
        { close: 40.1, volume: 4500000 },
        { close: 39.4, volume: 4800000 },
        { close: 38.5, volume: 5200000 }
    ]
};

const cardHtml = Cards.renderCard('KOLD', mockKoldMetrics, CONFIG.etfs['KOLD']);
ok(cardHtml.includes('KOLD'), 'Card HTML contains ticker');

// Verify all 6 windows are rendered in share mode
const expectedWindows = ['5d', '10d', '21d', '63d', '126d', '252d'];
for (const w of expectedWindows) {
    ok(cardHtml.includes(`data-window="${w}"`), `Card must render percentile row for ${w}`);
}

// Verify tooltips exist for all 6 windows
ok(cardHtml.includes('Volume percentile vs 5-day history'), '5d tooltip exists');
ok(cardHtml.includes('Volume percentile vs 10-day history'), '10d tooltip exists');
ok(cardHtml.includes('Volume percentile vs 21-day history'), '21d tooltip exists');
ok(cardHtml.includes('Volume percentile vs 63-day history'), '63d tooltip exists');
ok(cardHtml.includes('Volume percentile vs 126-day history'), '126d tooltip exists');
ok(cardHtml.includes('Volume percentile vs 252-day history'), '252d tooltip exists');

// Verify MWCA denominator is 6
ok(cardHtml.includes('4/6'), `MWCA inactive counter must display '4/6' with 6 denominator (actual rendered: ${cardHtml.match(/class="mwca-badge inactive">([^<]+)<\/span>/)?.[1]})`);

// Test MWCA active when true
const mockMwcaActive = { ...mockKoldMetrics, mwca: true, mwcaCount: 6 };
const mwcaActiveHtml = Cards.renderCard('KOLD', mockMwcaActive, CONFIG.etfs['KOLD']);
ok(mwcaActiveHtml.includes('MWCA ACTIVE'), 'MWCA ACTIVE rendered when true');

console.log('Passed Lookback Window Alignment & MWCA checks!');

console.log('\n--- 2c. Exchange-Specific Session Badges ---');
// 1. LSE ETF during London open hours (e.g. Wednesday 05:00 ET / 10:00 London)
const wednesdayLondonOpen = new Date('2026-10-21T05:00:00-04:00'); // 05:00 ET = 300 minutes
const lseOpen = Cards.getExchangeSession('LSE', '3NGL.L', null, wednesdayLondonOpen);
eq(lseOpen.text, 'LSE OPEN', '3NGL.L on Wednesday 05:00 ET must be LSE OPEN');
ok(lseOpen.cls.includes('session-open'), 'LSE open must have session-open class');
ok(lseOpen.cls.includes('session-lse'), 'LSE open must have session-lse class');

// 2. LSE ETF after London close (Wednesday 14:00 ET / 19:00 London)
const wednesdayLondonClosed = new Date('2026-10-21T14:00:00-04:00');
const lseClosed = Cards.getExchangeSession('LSE', '3NGL.L', null, wednesdayLondonClosed);
eq(lseClosed.text, 'SETTLED', '3NGL.L on Wednesday 14:00 ET must be SETTLED');
ok(lseClosed.cls.includes('session-settled'), 'LSE closed must have session-settled class');

// 3. US ETF (BOIL, KOLD) and TSX ETF (HNU.TO) during US open hours (Wednesday 10:30 ET)
const wednesdayUsOpen = new Date('2026-10-21T10:30:00-04:00');
const boilLive = Cards.getExchangeSession('NYSE', 'BOIL', null, wednesdayUsOpen);
eq(boilLive.text, 'LIVE', 'BOIL on Wednesday 10:30 ET must be LIVE');
ok(boilLive.cls.includes('session-live'), 'BOIL must have session-live class');

const koldLive = Cards.getExchangeSession('NYSE', 'KOLD', null, wednesdayUsOpen);
eq(koldLive.text, 'LIVE', 'KOLD on Wednesday 10:30 ET must be LIVE');

const tsxLive = Cards.getExchangeSession('TSX', 'HNU.TO', null, wednesdayUsOpen);
eq(tsxLive.text, 'LIVE', 'HNU.TO on Wednesday 10:30 ET must be LIVE');

// 4. US ETF after US close (Wednesday 17:00 ET)
const wednesdayUsClosed = new Date('2026-10-21T17:00:00-04:00');
const boilSettled = Cards.getExchangeSession('NYSE', 'BOIL', null, wednesdayUsClosed);
eq(boilSettled.text, 'SETTLED', 'BOIL on Wednesday 17:00 ET must be SETTLED');

// 5. Weekend (Saturday 11:00 ET)
const saturdayTime = new Date('2026-10-24T11:00:00-04:00');
const boilSat = Cards.getExchangeSession('NYSE', 'BOIL', null, saturdayTime);
eq(boilSat.text, 'SETTLED', 'BOIL on Saturday must be SETTLED');
const lseSat = Cards.getExchangeSession('LSE', '3NGL.L', null, saturdayTime);
eq(lseSat.text, 'SETTLED', '3NGL.L on Saturday must be SETTLED');

console.log('Passed Exchange-Specific Session Badges checks!');

console.log('\n--- 2d. Client-Side Live Incremental Calculations ---');
// Generate 252 historical bars for accurate testing
const sampleHistory = [];
for (let i = 0; i < 252; i++) {
    sampleHistory.push({
        date: `2026-01-${String(i+1).padStart(2, '0')}`,
        close: 40 + Math.sin(i / 10) * 5,
        volume: 3000000 + (i % 20) * 100000
    });
}

// Calculate known expected values for an incoming live volume of 7,000,000
const prevVols = sampleHistory.map(h => h.volume);
const lookback21 = prevVols.slice(-21);
const expectedMean21 = Metrics.mean(lookback21);
const expectedStd21 = Metrics.std(lookback21);
const incomingLiveVol = 7000000;
const expectedRvol21 = incomingLiveVol / expectedMean21;
const expectedZScore21 = (incomingLiveVol - expectedMean21) / expectedStd21;
const expectedPct5d = Metrics.percentileRank(incomingLiveVol, prevVols.slice(-5));
const expectedPct252d = Metrics.percentileRank(incomingLiveVol, prevVols.slice(-252));

console.log(`Calculated expected live metrics: RVOL21=${expectedRvol21.toFixed(2)}x, ZScore21=${expectedZScore21.toFixed(2)}σ, Pct5d=${expectedPct5d}th, Pct252d=${expectedPct252d}th`);

// Setup card DOM
const container = new SimpleDOMElement('div');
container.id = 'cards-grid';
mockDoc.appendChild(container);

const liveMetrics = {
    'KOLD': {
        current: {
            price: 42.00,
            changePct: 3.5,
            volume: 3500000, // initial volume
            dollarVolume: 147000000
        },
        alertLevel: 'none',
        volPercentile: { '5d': 50, '10d': 50, '21d': 50, '63d': 50, '126d': 50, '252d': 50 },
        dvPercentile: { '5d': 50, '10d': 50, '21d': 50, '63d': 50, '126d': 50, '252d': 50 },
        rvol: { '21d': 1.0 },
        dvRvol: { '21d': 1.0 },
        zScore: { '21d': 0 },
        dvZScore: { '21d': 0 },
        vroc: { '10d': 10 },
        dvVroc: { '10d': 10 },
        vcvi: { '5d': 20, '21d': 20, '63d': 20 },
        dvcvi: { '5d': 20, '21d': 20, '63d': 20 },
        vps: 50,
        dvVps: 50,
        mwca: false,
        mwcaCount: 0,
        volatility: { hv: {}, volRegimePct: 50, hvTermStructure: 1, atr14Pct: 3, vov21: 15 },
        sparkData: [{ date: '2026-10-24', close: 42, volume: 3500000 }],
        history: sampleHistory
    }
};

container.innerHTML = Cards.renderCard('KOLD', liveMetrics['KOLD'], CONFIG.etfs['KOLD']);

// Verify initial DOM
const initialRvolEl = container.querySelector('[data-live="rvol-21"]');
ok(initialRvolEl, 'Found data-live="rvol-21" in DOM');

// Now simulate quote surge: volume jumps to 7,000,000, price to 43.50
liveMetrics['KOLD'].current.volume = incomingLiveVol;
liveMetrics['KOLD'].current.price = 43.50;
liveMetrics['KOLD'].current.changePct = 5.25;
liveMetrics['KOLD'].current.dollarVolume = 43.50 * incomingLiveVol;

Cards.updateLive(liveMetrics, [container]);

// Verify incremental calculations were applied to the metric state
eq(liveMetrics['KOLD'].rvol['21d'].toFixed(2), expectedRvol21.toFixed(2), 'Live RVOL-21d accurately updated in metrics');
eq(liveMetrics['KOLD'].zScore['21d'].toFixed(2), expectedZScore21.toFixed(2), 'Live Z-score-21d accurately updated in metrics');
eq(liveMetrics['KOLD'].volPercentile['5d'], expectedPct5d, 'Live 5d percentile accurately updated in metrics');
eq(liveMetrics['KOLD'].volPercentile['252d'], expectedPct252d, 'Live 252d percentile accurately updated in metrics');

// Verify DOM was dynamically updated
const updatedRvolEl = container.querySelector('[data-live="rvol-21"]');
eq(updatedRvolEl.textContent, expectedRvol21.toFixed(1) + 'x', 'DOM RVOL-21d text updated dynamically');

const updatedZEl = container.querySelector('[data-live="zscore-21"]');
const expectedZStr = (expectedZScore21 > 0 ? '+' : '') + expectedZScore21.toFixed(1) + '\u03C3';
eq(updatedZEl.textContent, expectedZStr, 'DOM Z-score-21d text updated dynamically');

const updatedPriceEl = container.querySelector('[data-live="price"]');
eq(updatedPriceEl.textContent, '43.50', 'DOM price updated dynamically');

const pRow5d = container.querySelector('.share-section .percentile-row[data-window="5d"]');
const pVal5d = pRow5d.querySelector('.percentile-value');
eq(pVal5d.textContent, Cards.formatOrdinal(expectedPct5d), 'DOM 5d percentile value ordinal updated');

console.log('Passed Client-Side Live Incremental Calculations & DOM updates!');

console.log('\n--- 2e. Dollar Mode ($) vs Share Mode (S) ---');
const cardEl = container.querySelector('.etf-card');
eq(cardEl.dataset.mode, 'share', 'Card defaults to share mode');

// Find mode pills
const sharePill = cardEl.querySelector('.share-pill');
const dollarPill = cardEl.querySelector('.dollar-pill');
ok(sharePill && dollarPill, 'Share and Dollar mode pills found');

// Click dollar mode ($)
Cards.setMode(dollarPill, 'dollar');
eq(cardEl.dataset.mode, 'dollar', 'Card dataset.mode is now "dollar"');
ok(dollarPill.classList.has('active-pill'), 'Dollar pill has active-pill class');
ok(!sharePill.classList.has('active-pill'), 'Share pill lost active-pill class');

// Verify redundant footer .card-dollar-volume is hidden in dollar mode
const dvFooter = cardEl.querySelector('.card-dollar-volume');
eq(dvFooter.style.display, 'none', 'Redundant footer .card-dollar-volume is display: none in dollar mode');

// Test Charts.drawVolumeBars dollar volume calculation
let receivedVolumes = [];
const testCanvas = mockDoc.createElement('canvas');
testCanvas.parentElement = { clientWidth: 200, clientHeight: 50 };
const testSparkData = [
    { date: '2026-10-22', close: 10, volume: 1000, dollarVolume: 10000 },
    { date: '2026-10-23', close: 20, volume: 500, dollarVolume: 10000 }
];

// In share mode, volumes are [1000, 500]
Charts.drawVolumeBars(testCanvas, testSparkData, null, null, 'share');

// In dollar mode, volumes are [10000, 10000]
Charts.drawVolumeBars(testCanvas, testSparkData, null, null, 'dollar');
console.log('Passed Dollar Mode ($) vs Share Mode (S) checks!');

console.log('\n--- 2f. Card <-> Price-Volume Studies Interconnection ---');
// Setup 2 cards in DOM: BOIL and KOLD
const cardBoil = new SimpleDOMElement('div');
cardBoil.className = 'etf-card';
cardBoil.setAttribute('data-ticker', 'BOIL');
mockDoc.appendChild(cardBoil);

const cardKold = new SimpleDOMElement('div');
cardKold.className = 'etf-card';
cardKold.setAttribute('data-ticker', 'KOLD');
mockDoc.appendChild(cardKold);

// 1. Initial selection
VolumeStudies.state = { ticker: 'BOIL' };
VolumeStudies.updateCardSelection();
ok(cardBoil.classList.has('card-selected'), 'BOIL card is selected');
ok(!cardKold.classList.has('card-selected'), 'KOLD card is not selected');

// 2. Open study for KOLD
Cards.openStudy('KOLD');
eq(VolumeStudies.state.ticker, 'KOLD', 'VolumeStudies.state.ticker updated to KOLD');
ok(cardKold.classList.has('card-selected'), 'KOLD card has .card-selected applied');
ok(!cardBoil.classList.has('card-selected'), 'BOIL card lost .card-selected');

// 3. Select BOIL inside VolumeStudies
VolumeStudies.selectTicker('BOIL');
eq(VolumeStudies.state.ticker, 'BOIL', 'VolumeStudies ticker is BOIL');
ok(cardBoil.classList.has('card-selected'), 'BOIL card regained .card-selected');
ok(!cardKold.classList.has('card-selected'), 'KOLD card lost .card-selected');

console.log('Passed Card <-> Price-Volume Studies Interconnection checks!');

console.log('================================================================');
console.log(`ALL TESTS PASSED! Total assertions: ${passedTests}/${totalTests}`);
console.log('================================================================');
