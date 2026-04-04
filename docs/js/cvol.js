/* ============================================================
   CVOL Volatility Intelligence Engine
   4th Tab of Stratum Meridian
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
    hoverState: null,
    dragState: { active: false, startIdx: null, currentIdx: null },
    signalFilter: 'all',
    signalTypeFilter: 'all', // 'all', 'SAD', 'CI', 'CVC↓', 'CVC↑', 'RDS'
    regimeFilter: 'all',  // 'all', 'low', 'normal', 'high'
    composites: {},       // computed composite signal arrays
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
        const std = Math.sqrt(ss / cnt);
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
                var lr = Math.log(underlying[j] / underlying[j-1]);
                sumSq += lr * lr;
                cnt++;
            }
        }
        if (cnt >= 15) realVol[i] = Math.sqrt(sumSq / cnt * 252) * 100; // annualized %
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
            var mean = sum / cnt;
            var sumSq = 0;
            for (let j = i - 20; j <= i; j++) { if (ngvl[j] != null) sumSq += (ngvl[j] - mean) * (ngvl[j] - mean); }
            vov[i] = Math.sqrt(sumSq / cnt);
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

    // ── Signal Events (moderate thresholds) ──
    const sadZ = rollingZScore(sad, 63);
    const rdsZ = rollingZScore(rds, 63);
    const events = [];
    for (let i = 63; i < n; i++) {
        let signal = null, direction = null, value = null, composite = null;

        // RDS spike: z > 1.8
        if (rdsZ[i] != null && rdsZ[i] > 1.8) {
            signal = 'RDS'; value = rds[i]; composite = rdsZ[i];
            direction = skewRatioRoc5[i] > 0 ? 'UPSIDE SETUP' : 'DOWNSIDE SETUP';
        }
        // SAD divergence: z > 1.5 or z < -1.5
        else if (sadZ[i] != null && Math.abs(sadZ[i]) > 1.5) {
            signal = 'SAD'; value = sad[i]; composite = sadZ[i];
            direction = sadZ[i] > 0 ? 'UPSIDE SKEW' : 'DOWNSIDE SKEW';
        }
        // CI extreme: > 82
        else if (ci[i] != null && ci[i] > 82) {
            signal = 'CI'; value = ci[i]; composite = ci[i];
            direction = 'COMPLACENCY';
        }
        // CVC: combined z > 1.5
        else if (cvcDown[i] != null && cvcDown[i] > 1.2) {
            signal = 'CVC↓'; value = cvcDown[i]; composite = cvcDown[i];
            direction = 'TOP SIGNAL';
        }
        else if (cvcUp[i] != null && cvcUp[i] > 1.2) {
            signal = 'CVC↑'; value = cvcUp[i]; composite = cvcUp[i];
            direction = 'BOTTOM SIGNAL';
        }

        if (signal) {
            // Deduplicate: skip if same signal within last 10 sessions
            const recent = events.filter(e => e.signal === signal && i - e.idx < 10);
            if (recent.length === 0) {
                const fwd5 = i + 5 < n ? ((underlying[i + 5] - underlying[i]) / underlying[i] * 100) : null;
                const fwd21 = i + 21 < n ? ((underlying[i + 21] - underlying[i]) / underlying[i] * 100) : null;
                events.push({
                    idx: i, date: data[i].date, signal, direction, value, composite,
                    underlying: underlying[i],
                    ngvl: ngvl[i], skewRatio: skewRatio[i], convexity: convexity[i], atm: atm[i],
                    fwd5, fwd21,
                    season: getSeason(data[i].date),
                });
            }
        }
    }

    return {
        ngvlPct21, ngvlPct63, ngvlPct252, atmPct252, skewRatioPct63, convPct63,
        skewRatioZ21, dnVarZ21, upVarZ21, atmZ21, ngvlZ21, convZ21,
        skewRatioRoc5, atmMed90,
        sad, ci, cvcDown, cvcUp, rds,
        sadZ, rdsZ,
        realVol, vrp, vrpZ21, termStructure, vov,
        events,
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
    sad:     { label: 'SAD — Skew-ATM Divergence', color: '#f59e0b', desc: 'Proprietary Divergence Signal: Measures the spread between SkewRatio and ATM Volatility. When Skew rises while ATM Vol remains suppressed, it reveals "Informed Flow" building directional exposure ahead of a major price expansion. Z-Score > 1.5 indicates high-conviction stealth positioning.',     threshold: null, thresholdType: 'z', thresholdVal: 1.5 },
    ci:      { label: 'CI — Complacency Index',     color: '#60a8f8', desc: 'Regime Fragility Benchmark: Inverse of the 1-year ATM volatility percentile. A reading > 82 represents "Extreme Complacency" (Vol Bottoming). Historically, these "Fragile Calm" regimes are precursors to violent, gap-up volatility spikes as hedges are cheaply under-owned across the street.',       threshold: 82, thresholdType: 'raw', thresholdVal: 82 },
    cvcDown: { label: 'CVC↓ — Convexity-Variance (Down)', color: '#ef4444', desc: 'Top Formation Confirmation: Synchronizes Tail-Risk (Convexity) with Downside Fear (DnVar). An active signal (>1.20) indicates institutions are aggressively layering deep OTM Put protection, physically pricing a significant correction or peak in the Natural Gas cycle.',       threshold: 1.2, thresholdType: 'raw', thresholdVal: 1.2 },
    cvcUp:   { label: 'CVC↑ — Convexity-Variance (Up)',   color: '#3db87a', desc: 'Bottom Formation Confirmation: Synchronizes Tail-Risk (Convexity) with Bullish Demand (UpVar). An active signal (>1.20) indicates a "Panic for Calls" as traders chase a bottom or hedge a sudden upside gap. High-probability signal for trend reversals.',     threshold: 1.2, thresholdType: 'raw', thresholdVal: 1.2 },
    rds:     { label: 'RDS — Regime Divergence Score', color: '#ec4899', desc: 'Explosive Momentum Lead: The "Trifecta" signal combining 5-day Skew momentum, Fat-Tail pricing, and ATM Volatility ranking. High RDS readings (>1.8 Z) occur at major ecological shifts in the volatility surface, often preceding the largest directional moves in the asset.',   threshold: null, thresholdType: 'z', thresholdVal: 1.8 },
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
        if (!signals[key]) signals[key] = { count: 0, hit5: 0, hit21: 0, ret5: [], ret21: [], name: ev.signal, seasonHit: {} };
        signals[key].count++;
        if (ev.fwd5 != null) {
            signals[key].ret5.push(ev.fwd5);
            var isDown = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
            if ((isDown && ev.fwd5 < 0) || (!isDown && ev.fwd5 > 0)) signals[key].hit5++;
        }
        if (ev.fwd21 != null) {
            signals[key].ret21.push(ev.fwd21);
            var isDown21 = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
            var hit = (isDown21 && ev.fwd21 < 0) || (!isDown21 && ev.fwd21 > 0);
            if (hit) signals[key].hit21++;
            // Track per-season hit rates
            var ssn = ev.season || 'unknown';
            if (!signals[key].seasonHit[ssn]) signals[key].seasonHit[ssn] = { hits: 0, total: 0 };
            signals[key].seasonHit[ssn].total++;
            if (hit) signals[key].seasonHit[ssn].hits++;
        }
    });
    var rows = [];
    Object.keys(signals).forEach(function(key) {
        var s = signals[key];
        var avg5 = s.ret5.length ? s.ret5.reduce(function(a,b){return a+b;},0) / s.ret5.length : null;
        var avg21 = s.ret21.length ? s.ret21.reduce(function(a,b){return a+b;},0) / s.ret21.length : null;
        var std21 = null;
        if (s.ret21.length > 2) {
            var m = avg21;
            var ss = s.ret21.reduce(function(a,b){return a + (b-m)*(b-m);},0) / s.ret21.length;
            std21 = Math.sqrt(ss);
        }
        // Median 21D — robust to outlier NG spikes
        var sorted21 = s.ret21.slice().sort(function(a,b){return a-b;});
        var median21 = null;
        if (sorted21.length) {
            var mid = Math.floor(sorted21.length / 2);
            median21 = sorted21.length % 2 !== 0 ? sorted21[mid] : (sorted21[mid-1] + sorted21[mid]) / 2;
        }
        // MAG 21D — avg absolute return (measures vol prediction regardless of direction)
        var mag21 = s.ret21.length ? s.ret21.reduce(function(a,b){return a+Math.abs(b);},0) / s.ret21.length : null;
        rows.push({
            signal: s.name,
            count: s.count,
            hitRate5: s.ret5.length > 0 ? (s.hit5 / s.ret5.length * 100) : null,
            hitRate21: s.ret21.length > 0 ? (s.hit21 / s.ret21.length * 100) : null,
            avgRet5: avg5,
            avgRet21: avg21,
            median21: median21,
            mag21: mag21,
            best21: s.ret21.length ? Math.max.apply(null, s.ret21) : null,
            worst21: s.ret21.length ? Math.min.apply(null, s.ret21) : null,
            sharpe: (avg21 != null && std21 != null && std21 > 0) ? (avg21 / std21) : null,
            seasonalHit21: s.seasonHit,
        });
    });
    // ── Ensemble Confluence Rows ──
    var confMap = computeEventConfluence(events);
    [2, 3].forEach(function(minConf) {
        var confEvents = events.filter(function(ev) { return (confMap[ev.idx] || 0) >= minConf; });
        if (confEvents.length < 2) return;
        var h5 = 0, h21 = 0, r5 = [], r21 = [];
        confEvents.forEach(function(ev) {
            var isDown = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
            if (ev.fwd5 != null) { r5.push(ev.fwd5); if ((isDown && ev.fwd5 < 0) || (!isDown && ev.fwd5 > 0)) h5++; }
            if (ev.fwd21 != null) { r21.push(ev.fwd21); if ((isDown && ev.fwd21 < 0) || (!isDown && ev.fwd21 > 0)) h21++; }
        });
        var a5 = r5.length ? r5.reduce(function(a,b){return a+b;},0)/r5.length : null;
        var a21 = r21.length ? r21.reduce(function(a,b){return a+b;},0)/r21.length : null;
        var sd21 = null;
        if (r21.length > 2) { var m21 = a21; sd21 = Math.sqrt(r21.reduce(function(a,b){return a+(b-m21)*(b-m21);},0)/r21.length); }
        var s21 = r21.slice().sort(function(a,b){return a-b;});
        var med = null;
        if (s21.length) { var mid = Math.floor(s21.length/2); med = s21.length%2!==0 ? s21[mid] : (s21[mid-1]+s21[mid])/2; }
        var mag = r21.length ? r21.reduce(function(a,b){return a+Math.abs(b);},0)/r21.length : null;
        rows.push({
            signal: 'CONF ≥' + minConf, isEnsemble: true, count: confEvents.length,
            hitRate5: r5.length > 0 ? (h5/r5.length*100) : null,
            hitRate21: r21.length > 0 ? (h21/r21.length*100) : null,
            avgRet5: a5, avgRet21: a21, median21: med, mag21: mag,
            best21: s21.length ? Math.max.apply(null, s21) : null,
            worst21: s21.length ? Math.min.apply(null, s21) : null,
            sharpe: (a21 != null && sd21 != null && sd21 > 0) ? (a21/sd21) : null,
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
    // Full-history NGVL values for percentile ranking
    var allNgvl = data.map(function(r) { return r.ngvl; }).filter(function(v) { return v != null; });
    allNgvl.sort(function(a,b) { return a - b; });
    var result = {};
    Object.keys(months).sort().forEach(function(key) {
        var m = months[key];
        var avgNgvl = m.ngvl.reduce(function(a,b){return a+b;},0) / m.ngvl.length;
        var avgUnd = m.underlying.reduce(function(a,b){return a+b;},0) / m.underlying.length;
        var avgSk = m.skewRatio.length ? m.skewRatio.reduce(function(a,b){return a+b;},0) / m.skewRatio.length : null;
        // Percentile of avgNgvl in full history
        var rank = 0;
        for (var i = 0; i < allNgvl.length; i++) { if (allNgvl[i] <= avgNgvl) rank++; }
        var pct = (rank / allNgvl.length) * 100;
        result[key] = { avgNgvl: avgNgvl, avgUnderlying: avgUnd, avgSkewRatio: avgSk, pct: pct, regime: ngvlRegime(pct) };
    });
    return result;
}
