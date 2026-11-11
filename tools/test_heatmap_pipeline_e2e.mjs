import fs from 'fs';

// Mock DOM environment
global.document = {
    getElementById(id) {
        if (!this._elements) this._elements = {};
        if (!this._elements[id]) {
            this._elements[id] = {
                id,
                classList: {
                    _classes: new Set(),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    toggle(c, val) { if (val) this._classes.add(c); else this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); }
                },
                style: {},
                attributes: {},
                children: [],
                setAttribute(k, v) { this.attributes[k] = v; },
                appendChild(c) { this.children.push(c); },
                innerHTML: ''
            };
        }
        return this._elements[id];
    },
    createElement(tag) {
        return {
            tag,
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                toggle(c, val) { if (val) this._classes.add(c); else this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            },
            style: {},
            attributes: {},
            children: [],
            setAttribute(k, v) { this.attributes[k] = v; },
            appendChild(c) { this.children.push(c); }
        };
    }
};

global.window = {
    App: {
        heatMode: 'share',
        heatSide: 'all',
        heatSpotlightMode: 'peaks',
        heatPeaksThreshold: 95,
        heatDays: 90,
        heatOffset: 0,
        heatGlobalPercentiles: { share: {}, dollar: {} }
    }
};

global.CONFIG = {
    heatmapDays: 756,
    etfs: {
        'BOIL': { side: 'long', exchange: 'NYSE', leverage: '2x' },
        'HNU.TO': { side: 'long', exchange: 'TSX', leverage: '2x' },
        '3NGL.L': { side: 'long', exchange: 'LSE', leverage: '3x' },
        'KOLD': { side: 'short', exchange: 'NYSE', leverage: '2x' },
        'HND.TO': { side: 'short', exchange: 'TSX', leverage: '2x' },
        '3NGS.L': { side: 'short', exchange: 'LSE', leverage: '3x' }
    }
};

global.formatDisplayDate = d => d;

// Evaluate signals.js and charts.js into global
const chartsCode = fs.readFileSync('docs/js/charts.js', 'utf8').replace('const Charts =', 'global.Charts =');
const signalsCode = fs.readFileSync('docs/js/signals.js', 'utf8').replace('const Signals =', 'global.Signals =');

eval(chartsCode);
eval(signalsCode);

const rawData = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8'));

// Build allMetrics with mapBar matching app.js
const mapBar = h => ({
    date: h.date || h[0],
    open: h.open != null ? h.open : (h[3] != null ? h[3] : (h.close != null ? h.close : h[1])),
    high: h.high != null ? h.high : (h[4] != null ? h[4] : (h.close != null ? h.close : h[1])),
    low: h.low != null ? h.low : (h[5] != null ? h[5] : (h.close != null ? h.close : h[1])),
    close: h.close != null ? h.close : h[1],
    volume: h.volume != null ? h.volume : h[2],
    dollarVolume: h.dollar_volume != null ? h.dollar_volume : ((h.close != null && h.volume != null) ? h.close * h.volume : 0)
});

const allMetrics = {};
for (const [ticker, etfData] of Object.entries(rawData.etfs)) {
    allMetrics[ticker] = {
        heatmapData: (etfData.history || []).slice(-756).map(mapBar),
        history: etfData.history || []
    };
}

console.log('Testing App.computeAllGlobalPercentiles simulation...');
const filters = ['all', 'long', 'short', ...Object.keys(CONFIG.etfs)];
for (const f of filters) {
    window.App.heatGlobalPercentiles.share[f] = Signals.computeHeatGlobalPercentiles(allMetrics, 'share', f);
    window.App.heatGlobalPercentiles.dollar[f] = Signals.computeHeatGlobalPercentiles(allMetrics, 'dollar', f);
}

console.log('Precomputed series count for ALL (share):', window.App.heatGlobalPercentiles.share.all.series.length);
console.log('Precomputed series count for SHORT (share):', window.App.heatGlobalPercentiles.share.short.series.length);
console.log('Precomputed series count for LONG (share):', window.App.heatGlobalPercentiles.share.long.series.length);

