// ============================================================
// Flow Composite Charts — Composite Z-Score + Flow vs NG Price
// ============================================================

const SHORT_TICKERS = ['KOLD', 'HND', '3NGS'];

// ---- Computation ----
function computeCompositeZ() {
    const tickers = ['BOIL','HNU','3NGL','KOLD','HND','3NGS'];
    const dateMap = {};
    const rawDateMap = {};
    tickers.forEach(tk => {
        const d = state.cache[tk];
        if (!d || !d.data) return;
        d.data.forEach(row => {
            if (!dateMap[row.date]) dateMap[row.date] = {};
            if (!rawDateMap[row.date]) rawDateMap[row.date] = {};
            const z = row.flow_zscore || 0;
            dateMap[row.date][tk] = SHORT_TICKERS.includes(tk) ? -z : z;
            rawDateMap[row.date][tk] = z;
        });
    });
    const dates = Object.keys(dateMap).sort();
    const ngDateIdx = {};
    if (state.ngDates) state.ngDates.forEach((d, i) => { ngDateIdx[d] = i; });

    state.compositeZ = dates.map(date => {
        const vals = dateMap[date];
        const rawVals = rawDateMap[date];
        const zArr = Object.values(vals);
        if (zArr.length === 0) return { date, z: 0, count: 0, longZ: 0, shortZ: 0, divVal: 0, ng5d: null, etfs: {} };
        const avg = zArr.reduce((a, b) => a + b, 0) / zArr.length;
        const longZ = tickers.filter(t => !SHORT_TICKERS.includes(t))
            .map(t => vals[t] || 0).reduce((a,b) => a+b, 0) / 3;
        const shortZ = SHORT_TICKERS
            .map(t => vals[t] || 0).reduce((a,b) => a+b, 0) / 3;

        // Pre-compute divergence
        let divVal = 0;
        let ng5d = null;
        const ni = ngDateIdx[date];
        if (ni !== undefined && ni >= 5) {
            const p0 = state.ngHistory[state.ngDates[ni - 5]];
            const p1 = state.ngHistory[state.ngDates[ni]];
            if (p0 && p1 && p0 !== 0) {
                ng5d = (p1 - p0) / p0;
                if (Math.abs(ng5d) >= 0.005 && Math.abs(avg) >= 0.3) {
                    const flowUp = avg > 0;
                    const ngUp = ng5d > 0;
                    if (flowUp !== ngUp) {
                        divVal = flowUp ? Math.abs(avg) : -Math.abs(avg);
                    }
                }
            }
        }

        return { 
            date, 
            z: Math.round(avg * 10000) / 10000, 
            longZ: Math.round(longZ*1e4)/1e4, 
            shortZ: Math.round(shortZ*1e4)/1e4, 
            count: zArr.length,
            divVal,
            ng5d,
            etfs: rawVals
        };
    });
    updateCompZReading();
}

