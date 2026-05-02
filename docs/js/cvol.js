/* ============================================================
   CVOL Volatility Intelligence Engine
   4th Tab of Blue Meridian
   ============================================================ */
'use strict';

const CvolState = {
    data: null,           // parsed CSV rows [{date, ngvl, dnVar, upVar, skew, skewRatio, atm, convexity, underlying}]
    dates: [],
    activeSeries: ['ngvl','underlying'],
    varActiveSeries: ['upVar','dnVar','skewRatio'],
    rangeState: { start: 0, end: 100 },
    varRangeState: { start: 0, end: 100 },
    horizonState: 'ALL',
    varHorizonState: 'ALL',
    hoverState: null,
    dragState: { active: false, startIdx: null, currentIdx: null },
    signalFilter: 'all',
    signalTypeFilter: 'all', // 'all', 'SAD', 'CI', 'CVC↓', 'CVC↑', 'RDS'
    markerMode: 'decision',
    regimeFilter: 'all',  // 'all', 'low', 'normal', 'high'
    composites: {},       // computed composite signal arrays
    t2pContext: null,
    decisionState: null,
    percentiles: {},      // rolling percentile caches
    zscores: {},          // rolling z-score caches
    modalRange: null,     // shared for composite modals
};

// ── CSV Parser ────────────────────────────────────────────────
function parseCvolCsv(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].trim().split(',');
        if (cols.length < 9) continue;
        // DD-MM-YYYY → YYYY-MM-DD (the Date Parsing Trap)
        const dParts = cols[0].trim().split('-');
        if (dParts.length !== 3) continue;
        const date = `${dParts[2]}-${dParts[1]}-${dParts[0]}`;
        if (isNaN(new Date(date).getTime())) continue;
        rows.push({
            date,
            ngvl:      parseFloat(cols[1]),
            dnVar:     parseFloat(cols[2]),
            upVar:     parseFloat(cols[3]),
            skew:      parseFloat(cols[4]),
            skewRatio: parseFloat(cols[5]),
            atm:       parseFloat(cols[6]),
            convexity: parseFloat(cols[7]),
            underlying:parseFloat(cols[8]),
        });
    }
    return rows;
}

// ── Rolling Statistics ────────────────────────────────────────
function rollingPercentile(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        const slice = [];
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) slice.push(arr[j]);
        if (slice.length < 5) continue;
        slice.sort((a, b) => a - b);
        const v = arr[i];
        let rank = 0;
        for (const s of slice) if (s <= v) rank++;
        out[i] = (rank / slice.length) * 100;
    }
    return out;
}

function rollingZScore(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        let sum = 0, cnt = 0;
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) { sum += arr[j]; cnt++; }
        if (cnt < 5) continue;
        const mean = sum / cnt;
        let ss = 0;
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) ss += (arr[j] - mean) ** 2;
        const std = Math.sqrt(ss / (cnt - 1));
        out[i] = std > 0.0001 ? (arr[i] - mean) / std : 0;
    }
    return out;
}

function rollingMedian(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        const slice = [];
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) slice.push(arr[j]);
        if (slice.length < 3) continue;
        slice.sort((a, b) => a - b);
        out[i] = slice.length % 2 === 0
            ? (slice[slice.length / 2 - 1] + slice[slice.length / 2]) / 2
            : slice[Math.floor(slice.length / 2)];
    }
    return out;
}

function rateOfChange(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window; i < arr.length; i++) {
        if (arr[i] != null && arr[i - window] != null && arr[i - window] !== 0) {
            out[i] = arr[i] - arr[i - window];
        }
    }
    return out;
}

function rollingAvg(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        let sum = 0, count = 0;
        for (let j = i - window + 1; j <= i; j++) { if (arr[j] != null) { sum += arr[j]; count++; } }
        if (count >= Math.floor(window * 0.7)) out[i] = sum / count;
    }
    return out;
}

function fullPercentile(arr, value) {
    if (value == null) return null;
    const valid = arr.filter(v => v != null);
    if (valid.length < 5) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    let rank = 0;
    for (const s of sorted) if (s <= value) rank++;
    return (rank / sorted.length) * 100;
}

// ── Composite Signal Computations ─────────────────────────────
// -- T2P and decision helpers -------------------------------------------------
const CVOL_T2P_THRESHOLD = 30;
const CVOL_T2P_CLUSTER_DAYS = 5;
const CVOL_LONG_T2P = { BOIL: true, 'HNU.TO': true, '3NGL.L': true };
const CVOL_INVERSE_T2P = { KOLD: true, 'HND.TO': true, '3NGS.L': true };
const DECISION_TYPES = ['BOTTOM', 'TOP', 'EXPANSION', 'EXHAUSTION', 'CONFLICT', 'NO_EDGE'];

function cvolDateMs(dateStr) { return Date.parse(dateStr + 'T00:00:00Z'); }
function cvolDaysBetween(a, b) { return Math.round((cvolDateMs(a) - cvolDateMs(b)) / 86400000); }
function cvolDateFromMs(ms) { return new Date(ms).toISOString().slice(0, 10); }
function cvolAddDays(dateStr, days) { return cvolDateFromMs(cvolDateMs(dateStr) + days * 86400000); }
function cvolClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function cvolFindNearestIndex(data, dateStr) {
    if (!data || !data.length) return -1;
    var best = 0, bestAbs = Infinity;
    for (var i = 0; i < data.length; i++) {
        var d = Math.abs(cvolDaysBetween(data[i].date, dateStr));
        if (d < bestAbs) { bestAbs = d; best = i; }
    }
    return best;
}

function normalizeSignalName(signal) {
    var s = String(signal || '').toUpperCase();
    if (s.indexOf('CVC') >= 0 && (s.indexOf('DOWN') >= 0 || s.indexOf('DN') >= 0 || s.indexOf('↓') >= 0 || (s.indexOf('â') >= 0 && s.indexOf('“') >= 0))) return 'CVC_DOWN';
    if (s.indexOf('CVC') >= 0 && (s.indexOf('UP') >= 0 || s.indexOf('↑') >= 0 || (s.indexOf('â') >= 0 && s.indexOf('‘') >= 0))) return 'CVC_UP';
    if (s.indexOf('SAD') >= 0) return 'SAD';
    if (s.indexOf('CI') >= 0) return 'CI';
    if (s.indexOf('RDS') >= 0) return 'RDS';
    if (DECISION_TYPES.indexOf(s) >= 0) return s;
    return s || 'UNKNOWN';
}

function signalDisplayName(key) {
    var map = { CVC_DOWN: 'CVC Down', CVC_UP: 'CVC Up', SAD: 'SAD', CI: 'CI', RDS: 'RDS' };
    return map[normalizeSignalName(key)] || key || '--';
}

function decisionColor(type) {
    var map = {
        BOTTOM: '#3db87a',
        TOP: '#ef4444',
        EXPANSION: '#60a8f8',
        EXHAUSTION: '#f59e0b',
        CONFLICT: '#ec4899',
        NO_EDGE: 'rgba(255,255,255,0.65)'
    };
    return map[type] || 'rgba(255,255,255,0.65)';
}

function decisionAction(type) {
    var map = {
        BOTTOM: 'LONG / RECOVERY BIAS',
        TOP: 'SHORT / HEDGE BIAS',
        EXPANSION: 'VOL EXPANSION WATCH',
        EXHAUSTION: 'EXHAUSTION WATCH',
        CONFLICT: 'CONFLICT - WAIT',
        NO_EDGE: 'NO EDGE'
    };
    return map[type] || 'NO EDGE';
}

function cvolDetectT2pCycles(dates, prices, pct) {
    var thr = pct / 100;
    if (!prices || prices.length < 2) return [];
    var pivots = [];
    var dir = null, pIdx = 0;

    for (var i = 1; i < prices.length; i++) {
        if (prices[i] == null || prices[pIdx] == null || prices[pIdx] === 0) continue;
        var chg = (prices[i] - prices[pIdx]) / prices[pIdx];
        if (dir === null) {
            if (chg >= thr) {
                pivots.push({ i: pIdx, price: prices[pIdx], date: dates[pIdx], type: 'trough' });
                dir = 'up'; pIdx = i;
            } else if (chg <= -thr) {
                pivots.push({ i: pIdx, price: prices[pIdx], date: dates[pIdx], type: 'peak' });
                dir = 'down'; pIdx = i;
            }
        } else if (dir === 'up') {
            if (prices[i] >= prices[pIdx]) { pIdx = i; }
            else if ((prices[pIdx] - prices[i]) / prices[pIdx] >= thr) {
                pivots.push({ i: pIdx, price: prices[pIdx], date: dates[pIdx], type: 'peak' });
                dir = 'down'; pIdx = i;
            }
        } else {
            if (prices[i] <= prices[pIdx]) { pIdx = i; }
            else if ((prices[i] - prices[pIdx]) / prices[pIdx] >= thr) {
                pivots.push({ i: pIdx, price: prices[pIdx], date: dates[pIdx], type: 'trough' });
                dir = 'up'; pIdx = i;
            }
        }
    }
    if (dir !== null) pivots.push({ i: pIdx, price: prices[pIdx], date: dates[pIdx], type: dir === 'up' ? 'peak' : 'trough' });

    var cycles = [];
    for (var j = 0; j < pivots.length - 1; j++) {
        if (pivots[j].type === 'trough' && pivots[j + 1].type === 'peak') {
            var gain = (pivots[j + 1].price - pivots[j].price) / pivots[j].price * 100;
            var days = cvolDaysBetween(pivots[j + 1].date, pivots[j].date);
            cycles.push({
                num: cycles.length + 1,
                troughDate: pivots[j].date,
                troughPrice: pivots[j].price,
                peakDate: pivots[j + 1].date,
                peakPrice: pivots[j + 1].price,
                gain: gain,
                days: days,
            });
        }
    }
    return cycles;
}

