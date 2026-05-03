// flow-composite.js — Premium Composite Z + Flow vs NG Charts
const SHORT_TICKERS = ['KOLD','HND','3NGS'];

function computeCompositeZ() {
    const tickers = ['BOIL','HNU','3NGL','KOLD','HND','3NGS'];
    const dateMap = {};
    tickers.forEach(tk => {
        const d = state.cache[tk]; if (!d || !d.data) return;
        d.data.forEach(row => {
            if (!dateMap[row.date]) dateMap[row.date] = {};
            const z = row.flow_zscore || 0;
            dateMap[row.date][tk] = SHORT_TICKERS.includes(tk) ? -z : z;
        });
    });
    state.compositeZ = Object.keys(dateMap).sort().map(date => {
        const vals = dateMap[date], zArr = Object.values(vals);
        if (!zArr.length) return { date, z:0, longZ:0, shortZ:0, count:0 };
        const avg = zArr.reduce((a,b)=>a+b,0)/zArr.length;
        const longs = tickers.filter(t=>!SHORT_TICKERS.includes(t)).map(t=>vals[t]||0);
        const shorts = SHORT_TICKERS.map(t=>vals[t]||0);
        const longZ = longs.reduce((a,b)=>a+b,0)/3;
        const shortZ = shorts.reduce((a,b)=>a+b,0)/3;
        return { date, z: Math.round(avg*1e4)/1e4, longZ: Math.round(longZ*1e4)/1e4, shortZ: Math.round(shortZ*1e4)/1e4, count: zArr.length };
    });
    updateCompZReading();
}

function updateCompZReading() {
    const cz = state.compositeZ; if (!cz || !cz.length) return;
    const last = cz[cz.length-1], z = last.z;
    const c = document.getElementById('comp-z-current'); if (!c) return;
    const isUp = z > 0.15, isDown = z < -0.15;
    const color = isUp ? '#3db87a' : isDown ? '#ef4444' : '#94a3b8';
    const label = isUp ? 'UPWARD PRESSURE' : isDown ? 'DOWNWARD PRESSURE' : 'EQUILIBRIUM';
    const intensity = Math.abs(z)>1.5?'EXTREME':Math.abs(z)>1?'STRONG':Math.abs(z)>0.5?'MODERATE':'MILD';
    c.innerHTML = `<div class="comp-z-dot" style="color:${color};background:${color};"></div><div><div class="comp-z-value" style="color:${color};">${z>=0?'+':''}${z.toFixed(2)}σ</div><div class="comp-z-label" style="color:${color};">${label}</div><div class="comp-z-sublabel">${intensity} · ${last.count} ETFs</div></div><div style="flex:1;"></div><div class="comp-z-date">${fmtDateLong(last.date)}</div>`;
}

function loadNGHistory() {
    const ng = state.summary && state.summary.ng_history;
    if (!ng || !ng.length) return;
    state.ngHistory = {}; state.ngDates = [];
    ng.forEach(d => { state.ngHistory[d.date] = d.close; state.ngDates.push(d.date); });
}

function applyTimeFilter(data) {
    if (state.timeRange === 'all') return data;
    const map = {'1w':7,'1m':30,'3m':90,'6m':180,'1y':365,'2y':730,'3y':1095,'5y':1825};
    const days = map[state.timeRange] || data.length;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-days);
    const cutStr = cutoff.toISOString().split('T')[0];
    return data.filter(d => d.date >= cutStr);
}

function getCompZVisible() {
    const cz = state.compositeZ; if (!cz || !cz.length) return [];
    const base = applyTimeFilter(cz), z = state.zoomCompZ;
    return base.slice(Math.floor(z.start*base.length), Math.ceil(z.end*base.length));
}

function getFlowNGVisible() {
    const cz = state.compositeZ; if (!cz || !cz.length) return { flow:[], ng:[] };
    const base = applyTimeFilter(cz), z = state.zoomFlowNG;
    const flow = base.slice(Math.floor(z.start*base.length), Math.ceil(z.end*base.length));
    const ng = flow.map(f => ({ date:f.date, close: (state.ngHistory && state.ngHistory[f.date]) || null }));
    return { flow, ng };
}

