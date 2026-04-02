/* ============================================================
   CVOL UI Builders + Initialization — Part 3
   ============================================================ */

// ── Status Banner ─────────────────────────────────────────────
function renderBanner() {
    const el = document.getElementById('cvol-status-banner');
    if (!el || !CvolState.data) return;
    const data = CvolState.data;
    const last = data[data.length - 1];
    const c = CvolState.composites;
    const idx = data.length - 1;

    const ngvlPct = c.ngvlPct252 ? c.ngvlPct252[idx] : null;
    const reg = ngvlRegime(ngvlPct);
    const skZsc = c.skewRatioZ21 ? c.skewRatioZ21[idx] : null;
    const roc5 = c.skewRatioRoc5 ? c.skewRatioRoc5[idx] : null;
    const ciVal = c.ci ? c.ci[idx] : null;

    var badges = '';
    if (ciVal != null && ciVal > 82) badges += '<span class="flash-badge flash-ci">COMPLACENCY HIGH</span>';
    if (c.rdsZ && c.rdsZ[idx] > 1.8) badges += '<span class="flash-badge flash-rds">RDS ACTIVE</span>';
    if (c.sadZ && c.sadZ[idx] != null && Math.abs(c.sadZ[idx]) > 1.5)
        badges += '<span class="flash-badge flash-sad">SAD DIVERGING</span>';

    el.innerHTML =
        '<div class="sb-item"><span class="sb-lbl" data-tooltip="CME 30-day forward implied volatility for Natural Gas.">NGVL</span>' +
        '<span class="sb-val" style="color:' + reg.color + '">' + fmt(last.ngvl) + '%</span>' +
        '<span class="sb-sub">' + fmtPct(ngvlPct) + ' · <span style="color:' + reg.color + '">' + reg.label + '</span></span></div>' +
        '<div class="sb-item"><span class="sb-lbl" data-tooltip="UpVar/DnVar ratio. >1.0 = market pricing more upside risk.">SKEW RATIO</span>' +
        '<span class="sb-val" style="color:#f59e0b">' + fmt(last.skewRatio, 3) + '</span>' +
        '<span class="sb-sub">Z: ' + fmt(skZsc) + ' · ' + (roc5 != null ? (roc5 >= 0 ? '▲' : '▼') : '—') + '</span></div>' +
        '<div class="sb-item"><span class="sb-lbl" data-tooltip="CVOL/ATM ratio. Measures tail-risk premium.">CONVEXITY</span>' +
        '<span class="sb-val" style="color:#ec4899">' + fmt(last.convexity, 4) + '</span>' +
        '<span class="sb-sub">' + (last.convexity > 1.10 ? '<span style="color:#ec4899">ELEVATED</span>' : 'NORMAL') + '</span></div>' +
        '<div class="sb-item"><span class="sb-lbl" data-tooltip="NG front-month futures settlement.">NG PRICE</span>' +
        '<span class="sb-val" style="color:#94a3b8">$' + fmt(last.underlying, 3) + '</span>' +
        '<span class="sb-sub">' + fmtDate(last.date) + '</span></div>' +
        '<div class="sb-badges">' + (badges || '<span style="color:var(--text-dim);font-size:0.6rem;letter-spacing:1px;">NO ACTIVE SIGNALS</span>') + '</div>';
}

