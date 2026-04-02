/* ============================================================
   CVOL Rendering Engine — Part 2
   Appended to cvol.js core engine
   ============================================================ */

// ── Visible Range Helper ──────────────────────────────────────
function getVisibleRange() {
    const data = CvolState.data;
    if (!data || !data.length) return { s: 0, e: 0 };
    const n = data.length;
    const s = Math.floor(CvolState.rangeState.start / 100 * (n - 1));
    const e = Math.ceil(CvolState.rangeState.end / 100 * (n - 1));
    return { s: Math.max(0, s), e: Math.min(n - 1, Math.max(s + 1, e)) };
}

// ── Main Chart Renderer ───────────────────────────────────────
function renderMainChart() {
    const canvas = document.getElementById('cvol-canvas');
    if (!canvas || !CvolState.data) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const pad = { top: 20, bottom: 35, left: 60, right: 70 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const { s, e } = getVisibleRange();
    const visData = CvolState.data.slice(s, e + 1);
    const visDates = visData.map(r => r.date);
    const n = visData.length;
    if (n < 2) return;

    const getX = i => pad.left + (i / (n - 1)) * chartW;

    const leftSeries = CvolState.activeSeries.filter(k => SERIES_CFG[k] && SERIES_CFG[k].axis === 'left');
    const rightSeries = CvolState.activeSeries.filter(k => SERIES_CFG[k] && SERIES_CFG[k].axis === 'right');
    const right2Series = CvolState.activeSeries.filter(k => SERIES_CFG[k] && SERIES_CFG[k].axis === 'right2');

    function getRange(keys) {
        let min = Infinity, max = -Infinity;
        keys.forEach(k => {
            for (const r of visData) {
                const v = r[SERIES_CFG[k].key];
                if (v != null && isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
            }
        });
        if (!isFinite(min)) return { min: 0, max: 1 };
        const m = (max - min) * 0.08 || 1;
        return { min: min - m, max: max + m };
    }

    const leftR = leftSeries.length ? getRange(leftSeries) : { min: 0, max: 100 };
    const rightR = rightSeries.length ? getRange(rightSeries) : null;
    const right2R = right2Series.length ? getRange(right2Series) : null;
    const getY = (v, range) => pad.top + chartH - ((v - range.min) / (range.max - range.min)) * chartH;

    // Regime background bands
    const comp = CvolState.composites;
    if (comp.ngvlPct252) {
        for (let i = 0; i < n; i++) {
            const gi = s + i;
            const pct = comp.ngvlPct252[gi];
            if (pct == null) continue;
            const reg = ngvlRegime(pct);
            ctx.fillStyle = toRgba(reg.color, 0.04);
            const x0 = getX(i), x1 = i < n - 1 ? getX(i + 1) : x0 + chartW / n;
            ctx.fillRect(x0, pad.top, x1 - x0, chartH);
        }
    }

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = pad.top + (i / 5) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
    }

    // Y-axis left
    if (leftSeries.length) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
            const v = leftR.min + (1 - i / 5) * (leftR.max - leftR.min);
            ctx.fillText(v.toFixed(1) + '%', pad.left - 6, pad.top + (i / 5) * chartH + 3);
        }
    }
    // Y-axis right
    if (rightR) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        for (let i = 0; i <= 5; i++) {
            const v = rightR.min + (1 - i / 5) * (rightR.max - rightR.min);
            ctx.fillText('$' + v.toFixed(2), pad.left + chartW + 6, pad.top + (i / 5) * chartH + 3);
        }
    }

    drawXAxis(ctx, visDates, getX, chartW, H - 8, pad);

    // Draw lines
    function drawLine(key, range, lw) {
        const cfg = SERIES_CFG[key]; ctx.strokeStyle = cfg.color; ctx.lineWidth = lw;
        ctx.beginPath(); let started = false;
        for (let i = 0; i < n; i++) {
            const v = visData[i][cfg.key]; if (v == null) continue;
            const x = getX(i), y = getY(v, range);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    leftSeries.forEach(k => drawLine(k, leftR, k === 'ngvl' ? 2 : 1.2));
    if (rightR) rightSeries.forEach(k => drawLine(k, rightR, 1.5));
    if (right2R) right2Series.forEach(k => drawLine(k, right2R, 1.2));

    // Pulse dots
    CvolState.activeSeries.forEach(k => {
        const cfg = SERIES_CFG[k]; const lastV = visData[n - 1][cfg.key]; if (lastV == null) return;
        const range = cfg.axis === 'left' ? leftR : cfg.axis === 'right' ? rightR : right2R;
        if (!range) return;
        const x = getX(n - 1), y = getY(lastV, range);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = cfg.color; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = toRgba(cfg.color, 0.3); ctx.lineWidth = 2; ctx.stroke();
    });

    // Hover crosshair
    if (CvolState.hoverState != null) {
        const hi = CvolState.hoverState - s;
        if (hi >= 0 && hi < n) {
            const x = getX(hi);
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + chartH);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
            const tooltip = document.getElementById('cvol-tooltip');
            if (tooltip) {
                const row = visData[hi];
                let html = '<div class="tooltip-date">' + fmtDate(row.date) + '</div>';
                CvolState.activeSeries.forEach(k => {
                    const cfg = SERIES_CFG[k]; const v = row[cfg.key];
                    html += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:' + cfg.color + '">' + cfg.label + '</span><span class="tooltip-val">' + (v != null ? (cfg.unit === '$' ? '$' + v.toFixed(2) : v.toFixed(2) + cfg.unit) : '—') + '</span></div>';
                });
                tooltip.innerHTML = html; tooltip.style.display = 'block';
                tooltip.style.left = (x + pad.left > W / 2 ? x - 180 : x + 20) + 'px';
                tooltip.style.top = (pad.top + 10) + 'px';
            }
        }
    }
}

// ── Sparkline Renderer ────────────────────────────────────────
function renderSparkline(canvasId, values, color, thresholdY) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    const valid = values.filter(v => v != null);
    const slice = valid.slice(-90);
    if (slice.length < 3) return;
    let min = Math.min(...slice), max = Math.max(...slice);
    const m = (max - min) * 0.1 || 0.1; min -= m; max += m;
    const p = 2;
    const getX = i => p + (i / (slice.length - 1)) * (W - p * 2);
    const getY = v => p + (1 - (v - min) / (max - min)) * (H - p * 2);
    ctx.beginPath(); ctx.moveTo(getX(0), H);
    for (let i = 0; i < slice.length; i++) ctx.lineTo(getX(i), getY(slice[i]));
    ctx.lineTo(getX(slice.length - 1), H); ctx.closePath();
    ctx.fillStyle = toRgba(color, 0.08); ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < slice.length; i++) { const x = getX(i), y = getY(slice[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    if (thresholdY != null && thresholdY >= min && thresholdY <= max) {
        ctx.beginPath(); ctx.moveTo(0, getY(thresholdY)); ctx.lineTo(W, getY(thresholdY));
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(getX(slice.length - 1), getY(slice[slice.length - 1]), 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
}