// ---- Composite Z Chart (mirrors drawChartZ exactly) ----
function renderCompZChart() { const d = getCompZVisible(); if (d && d.length >= 2) drawChartCompZ(d); }

function drawChartCompZ(data) {
    const cvs = el('chartCompZ'), {w,h,dpr} = resizeCanvas(cvs), ctx = ctxCompZ;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    const pad = {top:20, right:20, bottom:32, left:45};
    const cw = w-pad.left-pad.right, ch = h-pad.top-pad.bottom;
    if (cw<20||ch<20) return;

    const getX = i => pad.left + (i/(data.length-1))*cw;
    const maxZ = Math.max(3, ...data.map(d => Math.abs(d.z)));
    const getY = val => pad.top + ch/2 - (val/maxZ)*(ch/2);

    // Zone bands
    ctx.fillStyle = 'rgba(61,184,122,0.08)';
    ctx.fillRect(pad.left, pad.top, cw, getY(1.5)-pad.top);
    ctx.fillStyle = 'rgba(239,68,68,0.08)';
    ctx.fillRect(pad.left, getY(-1.5), cw, pad.top+ch-getY(-1.5));

    // Threshold lines
    ctx.lineWidth=1; ctx.setLineDash([4,4]);
    ctx.strokeStyle='rgba(61,184,122,0.45)';
    ctx.beginPath(); ctx.moveTo(pad.left,getY(1.5)); ctx.lineTo(pad.left+cw,getY(1.5)); ctx.stroke();
    ctx.strokeStyle='rgba(239,68,68,0.45)';
    ctx.beginPath(); ctx.moveTo(pad.left,getY(-1.5)); ctx.lineTo(pad.left+cw,getY(-1.5)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle='rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(pad.left,getY(0)); ctx.lineTo(pad.left+cw,getY(0)); ctx.stroke();

    // Zone labels
    ctx.font='bold 11px sans-serif'; ctx.textAlign='right';
    ctx.fillStyle='rgba(61,184,122,0.8)';
    ctx.fillText('▲ UPWARD PRESSURE', pad.left+cw-4, Math.max(pad.top+13,(pad.top+getY(1.5))/2+4));
    ctx.fillStyle='rgba(239,68,68,0.8)';
    ctx.fillText('▼ DOWNWARD PRESSURE', pad.left+cw-4, Math.min(pad.top+ch-3,(getY(-1.5)+pad.top+ch)/2+4));
    ctx.font='9px sans-serif'; ctx.fillStyle='rgba(148,163,184,0.35)';
    ctx.fillText('EQUILIBRIUM', pad.left+cw-4, getY(0)-4);

    // Line with gradient stroke
    ctx.beginPath(); ctx.lineWidth=1.5;
    for (let i=0; i<data.length; i++) {
        const x=getX(i), y=getY(data[i].z);
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    const grad = ctx.createLinearGradient(0,pad.top,0,pad.top+ch);
    grad.addColorStop(0,'rgba(61,184,122,1)');
    grad.addColorStop(0.35,'rgba(0,255,255,0.8)');
    grad.addColorStop(0.5,'rgba(148,163,184,0.6)');
    grad.addColorStop(0.65,'rgba(0,255,255,0.8)');
    grad.addColorStop(1,'rgba(239,68,68,1)');
    ctx.strokeStyle=grad; ctx.stroke();

    // Filled area under/above zero
    ctx.beginPath(); ctx.moveTo(getX(0),getY(0));
    for (let i=0;i<data.length;i++) ctx.lineTo(getX(i),getY(data[i].z));
    ctx.lineTo(getX(data.length-1),getY(0)); ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.fillStyle='rgba(61,184,122,0.12)';
    ctx.fillRect(pad.left,pad.top,cw,getY(0)-pad.top);
    ctx.fillStyle='rgba(239,68,68,0.12)';
    ctx.fillRect(pad.left,getY(0),cw,pad.top+ch-getY(0));
    ctx.restore();

    // Y-axis labels (colored)
    ctx.font='10px monospace'; ctx.textAlign='right';
    ctx.fillStyle='rgba(148,163,184,0.7)'; ctx.fillText('+'+maxZ.toFixed(1), pad.left-5, pad.top+5);
    ctx.fillStyle='rgba(61,184,122,0.9)'; ctx.fillText('+1.5', pad.left-5, getY(1.5)+3);
    ctx.fillStyle='rgba(148,163,184,0.6)'; ctx.fillText('0', pad.left-5, getY(0)+3);
    ctx.fillStyle='rgba(239,68,68,0.9)'; ctx.fillText('-1.5', pad.left-5, getY(-1.5)+3);
    ctx.fillStyle='rgba(148,163,184,0.7)'; ctx.fillText('-'+maxZ.toFixed(1), pad.left-5, pad.top+ch+3);

    // X-axis
    drawXAxis(ctx, data.map(d=>d.date), getX, cw, pad.top+ch+14, pad);

    // Hover crosshair
    if (state.hoverCompZIdx!==null && state.hoverCompZIdx<data.length) {
        const i=state.hoverCompZIdx, x=getX(i), y=getY(data[i].z);
        ctx.beginPath(); ctx.moveTo(x,pad.top); ctx.lineTo(x,pad.top+ch);
        ctx.strokeStyle='rgba(0,255,255,0.22)'; ctx.lineWidth=1; ctx.setLineDash([]); ctx.stroke();
        const zVal=data[i].z;
        const dotC = zVal>=1.5?'#3db87a':(zVal<=-1.5?'#ef4444':'#94a3b8');
        ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2);
        ctx.fillStyle=dotC; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
    }
}

// ---- Flow vs NG Chart (dual-axis overlay) ----
function renderFlowNGChart() { const {flow,ng}=getFlowNGVisible(); if(flow&&flow.length>=2) drawChartFlowNG(flow,ng); }

function drawChartFlowNG(flow, ng) {
    const cvs=el('chartFlowNG'), {w,h,dpr}=resizeCanvas(cvs), ctx=ctxFlowNG;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    const pad={top:20, right:55, bottom:32, left:50};
    const cw=w-pad.left-pad.right, ch=h-pad.top-pad.bottom;
    if(cw<20||ch<20) return;

    const getX = i => pad.left+(i/(flow.length-1))*cw;
    const maxZ = Math.max(3, ...flow.map(d=>Math.abs(d.z)));
    const getYZ = val => pad.top+ch/2-(val/maxZ)*(ch/2);

    const ngVals = ng.map(d=>d.close), validNG = ngVals.filter(v=>v!==null);
    let minNG = validNG.length?Math.min(...validNG):0, maxNG = validNG.length?Math.max(...validNG):10;
    const ngPad=(maxNG-minNG)*0.08; minNG=Math.max(0,minNG-ngPad); maxNG+=ngPad;
    const getYNG = v => pad.top+(1-(v-minNG)/(maxNG-minNG))*ch;

    // Zone bands
    ctx.fillStyle='rgba(61,184,122,0.06)';
    ctx.fillRect(pad.left,pad.top,cw,getYZ(1.5)-pad.top);
    ctx.fillStyle='rgba(239,68,68,0.06)';
    ctx.fillRect(pad.left,getYZ(-1.5),cw,pad.top+ch-getYZ(-1.5));

    // Threshold lines
    ctx.lineWidth=1; ctx.setLineDash([4,4]);
    ctx.strokeStyle='rgba(61,184,122,0.3)';
    ctx.beginPath(); ctx.moveTo(pad.left,getYZ(1.5)); ctx.lineTo(pad.left+cw,getYZ(1.5)); ctx.stroke();
    ctx.strokeStyle='rgba(239,68,68,0.3)';
    ctx.beginPath(); ctx.moveTo(pad.left,getYZ(-1.5)); ctx.lineTo(pad.left+cw,getYZ(-1.5)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle='rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.moveTo(pad.left,getYZ(0)); ctx.lineTo(pad.left+cw,getYZ(0)); ctx.stroke();

    // Z-score filled area
    ctx.beginPath(); ctx.moveTo(getX(0),getYZ(0));
    for(let i=0;i<flow.length;i++) ctx.lineTo(getX(i),getYZ(flow[i].z));
    ctx.lineTo(getX(flow.length-1),getYZ(0)); ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.fillStyle='rgba(61,184,122,0.15)';
    ctx.fillRect(pad.left,pad.top,cw,getYZ(0)-pad.top);
    ctx.fillStyle='rgba(239,68,68,0.15)';
    ctx.fillRect(pad.left,getYZ(0),cw,pad.top+ch-getYZ(0));
    ctx.restore();

    // Z line with gradient
    ctx.beginPath(); ctx.lineWidth=1.2;
    for(let i=0;i<flow.length;i++){const x=getX(i),y=getYZ(flow[i].z);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
    const zGrad=ctx.createLinearGradient(0,pad.top,0,pad.top+ch);
    zGrad.addColorStop(0,'rgba(61,184,122,0.9)'); zGrad.addColorStop(0.5,'rgba(148,163,184,0.5)'); zGrad.addColorStop(1,'rgba(239,68,68,0.9)');
    ctx.strokeStyle=zGrad; ctx.stroke();

    // NG=F price line (bold, distinct color)
    ctx.beginPath(); let started=false;
    for(let i=0;i<ng.length;i++){if(ngVals[i]===null)continue;const x=getX(i),y=getYNG(ngVals[i]);started?ctx.lineTo(x,y):(ctx.moveTo(x,y),started=true);}
    ctx.strokeStyle='rgba(80,200,220,0.85)'; ctx.lineWidth=2; ctx.stroke();

    // Left Y-axis (Z-Score, colored)
    ctx.font='10px monospace'; ctx.textAlign='right';
    ctx.fillStyle='rgba(148,163,184,0.7)'; ctx.fillText('+'+maxZ.toFixed(1),pad.left-5,pad.top+5);
    ctx.fillStyle='rgba(61,184,122,0.9)'; ctx.fillText('+1.5',pad.left-5,getYZ(1.5)+3);
    ctx.fillStyle='rgba(148,163,184,0.6)'; ctx.fillText('0',pad.left-5,getYZ(0)+3);
    ctx.fillStyle='rgba(239,68,68,0.9)'; ctx.fillText('-1.5',pad.left-5,getYZ(-1.5)+3);
    ctx.fillStyle='rgba(148,163,184,0.7)'; ctx.fillText('-'+maxZ.toFixed(1),pad.left-5,pad.top+ch+3);

    // Right Y-axis (NG Price)
    if(validNG.length) {
        ctx.fillStyle='rgba(80,200,220,0.7)'; ctx.textAlign='left'; ctx.font='10px monospace';
        const nticks=[minNG,minNG+(maxNG-minNG)*0.25,minNG+(maxNG-minNG)*0.5,minNG+(maxNG-minNG)*0.75,maxNG];
        nticks.forEach(v=>{const y=getYNG(v);if(y>pad.top-5&&y<pad.top+ch+5)ctx.fillText('$'+v.toFixed(2),pad.left+cw+6,y+3);});
    }

    // X-axis
    drawXAxis(ctx, flow.map(d=>d.date), getX, cw, pad.top+ch+14, pad);

    // Zone labels
    ctx.font='bold 9px sans-serif'; ctx.textAlign='left';
    ctx.fillStyle='rgba(61,184,122,0.5)'; ctx.fillText('▲ PRESSURE',pad.left+4,Math.max(pad.top+11,(pad.top+getYZ(1.5))/2+3));
    ctx.fillStyle='rgba(239,68,68,0.5)'; ctx.fillText('▼ PRESSURE',pad.left+4,Math.min(pad.top+ch-3,(getYZ(-1.5)+pad.top+ch)/2+3));

    // Hover
    if(state.hoverFlowNGIdx!==null&&state.hoverFlowNGIdx<flow.length){
        const i=state.hoverFlowNGIdx,x=getX(i);
        ctx.beginPath();ctx.moveTo(x,pad.top);ctx.lineTo(x,pad.top+ch);
        ctx.strokeStyle='rgba(0,255,255,0.22)';ctx.lineWidth=1;ctx.stroke();
        const yz=getYZ(flow[i].z);
        const dotC=flow[i].z>=1.5?'#3db87a':(flow[i].z<=-1.5?'#ef4444':'#94a3b8');
        ctx.beginPath();ctx.arc(x,yz,5,0,Math.PI*2);ctx.fillStyle=dotC;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
        if(ngVals[i]!==null){const yn=getYNG(ngVals[i]);ctx.beginPath();ctx.arc(x,yn,4,0,Math.PI*2);ctx.fillStyle='rgba(80,200,220,0.9)';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}
    }
}

// ---- Hover Handlers ----
function handleCompZHover(e) {
    const data=getCompZVisible(); if(!data||data.length<2)return;
    const rect=e.target.getBoundingClientRect(),x=e.clientX-rect.left;
    const padL=45,padR=20,cw=rect.width-padL-padR;
    if(x<padL||x>rect.width-padR){hideCompZHover();return;}
    const idx=Math.round(((x-padL)/cw)*(data.length-1));
    if(idx<0||idx>=data.length){hideCompZHover();return;}
    state.hoverCompZIdx=idx; drawChartCompZ(data);
    const d=data[idx],color=d.z>=0?'#3db87a':'#ef4444';
    const tip=document.getElementById('compz-tooltip');
    tip.innerHTML=`<div style="color:var(--cyan);font-size:0.7rem;font-weight:800;margin-bottom:6px;">${fmtDateLong(d.date)}</div><div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:rgba(255,255,255,0.6);font-size:0.62rem;">COMPOSITE Z</span><span style="color:${color};font-weight:800;font-family:'JetBrains Mono',monospace;">${d.z>=0?'+':''}${d.z.toFixed(3)}σ</span></div><div style="display:flex;justify-content:space-between;gap:16px;margin-top:3px;"><span style="color:rgba(255,255,255,0.5);font-size:0.58rem;">LONG SIDE</span><span style="color:#F5C542;font-size:0.68rem;font-weight:700;">${d.longZ>=0?'+':''}${d.longZ.toFixed(3)}</span></div><div style="display:flex;justify-content:space-between;gap:16px;margin-top:2px;"><span style="color:rgba(255,255,255,0.5);font-size:0.58rem;">SHORT SIDE</span><span style="color:#4A9CF5;font-size:0.68rem;font-weight:700;">${d.shortZ>=0?'+':''}${d.shortZ.toFixed(3)}</span></div>`;
    tip.style.display='block';
    tip.style.left=Math.min(rect.width-200,Math.max(10,x-90))+'px'; tip.style.top='10px';
}
function hideCompZHover(){state.hoverCompZIdx=null;const t=document.getElementById('compz-tooltip');if(t)t.style.display='none';renderCompZChart();}

function handleFlowNGHover(e) {
    const {flow,ng}=getFlowNGVisible(); if(!flow||flow.length<2)return;
    const rect=e.target.getBoundingClientRect(),x=e.clientX-rect.left;
    const padL=50,padR=55,cw=rect.width-padL-padR;
    if(x<padL||x>rect.width-padR){hideFlowNGHover();return;}
    const idx=Math.round(((x-padL)/cw)*(flow.length-1));
    if(idx<0||idx>=flow.length){hideFlowNGHover();return;}
    state.hoverFlowNGIdx=idx; drawChartFlowNG(flow,ng);
    const d=flow[idx],ngClose=ng[idx]?ng[idx].close:null,color=d.z>=0?'#3db87a':'#ef4444';
    const tip=document.getElementById('flowng-tooltip');
    tip.innerHTML=`<div style="color:var(--cyan);font-size:0.7rem;font-weight:800;margin-bottom:6px;">${fmtDateLong(d.date)}</div><div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:rgba(255,255,255,0.6);font-size:0.62rem;">FLOW PRESSURE</span><span style="color:${color};font-weight:800;font-family:'JetBrains Mono',monospace;">${d.z>=0?'+':''}${d.z.toFixed(3)}σ</span></div><div style="display:flex;justify-content:space-between;gap:16px;margin-top:3px;"><span style="color:rgba(255,255,255,0.6);font-size:0.62rem;">NG=F PRICE</span><span style="color:rgba(80,200,220,0.9);font-weight:800;font-family:'JetBrains Mono',monospace;">${ngClose!==null?'$'+ngClose.toFixed(3):'N/A'}</span></div>`;
    tip.style.display='block';
    tip.style.left=Math.min(rect.width-220,Math.max(10,x-100))+'px'; tip.style.top='10px';
}
function hideFlowNGHover(){state.hoverFlowNGIdx=null;const t=document.getElementById('flowng-tooltip');if(t)t.style.display='none';renderFlowNGChart();}

// ---- Range Sliders ----
function initCompZSlider(){const s=document.getElementById('compz-range-start'),e=document.getElementById('compz-range-end');if(!s||!e)return;function f(){let a=parseInt(s.value)/1000,b=parseInt(e.value)/1000;if(a>b-0.02){a=b-0.02;s.value=Math.round(a*1000);}state.zoomCompZ={start:a,end:b};renderCompZChart();syncCompZSlider();}s.addEventListener('input',f);e.addEventListener('input',f);}
function syncCompZSlider(){const s=document.getElementById('compz-range-start'),e=document.getElementById('compz-range-end'),h=document.getElementById('compz-range-highlight'),l=document.getElementById('compz-range-label');if(!s||!e)return;s.value=Math.round(state.zoomCompZ.start*1000);e.value=Math.round(state.zoomCompZ.end*1000);if(h){h.style.left=(state.zoomCompZ.start*100)+'%';h.style.width=((state.zoomCompZ.end-state.zoomCompZ.start)*100)+'%';}if(l){const z=state.zoomCompZ.start>0.001||state.zoomCompZ.end<0.999;l.textContent=z?'CUSTOM SELECTION':'PRESET: '+state.timeRange.toUpperCase();}}
function initFlowNGSlider(){const s=document.getElementById('flowng-range-start'),e=document.getElementById('flowng-range-end');if(!s||!e)return;function f(){let a=parseInt(s.value)/1000,b=parseInt(e.value)/1000;if(a>b-0.02){a=b-0.02;s.value=Math.round(a*1000);}state.zoomFlowNG={start:a,end:b};renderFlowNGChart();syncFlowNGSlider();}s.addEventListener('input',f);e.addEventListener('input',f);}
function syncFlowNGSlider(){const s=document.getElementById('flowng-range-start'),e=document.getElementById('flowng-range-end'),h=document.getElementById('flowng-range-highlight'),l=document.getElementById('flowng-range-label');if(!s||!e)return;s.value=Math.round(state.zoomFlowNG.start*1000);e.value=Math.round(state.zoomFlowNG.end*1000);if(h){h.style.left=(state.zoomFlowNG.start*100)+'%';h.style.width=((state.zoomFlowNG.end-state.zoomFlowNG.start)*100)+'%';}if(l){const z=state.zoomFlowNG.start>0.001||state.zoomFlowNG.end<0.999;l.textContent=z?'CUSTOM SELECTION':'PRESET: '+state.timeRange.toUpperCase();}}
