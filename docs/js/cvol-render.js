/* ============================================================
   CVOL Rendering Engine — Part 2
   Sparklines with axes/hover, Variance Decomposition, Modal chart
   ============================================================ */

// ── Visible Range Helper ──────────────────────────────────────
function getVisibleRange() {
    var data = CvolState.data;
    if (!data || !data.length) return { s: 0, e: 0 };
    var n = data.length;
    var hs = CvolState.horizonState;
    if (hs && hs !== 'ALL') {
        var daysMap = {'1W':7,'1M':21,'3M':63,'6M':126,'1Y':252,'3Y':756};
        var days = daysMap[hs];
        if (days != null) return { s: Math.max(0, n - 1 - days), e: n - 1 };
    }
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
        ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        for (var i = 0; i <= 5; i++) {
            var v = leftR.min + (1 - i / 5) * (leftR.max - leftR.min);
            ctx.fillText(v.toFixed(1) + '%', pad.left - 6, pad.top + (i / 5) * chartH + 3);
        }
    }
    // Y-axis right
    if (rightR) {
        ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        for (var i = 0; i <= 5; i++) {
            var v = rightR.min + (1 - i / 5) * (rightR.max - rightR.min);
            ctx.fillText('$' + v.toFixed(2), pad.left + chartW + 6, pad.top + (i / 5) * chartH + 3);
        }
    }

    drawXAxis(ctx, visDates, getX, chartW, H - 8, pad);

    // Draw lines
    function drawLine(key, range, lw) {
        var cfg = SERIES_CFG[key]; ctx.strokeStyle = cfg.color; ctx.lineWidth = lw;
        if (cfg.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath(); var started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i][cfg.key]; if (v == null) continue;
            var x = getX(i), y = getY(v, range);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (cfg.dashed) ctx.setLineDash([]);
    }

    // VRP Spread Fill (between NGVL and Realized when both active)
    if (CvolState.activeSeries.indexOf('ngvl') >= 0 && CvolState.activeSeries.indexOf('realVol') >= 0) {
        for (var i = 1; i < n; i++) {
            var nv = visData[i].ngvl, rv = visData[i].realVol;
            var nv0 = visData[i-1].ngvl, rv0 = visData[i-1].realVol;
            if (nv == null || rv == null || nv0 == null || rv0 == null) continue;
            var x0 = getX(i-1), x1 = getX(i);
            var ny0 = getY(nv0, leftR), ny1 = getY(nv, leftR);
            var ry0 = getY(rv0, leftR), ry1 = getY(rv, leftR);
            ctx.beginPath();
            ctx.moveTo(x0, ny0); ctx.lineTo(x1, ny1);
            ctx.lineTo(x1, ry1); ctx.lineTo(x0, ry0);
            ctx.closePath();
            // Green when implied > realized (market overpricing fear), red when reversed
            ctx.fillStyle = (nv + nv0) / 2 > (rv + rv0) / 2 ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)';
            ctx.fill();
        }
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

    // Surface / raw research markers on NGVL line
    if (CvolState.activeSeries.indexOf('ngvl') >= 0) {
        var markerMode = CvolState.markerMode || 'surface';
        var sigMarkerColors = {'SAD':'#d29922','CI':'#388bfd','CVC\u2193':'#f85149','CVC\u2191':'#3fb950','RDS':'#a371f7'};
        var markerSets = [];
        if (markerMode === 'surface' || markerMode === 'both') markerSets.push({ raw: false, events: comp.surfaceEvents || [] });
        if (markerMode === 'raw' || markerMode === 'both') markerSets.push({ raw: true, events: comp.events || [] });
        markerSets.forEach(function(set) {
            set.events.forEach(function(ev) {
                if (ev.idx < r.s || ev.idx > r.e) return;
                var li = ev.idx - r.s;
                var ngvlVal = visData[li] ? visData[li].ngvl : null;
                if (ngvlVal == null) return;
                var mx = getX(li), my = getY(ngvlVal, leftR);
                var mc = set.raw ? (sigMarkerColors[ev.signal] || '#388bfd') : surfaceStateColor(ev.state);
                ctx.save();
                ctx.translate(mx, my);
                if (set.raw) {
                    ctx.rotate(Math.PI / 4);
                    ctx.fillStyle = mc;
                    ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
                    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(-3.4, -3.4, 6.8, 6.8);
                } else {
                    ctx.beginPath();
                    ctx.arc(0, 0, ev.confidence >= 70 ? 5.5 : 4.5, 0, Math.PI * 2);
                    ctx.fillStyle = toRgba(mc, 0.9);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
                ctx.restore();
            });
        });
    }

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
                html += '<div class="tooltip-regime" style="color:'+reg.color+';font-size:0.55rem;font-weight:800;margin-bottom:4px;letter-spacing:1px;">REGIME: '+reg.label+' ('+fmt(pct252,0)+'th)</div>';
                // Surface state classification for this day
                var surfDay = comp.surfaceDaily ? comp.surfaceDaily[r.s + hi] : null;
                if (surfDay && surfDay.state !== 'NO_EDGE') {
                    var sc = surfaceStateColor(surfDay.state);
                    html += '<div style="margin-bottom:6px;padding:3px 6px;border-radius:3px;background:'+toRgba(sc,0.12)+';border-left:2px solid '+sc+';">' +
                        '<div style="font-size:0.58rem;font-weight:800;color:'+sc+';letter-spacing:0.8px;">'+surfDay.label+'</div>' +
                        '<div style="font-size:0.52rem;color:rgba(255,255,255,0.65);">'+surfDay.confidence+' · '+surfDay.directionalRead+'</div>' +
                        '</div>';
                }
                CvolState.activeSeries.forEach(function(k) {
                    var cfg = SERIES_CFG[k]; var v = row[cfg.key];
                    html += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:' + cfg.color + '">' + cfg.label + '</span><span class="tooltip-val">' + (v != null ? (cfg.unit === '$' ? '$' + v.toFixed(2) : v.toFixed(2) + cfg.unit) : '—') + '</span></div>';
                });
                // VRP context
                var vrpH = comp.vrp ? comp.vrp[r.s + hi] : null;
                var rvH = comp.realVol ? comp.realVol[r.s + hi] : null;
                if (vrpH != null) html += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#58a6ff">VRP</span><span class="tooltip-val">'+(vrpH>0?'+':'')+vrpH.toFixed(1)+'</span></div>';
                // Signal event nearby (±2 sessions)
                var absIdx = r.s + hi;
                var markerMode = CvolState.markerMode || 'surface';
                var nearbySource = markerMode === 'raw'
                    ? (comp.events || [])
                    : markerMode === 'both'
                        ? (comp.surfaceEvents || []).concat(comp.events || [])
                        : (comp.surfaceEvents || []);
                var nearbyEvt = nearbySource.filter(function(ev) { return Math.abs(ev.idx - absIdx) <= 2; });
                if (nearbyEvt.length > 0) {
                    nearbyEvt.forEach(function(ev) {
                        var sigC = {'SAD':'#d29922','CI':'#388bfd','CVC\u2193':'#f85149','CVC\u2191':'#3fb950','RDS':'#a371f7'};
                        var eventColor = ev.state ? surfaceStateColor(ev.state) : (sigC[ev.signal] || 'var(--cyan)');
                        html += '<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.08);font-size:0.6rem;font-weight:800;color:'+eventColor+'">* '+ev.signal+' - '+ev.direction+'</div>';
                        if (ev.state && ev.evidence && ev.evidence.length) html += '<div style="font-size:0.55rem;color:rgba(255, 255, 255, 0.85);">'+ev.evidence.slice(0,2).join(' | ')+'</div>';
                        html += '<div style="font-size:0.55rem;color:rgba(255, 255, 255, 0.85);">NG $'+(ev.underlying!=null?ev.underlying.toFixed(2):'—')+'</div>';
                        var fwdLabel = '21D'; var fwdVal = ev.fwd21;
                        if (ev.fwd5 != null && ev.fwd21 == null) { fwdLabel = '5D'; fwdVal = ev.fwd5; }
                        if (fwdVal != null) {
                            html += '<div style="font-size:0.55rem;color:'+(fwdVal>0?'#3fb950':'#f85149')+'">' + fwdLabel + ': '+(fwdVal>0?'+':'')+fwdVal.toFixed(1)+'%</div>';
                        } else {
                            html += '<div style="font-size:0.55rem;color:rgba(255, 255, 255, 0.85);">PENDING</div>';
                        }
                    });
                }
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
    ctx.fillStyle = '#8b949e'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
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
            ctx.fillStyle = '#8b949e'; ctx.font = '7px sans-serif'; ctx.textAlign = 'left';
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
            var dateStr = '', gIdx = null;
            if (CvolState.data && CvolState.data.length >= 90) {
                gIdx = CvolState.data.length - 90 + idx;
                if (gIdx >= 0 && gIdx < CvolState.data.length) dateStr = fmtDate(CvolState.data[gIdx].date);
                else gIdx = null;
            }
            var statusStr = (canvas._sparkStatus && gIdx != null) ? canvas._sparkStatus(val, gIdx) : '';
            tt.textContent = dateStr + '  ' + val.toFixed(val >= 10 ? 1 : 3) + (statusStr ? '  ' + statusStr : '');
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

    var pad = { top: 16, bottom: 30, left: 55, right: 70 };
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
    var prMin = Infinity, prMax = -Infinity;
    for (var i = 0; i < n; i++) {
        var r = visData[i];
        if (r.upVar != null) { varMin = Math.min(varMin, r.upVar); varMax = Math.max(varMax, r.upVar); }
        if (r.dnVar != null) { varMin = Math.min(varMin, r.dnVar); varMax = Math.max(varMax, r.dnVar); }
        if (r.skewRatio != null) { skMin = Math.min(skMin, r.skewRatio); skMax = Math.max(skMax, r.skewRatio); }
        if (r.underlying != null) { prMin = Math.min(prMin, r.underlying); prMax = Math.max(prMax, r.underlying); }
    }
    var vm = (varMax - varMin) * 0.08 || 1; varMin -= vm; varMax += vm;
    var sm = (skMax - skMin) * 0.08 || 0.1; skMin -= sm; skMax += sm;
    var pm = (prMax - prMin) * 0.08 || 0.1; prMin -= pm; prMax += pm;

    var getVY = function(v) { return pad.top + chartH - ((v - varMin) / (varMax - varMin)) * chartH; };
    var getSY = function(v) { return pad.top + chartH - ((v - skMin) / (skMax - skMin)) * chartH; };
    var getPY = function(v) { return pad.top + chartH - ((v - prMin) / (prMax - prMin)) * chartH; };

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
        var gy = pad.top + (g / 4) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + chartW, gy); ctx.stroke();
    }

    // Y-axis labels left (var %)
    ctx.fillStyle = '#8b949e'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    for (var i = 0; i <= 4; i++) {
        var v = varMin + (1 - i / 4) * (varMax - varMin);
        ctx.fillText(v.toFixed(0) + '%', pad.left - 5, pad.top + (i / 4) * chartH + 3);
    }
    // Y-axis labels right (skew ratio)
    ctx.textAlign = 'left'; ctx.fillStyle = '#d29922';
    for (var i = 0; i <= 4; i++) {
        var v = skMin + (1 - i / 4) * (skMax - skMin);
        ctx.fillText(v.toFixed(2), pad.left + chartW + 5, pad.top + (i / 4) * chartH + 3);
    }
    // Y-axis labels right 2 (price)
    ctx.textAlign = 'left'; ctx.fillStyle = '#8b949e';
    for (var i = 0; i <= 4; i++) {
        var v = prMin + (1 - i / 4) * (prMax - prMin);
        ctx.fillText('$' + v.toFixed(2), pad.left + chartW + 36, pad.top + (i / 4) * chartH + 3);
    }

    // UP VAR area fill
    if (CvolState.varActiveSeries.indexOf('upVar') >= 0) {
        ctx.beginPath(); ctx.moveTo(getX(0), pad.top + chartH);
        for (var i = 0; i < n; i++) {
            var v = visData[i].upVar; if (v == null) continue;
            ctx.lineTo(getX(i), getVY(v));
        }
        ctx.lineTo(getX(n - 1), pad.top + chartH); ctx.closePath();
        ctx.fillStyle = 'rgba(63,185,80,0.08)'; ctx.fill();
    }

    // DN VAR area fill
    if (CvolState.varActiveSeries.indexOf('dnVar') >= 0) {
        ctx.beginPath(); ctx.moveTo(getX(0), pad.top + chartH);
        for (var i = 0; i < n; i++) {
            var v = visData[i].dnVar; if (v == null) continue;
            ctx.lineTo(getX(i), getVY(v));
        }
        ctx.lineTo(getX(n - 1), pad.top + chartH); ctx.closePath();
        ctx.fillStyle = 'rgba(248,81,73,0.08)'; ctx.fill();
    }

    // UP VAR line
    if (CvolState.varActiveSeries.indexOf('upVar') >= 0) {
        ctx.beginPath(); var started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i].upVar; if (v == null) continue;
            if (!started) { ctx.moveTo(getX(i), getVY(v)); started = true; } else ctx.lineTo(getX(i), getVY(v));
        }
        ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 1.3; ctx.stroke();
    }

    // DN VAR line
    if (CvolState.varActiveSeries.indexOf('dnVar') >= 0) {
        ctx.beginPath(); var started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i].dnVar; if (v == null) continue;
            if (!started) { ctx.moveTo(getX(i), getVY(v)); started = true; } else ctx.lineTo(getX(i), getVY(v));
        }
        ctx.strokeStyle = '#f85149'; ctx.lineWidth = 1.3; ctx.stroke();
    }

    // Skew Ratio overlay
    if (CvolState.varActiveSeries.indexOf('skewRatio') >= 0) {
        ctx.beginPath(); var started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i].skewRatio; if (v == null) continue;
            if (!started) { ctx.moveTo(getX(i), getSY(v)); started = true; } else ctx.lineTo(getX(i), getSY(v));
        }
        ctx.strokeStyle = '#d29922'; ctx.lineWidth = 1.8; ctx.stroke();
    }

    // NG Price overlay
    if (CvolState.varActiveSeries.indexOf('underlying') >= 0) {
        ctx.beginPath(); var started = false;
        for (var i = 0; i < n; i++) {
            var v = visData[i].underlying; if (v == null) continue;
            if (!started) { ctx.moveTo(getX(i), getPY(v)); started = true; } else ctx.lineTo(getX(i), getPY(v));
        }
        ctx.strokeStyle = '#fb8f44'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Skew Momentum (5D ROC) overlay
    if (CvolState.varActiveSeries.indexOf('skewRoc5') >= 0) {
        var smMin = Infinity, smMax = -Infinity;
        for (var i = 0; i < n; i++) { var v = visData[i].skewRoc5; if (v != null) { smMin = Math.min(smMin, v); smMax = Math.max(smMax, v); } }
        if (isFinite(smMin)) {
            var sm = (smMax - smMin) * 0.1 || 0.1; smMin -= sm; smMax += sm;
            var getSMY = function(v) { return pad.top + chartH - ((v - smMin) / (smMax - smMin)) * chartH; };
            // Zero reference line
            if (0 >= smMin && 0 <= smMax) {
                var zy = getSMY(0);
                ctx.beginPath(); ctx.moveTo(pad.left, zy); ctx.lineTo(pad.left + chartW, zy);
                ctx.strokeStyle = 'rgba(88,166,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
            }
            // Line
            ctx.beginPath(); var started = false;
            for (var i = 0; i < n; i++) { var v = visData[i].skewRoc5; if (v == null) continue; if (!started) { ctx.moveTo(getX(i), getSMY(v)); started = true; } else ctx.lineTo(getX(i), getSMY(v)); }
            ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.3; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
    }

    // Variance Spread overlay (UpVar - DnVar, net directional imbalance)
    if (CvolState.varActiveSeries.indexOf('varSpread') >= 0 && CvolState.composites && CvolState.composites.varSpread) {
        var vsArr = CvolState.composites.varSpread;
        var vsMin = Infinity, vsMax = -Infinity;
        for (var i = 0; i < n; i++) { var v = vsArr[range.s + i]; if (v != null) { vsMin = Math.min(vsMin, v); vsMax = Math.max(vsMax, v); } }
        if (isFinite(vsMin)) {
            var vsm = (vsMax - vsMin) * 0.1 || 0.1; vsMin -= vsm; vsMax += vsm;
            var getVSY = function(v) { return pad.top + chartH - ((v - vsMin) / (vsMax - vsMin)) * chartH; };
            if (0 >= vsMin && 0 <= vsMax) {
                var zy = getVSY(0);
                ctx.beginPath(); ctx.moveTo(pad.left, zy); ctx.lineTo(pad.left + chartW, zy);
                ctx.strokeStyle = 'rgba(35,178,178,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
            }
            ctx.beginPath(); var started = false;
            for (var i = 0; i < n; i++) { var v = vsArr[range.s + i]; if (v == null) continue; if (!started) { ctx.moveTo(getX(i), getVSY(v)); started = true; } else ctx.lineTo(getX(i), getVSY(v)); }
            ctx.strokeStyle = '#23b2b2'; ctx.lineWidth = 1.3; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
    }

    // Wing Divergence overlay
    if (CvolState.varActiveSeries.indexOf('wingDiv') >= 0 && CvolState.composites && CvolState.composites.wingDiv) {
        var wdArr = CvolState.composites.wingDiv;
        var wdMin = 0, wdMax = -Infinity;
        for (var i = 0; i < n; i++) { var v = wdArr[range.s + i]; if (v != null) { wdMax = Math.max(wdMax, v); } }
        if (isFinite(wdMax) && wdMax > 0) {
            var wdm = wdMax * 0.1 || 0.1; wdMax += wdm;
            var getWDY = function(v) { return pad.top + chartH - ((v - wdMin) / (wdMax - wdMin)) * chartH; };
            ctx.beginPath(); var started = false;
            for (var i = 0; i < n; i++) { var v = wdArr[range.s + i]; if (v == null) continue; if (!started) { ctx.moveTo(getX(i), getWDY(v)); started = true; } else ctx.lineTo(getX(i), getWDY(v)); }
            ctx.strokeStyle = '#388bfd'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
    }

    // Regime Tension heat strip (4px bar at chart bottom)
    if (CvolState.varActiveSeries.indexOf('regimeTension') >= 0 && CvolState.composites && CvolState.composites.regimeTensionPct) {
        var rtPct = CvolState.composites.regimeTensionPct;
        var stripH = 4, stripY = pad.top + chartH - stripH;
        for (var i = 0; i < n; i++) {
            var pv = rtPct[range.s + i];
            if (pv == null) continue;
            var x0 = getX(i), x1 = i < n - 1 ? getX(i + 1) : x0 + chartW / n;
            var hue = pv < 50 ? 142 - pv * 1.88 : pv < 85 ? 48 - (pv - 50) * 0.66 : 25 - (pv - 85) * 1.67;
            var sat = Math.min(100, 40 + pv * 0.6);
            var lum = pv >= 90 ? 55 : pv >= 75 ? 50 : 40;
            var alpha = 0.15 + (pv / 100) * 0.55;
            ctx.fillStyle = 'hsla(' + hue + ',' + sat + '%,' + lum + '%,' + alpha + ')';
            ctx.fillRect(x0, stripY, Math.max(1, x1 - x0), stripH);
        }
    }

    // Skew = 1.0 reference line
    if (1.0 >= skMin && 1.0 <= skMax) {
        var refY = getSY(1.0);
        ctx.beginPath(); ctx.moveTo(pad.left, refY); ctx.lineTo(pad.left + chartW, refY);
        ctx.strokeStyle = 'rgba(210,153,34,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    // X-axis
    drawXAxis(ctx, visDates, getX, chartW, H - 5, pad);

    // Inline legend
    ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    var lx = pad.left + 8;
    if (CvolState.varActiveSeries.indexOf('upVar') >= 0) {
        ctx.fillStyle = '#3fb950'; ctx.fillText('▬ UP VAR', lx, pad.top + 12); lx += 65;
    }
    if (CvolState.varActiveSeries.indexOf('dnVar') >= 0) {
        ctx.fillStyle = '#f85149'; ctx.fillText('▬ DN VAR', lx, pad.top + 12); lx += 65;
    }
    if (CvolState.varActiveSeries.indexOf('skewRatio') >= 0) {
        ctx.fillStyle = '#d29922'; ctx.fillText('▬ SKEW', lx, pad.top + 12); lx += 55;
    }
    if (CvolState.varActiveSeries.indexOf('underlying') >= 0) {
        ctx.fillStyle = '#fb8f44'; ctx.fillText('▬ PRICE', lx, pad.top + 12); lx += 55;
    }
    if (CvolState.varActiveSeries.indexOf('skewRoc5') >= 0) {
        ctx.fillStyle = '#58a6ff'; ctx.fillText('╌ SKEW MOM', lx, pad.top + 12); lx += 80;
    }
    if (CvolState.varActiveSeries.indexOf('varSpread') >= 0) {
        ctx.fillStyle = '#23b2b2'; ctx.fillText('╌ VAR SPREAD', lx, pad.top + 12); lx += 85;
    }
    if (CvolState.varActiveSeries.indexOf('wingDiv') >= 0) {
        ctx.fillStyle = '#388bfd'; ctx.fillText('╌ WING DIV', lx, pad.top + 12); lx += 75;
    }
    if (CvolState.varActiveSeries.indexOf('regimeTension') >= 0) {
        ctx.fillStyle = '#a371f7'; ctx.fillText('■ TENSION', lx, pad.top + 12); lx += 70;
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
                var gi = range.s + hi;
                var comp = CvolState.composites || {};
                var skZ21 = comp.skewRatioZ21 ? comp.skewRatioZ21[gi] : null;
                var sentiment, sentimentColor;
                if (skZ21 != null) {
                    if (skZ21 > 1.5)       { sentiment = 'STRONG UPSIDE PRESSURE';   sentimentColor = '#3fb950'; }
                    else if (skZ21 > 0.75) { sentiment = 'UPSIDE SKEW BUILDING';     sentimentColor = '#3fb950'; }
                    else if (skZ21 < -1.5) { sentiment = 'STRONG DOWNSIDE PRESSURE'; sentimentColor = '#f85149'; }
                    else if (skZ21 < -0.75){ sentiment = 'DOWNSIDE SKEW BUILDING';   sentimentColor = '#f85149'; }
                    else                   { sentiment = 'NEUTRAL';                   sentimentColor = '#d29922'; }
                } else { sentiment = 'NEUTRAL'; sentimentColor = '#d29922'; }

                var ttHtml = '<div style="color:var(--cyan);font-weight:800;font-size:0.6rem;letter-spacing:1.5px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:3px;">' + fmtDate(row.date) + '</div>';
                ttHtml += '<div style="color:' + sentimentColor + ';font-weight:800;font-size:0.55rem;margin-bottom:3px;">' + sentiment + '</div>';
                if (skZ21 != null) ttHtml += '<div style="color:rgba(255,255,255,0.6);font-size:0.5rem;margin-bottom:5px;font-family:\'JetBrains Mono\',monospace;">Z21: ' + (skZ21 >= 0 ? '+' : '') + skZ21.toFixed(2) + '\u03c3 vs 21D rolling avg</div>';

                if (CvolState.varActiveSeries.indexOf('upVar') >= 0)
                    ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#3fb950">UP VAR</span><span class="tooltip-val">' + fmt(row.upVar) + '%</span></div>';
                if (CvolState.varActiveSeries.indexOf('dnVar') >= 0)
                    ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#f85149">DN VAR</span><span class="tooltip-val">' + fmt(row.dnVar) + '%</span></div>';
                if (CvolState.varActiveSeries.indexOf('skewRatio') >= 0)
                    ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#d29922">SKEW RATIO</span><span class="tooltip-val">' + fmt(row.skewRatio, 3) + '</span></div>';
                if (CvolState.varActiveSeries.indexOf('underlying') >= 0)
                    ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#fb8f44">NG PRICE</span><span class="tooltip-val">$' + fmt(row.underlying, 2) + '</span></div>';

                // ── Advanced Diagnostics Section ──
                var vsVal = comp.varSpread ? comp.varSpread[gi] : null;
                var vsZ = comp.varSpreadZ21 ? comp.varSpreadZ21[gi] : null;
                var saVal = comp.skewAccel ? comp.skewAccel[gi] : null;
                var wdVal = comp.wingDiv ? comp.wingDiv[gi] : null;
                var rtPct = comp.regimeTensionPct ? comp.regimeTensionPct[gi] : null;
                var psCorr = comp.priceSkewCorr ? comp.priceSkewCorr[gi] : null;
                var vrpVal = comp.vrp ? comp.vrp[gi] : null;
                var svVal = comp.surfaceVelocity ? comp.surfaceVelocity[gi] : null;

                var showVs = vsVal != null && CvolState.varActiveSeries.indexOf('varSpread') >= 0;
                var showWd = wdVal != null && CvolState.varActiveSeries.indexOf('wingDiv') >= 0;
                var showRt = rtPct != null && CvolState.varActiveSeries.indexOf('regimeTension') >= 0;
                var showSa = saVal != null && CvolState.varActiveSeries.indexOf('skewRoc5') >= 0;
                var showPs = psCorr != null && (CvolState.varActiveSeries.indexOf('skewRatio') >= 0 || CvolState.varActiveSeries.indexOf('underlying') >= 0);
                var showVrp = vrpVal != null && svVal != null && vrpVal < -5 && skZ21 != null && Math.abs(skZ21) > 0.75;

                var hasAdvanced = showVs || showSa || showWd || showRt || showPs || showVrp;
                if (hasAdvanced) {
                    ttHtml += '<div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.08);font-size:0.45rem;letter-spacing:1.5px;color:rgba(255,255,255,0.4);font-weight:700;margin-bottom:3px;">ADVANCED DIAGNOSTICS</div>';

                    if (showVs) {
                        var vsColor = vsVal > 0 ? '#3fb950' : vsVal < 0 ? '#f85149' : '#8b949e';
                        var vsLabel = vsVal > 0 ? 'CALLS RICHER' : vsVal < 0 ? 'PUTS RICHER' : 'BALANCED';
                        var zBadge = vsZ != null ? ' <span style="color:rgba(255,255,255,0.5);font-size:0.45rem;">Z:' + (vsZ >= 0 ? '+' : '') + vsZ.toFixed(1) + '</span>' : '';
                        ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#23b2b2">VAR SPREAD</span><span class="tooltip-val" style="color:' + vsColor + '">' + (vsVal >= 0 ? '+' : '') + fmt(vsVal) + '%' + zBadge + '</span></div>';
                    }
                    if (showSa) {
                        var saArrow = saVal > 0.005 ? ' \u2191' : saVal < -0.005 ? ' \u2193' : ' \u2194';
                        var saColor = saVal > 0.005 ? '#3fb950' : saVal < -0.005 ? '#f85149' : '#8b949e';
                        ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#58a6ff">SKEW ACCEL</span><span class="tooltip-val" style="color:' + saColor + '">' + (saVal >= 0 ? '+' : '') + (saVal * 1000).toFixed(1) + 'bp' + saArrow + '</span></div>';
                    }
                    if (showWd) {
                        var wdColor = wdVal >= 2.0 ? '#fb8f44' : wdVal >= 1.0 ? '#d29922' : '#8b949e';
                        var wdLabel = wdVal >= 2.0 ? 'HIGH' : wdVal >= 1.0 ? 'MODERATE' : 'LOW';
                        ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#388bfd">WING DIV</span><span class="tooltip-val" style="color:' + wdColor + '">' + fmt(wdVal, 2) + '\u03c3 \u00b7 ' + wdLabel + '</span></div>';
                    }
                    if (showRt) {
                        var rtColor = rtPct >= 90 ? '#f85149' : rtPct >= 75 ? '#d29922' : rtPct >= 50 ? '#d29922' : '#388bfd';
                        var rtLabel = rtPct >= 90 ? 'CRITICAL' : rtPct >= 75 ? 'ELEVATED' : rtPct >= 50 ? 'MODERATE' : 'LOW';
                        ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:#a371f7">TENSION</span><span class="tooltip-val" style="color:' + rtColor + '">' + fmt(rtPct, 0) + 'th \u00b7 ' + rtLabel + '</span></div>';
                    }
                    if (showPs) {
                        var syncColor = Math.abs(psCorr) < 0.3 ? '#d29922' : '#3fb950';
                        var syncLabel = Math.abs(psCorr) < 0.3 ? 'DISLOCATED \u26a0' : 'IN SYNC \u2713';
                        ttHtml += '<div class="tooltip-row"><span class="tooltip-lbl" style="color:rgba(255,255,255,0.5)">PRICE-SKEW</span><span class="tooltip-val" style="color:' + syncColor + '">' + syncLabel + ' (r=' + psCorr.toFixed(2) + ')</span></div>';
                    }
                    if (showVrp) {
                        ttHtml += '<div style="margin-top:3px;padding:2px 4px;border-radius:2px;background:rgba(163,113,247,0.15);border:1px solid rgba(163,113,247,0.2);font-size:0.48rem;font-weight:800;color:#a371f7;letter-spacing:1px;text-align:center;">VRP-SKEW CROSS \u2605</div>';
                    }
                }

                tip.innerHTML = ttHtml;
                tip.style.display = 'block';
                tip.style.left = (x + pad.left > W / 2 ? x - 170 : x + 15) + 'px';
                tip.style.top = '10px';
            }
        }
    }

    // ── Inflection Radar Strip ──
    renderInflectionRadar(range);
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
    if (n < 2) return;

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
    ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
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
    ctx.strokeStyle = 'rgba(139,148,158,0.3)'; ctx.lineWidth = 1; ctx.stroke();

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
            color = ((isDown && r < 0) || (!isDown && r > 0)) ? '#3fb950' : '#f85149';
        } else {
            color = 'rgba(255, 255, 255, 0.85)';
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
        if (p != null) { ctx.beginPath(); ctx.arc(hx, getPY(p), 4, 0, Math.PI*2); ctx.fillStyle='#fb8f44'; ctx.fill(); ctx.lineWidth=1; ctx.strokeStyle='#fff'; ctx.stroke(); }

        var html = '<div style="font-weight:800;margin-bottom:6px;border-bottom:1px solid var(--border-primary);padding-bottom:4px;color:rgba(255, 255, 255, 0.85);">'+fmtDate(dates[localIdx])+'</div>';
        if (p != null) html += '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:2px;"><span style="color:#fb8f44;">NG Price</span><span style="font-weight:700;">$'+p.toFixed(2)+'</span></div>';
        if (v != null) html += '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;"><span style="color:'+meta.color+';">'+meta.label.split('—')[0].trim()+'</span><span style="font-weight:700;color:'+meta.color+';">'+v.toFixed(3)+'</span></div>';
        if (event) {
            html += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-primary);">';
            html += '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:2px;"><span style="color:rgba(255, 255, 255, 0.85);">Confluence</span><span style="font-weight:700;">'+(getGlobalConfluence(event)||0)+' signals</span></div>';
            var _isDown = event.direction.indexOf('TOP')>=0||event.direction.indexOf('DOWNSIDE')>=0;
            var _adjRet = event.fwd21 != null ? event.fwd21 * (_isDown ? -1 : 1) : null;
            html += '<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:rgba(255, 255, 255, 0.85);">21D Return</span><span style="font-weight:700;color:'+pctColor(_adjRet)+';">'+(_adjRet!=null?fmtSign(_adjRet):'PENDING')+'</span></div>';
            html += '</div>';
        }
        
        tt.innerHTML = html;
        tt.style.display = 'block';
        tt.style.left = (Math.min(hx + 15, W - 160)) + 'px';
        tt.style.top = Math.max(20, (v != null ? getVY(v) : pad.top) - 20) + 'px';
    }
}

