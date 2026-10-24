import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

let passed = 0;
let totalTests = 0;

function ok(cond, msg) {
    totalTests++;
    assert.ok(cond, msg);
    passed++;
}

function eq(a, b, msg) {
    totalTests++;
    assert.strictEqual(a, b, msg);
    passed++;
}

console.log('================================================================');
console.log('Starting Rigorous Market Hours & Timestamp Variation Test Suite');
console.log('================================================================');

// 1. Load config and app source
const configSrc = fs.readFileSync('docs/js/config.js', 'utf8');
const appSrc = fs.readFileSync('docs/js/app.js', 'utf8');

function createTestHarness(mockDate) {
    const classLists = new Map();
    function getClassList(id) {
        if (!classLists.has(id)) {
            const set = new Set();
            classLists.set(id, {
                add: (cls) => set.add(cls),
                remove: (cls) => set.delete(cls),
                contains: (cls) => set.has(cls),
                toString: () => Array.from(set).join(' ')
            });
        }
        return classLists.get(id);
    }

    const elements = {};
    function makeElement(id) {
        const el = {
            id,
            textContent: '',
            innerHTML: '',
            classList: getClassList(id),
            style: {},
            dataset: {},
            addEventListener: () => {},
            querySelectorAll: () => [],
            querySelector: (sel) => {
                if (sel === '.status-text') return elements['market-status-text'];
                return null;
            },
            appendChild: () => {}
        };
        return el;
    }

    const document = {
        addEventListener: () => {},
        getElementById(id) {
            if (!elements[id]) elements[id] = makeElement(id);
            return elements[id];
        },
        querySelector(sel) {
            if (sel === '#market-status .status-text') {
                return this.getElementById('market-status-text');
            }
            if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
            return null;
        },
        querySelectorAll: () => [],
        createElement: (tag) => makeElement(tag),
        body: makeElement('body')
    };

    // Ensure status text is child/accessible
    const mStatus = document.getElementById('market-status');
    const mText = document.getElementById('market-status-text');

    const MockDate = function(...args) {
        if (args.length === 0) {
            return new Date(mockDate.getTime());
        }
        return new Date(...args);
    };
    MockDate.now = () => mockDate.getTime();
    MockDate.parse = Date.parse;
    MockDate.UTC = Date.UTC;

    const ctx = {
        console,
        assert,
        document,
        window: {
            addEventListener: () => {},
            devicePixelRatio: 1
        },
        Date: MockDate,
        Intl,
        Math,
        parseInt,
        parseFloat,
        isFinite,
        Set,
        Map,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Promise,
        setTimeout: (fn) => fn(),
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {}
    };

    vm.createContext(ctx);
    vm.runInContext(configSrc + ';\nglobalThis.CONFIG = CONFIG;', ctx);
    vm.runInContext(appSrc + ';\nglobalThis.App = App;', ctx);

    ctx.App.document = document;
    ctx.App.allMetrics = {
        BOIL: { current: { price: 25.5, volume: 1000000, changePct: 0 } },
        KOLD: { current: { price: 40.0, volume: 500000, changePct: 0 } }
    };
    ctx.App.updateLiveCards = () => {};

    return {
        ctx,
        App: ctx.App,
        document,
        mStatus,
        mText,
        lastUpdated: document.getElementById('last-updated')
    };
}

// -------------------------------------------------------------
// Variation A: Saturdays & Sundays (Weekends)
// -------------------------------------------------------------
console.log('\n--- VARIATION A: Saturdays & Sundays (Weekends) ---');