if (window.App.heatGlobalPercentiles.share.all.series.length !== 735) {
    throw new Error(`Expected 735 display bars for ALL (share), got ${window.App.heatGlobalPercentiles.share.all.series.length}`);
}

// Test interactive clicks on P90, P95, P99 across all viewports
const daysToTest = [90, 126, 180, 252];
const sidesToTest = ['all', 'short', 'long', 'BOIL', 'KOLD', 'HNU.TO', 'HND.TO', '3NGL.L', '3NGS.L'];
const modesToTest = ['share', 'dollar'];
const spotlightModesToTest = ['peaks', 'valleys'];

let assertions = 0;
for (const side of sidesToTest) {
    for (const m of modesToTest) {
        for (const sm of spotlightModesToTest) {
            for (const d of daysToTest) {
                // Call renderHeatCalendar for P99
                Signals.renderHeatCalendar(allMetrics, 0, m, side, sm, 99, window.App.heatGlobalPercentiles[m][side], d);
                const countBadge99 = document.getElementById('heat-peak-count').textContent;
                const count99 = parseInt(countBadge99, 10);

                // Call renderHeatCalendar for P95
                Signals.renderHeatCalendar(allMetrics, 0, m, side, sm, 95, window.App.heatGlobalPercentiles[m][side], d);
                const countBadge95 = document.getElementById('heat-peak-count').textContent;
                const count95 = parseInt(countBadge95, 10);

                // Call renderHeatCalendar for P90
                Signals.renderHeatCalendar(allMetrics, 0, m, side, sm, 90, window.App.heatGlobalPercentiles[m][side], d);
                const countBadge90 = document.getElementById('heat-peak-count').textContent;
                const count90 = parseInt(countBadge90, 10);

                if (!(count90 >= count95 && count95 >= count99 && count99 >= 0)) {
                    throw new Error(`Weak monotonicity failed for side=${side}, mode=${m}, spotlight=${sm}, days=${d}: P90=${count90}, P95=${count95}, P99=${count99}`);
                }
                assertions += 3;
            }
        }
    }
}

console.log(`ALL ${assertions} WEAK MONOTONICITY ASSERTIONS PASSED!`);

// (a) Causal prefix invariance test (> 2025-06-30 future shock & truncation -> 0 diffs <= 2025-06-30)
console.log('\n--- TEST (a): CAUSAL PREFIX INVARIANCE ---');
const cutoffDate = '2025-06-30';
const shockedMetrics = {};
const truncatedMetrics = {};
for (const [ticker, etfData] of Object.entries(rawData.etfs)) {
    const baseHist = etfData.history || [];
    const shockedHist = baseHist.map(h => {
        const d = h.date || h[0];
        if (d > cutoffDate) {
            const c = Number(h.close != null ? h.close : h[1]) * 0.005;
            const o = Number(h.open != null ? h.open : c) * 0.005;
            const hi = Number(h.high != null ? h.high : c) * 0.005;
            const lo = Number(h.low != null ? h.low : c) * 0.005;
            const v = Number(h.volume != null ? h.volume : h[2]) * 500;
            return { date: d, open: o, high: hi, low: lo, close: c, volume: v };
        }
        return h;
    });
    const truncHist = baseHist.filter(h => (h.date || h[0]) <= cutoffDate);
    shockedMetrics[ticker] = {
        heatmapData: shockedHist.slice(-756).map(mapBar),
        history: shockedHist
    };
    truncatedMetrics[ticker] = {
        heatmapData: truncHist.slice(-756).map(mapBar),
        history: truncHist
    };
}

