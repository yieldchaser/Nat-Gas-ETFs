/* =========================================================================
   flow-composite.js — Cross-ETF Composite Z-Score & Flow vs NG Price
   Loaded by flows.html after main script defines `state`, `el`, `colors`,
   `resizeCanvas`, `drawXAxis`, `fmtUsd`, `fmtDateLong`, etc.
   ========================================================================= */

const SHORT_TICKERS = ['KOLD', 'HND', '3NGS'];
const LONG_TICKERS  = ['BOIL', 'HNU', '3NGL'];
const ALL_FLOW_TICKERS = ['BOIL', 'HNU', '3NGL', 'KOLD', 'HND', '3NGS'];

/**
 * Helper: Return source Z-score from a compositeZ item `d` given source key:
 * - 'all': bullish-aligned 6-ETF composite Z (+ = bullish gas pressure)
 * - 'long': mean Z of reporting Long ETFs (+ = inflows to BOIL/HNU/3NGL)
 * - 'short': bullish-aligned Short Z (-rawShortZ, + = short outflows = bullish gas)
 * - 'short_raw': actual Short ETF Z (+ = inflows to KOLD/HND/3NGS = bearish gas)
 * - Individual ticker ('BOIL', 'KOLD', etc.): raw ETF Z-score (+ = ETF inflows)
 * - Individual ticker bullish-aligned ('bull_BOIL', 'bull_KOLD', etc.): + = bullish gas
 */
function getSourceZ(d, src, bullishAligned = false) {
    if (!d) return 0;
    const s = src || 'all';
    if (s === 'all') return d.z || 0;
    if (s === 'long') return d.longZ || 0;
    if (s === 'short') return bullishAligned ? (d.shortZ || 0) : (d.rawShortZ !== undefined ? d.rawShortZ : -(d.shortZ || 0));
    if (d.rawByTicker && d.rawByTicker[s] !== undefined) {
        const raw = d.rawByTicker[s];
        return (bullishAligned && SHORT_TICKERS.includes(s)) ? -raw : raw;
    }
    return d.z || 0;
}

function getSourceLabel(src, bullishAligned = false) {
    const s = src || 'all';
    if (s === 'all') return 'COMPOSITE (ALL 6 ETFs)';
    if (s === 'long') return 'LONG SIDE (BOIL · HNU · 3NGL)';
    if (s === 'short') return bullishAligned ? 'SHORT SIDE (GAS-ALIGNED)' : 'SHORT SIDE (KOLD · HND · 3NGS)';
    const isShort = SHORT_TICKERS.includes(s);
    if (bullishAligned && isShort) return `${s} (GAS-ALIGNED −Z)`;
    return `${s} (${isShort ? 'SHORT ETF' : 'LONG ETF'})`;
}

/**
 * Compute daily Cross-ETF Composite Z-Score from state.cache.
 * Also precomputes full-history 5d NG return, 30d NG high/low, 20d rolling Z averages,
 * and full-history 1d/3d velocity Z-scores per source so zoomed/filtered views never
 * suffer from left-edge lookback truncation.
 */
function computeCompositeZ() {
    const dateMap = {};       // date -> { tk: bullishAlignedZ }
    const rawDateMap = {};    // date -> { tk: rawEtfZ }
    const rowDateMap = {};    // date -> { tk: fullRow }

    ALL_FLOW_TICKERS.forEach(tk => {
        const d = state.cache[tk]?.data;
        if (!d) return;
        d.forEach(row => {
            if (!dateMap[row.date]) {
                dateMap[row.date] = {};
                rawDateMap[row.date] = {};
                rowDateMap[row.date] = {};
            }
            const z = row.flow_zscore || 0;
            rawDateMap[row.date][tk] = z;
            dateMap[row.date][tk] = SHORT_TICKERS.includes(tk) ? -z : z;
            rowDateMap[row.date][tk] = row;
        });
    });

    const dates = Object.keys(dateMap).sort();
    const baseSeries = dates.map(date => {
        const vals = dateMap[date];
        const rawVals = rawDateMap[date];
        const zArr = Object.values(vals);
        const avg = zArr.length > 0 ? zArr.reduce((s, v) => s + v, 0) / zArr.length : 0;

        const repLongs = LONG_TICKERS.filter(t => vals[t] !== undefined);
        const repShorts = SHORT_TICKERS.filter(t => vals[t] !== undefined);

        const longZ = repLongs.length > 0
            ? repLongs.reduce((s, t) => s + vals[t], 0) / repLongs.length
            : 0;
        // shortZ: bullish-aligned (-rawShortZ), where positive = short outflows (bullish gas)
        const shortZ = repShorts.length > 0
            ? repShorts.reduce((s, t) => s + vals[t], 0) / repShorts.length
            : 0;
        // rawShortZ: actual short ETF flow Z, where positive = short inflows (bearish gas)
        const rawShortZ = repShorts.length > 0
            ? repShorts.reduce((s, t) => s + rawVals[t], 0) / repShorts.length
            : 0;

        return {
            date,
            z: Math.round(avg * 1000) / 1000,
            longZ: Math.round(longZ * 1000) / 1000,
            shortZ: Math.round(shortZ * 1000) / 1000,
            rawShortZ: Math.round(rawShortZ * 1000) / 1000,
            count: zArr.length,
            longCount: repLongs.length,
            shortCount: repShorts.length,
            rawByTicker: { ...rawVals },
            bullByTicker: { ...vals },
            rowsByTicker: rowDateMap[date]
        };
    });

    // Precompute full-history NG=F context (price, 5d return, 30d high/low) and 20d rolling Z
    const n = baseSeries.length;
    const ngPrices = new Array(n);
    for (let i = 0; i < n; i++) {
        ngPrices[i] = ngPriceAt(baseSeries[i].date);
    }

    for (let i = 0; i < n; i++) {
        const item = baseSeries[i];
        item.ngPrice = ngPrices[i];

        // Full-history 5-session NG=F return (never truncated by chart zoom)
        if (i >= 5 && ngPrices[i] != null && ngPrices[i - 5] != null && ngPrices[i - 5] > 0) {
            item.ng5d = (ngPrices[i] - ngPrices[i - 5]) / ngPrices[i - 5];
        } else {
            item.ng5d = null;
        }

        // Full-history 30-session NG=F high/low range
        let max30 = -Infinity, min30 = Infinity, valid30 = 0;
        for (let k = Math.max(0, i - 29); k <= i; k++) {
            if (ngPrices[k] != null) {
                if (ngPrices[k] > max30) max30 = ngPrices[k];
                if (ngPrices[k] < min30) min30 = ngPrices[k];
                valid30++;
            }
        }
        item.isHigh30 = valid30 >= 5 && ngPrices[i] != null && ngPrices[i] >= max30 * 0.95;
        item.isLow30  = valid30 >= 5 && ngPrices[i] != null && ngPrices[i] <= min30 * 1.05;
    }

    // Precompute full-history 20-day rolling Z-score mean and 1d/3d velocity Z-scores for all sources
    const sources = ['all', 'long', 'short', ...ALL_FLOW_TICKERS];
    const velBySource = {};
    sources.forEach(src => {
        const zSeries = baseSeries.map(d => src === 'short' ? d.rawShortZ : getSourceZ(d, src, false));
        const ma20 = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            const start = Math.max(0, i - 19);
            let sum = 0, cnt = 0;
            for (let k = start; k <= i; k++) { sum += zSeries[k]; cnt++; }
            ma20[i] = cnt > 0 ? sum / cnt : 0;
        }

        // If individual ticker, we can use precomputed vel_z_1d / vel_z_3d from JSON or compute from Z
        const v1d = new Array(n).fill(0);
        const v3d = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            v1d[i] = i >= 1 ? zSeries[i] - zSeries[i - 1] : 0;
            v3d[i] = i >= 3 ? (zSeries[i] - zSeries[i - 3]) / 3 : 0;
        }

        const calcRollingZ = (arr, win = 20) => {
            const out = new Array(n).fill(0);
            for (let i = 0; i < n; i++) {
                if (i < 4) { out[i] = 0; continue; }
                const s = Math.max(0, i - win + 1);
                let sum = 0, cnt = 0;
                for (let k = s; k <= i; k++) { sum += arr[k]; cnt++; }
                const mean = sum / cnt;
                let sq = 0;
                for (let k = s; k <= i; k++) sq += (arr[k] - mean) ** 2;
                const std = Math.sqrt(sq / cnt) || 1;
                out[i] = Math.max(-3.8, Math.min(3.8, (arr[i] - mean) / std));
            }
            return out;
        };

        const vz1d = calcRollingZ(v1d, 20);
        const vz3d = calcRollingZ(v3d, 20);
        // 5-day EMA of vz3d for clean rendering on dense multi-year views
        const vz3dSmooth = new Array(n).fill(0);
        const alpha = 2 / (5 + 1);
        for (let i = 0; i < n; i++) {
            vz3dSmooth[i] = i === 0 ? vz3d[0] : alpha * vz3d[i] + (1 - alpha) * vz3dSmooth[i - 1];
        }

        velBySource[src] = { ma20, v1d, v3d, vz1d, vz3d, vz3dSmooth };
    });

    for (let i = 0; i < n; i++) {
        const item = baseSeries[i];
        item.ma20BySource = {};
        item.velBySource = {};
        sources.forEach(src => {
            item.ma20BySource[src] = velBySource[src].ma20[i];
            item.velBySource[src] = {
                vel1d: velBySource[src].v1d[i],
                vel3d: velBySource[src].v3d[i],
                velZ1d: velBySource[src].vz1d[i],
                velZ3d: velBySource[src].vz3d[i],
                velZ3dSmooth: velBySource[src].vz3dSmooth[i]
            };
        });
    }

    state.compositeZ = baseSeries;
    updateCompZCurrentIndicator();
}

/**
 * Load NG=F history from summary JSON into state for O(1) date lookup.
 */
function loadNGHistory() {
    const raw = state.summary?.ng_history || [];
    state.ngHistory = {};
    state.ngDates = [];
    raw.forEach(item => {
        state.ngHistory[item.date] = item.close;
        state.ngDates.push(item.date);
    });
    state.ngDates.sort();
}

/**
 * Get NG=F close for a given date, with up to 5-day backward fill for weekends/holidays.
 */
function ngPriceAt(dateStr) {
    if (state.ngHistory[dateStr] !== undefined) return state.ngHistory[dateStr];
    const d = new Date(dateStr + 'T12:00:00Z');
    for (let k = 1; k <= 5; k++) {
        const prev = new Date(d);
        prev.setUTCDate(prev.getUTCDate() - k);
        const key = prev.toISOString().slice(0, 10);
        if (state.ngHistory[key] !== undefined) return state.ngHistory[key];
    }
    return null;
}

/**
 * Update the current-reading indicator badge in Section 6.1.
 */
function updateCompZCurrentIndicator() {
    const container = el('comp-z-current');
    if (!container || !state.compositeZ.length) return;

    const src = state.compZSource || 'all';
    const last = state.compositeZ[state.compositeZ.length - 1];
    const z = getSourceZ(last, src, false);
    const ma20 = last.ma20BySource ? (last.ma20BySource[src] || 0) : 0;
    const absZ = Math.abs(z);

    const isShortRaw = (src === 'short' || SHORT_TICKERS.includes(src));
    let label, color, dotColor, intensity;
    if (isShortRaw) {
        // For raw short ETF view: positive = short inflows (bearish gas), negative = short outflows (bullish gas)
        if (z > 0.05) {
            label = `${src === 'short' ? 'SHORT SIDE' : src} INFLOW (BEARISH GAS)`;
            color = '#ef4444';
            dotColor = '#ef4444';
        } else if (z < -0.05) {
            label = `${src === 'short' ? 'SHORT SIDE' : src} OUTFLOW (BULLISH GAS)`;
            color = '#3db87a';
            dotColor = '#3db87a';
        } else {
            label = 'NEUTRAL FLOW';
            color = 'rgba(148,163,184,0.7)';
            dotColor = 'rgba(148,163,184,0.5)';
        }
    } else {
        if (z > 0.05) {
            label = src === 'all' ? 'UPWARD PRESSURE' : `${src === 'long' ? 'LONG SIDE' : src} ACCUMULATION`;
            color = '#3db87a';
            dotColor = '#3db87a';
        } else if (z < -0.05) {
            label = src === 'all' ? 'DOWNWARD PRESSURE' : `${src === 'long' ? 'LONG SIDE' : src} DISTRIBUTION`;
            color = '#ef4444';
            dotColor = '#ef4444';
        } else {
            label = 'NEUTRAL';
            color = 'rgba(148,163,184,0.7)';
            dotColor = 'rgba(148,163,184,0.5)';
        }
    }

    if (absZ >= 2.0) intensity = 'EXTREME';
    else if (absZ >= 1.5) intensity = 'STRONG';
    else if (absZ >= 0.8) intensity = 'MODERATE';
    else if (absZ >= 0.3) intensity = 'MILD';
    else intensity = 'MINIMAL';

    const contribText = src === 'all'
        ? `${last.count} ETFs contributing`
        : src === 'long'
            ? `${last.longCount} Long ETFs`
            : src === 'short'
                ? `${last.shortCount} Short ETFs`
                : `${src} · 30d Rolling Z`;

    container.innerHTML = `
        <div class="comp-z-dot" style="color:${dotColor}; background:${dotColor};"></div>
        <div>
            <div class="comp-z-value" style="color:${color};">${z >= 0 ? '+' : ''}${z.toFixed(2)}σ</div>
            <div class="comp-z-label" style="color:${color};">${label}</div>
            <div style="font-size:0.55rem; color:rgba(255,255,255,0.45); margin-top:1px;">${intensity} · ${contribText} · 20D Avg: <span style="color:#f59e0b;font-weight:700;">${ma20 >= 0 ? '+' : ''}${ma20.toFixed(2)}σ</span></div>
        </div>
        <div style="flex:1;"></div>
        <div class="comp-z-date">${fmtDateLong(last.date)}</div>
    `;
}