function computeFlowHeatGlobalPercentiles() {
    state.flowHeatGlobalPercentiles = {};
    ['all', 'long', 'short'].forEach(source => {
        const vals = state.compositeZ.map(d => {
            if (source === 'all') return Math.abs(d.z || 0);
            if (source === 'long') return Math.abs(d.longZ || 0);
            if (source === 'short') return Math.abs(d.shortZ || 0);
            return 0;
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

function updateCompZReading() {
    const cz = state.compositeZ;
    if (!cz || cz.length === 0) return;
    const last = cz[cz.length - 1];
    const container = document.getElementById('comp-z-current');
    if (!container) return;
    const z = last.z;
    const isUp = z > 0.15, isDown = z < -0.15;
    const color = isUp ? '#3db87a' : isDown ? '#ef4444' : '#94a3b8';
    const label = isUp ? 'UPWARD PRESSURE' : isDown ? 'DOWNWARD PRESSURE' : 'EQUILIBRIUM';
    const intensity = Math.abs(z) > 1.5 ? 'EXTREME' : Math.abs(z) > 1 ? 'STRONG' : Math.abs(z) > 0.5 ? 'MODERATE' : 'MILD';
    container.innerHTML = `
        <div class="comp-z-dot" style="color:${color}; background:${color};"></div>
        <div>
            <div class="comp-z-value" style="color:${color};">${z >= 0 ? '+' : ''}${z.toFixed(2)}σ</div>
            <div class="comp-z-label" style="color:${color};">${label}</div>
            <div class="comp-z-sublabel">${intensity} · ${last.count} ETFs contributing</div>
        </div>
        <div style="flex:1;"></div>
        <div class="comp-z-date">${fmtDateLong(last.date)}</div>
    `;
}

function loadNGHistory() {
    const ng = state.summary && state.summary.ng_history;
    if (!ng || ng.length === 0) return;
    state.ngHistory = {};
    state.ngDates = [];
    ng.forEach(d => { state.ngHistory[d.date] = d.close; state.ngDates.push(d.date); });
}

// ---- Visible Data Helpers ----
function getCompZVisible() {
    const cz = state.compositeZ;
    if (!cz || cz.length === 0) return [];
    const base = applyTimeFilter(cz);
    const z = state.zoomCompZ;
    const s = Math.floor(z.start * base.length);
    const e = Math.ceil(z.end * base.length);
    return base.slice(s, e);
}

function getFlowNGVisible() {
    const cz = state.compositeZ;
    if (!cz || cz.length === 0) return { flow: [], ng: [] };
    const base = applyTimeFilter(cz);
    const z = state.zoomFlowNG;
    const s = Math.floor(z.start * base.length);
    const e = Math.ceil(z.end * base.length);
    const flow = base.slice(s, e);
    const ng = flow.map(f => ({ date: f.date, close: state.ngHistory[f.date] || null }));
    return { flow, ng };
}

function applyTimeFilter(data) {
    if (!data || data.length === 0) return [];
    if (state.timeRange === 'all') return data;
    const map = { '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365, '2y': 730, '3y': 1095, '5y': 1825 };
    const days = map[state.timeRange];
    if (!days) return data;
    const lastDateStr = data[data.length - 1].date;
    const refDate = new Date(lastDateStr + 'T12:00:00Z');
    refDate.setDate(refDate.getDate() - days);
    const cutStr = refDate.toISOString().split('T')[0];
    return data.filter(d => d.date >= cutStr);
}

// ---- Nice axis ticks ----
function niceAxisTicks(min, max, targetCount) {
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    const rough = range / targetCount;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const nice = [1, 2, 2.5, 5, 10].find(n => n * mag >= rough) * mag;
    const lo = Math.floor(min / nice) * nice;
    const hi = Math.ceil(max / nice) * nice;
    const ticks = [];
    for (let v = lo; v <= hi + nice * 0.01; v += nice) ticks.push(Math.round(v * 1e8) / 1e8);
    return ticks;
}

// ---- Draw Composite Z Chart ----
function renderCompZChart() {
    const data = getCompZVisible();
    if (!data || data.length < 2) return;
    drawChartCompZ(data);
}

function drawChartCompZ(data) {
    const cvs = el('chartCompZ');
    const { w, h, dpr } = resizeCanvas(cvs);
    const ctx = ctxCompZ;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 20, right: 20, bottom: 32, left: 50 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    if (cw < 20 || ch < 20) return;

    const dates = data.map(d => d.date);
    const vals = data.map(d => d.z);
    let minZ = Math.min(...vals, -1.6);
    let maxZ = Math.max(...vals, 1.6);
    const zPad = (maxZ - minZ) * 0.08;
    minZ -= zPad; maxZ += zPad;

    const getX = i => pad.left + (i / (data.length - 1)) * cw;
    const getY = v => pad.top + (1 - (v - minZ) / (maxZ - minZ)) * ch;
    const y0 = getY(0);

    // Multi-level threshold zones — subtle background only for extremes
    const zones = [
        { z: 2.0, rn: 192, gn: 64,  bn: 64,  rp: 34,  gp: 197, bp: 94,  a: 0.06 },
        { z: 1.5, rn: 239, gn: 68,  bn: 68,  rp: 61,  gp: 184, bp: 122, a: 0.03 },
    ];
    zones.forEach((z, i) => {
        const yP = getY(z.z), yN = getY(-z.z);
        const prevZVal = i === 0 ? maxZ : zones[i - 1].z;
        const yPEdge = getY(prevZVal), yNEdge = getY(-prevZVal);
        if (z.z <= maxZ) {
            ctx.fillStyle = `rgba(${z.rp},${z.gp},${z.bp},${z.a})`;
            ctx.fillRect(pad.left, Math.max(pad.top, yP), cw, Math.min(yPEdge, y0) - Math.max(pad.top, yP));
        }
        if (-z.z >= minZ) {
            ctx.fillStyle = `rgba(${z.rn},${z.gn},${z.bn},${z.a})`;
            ctx.fillRect(pad.left, Math.max(y0, yNEdge), cw, Math.min(pad.top + ch, yN) - Math.max(y0, yNEdge));
        }
    });

    // Gradient fill under line
    ctx.beginPath();
    ctx.moveTo(getX(0), y0);
    for (let i = 0; i < data.length; i++) ctx.lineTo(getX(i), getY(vals[i]));
    ctx.lineTo(getX(data.length - 1), y0);
    ctx.closePath();
    ctx.save(); ctx.clip();
    const gUp = ctx.createLinearGradient(0, pad.top, 0, y0);
    gUp.addColorStop(0, 'rgba(34,197,94,0.28)');
    gUp.addColorStop(0.5, 'rgba(61,184,122,0.16)');
    gUp.addColorStop(1, 'rgba(61,184,122,0.03)');
    ctx.fillStyle = gUp;
    ctx.fillRect(pad.left, pad.top, cw, y0 - pad.top);
    const gDn = ctx.createLinearGradient(0, y0, 0, pad.top + ch);
    gDn.addColorStop(0, 'rgba(239,68,68,0.03)');
    gDn.addColorStop(0.5, 'rgba(239,68,68,0.16)');
    gDn.addColorStop(1, 'rgba(192,64,64,0.28)');
    ctx.fillStyle = gDn;
    ctx.fillRect(pad.left, y0, cw, pad.top + ch - y0);
    ctx.restore();

    // Threshold lines — only critical levels (±1.5, ±2.0)
    const criticalThresholds = [2.0, 1.5];
    criticalThresholds.forEach(z => {
        const colors = { 2.0: { rp: 34, gp: 197, bp: 94, rn: 192, gn: 64, bn: 64 },
                         1.5: { rp: 61, gp: 184, bp: 122, rn: 239, gn: 68, bn: 68 } };
        const col = colors[z];
        ctx.setLineDash([4, 3]); ctx.lineWidth = 0.8;
        if (z <= maxZ) {
            ctx.strokeStyle = `rgba(${col.rp},${col.gp},${col.bp},0.4)`;
            ctx.beginPath(); ctx.moveTo(pad.left, getY(z)); ctx.lineTo(pad.left + cw, getY(z)); ctx.stroke();
        }
        if (-z >= minZ) {
            ctx.strokeStyle = `rgba(${col.rn},${col.gn},${col.bn},0.4)`;
            ctx.beginPath(); ctx.moveTo(pad.left, getY(-z)); ctx.lineTo(pad.left + cw, getY(-z)); ctx.stroke();
        }
    });
    ctx.setLineDash([]);

    // Zero line
    ctx.beginPath(); ctx.moveTo(pad.left, y0); ctx.lineTo(pad.left + cw, y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();

    // Color-coded composite line segments
    for (let i = 1; i < data.length; i++) {
        const z = (vals[i] + vals[i - 1]) / 2;
        const absZ = Math.abs(z);
        let color;
        if (z > 0) {
            color = absZ >= 2.0 ? 'rgba(34,197,94,1)' : absZ >= 1.5 ? 'rgba(61,184,122,0.95)' :
                    absZ >= 1.0 ? 'rgba(96,200,166,0.85)' : 'rgba(180,200,190,0.7)';
        } else {
            color = absZ >= 2.0 ? 'rgba(192,64,64,1)' : absZ >= 1.5 ? 'rgba(239,68,68,0.95)' :
                    absZ >= 1.0 ? 'rgba(200,100,100,0.85)' : 'rgba(200,170,170,0.7)';
        }
        ctx.beginPath();
        ctx.moveTo(getX(i - 1), getY(vals[i - 1]));
        ctx.lineTo(getX(i), getY(vals[i]));
        ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
    }

    // Y-axis with color-coded threshold values (no grid lines)
    const yTicks = niceAxisTicks(minZ, maxZ, 5);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '9px sans-serif';
    yTicks.forEach(v => {
        const y = getY(v);
        if (y < pad.top - 5 || y > pad.top + ch + 5) return;
        const absV = Math.abs(v);
        const fC = absV >= 1.9 ? (v > 0 ? 'rgba(34,197,94,0.85)' : 'rgba(192,64,64,0.85)')
                 : absV >= 1.4 ? (v > 0 ? 'rgba(61,184,122,0.8)' : 'rgba(239,68,68,0.8)')
                 : 'rgba(148,163,184,0.6)';
        ctx.fillStyle = fC;
        ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1), pad.left - 6, y);
    });

    // X-axis
    drawXAxis(ctx, dates, getX, cw, pad.top + ch + 14, pad);

    // Hover crosshair with adaptive signal strength
    if (state.hoverCompZIdx !== null && state.hoverCompZIdx < data.length) {
        const i = state.hoverCompZIdx;
        const x = getX(i), y = getY(vals[i]);
        const absZ = Math.abs(vals[i]);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch);
        ctx.strokeStyle = 'rgba(0,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();

        const dotColor = vals[i] >= 0
            ? (absZ >= 2.0 ? 'rgba(34,197,94,1)' : absZ >= 1.5 ? '#3db87a' : 'rgba(96,200,166,0.9)')
            : (absZ >= 2.0 ? 'rgba(192,64,64,1)' : absZ >= 1.5 ? '#ef4444' : 'rgba(200,100,100,0.9)');
        const dotR = 4 + Math.min(absZ * 1.0, 3.5);

        if (absZ >= 1.5) {
            ctx.beginPath(); ctx.arc(x, y, dotR + 4, 0, Math.PI * 2);
            ctx.fillStyle = dotColor.replace(/[\d.]+\)$/, '0.18)'); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = dotColor; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
}

// ---- Draw Flow vs NG Chart ----
function renderFlowNGChart() {
    const { flow, ng } = getFlowNGVisible();
    if (!flow || flow.length < 2) return;
    drawChartFlowNG(flow, ng);
}

function drawChartFlowNG(flow, ng) {
    const cvs = el('chartFlowNG');
    const { w, h, dpr } = resizeCanvas(cvs);
    const ctx = ctxFlowNG;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 24, right: 60, bottom: 32, left: 55 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    if (cw < 20 || ch < 20) return;

    const dates = flow.map(d => d.date);
    const ngVals = ng.map(d => d.close);
    const validNG = ngVals.filter(v => v !== null);

    // ── Compute divergence signal ─────────────────────────────────────────
    // A bar appears only when composite flow direction OPPOSES the 5-session prior NG move.
    // signed > 0: bullish-contrarian (flow bullish, NG recently fell)
    // signed < 0: bearish-contrarian (flow bearish, NG recently rose)
    // signed = 0: reactive (flow follows price) — no bar drawn
    const ngDateIdx = {};
    if (state.ngDates) state.ngDates.forEach((d, i) => { ngDateIdx[d] = i; });

    const divData = flow.map(f => ({ signed: f.divVal || 0, ng5d: f.ng5d }));
    state.divValsCache = divData; // read by handleFlowNGHover

    const divSigned = divData.map(d => d.signed);
    const absMax = Math.max(1.6, ...divSigned.map(v => Math.abs(v)));
    const scale  = absMax * 1.1;
    const y0 = pad.top + ch / 2; // zero line at vertical center

    const getX    = i => pad.left + (i / (flow.length - 1)) * cw;
    const getYDiv = v => y0 - (v / scale) * (ch / 2);

    let minNG = validNG.length > 0 ? Math.min(...validNG) : 0;
    let maxNG = validNG.length > 0 ? Math.max(...validNG) : 10;
    const ngPad = (maxNG - minNG) * 0.08; minNG = Math.max(0, minNG - ngPad); maxNG += ngPad;
    const getYNG = v => pad.top + (1 - (v - minNG) / (maxNG - minNG)) * ch;

    // ── 1. Background shading for ±1.5σ zones ─────────────────────────────
    const y15p = getYDiv(1.5), y15n = getYDiv(-1.5);
    ctx.fillStyle = 'rgba(61,184,122,0.04)';
    ctx.fillRect(pad.left, pad.top, cw, y15p - pad.top);
    ctx.fillStyle = 'rgba(239,68,68,0.04)';
    ctx.fillRect(pad.left, y15n, cw, pad.top + ch - y15n);

    // ── 2. Reference lines (±1.5σ dashed, zero solid) ─────────────────────
    ctx.setLineDash([4, 3]); ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(61,184,122,0.28)';
    ctx.beginPath(); ctx.moveTo(pad.left, y15p); ctx.lineTo(pad.left + cw, y15p); ctx.stroke();
    ctx.strokeStyle = 'rgba(239,68,68,0.28)';
    ctx.beginPath(); ctx.moveTo(pad.left, y15n); ctx.lineTo(pad.left + cw, y15n); ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath(); ctx.moveTo(pad.left, y0); ctx.lineTo(pad.left + cw, y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();

    // ── 3. Zone labels ─────────────────────────────────────────────────────
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(61,184,122,0.6)';
    ctx.fillText('▲ BULLISH DIVERGENCE', pad.left + 6, (pad.top + y15p) / 2);
    ctx.fillStyle = 'rgba(239,68,68,0.6)';
    ctx.fillText('▼ BEARISH DIVERGENCE', pad.left + 6, (y15n + pad.top + ch) / 2);
    ctx.fillStyle = 'rgba(148,163,184,0.35)';
    ctx.fillText('REACTIVE (no signal)', pad.left + 6, y0);

    // ── 4. Divergence bars ─────────────────────────────────────────────────
    const bw = Math.max(1, (cw / flow.length) * 0.85);
    for (let i = 0; i < flow.length; i++) {
        const v = divSigned[i];
        if (v === 0) continue;
        const x = getX(i);
        const absV = Math.abs(v);
        ctx.fillStyle = v > 0
            ? (absV >= 2.0 ? 'rgba(34,197,94,0.9)' : absV >= 1.5 ? 'rgba(61,184,122,0.82)' : 'rgba(61,184,122,0.65)')
            : (absV >= 2.0 ? 'rgba(192,64,64,0.9)'  : absV >= 1.5 ? 'rgba(239,68,68,0.82)'  : 'rgba(239,68,68,0.65)');
        const yTop = getYDiv(v);
        ctx.fillRect(x - bw / 2, Math.min(yTop, y0), bw, Math.abs(yTop - y0));
    }

    // ── 5. NG=F price line ─────────────────────────────────────────────────
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < ng.length; i++) {
        if (ngVals[i] === null) continue;
        const x = getX(i), y = getYNG(ngVals[i]);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    }
    ctx.strokeStyle = '#4ab8d8'; ctx.lineWidth = 1.8; ctx.stroke();

    const lastNgIdx = ng.length - 1;
    if (ngVals[lastNgIdx] !== null) {
        const lx = getX(lastNgIdx), ly = getYNG(ngVals[lastNgIdx]);
        ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.strokeStyle = '#4ab8d8'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // ── 6. Left Y-axis (divergence intensity scale) ────────────────────────
    const divTicks = niceAxisTicks(-scale, scale, 5);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '9px sans-serif';
    divTicks.forEach(v => {
        const y = getYDiv(v);
        if (y < pad.top - 5 || y > pad.top + ch + 5) return;
        const absV = Math.abs(v);
        ctx.fillStyle = absV >= 1.9 ? (v >= 0 ? 'rgba(34,197,94,0.85)'  : 'rgba(192,64,64,0.85)')
                      : absV >= 1.4 ? (v >= 0 ? 'rgba(61,184,122,0.8)'  : 'rgba(239,68,68,0.8)')
                      : 'rgba(148,163,184,0.6)';
        ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1), pad.left - 6, y);
    });

    // ── 7. Right Y-axis (NG price) ─────────────────────────────────────────
    const ngTicks = niceAxisTicks(minNG, maxNG, 5);
    ctx.fillStyle = 'rgba(74,184,216,0.8)'; ctx.textAlign = 'left'; ctx.font = '9px sans-serif';
    ngTicks.forEach(v => {
        const y = getYNG(v);
        if (y < pad.top - 5 || y > pad.top + ch + 5) return;
        ctx.fillText(v >= 10 ? '$' + v.toFixed(1) : '$' + v.toFixed(2), pad.left + cw + 7, y);
    });

    // ── 8. X-axis ──────────────────────────────────────────────────────────
    drawXAxis(ctx, dates, getX, cw, pad.top + ch + 14, pad);

    // ── 9. Hover crosshair ─────────────────────────────────────────────────
    if (state.hoverFlowNGIdx !== null && state.hoverFlowNGIdx < flow.length) {
        const i = state.hoverFlowNGIdx;
        const x = getX(i);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch);
        ctx.strokeStyle = 'rgba(0,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();

        const dv = divSigned[i];
        if (dv !== 0) {
            const absV = Math.abs(dv);
            const dotColor = dv > 0
                ? (absV >= 1.5 ? '#3db87a' : 'rgba(61,184,122,0.9)')
                : (absV >= 1.5 ? '#ef4444' : 'rgba(239,68,68,0.9)');
            ctx.beginPath(); ctx.arc(x, getYDiv(dv), 4, 0, Math.PI * 2);
            ctx.fillStyle = dotColor; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        }

        if (ngVals[i] !== null) {
            ctx.beginPath(); ctx.arc(x, getYNG(ngVals[i]), 4, 0, Math.PI * 2);
            ctx.fillStyle = '#4ab8d8'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        }
    }
}

// ---- Hover Handlers ----
function handleCompZHover(e) {
    const data = getCompZVisible();
    if (!data || data.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pad = { left: 50, right: 20 };
    const cw = rect.width - pad.left - pad.right;
    const frac = (x - pad.left) / cw;
    const idx = Math.round(frac * (data.length - 1));
    if (idx < 0 || idx >= data.length) { hideCompZHover(); return; }
    state.hoverCompZIdx = idx;
    drawChartCompZ(data);
    const d = data[idx];
    const tip = document.getElementById('compz-tooltip');
    const color = d.z >= 0 ? '#3db87a' : '#ef4444';
    tip.innerHTML = `<div style="color:var(--cyan); font-size:0.7rem; font-weight:800; margin-bottom:6px;">${fmtDateLong(d.date)}</div>
        <div style="display:flex; justify-content:space-between; gap:16px;"><span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">COMPOSITE Z</span><span style="color:${color}; font-weight:800; font-family:'JetBrains Mono',monospace;">${d.z >= 0 ? '+' : ''}${d.z.toFixed(3)}σ</span></div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:3px;"><span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">LONG SIDE</span><span style="color:#F5C542; font-size:0.68rem; font-weight:700;">${d.longZ >= 0 ? '+' : ''}${d.longZ.toFixed(3)}</span></div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:2px;"><span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">SHORT SIDE</span><span style="color:#4A9CF5; font-size:0.68rem; font-weight:700;">${d.shortZ >= 0 ? '+' : ''}${d.shortZ.toFixed(3)}</span></div>`;
    tip.style.display = 'block';
    const tx = Math.min(rect.width - 200, Math.max(10, x - 90));
    tip.style.left = tx + 'px'; tip.style.top = '10px';
}

function hideCompZHover() {
    state.hoverCompZIdx = null;
    const tip = document.getElementById('compz-tooltip');
    if (tip) tip.style.display = 'none';
    renderCompZChart();
}

function handleFlowNGHover(e) {
    const { flow, ng } = getFlowNGVisible();
    if (!flow || flow.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padObj = { left: 55, right: 55 };
    const cw = rect.width - padObj.left - padObj.right;
    const frac = (x - padObj.left) / cw;
    const idx = Math.round(frac * (flow.length - 1));
    if (idx < 0 || idx >= flow.length) { hideFlowNGHover(); return; }
    state.hoverFlowNGIdx = idx;
    drawChartFlowNG(flow, ng); // rebuilds state.divValsCache before tooltip reads it
    const d = flow[idx];
    const ngClose = ng[idx] ? ng[idx].close : null;
    const dvc = state.divValsCache[idx] || { signed: 0, ng5d: null };
    const divV  = dvc.signed;
    const ng5d  = dvc.ng5d;
    const tip = document.getElementById('flowng-tooltip');

    const absDiv = Math.abs(divV);
    let divColor, divLabel, divDesc;
    if (absDiv === 0) {
        divColor = '#94a3b8'; divLabel = '○ REACTIVE';
        divDesc = 'Flow aligns with recent NG direction — likely momentum chasing';
    } else if (absDiv >= 2.0) {
        divColor = divV > 0 ? 'rgba(34,197,94,1)' : 'rgba(192,64,64,1)';
        divLabel = '◆ EXTREME'; divDesc = divV > 0 ? 'Strong bullish flow vs. NG weakness' : 'Strong bearish flow vs. NG strength';
    } else if (absDiv >= 1.5) {
        divColor = divV > 0 ? '#3db87a' : '#ef4444';
        divLabel = '◆ STRONG';  divDesc = divV > 0 ? 'Bullish accumulation against falling gas' : 'Bearish distribution into rising gas';
    } else {
        divColor = divV > 0 ? 'rgba(96,200,166,1)' : 'rgba(200,100,100,1)';
        divLabel = '◆ MILD';    divDesc = divV > 0 ? 'Mild bullish-contrarian flow' : 'Mild bearish-contrarian flow';
    }
    const ng5dStr   = ng5d !== null ? ((ng5d >= 0 ? '+' : '') + (ng5d * 100).toFixed(1) + '%') : '—';
    const ng5dColor = ng5d === null ? '#94a3b8' : ng5d >= 0 ? '#3db87a' : '#ef4444';

    tip.innerHTML = `
        <div style="color:var(--cyan); font-size:0.7rem; font-weight:800; margin-bottom:6px;">${fmtDateLong(d.date)}</div>
        <div style="display:flex; justify-content:space-between; gap:16px;">
            <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">DIVERGENCE</span>
            <span style="color:${divColor}; font-weight:800; font-family:'JetBrains Mono',monospace;">${divV >= 0 ? '+' : ''}${divV.toFixed(2)}σ</span>
        </div>
        <div style="color:${divColor}; font-size:0.62rem; font-weight:700; margin-top:2px;">${divLabel} — ${divDesc}</div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
            <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">COMP Z (underlying)</span>
            <span style="color:rgba(148,163,184,0.8); font-weight:700; font-family:'JetBrains Mono',monospace;">${d.z >= 0 ? '+' : ''}${d.z.toFixed(2)}σ</span>
        </div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:2px;">
            <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">NG 5D RETURN</span>
            <span style="color:${ng5dColor}; font-weight:700; font-family:'JetBrains Mono',monospace;">${ng5dStr}</span>
        </div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
            <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">NG=F PRICE</span>
            <span style="color:#4ab8d8; font-weight:800; font-family:'JetBrains Mono',monospace;">${ngClose !== null ? '$' + ngClose.toFixed(3) : 'N/A'}</span>
        </div>`;
    tip.style.display = 'block';
    const tx = Math.min(rect.width - 240, Math.max(10, x - 110));
    tip.style.left = tx + 'px'; tip.style.top = '10px';
}

function hideFlowNGHover() {
    state.hoverFlowNGIdx = null;
    const tip = document.getElementById('flowng-tooltip');
    if (tip) tip.style.display = 'none';
    renderFlowNGChart();
}

// ---- Range Sliders ----
function initCompZSlider() {
    const sS = document.getElementById('compz-range-start');
    const sE = document.getElementById('compz-range-end');
    if (!sS || !sE) return;
    function onInput() {
        let s = parseInt(sS.value) / 1000, e = parseInt(sE.value) / 1000;
        if (s > e - 0.02) { s = e - 0.02; sS.value = Math.round(s * 1000); }
        state.zoomCompZ = { start: s, end: e };
        renderCompZChart();
        syncCompZSlider();
    }
    sS.addEventListener('input', onInput);
    sE.addEventListener('input', onInput);
}

function syncCompZSlider() {
    const sS = document.getElementById('compz-range-start');
    const sE = document.getElementById('compz-range-end');
    const hl = document.getElementById('compz-range-highlight');
    const lbl = document.getElementById('compz-range-label');
    if (!sS || !sE) return;
    sS.value = Math.round(state.zoomCompZ.start * 1000);
    sE.value = Math.round(state.zoomCompZ.end * 1000);
    if (hl) {
        hl.style.left = (state.zoomCompZ.start * 100) + '%';
        hl.style.width = ((state.zoomCompZ.end - state.zoomCompZ.start) * 100) + '%';
    }
    if (lbl) {
        const isZoomed = state.zoomCompZ.start > 0.001 || state.zoomCompZ.end < 0.999;
        lbl.textContent = isZoomed ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}

function initFlowNGSlider() {
    const sS = document.getElementById('flowng-range-start');
    const sE = document.getElementById('flowng-range-end');
    if (!sS || !sE) return;
    function onInput() {
        let s = parseInt(sS.value) / 1000, e = parseInt(sE.value) / 1000;
        if (s > e - 0.02) { s = e - 0.02; sS.value = Math.round(s * 1000); }
        state.zoomFlowNG = { start: s, end: e };
        renderFlowNGChart();
        syncFlowNGSlider();
    }
    sS.addEventListener('input', onInput);
    sE.addEventListener('input', onInput);
}

function syncFlowNGSlider() {
    const sS = document.getElementById('flowng-range-start');
    const sE = document.getElementById('flowng-range-end');
    const hl = document.getElementById('flowng-range-highlight');
    const lbl = document.getElementById('flowng-range-label');
    if (!sS || !sE) return;
    sS.value = Math.round(state.zoomFlowNG.start * 1000);
    sE.value = Math.round(state.zoomFlowNG.end * 1000);
    if (hl) {
        hl.style.left = (state.zoomFlowNG.start * 100) + '%';
        hl.style.width = ((state.zoomFlowNG.end - state.zoomFlowNG.start) * 100) + '%';
    }
    if (lbl) {
        const isZoomed = state.zoomFlowNG.start > 0.001 || state.zoomFlowNG.end < 0.999;
        lbl.textContent = isZoomed ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}

// ---- Reactivity Intensity Chart ----
function getFlowReactivityVisible() {
    const cz = state.compositeZ;
    if (!cz || cz.length === 0) return { flow: [], ng: [] };
    const base = applyTimeFilter(cz);
    const z = state.zoomReactivity;
    const s = Math.floor(z.start * base.length);
    const e = Math.ceil(z.end * base.length);
    const flow = base.slice(s, e);
    const ng = flow.map(f => ({ date: f.date, close: state.ngHistory[f.date] || null }));
    return { flow, ng };
}

function renderReactivityChart() {
    const { flow, ng } = getFlowReactivityVisible();
    if (!flow || flow.length < 2) return;
    drawChartReactivity(flow, ng);
}

function drawChartReactivity(flow, ng) {
    const cvs = el('chartReactivity');
    const { w, h, dpr } = resizeCanvas(cvs);
    const ctx = ctxReactivity;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 24, right: 40, bottom: 32, left: 55 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    if (cw < 20 || ch < 20) return;

    const dates = flow.map(d => d.date);
    const ngDateIdx = {};
    if (state.ngDates) state.ngDates.forEach((d, i) => { ngDateIdx[d] = i; });

    // ── Reactivity bars: appear when flow aligns with price (opposite of divergence) ─
    const reactData = flow.map(f => {
        const ni = ngDateIdx[f.date];
        if (ni === undefined || ni < 5) return { intensity: 0, ng5d: null };
        const p0 = state.ngHistory[state.ngDates[ni - 5]];
        const p1 = state.ngHistory[state.ngDates[ni]];
        if (!p0 || !p1 || p0 === 0) return { intensity: 0, ng5d: null };
        const ng5d = (p1 - p0) / p0;
        if (Math.abs(ng5d) < 0.005 || Math.abs(f.z) < 0.3) return { intensity: 0, ng5d };
        const flowUp = f.z > 0, ngUp = ng5d > 0;
        if (flowUp !== ngUp) return { intensity: 0, ng5d }; // opposite = divergence, not reactivity
        return { intensity: Math.abs(f.z), ng5d };
    });
    state.reactValsCache = reactData;

    const reactIntensities = reactData.map(d => d.intensity);
    const absMax = Math.max(1.6, ...reactIntensities.map(v => Math.abs(v)));
    const scale = absMax * 1.1;
    const y0 = pad.top + ch / 2;

    const getX = i => pad.left + (i / (flow.length - 1)) * cw;
    const getYReact = v => y0 - (v / scale) * (ch / 2);

    // ── 1. Background shading for ±1.5σ zones ──────────────────────────────────
    const y15p = getYReact(1.5), y15n = getYReact(-1.5);
    ctx.fillStyle = 'rgba(148,163,184,0.04)';
    ctx.fillRect(pad.left, pad.top, cw, y15p - pad.top);
    ctx.fillRect(pad.left, y15n, cw, pad.top + ch - y15n);

    // ── 2. Reference lines ──────────────────────────────────────────────────────
    ctx.setLineDash([4, 3]); ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.beginPath(); ctx.moveTo(pad.left, y15p); ctx.lineTo(pad.left + cw, y15p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.left, y15n); ctx.lineTo(pad.left + cw, y15n); ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath(); ctx.moveTo(pad.left, y0); ctx.lineTo(pad.left + cw, y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();

    // ── 3. Zone label ───────────────────────────────────────────────────────────
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.fillText('REACTIVITY INTENSITY (Momentum Chasing)', pad.left + 6, (pad.top + y15p) / 2);

    // ── 4. Reactivity bars (neutral gray) ────────────────────────────────────────
    const bw = Math.max(1, (cw / flow.length) * 0.85);
    for (let i = 0; i < flow.length; i++) {
        const v = reactIntensities[i];
        if (v === 0) continue;
        const x = getX(i);
        ctx.fillStyle = v >= 1.5 ? 'rgba(148,163,184,0.72)' : 'rgba(148,163,184,0.55)';
        const yTop = getYReact(v);
        ctx.fillRect(x - bw / 2, Math.min(yTop, y0), bw, Math.abs(yTop - y0));
    }

    // ── 5. Left Y-axis (reactivity intensity) ────────────────────────────────────
    const reactTicks = niceAxisTicks(-scale, scale, 5);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '9px sans-serif';
    reactTicks.forEach(v => {
        const y = getYReact(v);
        if (y < pad.top - 5 || y > pad.top + ch + 5) return;
        ctx.fillStyle = 'rgba(148,163,184,0.6)';
        ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1), pad.left - 6, y);
    });

    // ── 6. X-axis ───────────────────────────────────────────────────────────────
    drawXAxis(ctx, dates, getX, cw, pad.top + ch + 14, pad);

    // ── 7. Hover crosshair ──────────────────────────────────────────────────────
    if (state.hoverReactivityIdx !== null && state.hoverReactivityIdx < flow.length) {
        const i = state.hoverReactivityIdx;
        const x = getX(i);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch);
        ctx.strokeStyle = 'rgba(0,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();

        const v = reactIntensities[i];
        if (v !== 0) {
            ctx.beginPath(); ctx.arc(x, getYReact(v), 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(148,163,184,0.9)'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        }
    }
}

function handleReactivityHover(e) {
    const { flow, ng } = getFlowReactivityVisible();
    if (!flow || flow.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padObj = { left: 55, right: 40 };
    const cw = rect.width - padObj.left - padObj.right;
    const frac = (x - padObj.left) / cw;
    const idx = Math.round(frac * (flow.length - 1));
    if (idx < 0 || idx >= flow.length) { hideReactivityHover(); return; }
    state.hoverReactivityIdx = idx;
    drawChartReactivity(flow, ng);
    const d = flow[idx];
    const rc = state.reactValsCache[idx] || { intensity: 0, ng5d: null };
    const reactV = rc.intensity;
    const ng5d = rc.ng5d;
    const tip = document.getElementById('reactivity-tooltip');

    let reactLabel, reactDesc;
    if (reactV === 0) {
        reactLabel = '○ NO REACTIVITY';
        reactDesc = 'Flow opposes recent NG direction (see Divergence Signal chart)';
    } else if (reactV >= 1.5) {
        reactLabel = '● EXTREME MOMENTUM';
        reactDesc = 'Crowds aggressively chasing price momentum — high mean-reversion risk';
    } else {
        reactLabel = '● MODERATE MOMENTUM';
        reactDesc = 'Moderate crowd momentum chasing — potential reversal setup';
    }
    const ng5dStr = ng5d !== null ? ((ng5d >= 0 ? '+' : '') + (ng5d * 100).toFixed(1) + '%') : '—';
    const ng5dColor = ng5d === null ? '#94a3b8' : ng5d >= 0 ? '#3db87a' : '#ef4444';

    tip.innerHTML = `
        <div style="color:var(--cyan); font-size:0.7rem; font-weight:800; margin-bottom:6px;">${fmtDateLong(d.date)}</div>
        <div style="display:flex; justify-content:space-between; gap:16px;">
            <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">REACTIVITY</span>
            <span style="color:rgba(148,163,184,0.9); font-weight:800; font-family:'JetBrains Mono',monospace;">${reactV >= 0 ? '+' : ''}${reactV.toFixed(2)}σ</span>
        </div>
        <div style="color:rgba(148,163,184,0.9); font-size:0.62rem; font-weight:700; margin-top:2px;">${reactLabel} — ${reactDesc}</div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
            <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">COMP Z (underlying)</span>
            <span style="color:rgba(148,163,184,0.8); font-weight:700; font-family:'JetBrains Mono',monospace;">${d.z >= 0 ? '+' : ''}${d.z.toFixed(2)}σ</span>
        </div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:2px;">
            <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">NG 5D RETURN</span>
            <span style="color:${ng5dColor}; font-weight:700; font-family:'JetBrains Mono',monospace;">${ng5dStr}</span>
        </div>`;
    tip.style.display = 'block';
    const tx = Math.min(rect.width - 240, Math.max(10, x - 110));
    tip.style.left = tx + 'px'; tip.style.top = '10px';
}

function hideReactivityHover() {
    state.hoverReactivityIdx = null;
    const tip = document.getElementById('reactivity-tooltip');
    if (tip) tip.style.display = 'none';
    renderReactivityChart();
}

function initReactivitySlider() {
    const sS = document.getElementById('reactivity-range-start');
    const sE = document.getElementById('reactivity-range-end');
    if (!sS || !sE) return;
    function onInput() {
        let s = parseInt(sS.value) / 1000, e = parseInt(sE.value) / 1000;
        if (s > e - 0.02) { s = e - 0.02; sS.value = Math.round(s * 1000); }
        state.zoomReactivity = { start: s, end: e };
        renderReactivityChart();
        syncReactivitySlider();
    }
    sS.addEventListener('input', onInput);
    sE.addEventListener('input', onInput);
}

function syncReactivitySlider() {
    const sS = document.getElementById('reactivity-range-start');
    const sE = document.getElementById('reactivity-range-end');
    const hl = document.getElementById('reactivity-range-highlight');
    const lbl = document.getElementById('reactivity-range-label');
    if (!sS || !sE) return;
    sS.value = Math.round(state.zoomReactivity.start * 1000);
    sE.value = Math.round(state.zoomReactivity.end * 1000);
    if (hl) {
        hl.style.left = (state.zoomReactivity.start * 100) + '%';
        hl.style.width = ((state.zoomReactivity.end - state.zoomReactivity.start) * 100) + '%';
    }
    if (lbl) {
        const isZoomed = state.zoomReactivity.start > 0.001 || state.zoomReactivity.end < 0.999;
        lbl.textContent = isZoomed ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}

function renderFlowHeatCalendar(offset = 0) {
    const elContainer = document.getElementById('flow-activity-heat');
    if (!elContainer) return;
    
    const longestData = state.compositeZ;
    if (!longestData || longestData.length === 0) return;
    
    // Pagination bounds
    const maxOffset = Math.floor((longestData.length - 1) / 90);
    offset = Math.max(0, Math.min(offset, maxOffset));
    state.flowHeatOffset = offset;
    
    // Wire up navigation buttons
    const btnPrev = document.getElementById('flow-heat-prev');
    const btnNext = document.getElementById('flow-heat-next');
    if (btnPrev) btnPrev.disabled = (offset >= maxOffset);
    if (btnNext) btnNext.disabled = (offset === 0);
    
    // Update range label in title
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
    
    // Mode & Source
    const mode = state.flowHeatMode || 'unified';
    const source = state.flowHeatSource || 'all';
    
    // Set legend details based on mode
    const sigLegend = document.getElementById('flow-heat-legend-signals');
    if (sigLegend) {
        sigLegend.style.display = (mode === 'unified') ? 'flex' : 'none';
    }
    
    // PEAKS Mode setup
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
        
        // Month label
        let monthLabel = '';
        if (prevMonth !== null && prevMonth !== month) {
            const monthIdx = parseInt(month, 10) - 1;
            monthLabel = `<span class="flow-heat-month">${monthNames[monthIdx]}</span>`;
        }
        prevMonth = month;
        
        // Determine value to color cell
        let val = 0;
        if (source === 'all') {
            val = d.z;
        } else if (source === 'long') {
            val = d.longZ;
        } else if (source === 'short') {
            val = d.shortZ;
        }
        
        // Coloring logic
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
                if (absV >= p99Cutoff) {
                    cellPeaksClass = ' heat-peak-extreme';
                } else if (absV >= p95Cutoff) {
                    cellPeaksClass = ' heat-peak-significant';
                } else {
                    cellPeaksClass = ' heat-peak-notable';
                }
                bg = ''; // clear background to let CSS handle it
                borderStyle = ''; // clear border to let CSS glow apply
                fgColor = '#fff';
            }
        } else {
            if (mode === 'divergence' && d.divVal === 0) {
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
        
        // Divergence Badge (in Unified Mode) — hide if cell is dimmed
        let badge = '';
        if (mode === 'unified' && d.divVal !== 0 && !isDimmed) {
            const badgeColor = d.divVal > 0 ? '#3db87a' : '#ef4444';
            badge = `<div class="flow-heat-badge" style="background:${badgeColor};"></div>`;
            if (!peaksMode) {
                borderStyle = `2px solid ${badgeColor}`;
            }
        }
        
        // Highlight current day if it's the very last day of data
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
    html += `<div id="flow-heat-tooltip" style="position:absolute; display:none; background:rgba(13,17,28,0.95); border:1px solid var(--border-primary); border-radius:6px; padding:10px 14px; font-size:0.72rem; color:var(--text-bright); pointer-events:none; z-index:100; box-shadow:0 8px 24px rgba(0,0,0,0.5); min-width:220px;"></div>`;
    elContainer.innerHTML = html;
    
    // Update peak count badge
    const peakBadge = document.getElementById('flow-heat-peaks-badge');
    if (peakBadge) {
        if (peaksMode) {
            peakBadge.textContent = `${windowPeakCount} ${windowPeakCount === 1 ? 'PEAK' : 'PEAKS'}`;
            peakBadge.classList.add('visible');
        } else {
            peakBadge.classList.remove('visible');
        }
    }
    
    // Setup event listeners for tooltip
    setupFlowHeatTooltip();
}

function setupFlowHeatTooltip() {
    const container = document.getElementById('flow-activity-heat');
    const tooltip = document.getElementById('flow-heat-tooltip');
    if (!container || !tooltip) return;
    
    const cells = container.querySelectorAll('.flow-heat-cell');
    
    cells.forEach(cell => {
        cell.addEventListener('mouseenter', (e) => {
            const idx = parseInt(cell.dataset.index);
            const d = state.compositeZ[idx];
            if (!d) return;
            
            const zColor = d.z >= 0 ? '#3db87a' : '#ef4444';
            const zLabel = d.z >= 0 ? 'UPWARD PRESSURE' : 'DOWNWARD PRESSURE';
            const zIntensity = Math.abs(d.z) > 1.5 ? 'EXTREME' : Math.abs(d.z) > 1 ? 'STRONG' : Math.abs(d.z) > 0.5 ? 'MODERATE' : 'MILD';
            
            let divHtml = '';
            if (d.divVal !== 0) {
                const divColor = d.divVal > 0 ? '#3db87a' : '#ef4444';
                const divType = d.divVal > 0 ? 'BULLISH DIVERGENCE (Leading)' : 'BEARISH DIVERGENCE (Leading)';
                const divDesc = d.divVal > 0 ? 'Capital inflows despite falling gas prices' : 'Capital outflows despite rising gas prices';
                divHtml = `
                    <div style="margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
                        <div style="color:${divColor}; font-size:0.62rem; font-weight:800;">⚡ ${divType}</div>
                        <div style="color:rgba(255,255,255,0.6); font-size:0.56rem; font-style:italic;">${divDesc}</div>
                    </div>`;
            } else if (d.ng5d !== null && Math.abs(d.z) >= 0.3) {
                const flowUp = d.z > 0;
                const ngUp = d.ng5d > 0;
                if (flowUp === ngUp) {
                    divHtml = `
                        <div style="margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
                            <div style="color:#94a3b8; font-size:0.6rem; font-weight:700;">○ REACTIVE FLOW</div>
                            <div style="color:rgba(255,255,255,0.5); font-size:0.56rem; font-style:italic;">Capital following price momentum</div>
                        </div>`;
                }
            }
            
            const ngClose = state.ngHistory[d.date];
            const ng5dStr = d.ng5d !== null ? `${d.ng5d >= 0 ? '+' : ''}${(d.ng5d * 100).toFixed(1)}%` : '—';
            const ng5dColor = d.ng5d === null ? '#94a3b8' : d.ng5d >= 0 ? '#3db87a' : '#ef4444';
            
            let etfHtml = '';
            if (d.etfs) {
                etfHtml = `
                    <div style="margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06); display:grid; grid-template-columns:1fr 1fr; gap:3px 12px;">
                        <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">BOIL: <span style="font-family:'JetBrains Mono'; font-weight:700; color:${d.etfs.BOIL >= 0 ? '#3db87a' : '#ef4444'}">${d.etfs.BOIL >= 0 ? '+' : ''}${d.etfs.BOIL.toFixed(1)}</span></div>
                        <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">KOLD: <span style="font-family:'JetBrains Mono'; font-weight:700; color:${d.etfs.KOLD >= 0 ? '#3db87a' : '#ef4444'}">${d.etfs.KOLD >= 0 ? '+' : ''}${d.etfs.KOLD.toFixed(1)}</span></div>
                        <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">HNU: <span style="font-family:'JetBrains Mono'; font-weight:700; color:${d.etfs.HNU >= 0 ? '#3db87a' : '#ef4444'}">${d.etfs.HNU >= 0 ? '+' : ''}${d.etfs.HNU.toFixed(1)}</span></div>
                        <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">HND: <span style="font-family:'JetBrains Mono'; font-weight:700; color:${d.etfs.HND >= 0 ? '#3db87a' : '#ef4444'}">${d.etfs.HND >= 0 ? '+' : ''}${d.etfs.HND.toFixed(1)}</span></div>
                        <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">3NGL: <span style="font-family:'JetBrains Mono'; font-weight:700; color:${d.etfs['3NGL'] >= 0 ? '#3db87a' : '#ef4444'}">${d.etfs['3NGL'] >= 0 ? '+' : ''}${d.etfs['3NGL'].toFixed(1)}</span></div>
                        <div style="font-size:0.55rem; color:rgba(255,255,255,0.5);">3NGS: <span style="font-family:'JetBrains Mono'; font-weight:700; color:${d.etfs['3NGS'] >= 0 ? '#3db87a' : '#ef4444'}">${d.etfs['3NGS'] >= 0 ? '+' : ''}${d.etfs['3NGS'].toFixed(1)}</span></div>
                    </div>`;
            }

            tooltip.innerHTML = `
                <div style="color:var(--cyan); font-size:0.7rem; font-weight:800; margin-bottom:5px;">${fmtDateLong(d.date)}</div>
                <div style="display:flex; justify-content:space-between; gap:16px;">
                    <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">COMPOSITE Z</span>
                    <span style="color:${zColor}; font-weight:800; font-family:'JetBrains Mono',monospace;">${d.z >= 0 ? '+' : ''}${d.z.toFixed(3)}σ</span>
                </div>
                <div style="color:${zColor}; font-size:0.58rem; font-weight:700; margin-top:2px;">${zIntensity} · ${zLabel}</div>
                
                <div style="display:flex; justify-content:space-between; gap:16px; margin-top:3px;">
                    <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">LONG AVERAGE</span>
                    <span style="color:#F5C542; font-size:0.6rem; font-weight:700; font-family:'JetBrains Mono';">${d.longZ >= 0 ? '+' : ''}${d.longZ.toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:16px; margin-top:2px;">
                    <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">SHORT AVERAGE</span>
                    <span style="color:#4A9CF5; font-size:0.6rem; font-weight:700; font-family:'JetBrains Mono';">${d.shortZ >= 0 ? '+' : ''}${d.shortZ.toFixed(2)}</span>
                </div>

                <div style="display:flex; justify-content:space-between; gap:16px; margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
                    <span style="color:rgba(255,255,255,0.5); font-size:0.58rem;">NG=F PRICE</span>
                    <span style="color:#4ab8d8; font-weight:700; font-family:'JetBrains Mono';">${ngClose !== undefined ? '$' + ngClose.toFixed(3) : '—'}</span>
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
            let ty = cellTop - tooltipHeight - 10; // 10px above the cell
            
            // Flip below if not enough room above container
            if (ty < 5) {
                ty = cellTop + cellHeight + 10;
            }
            
            // Horizontal bounds clamping relative to the container
            const containerWidth = container.offsetWidth;
            if (tx < 5) tx = 5;
            if (tx + tooltipWidth > containerWidth - 5) {
                tx = containerWidth - tooltipWidth - 5;
            }
            
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
        });
        
        cell.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });
}

// ---- Flow Velocity & Exhaustion Engine ----

function getFlowVelVisible() {
    const cz = state.compositeZ;
    if (!cz || cz.length === 0) return { flow: [], ng: [] };
    const base = applyTimeFilter(cz);
    const z = state.zoomFlowVel || { start: 0, end: 1 };
    const s = Math.floor(z.start * base.length);
    const e = Math.ceil(z.end * base.length);
    const flow = base.slice(s, e);
    const ng = flow.map(f => ({ date: f.date, close: state.ngHistory[f.date] || null }));
    return { flow, ng };
}

function renderFlowVelChart() {
    const { flow, ng } = getFlowVelVisible();
    if (!flow || flow.length < 2) return;
    drawChartFlowVelocity(flow, ng);
}

function drawChartFlowVelocity(flow, ng) {
    const cvs = el('chartFlowVelocity');
    if (!cvs) return;
    const { w, h, dpr } = resizeCanvas(cvs);
    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 24, right: 60, bottom: 32, left: 55 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    if (cw < 20 || ch < 20) return;

    const dates = flow.map(d => d.date);
    const ngVals = ng.map(d => d.close);
    const validNG = ngVals.filter(v => v !== null);

    const zVals = flow.map(f => f.z || 0);
    const vel1d = [0];
    for (let i = 1; i < zVals.length; i++) vel1d.push(zVals[i] - zVals[i-1]);

    const vel3d = [0, 0, 0];
    for (let i = 3; i < zVals.length; i++) vel3d.push(zVals[i] - zVals[i-3]);

    const velZ1d = [];
    const velZ3d = [];
    for (let i = 0; i < flow.length; i++) {
        const sub1 = vel1d.slice(Math.max(0, i - 20), i + 1);
        const m1 = sub1.reduce((a,b)=>a+b,0) / sub1.length;
        const s1 = Math.sqrt(sub1.reduce((a,b)=>a+Math.pow(b-m1,2),0) / Math.max(1, sub1.length-1)) || 1.0;
        velZ1d.push((vel1d[i] - m1) / s1);

        const sub3 = vel3d.slice(Math.max(0, i - 20), i + 1);
        const m3 = sub3.reduce((a,b)=>a+b,0) / sub3.length;
        const s3 = Math.sqrt(sub3.reduce((a,b)=>a+Math.pow(b-m3,2),0) / Math.max(1, sub3.length-1)) || 1.0;
        velZ3d.push((vel3d[i] - m3) / s3);
    }

    state.velValsCache = flow.map((f, i) => {
        const v1 = velZ1d[i];
        const v3 = velZ3d[i];
        const ngP = ngVals[i];
        
        let cycleState = 'NEUTRAL';
        let timingStatus = 'REVERSAL CONFIRMATION';
        let actionGuidance = 'Flow velocity within normal equilibrium range.';
        
        const isHigh30 = ngP && validNG.length > 30 && ngP >= Math.max(...ngVals.slice(Math.max(0, i - 30), i + 1)) * 0.95;
        const isLow30 = ngP && validNG.length > 30 && ngP <= Math.min(...ngVals.slice(Math.max(0, i - 30), i + 1)) * 1.05;

        if (isHigh30 && v3 < -0.5) {
            cycleState = 'FLOW EXHAUSTION WARNING';
            timingStatus = 'LEAD WARNING (-30d to -60d)';
            actionGuidance = 'Buyer depletion near 30d high. Exit BOIL / Prepare KOLD.';
        } else if (isLow30 && (f.longZ > 1.0 || v1 >= 1.8)) {
            cycleState = 'BULL LAUNCH IMPULSE';
            timingStatus = 'ANTICIPATORY LEAD WARNING';
            actionGuidance = 'Institutional accumulation near 30d low (1-5d early). Buy BOIL.';
        } else if (v1 <= -1.8) {
            cycleState = 'SHORT SURGE IMPULSE';
            timingStatus = 'BREAKDOWN ACCELERATION';
            actionGuidance = 'Short ETF surge spike. Downside breakdown momentum active.';
        } else if (isLow30 && f.shortZ > 1.5) {
            cycleState = 'SHORT EXHAUSTION BOTTOM';
            timingStatus = 'SHORT SQUEEZE BOTTOMING';
            actionGuidance = 'Short seller capacity oversaturated. Prepare BOIL squeeze.';
        }

        return { vel1d: v1, vel3d: v3, longZ: f.longZ, shortZ: f.shortZ, cycleState, timingStatus, actionGuidance };
    });

    const rawMax = Math.max(2.5, ...velZ1d.map(v => isFinite(v) ? Math.abs(v) : 0), ...velZ3d.map(v => isFinite(v) ? Math.abs(v) : 0));
    const scale = Math.min(4.0, rawMax * 1.05);
    const y0 = pad.top + ch / 2;

    const getX = i => pad.left + (i / (flow.length - 1)) * cw;
    const getYVel = v => {
        const clampedV = Math.max(-scale, Math.min(scale, v));
        return y0 - (clampedV / scale) * (ch / 2);
    };

    let minNG = validNG.length > 0 ? Math.min(...validNG) : 0;
    let maxNG = validNG.length > 0 ? Math.max(...validNG) : 10;
    const ngPad = (maxNG - minNG) * 0.08; minNG = Math.max(0, minNG - ngPad); maxNG += ngPad;
    const getYNG = v => pad.top + (1 - (v - minNG) / (maxNG - minNG)) * ch;

    // Use clip box so chart graphics never overflow into pad margins or date axis
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, cw, ch);
    ctx.clip();

    // 1. Shaded Exhaustion Zones
    for (let i = 0; i < flow.length; i++) {
        if (state.velValsCache[i] && state.velValsCache[i].cycleState === 'FLOW EXHAUSTION WARNING') {
            const x = getX(i);
            const bw = Math.max(1, cw / flow.length);
            ctx.fillStyle = 'rgba(245,158,11,0.12)';
            ctx.fillRect(x - bw / 2, pad.top, bw, ch);
        }
    }

    // 2. Reference Lines
    const y2p = getYVel(2.0), y2n = getYVel(-2.0);
    ctx.setLineDash([4, 3]); ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(61,184,122,0.35)';
    ctx.beginPath(); ctx.moveTo(pad.left, y2p); ctx.lineTo(pad.left + cw, y2p); ctx.stroke();
    ctx.strokeStyle = 'rgba(239,68,68,0.35)';
    ctx.beginPath(); ctx.moveTo(pad.left, y2n); ctx.lineTo(pad.left + cw, y2n); ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath(); ctx.moveTo(pad.left, y0); ctx.lineTo(pad.left + cw, y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.2; ctx.stroke();

    // 3. Velocity Histogram Bars (1D Velocity Z)
    const bw = Math.max(1, (cw / flow.length) * 0.8);
    for (let i = 0; i < flow.length; i++) {
        const v = velZ1d[i];
        if (!isFinite(v) || Math.abs(v) < 0.1) continue;
        const x = getX(i);
        ctx.fillStyle = v > 0 ? 'rgba(61,184,122,0.75)' : 'rgba(239,68,68,0.75)';
        const yTop = getYVel(v);
        ctx.fillRect(x - bw / 2, Math.min(yTop, y0), bw, Math.abs(yTop - y0));
    }

    // 4. 3D Cumulative Velocity Z Line (Cyan Overlay)
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < flow.length; i++) {
        const v = velZ3d[i];
        if (!isFinite(v)) continue;
        const x = getX(i), y = getYVel(v);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    }
    ctx.strokeStyle = '#4ab8d8'; ctx.lineWidth = 1.6; ctx.stroke();

    // 5. NG=F Price Line
    ctx.beginPath();
    started = false;
    for (let i = 0; i < ng.length; i++) {
        if (ngVals[i] === null) continue;
        const x = getX(i), y = getYNG(ngVals[i]);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);

    ctx.restore(); // Restore clip context

    // 6. Axes Ticks
    const velTicks = [-2.0, -1.0, 0, 1.0, 2.0];
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '9px sans-serif';
    velTicks.forEach(v => {
        const y = getYVel(v);
        if (y >= pad.top - 2 && y <= pad.top + ch + 2) {
            ctx.fillStyle = Math.abs(v) >= 1.5 ? (v >= 0 ? '#3db87a' : '#ef4444') : 'rgba(148,163,184,0.6)';
            ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1) + 'σ', pad.left - 6, y);
        }
    });

    drawXAxis(ctx, dates, getX, cw, pad.top + ch + 14, pad);

    // 7. Prominent Hover Crosshair & Glowing Pointer Dots
    if (state.hoverFlowVelIdx !== null && state.hoverFlowVelIdx >= 0 && state.hoverFlowVelIdx < flow.length) {
        const i = state.hoverFlowVelIdx;
        const x = getX(i);

        // Bright vertical crosshair line
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch);
        ctx.strokeStyle = 'rgba(0,255,255,0.45)'; ctx.lineWidth = 1.2; ctx.setLineDash([]); ctx.stroke();

        const v3 = velZ3d[i];
        const v1 = velZ1d[i];

        // Pointer 1: 3D Velocity Z Line (Cyan Glow Pointer)
        if (isFinite(v3)) {
            const y3 = getYVel(v3);
            ctx.beginPath(); ctx.arc(x, y3, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,255,255,0.25)'; ctx.fill();
            ctx.beginPath(); ctx.arc(x, y3, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#4ab8d8'; ctx.fill();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
        }

        // Pointer 2: 1D Velocity Bar (Green/Red Glow Pointer)
        if (isFinite(v1) && Math.abs(v1) >= 0.1) {
            const y1 = getYVel(v1);
            const pCol = v1 >= 0 ? '#3db87a' : '#ef4444';
            ctx.beginPath(); ctx.arc(x, y1, 7, 0, Math.PI * 2);
            ctx.fillStyle = v1 >= 0 ? 'rgba(61,184,122,0.3)' : 'rgba(239,68,68,0.3)'; ctx.fill();
            ctx.beginPath(); ctx.arc(x, y1, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = pCol; ctx.fill();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
        }

        // Pointer 3: NG=F Benchmark Price Line (White Glow Pointer)
        if (ngVals[i] !== null && ngVals[i] !== undefined) {
            const yNg = getYNG(ngVals[i]);
            ctx.beginPath(); ctx.arc(x, yNg, 7, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
            ctx.beginPath(); ctx.arc(x, yNg, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff'; ctx.fill();
            ctx.strokeStyle = '#4ab8d8'; ctx.lineWidth = 1.5; ctx.stroke();
        }
    }
}

// ---- Velocity Hover Handlers ----
function handleFlowVelocityHover(e) {
    const { flow, ng } = getFlowVelVisible();
    if (!flow || flow.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padObj = { left: 55, right: 60 };
    const cw = rect.width - padObj.left - padObj.right;
    const frac = (x - padObj.left) / cw;
    const idx = Math.round(frac * (flow.length - 1));
    if (idx < 0 || idx >= flow.length) { hideFlowVelocityHover(); return; }
    
    state.hoverFlowVelIdx = idx;
    drawChartFlowVelocity(flow, ng);
    
    const d = flow[idx];
    const ngClose = ng[idx] ? ng[idx].close : null;
    const cache = (state.velValsCache && state.velValsCache[idx]) ? state.velValsCache[idx] : { vel1d: 0, vel3d: 0, cycleState: 'NEUTRAL', timingStatus: 'REVERSAL CONFIRMATION' };
    const tip = document.getElementById('flowvel-tooltip');
    if (!tip) return;

    const v1Str = (cache.vel1d >= 0 ? '+' : '') + cache.vel1d.toFixed(2) + 'σ';
    const v3Str = (cache.vel3d >= 0 ? '+' : '') + cache.vel3d.toFixed(2) + 'σ';
    const v3Color = cache.vel3d >= 0 ? '#3db87a' : '#ef4444';
    
    const isExhaustion = cache.cycleState === 'FLOW EXHAUSTION WARNING';
    const isLaunch = cache.cycleState === 'BULL LAUNCH IMPULSE';
    const isSurge = cache.cycleState === 'SHORT SURGE IMPULSE';
    const isSqueeze = cache.cycleState === 'SHORT EXHAUSTION BOTTOM';

    let stateColor = '#94a3b8';
    if (isExhaustion) stateColor = '#f59e0b';
    else if (isLaunch) stateColor = '#3db87a';
    else if (isSurge || isSqueeze) stateColor = '#ef4444';

    tip.innerHTML = `
        <div style="color:var(--cyan); font-size:0.72rem; font-weight:800; margin-bottom:6px;">${fmtDateLong(d.date)}</div>
        <div style="display:flex; justify-content:space-between; gap:16px;">
            <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">1D VELOCITY Z</span>
            <span style="color:${cache.vel1d >= 0 ? '#3db87a' : '#ef4444'}; font-weight:800; font-family:'JetBrains Mono',monospace;">${v1Str}</span>
        </div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:2px;">
            <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">3D VELOCITY Z</span>
            <span style="color:${v3Color}; font-weight:800; font-family:'JetBrains Mono',monospace;">${v3Str}</span>
        </div>
        <div style="color:${stateColor}; font-size:0.64rem; font-weight:800; margin-top:6px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06); text-transform:uppercase;">
            [${cache.cycleState}]
        </div>
        <div style="color:rgba(255,255,255,0.7); font-size:0.58rem; margin-top:2px; font-weight:600; line-height:1.35;">
            ${cache.actionGuidance || cache.timingStatus}
        </div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:6px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
            <span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">NG=F PRICE</span>
            <span style="color:#4ab8d8; font-weight:800; font-family:'JetBrains Mono',monospace;">${ngClose !== null ? '$' + ngClose.toFixed(3) : 'N/A'}</span>
        </div>`;
    tip.style.display = 'block';
    const tx = Math.min(rect.width - 240, Math.max(10, x - 110));
    tip.style.left = tx + 'px'; tip.style.top = '10px';
}

function hideFlowVelocityHover() {
    state.hoverFlowVelIdx = null;
    const tip = document.getElementById('flowvel-tooltip');
    if (tip) tip.style.display = 'none';
    renderFlowVelChart();
}

function initFlowVelSlider() {
    const sS = document.getElementById('flowvel-range-start');
    const sE = document.getElementById('flowvel-range-end');
    if (!sS || !sE) return;
    function onInput() {
        let s = parseInt(sS.value) / 1000, e = parseInt(sE.value) / 1000;
        if (s > e - 0.02) { s = e - 0.02; sS.value = Math.round(s * 1000); }
        state.zoomFlowVel = { start: s, end: e };
        renderFlowVelChart();
        syncFlowVelSlider();
    }
    sS.addEventListener('input', onInput);
    sE.addEventListener('input', onInput);
}

function syncFlowVelSlider() {
    const sS = document.getElementById('flowvel-range-start');
    const sE = document.getElementById('flowvel-range-end');
    const hl = document.getElementById('flowvel-range-highlight');
    const lbl = document.getElementById('flowvel-range-label');
    if (!sS || !sE) return;
    sS.value = Math.round((state.zoomFlowVel ? state.zoomFlowVel.start : 0) * 1000);
    sE.value = Math.round((state.zoomFlowVel ? state.zoomFlowVel.end : 1) * 1000);
    if (hl) {
        const start = state.zoomFlowVel ? state.zoomFlowVel.start : 0;
        const end = state.zoomFlowVel ? state.zoomFlowVel.end : 1;
        hl.style.left = (start * 100) + '%';
        hl.style.width = ((end - start) * 100) + '%';
    }
    if (lbl) {
        const start = state.zoomFlowVel ? state.zoomFlowVel.start : 0;
        const end = state.zoomFlowVel ? state.zoomFlowVel.end : 1;
        const isZoomed = start > 0.001 || end < 0.999;
        lbl.textContent = isZoomed ? 'CUSTOM SELECTION' : `PRESET: ${state.timeRange.toUpperCase()}`;
    }
}