function buildT2pTurns(t2pJson, threshold) {
    var turns = [];
    var tickers = t2pJson && t2pJson.tickers ? t2pJson.tickers : {};
    Object.keys(tickers).forEach(function(symbol) {
        var d = tickers[symbol];
        if (!d || !d.dates || !d.closes || !d.dates.length) return;
        var cycles = cvolDetectT2pCycles(d.dates, d.closes, threshold || CVOL_T2P_THRESHOLD);
        var isLong = !!CVOL_LONG_T2P[symbol];
        var isInverse = !!CVOL_INVERSE_T2P[symbol];
        if (!isLong && !isInverse) return;
        cycles.forEach(function(c) {
            var bottomDate = isLong ? c.troughDate : c.peakDate;
            var topDate = isLong ? c.peakDate : c.troughDate;
            turns.push({ date: bottomDate, type: 'BOTTOM', ticker: symbol, gain: c.gain, days: c.days, source: isLong ? 'long-trough' : 'inverse-peak' });
            turns.push({ date: topDate, type: 'TOP', ticker: symbol, gain: c.gain, days: c.days, source: isLong ? 'long-peak' : 'inverse-trough' });
        });
    });
    turns.sort(function(a, b) { return cvolDateMs(a.date) - cvolDateMs(b.date); });
    return turns;
}

function clusterT2pTurns(turns, windowDays) {
    var clusters = [];
    ['BOTTOM', 'TOP'].forEach(function(type) {
        var typed = turns.filter(function(t) { return t.type === type; }).sort(function(a, b) { return cvolDateMs(a.date) - cvolDateMs(b.date); });
        var current = null;
        function finishCluster() {
            if (!current || !current.turns.length) return;
            var dates = current.turns.map(function(t) { return t.date; }).sort();
            var tickMap = {};
            current.turns.forEach(function(t) { tickMap[t.ticker] = true; });
            var msAvg = current.turns.reduce(function(sum, t) { return sum + cvolDateMs(t.date); }, 0) / current.turns.length;
            var gains = current.turns.map(function(t) { return t.gain; }).filter(function(v) { return v != null && isFinite(v); });
            clusters.push({
                type: type,
                startDate: dates[0],
                endDate: dates[dates.length - 1],
                centerDate: cvolDateFromMs(msAvg),
                support: Object.keys(tickMap).length,
                tickers: Object.keys(tickMap).sort(),
                avgGain: gains.length ? gains.reduce(function(a, b) { return a + b; }, 0) / gains.length : null,
                maxGain: gains.length ? Math.max.apply(null, gains) : null,
                turns: current.turns.slice()
            });
        }
        typed.forEach(function(turn) {
            if (!current) { current = { turns: [turn], lastDate: turn.date }; return; }
            if (Math.abs(cvolDaysBetween(turn.date, current.lastDate)) <= (windowDays || CVOL_T2P_CLUSTER_DAYS)) {
                current.turns.push(turn);
                current.lastDate = turn.date > current.lastDate ? turn.date : current.lastDate;
            } else {
                finishCluster();
                current = { turns: [turn], lastDate: turn.date };
            }
        });
        finishCluster();
    });
    clusters.sort(function(a, b) { return cvolDateMs(a.centerDate) - cvolDateMs(b.centerDate); });
    return clusters;
}

function nearestT2pCluster(clusters, dateStr, type, maxDays) {
    var best = null, bestAbs = Infinity;
    clusters.forEach(function(c) {
        if (type && c.type !== type) return;
        var d = cvolDaysBetween(dateStr, c.centerDate);
        var a = Math.abs(d);
        if (maxDays != null && a > maxDays) return;
        if (a < bestAbs || (a === bestAbs && c.support > (best ? best.support : 0))) {
            bestAbs = a; best = c;
        }
    });
    return best ? Object.assign({ daysFromTurn: cvolDaysBetween(dateStr, best.centerDate) }, best) : null;
}

function buildT2pContext(data, t2pJson, threshold) {
    var expected = Object.keys(CVOL_LONG_T2P).length + Object.keys(CVOL_INVERSE_T2P).length;
    var empty = { turns: [], clusters: [], daily: [], latestDate: null, coverage: { available: 0, expected: expected }, dataHealth: null };
    if (!data || !data.length || !t2pJson || !t2pJson.tickers) return empty;

    var turns = buildT2pTurns(t2pJson, threshold || CVOL_T2P_THRESHOLD);
    var clusters = clusterT2pTurns(turns, CVOL_T2P_CLUSTER_DAYS);
    var tickerKeys = Object.keys(t2pJson.tickers || {});
    var latestDate = null;
    var allT2pDates = {};
    tickerKeys.forEach(function(k) {
        var d = t2pJson.tickers[k];
        if (!d || !d.dates || !d.dates.length) return;
        var last = d.dates[d.dates.length - 1];
        if (!latestDate || last > latestDate) latestDate = last;
        d.dates.forEach(function(dt) { allT2pDates[dt] = true; });
    });

    function phaseForDate(dateStr) {
        var nearBottom = nearestT2pCluster(clusters, dateStr, 'BOTTOM', CVOL_T2P_CLUSTER_DAYS);
        var nearTop = nearestT2pCluster(clusters, dateStr, 'TOP', CVOL_T2P_CLUSTER_DAYS);
        if (nearBottom && nearTop) {
            var chooseBottom = nearBottom.support > nearTop.support || (nearBottom.support === nearTop.support && Math.abs(nearBottom.daysFromTurn) <= Math.abs(nearTop.daysFromTurn));
            return { phase: chooseBottom ? 'TURN_BOTTOM' : 'TURN_TOP', nearBottom: nearBottom, nearTop: nearTop };
        }
        if (nearBottom) return { phase: 'TURN_BOTTOM', nearBottom: nearBottom, nearTop: nearTop };
        if (nearTop) return { phase: 'TURN_TOP', nearBottom: nearBottom, nearTop: nearTop };

        var prev = null, next = null;
        for (var i = 0; i < clusters.length; i++) {
            if (clusters[i].centerDate <= dateStr) prev = clusters[i];
            if (clusters[i].centerDate > dateStr) { next = clusters[i]; break; }
        }
        var phase = 'UNKNOWN', cyclePct = null;
        if (prev && next) {
            var span = Math.max(1, cvolDaysBetween(next.centerDate, prev.centerDate));
            cyclePct = cvolClamp(cvolDaysBetween(dateStr, prev.centerDate) / span, 0, 1);
            if (prev.type === 'BOTTOM' && next.type === 'TOP') phase = cyclePct <= 0.33 ? 'EARLY_RECOVERY' : (cyclePct <= 0.72 ? 'MID_CYCLE' : 'LATE_CYCLE');
            else if (prev.type === 'TOP' && next.type === 'BOTTOM') phase = 'DOWNTREND';
        } else if (prev) {
            var dSince = cvolDaysBetween(dateStr, prev.centerDate);
            if (prev.type === 'BOTTOM') phase = dSince <= 35 ? 'EARLY_RECOVERY' : dSince <= 120 ? 'MID_CYCLE' : 'LATE_CYCLE';
            else phase = 'DOWNTREND';
        }
        return { phase: phase, cyclePct: cyclePct, prevTurn: prev, nextTurn: next, nearBottom: nearBottom, nearTop: nearTop };
    }

    var daily = data.map(function(row) {
        var p = phaseForDate(row.date);
        var nearest = nearestT2pCluster(clusters, row.date, null, null);
        return {
            date: row.date,
            phase: p.phase,
            topSupport: p.nearTop ? p.nearTop.support : 0,
            bottomSupport: p.nearBottom ? p.nearBottom.support : 0,
            nearestTurn: nearest ? { type: nearest.type, centerDate: nearest.centerDate, support: nearest.support, tickers: nearest.tickers, daysFromTurn: nearest.daysFromTurn } : null,
            daysFromTurn: nearest ? nearest.daysFromTurn : null,
            prevTurn: p.prevTurn || null,
            nextTurn: p.nextTurn || null,
            cyclePct: p.cyclePct != null ? p.cyclePct : null,
        };
    });

    var recentCutoff = cvolAddDays(data[data.length - 1].date, -252);
    var missingCount = data.filter(function(r) { return r.date >= recentCutoff && !allT2pDates[r.date]; }).length;
    var available = tickerKeys.filter(function(k) { return !!(t2pJson.tickers[k] && t2pJson.tickers[k].dates && t2pJson.tickers[k].dates.length); }).length;
    return {
        turns: turns,
        clusters: clusters,
        daily: daily,
        latestDate: latestDate,
        coverage: { available: available, expected: expected },
        dataHealth: {
            latestCvolDate: data[data.length - 1].date,
            latestT2pDate: latestDate,
            missingDateCount: missingCount,
            staleDays: latestDate ? Math.max(0, cvolDaysBetween(data[data.length - 1].date, latestDate)) : null,
            coverage: { available: available, expected: expected },
            clusterCount: clusters.length
        }
    };
}

function addForwardReturnFields(data, idx, event) {
    var base = data[idx] ? data[idx].underlying : null;
    function fwd(days) {
        if (base == null || base === 0 || idx + days >= data.length || data[idx + days].underlying == null) return null;
        return (data[idx + days].underlying - base) / base * 100;
    }
    event.fwd5 = fwd(5);
    event.fwd10 = fwd(10);
    event.fwd21 = fwd(21);
    event.fwd42 = fwd(42);
    return event;
}