/* =========================================================================
   Time-range + Zoom helpers for Section 6.1 and 6.2
   ========================================================================= */

function applyTimeFilter(data, range) {
    if (!data || !data.length || range === 'all') return data;
    const dayMap = { '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365, '2y': 730, '3y': 1095, '5y': 1825 };
    const days = dayMap[range] || 9999;
    const lastDateStr = data[data.length - 1].date;
    const cutoff = new Date(lastDateStr + 'T12:00:00Z');
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const idx = data.findIndex(d => d.date >= cutoffStr);
    return idx === -1 ? data : data.slice(idx);
}

function getCompZBase() {
    return applyTimeFilter(state.compositeZ, state.timeRange);
}

function getCompZVisible() {
    const base = getCompZBase();
    if (state.zoomCompZ.start === 0 && state.zoomCompZ.end === 1) return base;
    const s = Math.floor(state.zoomCompZ.start * base.length);
    const e = Math.ceil(state.zoomCompZ.end * base.length);
    return base.slice(Math.max(0, s), Math.min(base.length, e));
}

function getFlowVelBase() {
    return applyTimeFilter(state.compositeZ, state.timeRange);
}

function getFlowVelVisible() {
    const base = getFlowVelBase();
    if (state.zoomFlowVel.start === 0 && state.zoomFlowVel.end === 1) return base;
    const s = Math.floor(state.zoomFlowVel.start * base.length);
    const e = Math.ceil(state.zoomFlowVel.end * base.length);
    return base.slice(Math.max(0, s), Math.min(base.length, e));
}

function getFlowNGBase() {
    return applyTimeFilter(state.compositeZ, state.timeRange);
}

function getFlowNGVisible() {
    const base = getFlowNGBase();
    if (state.zoomFlowNG.start === 0 && state.zoomFlowNG.end === 1) return base;
    const s = Math.floor(state.zoomFlowNG.start * base.length);
    const e = Math.ceil(state.zoomFlowNG.end * base.length);
    return base.slice(Math.max(0, s), Math.min(base.length, e));
}

/* =========================================================================
   Section 6.1: Cross-ETF Composite Z-Score Chart
   ========================================================================= */

function renderCompZChart() {
    const data = getCompZVisible();
    if (!data || data.length < 2) return;
    updateCompZCurrentIndicator();
    drawChartCompZ(data);
}

function drawChartCompZ(data) {
    const cvs = el('chartCompZ');
    const { w, h, dpr } = resizeCanvas(cvs);
    ctxCompZ.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxCompZ.clearRect(0, 0, w, h);

    const pad = { top: 22, right: 20, bottom: 32, left: 45 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const src = state.compZSource || 'all';
    const zVals = data.map(d => getSourceZ(d, src, false));
    const ma20Vals = data.map(d => d.ma20BySource ? (d.ma20BySource[src] || 0) : 0);

    const dataMax = Math.max(...zVals.map(v => Math.abs(v)), 2.5);
    const maxZ = Math.min(Math.max(dataMax * 1.1, 2.5), 6);

    const getX = i => pad.left + (i / (data.length - 1)) * chartW;
    const getY = val => pad.top + chartH / 2 - (val / maxZ) * (chartH / 2);
    const y0 = getY(0);

    // ── Background zone bands ──
    const y15pos = Math.max(pad.top, getY(1.5));
    const y20pos = Math.max(pad.top, getY(2.0));
    ctxCompZ.fillStyle = 'rgba(61,184,122,0.03)';
    ctxCompZ.fillRect(pad.left, y20pos, chartW, y15pos - y20pos);
    ctxCompZ.fillStyle = 'rgba(34,197,94,0.06)';
    ctxCompZ.fillRect(pad.left, pad.top, chartW, y20pos - pad.top);

    const y15neg = Math.min(pad.top + chartH, getY(-1.5));
    const y20neg = Math.min(pad.top + chartH, getY(-2.0));
    ctxCompZ.fillStyle = 'rgba(239,68,68,0.03)';
    ctxCompZ.fillRect(pad.left, y15neg, chartW, y20neg - y15neg);
    ctxCompZ.fillStyle = 'rgba(192,64,64,0.06)';
    ctxCompZ.fillRect(pad.left, y20neg, chartW, (pad.top + chartH) - y20neg);

    // ── Threshold lines ──
    const drawThreshLine = (zVal, color, dash) => {
        const y = getY(zVal);
        if (y < pad.top || y > pad.top + chartH) return;
        ctxCompZ.beginPath();
        ctxCompZ.moveTo(pad.left, y);
        ctxCompZ.lineTo(pad.left + chartW, y);
        ctxCompZ.strokeStyle = color;
        ctxCompZ.lineWidth = 0.8;
        ctxCompZ.setLineDash(dash);
        ctxCompZ.stroke();
        ctxCompZ.setLineDash([]);
    };
    drawThreshLine(2.0,  'rgba(34,197,94,0.35)',  [4, 3]);
    drawThreshLine(1.5,  'rgba(61,184,122,0.28)', [4, 3]);
    drawThreshLine(-1.5, 'rgba(239,68,68,0.28)',   [4, 3]);
    drawThreshLine(-2.0, 'rgba(192,64,64,0.35)',   [4, 3]);

    // Zero line
    ctxCompZ.beginPath();
    ctxCompZ.moveTo(pad.left, y0);
    ctxCompZ.lineTo(pad.left + chartW, y0);
    ctxCompZ.strokeStyle = 'rgba(255,255,255,0.2)';
    ctxCompZ.lineWidth = 1;
    ctxCompZ.stroke();

    // ── Area fills (green above zero, red below zero) ──
    const drawCompArea = (aboveZero, rgbStr) => {
        ctxCompZ.save();
        ctxCompZ.beginPath();
        if (aboveZero) {
            ctxCompZ.rect(pad.left, pad.top, chartW, y0 - pad.top);
        } else {
            ctxCompZ.rect(pad.left, y0, chartW, (pad.top + chartH) - y0);
        }
        ctxCompZ.clip();

        ctxCompZ.beginPath();
        ctxCompZ.moveTo(getX(0), y0);
        for (let i = 0; i < data.length; i++) {
            ctxCompZ.lineTo(getX(i), getY(zVals[i]));
        }
        ctxCompZ.lineTo(getX(data.length - 1), y0);
        ctxCompZ.closePath();

        const g = ctxCompZ.createLinearGradient(0, pad.top, 0, pad.top + chartH);
        if (aboveZero) {
            g.addColorStop(0, `rgba(${rgbStr},0.42)`);
            g.addColorStop(0.5, `rgba(${rgbStr},0.06)`);
        } else {
            g.addColorStop(0.5, `rgba(${rgbStr},0.06)`);
            g.addColorStop(1, `rgba(${rgbStr},0.42)`);
        }
        ctxCompZ.fillStyle = g;
        ctxCompZ.fill();
        ctxCompZ.restore();
    };
    drawCompArea(true,  '61,184,122');
    drawCompArea(false, '239,68,68');

    // ── Composite Z-Score line with gradient stroke ──
    ctxCompZ.beginPath();
    ctxCompZ.lineWidth = data.length > 600 ? 1.35 : 1.8;
    for (let i = 0; i < data.length; i++) {
        const x = getX(i), y = getY(zVals[i]);
        if (i === 0) ctxCompZ.moveTo(x, y);
        else ctxCompZ.lineTo(x, y);
    }
    const strokeGrad = ctxCompZ.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    strokeGrad.addColorStop(0,    'rgba(34, 197, 94, 1)');
    strokeGrad.addColorStop(0.28, 'rgba(61, 184, 122, 0.9)');
    strokeGrad.addColorStop(0.44, 'rgba(148, 163, 184, 0.55)');
    strokeGrad.addColorStop(0.56, 'rgba(148, 163, 184, 0.55)');
    strokeGrad.addColorStop(0.72, 'rgba(239, 68, 68, 0.9)');
    strokeGrad.addColorStop(1,    'rgba(192, 64, 64, 1)');
    ctxCompZ.strokeStyle = strokeGrad;
    ctxCompZ.stroke();

    // ── 20-Day Rolling Mean Z-Score Trend Line (#f59e0b amber) ──
    ctxCompZ.beginPath();
    ctxCompZ.lineWidth = 1.8;
    ctxCompZ.strokeStyle = 'rgba(245, 158, 11, 0.9)';
    for (let i = 0; i < data.length; i++) {
        const x = getX(i), y = getY(ma20Vals[i]);
        if (i === 0) ctxCompZ.moveTo(x, y);
        else ctxCompZ.lineTo(x, y);
    }
    ctxCompZ.stroke();

    // ── Y-axis labels ──
    ctxCompZ.font = '9px monospace';
    ctxCompZ.textAlign = 'right';
    ctxCompZ.textBaseline = 'middle';
    const yTicks = [-2.0, -1.5, -1.0, 0, 1.0, 1.5, 2.0];
    if (maxZ > 2.8) { yTicks.unshift(-Math.round(maxZ)); yTicks.push(Math.round(maxZ)); }
    yTicks.forEach(t => {
        const y = getY(t);
        if (y < pad.top + 4 || y > pad.top + chartH - 4) return;
        if (t >= 1.5) ctxCompZ.fillStyle = 'rgba(61,184,122,0.8)';
        else if (t <= -1.5) ctxCompZ.fillStyle = 'rgba(239,68,68,0.8)';
        else if (t === 0) ctxCompZ.fillStyle = 'rgba(148,163,184,0.6)';
        else ctxCompZ.fillStyle = 'rgba(148,163,184,0.4)';
        ctxCompZ.fillText((t >= 0 ? '+' : '') + t.toFixed(1), pad.left - 5, y);
    });

    // ── X-axis ──
    drawXAxis(ctxCompZ, data.map(d => d.date), getX, chartW, pad.top + chartH + 14, pad);

    // ── Live dot at latest point ──
    const lastIdx = data.length - 1;
    const lx = getX(lastIdx), ly = getY(zVals[lastIdx]);
    const lastZ = zVals[lastIdx];
    const liveDotColor = lastZ > 0.05 ? '#3db87a' : lastZ < -0.05 ? '#ef4444' : '#94a3b8';
    ctxCompZ.beginPath();
    ctxCompZ.arc(lx, ly, 4, 0, Math.PI * 2);
    ctxCompZ.fillStyle = liveDotColor;
    ctxCompZ.fill();
    ctxCompZ.strokeStyle = '#fff';
    ctxCompZ.lineWidth = 1.5;
    ctxCompZ.stroke();

    // ── Hover crosshair ──
    if (state.hoverCompZIdx !== null && state.hoverCompZIdx >= 0 && state.hoverCompZIdx < data.length) {
        const hi = state.hoverCompZIdx;
        const hx = getX(hi);
        const hy = getY(zVals[hi]);
        const zVal = zVals[hi];
        const absZ = Math.abs(zVal);

        ctxCompZ.beginPath();
        ctxCompZ.moveTo(hx, pad.top);
        ctxCompZ.lineTo(hx, pad.top + chartH);
        ctxCompZ.strokeStyle = 'rgba(0,255,255,0.22)';
        ctxCompZ.lineWidth = 1;
        ctxCompZ.stroke();

        const hColor = zVal >= 1.5 ? '#22c55e' : zVal > 0.05 ? '#3db87a' : zVal <= -1.5 ? '#c04040' : zVal < -0.05 ? '#ef4444' : '#94a3b8';
        const dotR = 4 + Math.min(absZ * 1.2, 4);

        if (absZ >= 1.5) {
            ctxCompZ.beginPath();
            ctxCompZ.arc(hx, hy, dotR + 4, 0, Math.PI * 2);
            ctxCompZ.fillStyle = zVal > 0 ? 'rgba(61,184,122,0.2)' : 'rgba(239,68,68,0.2)';
            ctxCompZ.fill();
        }
        ctxCompZ.beginPath();
        ctxCompZ.arc(hx, hy, dotR, 0, Math.PI * 2);
        ctxCompZ.fillStyle = hColor;
        ctxCompZ.fill();
        ctxCompZ.strokeStyle = '#fff';
        ctxCompZ.lineWidth = 1.5;
        ctxCompZ.stroke();
    }
}

function handleCompZHover(e) {
    const cvs = el('chartCompZ');
    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const data = getCompZVisible();
    if (!data.length) return;

    const padL = 45, padR = 20;
    const chartW = rect.width - padL - padR;
    const tip = el('compz-tooltip');

    if (x >= padL && x <= rect.width - padR) {
        const pct = (x - padL) / chartW;
        let idx = Math.round(pct * (data.length - 1));
        idx = Math.max(0, Math.min(idx, data.length - 1));
        state.hoverCompZIdx = idx;

        const d = data[idx];
        const src = state.compZSource || 'all';
        const z = getSourceZ(d, src, false);
        const ma20 = d.ma20BySource ? (d.ma20BySource[src] || 0) : 0;
        const absZ = Math.abs(z);
        const zCol = z >= 1.5 ? '#22c55e' : z > 0.05 ? '#3db87a' : z <= -1.5 ? '#c04040' : z < -0.05 ? '#ef4444' : '#94a3b8';

        const isShortRaw = (src === 'short' || SHORT_TICKERS.includes(src));
        let regime;
        if (isShortRaw) {
            if (absZ >= 2.0) regime = z > 0 ? '◆ EXTREME SHORT BUILD (BEAR GAS)' : '◆ EXTREME SHORT EXIT (BULL GAS)';
            else if (absZ >= 1.5) regime = z > 0 ? '◆ STRONG SHORT INFLOW' : '◆ STRONG SHORT COVERING';
            else if (absZ >= 0.8) regime = z > 0 ? '▲ MODERATE SHORT INFLOW' : '▼ MODERATE SHORT EXIT';
            else regime = '○ NEUTRAL FLOW';
        } else {
            if (absZ >= 2.0) regime = z > 0 ? '◆ EXTREME UPWARD PRESSURE' : '◆ EXTREME DOWNWARD PRESSURE';
            else if (absZ >= 1.5) regime = z > 0 ? '◆ STRONG UPWARD PRESSURE' : '◆ STRONG DOWNWARD PRESSURE';
            else if (absZ >= 0.8) regime = z > 0 ? '▲ MODERATE UPWARD' : '▼ MODERATE DOWNWARD';
            else if (absZ >= 0.3) regime = z > 0 ? '△ MILD UPWARD' : '▽ MILD DOWNWARD';
            else regime = '○ NEUTRAL';
        }

        // Per-ETF breakdown on this date
        const breakdown = ALL_FLOW_TICKERS.map(tk => {
            const rawZ = d.rawByTicker?.[tk];
            if (rawZ === undefined) return '';
            const isShort = SHORT_TICKERS.includes(tk);
            const bullZ = isShort ? -rawZ : rawZ;
            const col = bullZ >= 0 ? 'rgba(61,184,122,0.85)' : 'rgba(239,68,68,0.85)';
            return `<div style="display:flex;justify-content:space-between;gap:10px;font-size:0.62rem;">
                <span style="color:${colors[tk]};font-weight:700;">${tk}${isShort ? ' (inv)' : ''}</span>
                <span style="font-family:monospace;color:${col};font-weight:600;">${bullZ >= 0 ? '+' : ''}${bullZ.toFixed(2)} (raw ${rawZ >= 0 ? '+' : ''}${rawZ.toFixed(2)})</span>
            </div>`;
        }).join('');

        const ngP = d.ngPrice != null ? `$${d.ngPrice.toFixed(2)}` : '—';

        tip.style.display = 'block';
        tip.innerHTML = `
            <div style="color:#00ffff; font-weight:800; margin-bottom:4px; font-size:0.68rem;">${fmtDateLong(d.date)} · NG=F ${ngP}</div>
            <div style="font-size:0.56rem; color:rgba(255,255,255,0.5); margin-bottom:3px; letter-spacing:0.5px;">${getSourceLabel(src, false)}</div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">Z-Score</span>
                <span style="font-family:monospace; font-weight:800; color:${zCol};">${z >= 0 ? '+' : ''}${z.toFixed(2)}σ</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:3px;">
                <span style="color:var(--text-dim);">20D Rolling Avg</span>
                <span style="font-family:monospace; font-weight:700; color:#f59e0b;">${ma20 >= 0 ? '+' : ''}${ma20.toFixed(2)}σ</span>
            </div>
            <div style="font-size:0.6rem; color:${zCol}; font-weight:700; margin-bottom:6px;">${regime}</div>
            <div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:4px; margin-top:2px;">
                <div style="font-size:0.55rem; color:rgba(255,255,255,0.35); margin-bottom:2px; letter-spacing:0.5px;">GAS-ALIGNED BREAKDOWN</div>
                ${breakdown}
            </div>
        `;

        const wrapLeft = cvs.parentElement.getBoundingClientRect().left;
        let tx = (e.clientX - wrapLeft) + 15;
        if (tx + 225 > cvs.parentElement.offsetWidth) tx = (e.clientX - wrapLeft) - 225 - 10;
        tip.style.left = Math.max(4, tx) + 'px';
        tip.style.top = Math.max(0, e.clientY - rect.top - 30) + 'px';
    } else {
        hideCompZHover();
    }
    drawChartCompZ(data);
}

function hideCompZHover() {
    state.hoverCompZIdx = null;
    const tip = el('compz-tooltip');
    if (tip) tip.style.display = 'none';
    const data = getCompZVisible();
    if (data && data.length > 1) drawChartCompZ(data);
}

// ── CompZ Range Slider ──
function initCompZSlider() {
    const s1 = el('compz-range-start'), s2 = el('compz-range-end');
    if (!s1 || !s2) return;
    const onChange = (e) => {
        let v1 = parseInt(s1.value), v2 = parseInt(s2.value);
        if (v1 >= v2) {
            if (e.target.id === 'compz-range-start') s1.value = Math.max(0, v2 - 1);
            else s2.value = Math.min(parseInt(s2.max), v1 + 1);
            v1 = parseInt(s1.value); v2 = parseInt(s2.value);
        }
        const max = parseInt(s1.max) || 1;
        state.zoomCompZ.start = v1 / max;
        state.zoomCompZ.end   = v2 / max;
        document.querySelectorAll('#compz-time-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        updateCompZSliderUI();
        renderCompZChart();
    };
    s1.addEventListener('input', onChange);
    s2.addEventListener('input', onChange);
}

function syncCompZSlider() {
    const s1 = el('compz-range-start'), s2 = el('compz-range-end');
    if (!s1 || !s2) return;
    const base = getCompZBase();
    const total = base.length || 1;
    s1.max = total; s2.max = total;
    s1.value = Math.round(state.zoomCompZ.start * total);
    s2.value = Math.round(state.zoomCompZ.end * total);
    updateCompZSliderUI();
}

function updateCompZSliderUI() {
    const s1 = el('compz-range-start'), s2 = el('compz-range-end');
    const hl = el('compz-range-highlight'), lbl = el('compz-range-label');
    if (!s1 || !s2) return;
    const v1 = parseInt(s1.value), v2 = parseInt(s2.value), max = parseInt(s1.max) || 1;
    const p1 = v1 / max, p2 = v2 / max;
    if (hl) {
        hl.style.left  = `calc(${p1 * 100}% + ${(10 - p1 * 20)}px)`;
        hl.style.width = `calc(${(p2 - p1) * 100}% + ${(p1 - p2) * 20}px)`;
    }
    if (lbl) {
        const z = state.zoomCompZ;
        lbl.textContent = (z.start > 0.001 || z.end < 0.999) ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}

/* =========================================================================
   Section 6.2: Flow Pressure vs Natural Gas Price (Contrarian Divergence)
   ========================================================================= */

function renderFlowNGChart() {
    const flow = getFlowNGVisible();
    if (!flow || flow.length < 2) return;
    drawChartFlowNG(flow);
}

function drawChartFlowNG(flow) {
    const cvs = el('chartFlowNG');
    const { w, h, dpr } = resizeCanvas(cvs);
    ctxFlowNG.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxFlowNG.clearRect(0, 0, w, h);

    const pad = { top: 22, right: 60, bottom: 32, left: 55 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const n = flow.length;
    const getX = i => pad.left + (i / (n - 1)) * chartW;
    const src = state.flowNGSource || 'all';

    const ngPrices = flow.map(d => d.ngPrice !== undefined ? d.ngPrice : ngPriceAt(d.date));

    // Contrarian Divergence Signal using full-history precomputed ng5d
    const divVals = [];
    for (let i = 0; i < n; i++) {
        const compZ = getSourceZ(flow[i], src, true); // gas-aligned (+ = bullish gas, - = bearish gas)
        const ng5d = flow[i].ng5d;

        const priceMovedSignificantly = ng5d !== null && Math.abs(ng5d) >= 0.005;
        const flowOpposesMove = priceMovedSignificantly && (
            (compZ > 0.05 && ng5d < 0) ||
            (compZ < -0.05 && ng5d > 0)
        );
        divVals.push({
            signed: flowOpposesMove ? compZ : 0,
            compZ,
            ng5d
        });
    }
    state.divValsCache = divVals;

    const maxAbsZ = Math.max(...divVals.map(d => Math.abs(d.signed)), 1.8);
    const zBound  = Math.min(Math.max(maxAbsZ * 1.15, 2.0), 5.0);
    const getZY   = val => pad.top + chartH / 2 - (val / zBound) * (chartH / 2);
    const y0      = getZY(0);

    const validNG = ngPrices.filter(p => p !== null);
    if (!validNG.length) return;
    const ngMin = Math.min(...validNG) * 0.95;
    const ngMax = Math.max(...validNG) * 1.05;
    const ngRange = Math.max(ngMax - ngMin, 0.1);
    const getNGY = val => pad.top + chartH - ((val - ngMin) / ngRange) * chartH;

    // ── Background zone shading ──
    const y15pos = Math.max(pad.top, getZY(1.5));
    const y15neg = Math.min(pad.top + chartH, getZY(-1.5));
    ctxFlowNG.fillStyle = 'rgba(61,184,122,0.04)';
    ctxFlowNG.fillRect(pad.left, pad.top, chartW, y15pos - pad.top);
    ctxFlowNG.fillStyle = 'rgba(239,68,68,0.04)';
    ctxFlowNG.fillRect(pad.left, y15neg, chartW, (pad.top + chartH) - y15neg);

    ctxFlowNG.font = 'bold 9px sans-serif';
    ctxFlowNG.textAlign = 'left';
    ctxFlowNG.fillStyle = 'rgba(61,184,122,0.6)';
    ctxFlowNG.fillText('▲ BULLISH DIVERGENCE (DIP ACCUMULATION)', pad.left + 6, Math.max(pad.top + 12, (pad.top + y15pos) / 2));
    ctxFlowNG.fillStyle = 'rgba(239,68,68,0.6)';
    ctxFlowNG.fillText('▼ BEARISH DIVERGENCE (RALLY DISTRIBUTION)', pad.left + 6, Math.min(pad.top + chartH - 8, (y15neg + pad.top + chartH) / 2));

    // ── Threshold lines (±1.5σ) ──
    [1.5, -1.5].forEach(z => {
        const y = getZY(z);
        if (y < pad.top || y > pad.top + chartH) return;
        ctxFlowNG.beginPath();
        ctxFlowNG.moveTo(pad.left, y);
        ctxFlowNG.lineTo(pad.left + chartW, y);
        ctxFlowNG.strokeStyle = z > 0 ? 'rgba(61,184,122,0.28)' : 'rgba(239,68,68,0.28)';
        ctxFlowNG.lineWidth = 0.8;
        ctxFlowNG.setLineDash([4, 3]);
        ctxFlowNG.stroke();
        ctxFlowNG.setLineDash([]);
    });

    // Zero line
    ctxFlowNG.beginPath();
    ctxFlowNG.moveTo(pad.left, y0);
    ctxFlowNG.lineTo(pad.left + chartW, y0);
    ctxFlowNG.strokeStyle = 'rgba(255,255,255,0.18)';
    ctxFlowNG.lineWidth = 1;
    ctxFlowNG.stroke();

    // ── Contrarian Divergence Bars ──
    const barW = Math.max(Math.min(chartW / n * 0.72, 8), 1.2);
    for (let i = 0; i < n; i++) {
        const z = divVals[i].signed;
        if (z === 0) continue;
        const x = getX(i) - barW / 2;
        const barY = getZY(z);
        const absZ = Math.abs(z);
        const alpha = Math.min(0.35 + absZ * 0.25, 0.90);

        if (z > 0) {
            ctxFlowNG.fillStyle = `rgba(61,184,122,${alpha.toFixed(2)})`;
            ctxFlowNG.fillRect(x, barY, barW, y0 - barY);
        } else {
            ctxFlowNG.fillStyle = `rgba(239,68,68,${alpha.toFixed(2)})`;
            ctxFlowNG.fillRect(x, y0, barW, barY - y0);
        }
    }

    // ── NG=F Price Line (Right Axis) ──
    ctxFlowNG.beginPath();
    ctxFlowNG.strokeStyle = '#38bdf8';
    ctxFlowNG.lineWidth = 1.6;
    let started = false;
    for (let i = 0; i < n; i++) {
        if (ngPrices[i] === null) continue;
        const x = getX(i), y = getNGY(ngPrices[i]);
        if (!started) { ctxFlowNG.moveTo(x, y); started = true; }
        else ctxFlowNG.lineTo(x, y);
    }
    ctxFlowNG.stroke();

    // ── Left Y-axis labels ──
    ctxFlowNG.font = '9px monospace';
    ctxFlowNG.textAlign = 'right';
    ctxFlowNG.textBaseline = 'middle';
    [-2.0, -1.5, -1.0, 0, 1.0, 1.5, 2.0].forEach(t => {
        if (Math.abs(t) > zBound) return;
        const y = getZY(t);
        if (y < pad.top + 4 || y > pad.top + chartH - 4) return;
        ctxFlowNG.fillStyle = t >= 1.5 ? 'rgba(61,184,122,0.85)' : t <= -1.5 ? 'rgba(239,68,68,0.85)' : 'rgba(148,163,184,0.5)';
        ctxFlowNG.fillText((t >= 0 ? '+' : '') + t.toFixed(1) + 'σ', pad.left - 5, y);
    });

    // ── Right Y-axis labels (NG=F Price) ──
    const ngTicks = niceAxisTicks(ngMin, ngMax, 5);
    ctxFlowNG.textAlign = 'left';
    ngTicks.forEach(tick => {
        const y = getNGY(tick);
        if (y < pad.top + 4 || y > pad.top + chartH - 4) return;
        ctxFlowNG.fillStyle = 'rgba(56,189,248,0.8)';
        ctxFlowNG.fillText('$' + tick.toFixed(tick >= 10 ? 1 : 2), w - pad.right + 6, y);
    });

    // ── X-axis ──
    drawXAxis(ctxFlowNG, flow.map(d => d.date), getX, chartW, pad.top + chartH + 14, pad);

    // ── Live dot on NG line ──
    for (let i = n - 1; i >= 0; i--) {
        if (ngPrices[i] !== null) {
            ctxFlowNG.beginPath();
            ctxFlowNG.arc(getX(i), getNGY(ngPrices[i]), 3.5, 0, Math.PI * 2);
            ctxFlowNG.fillStyle = '#fff';
            ctxFlowNG.fill();
            ctxFlowNG.strokeStyle = '#38bdf8';
            ctxFlowNG.lineWidth = 1.5;
            ctxFlowNG.stroke();
            break;
        }
    }

    // ── Hover crosshair ──
    if (state.hoverFlowNGIdx !== null && state.hoverFlowNGIdx >= 0 && state.hoverFlowNGIdx < n) {
        const hi = state.hoverFlowNGIdx;
        const hx = getX(hi);

        ctxFlowNG.beginPath();
        ctxFlowNG.moveTo(hx, pad.top);
        ctxFlowNG.lineTo(hx, pad.top + chartH);
        ctxFlowNG.strokeStyle = 'rgba(0,255,255,0.22)';
        ctxFlowNG.lineWidth = 1;
        ctxFlowNG.stroke();

        const dv = divVals[hi].signed;
        const dotY = dv !== 0 ? getZY(dv) : y0;
        const fCol = dv > 0 ? '#3db87a' : dv < 0 ? '#ef4444' : 'rgba(148,163,184,0.4)';
        ctxFlowNG.beginPath();
        ctxFlowNG.arc(hx, dotY, dv !== 0 ? 4.5 : 3, 0, Math.PI * 2);
        ctxFlowNG.fillStyle = fCol;
        ctxFlowNG.fill();
        ctxFlowNG.strokeStyle = '#fff';
        ctxFlowNG.lineWidth = 1.2;
        ctxFlowNG.stroke();

        if (ngPrices[hi] !== null) {
            ctxFlowNG.beginPath();
            ctxFlowNG.arc(hx, getNGY(ngPrices[hi]), 4, 0, Math.PI * 2);
            ctxFlowNG.fillStyle = '#38bdf8';
            ctxFlowNG.fill();
            ctxFlowNG.strokeStyle = '#fff';
            ctxFlowNG.lineWidth = 1.2;
            ctxFlowNG.stroke();
        }
    }
}

/* =========================================================================
   Section 6.3: Flow Reactivity Intensity (Breakout Chasing vs Downside Capitulation)
   ========================================================================= */

function getReactivityBase() {
    return applyTimeFilter(state.compositeZ, state.timeRange);
}

function getReactivityVisible() {
    const base = getReactivityBase();
    if (state.zoomReactivity.start === 0 && state.zoomReactivity.end === 1) return base;
    const s = Math.floor(state.zoomReactivity.start * base.length);
    const e = Math.ceil(state.zoomReactivity.end * base.length);
    return base.slice(Math.max(0, s), Math.min(base.length, e));
}

function renderReactivityChart() {
    const flow = getReactivityVisible();
    if (!flow || flow.length < 2) return;
    drawChartReactivity(flow);
}

function drawChartReactivity(flow) {
    const cvs = el('chartReactivity');
    if (!cvs) return;
    const { w, h, dpr } = resizeCanvas(cvs);
    ctxReactivity.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxReactivity.clearRect(0, 0, w, h);

    const pad = { top: 22, right: 60, bottom: 32, left: 55 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const n = flow.length;
    const getX = i => pad.left + (i / (n - 1)) * chartW;
    const src = state.reactivitySource || 'all';
    const ngPrices = flow.map(d => d.ngPrice !== undefined ? d.ngPrice : ngPriceAt(d.date));

    // Signed Trend-Aligned / Reactive Signal using full-history precomputed ng5d:
    // +signed: Bullish Trend-Following / Breakout Chasing (flow > 0 while NG 5d > +0.5% -> 67.3% 5d continuation!)
    // -signed: Bearish Trend-Following / Downside Capitulation (flow < 0 while NG 5d < -0.5% -> +5.13% 5d bounce!)
    const reactVals = [];
    for (let i = 0; i < n; i++) {
        const compZ = getSourceZ(flow[i], src, true); // gas-aligned (+ = bullish gas, - = bearish gas)
        const ng5d = flow[i].ng5d;

        const priceMovedSignificantly = ng5d !== null && Math.abs(ng5d) >= 0.005;
        const flowFollowsMove = priceMovedSignificantly && (
            (compZ > 0.05 && ng5d > 0) ||
            (compZ < -0.05 && ng5d < 0)
        );
        const signed = flowFollowsMove ? compZ : 0;
        reactVals.push({
            signed,
            intensity: Math.abs(signed),
            compZ,
            ng5d
        });
    }
    state.reactValsCache = reactVals;

    const maxDataAbs = Math.max(...reactVals.map(d => Math.abs(d.signed)), 1.0);
    const maxAbs = Math.min(Math.max(maxDataAbs * 1.18, 1.35), 4.0);
    const toY = v => pad.top + chartH / 2 - (v / maxAbs) * (chartH / 2);
    const zeroY = toY(0);

    const validNG = ngPrices.filter(p => p !== null);
    const ngMin = validNG.length ? Math.min(...validNG) * 0.95 : 1;
    const ngMax = validNG.length ? Math.max(...validNG) * 1.05 : 10;
    const ngRange = Math.max(ngMax - ngMin, 0.1);
    const getNGY = val => pad.top + chartH - ((val - ngMin) / ngRange) * chartH;

    // ── Background Zone Shading (+1.0σ Breakout Zone vs -1.0σ Capitulation Zone) ──
    const y10pos = Math.max(pad.top, toY(1.0));
    const y10neg = Math.min(pad.top + chartH, toY(-1.0));
    ctxReactivity.fillStyle = 'rgba(0, 229, 255, 0.04)';
    ctxReactivity.fillRect(pad.left, pad.top, chartW, y10pos - pad.top);
    ctxReactivity.fillStyle = 'rgba(245, 158, 11, 0.04)';
    ctxReactivity.fillRect(pad.left, y10neg, chartW, (pad.top + chartH) - y10neg);

    ctxReactivity.font = 'bold 9px sans-serif';
    ctxReactivity.textAlign = 'left';
    ctxReactivity.fillStyle = 'rgba(0, 229, 255, 0.65)';
    ctxReactivity.fillText('▲ BULLISH TREND MOMENTUM (FLOW + PRICE UP · 67% 5D CONTINUATION)', pad.left + 6, Math.max(pad.top + 12, (pad.top + y10pos) / 2));
    ctxReactivity.fillStyle = 'rgba(245, 158, 11, 0.7)';
    ctxReactivity.fillText('▼ DOWNSIDE CAPITULATION (FLOW + PRICE DOWN · +5.1% 5D REBOUND)', pad.left + 6, Math.min(pad.top + chartH - 8, (y10neg + pad.top + chartH) / 2));

    // ── Threshold lines (±1.0σ and ±1.5σ) ──
    [1.5, 1.0, -1.0, -1.5].forEach(z => {
        if (Math.abs(z) > maxAbs) return;
        const y = toY(z);
        ctxReactivity.beginPath();
        ctxReactivity.moveTo(pad.left, y);
        ctxReactivity.lineTo(pad.left + chartW, y);
        ctxReactivity.strokeStyle = z > 0 ? 'rgba(0,229,255,0.25)' : 'rgba(245,158,11,0.25)';
        ctxReactivity.lineWidth = 0.8;
        ctxReactivity.setLineDash([4, 3]);
        ctxReactivity.stroke();
        ctxReactivity.setLineDash([]);
    });

    // Zero line
    ctxReactivity.beginPath();
    ctxReactivity.moveTo(pad.left, zeroY);
    ctxReactivity.lineTo(pad.left + chartW, zeroY);
    ctxReactivity.strokeStyle = 'rgba(255,255,255,0.18)';
    ctxReactivity.lineWidth = 1;
    ctxReactivity.stroke();

    // ── Signed Reactivity Bars ──
    const barW = Math.max(Math.min(chartW / n * 0.72, 8), 1.2);
    for (let i = 0; i < n; i++) {
        const sVal = reactVals[i].signed;
        if (sVal === 0) continue;
        const x = getX(i) - barW / 2;
        const barY = toY(sVal);
        const absZ = Math.abs(sVal);
        const alpha = Math.min(0.45 + absZ * 0.35, 0.92);

        if (sVal > 0) {
            ctxReactivity.fillStyle = `rgba(0, 229, 255, ${alpha.toFixed(2)})`;
            ctxReactivity.fillRect(x, barY, barW, zeroY - barY);
        } else {
            ctxReactivity.fillStyle = `rgba(245, 158, 11, ${alpha.toFixed(2)})`;
            ctxReactivity.fillRect(x, zeroY, barW, barY - zeroY);
        }
    }

    // ── NG=F Price Line Overlay (Right Axis) ──
    if (validNG.length > 0) {
        ctxReactivity.beginPath();
        ctxReactivity.strokeStyle = 'rgba(148, 163, 184, 0.55)';
        ctxReactivity.lineWidth = 1.4;
        let started = false;
        for (let i = 0; i < n; i++) {
            if (ngPrices[i] === null) continue;
            const x = getX(i), y = getNGY(ngPrices[i]);
            if (!started) { ctxReactivity.moveTo(x, y); started = true; }
            else ctxReactivity.lineTo(x, y);
        }
        ctxReactivity.stroke();
    }

    // ── Left Y-axis labels ──
    ctxReactivity.font = '9px monospace';
    ctxReactivity.textAlign = 'right';
    ctxReactivity.textBaseline = 'middle';
    [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5].forEach(t => {
        if (Math.abs(t) > maxAbs) return;
        const y = toY(t);
        if (y < pad.top + 4 || y > pad.top + chartH - 4) return;
        ctxReactivity.fillStyle = t >= 1.0 ? 'rgba(0,229,255,0.85)' : t <= -1.0 ? 'rgba(245,158,11,0.85)' : 'rgba(148,163,184,0.5)';
        ctxReactivity.fillText((t >= 0 ? '+' : '') + t.toFixed(1) + 'σ', pad.left - 5, y);
    });

    // ── Right Y-axis labels (NG=F Price) ──
    if (validNG.length > 0) {
        const ngTicks = niceAxisTicks(ngMin, ngMax, 5);
        ctxReactivity.textAlign = 'left';
        ngTicks.forEach(tick => {
            const y = getNGY(tick);
            if (y < pad.top + 4 || y > pad.top + chartH - 4) return;
            ctxReactivity.fillStyle = 'rgba(148,163,184,0.65)';
            ctxReactivity.fillText('$' + tick.toFixed(tick >= 10 ? 1 : 2), w - pad.right + 6, y);
        });
    }

    // ── X-axis ──
    drawXAxis(ctxReactivity, flow.map(d => d.date), getX, chartW, pad.top + chartH + 14, pad);

    // ── Hover crosshair ──
    if (state.hoverReactivityIdx !== null && state.hoverReactivityIdx >= 0 && state.hoverReactivityIdx < n) {
        const hi = state.hoverReactivityIdx;
        const hx = getX(hi);

        ctxReactivity.beginPath();
        ctxReactivity.moveTo(hx, pad.top);
        ctxReactivity.lineTo(hx, pad.top + chartH);
        ctxReactivity.strokeStyle = 'rgba(0,255,255,0.22)';
        ctxReactivity.lineWidth = 1;
        ctxReactivity.stroke();

        const rv = reactVals[hi].signed;
        const dotY = rv !== 0 ? toY(rv) : zeroY;
        const fCol = rv > 0 ? '#00e5ff' : rv < 0 ? '#f59e0b' : 'rgba(148,163,184,0.4)';
        ctxReactivity.beginPath();
        ctxReactivity.arc(hx, dotY, rv !== 0 ? 4.5 : 3, 0, Math.PI * 2);
        ctxReactivity.fillStyle = fCol;
        ctxReactivity.fill();
        ctxReactivity.strokeStyle = '#fff';
        ctxReactivity.lineWidth = 1.2;
        ctxReactivity.stroke();
    }
}

function handleReactivityHover(e) {
    const cvs = el('chartReactivity');
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const flow = getReactivityVisible();
    if (!flow.length) return;

    const padL = 55, padR = 60;
    const chartW = rect.width - padL - padR;
    const tip = el('reactivity-tooltip');

    if (x >= padL && x <= rect.width - padR) {
        const pct = (x - padL) / chartW;
        let idx = Math.round(pct * (flow.length - 1));
        idx = Math.max(0, Math.min(idx, flow.length - 1));
        state.hoverReactivityIdx = idx;

        const d = flow[idx];
        const src = state.reactivitySource || 'all';
        const compZ = getSourceZ(d, src, true);
        const ngPrice = d.ngPrice !== undefined ? d.ngPrice : ngPriceAt(d.date);
        const cached = state.reactValsCache[idx] || { signed: 0, intensity: 0, ng5d: null };
        const sVal = cached.signed;
        const intensity = cached.intensity;
        const ng5d = cached.ng5d;

        let statusText, statusColor, descText;
        if (sVal > 0) {
            statusText = intensity >= 1.0 ? '◆ STRONG TREND MOMENTUM' : '▲ BULLISH MOMENTUM ALIGNED';
            statusColor = '#00e5ff';
            descText = `Inflows (+${compZ.toFixed(2)}σ) aligned with 5d price rally (+${(ng5d * 100).toFixed(1)}%). Historical 5d continuation hit rate: 67.3% (+5.8% 21d avg).`;
        } else if (sVal < 0) {
            statusText = intensity >= 1.0 ? '◆ DOWNSIDE CAPITULATION' : '▼ BEARISH MOMENTUM ALIGNED';
            statusColor = '#f59e0b';
            descText = `Outflows (${compZ.toFixed(2)}σ) during 5d price drop (${(ng5d * 100).toFixed(1)}%). Historical 5d mean-reversion rebound: +5.1% (63.3% hit rate).`;
        } else {
            statusText = '○ CONTRARIAN / FLAT (NO REACTIVE SIGNAL)';
            statusColor = 'rgba(148,163,184,0.65)';
            descText = 'Flows are opposing the 5d price move (see Flow-Price Divergence Signal chart above).';
        }

        const ng5dRow = ng5d !== null ? `
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">NG 5-Session Move</span>
                <span style="font-family:monospace; font-weight:700; color:${ng5d >= 0 ? '#3db87a' : '#ef4444'};">${ng5d >= 0 ? '+' : ''}${(ng5d * 100).toFixed(1)}%</span>
            </div>` : '';

        tip.style.display = 'block';
        tip.innerHTML = `
            <div style="color:#00ffff; font-weight:800; margin-bottom:4px; font-size:0.68rem;">${fmtDateLong(d.date)}</div>
            <div style="font-size:0.55rem; color:rgba(255,255,255,0.45); margin-bottom:4px;">${getSourceLabel(src, true)}</div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">Reactive Z-Impulse</span>
                <span style="font-family:monospace; font-weight:800; color:${statusColor};">${sVal !== 0 ? (sVal >= 0 ? '+' : '') + sVal.toFixed(2) + 'σ' : '0.00σ (contrarian)'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">Raw Gas-Aligned Z</span>
                <span style="font-family:monospace; font-weight:700; color:${compZ >= 0 ? '#3db87a' : '#ef4444'};">${compZ >= 0 ? '+' : ''}${compZ.toFixed(2)}σ</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">NG=F Price</span>
                <span style="font-family:monospace; font-weight:700; color:#38bdf8;">${ngPrice !== null ? '$' + ngPrice.toFixed(2) : '—'}</span>
            </div>
            ${ng5dRow}
            <div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:4px; margin-top:4px;">
                <div style="font-size:0.6rem; color:${statusColor}; font-weight:700;">${statusText}</div>
                <div style="font-size:0.55rem; color:rgba(255,255,255,0.6); margin-top:2px; line-height:1.35;">${descText}</div>
            </div>
        `;

        const wrapLeft = cvs.parentElement.getBoundingClientRect().left;
        let tx = (e.clientX - wrapLeft) + 15;
        if (tx + 240 > cvs.parentElement.offsetWidth) tx = (e.clientX - wrapLeft) - 240 - 10;
        tip.style.left = Math.max(4, tx) + 'px';
        tip.style.top = Math.max(0, e.clientY - rect.top - 30) + 'px';
    } else {
        hideReactivityHover();
    }
    drawChartReactivity(flow);
}

function hideReactivityHover() {
    state.hoverReactivityIdx = null;
    const tip = el('reactivity-tooltip');
    if (tip) tip.style.display = 'none';
    const flow = getReactivityVisible();
    if (flow && flow.length > 1) drawChartReactivity(flow);
}

function initReactivitySlider() {
    const s1 = el('reactivity-range-start'), s2 = el('reactivity-range-end');
    if (!s1 || !s2) return;
    const onChange = (e) => {
        let v1 = parseInt(s1.value), v2 = parseInt(s2.value);
        if (v1 >= v2) {
            if (e.target.id === 'reactivity-range-start') s1.value = Math.max(0, v2 - 1);
            else s2.value = Math.min(parseInt(s2.max), v1 + 1);
            v1 = parseInt(s1.value); v2 = parseInt(s2.value);
        }
        const max = parseInt(s1.max) || 1;
        state.zoomReactivity.start = v1 / max;
        state.zoomReactivity.end   = v2 / max;
        document.querySelectorAll('#reactivity-time-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        updateReactivitySliderUI();
        renderReactivityChart();
    };
    s1.addEventListener('input', onChange);
    s2.addEventListener('input', onChange);
}

function syncReactivitySlider() {
    const s1 = el('reactivity-range-start'), s2 = el('reactivity-range-end');
    if (!s1 || !s2) return;
    const base = getReactivityBase();
    const total = base.length || 1;
    s1.max = total; s2.max = total;
    s1.value = Math.round(state.zoomReactivity.start * total);
    s2.value = Math.round(state.zoomReactivity.end * total);
    updateReactivitySliderUI();
}

function updateReactivitySliderUI() {
    const s1 = el('reactivity-range-start'), s2 = el('reactivity-range-end');
    const hl = el('reactivity-range-highlight'), lbl = el('reactivity-range-label');
    if (!s1 || !s2) return;
    const v1 = parseInt(s1.value), v2 = parseInt(s2.value), max = parseInt(s1.max) || 1;
    const p1 = v1 / max, p2 = v2 / max;
    if (hl) {
        hl.style.left  = `calc(${p1 * 100}% + ${(10 - p1 * 20)}px)`;
        hl.style.width = `calc(${(p2 - p1) * 100}% + ${(p1 - p2) * 20}px)`;
    }
    if (lbl) {
        const z = state.zoomReactivity;
        lbl.textContent = (z.start > 0.001 || z.end < 0.999) ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}

/* =========================================================================
   Section 6.1b: Flow Activity Heat Map (90-Day Calendar Grid)
   ========================================================================= */

function computeFlowHeatGlobalPercentiles() {
    state.flowHeatGlobalPercentiles = {};
    const sources = ['all', 'long', 'short', ...ALL_FLOW_TICKERS];
    sources.forEach(source => {
        const vals = state.compositeZ.map(d => {
            if (source === 'all') return Math.abs(d.z || 0);
            if (source === 'long') return Math.abs(d.longZ || 0);
            if (source === 'short') return Math.abs(d.rawShortZ !== undefined ? d.rawShortZ : (d.shortZ || 0));
            return Math.abs(d.rawByTicker?.[source] || 0);
        });
        vals.sort((a, b) => a - b);
        const n = vals.length;
        if (n > 0) {
            state.flowHeatGlobalPercentiles[source] = {
                p90: vals[Math.floor(0.90 * n)],
                p95: vals[Math.floor(0.95 * n)],
                p99: vals[Math.floor(0.99 * n)]
            };
        } else {
            state.flowHeatGlobalPercentiles[source] = { p90: 1.5, p95: 2.0, p99: 2.5 };
        }
    });
}

function renderFlowHeatCalendar(offset = 0) {
    const elContainer = document.getElementById('flow-activity-heat');
    if (!elContainer) return;

    const longestData = state.compositeZ;
    if (!longestData || longestData.length === 0) return;

    const maxOffset = Math.floor((longestData.length - 1) / 90);
    offset = Math.max(0, Math.min(offset, maxOffset));
    state.flowHeatOffset = offset;

    const btnPrev = document.getElementById('flow-heat-prev');
    const btnNext = document.getElementById('flow-heat-next');
    if (btnPrev) btnPrev.disabled = (offset >= maxOffset);
    if (btnNext) btnNext.disabled = (offset === 0);

    const rangeLabel = document.getElementById('flow-heat-range-label');
    const days = 90;
    const dataLength = longestData.length;
    const startIndex = Math.max(0, dataLength - (offset + 1) * days);
    const endIndex = dataLength - offset * days;

    if (rangeLabel && longestData[startIndex] && longestData[endIndex - 1]) {
        const startD = longestData[startIndex].date;
        const endD = longestData[endIndex - 1].date;
        rangeLabel.textContent = `· ${startD} to ${endD}`;
    }

    const mode = state.flowHeatMode || 'unified';
    const source = state.flowHeatSource || 'all';

    const sigLegend = document.getElementById('flow-heat-legend-signals');
    const sigSep = document.getElementById('flow-heat-legend-sep');
    if (sigLegend) {
        sigLegend.style.display = (mode === 'unified') ? 'flex' : 'none';
    }
    if (sigSep) {
        sigSep.style.display = (mode === 'unified') ? 'inline-block' : 'none';
    }

    // Dynamic legend labels for Short Side vs Long/Composite
    const legOutLbl = document.getElementById('flow-heat-lbl-outflow');
    const legInLbl  = document.getElementById('flow-heat-lbl-inflow');
    const isShortSource = (source === 'short' || SHORT_TICKERS.includes(source));
    if (legOutLbl && legInLbl) {
        if (isShortSource) {
            legOutLbl.textContent = 'Short Outflow (Bull Gas)';
            legInLbl.textContent  = 'Short Inflow (Bear Gas)';
        } else if (source === 'all') {
            legOutLbl.textContent = 'Outflow (Bear)';
            legInLbl.textContent  = 'Inflow (Bull)';
        } else {
            legOutLbl.textContent = `${source === 'long' ? 'Long' : source} Outflow`;
            legInLbl.textContent  = `${source === 'long' ? 'Long' : source} Inflow`;
        }
    }

    const peaksMode = state.flowHeatPeaksMode || false;
    const thresholdPct = state.flowHeatPeaksThreshold || 95;
    const globalObj = state.flowHeatGlobalPercentiles;
    const percentiles = globalObj ? globalObj[source] : null;
    const cutoff = percentiles ? (percentiles[`p${thresholdPct}`] || 1.5) : 1.5;
    const p90Cutoff = percentiles ? (percentiles.p90 || 1.2) : 1.2;
    const p95Cutoff = percentiles ? (percentiles.p95 || 1.5) : 1.5;
    const p99Cutoff = percentiles ? (percentiles.p99 || 2.0) : 2.0;

    let windowPeakCount = 0;

    let html = `<div class="flow-heat-grid ${peaksMode ? 'peaks-mode' : ''}">`;
    let prevMonth = null;
    const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    for (let i = startIndex; i < endIndex; i++) {
        const d = longestData[i];
        if (!d) continue;

        const day = d.date.split('-')[2];
        const month = d.date.split('-')[1];

        let monthLabel = '';
        if (prevMonth !== null && prevMonth !== month) {
            const monthIdx = parseInt(month, 10) - 1;
            monthLabel = `<span class="flow-heat-month">${monthNames[monthIdx]}</span>`;
        }
        prevMonth = month;

        // Value for cell color:
        // - all: composite gas-aligned Z (+ = bullish gas)
        // - long: long-side Z (+ = inflows to Long ETFs)
        // - short: rawShortZ (+ = inflows to Short ETFs, matching button tooltip!)
        // - individual ETF: raw ETF Z (+ = inflows to that ETF)
        let val = 0;
        if (source === 'all') val = d.z;
        else if (source === 'long') val = d.longZ;
        else if (source === 'short') val = d.rawShortZ;
        else val = d.rawByTicker?.[source] ?? 0;

        // Contrarian divergence for this source against 5d NG return
        const bullVal = getSourceZ(d, source, true);
        let srcDivVal = 0;
        if (d.ng5d !== null && Math.abs(d.ng5d) >= 0.005 && Math.abs(bullVal) >= 0.3) {
            if ((bullVal > 0) !== (d.ng5d > 0)) {
                srcDivVal = bullVal > 0 ? Math.abs(bullVal) : -Math.abs(bullVal);
            }
        }

        const absV = Math.abs(val);
        let bg = '#1a1a28';
        let borderStyle = '1px solid rgba(255, 255, 255, 0.04)';
        let fgColor = 'rgba(255, 255, 255, 0.4)';
        let alpha = 0.15;
        let isDimmed = false;
        let cellPeaksClass = '';

        if (peaksMode) {
            if (absV < cutoff) {
                isDimmed = true;
                cellPeaksClass = ' heat-dim';
                bg = '#0b0b14';
                borderStyle = '1px solid transparent';
                fgColor = 'rgba(255, 255, 255, 0.08)';
            } else {
                windowPeakCount++;
                if (absV >= p99Cutoff) cellPeaksClass = ' heat-peak-extreme';
                else if (absV >= p95Cutoff) cellPeaksClass = ' heat-peak-significant';
                else cellPeaksClass = ' heat-peak-notable';
                bg = '';
                borderStyle = '';
                fgColor = '#fff';
            }
        } else {
            if ((mode === 'divergence' || mode === 'divergences') && srcDivVal === 0) {
                bg = '#1a1a28';
                borderStyle = '1px solid rgba(255, 255, 255, 0.02)';
                fgColor = 'rgba(255, 255, 255, 0.15)';
            } else if (absV >= 0.3) {
                alpha = Math.min(0.85, 0.22 + (absV / 2.0) * 0.63);
                const rColor = val >= 0 ? '61, 184, 122' : '239, 68, 68';
                bg = `rgba(${rColor}, ${alpha})`;
                borderStyle = `1px solid rgba(${rColor}, ${Math.min(1, alpha + 0.15)})`;
                fgColor = (alpha > 0.45) ? '#fff' : (val >= 0 ? '#3db87a' : '#ef4444');
            }
        }

        let badge = '';
        if (mode === 'unified' && srcDivVal !== 0 && !isDimmed) {
            const badgeColor = srcDivVal > 0 ? '#3db87a' : '#ef4444';
            badge = `<div class="flow-heat-badge" style="background:${badgeColor};"></div>`;
            if (!peaksMode) {
                borderStyle = `2px solid ${badgeColor}`;
            }
        }

        let shadowStyle = '';
        if (i === dataLength - 1) {
            shadowStyle = 'box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.85), 0 0 8px rgba(0, 229, 255, 0.25);';
        }

        html += `
            <div class="flow-heat-cell${cellPeaksClass}"
                 data-index="${i}"
                 style="position:relative; ${bg ? `background:${bg};` : ''} ${borderStyle ? `border:${borderStyle};` : ''} color:${fgColor}; ${shadowStyle}">
                 ${monthLabel}
                 ${day}
                 ${badge}
            </div>`;
    }

    html += '</div>';
    html += `<div id="flow-heat-tooltip" style="position:absolute; display:none; background:rgba(13,17,28,0.96); border:1px solid var(--border-primary); border-radius:6px; padding:10px 14px; font-size:0.72rem; color:var(--text-bright); pointer-events:none; z-index:100; box-shadow:0 8px 24px rgba(0,0,0,0.5); min-width:230px;"></div>`;
    elContainer.innerHTML = html;

    const peakBadge = document.getElementById('flow-heat-peaks-badge');
    if (peakBadge) {
        if (peaksMode) {
            peakBadge.textContent = `${windowPeakCount} ${windowPeakCount === 1 ? 'PEAK' : 'PEAKS'}`;
            peakBadge.classList.add('visible');
        } else {
            peakBadge.classList.remove('visible');
        }
    }

    setupFlowHeatTooltip();
}

function setupFlowHeatTooltip() {
    const container = document.getElementById('flow-activity-heat');
    const tooltip = document.getElementById('flow-heat-tooltip');
    if (!container || !tooltip) return;

    const source = state.flowHeatSource || 'all';
    const cells = container.querySelectorAll('.flow-heat-cell');

    cells.forEach(cell => {
        cell.addEventListener('mouseenter', () => {
            const idx = parseInt(cell.dataset.index);
            const d = state.compositeZ[idx];
            if (!d) return;

            let srcVal = d.z;
            if (source === 'long') srcVal = d.longZ;
            else if (source === 'short') srcVal = d.rawShortZ;
            else if (source !== 'all') srcVal = d.rawByTicker?.[source] ?? 0;

            const bullVal = getSourceZ(d, source, true);
            let srcDivVal = 0;
            if (d.ng5d !== null && Math.abs(d.ng5d) >= 0.005 && Math.abs(bullVal) >= 0.3) {
                if ((bullVal > 0) !== (d.ng5d > 0)) {
                    srcDivVal = bullVal > 0 ? Math.abs(bullVal) : -Math.abs(bullVal);
                }
            }

            const zColor = srcVal >= 0 ? '#3db87a' : '#ef4444';
            const isShortSrc = (source === 'short' || SHORT_TICKERS.includes(source));
            const zLabel = isShortSrc
                ? (srcVal >= 0 ? 'SHORT INFLOW (BEAR GAS)' : 'SHORT OUTFLOW (BULL GAS)')
                : (srcVal >= 0 ? 'INFLOW / UPWARD PRESSURE' : 'OUTFLOW / DOWNWARD PRESSURE');
            const zIntensity = Math.abs(srcVal) > 1.5 ? 'EXTREME' : Math.abs(srcVal) > 1 ? 'STRONG' : Math.abs(srcVal) > 0.5 ? 'MODERATE' : 'MILD';

            let divHtml = '';
            if (srcDivVal !== 0) {
                const divColor = srcDivVal > 0 ? '#3db87a' : '#ef4444';
                const divType = srcDivVal > 0 ? 'BULLISH DIVERGENCE (Leading)' : 'BEARISH DIVERGENCE (Leading)';
                const divDesc = srcDivVal > 0 ? 'Bullish flow positioning despite falling 5d gas prices' : 'Bearish flow positioning despite rising 5d gas prices';
                divHtml = `
                    <div style="margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
                        <div style="color:${divColor}; font-size:0.62rem; font-weight:800;">${divType}</div>
                        <div style="color:rgba(255,255,255,0.6); font-size:0.56rem; font-style:italic;">${divDesc}</div>
                    </div>`;
            } else if (d.ng5d !== null && Math.abs(bullVal) >= 0.3) {
                if ((bullVal > 0) === (d.ng5d > 0)) {
                    divHtml = `
                        <div style="margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
                            <div style="color:#94a3b8; font-size:0.6rem; font-weight:700;">○ REACTIVE / MOMENTUM FLOW</div>
                            <div style="color:rgba(255,255,255,0.5); font-size:0.56rem; font-style:italic;">Capital aligned with 5d price momentum</div>
                        </div>`;
                }
            }

            const ngClose = d.ngPrice !== undefined ? d.ngPrice : state.ngHistory[d.date];
            const ng5dStr = d.ng5d !== null ? `${d.ng5d >= 0 ? '+' : ''}${(d.ng5d * 100).toFixed(1)}%` : '—';
            const ng5dColor = d.ng5d === null ? '#94a3b8' : d.ng5d >= 0 ? '#3db87a' : '#ef4444';

            const etfs = d.rawByTicker || {};
            const fmtEtf = (tk) => {
                const v = etfs[tk];
                if (v === undefined) return `<span style="color:rgba(255,255,255,0.3);">—</span>`;
                return `<span style="font-family:'JetBrains Mono'; font-weight:700; color:${v >= 0 ? '#3db87a' : '#ef4444'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}</span>`;
            };

            const etfHtml = `
                <div style="margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06); display:grid; grid-template-columns:1fr 1fr; gap:3px 12px;">
                    <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">BOIL: ${fmtEtf('BOIL')}</div>
                    <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">KOLD: ${fmtEtf('KOLD')}</div>
                    <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">HNU: ${fmtEtf('HNU')}</div>
                    <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">HND: ${fmtEtf('HND')}</div>
                    <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">3NGL: ${fmtEtf('3NGL')}</div>
                    <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">3NGS: ${fmtEtf('3NGS')}</div>
                </div>`;

            tooltip.innerHTML = `
                <div style="color:var(--cyan); font-size:0.7rem; font-weight:800; margin-bottom:4px;">${fmtDateLong(d.date)}</div>
                <div style="font-size:0.54rem; color:rgba(255,255,255,0.45); margin-bottom:3px;">${getSourceLabel(source, false)}</div>
                <div style="display:flex; justify-content:space-between; gap:16px;">
                    <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">SELECTED Z</span>
                    <span style="color:${zColor}; font-weight:800; font-family:'JetBrains Mono',monospace;">${srcVal >= 0 ? '+' : ''}${srcVal.toFixed(2)}σ</span>
                </div>
                <div style="color:${zColor}; font-size:0.58rem; font-weight:700; margin-top:2px;">${zIntensity} · ${zLabel}</div>

                <div style="display:flex; justify-content:space-between; gap:16px; margin-top:3px;">
                    <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">COMPOSITE (6-ETF)</span>
                    <span style="color:${d.z >= 0 ? '#3db87a' : '#ef4444'}; font-size:0.6rem; font-weight:700; font-family:'JetBrains Mono';">${d.z >= 0 ? '+' : ''}${d.z.toFixed(2)}σ</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:16px; margin-top:2px;">
                    <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">LONG / SHORT RAW Z</span>
                    <span style="font-size:0.6rem; font-weight:700; font-family:'JetBrains Mono';"><span style="color:#F5C542;">${d.longZ >= 0 ? '+' : ''}${d.longZ.toFixed(2)}</span> / <span style="color:#4A9CF5;">${d.rawShortZ >= 0 ? '+' : ''}${d.rawShortZ.toFixed(2)}</span></span>
                </div>

                <div style="display:flex; justify-content:space-between; gap:16px; margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
                    <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">NG=F PRICE</span>
                    <span style="color:#4ab8d8; font-weight:700; font-family:'JetBrains Mono';">${ngClose != null ? '$' + ngClose.toFixed(3) : '—'}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:16px; margin-top:2px;">
                    <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">NG 5D RETURN</span>
                    <span style="color:${ng5dColor}; font-weight:700; font-family:'JetBrains Mono';">${ng5dStr}</span>
                </div>

                ${divHtml}
                ${etfHtml}
            `;

            tooltip.style.display = 'block';

            const tooltipWidth = tooltip.offsetWidth;
            const tooltipHeight = tooltip.offsetHeight;
            const cellLeft = cell.offsetLeft;
            const cellTop = cell.offsetTop;
            const cellWidth = cell.offsetWidth;
            const cellHeight = cell.offsetHeight;

            let tx = cellLeft + cellWidth / 2 - tooltipWidth / 2;
            let ty = cellTop - tooltipHeight - 10;
            if (ty < 5) ty = cellTop + cellHeight + 10;

            const containerWidth = container.offsetWidth;
            if (tx < 5) tx = 5;
            if (tx + tooltipWidth > containerWidth - 5) tx = containerWidth - tooltipWidth - 5;

            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
        });

        cell.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });
}

function handleFlowNGHover(e) {
    const cvs = el('chartFlowNG');
    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const flow = getFlowNGVisible();
    if (!flow.length) return;

    const padL = 55, padR = 60;
    const chartW = rect.width - padL - padR;
    const tip = el('flowng-tooltip');

    if (x >= padL && x <= rect.width - padR) {
        const pct = (x - padL) / chartW;
        let idx = Math.round(pct * (flow.length - 1));
        idx = Math.max(0, Math.min(idx, flow.length - 1));
        state.hoverFlowNGIdx = idx;

        const d = flow[idx];
        const src = state.flowNGSource || 'all';
        const compZ = getSourceZ(d, src, true);
        const ngPrice = d.ngPrice !== undefined ? d.ngPrice : ngPriceAt(d.date);
        const cached = state.divValsCache[idx] || { signed: 0, ng5d: null };
        const divVal = cached.signed;
        const ng5d = cached.ng5d;

        const isContrarian = divVal !== 0;
        const divCol = divVal > 0 ? '#3db87a' : divVal < 0 ? '#ef4444' : 'rgba(148,163,184,0.5)';

        let statusText, statusColor;
        if (divVal > 0) {
            statusText = '▲ CONTRARIAN DIP FLOW (MEAN REVERSION / TACTICAL BOUNCE WATCH)';
            statusColor = '#3db87a';
        } else if (divVal < 0) {
            statusText = '▼ BEARISH DIVERGENCE / SMART MONEY FADE (FADING STRENGTH)';
            statusColor = '#ef4444';
        } else {
            statusText = '○ REACTIVE / ALIGNED — Flow following recent price move';
            statusColor = 'rgba(148,163,184,0.5)';
        }

        const ng5dRow = ng5d !== null ? `
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">NG 5-Session Move</span>
                <span style="font-family:monospace; font-weight:700; color:${ng5d >= 0 ? '#3db87a' : '#ef4444'};">${ng5d >= 0 ? '+' : ''}${(ng5d * 100).toFixed(1)}%</span>
            </div>` : '';

        tip.style.display = 'block';
        tip.innerHTML = `
            <div style="color:#00ffff; font-weight:800; margin-bottom:4px; font-size:0.68rem;">${fmtDateLong(d.date)}</div>
            <div style="font-size:0.55rem; color:rgba(255,255,255,0.45); margin-bottom:4px;">${getSourceLabel(src, true)}</div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">Divergence Signal</span>
                <span style="font-family:monospace; font-weight:800; color:${divCol};">${isContrarian ? (divVal >= 0 ? '+' : '') + divVal.toFixed(2) + 'σ' : 'FLAT (reactive)'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">Gas-Aligned Z</span>
                <span style="font-family:monospace; font-weight:700; color:${compZ >= 0 ? '#3db87a' : '#ef4444'};">${compZ >= 0 ? '+' : ''}${compZ.toFixed(2)}σ</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">NG=F Price</span>
                <span style="font-family:monospace; font-weight:700; color:#38bdf8;">${ngPrice !== null ? '$' + ngPrice.toFixed(2) : '—'}</span>
            </div>
            ${ng5dRow}
            <div style="font-size:0.58rem; color:${statusColor}; font-weight:700; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px; margin-top:3px;">${statusText}</div>
        `;

        const wrapLeft = cvs.parentElement.getBoundingClientRect().left;
        let tx = (e.clientX - wrapLeft) + 15;
        if (tx + 230 > cvs.parentElement.offsetWidth) tx = (e.clientX - wrapLeft) - 230 - 10;
        tip.style.left = Math.max(4, tx) + 'px';
        tip.style.top = Math.max(0, e.clientY - rect.top - 30) + 'px';
    } else {
        hideFlowNGHover();
    }
    drawChartFlowNG(flow);
}

function hideFlowNGHover() {
    state.hoverFlowNGIdx = null;
    const tip = el('flowng-tooltip');
    if (tip) tip.style.display = 'none';
    const flow = getFlowNGVisible();
    if (flow && flow.length > 1) drawChartFlowNG(flow);
}

// ── FlowNG Range Slider ──
function initFlowNGSlider() {
    const s1 = el('flowng-range-start'), s2 = el('flowng-range-end');
    if (!s1 || !s2) return;
    const onChange = (e) => {
        let v1 = parseInt(s1.value), v2 = parseInt(s2.value);
        if (v1 >= v2) {
            if (e.target.id === 'flowng-range-start') s1.value = Math.max(0, v2 - 1);
            else s2.value = Math.min(parseInt(s2.max), v1 + 1);
            v1 = parseInt(s1.value); v2 = parseInt(s2.value);
        }
        const max = parseInt(s1.max) || 1;
        state.zoomFlowNG.start = v1 / max;
        state.zoomFlowNG.end   = v2 / max;
        document.querySelectorAll('#flowng-time-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        updateFlowNGSliderUI();
        renderFlowNGChart();
    };
    s1.addEventListener('input', onChange);
    s2.addEventListener('input', onChange);
}

function syncFlowNGSlider() {
    const s1 = el('flowng-range-start'), s2 = el('flowng-range-end');
    if (!s1 || !s2) return;
    const base = getFlowNGBase();
    const total = base.length || 1;
    s1.max = total; s2.max = total;
    s1.value = Math.round(state.zoomFlowNG.start * total);
    s2.value = Math.round(state.zoomFlowNG.end * total);
    updateFlowNGSliderUI();
}

function updateFlowNGSliderUI() {
    const s1 = el('flowng-range-start'), s2 = el('flowng-range-end');
    const hl = el('flowng-range-highlight'), lbl = el('flowng-range-label');
    if (!s1 || !s2) return;
    const v1 = parseInt(s1.value), v2 = parseInt(s2.value), max = parseInt(s1.max) || 1;
    const p1 = v1 / max, p2 = v2 / max;
    if (hl) {
        hl.style.left  = `calc(${p1 * 100}% + ${(10 - p1 * 20)}px)`;
        hl.style.width = `calc(${(p2 - p1) * 100}% + ${(p1 - p2) * 20}px)`;
    }
    if (lbl) {
        const z = state.zoomFlowNG;
        lbl.textContent = (z.start > 0.001 || z.end < 0.999) ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}

/* =========================================================================
   Section 6.1b-2: Flow Acceleration & Exhaustion Engine
   ========================================================================= */

function renderFlowVelChart() {
    const flow = getFlowVelVisible();
    if (!flow || flow.length < 2) return;
    drawChartFlowVelocity(flow);
}

function drawChartFlowVelocity(flow) {
    const cvs = el('chartFlowVelocity');
    if (!cvs || !ctxFlowVel) return;
    const { w, h, dpr } = resizeCanvas(cvs);
    ctxFlowVel.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxFlowVel.clearRect(0, 0, w, h);

    const pad = { top: 22, right: 60, bottom: 32, left: 55 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const n = flow.length;
    const getX = i => pad.left + (i / (n - 1)) * chartW;
    const src = state.flowVelSource || 'all';
    const ngPrices = flow.map(d => d.ngPrice !== undefined ? d.ngPrice : ngPriceAt(d.date));

    // Read full-history precomputed velocity Z-scores and 30d high/low exhaustion zones
    const velVals = [];
    for (let i = 0; i < n; i++) {
        const f = flow[i];
        const vObj = f.velBySource?.[src] || f.velBySource?.['all'] || { vel1d: 0, vel3d: 0, velZ1d: 0, velZ3d: 0, velZ3dSmooth: 0 };
        const z1 = vObj.velZ1d;
        const z3 = vObj.velZ3d;
        const z3Smooth = vObj.velZ3dSmooth;

        const isHigh30 = !!f.isHigh30;
        const isLow30  = !!f.isLow30;

        let exZone = null;
        if (isHigh30 && (z3 < -0.5 || z1 >= 1.5 || f.longZ >= 1.5)) {
            exZone = 'long'; // Price near 30d high while flow velocity drains or parabolic climax -> Buyer Exhaustion / Climax
        } else if (isLow30 && (f.rawShortZ > 1.5 || z1 <= -1.5 || f.longZ <= -1.5)) {
            exZone = 'short'; // Price near 30d low while Short inflows > +1.5σ or long panic purge -> Capitulation / Short Crowding
        }

        let timingStatus = 'NEUTRAL';
        let timingDesc = 'No extreme flow velocity trigger.';
        // CRITICAL FIX: Evaluate extreme price exhaustion and climax BEFORE raw velocity
        // Prevents calling blow-off tops 'LONG ACCELERATION' and capitulation bottoms 'SHORT ACCELERATION'
        if (isHigh30 && (z1 >= 1.5 || f.longZ >= 1.8)) {
            timingStatus = 'BUYER CLIMAX (EXIT LONGS)';
            timingDesc = 'Inflow velocity surge into 30-day highs — historically precedes upward momentum exhaustion.';
        } else if (isLow30 && (z1 <= -1.5 || f.longZ <= -1.5)) {
            timingStatus = 'SELLER CAPITULATION (REBOUND WATCH)';
            timingDesc = 'Heavy outflows at 30-day price lows — historically indicates seller exhaustion and potential 3–5 day rebound.';
        } else if (exZone === 'long' && z3 < -0.5) {
            timingStatus = 'BUYER EXHAUSTION WARNING (DISTRIBUTION)';
            timingDesc = 'NG=F near 30-day high while 3-day flow velocity is draining (<−0.5σ) — distribution divergence.';
        } else if (exZone === 'short' && f.rawShortZ > 1.5) {
            timingStatus = 'SHORT CROWDING EXHAUSTION (SQUEEZE RISK)';
            timingDesc = 'NG=F near 30-day low while Short ETF inflows exceed +1.5σ — late short crowding; high squeeze risk.';
        } else if (z1 >= 2.0) {
            timingStatus = 'TREND FLOW ACCELERATION (MOMENTUM)';
            timingDesc = 'Institutional buying velocity surge (≥+2.0σ) in trend alignment — confirms upward flow momentum.';
        } else if (z1 <= -2.0) {
            timingStatus = 'TREND FLOW BREAKDOWN (DOWNSIDE)';
            timingDesc = 'Aggressive downside/outflow velocity spike (≤−2.0σ) in trend alignment — confirms breakdown momentum.';
        }

        velVals.push({
            vel1d: vObj.vel1d,
            vel3d: vObj.vel3d,
            velZ1d: z1,
            velZ3d: z3,
            velZ3dSmooth: z3Smooth,
            longZ: f.longZ,
            shortZ: f.shortZ,
            rawShortZ: f.rawShortZ,
            exZone,
            timingStatus,
            timingDesc
        });
    }
    state.velValsCache = velVals;

    const maxAbsZ = Math.max(...velVals.map(d => Math.max(Math.abs(d.velZ1d), Math.abs(d.velZ3d))), 2.5);
    const zBound  = Math.min(Math.max(maxAbsZ * 1.15, 2.5), 4.2);
    const getZY   = val => pad.top + chartH / 2 - (val / zBound) * (chartH / 2);
    const y0      = getZY(0);

    const validNG = ngPrices.filter(p => p !== null);
    const ngMin = validNG.length ? Math.min(...validNG) * 0.95 : 1;
    const ngMax = validNG.length ? Math.max(...validNG) * 1.05 : 10;
    const ngRange = Math.max(ngMax - ngMin, 0.1);
    const getNGY = val => pad.top + chartH - ((val - ngMin) / ngRange) * chartH;

    // ── 1. Draw Exhaustion Zone Background Bands ──
    const sliceW = Math.max(chartW / n, 1.5);
    const bandAlpha = n > 600 ? 0.08 : 0.15;
    for (let i = 0; i < n; i++) {
        if (velVals[i].exZone) {
            const x = getX(i) - sliceW / 2;
            ctxFlowVel.fillStyle = velVals[i].exZone === 'long'
                ? `rgba(245, 158, 11, ${bandAlpha})`
                : `rgba(168, 85, 247, ${bandAlpha + 0.04})`;
            ctxFlowVel.fillRect(x, pad.top, sliceW + 0.5, chartH);
        }
    }

    // ── 2. Threshold lines (±2.0σ & ±1.0σ) ──
    [2.0, 1.0, -1.0, -2.0].forEach(z => {
        const y = getZY(z);
        if (y < pad.top || y > pad.top + chartH) return;
        ctxFlowVel.beginPath();
        ctxFlowVel.moveTo(pad.left, y);
        ctxFlowVel.lineTo(pad.left + chartW, y);
        ctxFlowVel.strokeStyle = Math.abs(z) === 2.0
            ? (z > 0 ? 'rgba(61,184,122,0.35)' : 'rgba(239,68,68,0.35)')
            : 'rgba(255,255,255,0.06)';
        ctxFlowVel.lineWidth = 0.8;
        ctxFlowVel.setLineDash([4, 3]);
        ctxFlowVel.stroke();
        ctxFlowVel.setLineDash([]);
    });

    // Zero line
    ctxFlowVel.beginPath();
    ctxFlowVel.moveTo(pad.left, y0);
    ctxFlowVel.lineTo(pad.left + chartW, y0);
    ctxFlowVel.strokeStyle = 'rgba(255,255,255,0.18)';
    ctxFlowVel.lineWidth = 1;
    ctxFlowVel.stroke();

    // ── 3. Draw 1D Velocity Z Bars ──
    const barW = Math.max(Math.min(chartW / n * 0.65, 6), 1.0);
    for (let i = 0; i < n; i++) {
        const z1 = velVals[i].velZ1d;
        if (Math.abs(z1) < 0.2) continue;
        const x = getX(i) - barW / 2;
        const barY = getZY(z1);
        const absZ = Math.abs(z1);

        if (z1 > 0) {
            const alpha = absZ >= 2.0 ? 0.92 : (0.28 + Math.min(absZ / 2, 1) * 0.42);
            ctxFlowVel.fillStyle = `rgba(61, 184, 122, ${alpha.toFixed(2)})`;
            ctxFlowVel.fillRect(x, barY, barW, y0 - barY);
        } else {
            const alpha = absZ >= 2.0 ? 0.92 : (0.28 + Math.min(absZ / 2, 1) * 0.42);
            ctxFlowVel.fillStyle = `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
            ctxFlowVel.fillRect(x, y0, barW, barY - y0);
        }
    }

    // ── 4. Draw 3D Velocity Z Line (adaptive smoothing when N > 400 to prevent visual wall) ──
    const useSmooth3d = n > 400;
    ctxFlowVel.beginPath();
    ctxFlowVel.strokeStyle = useSmooth3d ? 'rgba(74, 184, 216, 0.88)' : '#4ab8d8';
    ctxFlowVel.lineWidth = useSmooth3d ? 1.5 : 2.0;
    for (let i = 0; i < n; i++) {
        const x = getX(i);
        const v3 = useSmooth3d ? velVals[i].velZ3dSmooth : velVals[i].velZ3d;
        const y = getZY(v3);
        if (i === 0) ctxFlowVel.moveTo(x, y);
        else ctxFlowVel.lineTo(x, y);
    }
    ctxFlowVel.stroke();

    // ── 5. Draw NG=F Price Line (Right Axis) ──
    if (validNG.length > 0) {
        ctxFlowVel.beginPath();
        ctxFlowVel.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctxFlowVel.lineWidth = 1.3;
        ctxFlowVel.setLineDash([2, 2]);
        let started = false;
        for (let i = 0; i < n; i++) {
            if (ngPrices[i] === null) continue;
            const x = getX(i), y = getNGY(ngPrices[i]);
            if (!started) { ctxFlowVel.moveTo(x, y); started = true; }
            else ctxFlowVel.lineTo(x, y);
        }
        ctxFlowVel.stroke();
        ctxFlowVel.setLineDash([]);
    }

    // ── Left Y-axis labels ──
    ctxFlowVel.font = '9px monospace';
    ctxFlowVel.textAlign = 'right';
    ctxFlowVel.textBaseline = 'middle';
    [-2.0, -1.0, 0, 1.0, 2.0].forEach(t => {
        if (Math.abs(t) > zBound) return;
        const y = getZY(t);
        if (y < pad.top + 4 || y > pad.top + chartH - 4) return;
        ctxFlowVel.fillStyle = t >= 2.0 ? 'rgba(61,184,122,0.85)' : t <= -2.0 ? 'rgba(239,68,68,0.85)' : 'rgba(148,163,184,0.5)';
        ctxFlowVel.fillText((t >= 0 ? '+' : '') + t.toFixed(1) + 'σ', pad.left - 5, y);
    });

    // ── Right Y-axis labels (NG=F Price) ──
    if (validNG.length > 0) {
        const ngTicks = niceAxisTicks(ngMin, ngMax, 5);
        ctxFlowVel.textAlign = 'left';
        ngTicks.forEach(tick => {
            const y = getNGY(tick);
            if (y < pad.top + 4 || y > pad.top + chartH - 4) return;
            ctxFlowVel.fillStyle = 'rgba(255,255,255,0.55)';
            ctxFlowVel.fillText('$' + tick.toFixed(tick >= 10 ? 1 : 2), w - pad.right + 6, y);
        });
    }

    // ── X-axis ──
    drawXAxis(ctxFlowVel, flow.map(d => d.date), getX, chartW, pad.top + chartH + 14, pad);

    // ── Hover crosshair ──
    if (state.hoverFlowVelIdx !== null && state.hoverFlowVelIdx >= 0 && state.hoverFlowVelIdx < n) {
        const hi = state.hoverFlowVelIdx;
        const hx = getX(hi);

        ctxFlowVel.beginPath();
        ctxFlowVel.moveTo(hx, pad.top);
        ctxFlowVel.lineTo(hx, pad.top + chartH);
        ctxFlowVel.strokeStyle = 'rgba(0,255,255,0.25)';
        ctxFlowVel.lineWidth = 1;
        ctxFlowVel.stroke();

        const v = velVals[hi];
        ctxFlowVel.beginPath();
        ctxFlowVel.arc(hx, getZY(useSmooth3d ? v.velZ3dSmooth : v.velZ3d), 4, 0, Math.PI * 2);
        ctxFlowVel.fillStyle = '#4ab8d8';
        ctxFlowVel.fill();
        ctxFlowVel.strokeStyle = '#fff';
        ctxFlowVel.lineWidth = 1.2;
        ctxFlowVel.stroke();
    }
}

function handleFlowVelocityHover(e) {
    const cvs = el('chartFlowVelocity');
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const flow = getFlowVelVisible();
    if (!flow.length) return;

    const padL = 55, padR = 60;
    const chartW = rect.width - padL - padR;
    const tip = el('flowvel-tooltip');

    if (x >= padL && x <= rect.width - padR) {
        const pct = (x - padL) / chartW;
        let idx = Math.round(pct * (flow.length - 1));
        idx = Math.max(0, Math.min(idx, flow.length - 1));
        state.hoverFlowVelIdx = idx;

        const d = flow[idx];
        const v = state.velValsCache[idx];
        const ngPrice = d.ngPrice !== undefined ? d.ngPrice : ngPriceAt(d.date);
        const src = state.flowVelSource || 'all';
        if (!v) return;

        let badgeCol = '#94a3b8';
        if (v.timingStatus.includes('BUYER CLIMAX') || v.timingStatus.includes('BUYER EXHAUSTION')) badgeCol = '#f59e0b';
        else if (v.timingStatus.includes('CAPITULATION SQUEEZE')) badgeCol = '#00e5ff';
        else if (v.timingStatus.includes('SHORT CROWDING')) badgeCol = '#a855f7';
        else if (v.timingStatus.includes('TREND FLOW ACCELERATION') || v.timingStatus.includes('LONG ACCELERATION')) badgeCol = '#3db87a';
        else if (v.timingStatus.includes('TREND FLOW BREAKDOWN') || v.timingStatus.includes('SHORT ACCELERATION')) badgeCol = '#ef4444';

        tip.style.display = 'block';
        tip.innerHTML = `
            <div style="color:#00e5ff; font-weight:800; font-size:0.68rem; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:3px;">${fmtDateLong(d.date)}</div>
            <div style="font-size:0.55rem; color:rgba(255,255,255,0.45); margin-bottom:4px;">${getSourceLabel(src, false)}</div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">1D Velocity Z</span>
                <span style="font-family:monospace; font-weight:800; color:${v.velZ1d >= 0 ? '#3db87a' : '#ef4444'};">${v.velZ1d >= 0 ? '+' : ''}${v.velZ1d.toFixed(2)}σ</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">3D Velocity Z</span>
                <span style="font-family:monospace; font-weight:800; color:#4ab8d8;">${v.velZ3d >= 0 ? '+' : ''}${v.velZ3d.toFixed(2)}σ</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:2px;">
                <span style="color:var(--text-dim);">NG=F Price</span>
                <span style="font-family:monospace; font-weight:700; color:#fff;">${ngPrice !== null ? '$' + ngPrice.toFixed(2) : '—'}</span>
            </div>
            ${v.exZone === 'long' ? `<div style="font-size:0.6rem; color:#f59e0b; font-weight:700; margin-top:2px;">Buyer Exhaustion Zone (30d Price High + Draining Flow)</div>` : ''}
            ${v.exZone === 'short' ? `<div style="font-size:0.6rem; color:#a855f7; font-weight:700; margin-top:2px;">Short Crowding Zone (Short Raw Z: +${v.rawShortZ.toFixed(2)}σ at 30d Low)</div>` : ''}
            <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:4px; margin-top:4px;">
                <div style="font-size:0.62rem; font-weight:800; color:${badgeCol};">${v.timingStatus}</div>
                <div style="font-size:0.56rem; color:rgba(255,255,255,0.6); margin-top:2px; line-height:1.3;">${v.timingDesc}</div>
            </div>
        `;

        const wrapLeft = cvs.parentElement.getBoundingClientRect().left;
        let tx = (e.clientX - wrapLeft) + 15;
        if (tx + 245 > cvs.parentElement.offsetWidth) tx = (e.clientX - wrapLeft) - 245 - 10;
        tip.style.left = Math.max(4, tx) + 'px';
        tip.style.top = Math.max(0, e.clientY - rect.top - 30) + 'px';
    } else {
        hideFlowVelocityHover();
    }
    drawChartFlowVelocity(flow);
}

function hideFlowVelocityHover() {
    state.hoverFlowVelIdx = null;
    const tip = el('flowvel-tooltip');
    if (tip) tip.style.display = 'none';
    const flow = getFlowVelVisible();
    if (flow && flow.length > 1) drawChartFlowVelocity(flow);
}

function initFlowVelSlider() {
    const s1 = el('flowvel-range-start'), s2 = el('flowvel-range-end');
    if (!s1 || !s2) return;
    const onChange = (e) => {
        let v1 = parseInt(s1.value), v2 = parseInt(s2.value);
        if (v1 >= v2) {
            if (e.target.id === 'flowvel-range-start') s1.value = Math.max(0, v2 - 1);
            else s2.value = Math.min(parseInt(s2.max), v1 + 1);
            v1 = parseInt(s1.value); v2 = parseInt(s2.value);
        }
        const max = parseInt(s1.max) || 1;
        state.zoomFlowVel.start = v1 / max;
        state.zoomFlowVel.end   = v2 / max;
        document.querySelectorAll('#flowvel-time-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        updateFlowVelSliderUI();
        renderFlowVelChart();
    };
    s1.addEventListener('input', onChange);
    s2.addEventListener('input', onChange);
}

function syncFlowVelSlider() {
    const s1 = el('flowvel-range-start'), s2 = el('flowvel-range-end');
    if (!s1 || !s2) return;
    const base = getFlowVelBase();
    const total = base.length || 1;
    s1.max = total; s2.max = total;
    s1.value = Math.round(state.zoomFlowVel.start * total);
    s2.value = Math.round(state.zoomFlowVel.end * total);
    updateFlowVelSliderUI();
}

function updateFlowVelSliderUI() {
    const s1 = el('flowvel-range-start'), s2 = el('flowvel-range-end');
    const hl = el('flowvel-range-highlight'), lbl = el('flowvel-range-label');
    if (!s1 || !s2) return;
    const v1 = parseInt(s1.value), v2 = parseInt(s2.value), max = parseInt(s1.max) || 1;
    const p1 = v1 / max, p2 = v2 / max;
    if (hl) {
        hl.style.left  = `calc(${p1 * 100}% + ${(10 - p1 * 20)}px)`;
        hl.style.width = `calc(${(p2 - p1) * 100}% + ${(p1 - p2) * 20}px)`;
    }
    if (lbl) {
        const z = state.zoomFlowVel;
        lbl.textContent = (z.start > 0.001 || z.end < 0.999) ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}