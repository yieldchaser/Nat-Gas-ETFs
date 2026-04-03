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
    if (ci != null && ci > 82) badges += '<span class="flash-badge flash-ci" data-tooltip="Fragile Calm Trigger: ATM volatility is historically suppressed (CI > 82). Historically, this is a spring-loaded setup for a violent spike in volatility.">COMPLACENCY HIGH</span>';
    var sad = comp.sad ? comp.sad[data.length - 1] : null;
    var sadZ = comp.sadZ ? comp.sadZ[data.length - 1] : null;
    if (sadZ != null && Math.abs(sadZ) > 1.5) badges += '<span class="flash-badge flash-sad" data-tooltip="Stealth Skew Shift: Skew is diverging significantly from ATM volatility. Indicates \'Smart Money\' is quietly placing directional bets ahead of price.">SKEW DIVERGENCE</span>';
    var rdsZ = comp.rdsZ ? comp.rdsZ[data.length - 1] : null;
    if (rdsZ != null && rdsZ > 1.8) badges += '<span class="flash-badge flash-rds" data-tooltip="Explosive Regime Shift: RDS Z-score > 1.8 indicates a rare trifecta of rapid skew shift, low vol, and fat tails \u2014 often seen at major trend inflections.">REGIME SHIFT</span>';
    el.innerHTML =
        '<div class="sb-item" data-tooltip="CME NGVL: 30-day forward implied volatility for Natural Gas. This is the institutional benchmark for market uncertainty."><div class="sb-lbl">NGVL</div><div class="sb-val" style="color:'+ngvlReg.color+'">'+fmt(last.ngvl)+'%</div><div class="sb-sub">'+fmt(comp.ngvlPct252?comp.ngvlPct252[data.length-1]:null,0)+'th · '+ngvlReg.label+'</div></div>' +
        '<div class="sb-item" data-tooltip="Sentiment Barometer: Correlates Call vs Put demand. >1.0 means the market is pricing more upside tail-risk; <1.0 means downside fear is dominant."><div class="sb-lbl">SKEW RATIO</div><div class="sb-val">'+fmt(last.skewRatio,3)+'</div><div class="sb-sub" style="color:'+(skDir.indexOf('RISING')>=0?'#3db87a':'#ef4444')+'">Z: '+fmt(comp.skewRatioZ21?comp.skewRatioZ21[data.length-1]:null)+ ' · '+skDir+'</div></div>' +
        '<div class="sb-item" data-tooltip="Tail Sensitivity: Measures the cost of deep OTM protection relative to ATM. >1.10 = speculators are aggressively buying \'lottery ticket\' tail hedges."><div class="sb-lbl">CONVEXITY</div><div class="sb-val" style="color:'+convColor+'">'+fmt(last.convexity,4)+'</div><div class="sb-sub" style="color:'+convColor+'">'+convLabel+'</div></div>' +
        '<div class="sb-item" data-tooltip="Current front-month futures settlement."><div class="sb-lbl">NG PRICE</div><div class="sb-val">$'+fmt(last.underlying,3)+'</div><div class="sb-sub">'+fmtDate(last.date)+'</div></div>' +
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
    var ci = comp.ci ? comp.ci[n-1] : null;
    // ATM 5d direction
    var atm5dir = n > 5 ? (last.atm > data[n-6].atm ? '▲ RISING' : '▼ FALLING') : '';
    // SAD status
    var sadZ = comp.sadZ ? comp.sadZ[n-1] : null;
    var sadActive = (sadZ != null && Math.abs(sadZ) > 1.5);
    // NGVL pct position
    var ngvlPctPos = p252 != null ? p252 : 50;

    el.innerHTML =
    // NGVL Card
    '<div class="cvol-kpi-card" style="--card-accent:'+ngvlReg.color+'"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:'+ngvlReg.color+'" data-tooltip="CME Natural Gas CVOL: The authoritative forward-looking gauge of market uncertainty. Uses the full option series to calculate the 30-day implied volatility surface.">NGVL</span><span class="cvol-kpi-regime" style="color:'+ngvlReg.color+'" data-tooltip="Regime Classification: Profiling current volatility against its own 1-year history. EXTREME (≥90th) readings are historically unsustainable and often mark major tops/bottoms.">'+ngvlReg.label+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="The current annualized percentage of implied volatility."><div class="cvol-kpi-lbl">CURRENT</div><div class="cvol-kpi-val" style="color:'+ngvlReg.color+'">'+fmt(last.ngvl)+'%</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="Tactical Ranking (1 month): How expensive is volatility vs. the last 21 trading days?"><div class="cvol-kpi-slbl">21D PCT</div><div class="cvol-kpi-sval">'+fmt(p21,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Quarterly Ranking (3 months): Measures current uncertainty against the seasonal cycle."><div class="cvol-kpi-slbl">63D PCT</div><div class="cvol-kpi-sval">'+fmt(p63,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Annual Ranking (1 year): The structural benchmark. Low readings signal extreme complacency; High readings signal panic."><div class="cvol-kpi-slbl">252D PCT</div><div class="cvol-kpi-sval">'+fmt(p252,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Day-over-Day Absolute Change in volatility points."><div class="cvol-kpi-slbl">Δ 1D</div><div class="cvol-kpi-sval" style="color:'+pctColor(d1)+'">'+((d1!=null&&d1>0)?'+':'')+fmt(d1)+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="5-day Volatility Momentum: Measures how fast the options market is repricing risk. Rapid expansion often precedes a violent price move."><span class="cvol-micro-lbl">5D ROC</span><span class="cvol-micro-val" style="color:'+pctColor(roc5)+'">'+((roc5!=null&&roc5>0)?'+':'')+fmt(roc5)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="The distance to the 1-year volatility ceiling. Proximity to 0% means the market is in a state of maximum historical uncertainty."><span class="cvol-micro-lbl">↓ 252D HIGH</span><span class="cvol-micro-val" style="color:'+(distHi!=null&&distHi>-10?'#ef4444':'var(--text-bright)')+'">'+fmt(distHi)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="The cushion above the 1-year volatility floor. Proximity to 0% indicates suppressed, spring-loaded market conditions."><span class="cvol-micro-lbl">↑ 252D LOW</span><span class="cvol-micro-val" style="color:'+(distLo!=null&&distLo<10?'#3db87a':'var(--text-bright)')+'">+'+fmt(distLo)+'%</span></div>' +
    '</div>' +
    '<div class="kpi-progress" data-tooltip="1-Year Regime Gauge: Positioning current volatility relative to its historical range (0% = Min, 100% = Max)."><div class="kpi-progress-fill" style="width:'+ngvlPctPos+'%;background:'+ngvlReg.color+'"></div></div></div>' +
 
    // SKEW RATIO Card
    '<div class="cvol-kpi-card" style="--card-accent:#f59e0b"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#f59e0b" data-tooltip="Sentiment Barometer: Comparing the premium of upside calls vs downside puts. >1.0 = Traders buying upside protection; <1.0 = Traders bracing for a price crash.">SKEW RATIO</span><span class="cvol-kpi-regime" style="color:'+(last.skewRatio>1?'#3db87a':'#ef4444')+'" data-tooltip="Five-day trend in directional demand.">'+skDir+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="Current ratio of UpVar to DnVar. Divergence from 1.0 indicates strong directional conviction in the options surface."><div class="cvol-kpi-lbl">CURRENT</div><div class="cvol-kpi-val">'+fmt(last.skewRatio,3)+'</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="Ranking of current skew bias over the last 3 months."><div class="cvol-kpi-slbl">63D PCT</div><div class="cvol-kpi-sval">'+fmt(comp.skewRatioPct63?comp.skewRatioPct63[n-1]:null,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Skew Z-Score (21d): Measures how unusual the current sentiment bias is vs. the recent mean."><div class="cvol-kpi-slbl">Z-SCORE</div><div class="cvol-kpi-sval">'+fmt(comp.skewRatioZ21?comp.skewRatioZ21[n-1]:null)+'σ</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="The absolute spread in volatility points between call and put implied vol."><div class="cvol-kpi-slbl">RAW SKEW</div><div class="cvol-kpi-sval">'+fmt(last.skew)+' pts</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Momentum in skew shift. Rapid moves higher often signal panic re-positioning."><div class="cvol-kpi-slbl">5D ROC</div><div class="cvol-kpi-sval">'+fmt(comp.skewRatioRoc5?comp.skewRatioRoc5[n-1]:null,3)+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="Bullish Demand (UpVar): The volatility premium for upside Natural Gas calls."><span class="cvol-micro-lbl">UP VAR</span><span class="cvol-micro-val" style="color:#3db87a">'+fmt(last.upVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Bearish Fear (DnVar): The volatility premium for downside Natural Gas puts."><span class="cvol-micro-lbl">DN VAR</span><span class="cvol-micro-val" style="color:#ef4444">'+fmt(last.dnVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Stealth Skew Check: Divergence between Skew and ATM vol. Signal Active = Institutions placing directional bets."><span class="cvol-micro-lbl">SAD</span><span class="cvol-micro-val">'+(sadActive?'<span style="color:#8b5cf6">ACTIVE</span>':'<span style="color:var(--text-dim)">NEUTRAL</span>')+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Relational Check: Does price normally follow skew? Positive correlation means price typically rises when skew rises."><span class="cvol-micro-lbl">NG CORR</span><span class="cvol-micro-val">'+fmt(skCorr,2)+'</span></div>' +
    '</div></div>' +
 
    // CONVEXITY Card
    '<div class="cvol-kpi-card" style="--card-accent:#ec4899"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#ec4899" data-tooltip="Tail Sensitivity: Measuring the \'Black Swan\' premium. If traders are paying much more for OTM tail-hedges than for ATM baseline protection, convexity expands.">CONVEXITY</span><span class="cvol-kpi-regime" style="color:'+convColor+'" data-tooltip="ELEVATED (>1.10): Market is pricing extreme tail-events. NORMAL (0.95-1.10): Typical price distribution. LOW (<0.95): Market is complacent about outliers.">'+convLabel+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="CVOL / ATM ratio. >1.0 means the wings of the vol surface (tail-risk) are being bid relative to the belly."><div class="cvol-kpi-lbl">CVOL / ATM</div><div class="cvol-kpi-val" style="color:'+convColor+'">'+fmt(last.convexity,4)+'</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="Ranking of current tail-pricing relative to the last 3 months."><div class="cvol-kpi-slbl">63D PCT</div><div class="cvol-kpi-sval">'+fmt(comp.convPct63?comp.convPct63[n-1]:null,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="At-The-Money (ATM) Implied Volatility: The baseline cost of protection for the current price."><div class="cvol-kpi-slbl">ATM VOL</div><div class="cvol-kpi-sval">'+fmt(last.atm)+'%</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Measures how unusual current tail-risk pricing is vs. its own 1-month average."><div class="cvol-kpi-slbl">CONV Z</div><div class="cvol-kpi-sval">'+fmt(convZ)+'σ</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Status of the Convexity-Variance Confirmation signal. ACTIVE = Maximum conviction for a trend reversal."><div class="cvol-kpi-slbl">CVC</div><div class="cvol-kpi-sval">'+cvcStatus+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="Bullish Demand (UpVar): Premium paid for upside Natural Gas calls."><span class="cvol-micro-lbl">UP VAR</span><span class="cvol-micro-val" style="color:#3db87a">'+fmt(last.upVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Bearish Fear (DnVar): Premium paid for downside Natural Gas puts."><span class="cvol-micro-lbl">DN VAR</span><span class="cvol-micro-val" style="color:#ef4444">'+fmt(last.dnVar)+'%</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="The directional bias between bullish and bearish protection. + = Bullish; - = Bearish."><span class="cvol-micro-lbl">VAR SPREAD</span><span class="cvol-micro-val" style="color:'+pctColor(last.upVar - last.dnVar)+'">'+((last.upVar-last.dnVar>0)?'+':'')+fmt(last.upVar - last.dnVar)+'%</span></div>' +
    '</div></div>' +
 
    // COMPLACENCY Card
    '<div class="cvol-kpi-card" style="--card-accent:#60a8f8"><div class="cvol-kpi-head"><span class="cvol-kpi-ticker" style="color:#60a8f8" data-tooltip="Fragile Calm Gauge: Measures how \'cheap\' volatility is relative to its structural 1-year history. Higher = more complacent market.">COMPLACENCY</span><span class="cvol-kpi-regime" style="color:'+(ci>82?'#f59e0b':ci>60?'#60a8f8':'#3db87a')+'" data-tooltip="HIGH (>82) signals a spring-loaded setup for a volatility spike. MODERATE is typical. LOW signals a market that is appropriately fearful.">'+(ci>82?'▲ HIGH':ci>60?'MODERATE':'LOW')+'</span></div>' +
    '<div class="cvol-kpi-main" data-tooltip="Scale of 0 (Extreme Fear) to 100 (Extreme Complacency). Based on inverse ATM percentile."><div class="cvol-kpi-lbl">INDEX (0-100)</div><div class="cvol-kpi-val" style="color:'+(ci>82?'#f59e0b':'#60a8f8')+'">'+fmt(ci,0)+'</div></div>' +
    '<div class="cvol-kpi-stats">' +
        '<div class="cvol-kpi-stat" data-tooltip="Annual Ranking of ATM volatility. Structural baseline for current pricing."><div class="cvol-kpi-slbl">ATM PCT</div><div class="cvol-kpi-sval">'+fmt(comp.atmPct252?comp.atmPct252[n-1]:null,0)+'th</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Statistical measure of vol cheapness. Negative Z = vol is cheap; Positive Z = vol is rich."><div class="cvol-kpi-slbl">ATM Z</div><div class="cvol-kpi-sval">'+fmt(comp.atmZ21?comp.atmZ21[n-1]:null)+'σ</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Standard 3-month baseline for at-the-money volatility."><div class="cvol-kpi-slbl">ATM MED90</div><div class="cvol-kpi-sval">'+fmt(med90)+'%</div></div>' +
        '<div class="cvol-kpi-stat" data-tooltip="Latest Natural Gas front-month settlement price."><div class="cvol-kpi-slbl">NG PRICE</div><div class="cvol-kpi-sval">$'+fmt(last.underlying,2)+'</div></div>' +
    '</div>' +
    '<div class="cvol-kpi-micro">' +
        '<div class="cvol-micro-line" data-tooltip="The longevity of the current tranquil regime. Extended periods above 82 often end with violent volatility gap-ups."><span class="cvol-micro-lbl">DAYS >82</span><span class="cvol-micro-val">'+(daysSinceCI!=null?daysSinceCI+'D':'—')+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Intermediate momentum in baseline volatility."><span class="cvol-micro-lbl">ATM 5D</span><span class="cvol-micro-val" style="color:'+(atm5dir.indexOf('RISING')>=0?'#ef4444':'#3db87a')+'">'+atm5dir+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Cross-Reference Check: CVOL signals gain maximum conviction when they align with the Trough-to-Peak cycle. A top signal here confirmed by >85% T2P cycle position is high-conviction."><span class="cvol-micro-lbl">T2P CROSS-REF</span><span class="cvol-micro-val" style="color:var(--text-dim);font-size:0.55rem;">SEE T2P TAB →</span></div>' +
    '</div></div>';
}


// ── Composite Stats Footer (micro-analytics layout + regime + seasonal) ──
function renderCompStats(compKey, values, events) {
    var el = document.getElementById(compKey + '-stats'); if (!el) return;
    var valid = values.filter(function(v){return v!=null;});
    var last90 = valid.slice(-90);
    var count252 = 0;
    var matchList = [];
    if (events) {
        var cutoff252 = CvolState.data.length - 252;
        events.forEach(function(ev){
            var k = ev.signal.replace('↓','Down').replace('↑','Up').replace('CVC','cvc').replace('SAD','sad').replace('CI','ci').replace('RDS','rds');
            if (k.toLowerCase().indexOf(compKey.toLowerCase()) >= 0) {
                if (ev.idx >= cutoff252) count252++;
                matchList.push(ev);
            }
        });
    }
    var d21 = valid.length > 21 ? valid[valid.length-1] - valid[valid.length-22] : null;
    // Current regime: active/neutral/cooling based on threshold
    var meta = COMP_META[compKey];
    var currentVal = valid.length ? valid[valid.length-1] : null;
    var regimeLabel = 'NEUTRAL', regimeColor = 'var(--text-dim)';
    if (meta && currentVal != null) {
        if (meta.thresholdType === 'raw' && meta.threshold != null) {
            if (currentVal >= meta.threshold) { regimeLabel = 'ACTIVE'; regimeColor = meta.color; }
            else if (currentVal >= meta.threshold * 0.8) { regimeLabel = 'WARMING'; regimeColor = '#f59e0b'; }
        } else if (meta.thresholdType === 'z') {
            // For z-score based signals use absolute value
            var absVal = Math.abs(currentVal);
            if (absVal >= (meta.thresholdVal || 1.5)) { regimeLabel = 'ACTIVE'; regimeColor = meta.color; }
            else if (absVal >= (meta.thresholdVal || 1.5) * 0.7) { regimeLabel = 'WARMING'; regimeColor = '#f59e0b'; }
        }
    }
    // Seasonal hit rate: W (Nov-Feb) vs S (Jun-Aug)
    var wHits = 0, wTotal = 0, sHits = 0, sTotal = 0;
    matchList.forEach(function(ev) {
        if (ev.fwd21 == null) return;
        var mo = parseInt(ev.date.split('-')[1]);
        var isDown = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
        var hit = (isDown && ev.fwd21 < 0) || (!isDown && ev.fwd21 > 0);
        if (mo >= 11 || mo <= 2) { wTotal++; if (hit) wHits++; }
        else if (mo >= 6 && mo <= 8) { sTotal++; if (hit) sHits++; }
    });
    var wPct = wTotal >= 3 ? Math.round(wHits / wTotal * 100) : null;
    var sPct = sTotal >= 3 ? Math.round(sHits / sTotal * 100) : null;
    var seasonHtml = '';
    if (wPct != null || sPct != null) {
        seasonHtml = '<div class="cvol-micro-line" data-tooltip="Predictive Seasonality Check: Winning probability in Winter (Nov-Feb) vs. Summer (Jun-Aug). Natural Gas is profoundly seasonal \u2014 a signal with a 75% edge in winter may fail during the summer shoulder months.">' +
            '<span class="cvol-micro-lbl">S. WIN RATE</span>' +
            '<span class="cvol-micro-val" style="font-size:0.55rem;">' +
            (wPct != null ? '<span style="color:' + (wPct > 55 ? '#3db87a' : '#ef4444') + '">❄:' + wPct + '%</span>' : '') +
            (wPct != null && sPct != null ? ' · ' : '') +
            (sPct != null ? '<span style="color:' + (sPct > 55 ? '#3db87a' : '#ef4444') + '">☀:' + sPct + '%</span>' : '') +
            '</span></div>';
    }
    // Replace flat grid with micro-analytics layout
    el.className = 'cvol-kpi-micro';
    el.style.marginTop = '6px';
    el.innerHTML =
        '<div class="cvol-micro-line" data-tooltip="21-day change in this composite value.">' +
            '<span class="cvol-micro-lbl">Δ21D</span>' +
            '<span class="cvol-micro-val" style="color:'+pctColor(d21)+'">'+((d21!=null&&d21>0)?'+':'')+fmt(d21,3)+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Number of signal fires in the last 252 trading days (1 year).">' +
            '<span class="cvol-micro-lbl">252D FIRES</span>' +
            '<span class="cvol-micro-val">'+count252+'</span></div>' +
        '<div class="cvol-micro-line" data-tooltip="Current signal regime: ACTIVE (above threshold), WARMING (approaching), or NEUTRAL.">' +
            '<span class="cvol-micro-lbl">REGIME</span>' +
            '<span class="cvol-micro-val" style="color:'+regimeColor+';font-weight:800;">'+regimeLabel+'</span></div>' +
        seasonHtml;
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
                var tt = MONTHS[m-1]+' '+y+' Volatility Audit:\n' +
                         '• NGVL Avg: '+cell.avgNgvl.toFixed(1)+'% ('+cell.regime.label+')\n' +
                         '• NG Price Avg: $'+cell.avgUnderlying.toFixed(2)+'\n' +
                         (cell.avgSkewRatio!=null ? '• Skew Ratio Avg: '+cell.avgSkewRatio.toFixed(2)+'\n' : '') +
                         'Historical Context: ' + (m >= 11 || m <= 2 ? 'Winter withdrawal peak - high vol common.' : m >= 6 && m <= 8 ? 'Summer cooling demand peak.' : 'Shoulder month - injection season.');
                html += '<div class="heatmap-cell" style="background:'+toRgba(bg,0.2)+';color:'+bg+';" data-tooltip="'+tt+'">'+cell.avgNgvl.toFixed(0)+'</div>';
            }
        }
    });
    html += '</div>';
    el.innerHTML = html;
}