function buildRawCvolFires(data, series) {
    var n = data.length;
    var fires = [];
    var lastBySignal = {};
    function push(i, cand) {
        var key = normalizeSignalName(cand.signal);
        if (lastBySignal[key] != null && i - lastBySignal[key] < 10) return;
        lastBySignal[key] = i;
        var ev = {
            idx: i,
            date: data[i].date,
            signal: cand.signal,
            signalKey: key,
            direction: cand.direction,
            value: cand.value,
            composite: cand.composite,
            strength: cand.strength,
            underlying: data[i].underlying,
            ngvl: data[i].ngvl,
            skewRatio: data[i].skewRatio,
            convexity: data[i].convexity,
            atm: data[i].atm,
            season: getSeason(data[i].date),
        };
        fires.push(addForwardReturnFields(data, i, ev));
    }
    for (var i = 63; i < n; i++) {
        if (series.rdsZ[i] != null && series.rdsZ[i] > 1.8) push(i, { signal: 'RDS', value: series.rds[i], composite: series.rdsZ[i], direction: series.skewRatioRoc5[i] > 0 ? 'UPSIDE SETUP' : 'DOWNSIDE SETUP', strength: series.rdsZ[i] / 1.8 });
        if (series.sadZ[i] != null && Math.abs(series.sadZ[i]) > 1.5) push(i, { signal: 'SAD', value: series.sad[i], composite: series.sadZ[i], direction: series.sadZ[i] > 0 ? 'UPSIDE SKEW' : 'DOWNSIDE SKEW', strength: Math.abs(series.sadZ[i]) / 1.5 });
        if (series.ci[i] != null && series.ci[i] > 82) push(i, { signal: 'CI', value: series.ci[i], composite: series.ci[i], direction: 'FRAGILE CALM', strength: series.ci[i] / 82 });
        if (series.cvcDown[i] != null && series.cvcDown[i] > 1.2) push(i, { signal: 'CVC\u2193', value: series.cvcDown[i], composite: series.cvcDown[i], direction: 'TOP INPUT', strength: series.cvcDown[i] / 1.2 });
        if (series.cvcUp[i] != null && series.cvcUp[i] > 1.2) push(i, { signal: 'CVC\u2191', value: series.cvcUp[i], composite: series.cvcUp[i], direction: 'BOTTOM INPUT', strength: series.cvcUp[i] / 1.2 });
    }
    return fires;
}

function rawBias(ev) {
    var key = normalizeSignalName(ev.signal || ev.signalKey);
    var dir = String(ev.direction || '').toUpperCase();
    if (key === 'CVC_DOWN' || dir.indexOf('TOP') >= 0 || dir.indexOf('DOWNSIDE') >= 0) return 'TOP';
    if (key === 'CVC_UP' || dir.indexOf('BOTTOM') >= 0 || dir.indexOf('UPSIDE') >= 0) return 'BOTTOM';
    return 'EXPANSION';
}

function isBottomPhase(phase) { return phase === 'TURN_BOTTOM' || phase === 'EARLY_RECOVERY'; }
function isTopPhase(phase) { return phase === 'TURN_TOP' || phase === 'LATE_CYCLE' || phase === 'DOWNTREND'; }

function scoreDecisionDay(data, comp, t2pContext, i) {
    var ctx = t2pContext && t2pContext.daily ? t2pContext.daily[i] : null;
    var phase = ctx ? ctx.phase : 'UNKNOWN';
    var topScore = 0, bottomScore = 0, expansionScore = 0, conflictScore = 0;
    var reasons = [], contradictions = [], flags = [];
    function reason(text) { if (text && reasons.length < 5) reasons.push(text); }
    function contradict(text) { if (text) { contradictions.push(text); if (flags.indexOf('CONTRADICTION') < 0) flags.push('CONTRADICTION'); } }

    if (ctx) {
        if (phase === 'TURN_BOTTOM' && ctx.bottomSupport >= 2) { bottomScore += 1.75 + Math.min(1.2, ctx.bottomSupport * 0.2); reason('T2P bottom cluster has ' + ctx.bottomSupport + ' ETF confirmations'); }
        else if (phase === 'TURN_TOP' && ctx.topSupport >= 2) { topScore += 1.75 + Math.min(1.2, ctx.topSupport * 0.2); reason('T2P top cluster has ' + ctx.topSupport + ' ETF confirmations'); }
        else if (phase === 'EARLY_RECOVERY') { bottomScore += 1.1; reason('T2P phase is early recovery'); }
        else if (phase === 'LATE_CYCLE') { topScore += 1.1; reason('T2P phase is late-cycle'); }
        else if (phase === 'DOWNTREND') { topScore += 0.7; reason('T2P phase is post-top/downtrend'); }
    }

    var cvcDn = comp.cvcDown ? comp.cvcDown[i] : null;
    var cvcUp = comp.cvcUp ? comp.cvcUp[i] : null;
    var cvcDnOn = cvcDn != null && cvcDn > 1.2;
    var cvcUpOn = cvcUp != null && cvcUp > 1.2;
    if (cvcDnOn && cvcUpOn) {
        conflictScore += 2.4; expansionScore += 0.7; flags.push('CVC_BOTH_SIDES'); reason('CVC up and down both fired; surface is two-sided');
    } else if (cvcUpOn) {
        bottomScore += cvcUp > 1.7 ? 1.7 : 1.25;
        if (isTopPhase(phase)) { conflictScore += 1.2; contradict('CVC up opposes top/downtrend phase'); }
        else reason('CVC up confirms upside variance demand');
    } else if (cvcDnOn) {
        topScore += cvcDn > 1.7 ? 1.7 : 1.25;
        if (isBottomPhase(phase)) { conflictScore += 1.2; contradict('CVC down opposes bottom/recovery phase'); }
        else reason('CVC down confirms downside variance demand');
    }

    var nearbyRawFires = (comp.rawFires || []).filter(function(ev) { return Math.abs(ev.idx - i) <= 3; });
    if (!cvcUpOn && isBottomPhase(phase) && nearbyRawFires.some(function(ev) { return normalizeSignalName(ev.signal) === 'CVC_UP'; })) {
        bottomScore += 0.7;
        reason('Nearby CVC up supports the bottom window');
    }
    if (!cvcDnOn && isTopPhase(phase) && nearbyRawFires.some(function(ev) { return normalizeSignalName(ev.signal) === 'CVC_DOWN'; })) {
        topScore += 0.7;
        reason('Nearby CVC down supports the top window');
    }

    var sadZ = comp.sadZ ? comp.sadZ[i] : null;
    if (sadZ != null && Math.abs(sadZ) > 1.5) {
        if (sadZ > 0) {
            if (isBottomPhase(phase)) { bottomScore += 0.95; reason('SAD positive skew aligns with recovery'); }
            else if (isTopPhase(phase)) { topScore += 0.75; expansionScore += 0.35; reason('SAD positive skew looks like late-cycle chase/exhaustion'); }
            else { expansionScore += 0.75; reason('SAD shows unusual skew/ATM divergence'); }
        } else {
            if (isTopPhase(phase)) { topScore += 0.95; reason('SAD downside skew aligns with top/downtrend'); }
            else if (isBottomPhase(phase)) { conflictScore += 0.8; topScore += 0.35; contradict('SAD downside skew fights recovery phase'); }
            else { expansionScore += 0.7; reason('SAD downside skew warns of directional repricing'); }
        }
    }

    var rdsZ = comp.rdsZ ? comp.rdsZ[i] : null;
    var skewMom = comp.skewRatioRoc5 ? comp.skewRatioRoc5[i] : null;
    if (rdsZ != null && rdsZ > 1.8) {
        expansionScore += rdsZ > 2.4 ? 1.8 : 1.35;
        var rdsBias = skewMom != null && skewMom < 0 ? 'TOP' : 'BOTTOM';
        if (rdsBias === 'BOTTOM') { if (isTopPhase(phase)) { conflictScore += 0.9; contradict('RDS upside impulse fights T2P top/downtrend phase'); } else bottomScore += 0.55; }
        else { if (isBottomPhase(phase)) { conflictScore += 0.9; contradict('RDS downside impulse fights T2P bottom/recovery phase'); } else topScore += 0.55; }
        reason('RDS flags vol-surface expansion risk');
    }

    var ciVal = comp.ci ? comp.ci[i] : null;
    if (ciVal != null && ciVal > 82) {
        expansionScore += 1.05;
        if (isBottomPhase(phase)) bottomScore += 0.45;
        else if (isTopPhase(phase)) topScore += 0.35;
        reason('CI says calm is fragile, not a standalone direction');
    }

    var pct252 = comp.ngvlPct252 ? comp.ngvlPct252[i] : null;
    if (pct252 != null) {
        if (pct252 >= 90) {
            if (isBottomPhase(phase)) { bottomScore += 0.65; reason('Extreme NGVL supports capitulation/recovery context'); }
            else if (isTopPhase(phase)) { topScore += 0.75; reason('Extreme NGVL supports exhaustion context'); }
            else expansionScore += 0.6;
        } else if (pct252 <= 25) {
            expansionScore += 0.45;
            if (isBottomPhase(phase)) bottomScore += 0.35;
        }
    }

    var vrpVal = comp.vrp ? comp.vrp[i] : null;
    var vrpZ = comp.vrpZ21 ? comp.vrpZ21[i] : null;
    if ((vrpZ != null && vrpZ < -1.2) || (vrpVal != null && vrpVal < -5)) {
        expansionScore += 0.55;
        if (isBottomPhase(phase)) bottomScore += 0.35;
        reason('VRP is cheap/negative; market may be underpricing movement');
    } else if ((vrpZ != null && vrpZ > 1.5) || (vrpVal != null && vrpVal > 12)) {
        if (isTopPhase(phase)) topScore += 0.45;
        reason('VRP is rich; watch exhaustion instead of chasing');
    }

    if (ctx && ctx.nearestTurn && Math.abs(ctx.daysFromTurn) <= CVOL_T2P_CLUSTER_DAYS) {
        if (ctx.nearestTurn.type === 'BOTTOM' && topScore > bottomScore + 0.7) { conflictScore += 1.2; contradict('CVOL top pressure fights nearby T2P bottom'); }
        if (ctx.nearestTurn.type === 'TOP' && bottomScore > topScore + 0.7) { conflictScore += 1.2; contradict('CVOL bottom pressure fights nearby T2P top'); }
    }

    var maxScore = Math.max(topScore, bottomScore);
    var type = 'NO_EDGE';
    if (conflictScore >= 2 || (topScore >= 2.4 && bottomScore >= 2.4 && Math.abs(topScore - bottomScore) < 1.0)) type = 'CONFLICT';
    else if (bottomScore >= 3.2 && bottomScore - topScore >= 0.75) type = 'BOTTOM';
    else if (topScore >= 3.2 && topScore - bottomScore >= 0.75) type = 'TOP';
    else if (maxScore >= 2.5 && expansionScore >= 0.7) type = isTopPhase(phase) ? 'EXHAUSTION' : 'EXPANSION';
    else if (expansionScore >= 1.8) type = 'EXPANSION';
    if (type === 'NO_EDGE') reason('No aligned T2P/CVOL edge; stand down');
    if (type === 'CONFLICT' && contradictions.length) reason(contradictions[0]);

    var conviction = 'LOW';
    var decisionScore = Math.max(maxScore, expansionScore) - Math.min(1.5, conflictScore * 0.35);
    if (type === 'CONFLICT') conviction = conflictScore >= 2.4 ? 'HIGH' : 'MODERATE';
    else if (decisionScore >= 4.6 && conflictScore < 1.2) conviction = 'HIGH';
    else if (decisionScore >= 3.1) conviction = 'MODERATE';

    return {
        idx: i, date: data[i].date, signal: type, direction: decisionAction(type), classification: type, action: decisionAction(type), conviction: conviction,
        phase: phase, horizon: type === 'EXPANSION' ? '5-21D' : (type === 'NO_EDGE' ? 'WAIT' : '2-10D'),
        topScore: topScore, bottomScore: bottomScore, expansionRisk: expansionScore, conflictScore: conflictScore,
        flags: flags, reasons: reasons.slice(0, 5), contradictions: contradictions,
        nearestTurn: ctx ? ctx.nearestTurn : null, daysFromTurn: ctx ? ctx.daysFromTurn : null,
        topSupport: ctx ? ctx.topSupport : 0, bottomSupport: ctx ? ctx.bottomSupport : 0,
        underlying: data[i].underlying, ngvl: data[i].ngvl,
    };
}