// ── KPI Cards ─────────────────────────────────────────────────
function renderKPICards() {
    var el = document.getElementById('cvol-kpi-grid');
    if (!el || !CvolState.data) return;
    var data = CvolState.data, last = data[data.length - 1], idx = data.length - 1, c = CvolState.composites;
    var reg = ngvlRegime(c.ngvlPct252 ? c.ngvlPct252[idx] : null);
    var ngvlD = idx > 0 ? last.ngvl - data[idx - 1].ngvl : 0;
    var roc5 = c.skewRatioRoc5 ? c.skewRatioRoc5[idx] : 0;
    var ciVal = c.ci ? c.ci[idx] : null;

    el.innerHTML =
    '<div class="cvol-kpi-card">' +
        '<div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#00e5ff">NGVL</span><span class="cvol-kpi-regime" style="color:' + reg.color + '">' + reg.label + '</span></div>' +
        '<div class="cvol-kpi-main"><span class="cvol-kpi-lbl">CURRENT</span><span class="cvol-kpi-val" style="color:#00e5ff">' + fmt(last.ngvl) + '%</span></div>' +
        '<div class="cvol-kpi-stats">' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">21D PCT</span><span class="cvol-kpi-sval">' + fmtPct(c.ngvlPct21 ? c.ngvlPct21[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">63D PCT</span><span class="cvol-kpi-sval">' + fmtPct(c.ngvlPct63 ? c.ngvlPct63[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">252D PCT</span><span class="cvol-kpi-sval">' + fmtPct(c.ngvlPct252 ? c.ngvlPct252[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">&Delta; 1D</span><span class="cvol-kpi-sval" style="color:' + (ngvlD >= 0 ? '#3db87a' : '#ef4444') + '">' + (ngvlD >= 0 ? '+' : '') + fmt(ngvlD) + '</span></div>' +
        '</div>' +
    '</div>' +
    '<div class="cvol-kpi-card">' +
        '<div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#f59e0b">SKEW RATIO</span><span class="cvol-kpi-regime" style="color:' + (roc5 >= 0 ? '#3db87a' : '#ef4444') + '">' + (roc5 >= 0 ? '▲ RISING' : '▼ FALLING') + '</span></div>' +
        '<div class="cvol-kpi-main"><span class="cvol-kpi-lbl">CURRENT</span><span class="cvol-kpi-val" style="color:#f59e0b">' + fmt(last.skewRatio, 3) + '</span></div>' +
        '<div class="cvol-kpi-stats">' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">63D PCT</span><span class="cvol-kpi-sval">' + fmtPct(c.skewRatioPct63 ? c.skewRatioPct63[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">Z-SCORE</span><span class="cvol-kpi-sval">' + fmt(c.skewRatioZ21 ? c.skewRatioZ21[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">5D ROC</span><span class="cvol-kpi-sval">' + fmt(roc5, 3) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">RAW SKEW</span><span class="cvol-kpi-sval">' + fmt(last.skew) + ' pts</span></div>' +
        '</div>' +
    '</div>' +
    '<div class="cvol-kpi-card">' +
        '<div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#ec4899">CONVEXITY</span><span class="cvol-kpi-regime">' + (last.convexity > 1.10 ? '<span style="color:#ec4899">ELEVATED</span>' : '<span style="color:#3db87a">NORMAL</span>') + '</span></div>' +
        '<div class="cvol-kpi-main"><span class="cvol-kpi-lbl">CVOL / ATM</span><span class="cvol-kpi-val" style="color:#ec4899">' + fmt(last.convexity, 4) + '</span></div>' +
        '<div class="cvol-kpi-stats">' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">63D PCT</span><span class="cvol-kpi-sval">' + fmtPct(c.convPct63 ? c.convPct63[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">ATM VOL</span><span class="cvol-kpi-sval">' + fmt(last.atm) + '%</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">UP VAR</span><span class="cvol-kpi-sval">' + fmt(last.upVar) + '%</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">DN VAR</span><span class="cvol-kpi-sval">' + fmt(last.dnVar) + '%</span></div>' +
        '</div>' +
    '</div>' +
    '<div class="cvol-kpi-card">' +
        '<div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#60a8f8">COMPLACENCY</span><span class="cvol-kpi-regime">' + (ciVal > 82 ? '<span style="color:#f59e0b">&#9888; HIGH</span>' : ciVal > 60 ? '<span style="color:#94a3b8">ELEVATED</span>' : '<span style="color:#3db87a">NORMAL</span>') + '</span></div>' +
        '<div class="cvol-kpi-main"><span class="cvol-kpi-lbl">INDEX (0&ndash;100)</span><span class="cvol-kpi-val" style="color:' + (ciVal > 82 ? '#f59e0b' : ciVal > 60 ? '#94a3b8' : '#3db87a') + '">' + fmt(ciVal, 0) + '</span></div>' +
        '<div class="cvol-kpi-stats">' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">ATM PCT</span><span class="cvol-kpi-sval">' + fmtPct(c.atmPct252 ? c.atmPct252[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">ATM Z</span><span class="cvol-kpi-sval">' + fmt(c.atmZ21 ? c.atmZ21[idx] : null) + '</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">ATM MED90</span><span class="cvol-kpi-sval">' + fmt(c.atmMed90 ? c.atmMed90[idx] : null) + '%</span></div>' +
            '<div class="cvol-kpi-stat"><span class="cvol-kpi-slbl">NG PRICE</span><span class="cvol-kpi-sval">$' + fmt(last.underlying, 2) + '</span></div>' +
        '</div>' +
    '</div>';
}

// ── Composite Signal Dashboard ────────────────────────────────
function renderComposites() {
    var c = CvolState.composites;
    if (!c.sad) return;
    renderSparkline('spark-sad', c.sad, '#f59e0b', 0);
    renderSparkline('spark-ci', c.ci, '#60a8f8', 82);
    renderSparkline('spark-cvc-down', c.cvcDown, '#ef4444', 1.2);
    renderSparkline('spark-cvc-up', c.cvcUp, '#3db87a', 1.2);
    renderSparkline('spark-rds', c.rds, '#ec4899', null);
    var idx = CvolState.data.length - 1;
    var setV = function(id, val, dec) {
        var e = document.getElementById(id);
        if (e) e.textContent = fmt(val, dec || 2);
    };
    setV('sad-current', c.sad[idx], 3);
    setV('sad-zscore', c.sadZ ? c.sadZ[idx] : null, 2);
    setV('ci-current', c.ci[idx], 0);
    setV('cvc-down-current', c.cvcDown[idx], 2);
    setV('cvc-up-current', c.cvcUp[idx], 2);
    setV('rds-current', c.rds[idx], 4);
    setV('rds-zscore', c.rdsZ ? c.rdsZ[idx] : null, 2);
}

// ── Signal Event Timeline ─────────────────────────────────────
function renderTimeline() {
    var tbody = document.getElementById('cvol-event-body');
    if (!tbody) return;
    var events = CvolState.composites.events || [];
    var filtered = events;
    if (CvolState.signalFilter === 'year') {
        var y = new Date().getFullYear();
        filtered = events.filter(function(ev) { return ev.date.startsWith(String(y)); });
    } else if (CvolState.signalFilter === '6m') {
        var cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6);
        var cs = cutoff.toISOString().slice(0, 10);
        filtered = events.filter(function(ev) { return ev.date >= cs; });
    }
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:20px;">No signal events in this range</td></tr>';
        return;
    }
    var sorted = filtered.slice().reverse();
    tbody.innerHTML = sorted.map(function(ev) {
        var s = SEASON_CFG[ev.season] || SEASON_CFG.fall;
        var isTop = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
        var dirColor = isTop ? '#ef4444' : '#3db87a';
        return '<tr>' +
            '<td style="color:var(--cyan);font-weight:800;white-space:nowrap;">' + fmtDate(ev.date) + '</td>' +
            '<td><span class="sig-badge" style="border-color:' + dirColor + ';color:' + dirColor + '">' + ev.signal + '</span></td>' +
            '<td style="color:' + dirColor + ';font-weight:700;">' + ev.direction + '</td>' +
            '<td>' + fmt(ev.value, 3) + '</td>' +
            '<td style="color:var(--text-dim)">$' + fmt(ev.underlying, 2) + '</td>' +
            '<td style="color:' + (ev.fwd5 != null ? (ev.fwd5 >= 0 ? '#3db87a' : '#ef4444') : 'var(--text-dim)') + '">' + fmtSign(ev.fwd5) + '</td>' +
            '<td style="color:' + (ev.fwd21 != null ? (ev.fwd21 >= 0 ? '#3db87a' : '#ef4444') : 'var(--text-dim)') + '">' + fmtSign(ev.fwd21) + '</td>' +
            '<td style="color:' + s.color + '">' + s.emoji + ' ' + ev.season.toUpperCase() + '</td>' +
        '</tr>';
    }).join('');
    var cnt = document.getElementById('cvol-event-count');
    if (cnt) cnt.textContent = filtered.length + ' EVENT' + (filtered.length !== 1 ? 'S' : '');
}