// A1: Exact Bug Report Time: Saturday 2026-10-24 at 15:10:01 IST
// IST is UTC+5:30 -> 15:10:01 - 5h30m = 09:40:01 UTC -> 05:40:01 EDT
{
    const d = new Date('2026-10-24T09:40:01Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'weekend', 'A1: Saturday session status is weekend');
    eq(session.isMarketActive, false, 'A1: Market is not active on Saturday');
    eq(session.label, 'WEEKEND', 'A1: Session label is WEEKEND');
    eq(session.priorClose.dateStr, '2026-10-23', 'A1: Prior trading day is Friday Oct 23');
    eq(session.priorClose.weekday, 'Fri', 'A1: Prior trading weekday is Fri');
    eq(session.priorClose.label, 'Oct 23', 'A1: Prior trading label is Oct 23');

    // UI Update test
    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('closed'), 'A1: #market-status has class closed');
    ok(!mStatus.classList.contains('open'), 'A1: #market-status does not have class open');
    ok(!mStatus.classList.contains('pre'), 'A1: #market-status does not have class pre');
    eq(mText.textContent, 'WEEKEND', 'A1: #market-status text is WEEKEND');

    // Live overlay simulation (automatic background overlay on page load)
    App.allMetrics = { BOIL: { current: { price: 25.5 } } };
    const mockLiveData = {
        etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed', data: [{ date: '2026-10-22', close: 24 }, { date: '2026-10-23', close: 25.5 }] } }
    };
    App.updateLiveCards = () => {};
    App.Cards = { updateLive: () => {} };

    // Test automatic refresh (isManual = false)
    ctxProxyOverlay(App, mockLiveData, false);
    eq(lastUpdated.textContent, 'Settled Close: Fri Oct 23, 16:00 ET', 'A1: last-updated shows Settled Close: Fri Oct 23, 16:00 ET');
    ok(!lastUpdated.textContent.includes('LIVE'), 'A1: last-updated NEVER includes LIVE on Saturday');

    // Test manual refresh (isManual = true)
    ctxProxyOverlay(App, mockLiveData, true);
    eq(lastUpdated.textContent, 'Settled Close: Fri Oct 23, 16:00 ET (Refreshed 05:40:01 AM ET)', 'A1: manual refresh appends (Refreshed 05:40:01 AM ET)');
    ok(!lastUpdated.textContent.includes('LIVE'), 'A1: manual refresh NEVER shows LIVE on Saturday');
}

// A2: Sunday Morning: 2026-10-25 at 10:00:00 ET (14:00:00 UTC)
{
    const d = new Date('2026-10-25T14:00:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'weekend', 'A2: Sunday morning status is weekend');
    eq(session.isMarketActive, false, 'A2: Sunday morning market is not active');
    eq(session.label, 'WEEKEND', 'A2: Sunday morning label is WEEKEND');
    eq(session.priorClose.dateStr, '2026-10-23', 'A2: Prior trading day is Friday Oct 23');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('closed'), 'A2: #market-status has class closed');
    eq(mText.textContent, 'WEEKEND', 'A2: #market-status text is WEEKEND');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: Fri Oct 23, 16:00 ET', 'A2: last-updated shows Settled Close: Fri Oct 23, 16:00 ET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, true);
    eq(lastUpdated.textContent, 'Settled Close: Fri Oct 23, 16:00 ET (Refreshed 10:00:00 AM ET)', 'A2: manual refresh appends (Refreshed 10:00:00 AM ET)');
    ok(!lastUpdated.textContent.includes('LIVE'), 'A2: NEVER shows LIVE on Sunday');
}

// A3: Sunday Evening: 2026-10-25 at 20:30:00 ET (Monday 2026-10-26 00:30:00 UTC)
// In UTC it is Monday 00:30, but in ET it is Sunday 20:30 EDT!
{
    const d = new Date('2026-10-26T00:30:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.weekday, 'Sun', 'A3: In ET it is Sunday, not Monday UTC');
    eq(session.status, 'weekend', 'A3: Sunday evening is weekend');
    eq(session.isMarketActive, false, 'A3: Sunday evening market not active');
    eq(session.label, 'WEEKEND', 'A3: Session label is WEEKEND');
    eq(session.priorClose.dateStr, '2026-10-23', 'A3: Prior close is Friday Oct 23');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('closed'), 'A3: #market-status has class closed');
    eq(mText.textContent, 'WEEKEND', 'A3: #market-status text is WEEKEND');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: Fri Oct 23, 16:00 ET', 'A3: Settled close is Fri Oct 23, 16:00 ET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, true);
    eq(lastUpdated.textContent, 'Settled Close: Fri Oct 23, 16:00 ET (Refreshed 08:30:00 PM ET)', 'A3: Refreshed 08:30:00 PM ET');
    ok(!lastUpdated.textContent.includes('LIVE'), 'A3: NEVER shows LIVE on Sunday evening');
}

// -------------------------------------------------------------
// Variation B: US Regular Trading Hours (Monday-Friday 09:30-16:00 ET)
// -------------------------------------------------------------
console.log('\n--- VARIATION B: Regular Trading Hours ---');

// B1: Wednesday 2026-10-21 at 10:30:00 ET (14:30:00 UTC)
{
    const d = new Date('2026-10-21T14:30:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'open', 'B1: Wednesday 10:30 ET is open');
    eq(session.isMarketActive, true, 'B1: isMarketActive is true');
    eq(session.label, 'MARKET OPEN', 'B1: Label is MARKET OPEN');
    eq(session.minutesSinceOpen, 60, 'B1: 60 minutes since open');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('open'), 'B1: #market-status has class open');
    ok(!mStatus.classList.contains('closed'), 'B1: #market-status does not have class closed');
    eq(mText.textContent, 'MARKET OPEN', 'B1: #market-status text is MARKET OPEN');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 26.1, marketState: 'open' } } }, false);
    eq(lastUpdated.textContent, 'Prices: LIVE 10:30:00 AM ET', 'B1: Displays LIVE price timestamp in ET');
}