// ── Correlation Matrix (range-synced) ─────────────────────────
function renderCorrMatrix(data) {
    var el = document.getElementById('cvol-corr-matrix'); if (!el) return;
    var r = getVisibleRange();
    var matrix = computeCorrMatrix(data, r.s, r.e);
    var n = CORR_LABELS.length;
    // Show the range used for correlation
    var rangeNote = '';
    if (data.length) {
        var d0 = data[r.s] ? fmtDate(data[r.s].date) : '';
        var d1 = data[r.e] ? fmtDate(data[r.e].date) : '';
        var days = r.e - r.s + 1;
        rangeNote = '<div style="font-size:0.5rem;color:var(--text-dim);letter-spacing:0.5px;margin-bottom:8px;text-align:right;" data-tooltip="Correlation is computed from the visible date range. Adjust the range slider above to see how correlations shift across regimes.">' + d0 + ' → ' + d1 + ' (' + days + ' days)</div>';
    }
    var html = rangeNote + '<div class="corr-grid" style="grid-template-columns:55px repeat('+n+', 1fr);">';
    html += '<div></div>';
    for (var j = 0; j < n; j++) html += '<div class="corr-header" style="font-size:0.45rem;">'+CORR_LABELS[j]+'</div>';
    for (var i = 0; i < n; i++) {
        html += '<div class="corr-header" style="font-size:0.45rem;justify-content:flex-end;padding-right:4px;">'+CORR_LABELS[i]+'</div>';
        for (var j = 0; j < n; j++) {
            var rv = matrix[i][j];
            var bg, fg;
            if (rv == null) { bg = 'rgba(255,255,255,0.02)'; fg = 'var(--text-dim)'; }
            else if (i === j) { bg = 'rgba(255,255,255,0.05)'; fg = 'var(--text-bright)'; }
            else if (rv > 0.7) { bg = 'rgba(61,184,122,'+((rv-0.5)*0.5)+')'; fg = '#fff'; }
            else if (rv > 0.3) { bg = 'rgba(61,184,122,0.08)'; fg = '#3db87a'; }
            else if (rv < -0.3) { bg = 'rgba(239,68,68,'+((Math.abs(rv)-0.2)*0.4)+')'; fg = '#ef4444'; }
            else { bg = 'rgba(255,255,255,0.02)'; fg = 'var(--text-muted)'; }
            var interp = '';
            if (rv == null) interp = 'Insufficient data for correlation.';
            else if (i === j) interp = 'Perfect Correlation (Self)';
            else if (rv > 0.8) interp = 'Strong Positive Correlation: These indices typically peak and trough simultaneously.';
            else if (rv > 0.5) interp = 'Moderate Positive: General directional alignment.';
            else if (rv < -0.6) interp = 'Strong Negative: One index typically expands as the other contracts — a primary divergence signal.';
            else if (rv < -0.3) interp = 'Moderate Negative: Diverging volatility characteristics.';
            else interp = 'Weak/Uncorrelated: These metrics operate independently in the current regime.';
            
            html += '<div class="corr-cell" style="background:'+bg+';color:'+fg+';" data-tooltip="'+CORR_LABELS[i]+' vs '+CORR_LABELS[j]+': r = '+(rv!=null?rv.toFixed(3):'—')+'\n' + interp + '">'+( rv!=null?rv.toFixed(2):'—')+'</div>';
        }
    }
    html += '</div>';
    el.innerHTML = html;
}