// ── Series Toggle Chips ───────────────────────────────────────
function renderSeriesChips() {
    var wrap = document.getElementById('cvol-series-chips');
    if (!wrap) return;
    var html = '';
    Object.keys(SERIES_CFG).forEach(function(k) {
        var cfg = SERIES_CFG[k];
        var active = CvolState.activeSeries.indexOf(k) >= 0;
        html += '<button class="etf-chip ' + (active ? 'active' : 'inactive') + '" style="border-color:' + cfg.color + ';' + (active ? 'background:' + toRgba(cfg.color, 0.15) + ';color:' + cfg.color : '') + '" data-series="' + k + '">' + cfg.label + '</button>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.etf-chip').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var k = btn.dataset.series;
            var idx = CvolState.activeSeries.indexOf(k);
            if (idx >= 0) CvolState.activeSeries.splice(idx, 1);
            else CvolState.activeSeries.push(k);
            renderSeriesChips();
            renderMainChart();
        });
    });
}

// ── Horizon Buttons ───────────────────────────────────────────
function applyHorizon(range) {
    CvolState.horizonState = range;
    var data = CvolState.data;
    if (!data || !data.length) return;
    var n = data.length;
    if (range === 'ALL') {
        CvolState.rangeState = { start: 0, end: 100 };
    } else {
        var now = new Date(data[n - 1].date);
        var map = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '3Y': 1095 };
        var days = map[range] || n;
        var cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days);
        var cs = cutoff.toISOString().slice(0, 10);
        var startIdx = 0;
        for (var i = 0; i < n; i++) { if (data[i].date >= cs) { startIdx = i; break; } }
        CvolState.rangeState = { start: (startIdx / (n - 1)) * 100, end: 100 };
    }
    var rs = document.getElementById('cvol-range-start');
    var re = document.getElementById('cvol-range-end');
    if (rs) rs.value = CvolState.rangeState.start;
    if (re) re.value = CvolState.rangeState.end;
    updateRangeHighlight();
    document.querySelectorAll('#cvol-horizon-controls .horizon-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.range === range);
    });
    renderMainChart();
    updateRangeLabel();
}