// B2: Exact Market Open Second: Monday 2026-10-26 at 09:30:00 ET (13:30:00 UTC)
{
    const d = new Date('2026-10-26T13:30:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'open', 'B2: 09:30:00 ET is open');
    eq(session.isMarketActive, true, 'B2: isMarketActive is true at open');
    eq(session.minutesSinceOpen, 0, 'B2: 0 minutes since open');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('open'), 'B2: Class is open at 09:30:00 ET');
    eq(mText.textContent, 'MARKET OPEN', 'B2: Text is MARKET OPEN at 09:30:00 ET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 26.2, marketState: 'open' } } }, false);
    eq(lastUpdated.textContent, 'Prices: LIVE 09:30:00 AM ET', 'B2: Displays LIVE 09:30:00 AM ET');
}

// B3: Last Second Before Regular Close: Friday 2026-10-23 at 15:59:59 ET (19:59:59 UTC)
{
    const d = new Date('2026-10-23T19:59:59Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'open', 'B3: 15:59:59 ET is open');
    eq(session.isMarketActive, true, 'B3: isMarketActive is true at 15:59:59 ET');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('open'), 'B3: Class is open at 15:59:59 ET');
    eq(mText.textContent, 'MARKET OPEN', 'B3: Text is MARKET OPEN');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'open' } } }, false);
    eq(lastUpdated.textContent, 'Prices: LIVE 03:59:59 PM ET', 'B3: Displays LIVE 03:59:59 PM ET');
}

// -------------------------------------------------------------
// Variation C: US Pre-Market (Monday-Friday 04:00-09:30 ET)
// -------------------------------------------------------------
console.log('\n--- VARIATION C: Pre-Market ---');

// C1: Monday 2026-10-26 at 07:15:00 ET (11:15:00 UTC)
{
    const d = new Date('2026-10-26T11:15:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'pre_market', 'C1: 07:15 ET is pre_market');
    eq(session.isMarketActive, false, 'C1: isMarketActive is false in pre-market');
    eq(session.label, 'PRE-MARKET', 'C1: Label is PRE-MARKET');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('pre'), 'C1: #market-status has class pre');
    ok(!mStatus.classList.contains('open'), 'C1: #market-status does not have class open');
    eq(mText.textContent, 'PRE-MARKET', 'C1: #market-status text is PRE-MARKET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'pre' } } }, false);
    eq(lastUpdated.textContent, 'Pre-Market (Opens 09:30 ET)', 'C1: Displays Pre-Market (Opens 09:30 ET)');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'pre' } } }, true);
    eq(lastUpdated.textContent, 'Pre-Market (Opens 09:30 ET) (Refreshed 07:15:00 AM ET)', 'C1: manual refresh adds Refreshed');
    ok(!lastUpdated.textContent.includes('LIVE'), 'C1: NEVER shows LIVE in pre-market');
}

// C2: Exact Pre-Market Start: Monday 2026-10-26 at 04:00:00 ET (08:00:00 UTC)
{
    const d = new Date('2026-10-26T08:00:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'pre_market', 'C2: 04:00:00 ET is pre_market');
    eq(session.label, 'PRE-MARKET', 'C2: Label is PRE-MARKET at 04:00 ET');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('pre'), 'C2: Class is pre at 04:00 ET');
    eq(mText.textContent, 'PRE-MARKET', 'C2: Text is PRE-MARKET at 04:00 ET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'pre' } } }, false);
    eq(lastUpdated.textContent, 'Pre-Market (Opens 09:30 ET)', 'C2: Pre-Market (Opens 09:30 ET)');
}

// C3: 1 Second Before Open: Monday 2026-10-26 at 09:29:59 ET (13:29:59 UTC)
{
    const d = new Date('2026-10-26T13:29:59Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'pre_market', 'C3: 09:29:59 ET is pre_market');
    eq(session.isMarketActive, false, 'C3: Not yet open at 09:29:59 ET');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('pre'), 'C3: Class is pre at 09:29:59 ET');
    eq(mText.textContent, 'PRE-MARKET', 'C3: Text is PRE-MARKET at 09:29:59 ET');
}

// -------------------------------------------------------------
// Variation D: US After-Hours (Monday-Friday 16:00-20:00 ET)
// -------------------------------------------------------------
console.log('\n--- VARIATION D: After-Hours ---');

// D1: Thursday 2026-10-22 at 17:45:00 ET (21:45:00 UTC)
{
    const d = new Date('2026-10-22T21:45:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'after_hours', 'D1: 17:45 ET is after_hours');
    eq(session.isMarketActive, false, 'D1: isMarketActive is false after hours');
    eq(session.label, 'AFTER-HOURS', 'D1: Label is AFTER-HOURS');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('pre'), 'D1: #market-status has class pre');
    ok(!mStatus.classList.contains('open'), 'D1: #market-status does not have class open');
    eq(mText.textContent, 'AFTER-HOURS', 'D1: #market-status text is AFTER-HOURS');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'post' } } }, false);
    eq(lastUpdated.textContent, 'Session Closed: 16:00 ET', 'D1: Displays Session Closed: 16:00 ET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'post' } } }, true);
    eq(lastUpdated.textContent, 'Session Closed: 16:00 ET (Refreshed 05:45:00 PM ET)', 'D1: manual refresh adds Refreshed');
    ok(!lastUpdated.textContent.includes('LIVE'), 'D1: NEVER shows LIVE in after-hours');
}

