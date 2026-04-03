/* ============================================================
   CVOL UI Builder — Part 3
   KPI cards, banners, heatmap, correlation, scorecard, init
   ============================================================ */
// Note: MONTHS, fmtDate, fmt, getSeason are already declared in cvol.js
function pctColor(v){return v>0?'#3db87a':v<0?'#ef4444':'var(--text-primary)';}
function uiGetSeason(d){var m=parseInt(d.split('-')[1]);if(m>=11||m<=2)return{n:'WINTER',e:'❄',c:'#60a8f8'};if(m<=5)return{n:'SPRING',e:'🌱',c:'#3db87a'};if(m<=8)return{n:'SUMMER',e:'☀',c:'#f59e0b'};return{n:'FALL',e:'🍂',c:'#c07828'};}

// ── Status Banner ─────────────────────────────────────────────
function renderBanner(data, comp) {
    var el = document.getElementById('cvol-status-banner'); if (!el) return;
    var last = data[data.length - 1];
    var ngvlReg = comp.ngvlPct252 ? ngvlRegime(comp.ngvlPct252[data.length - 1]) : {label:'—',color:'#888'};
    var skDir = ''; if (data.length > 5) { var prev = data[data.length - 6].skewRatio; skDir = last.skewRatio > prev ? '▲ RISING' : '▼ FALLING'; }
    var convLabel = last.convexity > 1.1 ? 'ELEVATED' : last.convexity > 0.95 ? 'NORMAL' : 'LOW';
    var convColor = last.convexity > 1.1 ? '#f59e0b' : last.convexity > 0.95 ? '#3db87a' : '#60a8f8';
    var badges = '';
    var ci = comp.ci ? comp.ci[data.length - 1] : null;
    if (ci != null && ci > 82) badges += '<span class="flash-badge flash-ci" data-tooltip="Complacency Index at '+ci.toFixed(0)+' — ATM vol is cheap relative to history. Historically fragile calm.">COMPLACENCY HIGH</span>';
    var sad = comp.sad ? comp.sad[data.length - 1] : null;
    var sadZ = comp.sadZ ? comp.sadZ[data.length - 1] : null;
    if (sadZ != null && Math.abs(sadZ) > 1.5) badges += '<span class="flash-badge flash-sad" data-tooltip="SAD Z-score at '+sadZ.toFixed(2)+' — skew is diverging from ATM vol, stealth repositioning detected.">SKEW DIVERGENCE</span>';
    var rdsZ = comp.rdsZ ? comp.rdsZ[data.length - 1] : null;
    if (rdsZ != null && rdsZ > 1.8) badges += '<span class="flash-badge flash-rds" data-tooltip="RDS Z-score at '+rdsZ.toFixed(2)+' — regime trifecta (skew shift + convexity + low ATM) active.">REGIME SHIFT</span>';
    el.innerHTML =
        '<div class="sb-item" data-tooltip="CME NGVL: 30-day forward implied volatility for Natural Gas. Composite of ATM + OTM options across the vol surface."><div class="sb-lbl">NGVL</div><div class="sb-val" style="color:'+ngvlReg.color+'">'+fmt(last.ngvl)+'%</div><div class="sb-sub">'+fmt(comp.ngvlPct252?comp.ngvlPct252[data.length-1]:null,0)+'th · '+ngvlReg.label+'</div></div>' +
        '<div class="sb-item" data-tooltip="Skew Ratio: UpVar/DnVar. >1 = market pricing more upside tail risk (calls expensive). <1 = downside fear dominant (puts expensive). Direction shows 5-day trend."><div class="sb-lbl">SKEW RATIO</div><div class="sb-val">'+fmt(last.skewRatio,3)+'</div><div class="sb-sub" style="color:'+(skDir.indexOf('RISING')>=0?'#3db87a':'#ef4444')+'">Z: '+fmt(comp.skewRatioZ21?comp.skewRatioZ21[data.length-1]:null)+ ' · '+skDir+'</div></div>' +
        '<div class="sb-item" data-tooltip="Convexity: CVOL/ATM ratio. Measures OTM option pricing premium. >1.10 = fat tails actively bought. <0.95 = OTM selling dominant."><div class="sb-lbl">CONVEXITY</div><div class="sb-val" style="color:'+convColor+'">'+fmt(last.convexity,4)+'</div><div class="sb-sub" style="color:'+convColor+'">'+convLabel+'</div></div>' +
        '<div class="sb-item" data-tooltip="Front-month NG futures settlement price on the latest data date."><div class="sb-lbl">NG PRICE</div><div class="sb-val">$'+fmt(last.underlying,3)+'</div><div class="sb-sub">'+fmtDate(last.date)+'</div></div>' +
        '<div class="sb-badges">'+badges+'</div>';
}