function updateRangeHighlight() {
    var hl = document.getElementById('cvol-range-highlight');
    if (!hl) return;
    hl.style.left = CvolState.rangeState.start + '%';
    hl.style.width = (CvolState.rangeState.end - CvolState.rangeState.start) + '%';
}

function updateRangeLabel() {
    var lbl = document.getElementById('cvol-range-label');
    if (!lbl || !CvolState.data) return;
    var r = getVisibleRange(), d = CvolState.data;
    if (r.s === 0 && r.e === d.length - 1) lbl.textContent = 'ALL DATA';
    else lbl.textContent = fmtDate(d[r.s].date) + ' — ' + fmtDate(d[r.e].date);
}

// ── Full Render ───────────────────────────────────────────────
function renderAll() {
    renderBanner(); renderKPICards(); renderMainChart(); renderComposites(); renderTimeline(); updateRangeLabel();
}

// ── Canvas Hover ──────────────────────────────────────────────
function setupCanvasHover() {
    var canvas = document.getElementById('cvol-canvas');
    if (!canvas) return;
    canvas.addEventListener('mousemove', function(ev) {
        var rect = canvas.getBoundingClientRect();
        var x = ev.clientX - rect.left;
        var padL = 60, padR = 70, chartW = rect.width - padL - padR;
        var r = getVisibleRange(), n = r.e - r.s + 1;
        if (n < 2) return;
        var frac = (x - padL) / chartW;
        var idx = Math.round(frac * (n - 1)) + r.s;
        if (idx >= r.s && idx <= r.e) { CvolState.hoverState = idx; renderMainChart(); }
    });
    canvas.addEventListener('mouseleave', function() {
        CvolState.hoverState = null;
        var tooltip = document.getElementById('cvol-tooltip');
        if (tooltip) tooltip.style.display = 'none';
        renderMainChart();
    });
}

// ── Initialization ────────────────────────────────────────────
async function initCvol() {
    try {
        var resp = await fetch('data/cvol/ngvl_cvol_history.csv?t=' + Math.floor(Date.now() / 60000));
        if (!resp.ok) throw new Error('CSV fetch failed: ' + resp.status);
        var text = await resp.text();
        CvolState.data = parseCvolCsv(text);
        if (!CvolState.data.length) {
            document.getElementById('cvol-loading').textContent = 'No CVOL data available.';
            return;
        }
        CvolState.dates = CvolState.data.map(function(r) { return r.date; });
        CvolState.composites = computeComposites(CvolState.data);

        var loading = document.getElementById('cvol-loading');
        if (loading) loading.style.display = 'none';
        var dash = document.getElementById('cvol-dashboard');
        if (dash) dash.style.display = 'block';

        renderSeriesChips();
        renderAll();
        setupCanvasHover();

        document.querySelectorAll('#cvol-horizon-controls .horizon-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { applyHorizon(btn.dataset.range); });
        });

        ['cvol-range-start', 'cvol-range-end'].forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function() {
                var s = parseFloat(document.getElementById('cvol-range-start').value);
                var e = parseFloat(document.getElementById('cvol-range-end').value);
                if (s > e - 1) { if (id.indexOf('start') >= 0) s = e - 1; else e = s + 1; }
                CvolState.rangeState = { start: Math.max(0, s), end: Math.min(100, e) };
                updateRangeHighlight(); renderMainChart(); updateRangeLabel();
            });
        });

        document.querySelectorAll('#cvol-event-filter .tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('#cvol-event-filter .tab-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                CvolState.signalFilter = btn.dataset.filter;
                renderTimeline();
            });
        });

        var resizeTimer;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(renderAll, 100);
        });

        console.log('CVOL Engine: ' + CvolState.data.length + ' rows loaded, ' + CvolState.composites.events.length + ' signal events detected.');
    } catch (err) {
        console.error('CVOL init error:', err);
        var ldg = document.getElementById('cvol-loading');
        if (ldg) ldg.textContent = 'Error loading CVOL data: ' + err.message;
    }
}

document.addEventListener('DOMContentLoaded', initCvol);
