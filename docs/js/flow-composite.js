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
    let minZ = Math.min(...vals, -0.5);
    let maxZ = Math.max(...vals, 0.5);
    const zPad = (maxZ - minZ) * 0.1;
    minZ -= zPad; maxZ += zPad;

    const getX = i => pad.left + (i / (data.length - 1)) * cw;
    const getY = v => pad.top + (1 - (v - minZ) / (maxZ - minZ)) * ch;

    // Threshold bands (±1.5)
    const y15p = getY(1.5), y15n = getY(-1.5);
    if (1.5 < maxZ) {
        ctx.fillStyle = 'rgba(61,184,122,0.04)';
        ctx.fillRect(pad.left, pad.top, cw, Math.max(0, y15p - pad.top));
    }
    if (-1.5 > minZ) {
        ctx.fillStyle = 'rgba(239,68,68,0.04)';
        ctx.fillRect(pad.left, y15n, cw, Math.max(0, pad.top + ch - y15n));
    }

    // Zero line
    const y0 = getY(0);
    ctx.beginPath(); ctx.moveTo(pad.left, y0); ctx.lineTo(pad.left + cw, y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();

    // ±1.5 threshold lines
    [1.5, -1.5].forEach(v => {
        if (v > minZ && v < maxZ) {
            const yy = getY(v);
            ctx.beginPath(); ctx.setLineDash([4, 4]);
            ctx.moveTo(pad.left, yy); ctx.lineTo(pad.left + cw, yy);
            ctx.strokeStyle = 'rgba(0,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.setLineDash([]);
        }
    });

    // Filled area chart
    ctx.beginPath();
    ctx.moveTo(getX(0), y0);
    for (let i = 0; i < data.length; i++) ctx.lineTo(getX(i), getY(vals[i]));
    ctx.lineTo(getX(data.length - 1), y0);
    ctx.closePath();

    // Split fill: green above zero, red below
    ctx.save();
    ctx.clip();
    // Green above
    ctx.fillStyle = 'rgba(61,184,122,0.25)';
    ctx.fillRect(pad.left, pad.top, cw, y0 - pad.top);
    // Red below
    ctx.fillStyle = 'rgba(239,68,68,0.25)';
    ctx.fillRect(pad.left, y0, cw, pad.top + ch - y0);
    ctx.restore();

    // Line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = getX(i), y = getY(vals[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();

    // Y-axis
    const yTicks = niceAxisTicks(minZ, maxZ, 6);
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    yTicks.forEach(v => {
        const y = getY(v);
        if (y < pad.top - 5 || y > pad.top + ch + 5) return;
        ctx.fillText(v.toFixed(1), pad.left - 6, y + 3);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y);
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1; ctx.stroke();
    });

    // X-axis
    drawXAxis(ctx, dates, getX, cw, pad.top + ch + 14, pad);

    // Hover crosshair
    if (state.hoverCompZIdx !== null && state.hoverCompZIdx < data.length) {
        const i = state.hoverCompZIdx;
        const x = getX(i), y = getY(vals[i]);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = vals[i] >= 0 ? '#3db87a' : '#ef4444'; ctx.fill();
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

    const pad = { top: 20, right: 55, bottom: 32, left: 55 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    if (cw < 20 || ch < 20) return;

    const dates = flow.map(d => d.date);
    const zVals = flow.map(d => d.z);
    const ngVals = ng.map(d => d.close);
    const validNG = ngVals.filter(v => v !== null);

    let minZ = Math.min(...zVals, -0.5), maxZ = Math.max(...zVals, 0.5);
    const zPad2 = (maxZ - minZ) * 0.1; minZ -= zPad2; maxZ += zPad2;

    let minNG = validNG.length > 0 ? Math.min(...validNG) : 0;
    let maxNG = validNG.length > 0 ? Math.max(...validNG) : 10;
    const ngPad = (maxNG - minNG) * 0.08; minNG = Math.max(0, minNG - ngPad); maxNG += ngPad;

    const getX = i => pad.left + (i / (flow.length - 1)) * cw;
    const getYZ = v => pad.top + (1 - (v - minZ) / (maxZ - minZ)) * ch;
    const getYNG = v => pad.top + (1 - (v - minNG) / (maxNG - minNG)) * ch;
    const y0 = getYZ(0);

    // Zero line
    ctx.beginPath(); ctx.moveTo(pad.left, y0); ctx.lineTo(pad.left + cw, y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();

    // Z-score filled area
    ctx.beginPath(); ctx.moveTo(getX(0), y0);
    for (let i = 0; i < flow.length; i++) ctx.lineTo(getX(i), getYZ(zVals[i]));
    ctx.lineTo(getX(flow.length - 1), y0); ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(61,184,122,0.18)';
    ctx.fillRect(pad.left, pad.top, cw, y0 - pad.top);
    ctx.fillStyle = 'rgba(239,68,68,0.18)';
    ctx.fillRect(pad.left, y0, cw, pad.top + ch - y0);
    ctx.restore();

    // NG=F price line
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < ng.length; i++) {
        if (ngVals[i] === null) continue;
        const x = getX(i), y = getYNG(ngVals[i]);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    }
    ctx.strokeStyle = '#5090a0'; ctx.lineWidth = 2; ctx.stroke();

    // Left Y-axis (Z-Score)
    const zTicks = niceAxisTicks(minZ, maxZ, 5);
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    zTicks.forEach(v => {
        const y = getYZ(v);
        if (y < pad.top - 5 || y > pad.top + ch + 5) return;
        ctx.fillText(v.toFixed(1), pad.left - 6, y + 3);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y);
        ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1; ctx.stroke();
    });

    // Right Y-axis (NG Price)
    const ngTicks = niceAxisTicks(minNG, maxNG, 5);
    ctx.fillStyle = '#5090a0'; ctx.textAlign = 'left';
    ngTicks.forEach(v => {
        const y = getYNG(v);
        if (y < pad.top - 5 || y > pad.top + ch + 5) return;
        ctx.fillText('$' + v.toFixed(2), pad.left + cw + 6, y + 3);
    });

    // X-axis
    drawXAxis(ctx, dates, getX, cw, pad.top + ch + 14, pad);

    // Hover
    if (state.hoverFlowNGIdx !== null && state.hoverFlowNGIdx < flow.length) {
        const i = state.hoverFlowNGIdx;
        const x = getX(i);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
        // Z dot
        const yz = getYZ(zVals[i]);
        ctx.beginPath(); ctx.arc(x, yz, 4, 0, Math.PI * 2);
        ctx.fillStyle = zVals[i] >= 0 ? '#3db87a' : '#ef4444'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        // NG dot
        if (ngVals[i] !== null) {
            const yn = getYNG(ngVals[i]);
            ctx.beginPath(); ctx.arc(x, yn, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#5090a0'; ctx.fill();
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
    drawChartFlowNG(flow, ng);
    const d = flow[idx];
    const ngClose = ng[idx] ? ng[idx].close : null;
    const tip = document.getElementById('flowng-tooltip');
    const color = d.z >= 0 ? '#3db87a' : '#ef4444';
    tip.innerHTML = `<div style="color:var(--cyan); font-size:0.7rem; font-weight:800; margin-bottom:6px;">${fmtDateLong(d.date)}</div>
        <div style="display:flex; justify-content:space-between; gap:16px;"><span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">FLOW PRESSURE</span><span style="color:${color}; font-weight:800; font-family:'JetBrains Mono',monospace;">${d.z >= 0 ? '+' : ''}${d.z.toFixed(3)}σ</span></div>
        <div style="display:flex; justify-content:space-between; gap:16px; margin-top:3px;"><span style="color:rgba(255,255,255,0.6); font-size:0.62rem;">NG=F PRICE</span><span style="color:#5090a0; font-weight:800; font-family:'JetBrains Mono',monospace;">${ngClose !== null ? '$' + ngClose.toFixed(3) : 'N/A'}</span></div>`;
    tip.style.display = 'block';
    const tx = Math.min(rect.width - 220, Math.max(10, x - 100));
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