let prefixChecks = 0;
for (const side of ['all', 'short', 'long', 'BOIL', 'KOLD', '3NGL.L', '3NGS.L']) {
    for (const m of ['share', 'dollar']) {
        const baseSeries = window.App.heatGlobalPercentiles[m][side].series;
        const shockSeries = Signals.computeHeatGlobalPercentiles(shockedMetrics, m, side).series;
        const truncSeries = Signals.computeHeatGlobalPercentiles(truncatedMetrics, m, side).series;

        const basePre = baseSeries.filter(r => r.date <= cutoffDate);
        const shockPre = shockSeries.filter(r => r.date <= cutoffDate);
        const truncMap = new Map(truncSeries.map(r => [r.date, r]));

        if (basePre.length !== shockPre.length || basePre.length === 0) {
            throw new Error(`Prefix length mismatch for ${side}/${m}: base=${basePre.length} shock=${shockPre.length}`);
        }
        for (let i = 0; i < basePre.length; i++) {
            const b = basePre[i];
            const s = shockPre[i];
            const tr = truncMap.get(b.date);
            if (!tr) throw new Error(`Missing date ${b.date} in truncated series for ${side}/${m}`);
            if (b.date !== s.date || Math.abs(b.peakScore - s.peakScore) > 1e-12 || Math.abs(b.valleyScore - s.valleyScore) > 1e-12) {
                throw new Error(`Score drift after future shock on ${b.date} (${side}/${m})`);
            }
            if (Math.abs(b.peakScore - tr.peakScore) > 1e-12 || Math.abs(b.valleyScore - tr.valleyScore) > 1e-12) {
                throw new Error(`Score drift after truncation on ${b.date} (${side}/${m})`);
            }
            for (const reg of ['PEAKS', 'VALLEYS']) {
                const bc = b.causal[reg];
                const sc = s.causal[reg];
                const tc = tr.causal[reg];
                if (
                    bc.rank !== sc.rank || bc.nEff !== sc.nEff || bc.macroRank !== sc.macroRank ||
                    bc.visualTier !== sc.visualTier || bc.isStructuralClimax !== sc.isStructuralClimax ||
                    bc.dimReason !== sc.dimReason
                ) {
                    throw new Error(`Causal state drift after shock on ${b.date} (${side}/${m}/${reg})`);
                }
                if (
                    bc.rank !== tc.rank || bc.nEff !== tc.nEff || bc.macroRank !== tc.macroRank ||
                    bc.visualTier !== tc.visualTier || bc.isStructuralClimax !== tc.isStructuralClimax ||
                    bc.dimReason !== tc.dimReason
                ) {
                    throw new Error(`Causal state drift after truncation on ${b.date} (${side}/${m}/${reg})`);
                }
            }
            prefixChecks++;
        }
    }
}
console.log(`Passed causal prefix invariance across ${prefixChecks} historical cell-days (0 diffs)!`);

// (b) Horizon invariance test (90D / 126D / 180D / 252D) & Standalone Causal Fallback parity
console.log('\n--- TEST (b): HORIZON INVARIANCE & STANDALONE FALLBACK ---');
let horizonChecks = 0;
for (const side of filters) {
    for (const m of modesToTest) {
        const series = window.App.heatGlobalPercentiles[m][side].series;
        for (const reg of ['PEAKS', 'VALLEYS']) {
            for (const filt of ['P90', 'P95', 'P99']) {
                const ref252 = Charts.evaluateViewportSpotlight(series.slice(-252), reg, filt);
                const refMap = new Map(ref252.map(c => [c.date, c]));
                for (const d of [90, 126, 180]) {
                    const sub = Charts.evaluateViewportSpotlight(series.slice(-d), reg, filt);
                    for (const cell of sub) {
                        const r = refMap.get(cell.date);
                        if (!r) throw new Error(`Missing date ${cell.date} in 252D reference`);
                        if (
                            cell.rank !== r.rank || cell.nEff !== r.nEff || cell.pctTop !== r.pctTop ||
                            cell.visualTier !== r.visualTier || cell.isStructuralClimax !== r.isStructuralClimax ||
                            cell.isHighlighted !== r.isHighlighted || cell.dimReason !== r.dimReason
                        ) {
                            throw new Error(`Horizon invariance broken on ${cell.date} (${side}/${m}/${reg}/${filt}/${d})`);
                        }
                        horizonChecks++;
                    }
                }
            }
        }
    }
}

