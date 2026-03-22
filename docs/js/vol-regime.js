/* ============================================================
   Vol Regime Monitor
   Displays 5D / 21D / 63D / 252D historical volatility for
   all 6 ETFs + NG=F front-month futures.

   Selector modes:
     1-UP  — one instrument at a time (7 chips)
     PAIR  — long vs short side-by-side (3 pair chips)
   ============================================================ */

const VolRegime = {

    // ── State ──────────────────────────────────────────────
    mode: '1up',          // '1up' | 'pair'
    selected: 'BOIL',    // active ticker in 1-up mode
    selectedPair: 0,     // active pair index (0-2) in pair mode
    _allMetrics: null,
    _ngVolMetrics: null,
    _rangeState: {},      // ticker -> { start: 0, end: 100 } for range slider

    // ── Config ─────────────────────────────────────────────
    _instruments: ['NG=F', 'BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L'],

    _pairs: [
        { long: 'BOIL',   short: 'KOLD',   label: 'BOIL ↔ KOLD',   sub: 'NYSE · 2×' },
        { long: 'HNU.TO', short: 'HND.TO', label: 'HNU ↔ HND',     sub: 'TSX · 2×'  },
        { long: '3NGL.L', short: '3NGS.L', label: '3NGL ↔ 3NGS',   sub: 'LSE · 3×'  },
    ],

    _hvWindows: [
        { key: '5d',   label: '5D HV',   tooltip: 'Ultra-short spike detector — catches weather events & storage shocks in leveraged NG products before the 21D window registers' },
        { key: '21d',  label: '21D HV',  tooltip: 'Monthly realized HV — standard baseline for leveraged ETF sizing and risk' },
        { key: '63d',  label: '63D HV',  tooltip: 'Seasonal-quarter HV — aligns with NG injection/withdrawal cycles (~3 months)' },
        { key: '252d', label: '252D HV', tooltip: 'Full annual HV — complete NG seasonal cycle reference and long-run baseline' },
    ],

    // Regime buckets: percentile of current HV vs all available history
    _regime(pct) {
        if (pct == null) return { label: '--',       cls: 'vrm-reg-unknown',  color: 'var(--text-muted)' };
        if (pct >= 90)   return { label: 'SPIKE',    cls: 'vrm-reg-spike',    color: '#c04040' };
        if (pct >= 75)   return { label: 'ELEVATED', cls: 'vrm-reg-elevated', color: '#c07828' };
        if (pct >= 25)   return { label: 'NORMAL',   cls: 'vrm-reg-normal',   color: '#3db87a' };
        return                   { label: 'LOW',      cls: 'vrm-reg-low',      color: '#4a80b8' };
    },

    // ── Public API ─────────────────────────────────────────
    render(allMetrics, ngVolMetrics) {
        this._allMetrics   = allMetrics;
        this._ngVolMetrics = ngVolMetrics;

        this._buildSelector();
        this._renderContent();
    },

    // ── Selector ───────────────────────────────────────────
    _buildSelector() {
        const sel = document.getElementById('vrm-selector');
        if (!sel) return;

        const is1up  = this.mode === '1up';
        const isPair = this.mode === 'pair';

        sel.innerHTML = `
            <div class="vrm-controls">
                <div class="vrm-mode-toggle">
                    <button class="vrm-mode-btn${is1up  ? ' active' : ''}"
                            onclick="VolRegime._setMode('1up')">1-UP</button>
                    <button class="vrm-mode-btn${isPair ? ' active' : ''}"
                            onclick="VolRegime._setMode('pair')">PAIR</button>
                </div>
                <div class="vrm-chips">
                    ${is1up ? this._chips1Up() : this._chipsPair()}
                </div>
            </div>`;
    },

    _chips1Up() {
        return this._instruments.map(ticker => {
            const cfg  = CONFIG.etfs[ticker];
            const side = cfg?.side || 'ng';
            const isActive = ticker === this.selected;
            const disp = ticker.replace('.TO', '').replace('.L', '');
            return `<button
                class="vrm-chip vrm-chip-${side}${isActive ? ' vrm-chip-active' : ''}"
                onclick="VolRegime._pick1Up('${ticker}')"
                data-tooltip="${cfg ? cfg.name + ' · ' + cfg.leverage + ' · ' + cfg.exchange : 'NYMEX Front-Month Natural Gas Futures'}"
                >${disp}</button>`;
        }).join('');
    },

    _chipsPair() {
        return this._pairs.map((p, idx) => {
            const isActive = idx === this.selectedPair;
            return `<button
                class="vrm-chip vrm-chip-pair${isActive ? ' vrm-chip-active' : ''}"
                onclick="VolRegime._pickPair(${idx})">
                <span class="vrm-chip-long">${p.long.replace('.TO','').replace('.L','')}</span>
                <span class="vrm-chip-arrow">↔</span>
                <span class="vrm-chip-short">${p.short.replace('.TO','').replace('.L','')}</span>
                <span class="vrm-chip-sub">${p.sub}</span>
            </button>`;
        }).join('');
    },

    // ── Mode / selection state changes ─────────────────────
    _setMode(mode) {
        this.mode = mode;
        this._buildSelector();
        this._renderContent();
    },

    _pick1Up(ticker) {
        if (this.selected !== ticker) delete this._rangeState[ticker];
        this.selected = ticker;
        this._buildSelector();
        this._renderContent();
    },

    _pickPair(idx) {
        if (this.selectedPair !== idx) {
            const p = this._pairs[idx];
            delete this._rangeState[p.long];
            delete this._rangeState[p.short];
        }
        this.selectedPair = idx;
        this._buildSelector();
        this._renderContent();
    },

    // ── Content dispatch ───────────────────────────────────
    _renderContent() {
        const el = document.getElementById('vrm-content');
        if (!el) return;

        if (this.mode === '1up') {
            const m = this.selected === 'NG=F'
                ? this._ngVolMetrics
                : this._allMetrics?.[this.selected];
            el.innerHTML = `<div class="vrm-single">${this._card(this.selected, m)}</div>`;
        } else {
            const p = this._pairs[this.selectedPair];
            const lm = this._allMetrics?.[p.long];
            const sm = this._allMetrics?.[p.short];
            el.innerHTML = `
                <div class="vrm-pair-layout">
                    <div class="vrm-pair-col vrm-col-long">${this._card(p.long,  lm, 'long')}</div>
                    <div class="vrm-pair-divider">
                        <div class="vrm-vs-badge">VS</div>
                        ${this._pairStats(lm, sm)}
                    </div>
                    <div class="vrm-pair-col vrm-col-short">${this._card(p.short, sm, 'short')}</div>
                </div>`;
        }

        // Draw sparklines + init range sliders after DOM settles
        requestAnimationFrame(() => { this._drawAll(); this._initRangeSliders(); });
    },

    // ── Pair divider stats ─────────────────────────────────
    _pairStats(lm, sm) {
        if (!lm || !sm) return '';
        const lv = lm.volatility?.hv?.['21d'];
        const sv = sm.volatility?.hv?.['21d'];
        if (lv == null || sv == null) return '';
        const spread  = Math.abs(lv - sv);
        const anomaly = spread > 5;
        const color   = anomaly ? 'var(--orange)' : 'var(--text-dim)';
        return `
            <div class="vrm-pair-spread">
                <div class="vrm-spread-key">21D ΔHV</div>
                <div class="vrm-spread-val" style="color:${color}">${spread.toFixed(1)}%</div>
                ${anomaly ? '<div class="vrm-spread-note">anomaly</div>' : ''}
            </div>`;
    },

    // ── Single instrument card ─────────────────────────────
    _card(ticker, m, sideOverride) {
        if (!m) return `
            <div class="vrm-card vrm-card-empty">
                <div class="vrm-card-hdr">
                    <span class="vrm-ticker">${ticker}</span>
                </div>
                <div class="vrm-no-data">No data — loading…</div>
            </div>`;

        const cfg      = CONFIG.etfs[ticker];
        const isNG     = ticker === 'NG=F';
        const side     = sideOverride || cfg?.side || 'ng';
        const lev      = cfg?.leverage;
        const levMult  = lev === '3x' ? 3 : lev === '2x' ? 2 : 1;
        const exch     = isNG ? 'NYMEX' : cfg?.exchange;

        const vol      = m.volatility || {};
        const hv       = vol.hv       || {};
        const hvPcts   = vol.hvPercentiles || {};
        const vov      = vol.vov21;

        // Primary regime badge uses 21D HV percentile
        const regBadge = this._regime(hvPcts['21d']);

        // Spike event: 5D HV > 2× 252D HV (near-term vol has broken from annual baseline)
        const spikeEvt = hv['5d'] != null && hv['252d'] != null && hv['5d'] > 2 * hv['252d'];

        // Term structure: 5D / 63D
        const ts       = (hv['5d'] != null && hv['63d'] != null && hv['63d'] > 0)
                         ? hv['5d'] / hv['63d'] : null;
        const tsInfo   = this._tsLabel(ts);

        // Effective ETF vol
        const effVol   = (!isNG && hv['21d'] != null) ? (hv['21d'] * levMult) : null;

        // VoV state
        const vovInfo  = this._vovLabel(vov);

        const tickerColor = side === 'long' ? 'var(--green)'
                          : side === 'short' ? 'var(--red)' : 'var(--blue)';

        const canvasId = 'vrm-spark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');

        // HV stat boxes
        const boxes = this._hvWindows.map(w => {
            const val = hv[w.key];
            const pct = hvPcts[w.key];
            const reg = this._regime(pct);
            return `
                <div class="vrm-hv-box" data-tooltip="${w.tooltip}${pct != null ? ' — currently ' + pct.toFixed(0) + 'th pct of full available history' : ''}">
                    <div class="vrm-hv-label">${w.label}</div>
                    <div class="vrm-hv-val" style="color:${reg.color}">
                        ${val != null ? val.toFixed(1) + '%' : '--'}
                    </div>
                    <div class="vrm-hv-regime-pip ${reg.cls}" data-tooltip="${reg.label}"></div>
                </div>`;
        }).join('');

        return `
            <div class="vrm-card vrm-card-${side}">

                <div class="vrm-card-hdr">
                    <span class="vrm-ticker" style="color:${tickerColor}">${ticker}</span>
                    ${lev   ? `<span class="vrm-badge-lev">${lev}</span>` : ''}
                    ${exch  ? `<span class="vrm-badge-exch">${exch}</span>` : ''}
                    <span class="vrm-regime-badge ${regBadge.cls}"
                          data-tooltip="Vol regime: 21D HV sits at the ${hvPcts['21d'] != null ? hvPcts['21d'].toFixed(0)+'th' : '--'} percentile of all available history">
                        ${regBadge.label}
                    </span>
                    ${spikeEvt ? `<span class="vrm-spike-badge"
                        data-tooltip="SPIKE EVENT — 5D HV (${hv['5d'].toFixed(1)}%) exceeds 2× the 252D baseline (${hv['252d'].toFixed(1)}%). Near-term vol has broken from the annual norm.">⚡ SPIKE EVENT</span>` : ''}
                </div>

                <div class="vrm-hv-boxes">${boxes}</div>

                <div class="vrm-spark-wrap">
                    <div class="vrm-spark-label">Rolling 21D HV
                        <span class="vrm-spark-legend">
                            <span class="vrm-leg-dot vrm-reg-low"></span>Low
                            <span class="vrm-leg-dot vrm-reg-normal"></span>Normal
                            <span class="vrm-leg-dot vrm-reg-elevated"></span>Elevated
                            <span class="vrm-leg-dot vrm-reg-spike"></span>Spike
                        </span>
                    </div>
                    <canvas class="vrm-spark-canvas" id="${canvasId}"></canvas>
                    <div class="range-slider-container" style="margin:8px 0 0;">
                        <div class="range-slider-wrap">
                            <div class="range-inputs">
                                <div class="range-slider-track"></div>
                                <div id="vrm-hl-${canvasId}" class="range-slider-highlight"></div>
                                <input type="range" id="vrm-rs-s-${canvasId}" min="0" max="100" value="${(this._rangeState[ticker]||{}).start||0}">
                                <input type="range" id="vrm-rs-e-${canvasId}" min="0" max="100" value="${(this._rangeState[ticker]||{}).end||100}">
                            </div>
                        </div>
                        <div class="range-labels" style="justify-content:center;">
                            <span id="vrm-rl-${canvasId}" style="color:var(--text-bright);text-transform:uppercase;letter-spacing:2px;">ALL HISTORY</span>
                        </div>
                    </div>
                </div>

                <div class="vrm-footer-stats">
                    <div class="vrm-stat-box" data-tooltip="5D/63D HV ratio — when >1.35× near-term vol is accelerating faster than the seasonal trend. Key risk signal for leveraged NG products.">
                        <span class="vrm-stat-lbl">TERM STRUCT</span>
                        <span class="vrm-stat-val ${tsInfo.cls}">${tsInfo.label}&nbsp;${tsInfo.arrow}</span>
                    </div>
                    <div class="vrm-stat-box" data-tooltip="Vol-of-Vol (21-day std of rolling HV-10). High VoV means vol itself is volatile — a regime shift is likely imminent.">
                        <span class="vrm-stat-lbl">VoV-21</span>
                        <span class="vrm-stat-val ${vovInfo.cls}">${vov != null ? vov.toFixed(1) + '%' : '--'}&nbsp;${vovInfo.label}</span>
                    </div>
                    ${effVol != null ? `
                    <div class="vrm-stat-box" data-tooltip="Effective ETF vol = HV-21 × ${levMult}× leverage. This is the realistic annual swing band for this product — what you are actually exposed to.">
                        <span class="vrm-stat-lbl">EFF VOL ${levMult}×</span>
                        <span class="vrm-stat-val vrm-eff-vol">${effVol.toFixed(1)}%</span>
                    </div>` : ''}
                </div>

            </div>`;
    },

    // ── Build metrics from raw dashboard_data.json ─────────
    buildMetricsFromDashboard(data) {
        const allMetrics = {};
        for (const [ticker, etfData] of Object.entries(data.etfs || {})) {
            if (!etfData) continue;
            const history = etfData.history || [];
            const histCloses = history.map(h => h.close ?? h[1]).filter(v => v != null);
            const histDates  = history.map(h => h.date  ?? h[0]);
            const vol = etfData.volatility || {};
            const hvSeries21 = vol.hv_series21 || vol.hvSeries21
                || (histCloses.length >= 22 ? Metrics.computeHVSeries(histCloses, 21, histCloses.length) : []);
            // Dates aligned to HV series: hvSeries21[j] corresponds to histDates[21 + j]
            const hvDates21 = histDates.slice(21, 21 + hvSeries21.length);
            const hvPercentiles = vol.hv_percentiles || vol.hvPercentiles || {
                '5d':   histCloses.length >= 6   ? Metrics.computeHVPercentile(histCloses, 5)   : null,
                '21d':  histCloses.length >= 22  ? Metrics.computeHVPercentile(histCloses, 21)  : null,
                '63d':  histCloses.length >= 64  ? Metrics.computeHVPercentile(histCloses, 63)  : null,
                '252d': histCloses.length >= 253 ? Metrics.computeHVPercentile(histCloses, 252) : null,
            };
            const hv5d = histCloses.length >= 6 ? Metrics.computeHV(histCloses, 5) : null;
            const hv = { '5d': hv5d, ...(vol.hv || {}) };
            allMetrics[ticker] = {
                ticker,
                volatility: {
                    hv,
                    hvPercentiles,
                    hvSeries21,
                    hvDates21,
                    hvTermStructure: vol.hv_term_structure ?? vol.hvTermStructure ?? null,
                    vov21:       vol.vov21       ?? null,
                    volRegimePct: vol.vol_regime_pct ?? vol.volRegimePct ?? null,
                    atr14Pct:    vol.atr14_pct   ?? vol.atr14Pct        ?? null,
                },
            };
        }
        return allMetrics;
    },

    // Build metrics from live {dates, closes, volumes} format (trough-peak style)
    buildMetricsFromLive(ticker, liveData) {
        if (!liveData || !liveData.closes || liveData.closes.length < 22) return null;
        const closes = liveData.closes;
        const dates  = liveData.dates || [];
        const hvSeries21 = Metrics.computeHVSeries(closes, 21, closes.length);
        const hvDates21  = dates.slice(21, 21 + hvSeries21.length);
        return {
            ticker,
            volatility: {
                hv: {
                    '5d':  Metrics.computeHV(closes, 5),
                    '10d': Metrics.computeHV(closes, 10),
                    '21d': Metrics.computeHV(closes, 21),
                    '63d': Metrics.computeHV(closes, 63),
                    '252d': Metrics.computeHV(closes, 252),
                },
                hvPercentiles: {
                    '5d':   Metrics.computeHVPercentile(closes, 5),
                    '21d':  Metrics.computeHVPercentile(closes, 21),
                    '63d':  Metrics.computeHVPercentile(closes, 63),
                    '252d': Metrics.computeHVPercentile(closes, 252),
                },
                hvSeries21,
                hvDates21,
                hvTermStructure: Metrics.computeHVTermStructure(closes),
                vov21: Metrics.computeVoV21(closes),
            },
        };
    },

    // ── Range slider init ──────────────────────────────────
    _initRangeSliders() {
        const tickers = this.mode === '1up'
            ? [this.selected]
            : [this._pairs[this.selectedPair].long, this._pairs[this.selectedPair].short];
        for (const ticker of tickers) {
            const m = ticker === 'NG=F' ? this._ngVolMetrics : this._allMetrics?.[ticker];
            if (!m) continue;
            const cid    = 'vrm-spark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');
            const sStart = document.getElementById('vrm-rs-s-' + cid);
            const sEnd   = document.getElementById('vrm-rs-e-' + cid);
            const hl     = document.getElementById('vrm-hl-'   + cid);
            const lbl    = document.getElementById('vrm-rl-'   + cid);
            if (!sStart || !sEnd) continue;

            const updateHL = () => {
                if (!hl) return;
                const v1 = parseInt(sStart.value), v2 = parseInt(sEnd.value);
                const p1 = v1 / 100, p2 = v2 / 100;
                hl.style.left  = `calc(${p1 * 100}% + ${(10 - p1 * 20)}px)`;
                hl.style.width = `calc(${(p2 - p1) * 100}% + ${(p1 - p2) * 20}px)`;
            };

            const onChange = (e) => {
                let v1 = parseInt(sStart.value), v2 = parseInt(sEnd.value);
                if (v1 >= v2) {
                    if (e.target === sStart) sStart.value = Math.max(0, v2 - 1);
                    else                     sEnd.value   = Math.min(100, v1 + 1);
                    v1 = parseInt(sStart.value); v2 = parseInt(sEnd.value);
                }
                this._rangeState[ticker] = { start: v1, end: v2 };
                if (lbl) lbl.textContent = (v1 === 0 && v2 === 100) ? 'ALL HISTORY' : 'CUSTOM';
                updateHL();
                this._drawSparkline(ticker, m);
            };

            sStart.addEventListener('input', onChange);
            sEnd.addEventListener('input', onChange);
            updateHL();
        }
    },

    // ── Sparkline drawing ──────────────────────────────────
    _drawAll() {
        if (this.mode === '1up') {
            const m = this.selected === 'NG=F' ? this._ngVolMetrics : this._allMetrics?.[this.selected];
            this._drawSparkline(this.selected, m);
        } else {
            const p = this._pairs[this.selectedPair];
            this._drawSparkline(p.long,  this._allMetrics?.[p.long]);
            this._drawSparkline(p.short, this._allMetrics?.[p.short]);
        }
    },

    _drawSparkline(ticker, m) {
        const cid = 'vrm-spark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');
        const cvs = document.getElementById(cid);
        if (!cvs) return;

        const fullSeries = m?.volatility?.hvSeries21 || [];

        // DPR-aware canvas (matches trough-peak chart)
        const dpr  = window.devicePixelRatio || 1;
        const rect = cvs.getBoundingClientRect();
        const cssW = rect.width  || cvs.parentElement?.clientWidth || 400;
        const cssH = rect.height || 200;
        cvs.width  = Math.round(cssW * dpr);
        cvs.height = Math.round(cssH * dpr);
        const ctx  = cvs.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);

        if (fullSeries.length < 5) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.font      = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Insufficient history', cssW / 2, cssH / 2 + 4);
            return;
        }

        // ── Range slice ──────────────────────────────────────
        const rs  = this._rangeState[ticker] || { start: 0, end: 100 };
        const si  = Math.floor(rs.start / 100 * fullSeries.length);
        const ei  = Math.max(si + 2, Math.ceil(rs.end / 100 * fullSeries.length));
        const series = fullSeries.slice(si, ei);
        const atEnd  = rs.end >= 99;

        // Percentile thresholds from FULL series (stable while panning)
        const sorted = [...fullSeries].sort((a, b) => a - b);
        const pctFn  = f => sorted[Math.max(0, Math.floor(sorted.length * f) - 1)];
        const p25 = pctFn(0.25), p75 = pctFn(0.75), p90 = pctFn(0.90);

        const pad = { top: 20, right: 54, bottom: 28, left: 10 };
        const cW  = cssW - pad.left - pad.right;
        const cH  = cssH - pad.top  - pad.bottom;

        const rawMin = Math.min(...series), rawMax = Math.max(...series);
        const vMin = rawMin * 0.90, vMax = rawMax * 1.06;
        const vRange = vMax - vMin || 1;

        const toY = v => pad.top + cH - ((v - vMin) / vRange) * cH;
        const toX = i => pad.left + (i / Math.max(series.length - 1, 1)) * cW;
        const toRgba = (hex, a) => {
            const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
            return `rgba(${r},${g},${b},${a})`;
        };

        // ── Y-axis grid + right-side labels ──────────────────
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 0.8;
        const yTicks = [p25, p75, p90].filter(v => v > vMin && v < vMax);
        for (const tick of yTicks) {
            const y = toY(tick);
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y);
            ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = '9px monospace'; ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        for (const tick of yTicks) ctx.fillText(tick.toFixed(0) + '%', pad.left + cW + 5, toY(tick) + 3.5);

        // ── Background regime zones ──────────────────────────
        const zones = [
            { lo: p90,  hi: vMax, color: 'rgba(192,64,64,0.14)'  },
            { lo: p75,  hi: p90,  color: 'rgba(192,120,40,0.12)' },
            { lo: p25,  hi: p75,  color: 'rgba(61,184,122,0.09)' },
            { lo: vMin, hi: p25,  color: 'rgba(74,128,184,0.12)' },
        ];
        for (const z of zones) {
            const y1 = toY(Math.min(z.hi, vMax)), y2 = toY(Math.max(z.lo, vMin));
            if (y2 > y1) { ctx.fillStyle = z.color; ctx.fillRect(pad.left, y1, cW, y2 - y1); }
        }

        // ── Area fill (gradient under line, like trough-peak) ─
        const lastV    = series[series.length - 1];
        const regColor = lastV >= p90 ? '#c04040' : lastV >= p75 ? '#c07828' : lastV >= p25 ? '#3db87a' : '#4a80b8';
        const aGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
        aGrad.addColorStop(0, toRgba(regColor, 0.22));
        aGrad.addColorStop(1, toRgba(regColor, 0.01));
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(series[0]));
        for (let i = 1; i < series.length; i++) ctx.lineTo(toX(i), toY(series[i]));
        ctx.lineTo(toX(series.length - 1), pad.top + cH);
        ctx.lineTo(toX(0), pad.top + cH);
        ctx.closePath();
        ctx.fillStyle = aGrad; ctx.fill();

        // ── Threshold dashes ─────────────────────────────────
        ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
        for (const [val, col] of [[p25,'rgba(74,128,184,0.45)'],[p75,'rgba(61,184,122,0.45)'],[p90,'rgba(192,64,64,0.45)']]) {
            const y = toY(val);
            if (y >= pad.top && y <= pad.top + cH) {
                ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y);
                ctx.strokeStyle = col; ctx.stroke();
            }
        }
        ctx.setLineDash([]);

        // ── HV line — colour-segmented ────────────────────────
        ctx.lineWidth = 2;
        for (let i = 1; i < series.length; i++) {
            const v = series[i];
            ctx.strokeStyle = v >= p90 ? '#c04040' : v >= p75 ? '#c07828' : v >= p25 ? '#3db87a' : '#4a80b8';
            ctx.beginPath();
            ctx.moveTo(toX(i - 1), toY(series[i - 1]));
            ctx.lineTo(toX(i),     toY(v));
            ctx.stroke();
        }

        // ── Current value dot + pulse ring (when viewing latest) ─
        if (atEnd && series.length > 0) {
            const lX = toX(series.length - 1), lY = toY(lastV);
            const dc = lastV >= p90 ? '#c04040' : lastV >= p75 ? '#c07828' : lastV >= p25 ? '#3db87a' : '#4a80b8';
            ctx.beginPath(); ctx.arc(lX, lY, 6.5, 0, Math.PI * 2);
            ctx.strokeStyle = toRgba(dc, 0.35); ctx.lineWidth = 1.5; ctx.stroke();
            ctx.beginPath(); ctx.arc(lX, lY, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = dc; ctx.fill();
            ctx.beginPath(); ctx.arc(lX, lY, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.font = 'bold 9px monospace'; ctx.fillStyle = dc; ctx.textAlign = 'right';
            ctx.fillText(lastV.toFixed(1) + '%', lX - 10, lY - 4);
        }

        // ── X-axis date labels (matches Price & Cycle Map logic) ─
        const fullDates = m?.volatility?.hvDates21 || [];
        const viewDates = fullDates.slice(si, ei);
        const count = viewDates.length;
        ctx.font = '9px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'center';

        if (count >= 2) {
            const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const monthsRange = (new Date(viewDates[count-1]) - new Date(viewDates[0])) / (30*24*3600*1000);
            const spansYears = new Date(viewDates[0]).getFullYear() !== new Date(viewDates[count-1]).getFullYear();
            let ticks = [];

            if (monthsRange > 36) {
                // Year-boundary mode: clean year numbers at Jan 1
                const maxLabels = Math.floor(cW / 120);
                const yearsRange = monthsRange / 12;
                let yearInt = Math.max(1, Math.round(yearsRange / maxLabels));
                const common = [1, 2, 3, 5, 10, 20];
                yearInt = common.find(c => c >= yearInt) || yearInt;
                const startY = new Date(viewDates[0]).getFullYear();
                const endY   = new Date(viewDates[count-1]).getFullYear();
                const firstY = Math.ceil(startY / yearInt) * yearInt;
                for (let yr = firstY; yr <= endY; yr += yearInt) {
                    const target = `${yr}-01-01`;
                    for (let i = 0; i < count; i++) {
                        if (viewDates[i] >= target) { ticks.push({ i, label: String(yr) }); break; }
                    }
                }
            } else {
                // Month-boundary mode
                const maxLabels = Math.floor(cW / 100);
                let monthInt = Math.max(1, Math.round(monthsRange / maxLabels));
                const common = [1, 2, 3, 4, 6, 12];
                monthInt = common.find(c => c >= monthInt) || monthInt;
                let lastTotal = -1, lastLogged = -1;
                viewDates.forEach((d, i) => {
                    const [y, mo] = d.split('-').map(Number);
                    const total = y * 12 + mo;
                    if (total !== lastTotal) {
                        if (lastLogged === -1 || (total - lastLogged) >= monthInt) {
                            const lbl = MONTHS[mo-1] + (spansYears ? ' ' + y : '');
                            ticks.push({ i, label: lbl });
                            lastLogged = total;
                        }
                        lastTotal = total;
                    }
                });
            }

            // Draw with collision avoidance
            let lastX = -999;
            for (const t of ticks) {
                const x = toX(t.i);
                if (x - lastX < 45) continue;
                ctx.fillText(t.label, x, pad.top + cH + 16);
                // Subtle tick mark
                ctx.beginPath(); ctx.moveTo(x, pad.top + cH); ctx.lineTo(x, pad.top + cH + 4);
                ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();
                lastX = x;
            }
        }
    },

    // ── Label helpers ──────────────────────────────────────
    _tsLabel(ratio) {
        if (ratio == null)  return { label: '--',                   arrow: '',   cls: 'ts-neutral' };
        if (ratio >= 1.5)   return { label: ratio.toFixed(2) + 'x', arrow: '↑↑', cls: 'ts-accel'   };
        if (ratio >= 1.15)  return { label: ratio.toFixed(2) + 'x', arrow: '↑',  cls: 'ts-building' };
        if (ratio >= 0.85)  return { label: ratio.toFixed(2) + 'x', arrow: '→',  cls: 'ts-neutral'  };
        if (ratio >= 0.65)  return { label: ratio.toFixed(2) + 'x', arrow: '↓',  cls: 'ts-easing'   };
        return                     { label: ratio.toFixed(2) + 'x', arrow: '↓↓', cls: 'ts-calm'     };
    },

    _vovLabel(vov) {
        if (vov == null) return { label: '--',        cls: ''          };
        if (vov >= 20)   return { label: 'UNSTABLE',  cls: 'vov-high'  };
        if (vov >= 12)   return { label: 'SHIFTING',  cls: 'vov-mid'   };
        if (vov >= 6)    return { label: 'MODERATE',  cls: 'vov-mod'   };
        return                   { label: 'STABLE',   cls: 'vov-low'   };
    },
};