function buildDecisionEvents(data, daily) {
    var events = [];
    var lastByClass = {};
    daily.forEach(function(d) {
        if (!d || d.classification === 'NO_EDGE') return;
        var important = d.conviction !== 'LOW' || d.topSupport >= 2 || d.bottomSupport >= 2 || d.conflictScore >= 2;
        if (!important) return;
        var lastIdx = lastByClass[d.classification];
        if (lastIdx != null && d.idx - lastIdx < 7) {
            var lastEvent = events.length ? events[events.length - 1] : null;
            if (lastEvent && lastEvent.classification === d.classification) {
                var lastPower = Math.max(lastEvent.topScore || 0, lastEvent.bottomScore || 0, lastEvent.expansionRisk || 0);
                var curPower = Math.max(d.topScore || 0, d.bottomScore || 0, d.expansionRisk || 0);
                if (curPower > lastPower) events[events.length - 1] = addForwardReturnFields(data, d.idx, Object.assign({}, d));
            }
            return;
        }
        lastByClass[d.classification] = d.idx;
        events.push(addForwardReturnFields(data, d.idx, Object.assign({}, d, {
            signal: d.classification, direction: d.action, signalKey: d.classification,
            value: Math.max(d.topScore, d.bottomScore, d.expansionRisk), composite: Math.max(d.topScore, d.bottomScore, d.expansionRisk),
            season: getSeason(d.date),
        })));
    });
    return events;
}

function buildTurningPointReplay(data, comp, t2pContext) {
    if (!t2pContext || !t2pContext.clusters || !t2pContext.clusters.length) return [];
    var lastDate = data[data.length - 1].date;
    var cutoff = cvolAddDays(lastDate, -540);
    return t2pContext.clusters.filter(function(c) { return c.centerDate >= cutoff && c.centerDate <= lastDate; }).slice(-24).map(function(c) {
        var centerIdx = cvolFindNearestIndex(data, c.centerDate);
        var nearbyRaw = (comp.rawFires || comp.events || []).filter(function(ev) { return Math.abs(cvolDaysBetween(ev.date, c.centerDate)) <= 5; });
        var nearbyDecision = (comp.decisionEvents || []).filter(function(ev) { return Math.abs(cvolDaysBetween(ev.date, c.centerDate)) <= 7; });
        var aligned = nearbyDecision.filter(function(ev) { return ev.classification === c.type; });
        var wrong = nearbyDecision.filter(function(ev) { return ev.classification === (c.type === 'BOTTOM' ? 'TOP' : 'BOTTOM'); });
        var verdict = aligned.length && wrong.length ? 'MIXED' : aligned.length ? 'ALIGNED' : wrong.length ? 'WRONG' : 'MISSED';
        var leadLag = aligned.length ? cvolDaysBetween(aligned[0].date, c.centerDate) : null;
        var fwd21 = centerIdx >= 0 && centerIdx + 21 < data.length ? (data[centerIdx + 21].underlying - data[centerIdx].underlying) / data[centerIdx].underlying * 100 : null;
        var fwd42 = centerIdx >= 0 && centerIdx + 42 < data.length ? (data[centerIdx + 42].underlying - data[centerIdx].underlying) / data[centerIdx].underlying * 100 : null;
        return {
            window: c.startDate === c.endDate ? c.centerDate : c.startDate + ' to ' + c.endDate,
            centerDate: c.centerDate, type: c.type, support: c.support, tickers: c.tickers, avgGain: c.avgGain,
            cvSignals: nearbyRaw.map(function(ev) { return signalDisplayName(ev.signal) + ' ' + ev.date; }).slice(0, 5),
            decisionSignals: nearbyDecision.map(function(ev) { return ev.classification + ' ' + ev.date; }).slice(0, 5),
            leadLag: leadLag, verdict: verdict, fwd21: fwd21, fwd42: fwd42,
        };
    }).reverse();
}

function buildSignalQualityAudit(data, comp, t2pContext) {
    if (!t2pContext || !t2pContext.clusters || !t2pContext.clusters.length) return [];
    var clusters = t2pContext.clusters.filter(function(c) { return c.centerDate >= data[0].date && c.centerDate <= data[data.length - 1].date; });
    var topTurns = clusters.filter(function(c) { return c.type === 'TOP'; });
    var bottomTurns = clusters.filter(function(c) { return c.type === 'BOTTOM'; });
    var configs = [
        { label: 'SAD', events: (comp.rawFires || []).filter(function(e) { return normalizeSignalName(e.signal) === 'SAD'; }) },
        { label: 'CI', events: (comp.rawFires || []).filter(function(e) { return normalizeSignalName(e.signal) === 'CI'; }) },
        { label: 'CVC Down', events: (comp.rawFires || []).filter(function(e) { return normalizeSignalName(e.signal) === 'CVC_DOWN'; }) },
        { label: 'CVC Up', events: (comp.rawFires || []).filter(function(e) { return normalizeSignalName(e.signal) === 'CVC_UP'; }) },
        { label: 'RDS', events: (comp.rawFires || []).filter(function(e) { return normalizeSignalName(e.signal) === 'RDS'; }) },
        { label: 'Decision Layer', events: (comp.decisionEvents || []) }
    ];
    function turnHitRate(turns, events, type) {
        if (!turns.length) return null;
        var hits = 0, lags = [], regimes = {};
        turns.forEach(function(t) {
            var match = events.filter(function(ev) {
                var bias = ev.classification === 'TOP' || ev.classification === 'BOTTOM' ? ev.classification : rawBias(ev);
                return bias === type && Math.abs(cvolDaysBetween(ev.date, t.centerDate)) <= 5;
            }).sort(function(a, b) { return Math.abs(cvolDaysBetween(a.date, t.centerDate)) - Math.abs(cvolDaysBetween(b.date, t.centerDate)); })[0];
            if (match) {
                hits++;
                lags.push(cvolDaysBetween(match.date, t.centerDate));
                var ctx = t2pContext.daily ? t2pContext.daily[match.idx] : null;
                var phase = ctx ? ctx.phase : 'UNKNOWN';
                regimes[phase] = (regimes[phase] || 0) + 1;
            }
        });
        return { rate: hits / turns.length * 100, hits: hits, total: turns.length, lags: lags, regimes: regimes };
    }
    return configs.map(function(cfg) {
        var top = turnHitRate(topTurns, cfg.events, 'TOP');
        var bottom = turnHitRate(bottomTurns, cfg.events, 'BOTTOM');
        var falseCount = 0, wrongCount = 0, lagPool = [], regimePool = {};
        cfg.events.forEach(function(ev) {
            var bias = ev.classification === 'TOP' || ev.classification === 'BOTTOM' ? ev.classification : rawBias(ev);
            if (bias !== 'TOP' && bias !== 'BOTTOM') {
                if (!clusters.some(function(t) { return Math.abs(cvolDaysBetween(ev.date, t.centerDate)) <= 5; })) falseCount++;
                return;
            }
            var near = nearestT2pCluster(clusters, ev.date, null, 5);
            if (!near) falseCount++;
            else if (near.type !== bias) wrongCount++;
            else {
                lagPool.push(cvolDaysBetween(ev.date, near.centerDate));
                var ctx = t2pContext.daily ? t2pContext.daily[ev.idx] : null;
                var phase = ctx ? ctx.phase : 'UNKNOWN';
                regimePool[phase] = (regimePool[phase] || 0) + 1;
            }
        });
        var allLags = lagPool.concat(top && top.lags ? top.lags : [], bottom && bottom.lags ? bottom.lags : []);
        var bestRegime = Object.keys(regimePool).sort(function(a, b) { return regimePool[b] - regimePool[a]; })[0] || 'UNKNOWN';
        return {
            signal: cfg.label, count: cfg.events.length,
            topHitRate: top ? top.rate : null, topHits: top ? top.hits : 0, topTotal: top ? top.total : 0,
            bottomHitRate: bottom ? bottom.rate : null, bottomHits: bottom ? bottom.hits : 0, bottomTotal: bottom ? bottom.total : 0,
            falsePositiveRate: cfg.events.length ? falseCount / cfg.events.length * 100 : null,
            wrongSideRate: cfg.events.length ? wrongCount / cfg.events.length * 100 : null,
            avgLeadLag: allLags.length ? allLags.reduce(function(a, b) { return a + b; }, 0) / allLags.length : null,
            bestRegime: bestRegime.replace(/_/g, ' '),
        };
    });
}