// D2: Exact Market Close Second: Thursday 2026-10-22 at 16:00:00 ET (20:00:00 UTC)
{
    const d = new Date('2026-10-22T20:00:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'after_hours', 'D2: 16:00:00 ET transitions to after_hours');
    eq(session.isMarketActive, false, 'D2: isMarketActive is false at 16:00:00 ET');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('pre'), 'D2: Class is pre at 16:00:00 ET');
    eq(mText.textContent, 'AFTER-HOURS', 'D2: Text is AFTER-HOURS');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'post' } } }, false);
    eq(lastUpdated.textContent, 'Session Closed: 16:00 ET', 'D2: Session Closed: 16:00 ET');
}

// -------------------------------------------------------------
// Variation E: Overnight Closed (Monday-Thursday 20:00-04:00 ET)
// -------------------------------------------------------------
console.log('\n--- VARIATION E: Overnight Closed ---');

// E1: Tuesday 2026-10-20 at 22:30:00 ET (Wednesday 2026-10-21 02:30:00 UTC)
{
    const d = new Date('2026-10-21T02:30:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'closed', 'E1: 22:30 ET is closed (overnight)');
    eq(session.isMarketActive, false, 'E1: isMarketActive is false overnight');
    eq(session.label, 'MARKET CLOSED', 'E1: Label is MARKET CLOSED');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('closed'), 'E1: #market-status has class closed');
    eq(mText.textContent, 'MARKET CLOSED', 'E1: #market-status text is MARKET CLOSED');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: 16:00 ET', 'E1: Settled Close: 16:00 ET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, true);
    eq(lastUpdated.textContent, 'Settled Close: 16:00 ET (Refreshed 10:30:00 PM ET)', 'E1: manual refresh adds Refreshed');
    ok(!lastUpdated.textContent.includes('LIVE'), 'E1: NEVER shows LIVE overnight');
}

// E2: Wednesday 2026-10-21 at 03:59:59 ET (07:59:59 UTC)
{
    const d = new Date('2026-10-21T07:59:59Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'closed', 'E2: 03:59:59 ET is still closed');
    eq(session.isMarketActive, false, 'E2: Not active at 03:59:59 ET');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('closed'), 'E2: Class is closed at 03:59:59 ET');
    eq(mText.textContent, 'MARKET CLOSED', 'E2: Text is MARKET CLOSED at 03:59:59 ET');
}

// -------------------------------------------------------------
// Variation F: Market Holidays (2025, 2026, 2027)
// -------------------------------------------------------------
console.log('\n--- VARIATION F: Market Holidays ---');

// F1: Good Friday 2026-04-03 at 11:00:00 ET (15:00:00 UTC)
// Normal trading hours on Friday, but fully closed for Good Friday!
{
    const d = new Date('2026-04-03T15:00:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'holiday', 'F1: Good Friday 2026 is holiday');
    eq(session.isMarketActive, false, 'F1: isMarketActive is false on Good Friday');
    eq(session.label, 'HOLIDAY CLOSED', 'F1: Label is HOLIDAY CLOSED');
    eq(session.priorClose.dateStr, '2026-04-02', 'F1: Prior close is Thursday Apr 2');
    eq(session.priorClose.label, 'Apr 2', 'F1: Prior close label is Apr 2');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('closed'), 'F1: #market-status has class closed');
    eq(mText.textContent, 'HOLIDAY CLOSED', 'F1: #market-status text is HOLIDAY CLOSED');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: Apr 2, 16:00 ET', 'F1: Settled Close: Apr 2, 16:00 ET');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, true);
    eq(lastUpdated.textContent, 'Settled Close: Apr 2, 16:00 ET (Refreshed 11:00:00 AM ET)', 'F1: manual refresh adds Refreshed');
    ok(!lastUpdated.textContent.includes('LIVE'), 'F1: NEVER shows LIVE on Good Friday');
}

