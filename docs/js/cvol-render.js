/* ============================================================
   CVOL Rendering Engine — Part 2
   Sparklines with axes/hover, Variance Decomposition, Modal chart
   ============================================================ */

// ── Visible Range Helper ──────────────────────────────────────
function getVisibleRange() {
    var data = CvolState.data;
    if (!data || !data.length) return { s: 0, e: 0 };
    var n = data.length;
    var s = Math.floor(CvolState.rangeState.start / 100 * (n - 1));
    var e = Math.ceil(CvolState.rangeState.end / 100 * (n - 1));
    return { s: Math.max(0, s), e: Math.min(n - 1, Math.max(s + 1, e)) };
}

// ── Main Chart Renderer ───────────────────────────────────────
function renderMainChart() {
    var canvas = document.getElementById('cvol-canvas');
    if (!canvas || !CvolState.data) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    var pad = { top: 20, bottom: 35, left: 60, right: 70 };
    var chartW = W - pad.left - pad.right;
    var chartH = H - pad.top - pad.bottom;
    var r = getVisibleRange();
    var visData = CvolState.data.slice(r.s, r.e + 1);
    var visDates = visData.map(function(d) { return d.date; });
    var n = visData.length;
    if (n < 2) return;
    var getX = function(i) { return pad.left + (i / (n - 1)) * chartW; };

    var leftSeries = CvolState.activeSeries.filter(function(k) { return SERIES_CFG[k] && SERIES_CFG[k].axis === 'left'; });
    var rightSeries = CvolState.activeSeries.filter(function(k) { return SERIES_CFG[k] && SERIES_CFG[k].axis === 'right'; });
    var right2Series = CvolState.activeSeries.filter(function(k) { return SERIES_CFG[k] && SERIES_CFG[k].axis === 'right2'; });

    function getRange(keys) {
        var min = Infinity, max = -Infinity;
        keys.forEach(function(k) {
            for (var i = 0; i < n; i++) {
                var v = visData[i][SERIES_CFG[k].key];
                if (v != null && isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
            }
        });
        if (!isFinite(min)) return { min: 0, max: 1 };
        var m = (max - min) * 0.08 || 1;
        return { min: min - m, max: max + m };
    }

    var leftR = leftSeries.length ? getRange(leftSeries) : { min: 0, max: 100 };
    var rightR = rightSeries.length ? getRange(rightSeries) : null;
    var right2R = right2Series.length ? getRange(right2Series) : null;
    var getY = function(v, range) { return pad.top + chartH - ((v - range.min) / (range.max - range.min)) * chartH; };

    // Regime background bands
    var comp = CvolState.composites;
    if (comp.ngvlPct252) {
        for (var i = 0; i < n; i++) {
            var gi = r.s + i;
            var pct = comp.ngvlPct252[gi];
            if (pct == null) continue;
            var reg = ngvlRegime(pct);
            ctx.fillStyle = toRgba(reg.color, 0.04);
            var x0 = getX(i), x1 = i < n - 1 ? getX(i + 1) : x0 + chartW / n;
            ctx.fillRect(x0, pad.top, x1 - x0, chartH);
        }
    }

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 5; g++) {
        var gy = pad.top + (g / 5) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + chartW, gy); ctx.stroke();
    }

    // Y-axis left
    if (leftSeries.length) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        for (var i = 0; i <= 5; i++) {
            var v = leftR.min + (1 - i / 5) * (leftR.max - leftR.min);
            ctx.fillText(v.toFixed(1) + '%', pad.left - 6, pad.top + (i / 5) * chartH + 3);
        }
    }
    // Y-axis right
    if (rightR) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        for (var i = 0; i <= 5; i++) {
            var v = rightR.min + (1 - i / 5) * (rightR.max - rightR.min);
            ctx.fillText('$' + v.toFixed(2), pad.left + chartW + 6, pad.top + (i / 5) * chartH + 3);
        }
    }

    drawXAxis(ctx, visDates, getX, chartW, H - 8, pad);

    // Draw lines
    function drawLine(key, range, lw) {
        var cfg = SERIES_CFG[key]; ctx.strokeStyle = cfg.color; ctx.lineWidth = lw;
        ctx.beginPath(); var started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i][cfg.key]; if (v == null) continue;
            var x = getX(i), y = getY(v, range);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    leftSeries.forEach(function(k) { drawLine(k, leftR, k === 'ngvl' ? 2 : 1.2); });
    if (rightR) rightSeries.forEach(function(k) { drawLine(k, rightR, 1.5); });
    if (right2R) right2Series.forEach(function(k) { drawLine(k, right2R, 1.2); });

    // Pulse dots
    CvolState.activeSeries.forEach(function(k) {
        var cfg = SERIES_CFG[k]; var lastV = visData[n - 1][cfg.key]; if (lastV == null) return;
        var range = cfg.axis === 'left' ? leftR : cfg.axis === 'right' ? rightR : right2R;
        if (!range) return;
        var x = getX(n - 1), y = getY(lastV, range);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = cfg.color; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = toRgba(cfg.color, 0.3); ctx.lineWidth = 2; ctx.stroke();
    });

    // Hover crosshair
    if (CvolState.hoverState != null) {
        var hi = CvolState.hoverState - r.s;
        if (hi >= 0 && hi < n) {
            var x = getX(hi);
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + chartH);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
            var tooltip = document.getElementById('cvol-tooltip');
            if (tooltip) {
                var row = visData[hi];
                var pct252 = (comp.ngvlPct252 && comp.ngvlPct252[r.s + hi]) ? comp.ngvlPct252[r.s + hi] : null;
                var reg = ngvlRegime(pct252);
                var html = '<div class="tooltip-date">' + fmtDate(row.date) + '</div>';
                html += '<div class="tooltip-regime" style="color:'+reg.color+';font-size:0.55rem;font-weight:800;margin-bottom:6px;letter-spacing:1px;">REGIME: '+reg.label+' ('+fmt(pct252,0)+'th)</div>';
                
                CvolState.activeSeries.forEach(function(k) {
                    var cfg = SERIES_CFG[k]; var v = row[cfg.key];
                    html += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:' + cfg.color + '">' + cfg.label + '</span><span class="tooltip-val">' + (v != null ? (cfg.unit === '$' ? '$' + v.toFixed(2) : v.toFixed(2) + cfg.unit) : '—') + '</span></div>';
                });
                tooltip.innerHTML = html; tooltip.style.display = 'block';
                tooltip.style.left = (x + pad.left > W / 2 ? x - 180 : x + 20) + 'px';
                tooltip.style.top = (pad.top + 10) + 'px';
            }
        }
    }
}