const CVOL_KNOWN_WINDOWS = [
    { label: 'Dec 2024 reference top', start: '2024-12-05', end: '2024-12-10', expected: 'TOP', mismatchOk: true },
    { label: 'Jan 2025 T2P top', start: '2025-01-16', end: '2025-01-17', expected: 'TOP' },
    { label: 'Jan 2025 post-pop bottom', start: '2025-01-30', end: '2025-02-03', expected: 'BOTTOM' },
    { label: 'Mar 2025 structural top', start: '2025-03-07', end: '2025-03-12', expected: 'TOP', missOk: true },
    { label: 'Oct 2025 major bottom', start: '2025-10-14', end: '2025-10-17', expected: 'BOTTOM' },
];

function buildKnownWindowAudit(data, comp, t2pContext) {
    return CVOL_KNOWN_WINDOWS.map(function(w) {
        var s = cvolAddDays(w.start, -2), e = cvolAddDays(w.end, 2);
        var raw = (comp.rawFires || []).filter(function(ev) { return ev.date >= s && ev.date <= e; });
        var decisions = (comp.decisionEvents || []).filter(function(ev) { return ev.date >= s && ev.date <= e; });
        var daily = (comp.decisionDaily || []).filter(function(d) { return d.date >= w.start && d.date <= w.end; });
        var supportClusters = t2pContext && t2pContext.clusters ? t2pContext.clusters.filter(function(c) { return c.type === w.expected && c.centerDate >= s && c.centerDate <= e; }) : [];
        var opposite = w.expected === 'TOP' ? 'BOTTOM' : 'TOP';
        var aligned = decisions.some(function(d) { return d.classification === w.expected; }) || daily.some(function(d) { return d.classification === w.expected; });
        var wrong = decisions.some(function(d) { return d.classification === opposite; }) || daily.some(function(d) { return d.classification === opposite; });
        var verdict = 'NO_EDGE';
        if (w.mismatchOk && !supportClusters.length) verdict = 'REFERENCE_MISMATCH';
        else if (aligned && wrong) verdict = 'MIXED';
        else if (aligned) verdict = 'ALIGNED';
        else if (wrong) verdict = 'WRONG';
        else verdict = w.missOk ? 'MISS_NO_EDGE' : 'MISSED';
        var dailySignals = daily.filter(function(d) { return d.classification !== 'NO_EDGE'; }).map(function(d) { return d.classification + ' ' + d.date; });
        var decisionSignals = decisions.map(function(d) { return d.classification + ' ' + d.date; }).concat(dailySignals)
            .filter(function(v, i, a) { return a.indexOf(v) === i; });
        return {
            label: w.label, window: w.start + ' to ' + w.end, expected: w.expected, verdict: verdict,
            t2pSupport: supportClusters.length ? Math.max.apply(null, supportClusters.map(function(c) { return c.support; })) : 0,
            decisionSignals: decisionSignals,
            rawSignals: raw.map(function(r) { return signalDisplayName(r.signal) + ' ' + r.date; }),
            notes: verdict === 'REFERENCE_MISMATCH' ? 'T2P source does not confirm this as a top window; do not force a CVOL verdict.' : (verdict === 'MISS_NO_EDGE' ? 'Known reference window remains a miss/no-edge in this model.' : '')
        };
    });
}

function computeCvolDecisionLayer(data, comp, t2pContext) {
    var daily = data.map(function(_, i) { return scoreDecisionDay(data, comp, t2pContext, i); });
    var decisionEvents = buildDecisionEvents(data, daily);
    comp.decisionDaily = daily;
    comp.decisionEvents = decisionEvents;
    comp.currentDecision = daily[daily.length - 1] || null;
    comp.turningPointReplay = buildTurningPointReplay(data, comp, t2pContext);
    comp.signalQualityAudit = buildSignalQualityAudit(data, comp, t2pContext);
    comp.knownWindowAudit = buildKnownWindowAudit(data, comp, t2pContext);
    comp.dataHealth = t2pContext ? t2pContext.dataHealth : null;
    return comp;
}

function applyT2pDecisionLayer(data, comp, t2pJson) {
    var t2pContext = buildT2pContext(data, t2pJson, CVOL_T2P_THRESHOLD);
    CvolState.t2pContext = t2pContext;
    computeCvolDecisionLayer(data, comp, t2pContext);
    CvolState.decisionState = {
        daily: comp.decisionDaily,
        events: comp.decisionEvents,
        replay: comp.turningPointReplay,
        quality: comp.signalQualityAudit,
        knownWindows: comp.knownWindowAudit,
        health: comp.dataHealth
    };
    return comp;
}

function computeComposites(data) {
    const n = data.length;
    const ngvl = data.map(r => r.ngvl);
    const atm = data.map(r => r.atm);
    const skewRatio = data.map(r => r.skewRatio);
    const convexity = data.map(r => r.convexity);
    const dnVar = data.map(r => r.dnVar);
    const upVar = data.map(r => r.upVar);
    const underlying = data.map(r => r.underlying);

    // Percentiles
    const ngvlPct21 = rollingPercentile(ngvl, 21);
    const ngvlPct63 = rollingPercentile(ngvl, 63);
    const ngvlPct252 = rollingPercentile(ngvl, 252);
    const atmPct252 = rollingPercentile(atm, 252);
    const skewRatioPct63 = rollingPercentile(skewRatio, 63);
    const convPct63 = rollingPercentile(convexity, 63);

    // Z-scores
    const skewRatioZ21 = rollingZScore(skewRatio, 21);
    const dnVarZ21 = rollingZScore(dnVar, 21);
    const upVarZ21 = rollingZScore(upVar, 21);
    const atmZ21 = rollingZScore(atm, 21);
    const ngvlZ21 = rollingZScore(ngvl, 21);
    const convZ21 = rollingZScore(convexity, 21);

    // Medians
    const atmMed90 = rollingMedian(atm, 90);

    // Rate of change
    const skewRatioRoc5 = rateOfChange(skewRatio, 5);

    // ── Realized Vol (21D annualized) ──
    const realVol = new Array(n).fill(null);
    for (let i = 21; i < n; i++) {
        let sumSq = 0, cnt = 0;
        for (let j = i - 20; j <= i; j++) {
            if (underlying[j] != null && underlying[j-1] != null && underlying[j-1] > 0) {
                const lr = Math.log(underlying[j] / underlying[j-1]);
                sumSq += lr * lr;
                cnt++;
            }
        }
        if (cnt >= 15) realVol[i] = Math.sqrt(sumSq / (cnt - 1) * 252) * 100; // annualized %, Bessel-corrected
    }

    // ── Vol Risk Premium (VRP) = Implied - Realized ──
    const vrp = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (ngvl[i] != null && realVol[i] != null) vrp[i] = ngvl[i] - realVol[i];
    }
    const vrpZ21 = rollingZScore(vrp, 21);

    // ── Convexity Term Structure Proxy (5D avg / 63D avg NGVL) ──
    const ngvlAvg5 = rollingAvg(ngvl, 5);
    const ngvlAvg63 = rollingAvg(ngvl, 63);
    const termStructure = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (ngvlAvg5[i] != null && ngvlAvg63[i] != null && ngvlAvg63[i] > 0)
            termStructure[i] = ngvlAvg5[i] / ngvlAvg63[i];
    }

    // ── Vol-of-Vol (VoV): 21D rolling std of NGVL ──
    const vov = new Array(n).fill(null);
    for (let i = 20; i < n; i++) {
        let sum = 0, cnt = 0;
        for (let j = i - 20; j <= i; j++) { if (ngvl[j] != null) { sum += ngvl[j]; cnt++; } }
        if (cnt >= 15) {
            const avg = sum / cnt;
            let ss = 0;
            for (let j = i - 20; j <= i; j++) { if (ngvl[j] != null) ss += (ngvl[j] - avg) * (ngvl[j] - avg); }
            vov[i] = Math.sqrt(ss / cnt);
        }
    }

    // ── SAD (Skew-ATM Divergence) ──
    const sad = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (skewRatio[i] != null && atm[i] != null && atmMed90[i] != null && atmMed90[i] > 0) {
            sad[i] = skewRatio[i] - (atm[i] / atmMed90[i]);
        }
    }

    // ── CI (Complacency Index) ──
    const ci = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (atmPct252[i] != null) ci[i] = 100 - atmPct252[i];
    }

    // ── CVC (Convexity-Variance Confirmation) ──
    const cvcDown = new Array(n).fill(null);
    const cvcUp = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (convPct63[i] != null && dnVarZ21[i] != null) {
            cvcDown[i] = (convPct63[i] / 100) * Math.max(0, dnVarZ21[i]);
        }
        if (convPct63[i] != null && upVarZ21[i] != null) {
            cvcUp[i] = (convPct63[i] / 100) * Math.max(0, upVarZ21[i]);
        }
    }

    // ── RDS (Regime Divergence Score) ──
    const rds = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (skewRatioRoc5[i] != null && convexity[i] != null && atmPct252[i] != null) {
            rds[i] = Math.abs(skewRatioRoc5[i]) * convexity[i] * (1 - atmPct252[i] / 100);
        }
    }

    // ── Signal Events (strength-based selection) ──
    const sadZ = rollingZScore(sad, 63);
    const rdsZ = rollingZScore(rds, 63);
    const events = [];
    for (let i = 63; i < n; i++) {
        // Evaluate ALL signals independently, pick strongest per day
        const candidates = [];

        // RDS spike: z > 1.8
        if (rdsZ[i] != null && rdsZ[i] > 1.8) {
            candidates.push({ signal: 'RDS', value: rds[i], composite: rdsZ[i],
                direction: skewRatioRoc5[i] > 0 ? 'UPSIDE SETUP' : 'DOWNSIDE SETUP',
                strength: rdsZ[i] / 1.8 });
        }
        // SAD divergence: |z| > 1.5
        if (sadZ[i] != null && Math.abs(sadZ[i]) > 1.5) {
            candidates.push({ signal: 'SAD', value: sad[i], composite: sadZ[i],
                direction: sadZ[i] > 0 ? 'UPSIDE SKEW' : 'DOWNSIDE SKEW',
                strength: Math.abs(sadZ[i]) / 1.5 });
        }
        // CI extreme: > 82
        if (ci[i] != null && ci[i] > 82) {
            candidates.push({ signal: 'CI', value: ci[i], composite: ci[i],
                direction: 'COMPLACENCY',
                strength: ci[i] / 82 });
        }
        // CVC Down: > 1.2
        if (cvcDown[i] != null && cvcDown[i] > 1.2) {
            candidates.push({ signal: 'CVC↓', value: cvcDown[i], composite: cvcDown[i],
                direction: 'TOP SIGNAL',
                strength: cvcDown[i] / 1.2 });
        }
        // CVC Up: > 1.2
        if (cvcUp[i] != null && cvcUp[i] > 1.2) {
            candidates.push({ signal: 'CVC↑', value: cvcUp[i], composite: cvcUp[i],
                direction: 'BOTTOM SIGNAL',
                strength: cvcUp[i] / 1.2 });
        }

        // Sort by strength descending, emit strongest that passes dedup
        candidates.sort((a, b) => b.strength - a.strength);
        for (const cand of candidates) {
            const recent = events.filter(e => e.signal === cand.signal && i - e.idx < 10);
            if (recent.length > 0) continue;
            const fwd5  = i +  5 < n ? ((underlying[i +  5] - underlying[i]) / underlying[i] * 100) : null;
            const fwd10 = i + 10 < n ? ((underlying[i + 10] - underlying[i]) / underlying[i] * 100) : null;
            const fwd21 = i + 21 < n ? ((underlying[i + 21] - underlying[i]) / underlying[i] * 100) : null;
            const fwd42 = i + 42 < n ? ((underlying[i + 42] - underlying[i]) / underlying[i] * 100) : null;
            events.push({
                idx: i, date: data[i].date,
                signal: cand.signal, direction: cand.direction,
                value: cand.value, composite: cand.composite,
                underlying: underlying[i],
                ngvl: ngvl[i], skewRatio: skewRatio[i], convexity: convexity[i], atm: atm[i],
                fwd5, fwd10, fwd21, fwd42,
                season: getSeason(data[i].date),
            });
            break; // strongest signal wins for this day
        }
    }

    const rawFires = buildRawCvolFires(data, {
        rds, rdsZ, sad, sadZ, ci, cvcDown, cvcUp, skewRatioRoc5
    });
    events.length = 0;
    rawFires.forEach(ev => events.push(ev));

    return {
        ngvlPct21, ngvlPct63, ngvlPct252, atmPct252, skewRatioPct63, convPct63,
        skewRatioZ21, dnVarZ21, upVarZ21, atmZ21, ngvlZ21, convZ21,
        skewRatioRoc5, atmMed90,
        sad, ci, cvcDown, cvcUp, rds,
        sadZ, rdsZ,
        realVol, vrp, vrpZ21, termStructure, vov,
        events, rawFires,
    };
}