// Verify standalone causal fallback without .causal matches causal computation over [0..i]
const bareSample = window.App.heatGlobalPercentiles.share.short.series.slice(-252).map(r => {
    const { causal, ...bare } = r;
    return bare;
});
const bareOut90 = Charts.evaluateViewportSpotlight(bareSample.slice(-90), 'PEAKS', 'P95');
if (bareOut90.slice(0, 20).some(c => c.isHighlighted || c.dimReason !== 'WARMUP')) {
    throw new Error('Standalone causal fallback failed MIN_CAUSAL_WARMUP = 21 guard');
}
// Compare trailing slice of bareSample vs same-length precomputed causal prefix
const shortSeries252 = Signals.computeHeatGlobalPercentiles(
    Object.fromEntries(Object.entries(allMetrics).map(([k, v]) => [k, { heatmapData: v.heatmapData.slice(-273) }])),
    'share',
    'short'
).series;
const bareFromShort = shortSeries252.map(({ causal, ...bare }) => bare);
const fallbackOut = Charts.evaluateViewportSpotlight(bareFromShort, 'PEAKS', 'P95');
for (let i = 0; i < shortSeries252.length; i++) {
    const p = shortSeries252[i].causal.PEAKS;
    const f = fallbackOut[i];
    if (p.rank !== f.rank || p.nEff !== f.nEff || p.visualTier !== f.visualTier || p.isStructuralClimax !== f.isStructuralClimax || p.pctTop !== f.pctTop) {
        throw new Error(`Standalone fallback mismatch at i=${i} (${shortSeries252[i].date})`);
    }
}
console.log(`Passed horizon invariance (${horizonChecks} cell comparisons, 0 diffs) & standalone causal fallback parity!`);

// (c) Zero NaN / non-finite scores & pctTop boundary parity
console.log('\n--- TEST (c): ZERO NaN & PCT-TOP BOUNDARY PARITY ---');
let finiteChecks = 0;
for (const side of filters) {
    for (const m of modesToTest) {
        const series = window.App.heatGlobalPercentiles[m][side].series;
        for (const r of series) {
            if (!Number.isFinite(r.peakScore) || r.peakScore < 0 || r.peakScore > 100) {
                throw new Error(`Invalid peakScore on ${r.date} (${side}/${m}): ${r.peakScore}`);
            }
            if (!Number.isFinite(r.valleyScore) || r.valleyScore < 0 || r.valleyScore > 100) {
                throw new Error(`Invalid valleyScore on ${r.date} (${side}/${m}): ${r.valleyScore}`);
            }
            if (!Number.isFinite(r.maxRvol) || !Number.isFinite(r.minRvol)) {
                throw new Error(`Non-finite RVOL on ${r.date} (${side}/${m})`);
            }
            for (const reg of ['PEAKS', 'VALLEYS']) {
                const c = r.causal[reg];
                if (!Number.isFinite(c.rank) || !Number.isFinite(c.nEff) || !Number.isFinite(c.pctTop)) {
                    throw new Error(`Non-finite causal fields on ${r.date} (${side}/${m}/${reg})`);
                }
                if (c.nEff >= 100 && c.dimReason !== 'NOISE_FLOOR') {
                    if ((c.pctTop <= 1) !== (c.visualTier === 'RED_P99')) {
                        throw new Error(`P99 pctTop boundary leak on ${r.date}: pctTop=${c.pctTop}, tier=${c.visualTier}`);
                    }
                    if ((c.pctTop <= 5) !== (c.visualTier === 'RED_P99' || c.visualTier === 'ORANGE_P95')) {
                        throw new Error(`P95 pctTop boundary leak on ${r.date}: pctTop=${c.pctTop}, tier=${c.visualTier}`);
                    }
                    if ((c.pctTop <= 10) !== (c.visualTier !== 'NONE')) {
                        throw new Error(`P90 pctTop boundary leak on ${r.date}: pctTop=${c.pctTop}, tier=${c.visualTier}`);
                    }
                }
            }
            finiteChecks++;
        }
    }
}
console.log(`Passed zero-NaN & pctTop parity checks across ${finiteChecks} composite records!`);