// ── Backtest Scorecard (with filter, annualized Sharpe, median, MAG, summary) ──
function renderScorecard(composites) {
    var el = document.getElementById('cvol-scorecard'); if (!el) return;
    var rows = computeScorecard(composites);
    // Apply signal type filter
    var stf = CvolState.signalTypeFilter;
    if (stf !== 'all') rows = rows.filter(function(r) { return r.signal === stf; });
    if (!rows.length) { el.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:20px;">No signal data' + (stf !== 'all' ? ' for ' + stf : '') + '</div>'; return; }
    var sigColors = {'SAD':'#f59e0b','CI':'#60a8f8','CVC↓':'#ef4444','CVC↑':'#3db87a','RDS':'#ec4899'};
    var annFactor = Math.sqrt(252 / 21); // Annualization factor for 21-day holding period
    var html = '<table class="scorecard-table"><thead><tr>' +
        '<th data-tooltip="Aggregate Composite Signal: SAD, CI, CVC, or RDS.">SIGNAL</th>' +
        '<th data-tooltip="Sample Size: Total number of validated signals in the lookback period.">COUNT</th>' +
        '<th data-tooltip="Short-Term Hit Rate: Probability that NG moves in the predicted direction within 5 trading sessions.">HIT 5D</th>' +
        '<th data-tooltip="Medium-Term Hit Rate (Gold Standard): Probability that NG moves in the predicted direction within 21 trading sessions (1 month). The primary benchmark for option-based signaling.">HIT 21D</th>' +
        '<th data-tooltip="Tactical Return: The average percentage change in NG price 1 week after the signal fires.">AVG 5D</th>' +
        '<th data-tooltip="Strategic Return: The average percentage change in NG price 1 month after the signal fires.">AVG 21D</th>' +
        '<th data-tooltip="Reliability Check: The median 21-day return. Compared to the Average, this shows if the signal is driven by consistent performance or rare outliers.">MED 21D</th>' +
        '<th data-tooltip="Volatility Potential: The average absolute price move after a signal, regardless of direction. Measures the \'power\' of the signal.">MAG 21D</th>' +
        '<th data-tooltip="Maximum historical upside potential captured by this signal.">BEST 21D</th>' +
        '<th data-tooltip="Maximum historical downside risk experienced after this signal.">WORST 21D</th>' +
        '<th data-tooltip="Consistency Score: Annualized Sharpe measures the risk-adjusted return of the signal. >0.50 is the institutional benchmark for a scalable edge.">SHARPE</th>' +
        '</tr></thead><tbody>';
    var bestSharpe = -Infinity, worstSharpe = Infinity, bestSig = '', worstSig = '';
    var totalWeightedSharpe = 0, totalWeightCount = 0;
    rows.forEach(function(r) {
        var sc = sigColors[r.signal] || 'var(--text-primary)';
        var hr21 = r.hitRate21; var hrColor = hr21 != null ? (hr21 > 55 ? '#3db87a' : hr21 < 45 ? '#ef4444' : 'var(--text-primary)') : 'var(--text-dim)';
        var barW = hr21 != null ? Math.min(100, hr21) : 0;
        var annSharpe = r.sharpe != null ? r.sharpe * annFactor : null;
        if (annSharpe != null) { if (annSharpe > bestSharpe) { bestSharpe = annSharpe; bestSig = r.signal; } if (annSharpe < worstSharpe) { worstSharpe = annSharpe; worstSig = r.signal; } totalWeightedSharpe += annSharpe * r.count; totalWeightCount += r.count; }
        html += '<tr>' +
            '<td style="color:'+sc+';font-weight:800;">'+r.signal+'</td>' +
            '<td>'+r.count+'</td>' +
            '<td style="color:'+(r.hitRate5!=null?(r.hitRate5>55?'#3db87a':'#ef4444'):'var(--text-dim)')+'">'+fmt(r.hitRate5,0)+'%</td>' +
            '<td style="color:'+hrColor+'">'+fmt(r.hitRate21,0)+'%<span class="score-bar" style="width:'+barW+'px;background:'+hrColor+';"></span></td>' +
            '<td style="color:'+pctColor(r.avgRet5)+'">'+((r.avgRet5!=null&&r.avgRet5>0)?'+':'')+fmt(r.avgRet5)+'%</td>' +
            '<td style="color:'+pctColor(r.avgRet21)+'">'+((r.avgRet21!=null&&r.avgRet21>0)?'+':'')+fmt(r.avgRet21)+'%</td>' +
            '<td style="color:'+pctColor(r.median21)+'">'+((r.median21!=null&&r.median21>0)?'+':'')+fmt(r.median21)+'%</td>' +
            '<td style="color:var(--text-bright)">'+fmt(r.mag21)+'%</td>' +
            '<td style="color:#3db87a">'+((r.best21!=null&&r.best21>0)?'+':'')+fmt(r.best21)+'%</td>' +
            '<td style="color:#ef4444">'+fmt(r.worst21)+'%</td>' +
            '<td style="color:'+(annSharpe!=null?(annSharpe>0?'#3db87a':'#ef4444'):'var(--text-dim)')+'">'+fmt(annSharpe,2)+'</td>' +
            '</tr>';
    });
    // Summary row
    if (rows.length > 1) {
        var combinedSharpe = totalWeightCount > 0 ? totalWeightedSharpe / totalWeightCount : null;
        html += '<tr class="scorecard-summary">' +
            '<td colspan="2" style="text-align:left;padding-left:16px;">SUMMARY</td>' +
            '<td colspan="2" style="font-size:0.55rem;">BEST: <span style="color:'+(sigColors[bestSig]||'')+'">'+bestSig+' ('+fmt(bestSharpe,2)+')</span></td>' +
            '<td colspan="2" style="font-size:0.55rem;">WORST: <span style="color:'+(sigColors[worstSig]||'')+'">'+worstSig+' ('+fmt(worstSharpe,2)+')</span></td>' +
            '<td colspan="2"></td>' +
            '<td colspan="3" style="font-size:0.55rem;">COMBINED: <span style="color:'+(combinedSharpe!=null&&combinedSharpe>0?'#3db87a':'#ef4444')+'">'+fmt(combinedSharpe,2)+'</span></td>' +
            '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
}

// ── Global Confluence and Formatting Helpers ────────────────────
function getGlobalConfluence(ev) {
    if (!CvolState.composites || !CvolState.composites.events) return 0;
    if (!CvolState._confCache) {
        var allEvents = CvolState.composites.events.slice().reverse();
        var allDates = {};
        allEvents.forEach(function(e) { if (!allDates[e.date]) allDates[e.date] = []; allDates[e.date].push(e); });
        var keys = Object.keys(allDates).sort();
        CvolState._confCache = { dates: allDates, keys: keys };
    }
    var cache = CvolState._confCache;
    var di = cache.keys.indexOf(ev.date);
    if (di < 0) return 0;
    var count = 0;
    for (var j = Math.max(0, di - 5); j <= Math.min(cache.keys.length - 1, di + 5); j++) {
        cache.dates[cache.keys[j]].forEach(function(e2) {
            if (e2 !== ev && e2.signal !== ev.signal) count++;
        });
    }
    return count;
}
function pctFmt(n) { return n != null ? (n > 0 ? '+' : '') + (n * 100).toFixed(1) + '%' : '—'; }
function pctColor(n) { return n > 0 ? '#3db87a' : (n < 0 ? '#ef4444' : 'var(--text-bright)'); }

// ── Event Timeline (with confluence, PENDING, signal-type filter) ──
function renderTimeline(composites, filter) {
    var body = document.getElementById('cvol-event-body');
    var countEl = document.getElementById('cvol-event-count');
    if (!body) return;
    var allEvents = (composites.events || []).slice().reverse();
    // Time filter
    var now = new Date(); var yearStr = now.getFullYear().toString();
    var sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (filter === 'year') allEvents = allEvents.filter(function(e) { return e.date.startsWith(yearStr); });
    else if (filter === '6m') allEvents = allEvents.filter(function(e) { return new Date(e.date) >= sixMonthsAgo; });
    // Signal type filter
    var stf = CvolState.signalTypeFilter;
    var events = stf !== 'all' ? allEvents.filter(function(e) { return e.signal === stf; }) : allEvents;
    if (countEl) countEl.textContent = events.length + ' EVENTS';
    // Determine "recent" threshold for PENDING state (last 21 sessions)
    var dataLen = CvolState.data ? CvolState.data.length : 0;
    var recentCutoffDate = null;
    if (CvolState.data && dataLen > 21) recentCutoffDate = CvolState.data[dataLen - 21].date;
    var sigColors = {'SAD':'border-color:#f59e0b;color:#f59e0b;background:rgba(245,158,11,0.1)','CI':'border-color:#60a8f8;color:#60a8f8;background:rgba(96,168,248,0.1)','CVC↓':'border-color:#ef4444;color:#ef4444;background:rgba(239,68,68,0.1)','CVC↑':'border-color:#3db87a;color:#3db87a;background:rgba(61,184,122,0.1)','RDS':'border-color:#ec4899;color:#ec4899;background:rgba(236,72,153,0.1)'};
    var sigTooltips = {'SAD':'Skew-ATM Divergence — stealth repositioning signal','CI':'Complacency Index — fragile calm warning','CVC↓':'Convexity-Variance down — top formation signal','CVC↑':'Convexity-Variance up — bottom formation signal','RDS':'Regime Divergence Score — explosive setup signal'};
    var html = '';
    events.forEach(function(e) {
        var s = uiGetSeason(e.date);
        var dirColor = (e.direction.indexOf('TOP')>=0||e.direction.indexOf('DOWNSIDE')>=0)?'#ef4444':'#3db87a';
        if (e.direction==='COMPLACENCY') dirColor = '#f59e0b';
        var conf = getGlobalConfluence(e);
        var confHtml = conf >= 3 ? '<span class="confluence-badge" style="background:rgba(239,68,68,0.2);color:#ef4444;" data-tooltip="' + conf + ' other signals within ±5 sessions — EXTREME confluence">' + conf + '</span>'
            : conf >= 2 ? '<span class="confluence-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;" data-tooltip="' + conf + ' other signals within ±5 sessions — strong confluence">' + conf + '</span>'
            : conf >= 1 ? '<span class="confluence-badge" style="background:rgba(96,168,248,0.1);color:#60a8f8;" data-tooltip="' + conf + ' other signal within ±5 sessions">' + conf + '</span>'
            : '<span style="color:var(--text-dim);opacity:0.3">0</span>';
        // PENDING state for recent events where forward returns aren't measurable yet
        var isRecent = recentCutoffDate && e.date > recentCutoffDate;
        var fwd5Html = e.fwd5 != null ? '<span style="color:' + pctColor(e.fwd5) + '">' + ((e.fwd5>0?'+':'') + fmt(e.fwd5) + '%') + '</span>'
            : isRecent ? '<span class="pending-label" data-tooltip="Market Validation Pending: This signal fired less than 5 sessions ago. Volatility signals often require 3-5 days of \'digestion\' before price reflects the options-market bias.">PENDING</span>' : '—';
        var fwd21Html = e.fwd21 != null ? '<span style="color:' + pctColor(e.fwd21) + '">' + ((e.fwd21>0?'+':'') + fmt(e.fwd21) + '%') + '</span>'
            : isRecent ? '<span class="pending-label" data-tooltip="Institutional Alpha Window Pending: This signal fired less than 21 sessions ago. We use a full trading month (21 days) as the Gold Standard for validating options-surface predictive power.">PENDING</span>' : '—';
        html += '<tr' + (conf >= 2 ? ' style="border-left:2px solid rgba(245,158,11,0.3);"' : '') + '>' +
            '<td style="color:var(--text-muted);">'+fmtDate(e.date)+'</td>' +
            '<td><span class="sig-badge" style="'+(sigColors[e.signal]||'')+'" data-tooltip="'+(sigTooltips[e.signal]||'')+'">'+e.signal+'</span></td>' +
            '<td style="color:'+dirColor+';font-weight:700;">'+e.direction+'</td>' +
            '<td>'+fmt(e.value,3)+'</td>' +
            '<td>$'+fmt(e.underlying,2)+'</td>' +
            '<td>'+fwd5Html+'</td>' +
            '<td>'+fwd21Html+'</td>' +
            '<td>'+confHtml+'</td>' +
            '<td><span style="color:'+s.c+'" data-tooltip="'+s.n+' season">'+s.e+' '+s.n+'</span></td>' +
            '</tr>';
    });
    body.innerHTML = html || '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);">No events in range</td></tr>';
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
    var totalFires = events.length;
    var hit21 = 0, fwd21s = [], wHits = 0, wTotal = 0, sHits = 0, sTotal = 0, confTotal = 0;
    events.forEach(function(ev) {
        confTotal += getGlobalConfluence(ev) || 0;
        if (ev.fwd21 == null) return;
        var r = ev.fwd21;
        var isDown = ev.direction.indexOf('TOP')>=0||ev.direction.indexOf('DOWNSIDE')>=0;
        var hit = (isDown && r < 0) || (!isDown && r > 0);
        if (hit) hit21++;
        // Seasonality
        var mo = parseInt(ev.date.split('-')[1]);
        if (mo >= 11 || mo <= 2) { wTotal++; if (hit) wHits++; }
        else if (mo >= 6 && mo <= 8) { sTotal++; if (hit) sHits++; }
        // For stats, we care about the *directionally adjusted* return if we are a directional signal
        // Wait, for RDS/SAD/CVC, the actual return matters. We can just store raw NG return, but magnitude/best/worst are easier to think about directionally.
        // Actually, let's keep it standard: Median 21D (raw), MAG 21D (abs), Best (raw max), Worst (raw min).
        // If it's a Downside signal (isDown), then Best is negative, Worst is positive?
        // Let's stick perfectly to the Scorecard methodology for consistency.
        fwd21s.push(r);
    });
    
    // Sort for median and min/max
    var sorted21 = fwd21s.slice().sort(function(a,b){return a-b;});
    var med21 = sorted21.length ? (sorted21.length % 2 === 0 ? (sorted21[sorted21.length/2 - 1] + sorted21[sorted21.length/2]) / 2 : sorted21[Math.floor(sorted21.length/2)]) : 0;
    var abs21 = fwd21s.slice().map(function(x){return Math.abs(x);}).sort(function(a,b){return a-b;});
    var mag21 = abs21.length ? abs21.reduce(function(sum, x){return sum + x;}, 0) / abs21.length : 0;
    var best21 = sorted21.length ? sorted21[sorted21.length-1] : 0;
    var worst21 = sorted21.length ? sorted21[0] : 0;
    var hitRate = Math.round(hit21 / Math.max(1, events.length) * 100);
    var avgConf = events.length ? (confTotal / events.length).toFixed(1) : '0.0';
    var wPct = wTotal >= 3 ? Math.round(wHits / wTotal * 100) + '%' : 'N/A';
    var sPct = sTotal >= 3 ? Math.round(sHits / sTotal * 100) + '%' : 'N/A';

    var statsEl = document.getElementById('comp-modal-stats');
    var stHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:16px;">';
    var mkStat = function(label, val, tooltip, valColor) {
        return '<div class="cvol-kpi" style="padding:12px;background:var(--bg-panel);border:1px solid var(--border-primary);border-radius:6px;" data-tooltip="'+tooltip+'">' +
            '<div style="color:var(--text-dim);font-size:0.6rem;letter-spacing:1px;margin-bottom:6px;">'+label+'</div>' +
            '<div style="font-size:1.1rem;font-weight:800;color:'+(valColor||'var(--text-bright)')+';">'+val+'</div></div>';
    };
    stHtml += mkStat('TOTAL FIRES', totalFires, 'Total times this signal fired', meta.color);
    stHtml += mkStat('21D HIT RATE', hitRate + '%', 'Directional hit rate over 21 days', hitRate > 55 ? '#3db87a' : (hitRate < 45 ? '#ef4444' : 'var(--text-bright)'));
    stHtml += mkStat('MEDIAN 21D', pctFmt(med21), 'Median 21-day NG return', pctColor(med21));
    stHtml += mkStat('MAGNITUDE 21D', pctFmt(mag21), 'Average absolute 21-day NG move', pctColor(mag21));
    stHtml += mkStat('BEST 21D', pctFmt(best21), 'Maximum 21-day positive move', pctColor(best21));
    stHtml += mkStat('WORST 21D', pctFmt(worst21), 'Maximum 21-day negative move', pctColor(worst21));
    stHtml += mkStat('AVG CONFLUENCE', avgConf, 'Average number of other signals firing within ±5 days', 'var(--text-bright)');
    stHtml += mkStat('SEASON (W / S)', '<span style="color:'+(wPct.indexOf('N/A')<0&&(parseInt(wPct)>55)?'#3db87a':'var(--text-muted)')+'">'+wPct+'</span> <span style="color:var(--text-dim);font-weight:400;">/</span> <span style="color:'+(sPct.indexOf('N/A')<0&&(parseInt(sPct)>55)?'#3db87a':'var(--text-muted)')+'">'+sPct+'</span>', 'Winter vs Summer hit rate', '');
    stHtml += '</div>';
    statsEl.innerHTML = stHtml;

    // Setup modal slider and attach listener
    var mStart = document.getElementById('comp-modal-range-start');
    var mEnd = document.getElementById('comp-modal-range-end');
    var hl = document.getElementById('comp-modal-range-highlight');
    var lbl = document.getElementById('comp-modal-range-label');
    
    if (mStart && mEnd && CvolState.data) {
        var dataLen = CvolState.data.length;
        mStart.max = dataLen - 1; mEnd.max = dataLen - 1;
        
        // ALWAYS RESET to full range when opening a new modal signal
        CvolState.modalRange = { s: 0, e: dataLen - 1 };
        mStart.value = 0;
        mEnd.value = dataLen - 1;
        
        var updateModalSlider = function(e) {
            var sVal = parseInt(mStart.value), eVal = parseInt(mEnd.value);
            // One thumb cannot pass the other
            if (sVal > eVal - 1) {
                if (e && e.target && e.target.id === 'comp-modal-range-start') {
                    sVal = eVal - 1; mStart.value = sVal;
                } else {
                    eVal = sVal + 1; mEnd.value = eVal;
                }
            }
            CvolState.modalRange = { s: sVal, e: eVal };
            
            // Deactivate horizon buttons if this is a manual "input" event
            if (e && e.type === 'input') {
                var hG = document.getElementById('comp-modal-horizon-controls');
                if (hG) hG.querySelectorAll('.horizon-btn').forEach(function(b) { b.classList.remove('active'); });
            }

            hl.style.left = (sVal / (dataLen - 1) * 100) + '%';
            hl.style.width = ((eVal - sVal) / (dataLen - 1) * 100) + '%';
            
            var dFmt = function(dStr) { return dStr ? new Date(dStr).toLocaleDateString('en-US', {month:'short', year:'numeric'}) : ''; };
            var sD = dFmt(CvolState.dates[sVal]), eD = dFmt(CvolState.dates[eVal]);
            lbl.textContent = sVal === 0 && eVal === dataLen - 1 ? 'ALL DATA' : (sD + ' TO ' + eD);
            renderModalChart(compKey);
        };
        mStart.oninput = updateModalSlider;
        mEnd.oninput = updateModalSlider;
        
        // Initial ui sync
        var sVal = CvolState.modalRange.s, eVal = CvolState.modalRange.e;
        hl.style.left = (sVal / (dataLen - 1) * 100) + '%';
        hl.style.width = ((eVal - sVal) / (dataLen - 1) * 100) + '%';
        lbl.textContent = 'ALL DATA';

        // Modal Horizon Buttons
        var hGroup = document.getElementById('comp-modal-horizon-controls');
        if (hGroup) {
            // Reset to ALL on open
            hGroup.querySelectorAll('.horizon-btn').forEach(function(b) { b.classList.remove('active'); if (b.dataset.range === 'ALL') b.classList.add('active'); });
            
            hGroup.onclick = function(ev) {
                var btn = ev.target.closest('.horizon-btn'); if (!btn) return;
                hGroup.querySelectorAll('.horizon-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                
                var period = btn.dataset.range;
                var daysMap = {'1W':7,'1M':21,'3M':63,'6M':126,'1Y':252,'3Y':756,'ALL':0};
                var days = daysMap[period] || 0;
                
                var sNew, eNew = dataLen - 1;
                if (days === 0) {
                    sNew = 0;
                } else {
                    sNew = Math.max(0, dataLen - 1 - days);
                }
                
                mStart.value = sNew;
                mEnd.value = eNew;
                
                // Explicitly trigger update without needing a fake event
                updateModalSlider();
            };
        }
    }

    // Attach hover listener to canvas
    var canvas = document.getElementById('comp-modal-canvas');
    if (canvas) {
        canvas.onmousemove = function(ev) {
            var rect = canvas.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var pad = { left: 55, right: 55 }; var cW = rect.width - pad.left - pad.right;
            var frac = (x - pad.left) / cW;
            if (frac < 0) frac = 0; else if (frac > 1) frac = 1;

            var dataLen = (CvolState.data || []).length;
            var sIdx = CvolState.modalRange ? CvolState.modalRange.s : 0;
            var eIdx = CvolState.modalRange ? CvolState.modalRange.e : (dataLen - 1);
            var localN = eIdx - sIdx + 1;
            
            var localIdx = Math.round(frac * (localN - 1));
            CvolState.modalHoverIdx = sIdx + localIdx;
            CvolState.modalCompKey = compKey;
            
            var tt = document.getElementById('comp-modal-tooltip');
            if (tt) {
                tt.style.display = 'block';
                tt.style.left = (ev.clientX - rect.left + 15) + 'px';
                tt.style.top = (ev.clientY - rect.top + 15) + 'px';
            }
            renderModalChart(compKey);
        };
        canvas.onmouseleave = function() {
            CvolState.modalHoverIdx = null;
            var tt = document.getElementById('comp-modal-tooltip');
            if (tt) tt.style.display = 'none';
            renderModalChart(compKey);
        };
    }
    
    setTimeout(function() { renderModalChart(compKey); }, 50);
}
function closeCompModal() {
    CvolState.modalHoverIdx = null;
    document.getElementById('comp-modal-overlay').style.display = 'none';
    document.getElementById('comp-modal').style.display = 'none';
    var tt = document.getElementById('comp-modal-tooltip'); if (tt) tt.style.display = 'none';
}

// ── Full Render Orchestrator ──────────────────────────────────
function renderAll() {
    var data = CvolState.data; var comp = CvolState.composites;
    if (!data || !data.length) return;
    renderBanner(data, comp);
    renderKpiCards(data, comp);
    renderMainChart();
    renderVarDecomp();
    renderVarSeriesChips();
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
        if (['upVar','dnVar','skewRatio'].indexOf(k) >= 0) return; // Skip these here
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

function renderVarSeriesChips() {
    var el = document.getElementById('var-series-chips'); if (!el) return;
    el.innerHTML = '';
    Object.keys(VAR_SERIES_CFG).forEach(function(k) {
        var cfg = VAR_SERIES_CFG[k];
        var active = CvolState.varActiveSeries.indexOf(k) >= 0;
        var chip = document.createElement('span');
        chip.className = 'var-chip ' + (active ? 'active' : 'inactive');
        chip.style.cssText = 'display:flex; align-items:center; cursor:pointer; padding:2px 6px; border-radius:4px; transition:all 0.2s; opacity:' + (active ? '1' : '0.4') + '; border: 1px solid ' + (active ? cfg.color : 'transparent');
        
        var dot = document.createElement('span');
        dot.style.cssText = 'display:inline-block; width:8px; height:8px; border-radius:1px; margin-right:6px; background:' + cfg.color + (['skewRatio','underlying'].indexOf(k) >= 0 ? '; height:2px; border-radius:0' : '');
        
        var label = document.createElement('span');
        label.style.color = cfg.color;
        label.textContent = cfg.label;
        
        chip.appendChild(dot);
        chip.appendChild(label);
        chip.setAttribute('data-tooltip', cfg.desc);
        
        chip.onclick = function() {
            var idx = CvolState.varActiveSeries.indexOf(k);
            if (idx >= 0) CvolState.varActiveSeries.splice(idx, 1); else CvolState.varActiveSeries.push(k);
            renderVarSeriesChips(); renderVarDecomp();
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
                var r = getVarVisibleRange(); var n = r.e - r.s + 1;
                var pad = 55; var cW = rect.width - pad - 55;
                var frac = (x - pad) / cW;
                if (frac < 0) frac = 0; else if (frac > 1) frac = 1;
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

        // --- Horizon Control Shared Utility ---
        function setHorizonEx(period, targetKey) {
            if (!CvolState.data || !CvolState.data.length) return;
            var n = CvolState.data.length;
            var daysMap = {'1W':7,'1M':21,'3M':63,'6M':126,'1Y':252,'3Y':756,'ALL':0};
            var days = daysMap[period] || 0;
            var state = (days === 0) ? {start:0, end:100} : {start: Math.max(0, Math.round((1 - days / n) * 100)), end: 100};
            
            if (targetKey === 'main') {
                CvolState.rangeState = state;
                var sInp = document.getElementById('cvol-range-start');
                var eInp = document.getElementById('cvol-range-end');
                if (sInp) sInp.value = state.start;
                if (eInp) eInp.value = state.end;
                updateRangeHighlight();
                renderMainChart(); renderCorrMatrix(CvolState.data);
            } else if (targetKey === 'var') {
                CvolState.varRangeState = state;
                var sInp = document.getElementById('var-range-start');
                var eInp = document.getElementById('var-range-end');
                if (sInp) sInp.value = state.start;
                if (eInp) eInp.value = state.end;
                updateVarRangeHighlight();
                renderVarDecomp();
            }
        }

        // --- Main Horizon Listeners ---
        var cvolHorizon = document.getElementById('cvol-horizon-controls');
        if (cvolHorizon) {
            cvolHorizon.addEventListener('click', function(ev) {
                var btn = ev.target.closest('.horizon-btn'); if (!btn) return;
                cvolHorizon.querySelectorAll('.horizon-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                setHorizonEx(btn.dataset.range, 'main');
            });
        }

        // --- Variance Horizon Listeners ---
        var varHorizon = document.getElementById('var-horizon-controls');
        if (varHorizon) {
            varHorizon.addEventListener('click', function(ev) {
                var btn = ev.target.closest('.horizon-btn'); if (!btn) return;
                varHorizon.querySelectorAll('.horizon-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                setHorizonEx(btn.dataset.range, 'var');
            });
        }

        // --- Range Sliders (Main Chart) ---
        ['cvol-range-start', 'cvol-range-end'].forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function() {
                var sInp = document.getElementById('cvol-range-start');
                var eInp = document.getElementById('cvol-range-end');
                var s = parseInt(sInp.value);
                var e = parseInt(eInp.value);
                if (s > e - 1) { if (id === 'cvol-range-start') s = e - 1; else e = s + 1; sInp.value = s; eInp.value = e; }
                CvolState.rangeState = { start: s, end: e };
                // Deactivate horizon buttons on manual drag
                if (cvolHorizon) cvolHorizon.querySelectorAll('.horizon-btn').forEach(function(b) { b.classList.remove('active'); });
                updateRangeHighlight();
                renderMainChart(); renderCorrMatrix(CvolState.data);
            });
        });

        // --- Range Sliders (Variance Decomposition) ---
        ['var-range-start', 'var-range-end'].forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function() {
                var sInp = document.getElementById('var-range-start');
                var eInp = document.getElementById('var-range-end');
                var s = parseInt(sInp.value);
                var e = parseInt(eInp.value);
                if (s > e - 1) { if (id === 'var-range-start') s = e - 1; else e = s + 1; sInp.value = s; eInp.value = e; }
                CvolState.varRangeState = { start: s, end: e };
                 // Deactivate horizon buttons on manual drag
                if (varHorizon) varHorizon.querySelectorAll('.horizon-btn').forEach(function(b) { b.classList.remove('active'); });
                updateVarRangeHighlight();
                renderVarDecomp();
            });
        });

        // Event filter buttons (time range)
        document.getElementById('cvol-event-filter').addEventListener('click', function(ev) {
            var btn = ev.target.closest('.tab-btn'); if (!btn) return;
            document.querySelectorAll('#cvol-event-filter .tab-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            CvolState.signalFilter = btn.dataset.filter;
            renderTimeline(CvolState.composites, CvolState.signalFilter);
        });

        // Signal type filter chips (syncs scorecard + timeline)
        document.getElementById('cvol-signal-type-filter').addEventListener('click', function(ev) {
            var chip = ev.target.closest('.signal-chip'); if (!chip) return;
            document.querySelectorAll('#cvol-signal-type-filter .signal-chip').forEach(function(c) { c.classList.remove('active'); });
            chip.classList.add('active');
            CvolState.signalTypeFilter = chip.dataset.signal;
            renderScorecard(CvolState.composites);
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

function getVarVisibleRange() {
    var data = CvolState.data;
    if (!data || !data.length) return { s: 0, e: 0 };
    var n = data.length;
    var s = Math.floor(CvolState.varRangeState.start / 100 * (n - 1));
    var e = Math.ceil(CvolState.varRangeState.end / 100 * (n - 1));
    return { s: Math.max(0, s), e: Math.min(n - 1, Math.max(s + 1, e)) };
}

function updateVarRangeHighlight() {
    var s = CvolState.varRangeState.start, e = CvolState.varRangeState.end;
    var hl = document.getElementById('var-range-highlight');
    if (hl) { hl.style.left = s + '%'; hl.style.width = (e - s) + '%'; }
    var lbl = document.getElementById('var-range-label');
    if (lbl && CvolState.data) {
        var r = getVarVisibleRange();
        var d0 = CvolState.data[r.s].date, d1 = CvolState.data[r.e].date;
        lbl.textContent = (s === 0 && e === 100) ? 'ALL DATA' : fmtDate(d0) + ' → ' + fmtDate(d1);
    }
}