function getSeason(dateStr) {
    const m = parseInt(dateStr.split('-')[1]);
    if (m >= 11 || m <= 2) return 'winter';
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    return 'fall';
}

// ── Regime Classification ─────────────────────────────────────
function ngvlRegime(pct) {
    if (pct == null) return { label: '--', cls: 'cvol-reg-unknown', color: '#666' };
    if (pct >= 90) return { label: 'EXTREME', cls: 'cvol-reg-extreme', color: '#c04040' };
    if (pct >= 75) return { label: 'ELEVATED', cls: 'cvol-reg-elevated', color: '#c07828' };
    if (pct >= 25) return { label: 'NORMAL', cls: 'cvol-reg-normal', color: '#3db87a' };
    return { label: 'LOW', cls: 'cvol-reg-low', color: '#4a80b8' };
}

// ── Format Helpers ────────────────────────────────────────────
function fmt(n, d = 1) { return n != null && isFinite(n) ? n.toFixed(d) : '—'; }
function fmtPct(n) { return n != null && isFinite(n) ? n.toFixed(0) + 'th' : '—'; }
function fmtSign(n, d = 1) { return n != null && isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(d) + '%' : '—'; }

const SEASON_CFG = {
    winter: { emoji: '❄', color: '#60a8f8' },
    spring: { emoji: '✿', color: '#6ddc8b' },
    summer: { emoji: '☀', color: '#f5c542' },
    fall:   { emoji: '◈', color: '#f5a742' },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(d) {
    const [y, m, dd] = d.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + dd + ', ' + y;
}

// ── Series Config ─────────────────────────────────────────────
const SERIES_CFG = {
    ngvl:       { label: 'NGVL',       color: '#00e5ff', axis: 'left',  unit: '%',   key: 'ngvl' },
    atm:        { label: 'ATM',        color: '#8b5cf6', axis: 'left',  unit: '%',   key: 'atm' },
    upVar:      { label: 'UP VAR',     color: '#3db87a', axis: 'left',  unit: '%',   key: 'upVar' },
    dnVar:      { label: 'DOWN VAR',   color: '#ef4444', axis: 'left',  unit: '%',   key: 'dnVar' },
    realVol:    { label: 'REALIZED',   color: '#a78bfa', axis: 'left',  unit: '%',   key: 'realVol', dashed: true },
    skewRatio:  { label: 'SKEW RATIO', color: '#f59e0b', axis: 'right2',unit: 'x',   key: 'skewRatio' },
    convexity:  { label: 'CONVEXITY',  color: '#ec4899', axis: 'right2',unit: 'x',   key: 'convexity' },
    underlying: { label: 'NG PRICE',   color: '#94a3b8', axis: 'right', unit: '$',   key: 'underlying' },
    skew:       { label: 'SKEW (pts)', color: '#a78bfa', axis: 'left',  unit: 'pts', key: 'skew' },
};

const VAR_SERIES_CFG = {
    upVar:     { label: 'UP VAR',     color: '#3db87a', key: 'upVar',  desc: 'Bullish Demand Check: Measures the premium paid for upside protection (OTM calls). Rising green area signals aggressive institutional buying often seen before explosive short-gamma breakouts.' },
    dnVar:     { label: 'DN VAR',     color: '#ef4444', key: 'dnVar',  desc: 'Bearish Fear Check: Tracks the cost of downside tail-risk insurance. When the red area expands, the market is bracing for a violent gap-down or capitulation event.' },
    skewRatio: { label: 'SKEW RATIO', color: '#f59e0b', key: 'skewRatio', desc: 'Directional Pressure Gauge: The ratio of Bear Fear (Puts) vs. Bull Greed (Calls). >1.0 means downside protection is expensive; <1.0 means the market is foaming for upside.' },
    underlying:{ label: 'NG PRICE',   color: '#94a3b8', key: 'underlying', desc: 'Price Correlation Context: Overlays the absolute front-month Natural Gas settlement price. Vital for identifying if directional volatility spikes are leading or lagging absolute price pivots.' },
    skewRoc5:  { label: 'SKEW MOM',   color: '#818cf8', key: 'skewRoc5', desc: 'Skew Momentum (5D ROC): Rate of change in skew ratio over 5 sessions. Positive = skew accelerating bullish. Negative = skew accelerating bearish. Sharp moves precede directional breakouts.' },
};

// ── X-Axis engine (reused from flows.html pattern) ────────────
function drawXAxis(ctx, dates, getX, chartW, yBase, pad) {
    const months = MONTHS;
    const count = dates.length;
    if (count < 2) return;
    let ticks = [];
    let isYearMode = false;
    if (count <= 14) {
        for (let i = 0; i < count; i++) ticks.push(i);
    } else if (count <= 65) {
        ticks.push(0); ticks.push(count - 1);
        for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 10))) {
            if (i !== 0 && i !== count - 1) ticks.push(i);
        }
    } else {
        const monthsRange = (new Date(dates[count - 1]) - new Date(dates[0])) / (30 * 86400000);
        if (monthsRange > 36) {
            isYearMode = true;
            const maxYL = Math.floor(chartW / 120);
            const yInt = [1, 2, 3, 5, 10].find(c => c >= Math.max(1, Math.round(monthsRange / 12 / maxYL))) || 1;
            const sy = new Date(dates[0]).getFullYear(), ey = new Date(dates[count - 1]).getFullYear();
            for (let yr = Math.ceil(sy / yInt) * yInt; yr <= ey; yr += yInt) {
                const target = `${yr}-01-01`;
                for (let i = 0; i < count; i++) { if (dates[i] >= target) { if (i !== 0 && i !== count - 1) ticks.push(i); break; } }
            }
        } else {
            ticks.push(0); ticks.push(count - 1);
            const maxL = Math.floor(chartW / 120);
            const mInt = [1, 2, 3, 6, 12].find(c => c >= Math.max(1, Math.round(monthsRange / maxL))) || 1;
            let lastMT = -1;
            dates.forEach((d, i) => {
                const [y, m] = d.split('-').map(Number);
                const mt = y * 12 + m;
                if (mt !== lastMT && (lastMT === -1 || mt - lastMT >= mInt)) {
                    if (i !== 0 && i !== count - 1) ticks.push(i);
                    lastMT = mt;
                }
            });
        }
    }
    ticks = [...new Set(ticks)].sort((a, b) => a - b);
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    let lastLX = -1;
    ticks.forEach(idx => {
        if (!dates[idx]) return;
        const [y, m, day] = dates[idx].split('-').map(Number);
        const x = getX(idx);
        if (x < pad.left + 15 || x > pad.left + chartW - 15) return;
        if (lastLX > -1 && Math.abs(x - lastLX) < 45) return;
        let txt;
        if (count <= 14) txt = months[m - 1] + ' ' + day;
        else if (isYearMode) txt = String(y);
        else txt = months[m - 1] + (count > 365 ? ' ' + y : '');
        ctx.fillText(txt, x, yBase);
        lastLX = x;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + (yBase - pad.top - 15));
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.setLineDash([]); ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.setLineDash([]);
}

// ── toRgba helper ─────────────────────────────────────────────
function toRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