// (d) heatmapData-absent live fallback (history-only, 504 bars)
console.log('\n--- TEST (d): HEATMAPDATA-ABSENT LIVE FALLBACK (504d HISTORY-ONLY) ---');
const liveFallbackMetrics = {};
for (const [ticker, etfData] of Object.entries(rawData.etfs)) {
    liveFallbackMetrics[ticker] = {
        history: (etfData.history || []).slice(-504).map(mapBar)
    };
}
const fallbackGp = Signals.computeHeatGlobalPercentiles(liveFallbackMetrics, 'share', 'all');
if (fallbackGp.series.length !== 483) {
    throw new Error(`Expected 483 bars for 504d history-only fallback, got ${fallbackGp.series.length}`);
}
for (let i = 0; i < 20; i++) {
    const rec = fallbackGp.series[i];
    if (rec.causal.PEAKS.nEff !== i + 1 || rec.causal.PEAKS.dimReason !== 'WARMUP' || rec.causal.PEAKS.visualTier !== 'NONE') {
        throw new Error(`Warm-up mismatch at index ${i} in live fallback`);
    }
}
if (fallbackGp.series[20].causal.PEAKS.nEff !== 21 || fallbackGp.series[20].causal.PEAKS.dimReason === 'WARMUP') {
    throw new Error('Expected day 21 (index 20) to exit WARMUP in live fallback');
}
const lastFallback = fallbackGp.series[fallbackGp.series.length - 1];
if (!lastFallback.leadPeak || lastFallback.leadPeak.dd63Pct == null || lastFallback.leadPeak.dd252Pct == null) {
    throw new Error('Expected _computeCloseContext history fallback to populate dd63Pct/dd252Pct when heatmapData is absent');
}
console.log(`Passed 504d history-only fallback: ${fallbackGp.series.length} bars, warm-up=20d, close-context DD populated!`);

// Specifically inspect the user's exact case from the screenshot:
console.log('\n--- VERIFYING USER SCENARIO (SHORT ETFs, 90 DAYS, PEAKS) ---');
Signals.renderHeatCalendar(allMetrics, 0, 'share', 'short', 'peaks', 99, window.App.heatGlobalPercentiles.share.short, 90);
const short90p99 = document.getElementById('heat-peak-count').textContent;
console.log('P99 badge:', short90p99);
if (short90p99 !== '0 PEAKS') throw new Error(`Expected 0 PEAKS, got ${short90p99}`);

Signals.renderHeatCalendar(allMetrics, 0, 'share', 'short', 'peaks', 95, window.App.heatGlobalPercentiles.share.short, 90);
const short90p95 = document.getElementById('heat-peak-count').textContent;
console.log('P95 badge:', short90p95);
if (short90p95 !== '5 PEAKS') throw new Error(`Expected 5 PEAKS, got ${short90p95}`);

Signals.renderHeatCalendar(allMetrics, 0, 'share', 'short', 'peaks', 90, window.App.heatGlobalPercentiles.share.short, 90);
const short90p90 = document.getElementById('heat-peak-count').textContent;
console.log('P90 badge:', short90p90);
if (short90p90 !== '12 PEAKS') throw new Error(`Expected 12 PEAKS, got ${short90p90}`);

console.log('\n--- VERIFYING ALL ETFs, 90 DAYS, PEAKS ---');
Signals.renderHeatCalendar(allMetrics, 0, 'share', 'all', 'peaks', 99, window.App.heatGlobalPercentiles.share.all, 90);
console.log('P99 badge:', document.getElementById('heat-peak-count').textContent);

Signals.renderHeatCalendar(allMetrics, 0, 'share', 'all', 'peaks', 95, window.App.heatGlobalPercentiles.share.all, 90);
console.log('P95 badge:', document.getElementById('heat-peak-count').textContent);

Signals.renderHeatCalendar(allMetrics, 0, 'share', 'all', 'peaks', 90, window.App.heatGlobalPercentiles.share.all, 90);
console.log('P90 badge:', document.getElementById('heat-peak-count').textContent);