// ── KPI Cards (expanded) ─────────────────────────────────────
function renderKpiCards(data, comp) {
    var el = document.getElementById('cvol-kpi-grid'); if (!el) return;
    var last = data[data.length - 1]; var n = data.length;
    var ngvlReg = comp.ngvlPct252 ? ngvlRegime(comp.ngvlPct252[n-1]) : {label:'—',color:'#888'};
    var p21 = comp.ngvlPct21 ? comp.ngvlPct21[n-1] : null;
    var p63 = comp.ngvlPct63 ? comp.ngvlPct63[n-1] : null;
    var p252 = comp.ngvlPct252 ? comp.ngvlPct252[n-1] : null;
    var d1 = n > 1 ? (last.ngvl - data[n-2].ngvl) : null;
    var roc5 = n > 5 ? (last.ngvl / data[n-6].ngvl - 1) * 100 : null;
    var med90 = comp.atmMed90 ? comp.atmMed90[n-1] : null;
    
    // Shared formatting helpers
    var skDir = ''; if (data.length > 5) { var prev = data[data.length - 6].skewRatio; skDir = last.skewRatio > prev ? '▲ RISING' : '▼ FALLING'; }
    var convLabel = last.convexity > 1.1 ? 'ELEVATED' : last.convexity > 0.95 ? 'NORMAL' : 'LOW';
    var convColor = last.convexity > 1.1 ? '#f59e0b' : last.convexity > 0.95 ? '#3db87a' : '#60a8f8';
    
    // 252-day high/low distance for NGVL
    var ngvlHi = -Infinity, ngvlLo = Infinity;
    var lookback = Math.min(252, n);
    for (var i = n - lookback; i < n; i++) { if (data[i].ngvl != null) { ngvlHi = Math.max(ngvlHi, data[i].ngvl); ngvlLo = Math.min(ngvlLo, data[i].ngvl); } }
    var distHi = isFinite(ngvlHi) ? ((last.ngvl / ngvlHi - 1) * 100) : null;
    var distLo = isFinite(ngvlLo) ? ((last.ngvl / ngvlLo - 1) * 100) : null;
    // Skew correlation with NG (63d)
    var skCorr = null;
    if (n > 63) {
        var skArr = data.slice(-63).map(function(r){return r.skewRatio;});
        var prArr = data.slice(-63).map(function(r){return r.underlying;});
        skCorr = computeCorrelation(skArr, prArr);
    }
    // Days since CI > 82
    var daysSinceCI = null;
    if (comp.ci) { for (var i = n - 1; i >= 0; i--) { if (comp.ci[i] != null && comp.ci[i] > 82) { daysSinceCI = n - 1 - i; break; } } }
    // Convexity Z-score (21d)
    var convZ = null; if (n > 21) { var s = data.slice(-21).map(function(r){return r.convexity;}).filter(function(v){return v!=null;}); if (s.length > 5) { var m = s.reduce(function(a,b){return a+b;},0)/s.length; var sd = Math.sqrt(s.reduce(function(a,b){return a+(b-m)*(b-m);},0)/s.length); convZ = sd > 0 ? (last.convexity - m) / sd : 0; } }
    // CVC status
    var cvcDown = comp.cvcDown ? comp.cvcDown[n-1] : null;
    var cvcUp = comp.cvcUp ? comp.cvcUp[n-1] : null;
    var cvcStatus = (cvcDown != null && cvcDown > 1.2) ? '<span style="color:#ef4444">CVC↓ ACTIVE</span>' : (cvcUp != null && cvcUp > 1.2) ? '<span style="color:#3db87a">CVC↑ ACTIVE</span>' : '<span style="color:var(--text-dim)">NEUTRAL</span>';
    // SAD status
    var sadActive = (comp.sadZ && comp.sadZ[n-1] != null && Math.abs(comp.sadZ[n-1]) > 1.5);
    var ci = comp.ci ? comp.ci[n-1] : null;
    // ATM 5d direction
    var atm5dir = n > 5 ? (last.atm > data[n-6].atm ? '▲ RISING' : '▼ FALLING') : '';
    // NGVL pct position
    var ngvlPctPos = p252 != null ? p252 : 50;

    el.innerHTML =
    // NGVL Card
    '<div class="cvol-kpi-card" style="--card-accent:'+ngvlReg.color+'"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:'+ngvlReg.color+'" data-tooltip="CVOL Index (NGVL) — CME\'s composite forward implied volatility for Natural Gas. Derived from the full options surface.">NGVL</span><span class="cvol-kpi-regime" style="color:'+ngvlReg.color+'" data-tooltip="Regime based on 252-day rolling percentile: Low ≤25th, Normal 25-75th, Elevated ≥75th, Extreme ≥90th.">'+ngvlReg.label+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="Current NGVL reading as a percentage of annualized implied volatility."><div class="cvol-kpi-lbl">CURRENT</div><div class="cvol-kpi-val" style="color:'+ngvlReg.color+'">'+fmt(last.ngvl)+'%</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="21-day rolling percentile rank of current NGVL — where vol sits vs. the last month."><div class="cvol-kpi-slbl">21D PCT</div><div class="cvol-kpi-sval">'+fmt(p21,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="63-day rolling percentile rank — seasonal-quarter context."><div class="cvol-kpi-slbl">63D PCT</div><div class="cvol-kpi-sval">'+fmt(p63,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="252-day (1-year) rolling percentile rank — full annual context."><div class="cvol-kpi-slbl">252D PCT</div><div class="cvol-kpi-sval">'+fmt(p252,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Day-over-day change in NGVL."><div class="cvol-kpi-slbl">Δ 1D</div><div class="cvol-kpi-sval" style="color:'+pctColor(d1)+'">'+((d1!=null&&d1>0)?'+':'')+fmt(d1)+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="5-day rate of change — momentum indicator for vol expansion/contraction."><span class="cvol-micro-lbl">5D ROC</span><span class="cvol-micro-val" style="color:'+pctColor(roc5)+'">'+((roc5!=null&&roc5>0)?'+':'')+fmt(roc5)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Distance from 252-day high — how far below the annual vol ceiling. Near 0% = approaching extreme."><span class="cvol-micro-lbl">↓ 252D HIGH</span><span class="cvol-micro-val" style="color:'+(distHi!=null&&distHi>-10?'#ef4444':'var(--text-bright)')+'">'+fmt(distHi)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Distance from 252-day low — how far above the annual vol floor. Near 0% = approaching suppressed."><span class="cvol-micro-lbl">↑ 252D LOW</span><span class="cvol-micro-val" style="color:'+(distLo!=null&&distLo<10?'#3db87a':'var(--text-bright)')+'">+'+fmt(distLo)+'%</span></div>' +
    '</div>' +
    '<div class="kpi-progress" data-tooltip="Regime gauge: 0% = 252-day low, 100% = 252-day high."><div class="kpi-progress-fill" style="width:'+ngvlPctPos+'%;background:'+ngvlReg.color+'"></div></div></div>' +

    // SKEW RATIO Card
    '<div class="cvol-kpi-card" style="--card-accent:#f59e0b"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#f59e0b" data-tooltip="Skew Ratio = UpVar / DnVar. Measures directional bias in the options surface. >1 = upside skew (call premium). <1 = downside skew (put premium).">SKEW RATIO</span><span class="cvol-kpi-regime" style="color:'+(last.skewRatio>1?'#3db87a':'#ef4444')+'" data-tooltip="Direction based on 5-day trend.">'+skDir+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="Current skew ratio value."><div class="cvol-kpi-lbl">CURRENT</div><div class="cvol-kpi-val">'+fmt(last.skewRatio,3)+'</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="63-day percentile of skew ratio."><div class="cvol-kpi-slbl">63D PCT</div><div class="cvol-kpi-sval">'+fmt(comp.skewRatioPct63?comp.skewRatioPct63[n-1]:null,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Z-score of skew ratio vs. 21-day rolling mean/std."><div class="cvol-kpi-slbl">Z-SCORE</div><div class="cvol-kpi-sval">'+fmt(comp.skewRatioZ21?comp.skewRatioZ21[n-1]:null)+'σ</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Raw skew value (NGSK) — absolute volatility difference between up and down variance."><div class="cvol-kpi-slbl">RAW SKEW</div><div class="cvol-kpi-sval">'+fmt(last.skew)+' pts</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="5-day rate of change of skew ratio."><div class="cvol-kpi-slbl">5D ROC</div><div class="cvol-kpi-sval">'+fmt(comp.skewRatioRoc5?comp.skewRatioRoc5[n-1]:null,3)+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="Up Variance (NGUP) — call-side implied vol."><span class="cvol-micro-lbl">UP VAR</span><span class="cvol-micro-val" style="color:#3db87a">'+fmt(last.upVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Down Variance (NGDN) — put-side implied vol."><span class="cvol-micro-lbl">DN VAR</span><span class="cvol-micro-val" style="color:#ef4444">'+fmt(last.dnVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="SAD status — is skew currently diverging from ATM vol?"><span class="cvol-micro-lbl">SAD</span><span class="cvol-micro-val">'+(sadActive?'<span style="color:#8b5cf6">ACTIVE</span>':'<span style="color:var(--text-dim)">NEUTRAL</span>')+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="63-day rolling correlation between Skew Ratio and NG price. Divergence = signal."><span class="cvol-micro-lbl">NG CORR</span><span class="cvol-micro-val">'+fmt(skCorr,2)+'</span></div>' +
    '</div></div>' +

    // CONVEXITY Card
    '<div class="cvol-kpi-card" style="--card-accent:#ec4899"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#ec4899" data-tooltip="Convexity = CVOL / ATM. Measures the premium on OTM options relative to ATM. High convexity = market buying tail risk protection.">CONVEXITY</span><span class="cvol-kpi-regime" style="color:'+convColor+'" data-tooltip="ELEVATED (>1.10): OTM actively bought. NORMAL (0.95-1.10): typical. LOW (<0.95): OTM being sold.">'+convLabel+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="CVOL / ATM ratio. Values above 1.0 = OTM options more expensive than ATM."><div class="cvol-kpi-lbl">CVOL / ATM</div><div class="cvol-kpi-val" style="color:'+convColor+'">'+fmt(last.convexity,4)+'</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="63-day percentile rank of convexity."><div class="cvol-kpi-slbl">63D PCT</div><div class="cvol-kpi-sval">'+fmt(comp.convPct63?comp.convPct63[n-1]:null,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="ATM implied vol — the at-the-money baseline volatility."><div class="cvol-kpi-slbl">ATM VOL</div><div class="cvol-kpi-sval">'+fmt(last.atm)+'%</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="21-day Z-score of convexity — how unusual current convexity is vs. recent history."><div class="cvol-kpi-slbl">CONV Z</div><div class="cvol-kpi-sval">'+fmt(convZ)+'σ</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="CVC signal status — whether the convexity-variance confirmation signal is currently active."><div class="cvol-kpi-slbl">CVC</div><div class="cvol-kpi-sval">'+cvcStatus+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="Up Variance (NGUP) — call-side implied vol. High = market expects upside."><span class="cvol-micro-lbl">UP VAR</span><span class="cvol-micro-val" style="color:#3db87a">'+fmt(last.upVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Down Variance (NGDN) — put-side implied vol. High = market expects downside."><span class="cvol-micro-lbl">DN VAR</span><span class="cvol-micro-val" style="color:#ef4444">'+fmt(last.dnVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Variance spread: UpVar − DnVar. Positive = market expects more upside than downside."><span class="cvol-micro-lbl">VAR SPREAD</span><span class="cvol-micro-val" style="color:'+pctColor(last.upVar - last.dnVar)+'">'+((last.upVar-last.dnVar>0)?'+':'')+fmt(last.upVar - last.dnVar)+'%</span></div>' +
    '</div></div>' +

    // COMPLACENCY Card
    '<div class="cvol-kpi-card" style="--card-accent:#60a8f8"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#60a8f8" data-tooltip="Complacency Index: 100 − ATM_252d_percentile. Measures how cheap implied vol is relative to history. Higher = more complacent = more fragile.">COMPLACENCY</span><span class="cvol-kpi-regime" style="color:'+(ci>82?'#f59e0b':ci>60?'#60a8f8':'#3db87a')+'" data-tooltip="HIGH (>82): fragile calm. MODERATE (60-82): normal. LOW (<60): vol appropriately elevated.">'+(ci>82?'▲ HIGH':ci>60?'MODERATE':'LOW')+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="CI value from 0 (max vol, zero complacency) to 100 (vol at all-time lows, max complacency)."><div class="cvol-kpi-lbl">INDEX (0-100)</div><div class="cvol-kpi-val" style="color:'+(ci>82?'#f59e0b':'#60a8f8')+'">'+fmt(ci,0)+'</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="ATM vol\'s percentile rank over 252 trading days."><div class="cvol-kpi-slbl">ATM PCT</div><div class="cvol-kpi-sval">'+fmt(comp.atmPct252?comp.atmPct252[n-1]:null,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Z-score of ATM vol — negative = vol cheap, positive = vol rich."><div class="cvol-kpi-slbl">ATM Z</div><div class="cvol-kpi-sval">'+fmt(comp.atmZ21?comp.atmZ21[n-1]:null)+'σ</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="90-day median ATM vol — structural baseline."><div class="cvol-kpi-slbl">ATM MED90</div><div class="cvol-kpi-sval">'+fmt(med90)+'%</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Current NG settlement price."><div class="cvol-kpi-slbl">NG PRICE</div><div class="cvol-kpi-sval">$'+fmt(last.underlying,2)+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="Trading days since CI last exceeded the 82 threshold."><span class="cvol-micro-lbl">DAYS >82</span><span class="cvol-micro-val">'+(daysSinceCI!=null?daysSinceCI+'D':'—')+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="ATM vol direction over the last 5 trading days."><span class="cvol-micro-lbl">ATM 5D</span><span class="cvol-micro-val" style="color:'+(atm5dir.indexOf('RISING')>=0?'#ef4444':'#3db87a')+'">'+atm5dir+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="CVOL signals are most powerful when confirmed by the Trough-to-Peak cycle position. A CVC↓ TOP SIGNAL at >85% of T2P cycle avg = maximum conviction short. Check the Trough-to-Peak tab for current cycle position."><span class="cvol-micro-lbl">T2P CROSS-REF</span><span class="cvol-micro-val" style="color:var(--text-dim);font-size:0.55rem;">SEE T2P TAB →</span></div>' +
    '</div></div>';
}


// ── Composite Stats Footer ────────────────────────────────────
function renderCompStats(compKey, values, events) {
    var el = document.getElementById(compKey + '-stats'); if (!el) return;
    var valid = values.filter(function(v){return v!=null;});
    var last90 = valid.slice(-90);
    var count252 = 0;
    if (events) { var cutoff252 = CvolState.data.length - 252; events.forEach(function(ev){ var k=ev.signal.replace('↓','Down').replace('↑','Up').replace('CVC','cvc').replace('SAD','sad').replace('CI','ci').replace('RDS','rds'); if(k.toLowerCase().indexOf(compKey.toLowerCase())>=0 && ev.idx>=cutoff252) count252++; }); }
    var d21 = valid.length > 21 ? valid[valid.length-1] - valid[valid.length-22] : null;
    el.innerHTML =
        '<div class="comp-stat" data-tooltip="21-day change in this composite value.">Δ21D<span class="comp-stat-val" style="color:'+pctColor(d21)+'">'+((d21!=null&&d21>0)?'+':'')+fmt(d21,3)+'</span></div>' +
        '<div class="comp-stat" data-tooltip="Number of signal fires in the last 252 trading days.">252D FIRES<span class="comp-stat-val">'+count252+'</span></div>' +
        '<div class="comp-stat" data-tooltip="90-day median of this composite value.">90D MED<span class="comp-stat-val">'+fmt(last90.length?last90.sort(function(a,b){return a-b;})[Math.floor(last90.length/2)]:null,3)+'</span></div>';
}

// ── Regime Heatmap ────────────────────────────────────────────
function renderHeatmap(data) {
    var el = document.getElementById('cvol-heatmap'); if (!el) return;
    var hm = computeHeatmapData(data);
    var years = []; var keys = Object.keys(hm).sort();
    keys.forEach(function(k){ var y = k.split('-')[0]; if (years.indexOf(y) < 0) years.push(y); });
    var monthLabels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    var html = '<div class="heatmap-grid" style="grid-template-columns:50px repeat(12, 1fr);">';
    html += '<div></div>';
    for (var m = 0; m < 12; m++) html += '<div class="heatmap-label">'+monthLabels[m]+'</div>';
    years.forEach(function(y) {
        html += '<div class="heatmap-year-label">'+y+'</div>';
        for (var m = 1; m <= 12; m++) {
            var key = y + '-' + (m < 10 ? '0' : '') + m;
            var cell = hm[key];
            if (!cell) { html += '<div class="heatmap-cell" style="background:rgba(255,255,255,0.02);color:var(--text-dim);">—</div>'; }
            else {
                var bg = cell.regime.color;
                html += '<div class="heatmap-cell" style="background:'+toRgba(bg,0.2)+';color:'+bg+';" data-tooltip="'+MONTHS[m-1]+' '+y+': NGVL='+cell.avgNgvl.toFixed(1)+'% ('+cell.regime.label+') | NG=$'+cell.avgUnderlying.toFixed(2)+(cell.avgSkewRatio!=null?' | Skew='+cell.avgSkewRatio.toFixed(2):'')+'">'+cell.avgNgvl.toFixed(0)+'</div>';
            }
        }
    });
    html += '</div>';
    el.innerHTML = html;
}

// ── Correlation Matrix ────────────────────────────────────────
function renderCorrMatrix(data) {
    var el = document.getElementById('cvol-corr-matrix'); if (!el) return;
    var matrix = computeCorrMatrix(data);
    var n = CORR_LABELS.length;
    var html = '<div class="corr-grid" style="grid-template-columns:55px repeat('+n+', 1fr);">';
    html += '<div></div>';
    for (var j = 0; j < n; j++) html += '<div class="corr-header" style="font-size:0.45rem;">'+CORR_LABELS[j]+'</div>';
    for (var i = 0; i < n; i++) {
        html += '<div class="corr-header" style="font-size:0.45rem;justify-content:flex-end;padding-right:4px;">'+CORR_LABELS[i]+'</div>';
        for (var j = 0; j < n; j++) {
            var r = matrix[i][j];
            var bg, fg;
            if (r == null) { bg = 'rgba(255,255,255,0.02)'; fg = 'var(--text-dim)'; }
            else if (i === j) { bg = 'rgba(255,255,255,0.05)'; fg = 'var(--text-bright)'; }
            else if (r > 0.7) { bg = 'rgba(61,184,122,'+((r-0.5)*0.5)+')'; fg = '#fff'; }
            else if (r > 0.3) { bg = 'rgba(61,184,122,0.08)'; fg = '#3db87a'; }
            else if (r < -0.3) { bg = 'rgba(239,68,68,'+((Math.abs(r)-0.2)*0.4)+')'; fg = '#ef4444'; }
            else { bg = 'rgba(255,255,255,0.02)'; fg = 'var(--text-muted)'; }
            var interp = r == null ? 'Insufficient data' : r > 0.7 ? 'Strong positive — move together' : r > 0.3 ? 'Moderate positive' : r < -0.3 ? 'Negative — divergent' : 'Weak / no correlation';
            html += '<div class="corr-cell" style="background:'+bg+';color:'+fg+';" data-tooltip="'+CORR_LABELS[i]+' vs '+CORR_LABELS[j]+': r = '+(r!=null?r.toFixed(3):'—')+' — '+interp+'">'+(r!=null?r.toFixed(2):'—')+'</div>';
        }
    }
    html += '</div>';
    el.innerHTML = html;
}

// ── Backtest Scorecard ────────────────────────────────────────
function renderScorecard(composites) {
    var el = document.getElementById('cvol-scorecard'); if (!el) return;
    var rows = computeScorecard(composites);
    if (!rows.length) { el.innerHTML = '<div style="color:var(--text-dim);text-align:center;">No signal data</div>'; return; }
    var sigColors = {'SAD':'#f59e0b','CI':'#60a8f8','CVC↓':'#ef4444','CVC↑':'#3db87a','RDS':'#ec4899'};
    var html = '<table class="scorecard-table"><thead><tr>' +
        '<th data-tooltip="Which composite signal.">SIGNAL</th>' +
        '<th data-tooltip="Total number of times this signal fired across full history.">COUNT</th>' +
        '<th data-tooltip="Hit rate at 5 trading days — % of signals where NG moved in the predicted direction.">HIT 5D</th>' +
        '<th data-tooltip="Hit rate at 21 trading days (1 month) — the primary validation window.">HIT 21D</th>' +
        '<th data-tooltip="Average NG price change 5 days after signal.">AVG 5D</th>' +
        '<th data-tooltip="Average NG price change 21 days after signal.">AVG 21D</th>' +
        '<th data-tooltip="Best single 21-day forward return after this signal.">BEST 21D</th>' +
        '<th data-tooltip="Worst single 21-day forward return after this signal.">WORST 21D</th>' +
        '<th data-tooltip="Signal Sharpe: avg_return / std_return over 21d. Higher = more consistent edge.">SHARPE</th>' +
        '</tr></thead><tbody>';
    rows.forEach(function(r) {
        var sc = sigColors[r.signal] || 'var(--text-primary)';
        var hr21 = r.hitRate21; var hrColor = hr21 != null ? (hr21 > 55 ? '#3db87a' : hr21 < 45 ? '#ef4444' : 'var(--text-primary)') : 'var(--text-dim)';
        var barW = hr21 != null ? Math.min(100, hr21) : 0;
        html += '<tr>' +
            '<td style="color:'+sc+';font-weight:800;">'+r.signal+'</td>' +
            '<td>'+r.count+'</td>' +
            '<td style="color:'+(r.hitRate5!=null?(r.hitRate5>55?'#3db87a':'#ef4444'):'var(--text-dim)')+'">'+fmt(r.hitRate5,0)+'%</td>' +
            '<td style="color:'+hrColor+'">'+fmt(r.hitRate21,0)+'%<span class="score-bar" style="width:'+barW+'px;background:'+hrColor+';"></span></td>' +
            '<td style="color:'+pctColor(r.avgRet5)+'">'+((r.avgRet5!=null&&r.avgRet5>0)?'+':'')+fmt(r.avgRet5)+'%</td>' +
            '<td style="color:'+pctColor(r.avgRet21)+'">'+((r.avgRet21!=null&&r.avgRet21>0)?'+':'')+fmt(r.avgRet21)+'%</td>' +
            '<td style="color:#3db87a">'+((r.best21!=null&&r.best21>0)?'+':'')+fmt(r.best21)+'%</td>' +
            '<td style="color:#ef4444">'+fmt(r.worst21)+'%</td>' +
            '<td style="color:'+(r.sharpe!=null?(r.sharpe>0?'#3db87a':'#ef4444'):'var(--text-dim)')+'">'+fmt(r.sharpe,2)+'</td>' +
            '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
}

// ── Event Timeline ────────────────────────────────────────────
function renderTimeline(composites, filter) {
    var body = document.getElementById('cvol-event-body');
    var countEl = document.getElementById('cvol-event-count');
    if (!body) return;
    var events = (composites.events || []).slice().reverse();
    var now = new Date(); var yearStr = now.getFullYear().toString();
    var sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (filter === 'year') events = events.filter(function(e) { return e.date.startsWith(yearStr); });
    else if (filter === '6m') events = events.filter(function(e) { return new Date(e.date) >= sixMonthsAgo; });
    if (countEl) countEl.textContent = events.length + ' EVENTS';
    var sigColors = {'SAD':'border-color:#f59e0b;color:#f59e0b;background:rgba(245,158,11,0.1)','CI':'border-color:#60a8f8;color:#60a8f8;background:rgba(96,168,248,0.1)','CVC↓':'border-color:#ef4444;color:#ef4444;background:rgba(239,68,68,0.1)','CVC↑':'border-color:#3db87a;color:#3db87a;background:rgba(61,184,122,0.1)','RDS':'border-color:#ec4899;color:#ec4899;background:rgba(236,72,153,0.1)'};
    var sigTooltips = {'SAD':'Skew-ATM Divergence — stealth repositioning signal','CI':'Complacency Index — fragile calm warning','CVC↓':'Convexity-Variance down — top formation signal','CVC↑':'Convexity-Variance up — bottom formation signal','RDS':'Regime Divergence Score — explosive setup signal'};
    var html = '';
    events.forEach(function(e) {
        var s = uiGetSeason(e.date);
        var dirColor = (e.direction.indexOf('TOP')>=0||e.direction.indexOf('DOWNSIDE')>=0)?'#ef4444':'#3db87a';
        if (e.direction==='COMPLACENCY') dirColor = '#f59e0b';
        html += '<tr>' +
            '<td style="color:var(--text-muted);">'+fmtDate(e.date)+'</td>' +
            '<td><span class="sig-badge" style="'+(sigColors[e.signal]||'')+'" data-tooltip="'+(sigTooltips[e.signal]||'')+'">'+e.signal+'</span></td>' +
            '<td style="color:'+dirColor+';font-weight:700;">'+e.direction+'</td>' +
            '<td>'+fmt(e.value,3)+'</td>' +
            '<td>$'+fmt(e.underlying,2)+'</td>' +
            '<td style="color:'+pctColor(e.fwd5)+'">'+((e.fwd5!=null)?((e.fwd5>0?'+':'')+fmt(e.fwd5)+'%'):'—')+'</td>' +
            '<td style="color:'+pctColor(e.fwd21)+'">'+((e.fwd21!=null)?((e.fwd21>0?'+':'')+fmt(e.fwd21)+'%'):'—')+'</td>' +
            '<td><span style="color:'+s.c+'" data-tooltip="'+s.n+' season">'+s.e+' '+s.n+'</span></td>' +
            '</tr>';
    });
    body.innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);">No events in range</td></tr>';
}

// ── Composite Expand Modal ────────────────────────────────────
function openCompModal(compKey) {
    var meta = COMP_META[compKey]; if (!meta) return;
    document.getElementById('comp-modal-overlay').style.display = 'block';
    document.getElementById('comp-modal').style.display = 'block';
    document.getElementById('comp-modal-title').textContent = meta.label;
    document.getElementById('comp-modal-desc').textContent = meta.desc;
    var events = (CvolState.composites.events || []).filter(function(ev) {
        var k = ev.signal.replace('↓','Down').replace('↑','Up').replace('CVC','cvc').replace('SAD','sad').replace('CI','ci').replace('RDS','rds');
        return k.toLowerCase().indexOf(compKey.toLowerCase()) >= 0;
    });
    var totalFires = events.length;
    var hit21 = 0; events.forEach(function(ev) {
        if (ev.fwd21 == null) return;
        var isDown = ev.direction.indexOf('TOP')>=0||ev.direction.indexOf('DOWNSIDE')>=0;
        if ((isDown && ev.fwd21 < 0) || (!isDown && ev.fwd21 > 0)) hit21++;
    });
    var statsEl = document.getElementById('comp-modal-stats');
    statsEl.innerHTML = '<div style="display:flex;gap:24px;flex-wrap:wrap;">' +
        '<div data-tooltip="Total number of times this signal fired across history."><span style="color:var(--text-dim);font-size:0.6rem;letter-spacing:1px;">TOTAL FIRES</span><br><span style="font-size:1.1rem;font-weight:800;color:'+meta.color+'">'+totalFires+'</span></div>' +
        '<div data-tooltip="21-day directional hit rate."><span style="color:var(--text-dim);font-size:0.6rem;letter-spacing:1px;">HIT RATE 21D</span><br><span style="font-size:1.1rem;font-weight:800;color:'+(hit21/Math.max(1,events.length)*100>55?'#3db87a':'#ef4444')+'">'+Math.round(hit21/Math.max(1,events.length)*100)+'%</span></div>' +
        '</div>';
    setTimeout(function() { renderModalChart(compKey); }, 50);
}
function closeCompModal() {
    document.getElementById('comp-modal-overlay').style.display = 'none';
    document.getElementById('comp-modal').style.display = 'none';
}

// ── Full Render Orchestrator ──────────────────────────────────
function renderAll() {
    var data = CvolState.data; var comp = CvolState.composites;
    if (!data || !data.length) return;
    renderBanner(data, comp);
    renderKpiCards(data, comp);
    renderMainChart();
    renderVarDecomp();
    // Sparklines
    renderSparkline('spark-sad', comp.sad || [], '#f59e0b', null);
    renderSparkline('spark-ci', comp.ci || [], '#60a8f8', 82);
    renderSparkline('spark-cvc-down', comp.cvcDown || [], '#ef4444', 1.2);
    renderSparkline('spark-cvc-up', comp.cvcUp || [], '#3db87a', 1.2);
    renderSparkline('spark-rds', comp.rds || [], '#ec4899', null);
    // Sparkline hovers
    setupSparklineHover('spark-sad','spark-sad-tt');
    setupSparklineHover('spark-ci','spark-ci-tt');
    setupSparklineHover('spark-cvc-down','spark-cvc-down-tt');
    setupSparklineHover('spark-cvc-up','spark-cvc-up-tt');
    setupSparklineHover('spark-rds','spark-rds-tt');
    // Current values
    var n = data.length;
    document.getElementById('sad-current').textContent = fmt(comp.sad ? comp.sad[n-1] : null, 3);
    document.getElementById('ci-current').textContent = fmt(comp.ci ? comp.ci[n-1] : null, 2);
    document.getElementById('cvc-down-current').textContent = fmt(comp.cvcDown ? comp.cvcDown[n-1] : null, 2);
    document.getElementById('cvc-up-current').textContent = fmt(comp.cvcUp ? comp.cvcUp[n-1] : null, 2);
    document.getElementById('rds-current').textContent = fmt(comp.rds ? comp.rds[n-1] : null, 4);
    document.getElementById('sad-zscore').textContent = fmt(comp.sadZ ? comp.sadZ[n-1] : null, 2);
    document.getElementById('rds-zscore').textContent = fmt(comp.rdsZ ? comp.rdsZ[n-1] : null, 2);
    // Composite stats
    renderCompStats('sad', comp.sad||[], comp.events);
    renderCompStats('ci', comp.ci||[], comp.events);
    renderCompStats('cvcDown', comp.cvcDown||[], comp.events);
    renderCompStats('cvcUp', comp.cvcUp||[], comp.events);
    renderCompStats('rds', comp.rds||[], comp.events);
    // New panels
    renderHeatmap(data);
    renderCorrMatrix(data);
    renderScorecard(comp);
    renderTimeline(comp, CvolState.signalFilter);
}

// ── Series Chips ──────────────────────────────────────────────
function renderSeriesChips() {
    var el = document.getElementById('cvol-series-chips'); if (!el) return;
    el.innerHTML = '';
    Object.keys(SERIES_CFG).forEach(function(k) {
        var cfg = SERIES_CFG[k];
        var chip = document.createElement('span');
        chip.className = 'etf-chip ' + (CvolState.activeSeries.indexOf(k) >= 0 ? 'active' : 'inactive');
        chip.style.borderColor = cfg.color;
        chip.style.color = cfg.color;
        if (CvolState.activeSeries.indexOf(k) >= 0) chip.style.background = toRgba(cfg.color, 0.15);
        chip.textContent = cfg.label;
        chip.setAttribute('data-tooltip', 'Toggle ' + cfg.label + ' series on/off');
        chip.onclick = function() {
            var idx = CvolState.activeSeries.indexOf(k);
            if (idx >= 0) CvolState.activeSeries.splice(idx, 1); else CvolState.activeSeries.push(k);
            renderSeriesChips(); renderMainChart();
        };
        el.appendChild(chip);
    });
}

// ── Initialization ────────────────────────────────────────────
(async function() {
    try {
        var resp = await fetch('data/cvol/ngvl_cvol_history.csv');
        if (!resp.ok) throw new Error('CSV fetch failed: ' + resp.status);
        var text = await resp.text();
        var data = parseCvolCsv(text);
        if (!data.length) throw new Error('No data parsed');
        CvolState.data = data;
        CvolState.dates = data.map(function(r){ return r.date; });
        CvolState.composites = computeComposites(data);
        document.getElementById('cvol-loading').style.display = 'none';
        document.getElementById('cvol-dashboard').style.display = 'block';
        renderSeriesChips();
        renderAll();

        // Chart hover
        var canvas = document.getElementById('cvol-canvas');
        var varCanvas = document.getElementById('var-decomp-canvas');
        function onChartMove(ev) {
            var rect = canvas.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var r = getVisibleRange(); var n = r.e - r.s + 1;
            var pad = 60; var chartW = rect.width - pad - 70;
            var frac = (x - pad) / chartW;
            var idx = r.s + Math.round(frac * (n - 1));
            idx = Math.max(r.s, Math.min(r.e, idx));
            CvolState.hoverState = idx;
            renderMainChart(); renderVarDecomp();
        }
        canvas.addEventListener('mousemove', onChartMove);
        canvas.addEventListener('mouseleave', function() {
            CvolState.hoverState = null;
            document.getElementById('cvol-tooltip').style.display = 'none';
            renderMainChart(); renderVarDecomp();
        });
        if (varCanvas) {
            varCanvas.addEventListener('mousemove', function(ev) {
                var rect = varCanvas.getBoundingClientRect();
                var x = ev.clientX - rect.left;
                var r = getVisibleRange(); var n = r.e - r.s + 1;
                var pad = 55; var cW = rect.width - pad - 55;
                var frac = (x - pad) / cW;
                var idx = r.s + Math.round(frac * (n - 1));
                CvolState.hoverState = Math.max(r.s, Math.min(r.e, idx));
                renderMainChart(); renderVarDecomp();
            });
            varCanvas.addEventListener('mouseleave', function() {
                CvolState.hoverState = null;
                document.getElementById('var-decomp-tooltip').style.display = 'none';
                renderMainChart(); renderVarDecomp();
            });
        }

        // Horizon buttons
        document.getElementById('cvol-horizon-controls').addEventListener('click', function(ev) {
            var btn = ev.target.closest('.horizon-btn'); if (!btn) return;
            var range = btn.dataset.range;
            document.querySelectorAll('#cvol-horizon-controls .horizon-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            CvolState.horizonState = range;
            var n = CvolState.data.length;
            var daysMap = {'1W':7,'1M':30,'3M':90,'6M':180,'1Y':365,'3Y':1095,'ALL':0};
            var days = daysMap[range] || 0;
            if (days === 0) { CvolState.rangeState = {start:0, end:100}; }
            else { var s = Math.max(0, Math.round((1 - days / n) * 100)); CvolState.rangeState = {start: s, end: 100}; }
            document.getElementById('cvol-range-start').value = CvolState.rangeState.start;
            document.getElementById('cvol-range-end').value = CvolState.rangeState.end;
            updateRangeHighlight();
            renderMainChart(); renderVarDecomp();
        });

        // Range slider
        ['cvol-range-start', 'cvol-range-end'].forEach(function(id) {
            document.getElementById(id).addEventListener('input', function() {
                var s = parseInt(document.getElementById('cvol-range-start').value);
                var e = parseInt(document.getElementById('cvol-range-end').value);
                if (s > e - 1) { if (id === 'cvol-range-start') s = e - 1; else e = s + 1; document.getElementById(id).value = id === 'cvol-range-start' ? s : e; }
                CvolState.rangeState = { start: s, end: e };
                updateRangeHighlight();
                renderMainChart(); renderVarDecomp();
            });
        });

        // Event filter buttons
        document.getElementById('cvol-event-filter').addEventListener('click', function(ev) {
            var btn = ev.target.closest('.tab-btn'); if (!btn) return;
            document.querySelectorAll('#cvol-event-filter .tab-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            CvolState.signalFilter = btn.dataset.filter;
            renderTimeline(CvolState.composites, CvolState.signalFilter);
        });

        // Composite card expand
        document.querySelectorAll('.composite-card[data-comp]').forEach(function(card) {
            card.addEventListener('click', function() { openCompModal(card.dataset.comp); });
        });
        document.getElementById('comp-modal-close').addEventListener('click', closeCompModal);
        document.getElementById('comp-modal-overlay').addEventListener('click', closeCompModal);

        // Resize
        window.addEventListener('resize', function() { renderMainChart(); renderVarDecomp(); });

    } catch (err) {
        console.error('CVOL init error:', err);
        document.getElementById('cvol-loading').textContent = 'ERROR: ' + err.message;
    }
})();

function updateRangeHighlight() {
    var s = CvolState.rangeState.start, e = CvolState.rangeState.end;
    var hl = document.getElementById('cvol-range-highlight');
    if (hl) { hl.style.left = s + '%'; hl.style.width = (e - s) + '%'; }
    var lbl = document.getElementById('cvol-range-label');
    if (lbl && CvolState.data) {
        var r = getVisibleRange();
        var d0 = CvolState.data[r.s].date, d1 = CvolState.data[r.e].date;
        lbl.textContent = fmtDate(d0) + ' → ' + fmtDate(d1);
    }
}