// ── Sparkline Renderer (with axes + hover) ────────────────────
function renderSparkline(canvasId, values, color, thresholdY) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    var valid = values.filter(function(v) { return v != null; });
    var slice = valid.slice(-90);
    if (slice.length < 3) return;

    var min = Math.min.apply(null, slice), max = Math.max.apply(null, slice);
    var m = (max - min) * 0.1 || 0.1; min -= m; max += m;

    var padL = 32, padR = 4, padT = 8, padB = 18;
    var cW = W - padL - padR, cH = H - padT - padB;
    var getX = function(i) { return padL + (i / (slice.length - 1)) * cW; };
    var getY = function(v) { return padT + (1 - (v - min) / (max - min)) * cH; };

    // Y-axis labels (3 ticks)
    ctx.fillStyle = '#555565'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
    for (var t = 0; t <= 2; t++) {
        var v = min + (1 - t / 2) * (max - min);
        var y = padT + (t / 2) * cH;
        ctx.fillText(v.toFixed(v >= 10 ? 0 : v >= 1 ? 1 : 2), padL - 3, y + 3);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // X-axis labels (start, end)
    if (CvolState.data && CvolState.data.length >= 90) {
        var startIdx = CvolState.data.length - 90;
        var endIdx = CvolState.data.length - 1;
        if (startIdx >= 0) {
            ctx.fillStyle = '#555565'; ctx.font = '7px sans-serif'; ctx.textAlign = 'left';
            var d0 = CvolState.data[startIdx].date.split('-');
            ctx.fillText(MONTHS[parseInt(d0[1]) - 1] + ' ' + d0[2].slice(2), padL, H - 2);
            ctx.textAlign = 'right';
            var d1 = CvolState.data[endIdx].date.split('-');
            ctx.fillText(MONTHS[parseInt(d1[1]) - 1] + ' ' + d1[2].slice(2), W - padR, H - 2);
        }
    }

    // Threshold band
    if (thresholdY != null && thresholdY >= min && thresholdY <= max) {
        var ty = getY(thresholdY);
        // Shade above threshold for CI, below for others
        ctx.fillStyle = toRgba(color, 0.05);
        ctx.fillRect(padL, padT, cW, ty - padT);
        ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(W - padR, ty);
        ctx.strokeStyle = toRgba(color, 0.3);
        ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        // Threshold label
        ctx.fillStyle = toRgba(color, 0.5); ctx.font = '7px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(thresholdY.toFixed(thresholdY >= 10 ? 0 : 2), padL - 3, ty + 3);
    }

    // Area fill
    ctx.beginPath(); ctx.moveTo(getX(0), padT + cH);
    for (var i = 0; i < slice.length; i++) ctx.lineTo(getX(i), getY(slice[i]));
    ctx.lineTo(getX(slice.length - 1), padT + cH); ctx.closePath();
    ctx.fillStyle = toRgba(color, 0.08); ctx.fill();

    // Line
    ctx.beginPath();
    for (var i = 0; i < slice.length; i++) {
        var x = getX(i), y = getY(slice[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();

    // End dot
    ctx.beginPath();
    ctx.arc(getX(slice.length - 1), getY(slice[slice.length - 1]), 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();

    // Store slice data for hover
    canvas._sparkData = slice;
    canvas._sparkMin = min; canvas._sparkMax = max;
    canvas._sparkPadL = padL; canvas._sparkPadR = padR;
    canvas._sparkColor = color;
}

// ── Sparkline hover setup ─────────────────────────────────────
function setupSparklineHover(canvasId, ttId) {
    var canvas = document.getElementById(canvasId);
    var tt = document.getElementById(ttId);
    if (!canvas || !tt) return;
    canvas.addEventListener('mousemove', function(ev) {
        if (!canvas._sparkData) return;
        var rect = canvas.getBoundingClientRect();
        var x = ev.clientX - rect.left;
        var slice = canvas._sparkData;
        var padL = canvas._sparkPadL || 32, padR = canvas._sparkPadR || 4;
        var cW = rect.width - padL - padR;
        var frac = (x - padL) / cW;
        var idx = Math.round(frac * (slice.length - 1));
        if (idx >= 0 && idx < slice.length) {
            var val = slice[idx];
            // Get date from global data
            var dateStr = '';
            if (CvolState.data && CvolState.data.length >= 90) {
                var gIdx = CvolState.data.length - 90 + idx;
                if (gIdx >= 0 && gIdx < CvolState.data.length) dateStr = fmtDate(CvolState.data[gIdx].date);
            }
            tt.textContent = dateStr + '  ' + val.toFixed(val >= 10 ? 1 : 3);
            tt.style.display = 'block';
            tt.style.color = canvas._sparkColor || '#fff';
            var tx = x > rect.width / 2 ? x - tt.offsetWidth - 10 : x + 10;
            tt.style.left = Math.max(0, tx) + 'px';
            tt.style.top = '4px';
        }
    });
    canvas.addEventListener('mouseleave', function() {
        tt.style.display = 'none';
    });
}

// ── Variance Decomposition Chart ──────────────────────────────
function renderVarDecomp() {
    var canvas = document.getElementById('var-decomp-canvas');
    if (!canvas || !CvolState.data) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    var pad = { top: 16, bottom: 30, left: 55, right: 55 };
    var chartW = W - pad.left - pad.right;
    var chartH = H - pad.top - pad.bottom;
    var range = getVarVisibleRange();
    var visData = CvolState.data.slice(range.s, range.e + 1);
    var visDates = visData.map(function(r) { return r.date; });
    var n = visData.length;
    if (n < 2) return;

    var getX = function(i) { return pad.left + (i / (n - 1)) * chartW; };

    // Compute ranges
    var varMin = Infinity, varMax = -Infinity;
    var skMin = Infinity, skMax = -Infinity;
    for (var i = 0; i < n; i++) {
        var up = visData[i].upVar, dn = visData[i].dnVar, sk = visData[i].skewRatio;
        if (up != null) { varMin = Math.min(varMin, up); varMax = Math.max(varMax, up); }
        if (dn != null) { varMin = Math.min(varMin, dn); varMax = Math.max(varMax, dn); }
        if (sk != null) { skMin = Math.min(skMin, sk); skMax = Math.max(skMax, sk); }
    }
    var vm = (varMax - varMin) * 0.08 || 1; varMin -= vm; varMax += vm;
    var sm = (skMax - skMin) * 0.08 || 0.1; skMin -= sm; skMax += sm;

    var getVY = function(v) { return pad.top + chartH - ((v - varMin) / (varMax - varMin)) * chartH; };
    var getSY = function(v) { return pad.top + chartH - ((v - skMin) / (skMax - skMin)) * chartH; };

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
        var gy = pad.top + (g / 4) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + chartW, gy); ctx.stroke();
    }

    // Y-axis labels left (var %)
    ctx.fillStyle = '#94a3b8'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    for (var i = 0; i <= 4; i++) {
        var v = varMin + (1 - i / 4) * (varMax - varMin);
        ctx.fillText(v.toFixed(0) + '%', pad.left - 5, pad.top + (i / 4) * chartH + 3);
    }
    // Y-axis labels right (skew ratio)
    ctx.textAlign = 'left';
    for (var i = 0; i <= 4; i++) {
        var v = skMin + (1 - i / 4) * (skMax - skMin);
        ctx.fillText(v.toFixed(2), pad.left + chartW + 5, pad.top + (i / 4) * chartH + 3);
    }

    // UP VAR area fill
    if (CvolState.varActiveSeries.indexOf('upVar') >= 0) {
        ctx.beginPath(); ctx.moveTo(getX(0), pad.top + chartH);
        for (var i = 0; i < n; i++) {
            var v = visData[i].upVar; if (v == null) continue;
            ctx.lineTo(getX(i), getVY(v));
        }
        ctx.lineTo(getX(n - 1), pad.top + chartH); ctx.closePath();
        ctx.fillStyle = 'rgba(61,184,122,0.08)'; ctx.fill();
    }

    // DN VAR area fill
    if (CvolState.varActiveSeries.indexOf('dnVar') >= 0) {
        ctx.beginPath(); ctx.moveTo(getX(0), pad.top + chartH);
        for (var i = 0; i < n; i++) {
            var v = visData[i].dnVar; if (v == null) continue;
            ctx.lineTo(getX(i), getVY(v));
        }
        ctx.lineTo(getX(n - 1), pad.top + chartH); ctx.closePath();
        ctx.fillStyle = 'rgba(239,68,68,0.08)'; ctx.fill();
    }

    // UP VAR line
    if (CvolState.varActiveSeries.indexOf('upVar') >= 0) {
        ctx.beginPath(); var started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i].upVar; if (v == null) continue;
            if (!started) { ctx.moveTo(getX(i), getVY(v)); started = true; } else ctx.lineTo(getX(i), getVY(v));
        }
        ctx.strokeStyle = '#3db87a'; ctx.lineWidth = 1.3; ctx.stroke();
    }

    // DN VAR line
    if (CvolState.varActiveSeries.indexOf('dnVar') >= 0) {
        ctx.beginPath(); started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i].dnVar; if (v == null) continue;
            if (!started) { ctx.moveTo(getX(i), getVY(v)); started = true; } else ctx.lineTo(getX(i), getVY(v));
        }
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.3; ctx.stroke();
    }

    // Skew Ratio overlay
    if (CvolState.varActiveSeries.indexOf('skewRatio') >= 0) {
        ctx.beginPath(); started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i].skewRatio; if (v == null) continue;
            if (!started) { ctx.moveTo(getX(i), getSY(v)); started = true; } else ctx.lineTo(getX(i), getSY(v));
        }
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.8; ctx.stroke();
    }

    // Skew = 1.0 reference line
    if (1.0 >= skMin && 1.0 <= skMax) {
        var refY = getSY(1.0);
        ctx.beginPath(); ctx.moveTo(pad.left, refY); ctx.lineTo(pad.left + chartW, refY);
        ctx.strokeStyle = 'rgba(245,158,11,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    // X-axis
    drawXAxis(ctx, visDates, getX, chartW, H - 5, pad);

    // Inline legend
    ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    var lx = pad.left + 8;
    if (CvolState.varActiveSeries.indexOf('upVar') >= 0) {
        ctx.fillStyle = '#3db87a'; ctx.fillText('▬ UP VAR', lx, pad.top + 12);
    }
    if (CvolState.varActiveSeries.indexOf('dnVar') >= 0) {
        ctx.fillStyle = '#ef4444'; ctx.fillText('▬ DN VAR', lx + 65, pad.top + 12);
    }
    if (CvolState.varActiveSeries.indexOf('skewRatio') >= 0) {
        ctx.fillStyle = '#f59e0b'; ctx.fillText('▬ SKEW RATIO', lx + 130, pad.top + 12);
    }

    // Hover
    if (CvolState.hoverState != null) {
        var hi = CvolState.hoverState - range.s;
        if (hi >= 0 && hi < n) {
            var x = getX(hi);
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + chartH);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
            var tip = document.getElementById('var-decomp-tooltip');
            if (tip) {
                var row = visData[hi];
                var sk = row.skewRatio;
                var sentiment = sk > 1.1 ? 'EXTREME BULLISH' : sk > 1.02 ? 'BULLISH BIAS' : sk < 0.9 ? 'EXTREME BEARISH' : sk < 0.98 ? 'BEARISH BIAS' : 'NEUTRAL';
                var ttHtml = '<div style="color:var(--cyan);font-weight:800;font-size:0.6rem;letter-spacing:1.5px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:3px;">' + fmtDate(row.date) + '</div>';
                ttHtml += '<div style="color:#f59e0b;font-weight:800;font-size:0.55rem;margin-bottom:6px;">SENTIMENT: '+sentiment+'</div>';
                
                if (CvolState.varActiveSeries.indexOf('upVar') >= 0) 
                    ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#3db87a">UP VAR</span><span class="tooltip-val">' + fmt(row.upVar) + '%</span></div>';
                if (CvolState.varActiveSeries.indexOf('dnVar') >= 0)
                    ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#ef4444">DN VAR</span><span class="tooltip-val">' + fmt(row.dnVar) + '%</span></div>';
                if (CvolState.varActiveSeries.indexOf('skewRatio') >= 0)
                    ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#f59e0b">SKEW RATIO</span><span class="tooltip-val">' + fmt(row.skewRatio, 3) + '</span></div>';
                
                tip.innerHTML = ttHtml;
                tip.style.display = 'block';
                tip.style.left = (x + pad.left > W / 2 ? x - 150 : x + 15) + 'px';
                tip.style.top = '10px';
            }
        }
    }
}

