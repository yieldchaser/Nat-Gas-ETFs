/* ============================================================
   CVOL Volatility Intelligence Engine
   4th Tab of Stratum Meridian
   ============================================================ */
'use strict';

const CvolState = {
    data: null,           // parsed CSV rows [{date, ngvl, dnVar, upVar, skew, skewRatio, atm, convexity, underlying}]
    dates: [],
    activeSeries: ['ngvl','underlying'],
    rangeState: { start: 0, end: 100 },
    horizonState: 'ALL',
    hoverState: null,
    dragState: { active: false, startIdx: null, currentIdx: null },
    signalFilter: 'all',
    composites: {},       // computed composite signal arrays
    percentiles: {},      // rolling percentile caches
    zscores: {},          // rolling z-score caches
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
    skewRatio:  { label: 'SKEW RATIO', color: '#f59e0b', axis: 'right2',unit: 'x',   key: 'skewRatio' },
    convexity:  { label: 'CONVEXITY',  color: '#ec4899', axis: 'right2',unit: 'x',   key: 'convexity' },
    underlying: { label: 'NG PRICE',   color: '#94a3b8', axis: 'right', unit: '$',   key: 'underlying' },
    skew:       { label: 'SKEW (pts)', color: '#a78bfa', axis: 'left',  unit: 'pts', key: 'skew' },
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
