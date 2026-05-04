// ============================================================
// Flow Composite Charts — Composite Z-Score + Flow vs NG Price
// ============================================================

const SHORT_TICKERS = ['KOLD', 'HND', '3NGS'];

// ---- Computation ----
function computeCompositeZ() {
    const tickers = ['BOIL','HNU','3NGL','KOLD','HND','3NGS'];
    const dateMap = {};
    tickers.forEach(tk => {
        const d = state.cache[tk];
        if (!d || !d.data) return;
        d.data.forEach(row => {
            if (!dateMap[row.date]) dateMap[row.date] = {};
            const z = row.flow_zscore || 0;
            dateMap[row.date][tk] = SHORT_TICKERS.includes(tk) ? -z : z;
        });
    });
    const dates = Object.keys(dateMap).sort();
    state.compositeZ = dates.map(date => {
        const vals = dateMap[date];
        const zArr = Object.values(vals);
        if (zArr.length === 0) return { date, z: 0, count: 0 };
        const avg = zArr.reduce((a, b) => a + b, 0) / zArr.length;
        const longZ = tickers.filter(t => !SHORT_TICKERS.includes(t))
            .map(t => vals[t] || 0).reduce((a,b) => a+b, 0) / 3;
        const shortZ = SHORT_TICKERS
            .map(t => vals[t] || 0).reduce((a,b) => a+b, 0) / 3;
        return { date, z: Math.round(avg * 10000) / 10000, longZ: Math.round(longZ*1e4)/1e4, shortZ: Math.round(shortZ*1e4)/1e4, count: zArr.length };
    });
    updateCompZReading();
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
    if (state.timeRange === 'all') return data;
    const now = new Date();
    const map = { '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365, '2y': 730 };
    const days = map[state.timeRange] || data.length;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    const cutStr = cutoff.toISOString().split('T')[0];
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

    const divData = flow.map(f => {
        const ni = ngDateIdx[f.date];
        if (ni === undefined || ni < 5) return { signed: 0, ng5d: null };
        const p0 = state.ngHistory[state.ngDates[ni - 5]];
        const p1 = state.ngHistory[state.ngDates[ni]];
        if (!p0 || !p1 || p0 === 0) return { signed: 0, ng5d: null };
        const ng5d = (p1 - p0) / p0;
        if (Math.abs(ng5d) < 0.005 || Math.abs(f.z) < 0.3) return { signed: 0, ng5d };
        const flowUp = f.z > 0, ngUp = ng5d > 0;
        if (flowUp === ngUp) return { signed: 0, ng5d };
        return { signed: flowUp ? Math.abs(f.z) : -Math.abs(f.z), ng5d };
    });
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