// ── Expanded Composite Modal Chart ────────────────────────────
function renderModalChart(compKey) {
    var canvas = document.getElementById('comp-modal-canvas');
    if (!canvas || !CvolState.data || !CvolState.composites) return;
    var meta = COMP_META[compKey]; if (!meta) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    var c = CvolState.composites;
    var fullValues = c[compKey] || [];
    var fullUnderlying = CvolState.data.map(function(r) { return r.underlying; });
    var fullDates = CvolState.data.map(function(r) { return r.date; });
    
    // Slice according to slider range
    var sIdx = CvolState.modalRange && CvolState.modalRange.s != null ? CvolState.modalRange.s : 0;
    var eIdx = CvolState.modalRange && CvolState.modalRange.e != null ? CvolState.modalRange.e : fullValues.length - 1;
    
    var values = fullValues.slice(sIdx, eIdx + 1);
    var underlying = fullUnderlying.slice(sIdx, eIdx + 1);
    var dates = fullDates.slice(sIdx, eIdx + 1);
    var n = values.length;
    if (n < 10) return;

    var pad = { top: 20, bottom: 32, left: 55, right: 55 };
    var cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    var getX = function(i) { return pad.left + (i / (n - 1)) * cW; };

    // Value range
    var vMin = Infinity, vMax = -Infinity;
    for (var i = 0; i < n; i++) { if (values[i] != null) { vMin = Math.min(vMin, values[i]); vMax = Math.max(vMax, values[i]); } }
    var vm = (vMax - vMin) * 0.1 || 0.1; vMin -= vm; vMax += vm;
    var getVY = function(v) { return pad.top + cH - ((v - vMin) / (vMax - vMin)) * cH; };

    // Price range
    var pMin = Infinity, pMax = -Infinity;
    for (var i = 0; i < n; i++) { if (underlying[i] != null) { pMin = Math.min(pMin, underlying[i]); pMax = Math.max(pMax, underlying[i]); } }
    var pm = (pMax - pMin) * 0.08 || 0.1; pMin -= pm; pMax += pm;
    var getPY = function(v) { return pad.top + cH - ((v - pMin) / (pMax - pMin)) * cH; };

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 5; g++) {
        var gy = pad.top + (g / 5) * cH;
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + cW, gy); ctx.stroke();
    }

    // Y labels left (signal value)
    ctx.fillStyle = meta.color; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    for (var i = 0; i <= 5; i++) {
        var v = vMin + (1 - i / 5) * (vMax - vMin);
        ctx.fillText(v.toFixed(v >= 10 ? 0 : 2), pad.left - 5, pad.top + (i / 5) * cH + 3);
    }
    // Y labels right (NG price)
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    for (var i = 0; i <= 5; i++) {
        var v = pMin + (1 - i / 5) * (pMax - pMin);
        ctx.fillText('$' + v.toFixed(2), pad.left + cW + 5, pad.top + (i / 5) * cH + 3);
    }

    // Threshold line
    if (meta.threshold != null && meta.threshold >= vMin && meta.threshold <= vMax) {
        var ty = getVY(meta.threshold);
        ctx.beginPath(); ctx.moveTo(pad.left, ty); ctx.lineTo(pad.left + cW, ty);
        ctx.strokeStyle = toRgba(meta.color, 0.4); ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = toRgba(meta.color, 0.5); ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText('THRESHOLD ' + meta.threshold.toFixed(meta.threshold >= 10 ? 0 : 2), pad.left + cW, ty - 4);
    }

    // NG price line (background)
    ctx.beginPath(); var started = false;
    for (var i = 0; i < n; i++) {
        if (underlying[i] == null) continue;
        if (!started) { ctx.moveTo(getX(i), getPY(underlying[i])); started = true; } else ctx.lineTo(getX(i), getPY(underlying[i]));
    }
    ctx.strokeStyle = 'rgba(148,163,184,0.3)'; ctx.lineWidth = 1; ctx.stroke();

    // Signal value line
    ctx.beginPath(); started = false;
    for (var i = 0; i < n; i++) {
        if (values[i] == null) continue;
        if (!started) { ctx.moveTo(getX(i), getVY(values[i])); started = true; } else ctx.lineTo(getX(i), getVY(values[i]));
    }
    ctx.strokeStyle = meta.color; ctx.lineWidth = 2; ctx.stroke();

    // Signal fire markers
    var events = (c.events || []).filter(function(ev) {
        var k = ev.signal.replace('↓','Down').replace('↑','Up').replace('CVC','cvc').replace('SAD','sad').replace('CI','ci').replace('RDS','rds');
        return k.toLowerCase().indexOf(compKey.toLowerCase()) >= 0;
    });
    events.forEach(function(ev) {
        if (ev.idx < sIdx || ev.idx > eIdx) return;
        var localIdx = ev.idx - sIdx;
        if (values[localIdx] == null) return;
        var r = ev.fwd21;
        var isDown = ev.direction.indexOf('TOP')>=0||ev.direction.indexOf('DOWNSIDE')>=0;
        var color = meta.color;
        if (r != null) {
            color = ((isDown && r < 0) || (!isDown && r > 0)) ? '#3db87a' : '#ef4444';
        } else {
            color = 'var(--text-muted)';
        }
        var x = getX(localIdx), y = getVY(values[localIdx]);
        ctx.beginPath(); ctx.arc(x, y, (r!=null?4:3), 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        if (r != null) { ctx.lineWidth=1; ctx.strokeStyle='#000'; ctx.stroke(); }
    });

    drawXAxis(ctx, dates, getX, cW, H - 5, pad);

    // Hover state
    var idx = CvolState.modalHoverIdx; // Global index
    var tt = document.getElementById('comp-modal-tooltip');
    
    // Check if hovered global index is within our current zoomed range
    if (idx != null && idx >= sIdx && idx <= eIdx && dates[idx - sIdx] && tt && CvolState.modalCompKey === compKey) {
        var localIdx = idx - sIdx;
        var event = events.find(function(e) { return e.idx === idx; });
        var hx = getX(localIdx);
        
        ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + cH);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        
        var v = values[localIdx], p = underlying[localIdx];
        if (v != null) { ctx.beginPath(); ctx.arc(hx, getVY(v), 5, 0, Math.PI*2); ctx.fillStyle=meta.color; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='#fff'; ctx.stroke(); }
        if (p != null) { ctx.beginPath(); ctx.arc(hx, getPY(p), 4, 0, Math.PI*2); ctx.fillStyle='#94a3b8'; ctx.fill(); ctx.lineWidth=1; ctx.strokeStyle='#fff'; ctx.stroke(); }

        var html = '<div style="font-weight:800;margin-bottom:6px;border-bottom:1px solid var(--border-primary);padding-bottom:4px;color:var(--text-muted);">'+fmtDate(dates[localIdx])+'</div>';
        if (p != null) html += '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:2px;"><span style="color:#94a3b8;">NG Price</span><span style="font-weight:700;">$'+p.toFixed(2)+'</span></div>';
        if (v != null) html += '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;"><span style="color:'+meta.color+';">'+meta.label.split('—')[0].trim()+'</span><span style="font-weight:700;color:'+meta.color+';">'+v.toFixed(3)+'</span></div>';
        if (event) {
            html += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-primary);">';
            html += '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:2px;"><span style="color:var(--text-dim);">Confluence</span><span style="font-weight:700;">'+(getGlobalConfluence(event)||0)+' signals</span></div>';
            html += '<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--text-dim);">21D Return</span><span style="font-weight:700;color:'+pctColor(event.fwd21)+';">'+(event.fwd21!=null?pctFmt(event.fwd21):'PENDING')+'</span></div>';
            html += '</div>';
        }
        
        tt.innerHTML = html;
        tt.style.display = 'block';
        tt.style.left = (Math.min(hx + 15, W - 160)) + 'px';
        tt.style.top = Math.max(20, (v != null ? getVY(v) : pad.top) - 20) + 'px';
    }
}