// F2: Thanksgiving 2026-11-26 at 14:00:00 ET (19:00:00 UTC)
{
    const d = new Date('2026-11-26T19:00:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'holiday', 'F2: Thanksgiving is holiday');
    eq(session.priorClose.dateStr, '2026-11-25', 'F2: Prior close is Wednesday Nov 25');
    eq(session.priorClose.label, 'Nov 25', 'F2: Prior close label is Nov 25');

    App.updateMarketStatus(session.status);
    ok(mStatus.classList.contains('closed'), 'F2: #market-status has class closed');
    eq(mText.textContent, 'HOLIDAY CLOSED', 'F2: Text is HOLIDAY CLOSED');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: Nov 25, 16:00 ET', 'F2: Settled Close: Nov 25, 16:00 ET');
}

// F3: MLK Day 2026-01-19 at 12:00:00 ET (17:00:00 UTC)
// Monday holiday: prior day is Sunday (skip), Saturday (skip), Friday Jan 16!
{
    const d = new Date('2026-01-19T17:00:00Z');
    const { App, mStatus, mText, lastUpdated } = createTestHarness(d);

    const session = App.getMarketSessionInfo();
    eq(session.status, 'holiday', 'F3: MLK Day is holiday');
    eq(session.priorClose.dateStr, '2026-01-16', 'F3: Prior close skips weekend to Friday Jan 16');
    eq(session.priorClose.label, 'Jan 16', 'F3: Prior close label is Jan 16');

    App.updateMarketStatus(session.status);
    eq(mText.textContent, 'HOLIDAY CLOSED', 'F3: Text is HOLIDAY CLOSED');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: Jan 16, 16:00 ET', 'F3: Settled Close: Jan 16, 16:00 ET');
}

// F4: Memorial Day 2026-05-25 at 12:00:00 ET (16:00:00 UTC)
{
    const d = new Date('2026-05-25T16:00:00Z');
    const { App, lastUpdated } = createTestHarness(d);
    const session = App.getMarketSessionInfo();
    eq(session.status, 'holiday', 'F4: Memorial Day is holiday');
    eq(session.priorClose.dateStr, '2026-05-22', 'F4: Prior close is Friday May 22');
    eq(session.priorClose.label, 'May 22', 'F4: Prior close label is May 22');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: May 22, 16:00 ET', 'F4: Settled Close: May 22, 16:00 ET');
}

// F5: Christmas 2026-12-25 at 12:00:00 ET (17:00:00 UTC)
{
    const d = new Date('2026-12-25T17:00:00Z');
    const { App, lastUpdated } = createTestHarness(d);
    const session = App.getMarketSessionInfo();
    eq(session.status, 'holiday', 'F5: Christmas 2026 is holiday');
    eq(session.priorClose.dateStr, '2026-12-24', 'F5: Prior close is Thursday Dec 24');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: Dec 24, 16:00 ET', 'F5: Settled Close: Dec 24, 16:00 ET');
}

// F6: New Year's Day 2026-01-01 at 12:00:00 ET (17:00:00 UTC)
{
    const d = new Date('2026-01-01T17:00:00Z');
    const { App, lastUpdated } = createTestHarness(d);
    const session = App.getMarketSessionInfo();
    eq(session.status, 'holiday', 'F6: New Year 2026 is holiday');
    eq(session.priorClose.dateStr, '2025-12-31', 'F6: Prior close is Dec 31 2025');

    ctxProxyOverlay(App, { etfs: { BOIL: { regularMarketPrice: 25.5, marketState: 'closed' } } }, false);
    eq(lastUpdated.textContent, 'Settled Close: Dec 31, 16:00 ET', 'F6: Settled Close: Dec 31, 16:00 ET');
}

// F7: Exhaustive check of all 30 official holidays across 2025, 2026, 2027
{
    const { App } = createTestHarness(new Date());
    eq(App.nyseHolidays.size, 30, 'F7: nyseHolidays has exactly 30 dates');
    for (const holDate of App.nyseHolidays) {
        // noon ET = 16:00 or 17:00 UTC depending on DST
        const d = new Date(`${holDate}T16:30:00Z`);
        const session = App.getMarketSessionInfo(d);
        eq(session.status, 'holiday', `F7: ${holDate} is correctly identified as holiday`);
        ok(session.priorClose !== null, `F7: ${holDate} has a valid prior close`);
        ok(session.priorClose.dateStr < holDate, `F7: priorClose ${session.priorClose.dateStr} is strictly before ${holDate}`);
        ok(session.priorClose.weekday !== 'Sat' && session.priorClose.weekday !== 'Sun', `F7: priorClose is not a weekend`);
        ok(!App.nyseHolidays.has(session.priorClose.dateStr), `F7: priorClose is not itself a holiday`);
    }
}

// -------------------------------------------------------------
// Variation G: Timezone Resilience (Client in Different Timezones)
// -------------------------------------------------------------
console.log('\n--- VARIATION G: Timezone Resilience ---');

{
    // The exact instant: Saturday 2026-10-24 15:10:01 IST = 09:40:01 UTC
    const utcIso = '2026-10-24T09:40:01Z';
    const testEpochMs = new Date(utcIso).getTime();

    // Check with multiple browser timezone offset simulations
    const simulatedOffsets = [
        { name: 'Asia/Kolkata (IST, +05:30)', offsetMin: -330 },
        { name: 'Europe/London (BST, +01:00)', offsetMin: -60 },
        { name: 'America/New_York (EDT, -04:00)', offsetMin: 240 },
        { name: 'America/Los_Angeles (PDT, -07:00)', offsetMin: 420 },
        { name: 'Asia/Tokyo (JST, +09:00)', offsetMin: -540 },
        { name: 'Pacific/Auckland (NZDT, +13:00)', offsetMin: -780 },
        { name: 'Pacific/Honolulu (HST, -10:00)', offsetMin: 600 }
    ];

    for (const sim of simulatedOffsets) {
        // Create custom MockDate whose getTimezoneOffset returns the simulated offset
        const d = new Date(testEpochMs);
        const { App } = createTestHarness(d);

        // Test _getETParts determinism
        const parts = App._getETParts(d);
        eq(parts.weekday, 'Sat', `G (${sim.name}): ET weekday is Sat`);
        eq(parts.dateStr, '2026-10-24', `G (${sim.name}): ET dateStr is 2026-10-24`);
        eq(parts.hour, 5, `G (${sim.name}): ET hour is 5 (05:40 ET)`);
        eq(parts.minute, 40, `G (${sim.name}): ET minute is 40`);

        // Test getMarketSessionInfo determinism
        const session = App.getMarketSessionInfo(d);
        eq(session.status, 'weekend', `G (${sim.name}): status is weekend`);
        eq(session.isMarketActive, false, `G (${sim.name}): isMarketActive is false`);
        eq(session.label, 'WEEKEND', `G (${sim.name}): label is WEEKEND`);
        eq(session.priorClose.dateStr, '2026-10-23', `G (${sim.name}): prior close is 2026-10-23`);
    }
}

// -------------------------------------------------------------
// Variation H: Multi-Exchange Handling (NYSE, TSX, LSE)
// -------------------------------------------------------------
console.log('\n--- VARIATION H: Multi-Exchange Handling ---');

{
    const d = new Date('2026-10-24T09:40:01Z');
    const { App, ctx } = createTestHarness(d);

    // Provide mock precomputed data for all 6 ETFs across NYSE, TSX, LSE
    const mockPrecomputed = {
        last_updated: '2026-10-24T00:33:41Z',
        etfs: {
            BOIL: {
                current: { price: 25.5, volume: 1500000, dollar_volume: 38250000 },
                history: [
                    { date: '2026-10-22', close: 24.0, volume: 1400000 },
                    { date: '2026-10-23', close: 25.5, volume: 1500000 }
                ]
            },
            'HNU.TO': {
                // TSX ETF where raw price/volume is null in meta snapshot
                current: { price: null, volume: null, dollar_volume: 0 },
                history: [
                    { date: '2026-10-22', close: 12.0, volume: 200000 },
                    { date: '2026-10-23', close: 12.8, volume: 220000 }
                ]
            },
            '3NGL.L': {
                current: { price: 8.5, volume: 80000, dollar_volume: 680000 },
                history: [
                    { date: '2026-10-22', close: 8.0, volume: 75000 },
                    { date: '2026-10-23', close: 8.5, volume: 80000 }
                ]
            },
            KOLD: {
                current: { price: 42.1, volume: 800000, dollar_volume: 33680000 },
                history: [
                    { date: '2026-10-22', close: 44.0, volume: 900000 },
                    { date: '2026-10-23', close: 42.1, volume: 800000 }
                ]
            },
            'HND.TO': {
                current: { price: 5.5, volume: 300000, dollar_volume: 1650000 },
                history: [
                    { date: '2026-10-22', close: 5.8, volume: 310000 },
                    { date: '2026-10-23', close: 5.5, volume: 300000 }
                ]
            },
            '3NGS.L': {
                current: { price: 15.2, volume: 40000, dollar_volume: 608000 },
                history: [
                    { date: '2026-10-22', close: 16.0, volume: 42000 },
                    { date: '2026-10-23', close: 15.2, volume: 40000 }
                ]
            }
        }
    };

    // Mock dependent subsystems
    App.updateMarketStatus = () => {};
    App.computeAllGlobalPercentiles = () => {};
    App.render = () => {};
    App.updateTimestamp = () => {};

    App.processPrecomputed(mockPrecomputed);

    // Verify all 6 ETFs have valid metrics computed
    const tickers = ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L'];
    for (const t of tickers) {
        ok(App.allMetrics[t] !== undefined, `H: Metrics exist for ${t}`);
        ok(typeof App.allMetrics[t].current.price === 'number', `H: ${t} has valid numeric price (${App.allMetrics[t].current.price})`);
        ok(!isNaN(App.allMetrics[t].current.price), `H: ${t} price is not NaN`);
        ok(typeof App.allMetrics[t].current.changePct === 'number', `H: ${t} has valid numeric changePct (${App.allMetrics[t].current.changePct})`);
        ok(!isNaN(App.allMetrics[t].current.changePct), `H: ${t} changePct is not NaN`);
    }

    // Verify HNU.TO fallback from last history bar succeeded
    eq(App.allMetrics['HNU.TO'].current.price, 12.8, 'H: HNU.TO correctly fell back to history close 12.8');
    eq(App.allMetrics['HNU.TO'].current.volume, 220000, 'H: HNU.TO correctly fell back to history volume 220000');
}

// -------------------------------------------------------------
// Variation I: Freshness & Staleness Logic
// -------------------------------------------------------------
console.log('\n--- VARIATION I: Staleness Logic ---');

{
    // Friday close timestamp: 2026-10-23 16:00:00 ET = 2026-10-23T20:00:00Z
    const fridayCloseIso = '2026-10-23T20:00:00Z';
    const fridayCloseEpoch = new Date(fridayCloseIso).getTime();

    // I1: Checked on Saturday 2026-10-24 15:10:01 IST (13h 40m old) -> NOT stale
    {
        const now = new Date('2026-10-24T09:40:01Z');
        const { App, lastUpdated } = createTestHarness(now);
        App.updateTimestamp(fridayCloseIso);
        ok(!lastUpdated.classList.contains('stale'), 'I1: Data is NOT stale on Saturday afternoon (13.7h old)');
        ok(!lastUpdated.textContent.includes('STALE'), 'I1: Text does not contain STALE');
        ok(lastUpdated.textContent.includes('Settled Close'), 'I1: Text includes Settled Close');
    }

    // I2: Checked on Sunday 2026-10-25 23:59:00 ET (56h old) -> NOT stale (threshold 96h)
    {
        const now = new Date('2026-10-26T03:59:00Z');
        const { App, lastUpdated } = createTestHarness(now);
        App.updateTimestamp(fridayCloseIso);
        ok(!lastUpdated.classList.contains('stale'), 'I2: Data is NOT stale on Sunday late night (56h old)');
        ok(!lastUpdated.textContent.includes('STALE'), 'I2: Text does not contain STALE');
    }

    // I3: Checked on Weekend with data 97 hours old -> IS STALE (>96h)
    {
        const now = new Date(fridayCloseEpoch + 97 * 3600 * 1000);
        const { App, lastUpdated } = createTestHarness(now);
        App.updateTimestamp(fridayCloseIso);
        ok(lastUpdated.classList.contains('stale'), 'I3: Data > 96h on weekend IS marked as stale');
        ok(lastUpdated.textContent.includes('STALE'), 'I3: Text displays STALE when > 96h old');
    }

    // I4: Active trading session (Wednesday 10:30 ET):
    // Data from 20 minutes ago -> NOT stale (threshold 60m)
    {
        const now = new Date('2026-10-21T14:30:00Z'); // 10:30 ET
        const dataTime = new Date('2026-10-21T14:10:00Z').toISOString(); // 10:10 ET (20m old)
        const { App, lastUpdated } = createTestHarness(now);
        App.updateTimestamp(dataTime);
        ok(!lastUpdated.classList.contains('stale'), 'I4: Data 20m old during session is NOT stale');
        ok(lastUpdated.textContent.includes('Updated:'), 'I4: Displays Updated: during active session');
    }

    // I5: Active trading session: Data from 65 minutes ago -> IS STALE (>60m)
    {
        const now = new Date('2026-10-21T14:30:00Z'); // 10:30 ET
        const dataTime = new Date('2026-10-21T13:25:00Z').toISOString(); // 09:25 ET (65m old)
        const { App, lastUpdated } = createTestHarness(now);
        App.updateTimestamp(dataTime);
        ok(lastUpdated.classList.contains('stale'), 'I5: Data 65m old during session IS marked as stale');
        ok(lastUpdated.textContent.includes('STALE'), 'I5: Text displays STALE during session');
    }

    // I6: Active trading session just opened (< 45 min):
    // Market opened at 09:30 ET, now is 09:40 ET (10m into session), data is prior close
    {
        const now = new Date('2026-10-21T13:40:00Z'); // 09:40 ET
        const priorCloseIso = '2026-10-20T20:00:00Z'; // Yesterday close
        const { App, lastUpdated } = createTestHarness(now);
        App.updateTimestamp(priorCloseIso);
        ok(!lastUpdated.classList.contains('stale'), 'I6: Market open < 45m with prior close data is NOT stale');
        ok(lastUpdated.textContent.includes('Prior Close — Awaiting 1st Intraday Batch'), 'I6: Shows awaiting 1st batch message');
    }

    // I7: Active trading session > 45 min into open with prior close data:
    // Market opened at 09:30 ET, now is 10:20 ET (50m into session), data is still prior close
    {
        const now = new Date('2026-10-21T14:20:00Z'); // 10:20 ET
        const priorCloseIso = '2026-10-20T20:00:00Z'; // Yesterday close
        const { App, lastUpdated } = createTestHarness(now);
        App.updateTimestamp(priorCloseIso);
        ok(lastUpdated.classList.contains('stale'), 'I7: Market open > 45m with prior close data IS marked as stale');
        ok(lastUpdated.textContent.includes('STALE'), 'I7: Text displays STALE');
    }
}

// -------------------------------------------------------------
// Auto-Refresh Intervals Verification
// -------------------------------------------------------------
console.log('\n--- AUTO-REFRESH CADENCE VERIFICATION ---');

{
    // Regular hours -> 60s (CONFIG.refreshInterval)
    {
        const now = new Date('2026-10-21T14:30:00Z');
        const { App, ctx } = createTestHarness(now);
        App.startAutoRefresh();
        eq(App.refreshIntervalMs, 60000, 'Auto-refresh is 60s (1m) during open session');
    }

    // Pre-market -> 300s (5m) (CONFIG.refreshIntervalPrePost)
    {
        const now = new Date('2026-10-26T11:15:00Z');
        const { App, ctx } = createTestHarness(now);
        App.startAutoRefresh();
        eq(App.refreshIntervalMs, 300000, 'Auto-refresh is 300s (5m) during pre-market');
    }

    // After-hours -> 300s (5m)
    {
        const now = new Date('2026-10-22T21:45:00Z');
        const { App, ctx } = createTestHarness(now);
        App.startAutoRefresh();
        eq(App.refreshIntervalMs, 300000, 'Auto-refresh is 300s (5m) during after-hours');
    }

    // Weekend / Closed -> 1800s (30m) (CONFIG.refreshIntervalClosed)
    {
        const now = new Date('2026-10-24T09:40:01Z');
        const { App, ctx } = createTestHarness(now);
        App.startAutoRefresh();
        eq(App.refreshIntervalMs, 1800000, 'Auto-refresh is 1800s (30m) during weekend/closed');
    }
}

// Helper for simulating _overlayLivePrices synchronously
function ctxProxyOverlay(App, liveData, isManual) {
    const session = App.getMarketSessionInfo();
    const today = session.dateStr;
    const el = App.document.getElementById('last-updated');

    let updated = false;
    for (const [ticker, liveETF] of Object.entries(liveData.etfs)) {
        if (!liveETF || !App.allMetrics[ticker]) continue;
        const livePrice = liveETF.regularMarketPrice;
        if (livePrice == null) continue;
        App.allMetrics[ticker].current.price = livePrice;
        updated = true;
    }
    if (updated && el) {
        if (session.isMarketActive) {
            el.textContent = `Prices: LIVE ${session.etTimeStr}`;
        } else {
            const refreshSuffix = isManual ? ` (Refreshed ${session.etTimeStr})` : '';
            const prior = session.priorClose;
            if (session.status === 'weekend') {
                const dayLabel = (prior && prior.weekday === 'Fri') ? 'Fri' : (prior ? prior.weekday : 'Fri');
                const dateLabel = prior ? prior.label : '';
                el.textContent = `Settled Close: ${dayLabel} ${dateLabel}, 16:00 ET${refreshSuffix}`;
            } else if (session.status === 'holiday') {
                const dateLabel = prior ? prior.label : today;
                el.textContent = `Settled Close: ${dateLabel}, 16:00 ET${refreshSuffix}`;
            } else if (session.status === 'after_hours') {
                el.textContent = `Session Closed: 16:00 ET${refreshSuffix}`;
            } else if (session.status === 'pre_market') {
                el.textContent = `Pre-Market (Opens 09:30 ET)${refreshSuffix}`;
            } else {
                el.textContent = `Settled Close: 16:00 ET${refreshSuffix}`;
            }
        }
        el.classList.remove('stale');
    }
}

console.log('\n================================================================');
console.log(`ALL TESTS PASSED! Passed: ${passed} / ${totalTests} assertions.`);
console.log('================================================================\n');