// ── Composite Meta (for expanded cards) ───────────────────────
var COMP_META = {
    sad:     { label: 'SAD - Skew-ATM Divergence', color: '#f59e0b', desc: 'Input, not a trade by itself. SAD measures skew ratio relative to the ATM-vol baseline. It is useful when T2P phase says a turn is near, and noisy when used as standalone direction.', threshold: null, thresholdType: 'z', thresholdVal: 1.5 },
    ci:      { label: 'CI - Complacency Index', color: '#60a8f8', desc: 'Fragile-calm warning. CI means ATM vol is suppressed versus its own 1-year range; it flags expansion risk, not an automatic long signal.', threshold: 82, thresholdType: 'raw', thresholdVal: 82 },
    cvcDown: { label: 'CVC Down - Convexity-Variance', color: '#ef4444', desc: 'Top-side input. High convexity plus downside variance can confirm a top only when it agrees with T2P phase or other CVOL warnings. Against a bottom phase it is conflict, not a forced short.', threshold: 1.2, thresholdType: 'raw', thresholdVal: 1.2 },
    cvcUp:   { label: 'CVC Up - Convexity-Variance', color: '#3db87a', desc: 'Bottom-side input. High convexity plus upside variance can confirm recovery only when cycle phase supports it. Against a top phase it is conflict, not a forced long.', threshold: 1.2, thresholdType: 'raw', thresholdVal: 1.2 },
    rds:     { label: 'RDS - Regime Divergence Score', color: '#ec4899', desc: 'Expansion warning. RDS combines skew momentum, convexity, and low ATM ranking. It is strongest as a volatility-regime alert; direction comes from T2P alignment.', threshold: null, thresholdType: 'z', thresholdVal: 1.8 },
};

// ── Correlation Matrix ────────────────────────────────────────
var CORR_KEYS = ['ngvl','dnVar','upVar','skew','skewRatio','atm','convexity','underlying'];
var CORR_LABELS = ['NGVL','DN VAR','UP VAR','SKEW','SK RATIO','ATM','CONV','NG $'];

function computeCorrelation(xArr, yArr) {
    var n = 0, sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (var i = 0; i < xArr.length; i++) {
        if (xArr[i] == null || yArr[i] == null) continue;
        n++; sx += xArr[i]; sy += yArr[i]; sxy += xArr[i] * yArr[i];
        sx2 += xArr[i] * xArr[i]; sy2 += yArr[i] * yArr[i];
    }
    if (n < 10) return null;
    var num = n * sxy - sx * sy;
    var den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
    return den > 0 ? num / den : 0;
}

function computeCorrMatrix(data, startIdx, endIdx) {
    var sliced = data;
    if (startIdx != null && endIdx != null) sliced = data.slice(startIdx, endIdx + 1);
    var cols = {};
    CORR_KEYS.forEach(function(k) { cols[k] = sliced.map(function(r) { return r[k]; }); });
    var matrix = [];
    for (var i = 0; i < CORR_KEYS.length; i++) {
        var row = [];
        for (var j = 0; j < CORR_KEYS.length; j++) {
            row.push(i === j ? 1.0 : computeCorrelation(cols[CORR_KEYS[i]], cols[CORR_KEYS[j]]));
        }
        matrix.push(row);
    }
    return matrix;
}

// ── Event Confluence Scoring ──────────────────────────────────
function computeEventConfluence(events) {
    var confMap = {};
    for (var i = 0; i < events.length; i++) {
        var count = 0;
        for (var j = 0; j < events.length; j++) {
            if (i === j || events[j].signal === events[i].signal) continue;
            if (Math.abs(events[j].idx - events[i].idx) <= 5) count++;
        }
        confMap[events[i].idx] = count;
    }
    return confMap;
}

// ── Backtest Scorecard ────────────────────────────────────────
function computeScorecard(composites, regimeFilter) {
    var events = composites.events || [];
    var pct252 = composites.ngvlPct252 || [];
    // Apply regime filter
    if (regimeFilter && regimeFilter !== 'all') {
        events = events.filter(function(ev) {
            var p = pct252[ev.idx];
            if (p == null) return false;
            if (regimeFilter === 'low') return p < 25;
            if (regimeFilter === 'normal') return p >= 25 && p < 75;
            if (regimeFilter === 'high') return p >= 75;
            return true;
        });
    }
    var signals = {};
    events.forEach(function(ev) {
        var key = ev.signal.replace('↓','Down').replace('↑','Up');
        if (!signals[key]) signals[key] = { count: 0, hit5: 0, hit10: 0, hit21: 0, hit42: 0, ret5: [], ret10: [], ret21: [], ret42: [], name: ev.signal, seasonHit: {} };
        signals[key].count++;
        var isDown = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
        var dir = isDown ? -1 : 1; // direction multiplier: makes all ret arrays signal-P&L (positive = signal was right)
        if (ev.fwd5  != null) { signals[key].ret5.push(ev.fwd5  * dir); if ((isDown && ev.fwd5  < 0) || (!isDown && ev.fwd5  > 0)) signals[key].hit5++; }
        if (ev.fwd10 != null) { signals[key].ret10.push(ev.fwd10 * dir); if ((isDown && ev.fwd10 < 0) || (!isDown && ev.fwd10 > 0)) signals[key].hit10++; }
        if (ev.fwd21 != null) {
            signals[key].ret21.push(ev.fwd21 * dir);
            var hit21 = (isDown && ev.fwd21 < 0) || (!isDown && ev.fwd21 > 0);
            if (hit21) signals[key].hit21++;
            var ssn = ev.season || 'unknown';
            if (!signals[key].seasonHit[ssn]) signals[key].seasonHit[ssn] = { hits: 0, total: 0 };
            signals[key].seasonHit[ssn].total++;
            if (hit21) signals[key].seasonHit[ssn].hits++;
        }
        if (ev.fwd42 != null) { signals[key].ret42.push(ev.fwd42 * dir); if ((isDown && ev.fwd42 < 0) || (!isDown && ev.fwd42 > 0)) signals[key].hit42++; }
    });
    // helper: sharpe from a return array
    function calcSharpe(arr) {
        if (arr.length < 3) return null;
        var mean = arr.reduce(function(a,b){return a+b;},0) / arr.length;
        var std = Math.sqrt(arr.reduce(function(a,b){return a+(b-mean)*(b-mean);},0) / arr.length);
        return std > 0 ? mean / std : null;
    }
    var rows = [];
    Object.keys(signals).forEach(function(key) {
        var s = signals[key];
        var avg5  = s.ret5.length  ? s.ret5.reduce(function(a,b){return a+b;},0)  / s.ret5.length  : null;
        var avg10 = s.ret10.length ? s.ret10.reduce(function(a,b){return a+b;},0) / s.ret10.length : null;
        var avg21 = s.ret21.length ? s.ret21.reduce(function(a,b){return a+b;},0) / s.ret21.length : null;
        var avg42 = s.ret42.length ? s.ret42.reduce(function(a,b){return a+b;},0) / s.ret42.length : null;
        var sharpe5  = calcSharpe(s.ret5);
        var sharpe10 = calcSharpe(s.ret10);
        var sharpe21 = calcSharpe(s.ret21);
        var sharpe42 = calcSharpe(s.ret42);
        // Optimal horizon: horizon with best absolute Sharpe (needs ≥3 samples)
        var horizons = [
            { label: '5D',  sharpe: sharpe5,  hr: s.ret5.length  > 0 ? s.hit5  / s.ret5.length  * 100 : null, avg: avg5,  n: s.ret5.length  },
            { label: '10D', sharpe: sharpe10, hr: s.ret10.length > 0 ? s.hit10 / s.ret10.length * 100 : null, avg: avg10, n: s.ret10.length },
            { label: '21D', sharpe: sharpe21, hr: s.ret21.length > 0 ? s.hit21 / s.ret21.length * 100 : null, avg: avg21, n: s.ret21.length },
            { label: '42D', sharpe: sharpe42, hr: s.ret42.length > 0 ? s.hit42 / s.ret42.length * 100 : null, avg: avg42, n: s.ret42.length },
        ];
        var optHorizon = horizons.reduce(function(best, h) {
            if (h.sharpe == null || h.sharpe <= 0 || h.n < 5) return best;
            if (best == null || h.sharpe > best.sharpe) return h;
            return best;
        }, null);
        var sorted21 = s.ret21.slice().sort(function(a,b){return a-b;});
        var median21 = null;
        if (sorted21.length) { var mid = Math.floor(sorted21.length/2); median21 = sorted21.length%2!==0 ? sorted21[mid] : (sorted21[mid-1]+sorted21[mid])/2; }
        var mag21 = s.ret21.length ? s.ret21.reduce(function(a,b){return a+Math.abs(b);},0)/s.ret21.length : null;
        rows.push({
            signal: s.name,
            count: s.count,
            hitRate5:  s.ret5.length  > 0 ? (s.hit5  / s.ret5.length  * 100) : null,
            hitRate10: s.ret10.length > 0 ? (s.hit10 / s.ret10.length * 100) : null,
            hitRate21: s.ret21.length > 0 ? (s.hit21 / s.ret21.length * 100) : null,
            hitRate42: s.ret42.length > 0 ? (s.hit42 / s.ret42.length * 100) : null,
            avgRet5: avg5, avgRet10: avg10, avgRet21: avg21, avgRet42: avg42,
            median21: median21, mag21: mag21,
            best21:  s.ret21.length ? Math.max.apply(null, s.ret21) : null,
            worst21: s.ret21.length ? Math.min.apply(null, s.ret21) : null,
            sharpe5: sharpe5, sharpe10: sharpe10, sharpe21: sharpe21, sharpe42: sharpe42,
            sharpe: sharpe21,  // keep existing field for summary row compat
            horizons: horizons,
            optHorizon: optHorizon,
            seasonalHit21: s.seasonHit,
        });
    });
    // ── Ensemble Confluence Rows ──
    var confMap = computeEventConfluence(events);
    [2, 3].forEach(function(minConf) {
        var confEvents = events.filter(function(ev) { return (confMap[ev.idx] || 0) >= minConf; });
        if (confEvents.length < 2) return;
        var h5=0, h10=0, h21=0, h42=0, r5=[], r10=[], r21=[], r42=[];
        confEvents.forEach(function(ev) {
            var isDown = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
            var dir = isDown ? -1 : 1;
            if (ev.fwd5  != null) { r5.push(ev.fwd5   * dir); if ((isDown && ev.fwd5  < 0) || (!isDown && ev.fwd5  > 0)) h5++;  }
            if (ev.fwd10 != null) { r10.push(ev.fwd10  * dir); if ((isDown && ev.fwd10 < 0) || (!isDown && ev.fwd10 > 0)) h10++; }
            if (ev.fwd21 != null) { r21.push(ev.fwd21  * dir); if ((isDown && ev.fwd21 < 0) || (!isDown && ev.fwd21 > 0)) h21++; }
            if (ev.fwd42 != null) { r42.push(ev.fwd42  * dir); if ((isDown && ev.fwd42 < 0) || (!isDown && ev.fwd42 > 0)) h42++; }
        });
        var a5  = r5.length  ? r5.reduce(function(a,b){return a+b;},0)/r5.length   : null;
        var a10 = r10.length ? r10.reduce(function(a,b){return a+b;},0)/r10.length : null;
        var a21 = r21.length ? r21.reduce(function(a,b){return a+b;},0)/r21.length : null;
        var a42 = r42.length ? r42.reduce(function(a,b){return a+b;},0)/r42.length : null;
        var sh5  = calcSharpe(r5);
        var sh10 = calcSharpe(r10);
        var sh21 = calcSharpe(r21);
        var sh42 = calcSharpe(r42);
        var eHorizons = [
            { label: '5D',  sharpe: sh5,  hr: r5.length  > 0 ? h5  / r5.length  * 100 : null, avg: a5,  n: r5.length  },
            { label: '10D', sharpe: sh10, hr: r10.length > 0 ? h10 / r10.length * 100 : null, avg: a10, n: r10.length },
            { label: '21D', sharpe: sh21, hr: r21.length > 0 ? h21 / r21.length * 100 : null, avg: a21, n: r21.length },
            { label: '42D', sharpe: sh42, hr: r42.length > 0 ? h42 / r42.length * 100 : null, avg: a42, n: r42.length },
        ];
        var eOpt = eHorizons.reduce(function(best, h) {
            if (h.sharpe == null || h.sharpe <= 0 || h.n < 5) return best;
            if (best == null || h.sharpe > best.sharpe) return h;
            return best;
        }, null);
        var s21 = r21.slice().sort(function(a,b){return a-b;});
        var med = null;
        if (s21.length) { var mid = Math.floor(s21.length/2); med = s21.length%2!==0 ? s21[mid] : (s21[mid-1]+s21[mid])/2; }
        var mag = r21.length ? r21.reduce(function(a,b){return a+Math.abs(b);},0)/r21.length : null;
        rows.push({
            signal: 'CONF \u2265' + minConf, isEnsemble: true, count: confEvents.length,
            hitRate5: r5.length > 0 ? (h5/r5.length*100) : null,
            hitRate10: r10.length > 0 ? (h10/r10.length*100) : null,
            hitRate21: r21.length > 0 ? (h21/r21.length*100) : null,
            hitRate42: r42.length > 0 ? (h42/r42.length*100) : null,
            avgRet5: a5, avgRet10: a10, avgRet21: a21, avgRet42: a42,
            median21: med, mag21: mag,
            best21: s21.length ? Math.max.apply(null, s21) : null,
            worst21: s21.length ? Math.min.apply(null, s21) : null,
            sharpe5: sh5, sharpe10: sh10, sharpe21: sh21, sharpe42: sh42,
            sharpe: sh21,
            horizons: eHorizons,
            optHorizon: eOpt,
        });
    });
    return rows;
}