// ── Inflection Radar Strip ────────────────────────────────────
function renderInflectionRadar(range) {
    var el = document.getElementById('var-inflection-radar');
    if (!el || !CvolState.composites || !CvolState.data) return;
    var comp = CvolState.composites;
    var gi = range ? range.e : CvolState.data.length - 1;
    if (gi < 0) return;

    var skZ = comp.skewRatioZ21 ? comp.skewRatioZ21[gi] : null;
    var vsZ = comp.varSpreadZ21 ? comp.varSpreadZ21[gi] : null;
    var vs = comp.varSpread ? comp.varSpread[gi] : null;
    var sa = comp.skewAccel ? comp.skewAccel[gi] : null;
    var rtP = comp.regimeTensionPct ? comp.regimeTensionPct[gi] : null;
    var psc = comp.priceSkewCorr ? comp.priceSkewCorr[gi] : null;

    function cell(label, value, color, bg, tooltip) {
        return '<div data-tooltip="' + tooltip + '" style="flex:1;text-align:center;padding:6px 4px;background:' + bg + ';border-radius:4px;min-width:0;cursor:help;">' +
            '<div style="font-size:0.45rem;letter-spacing:1.2px;color:rgba(255,255,255,0.45);font-weight:700;margin-bottom:2px;">' + label + '</div>' +
            '<div style="font-size:0.6rem;font-weight:800;color:' + color + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + value + '</div></div>';
    }

    var cells = '';

    // 1) Skew Regime
    var skLabel = '--', skColor = '#8b949e';
    if (skZ != null) {
        if (skZ > 1.5)       { skLabel = 'STRONG \u2191'; skColor = '#3fb950'; }
        else if (skZ > 0.75) { skLabel = 'BUILDING \u2191'; skColor = '#3fb950'; }
        else if (skZ < -1.5) { skLabel = 'STRONG \u2193'; skColor = '#f85149'; }
        else if (skZ < -0.75){ skLabel = 'BUILDING \u2193'; skColor = '#f85149'; }
        else                 { skLabel = 'NEUTRAL'; skColor = '#d29922'; }
    }
    cells += cell('SKEW REGIME', skLabel, skColor, 'rgba(255,255,255,0.03)', 'Directional intensity of the ATM Skew ratio vs its 21D average');

    // 2) Wing Bias
    var wbLabel = '--', wbColor = '#8b949e';
    if (vs != null && vsZ != null) {
        if (vsZ > 1.0)       { wbLabel = 'CALLS RICH'; wbColor = '#3fb950'; }
        else if (vsZ > 0.5) { wbLabel = 'CALL LEAN'; wbColor = '#3fb950'; }
        else if (vsZ < -1.0){ wbLabel = 'PUTS RICH'; wbColor = '#f85149'; }
        else if (vsZ < -0.5){ wbLabel = 'PUT LEAN'; wbColor = '#f85149'; }
        else                { wbLabel = 'BALANCED'; wbColor = '#d29922'; }
    }
    cells += cell('WING BIAS', wbLabel, wbColor, 'rgba(255,255,255,0.02)', 'Net variance spread indicating whether Calls or Puts command a premium in the tails');

    // 3) Momentum (Skew Acceleration)
    var moLabel = '--', moColor = '#8b949e';
    if (sa != null) {
        if (sa > 0.01)       { moLabel = 'ACCEL \u2191'; moColor = '#3fb950'; }
        else if (sa > 0.003) { moLabel = 'BUILDING \u2191'; moColor = '#3fb950'; }
        else if (sa < -0.01) { moLabel = 'ACCEL \u2193'; moColor = '#f85149'; }
        else if (sa < -0.003){ moLabel = 'BUILDING \u2193'; moColor = '#f85149'; }
        else                 { moLabel = 'FLAT'; moColor = '#8b949e'; }
    }
    cells += cell('MOMENTUM', moLabel, moColor, 'rgba(255,255,255,0.03)', 'Acceleration (2nd derivative) of the Skew trend to catch early inflections');

    // 4) Tension
    var tnLabel = '--', tnColor = '#8b949e', tnBg = 'rgba(255,255,255,0.02)';
    if (rtP != null) {
        if (rtP >= 90)      { tnLabel = 'CRITICAL'; tnColor = '#f85149'; tnBg = 'rgba(248,81,73,0.08)'; }
        else if (rtP >= 75) { tnLabel = 'ELEVATED'; tnColor = '#d29922'; tnBg = 'rgba(210,153,34,0.06)'; }
        else if (rtP >= 50) { tnLabel = 'MODERATE'; tnColor = '#d29922'; tnBg = 'rgba(255,255,255,0.02)'; }
        else                { tnLabel = 'LOW'; tnColor = '#388bfd'; }
    }
    cells += cell('TENSION', tnLabel, tnColor, tnBg, 'Composite measure of volatility structure stress (Spread \u00d7 Convexity \u00d7 Skew Accel)');

    // 5) Price-Skew Sync
    var psLabel = '--', psColor = '#8b949e';
    if (psc != null) {
        if (Math.abs(psc) < 0.2)     { psLabel = 'DISLOCATED'; psColor = '#d29922'; }
        else if (Math.abs(psc) < 0.4){ psLabel = 'DECOUPLING'; psColor = '#d29922'; }
        else                         { psLabel = 'IN SYNC'; psColor = '#3fb950'; }
    }
    cells += cell('PRICE-SKEW', psLabel, psColor, 'rgba(255,255,255,0.02)', '10D rolling correlation between price and skew. Decoupling signals structural shifts');

    el.innerHTML = cells;
}