// ── Regime Heatmap Data ───────────────────────────────────────
function computeHeatmapData(data) {
    // Group by year-month, compute mean NGVL & regime
    var months = {};
    data.forEach(function(r) {
        var parts = r.date.split('-');
        var key = parts[0] + '-' + parts[1]; // YYYY-MM
        if (!months[key]) months[key] = { ngvl: [], underlying: [], skewRatio: [] };
        if (r.ngvl != null) months[key].ngvl.push(r.ngvl);
        if (r.underlying != null) months[key].underlying.push(r.underlying);
        if (r.skewRatio != null) months[key].skewRatio.push(r.skewRatio);
    });
    // Rank each month's avg NGVL against ALL monthly averages (not daily data)
    var sortedKeys = Object.keys(months).sort();
    var allMonthlyAvgs = sortedKeys.map(function(key) {
        return months[key].ngvl.reduce(function(a,b){return a+b;},0) / months[key].ngvl.length;
    });
    var rankedMonthlyAvgs = allMonthlyAvgs.slice().sort(function(a,b) { return a - b; });
    var result = {};
    sortedKeys.forEach(function(key, ki) {
        var m = months[key];
        var avgNgvl = allMonthlyAvgs[ki];
        var avgUnd = m.underlying.reduce(function(a,b){return a+b;},0) / m.underlying.length;
        var avgSk = m.skewRatio.length ? m.skewRatio.reduce(function(a,b){return a+b;},0) / m.skewRatio.length : null;
        // Percentile of avgNgvl vs all other monthly averages
        var rank = 0;
        for (var i = 0; i < rankedMonthlyAvgs.length; i++) { if (rankedMonthlyAvgs[i] <= avgNgvl) rank++; }
        var pct = (rank / rankedMonthlyAvgs.length) * 100;
        result[key] = { avgNgvl: avgNgvl, avgUnderlying: avgUnd, avgSkewRatio: avgSk, pct: pct, regime: ngvlRegime(pct) };
    });
    return result;
}

// ── Threshold Sensitivity ─────────────────────────────────────
// For each signal, re-detect events at 3 threshold levels and report count + hit rate.
function computeThresholdSensitivity(composites, data) {
    var n = data.length;
    var underlying = data.map(function(r) { return r.underlying; });
    var sadZ = composites.sadZ;
    var rdsZ = composites.rdsZ;
    var ci   = composites.ci ? null : null; // ci is direct value, not a Z
    // Reconstruct component arrays
    var ciArr = [], cvcDownArr = [], cvcUpArr = [];
    data.forEach(function(r) {
        ciArr.push(r.ci != null ? r.ci : (composites.ci ? composites.ci[data.indexOf(r)] : null));
        cvcDownArr.push(r.cvcDown != null ? r.cvcDown : null);
        cvcUpArr.push(r.cvcUp != null ? r.cvcUp : null);
    });
    // Use composites arrays directly
    var ciA    = composites.ci    || data.map(function(r){ return r.ci || null; });
    var cvcDA  = composites.cvcDown || data.map(function(r){ return r.cvcDown || null; });
    var cvcUA  = composites.cvcUp   || data.map(function(r){ return r.cvcUp || null; });
    var sadZA  = composites.sadZ  || [];
    var rdsZA  = composites.rdsZ  || [];

    // Signal configs: { name, key, thresholds: [tight, base, loose], getVal, isAbove }
    var configs = [
        { name: 'RDS',  getVal: function(i) { return rdsZA[i]; }, thresholds: [2.3, 1.8, 1.3], isAbove: true,
          dirFn: function(i) { return composites.skewRatioRoc5 && composites.skewRatioRoc5[i] > 0 ? 'UPSIDE SETUP' : 'DOWNSIDE SETUP'; } },
        { name: 'SAD',  getVal: function(i) { return sadZA[i] != null ? Math.abs(sadZA[i]) : null; }, thresholds: [2.0, 1.5, 1.0], isAbove: true,
          dirFn: function(i) { return sadZA[i] != null && sadZA[i] > 0 ? 'UPSIDE SKEW' : 'DOWNSIDE SKEW'; } },
        { name: 'CI',   getVal: function(i) { return ciA[i]; }, thresholds: [87, 82, 77], isAbove: true,
          dirFn: function() { return 'COMPLACENCY'; } },
        { name: 'CVC\u2193', getVal: function(i) { return cvcDA[i]; }, thresholds: [1.7, 1.2, 0.8], isAbove: true,
          dirFn: function() { return 'TOP SIGNAL'; } },
        { name: 'CVC\u2191', getVal: function(i) { return cvcUA[i]; }, thresholds: [1.7, 1.2, 0.8], isAbove: true,
          dirFn: function() { return 'BOTTOM SIGNAL'; } },
    ];

    function hitRateAtThreshold(cfg, threshold) {
        var events = [], lastFire = {};
        for (var i = 63; i < n; i++) {
            var val = cfg.getVal(i);
            if (val == null) continue;
            var triggered = cfg.isAbove ? val > threshold : val < threshold;
            if (!triggered) continue;
            var lastIdx = lastFire[cfg.name] || -999;
            if (i - lastIdx < 10) continue;
            lastFire[cfg.name] = i;
            var dir = cfg.dirFn(i);
            var isDown = dir.indexOf('TOP') >= 0 || dir.indexOf('DOWNSIDE') >= 0;
            var fwd21 = i + 21 < n ? ((underlying[i+21] - underlying[i]) / underlying[i] * 100) : null;
            if (fwd21 != null) {
                var hit = (isDown && fwd21 < 0) || (!isDown && fwd21 > 0);
                events.push({ hit: hit });
            }
        }
        if (events.length === 0) return { count: 0, hitRate: null };
        var hits = events.filter(function(e) { return e.hit; }).length;
        return { count: events.length, hitRate: hits / events.length * 100 };
    }

    var result = [];
    configs.forEach(function(cfg) {
        var levels = [
            { label: 'TIGHTER (+0.5)', threshold: cfg.thresholds[0] },
            { label: 'BASELINE', threshold: cfg.thresholds[1] },
            { label: 'LOOSER (-0.5)', threshold: cfg.thresholds[2] },
        ];
        var rows = levels.map(function(lv) {
            var r = hitRateAtThreshold(cfg, lv.threshold);
            return { label: lv.label, threshold: lv.threshold, count: r.count, hitRate: r.hitRate };
        });
        result.push({ signal: cfg.name, rows: rows });
    });
    return result;
}
