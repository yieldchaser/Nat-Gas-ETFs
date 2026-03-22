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
    _hoverState: {},      // ticker -> hovered series index (null = no hover)
    _dragState:  {},      // ticker -> { active, startIdx, currentIdx }
    _horizonState: {},    // ticker -> active horizon key ('all','1y','6m','3m','1m','1w')
    _activeSeries: {},    // ticker -> array of active HV keys e.g. ['21d', '63d']

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

    _toggleSeries(ticker, key) {
        if (!this._activeSeries[ticker]) this._activeSeries[ticker] = ['21d'];
        const active = this._activeSeries[ticker];
        if (active.includes(key)) {
            if (active.length > 1) { // Ensure at least one is selected
                this._activeSeries[ticker] = active.filter(k => k !== key);
            }
        } else {
            this._activeSeries[ticker].push(key);
        }
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

        // Draw sparklines + init range sliders + hover after DOM settles
        requestAnimationFrame(() => { this._drawAll(); this._initRangeSliders(); this._initHover(); });
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
        const activeKeys = this._activeSeries[ticker] || ['21d'];
        const boxes = this._hvWindows.map(w => {
            const val = hv[w.key];
            const pct = hvPcts[w.key];
            const reg = this._regime(pct);
            const isActive = activeKeys.includes(w.key);
            const activeClass = isActive ? ' active' : '';
            return `
                <div class="vrm-hv-box${activeClass}" onclick="VolRegime._toggleSeries('${ticker}', '${w.key}')" data-tooltip="${w.tooltip}${pct != null ? ' — currently ' + pct.toFixed(0) + 'th pct of full available history' : ''}" style="cursor:pointer">
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
                    <div class="vrm-spark-label-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <div class="vrm-spark-label" style="margin-bottom:0;">Rolling HV
                            <span class="vrm-spark-legend">
                                <span class="vrm-leg-dot vrm-reg-low"></span>Low
                                <span class="vrm-leg-dot vrm-reg-normal"></span>Normal
                                <span class="vrm-leg-dot vrm-reg-elevated"></span>Elevated
                                <span class="vrm-leg-dot vrm-reg-spike"></span>Spike
                            </span>
                        </div>
                        <div class="vrm-horizon-group" id="vrm-hg-${canvasId}">
                            ${['1W','1M','3M','6M','1Y','ALL'].map(r => {
                                const active = (this._horizonState[ticker] || 'ALL') === r;
                                return `<button class="vrm-horizon-btn${active?' active':''}" data-range="${r}" onclick="VolRegime._setHorizon('${ticker}','${r}')">${r}</button>`;
                            }).join('')}
                        </div>
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
            
            const makeSeries = (win) => {
                if (histCloses.length < win + 1) return [];
                const s = Metrics.computeHVSeries(histCloses, win, histCloses.length);
                return [...Array(histCloses.length - s.length).fill(null), ...s];
            };
            
            const hvSeries5d   = makeSeries(5);
            const hvSeries21   = vol.hv_series21 ? [...Array(histCloses.length - vol.hv_series21.length).fill(null), ...vol.hv_series21] : makeSeries(21);
            const hvSeries63d  = makeSeries(63);
            const hvSeries252d = makeSeries(252);
            
            const hvSeriesAll = { '5d': hvSeries5d, '21d': hvSeries21, '63d': hvSeries63d, '252d': hvSeries252d };
            const hvDatesAll = histDates;
            
            // Legacy fallbacks just in case
            const hvSeries21Legacy = vol.hv_series21 || vol.hvSeries21
                || (histCloses.length >= 22 ? Metrics.computeHVSeries(histCloses, 21, histCloses.length) : []);
            const hvDates21Legacy = histDates.slice(21, 21 + hvSeries21Legacy.length);
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
                    hvSeriesAll,
                    hvDatesAll,
                    hvSeries21: hvSeries21Legacy,
                    hvDates21: hvDates21Legacy,
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
        
        const makeSeries = (win) => {
            if (closes.length < win + 1) return [];
            const s = Metrics.computeHVSeries(closes, win, closes.length);
            return [...Array(closes.length - s.length).fill(null), ...s];
        };
        const hvSeriesAll = { '5d': makeSeries(5), '21d': makeSeries(21), '63d': makeSeries(63), '252d': makeSeries(252) };
        const hvDatesAll = dates;
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
                hvSeriesAll,
                hvDatesAll,
                hvSeries21,
                hvDates21,
                hvTermStructure: Metrics.computeHVTermStructure(closes),
                vov21: Metrics.computeVoV21(closes),
            },
        };
    },

    // ── Horizon preset buttons ─────────────────────────────
    _setHorizon(ticker, range) {
        this._horizonState[ticker] = range;
        const m = ticker === 'NG=F' ? this._ngVolMetrics : this._allMetrics?.[ticker];
        if (!m) return;
        const fullDates = m?.volatility?.hvDatesAll || m?.volatility?.hvDates21 || [];
        const n = fullDates.length;
        if (!n) return;

        let startPct = 0;
        if (range !== 'ALL') {
            const days = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }[range] || 0;
            if (days) {
                const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
                const idx = fullDates.findIndex(d => d >= cutoff);
                startPct = idx === -1 ? 0 : Math.round((idx / n) * 100);
            }
        }
        this._rangeState[ticker] = { start: startPct, end: 100 };

        // Sync slider UI
        const cid    = 'vrm-spark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');
        const sStart = document.getElementById('vrm-rs-s-' + cid);
        const sEnd   = document.getElementById('vrm-rs-e-' + cid);
        if (sStart) sStart.value = startPct;
        if (sEnd)   sEnd.value   = 100;

        // Update horizon button active state
        const hg = document.getElementById('vrm-hg-' + cid);
        if (hg) hg.querySelectorAll('.vrm-horizon-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.range === range);
        });

        this._updateRangeLabel(ticker, m);
        this._updateHighlight(cid, startPct, 100);
        this._drawSparkline(ticker, m);
    },

    _updateHighlight(cid, v1, v2) {
        const hl = document.getElementById('vrm-hl-' + cid);
        if (!hl) return;
        const p1 = v1 / 100, p2 = v2 / 100;
        hl.style.left  = `calc(${p1 * 100}% + ${(10 - p1 * 20)}px)`;
        hl.style.width = `calc(${(p2 - p1) * 100}% + ${(p1 - p2) * 20}px)`;
    },

    _updateRangeLabel(ticker, m) {
        const cid = 'vrm-spark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');
        const lbl = document.getElementById('vrm-rl-' + cid);
        if (!lbl) return;
        const rs = this._rangeState[ticker] || { start: 0, end: 100 };
        const fullDates = m?.volatility?.hvDatesAll || m?.volatility?.hvDates21 || [];
        const n = fullDates.length;
        if (!n) { lbl.textContent = 'ALL HISTORY'; return; }
        const si = Math.floor(rs.start / 100 * n);
        const ei = Math.max(si + 1, Math.ceil(rs.end / 100 * n) - 1);
        const d1 = fullDates[si], d2 = fullDates[Math.min(ei, n - 1)];
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const fmt = d => { const [y,mo,dd] = d.split('-').map(Number); return MONTHS[mo-1] + ' ' + dd + ', ' + y; };
        lbl.textContent = (rs.start === 0 && rs.end === 100)
            ? 'ALL HISTORY'
            : (d1 && d2 ? fmt(d1) + ' – ' + fmt(d2) : 'CUSTOM');
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
            if (!sStart || !sEnd) continue;

            const onChange = (e) => {
                let v1 = parseInt(sStart.value), v2 = parseInt(sEnd.value);
                if (v1 >= v2) {
                    if (e.target === sStart) sStart.value = Math.max(0, v2 - 1);
                    else                     sEnd.value   = Math.min(100, v1 + 1);
                    v1 = parseInt(sStart.value); v2 = parseInt(sEnd.value);
                }
                this._rangeState[ticker] = { start: v1, end: v2 };
                // Deactivate horizon buttons when slider is dragged manually
                this._horizonState[ticker] = null;
                const hg = document.getElementById('vrm-hg-' + cid);
                if (hg) hg.querySelectorAll('.vrm-horizon-btn').forEach(b => b.classList.remove('active'));
                this._updateHighlight(cid, v1, v2);
                this._updateRangeLabel(ticker, m);
                this._drawSparkline(ticker, m);
            };

            sStart.addEventListener('input', onChange);
            sEnd.addEventListener('input', onChange);
            this._updateHighlight(cid, parseInt(sStart.value), parseInt(sEnd.value));
            this._updateRangeLabel(ticker, m);
        }
    },

    // ── Hover / crosshair init ─────────────────────────────
    _initHover() {
        const tickers = this.mode === '1up'
            ? [this.selected]
            : [this._pairs[this.selectedPair].long, this._pairs[this.selectedPair].short];
        for (const ticker of tickers) {
            const m   = ticker === 'NG=F' ? this._ngVolMetrics : this._allMetrics?.[ticker];
            if (!m) continue;
            const cid = 'vrm-spark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');
            const cvs = document.getElementById(cid);
            if (!cvs) continue;

            cvs.style.cursor = 'crosshair';

            const getIdx = (e) => {
                const rect = cvs.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const fullDates = m?.volatility?.hvDatesAll || m?.volatility?.hvDates21 || [];
                const rs  = this._rangeState[ticker] || { start: 0, end: 100 };
                const si  = Math.floor(rs.start / 100 * fullDates.length);
                const ei  = Math.max(si + 2, Math.ceil(rs.end / 100 * fullDates.length));
                const viewDates = fullDates.slice(si, ei);
                const padL = 60, padR = 54;
                const cW   = rect.width - padL - padR;
                if (x < padL || x > padL + cW || viewDates.length < 2) return null;
                return Math.round(((x - padL) / cW) * (viewDates.length - 1));
            };

            cvs.addEventListener('mousemove', (e) => {
                const idx = getIdx(e);
                this._hoverState[ticker] = idx;
                const drag = this._dragState[ticker];
                if (drag?.active && idx != null) drag.currentIdx = idx;
                this._drawSparkline(ticker, m);
            });

            cvs.addEventListener('mousedown', (e) => {
                const idx = getIdx(e);
                if (idx != null) {
                    this._dragState[ticker] = { active: true, startIdx: idx, currentIdx: idx };
                    this._drawSparkline(ticker, m);
                }
            });

            const endDrag = () => {
                if (this._dragState[ticker]?.active) {
                    this._dragState[ticker] = { active: false, startIdx: null, currentIdx: null };
                    this._drawSparkline(ticker, m);
                }
            };

            cvs.addEventListener('mouseup', endDrag);
            cvs.addEventListener('mouseleave', () => {
                this._hoverState[ticker] = null;
                endDrag();
            });
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

        const activeKeys = this._activeSeries[ticker] || ['21d'];
        const fullDates = m?.volatility?.hvDatesAll || m?.volatility?.hvDates21 || [];
        const allSeries = m?.volatility?.hvSeriesAll || { '21d': m?.volatility?.hvSeries21 || [] };

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

        if (fullDates.length < 5) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.font      = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Insufficient history', cssW / 2, cssH / 2 + 4);
            return;
        }

        // ── Range slice ──────────────────────────────────────
        const rs  = this._rangeState[ticker] || { start: 0, end: 100 };
        const len = fullDates.length;
        const si  = Math.floor(rs.start / 100 * len);
        const ei  = Math.max(si + 2, Math.ceil(rs.end / 100 * len));
        const atEnd  = rs.end >= 99;

        // Collect slices for selected series
        const slices = {};
        for (const k of activeKeys) {
            if (allSeries[k]) slices[k] = allSeries[k].slice(si, ei);
        }
        const primaryKey = activeKeys.includes('21d') ? '21d' : activeKeys[0];
        const primarySeries = slices[primaryKey] || slices[Object.keys(slices)[0]] || [];
        const fullPrimary = allSeries[primaryKey] || fullDates.map(() => 0); // fallback

        // Gather all valid values for y-scale
        const allVisValues = [];
        for (const k in slices) {
            for (const v of slices[k]) if (v != null) allVisValues.push(v);
        }
        if (allVisValues.length === 0) return; // Nothing to draw

        // Percentile thresholds from FULL primary series
        const sortedPrimary = [...fullPrimary].filter(v => v != null).sort((a, b) => a - b);
        const pctFn  = f => sortedPrimary[Math.max(0, Math.floor(sortedPrimary.length * f) - 1)] || 0;
        const p25 = pctFn(0.25), p75 = pctFn(0.75), p90 = pctFn(0.90);

        const pad = { top: 20, right: 54, bottom: 28, left: 60 };
        const cW  = cssW - pad.left - pad.right;
        const cH  = cssH - pad.top  - pad.bottom;

        const rawMin = Math.min(...allVisValues), rawMax = Math.max(...allVisValues);
        const vMin = rawMin * 0.90, vMax = rawMax * 1.06;
        const vRange = vMax - vMin || 1;

        const toY = v => pad.top + cH - ((v - vMin) / vRange) * cH;
        const toX = i => pad.left + (i / Math.max(primarySeries.length - 1, 1)) * cW;
        const toRgba = (hex, a) => {
            const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
            return `rgba(${r},${g},${b},${a})`;
        };

        // ── Y-axis: 5-level evenly-spaced grid + left labels ─
        ctx.font = '9px monospace';
        for (let i = 0; i <= 5; i++) {
            const v = vMax - (i / 5) * (vMax - vMin);
            const y = toY(v);
            ctx.setLineDash([3, 5]);
            ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
            ctx.setLineDash([]);
            // Left-side Y labels
            ctx.textAlign = 'right';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(v.toFixed(1) + '%', pad.left - 4, y + 3.5);
        }

        // ── Regime threshold dashes + right-side labels ──────
        const yTicks = [p25, p75, p90].filter(v => v > vMin && v < vMax);
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 0.7;
        for (const tick of yTicks) {
            const y = toY(tick);
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y);
            ctx.strokeStyle = tick >= p90 ? 'rgba(192,64,64,0.4)' : tick >= p75 ? 'rgba(192,120,40,0.4)' : 'rgba(74,128,184,0.4)';
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = '9px monospace'; ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        for (const tick of yTicks) ctx.fillText(tick.toFixed(0) + '%', pad.left + cW + 5, toY(tick) + 3.5);

        // ── Background regime zones (using primary series thresholds) ──
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

        // ── Area fill for primary series only ─────────────────
        let lastVPrimary = null;
        for (let i = primarySeries.length - 1; i >= 0; i--) {
            if (primarySeries[i] != null) { lastVPrimary = primarySeries[i]; break; }
        }
        if (lastVPrimary != null && primarySeries.length > 0) {
            let startFillIdx = 0;
            while(startFillIdx < primarySeries.length && primarySeries[startFillIdx] == null) startFillIdx++;
            if (startFillIdx < primarySeries.length) {
                const regColor = lastVPrimary >= p90 ? '#c04040' : lastVPrimary >= p75 ? '#c07828' : lastVPrimary >= p25 ? '#3db87a' : '#4a80b8';
                const aGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
                aGrad.addColorStop(0, toRgba(regColor, 0.22));
                aGrad.addColorStop(1, toRgba(regColor, 0.01));
                ctx.beginPath();
                ctx.moveTo(toX(startFillIdx), toY(primarySeries[startFillIdx]));
                for (let i = startFillIdx + 1; i < primarySeries.length; i++) {
                    if (primarySeries[i] != null) ctx.lineTo(toX(i), toY(primarySeries[i]));
                }
                ctx.lineTo(toX(primarySeries.length - 1), pad.top + cH);
                ctx.lineTo(toX(startFillIdx), pad.top + cH);
                ctx.closePath();
                ctx.fillStyle = aGrad; ctx.fill();
            }
        }

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

        // ── Multi-series drawing ──────────────────────────────
        // Draw non-primary lines first to keep primary on top
        for (const k of activeKeys) {
            const s = slices[k];
            if (!s || s.length === 0) continue;
            
            const isPrimary = k === primaryKey;
            ctx.lineWidth = isPrimary ? 2 : 1.5;
            const opacity = isPrimary ? 1.0 : 0.45;
            
            // Compute series-specific thresholds for coloring
            const fullS = allSeries[k] || fullDates.map(() => 0);
            const sortedS = [...fullS].filter(v => v != null).sort((a, b) => a - b);
            const pFn = f => sortedS[Math.max(0, Math.floor(sortedS.length * f) - 1)] || 0;
            const s25 = pFn(0.25), s75 = pFn(0.75), s90 = pFn(0.90);
            
            let started = false;
            for (let i = 1; i < s.length; i++) {
                const prev = s[i - 1], curr = s[i];
                if (curr == null || prev == null) continue;
                if (!started) { ctx.beginPath(); ctx.moveTo(toX(i - 1), toY(prev)); started = true; }
                
                // Regime coloring logic applied to ALL series with diff shading
                const colorHex = curr >= s90 ? '#c04040' : curr >= s75 ? '#c07828' : curr >= s25 ? '#3db87a' : '#4a80b8';
                ctx.strokeStyle = toRgba(colorHex, opacity);
                
                ctx.beginPath();
                ctx.moveTo(toX(i - 1), toY(prev));
                ctx.lineTo(toX(i), toY(curr));
                ctx.stroke();
            }
        }

        // ── Current value dots ─────────────────────────────────
        if (atEnd) {
            let labelOffset = 0;
            for (const k of activeKeys) {
                const s = slices[k];
                if (!s) continue;
                let lastValid = null;
                for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) { lastValid = s[i]; break; }
                if (lastValid == null) continue;
                
                // Compute series-specific thresholds for end dot
                const fullS = allSeries[k] || fullDates.map(() => 0);
                const sortedS = [...fullS].filter(v => v != null).sort((a, b) => a - b);
                const pFn = f => sortedS[Math.max(0, Math.floor(sortedS.length * f) - 1)] || 0;
                const s25 = pFn(0.25), s75 = pFn(0.75), s90 = pFn(0.90);
                
                const lX = toX(s.length - 1), lY = toY(lastValid);
                const dcHex = lastValid >= s90 ? '#c04040' : lastValid >= s75 ? '#c07828' : lastValid >= s25 ? '#3db87a' : '#4a80b8';
                
                if (k === primaryKey) {
                    ctx.beginPath(); ctx.arc(lX, lY, 6.5, 0, Math.PI * 2);
                    ctx.strokeStyle = toRgba(dcHex, 0.35); ctx.lineWidth = 1.5; ctx.stroke();
                }
                
                ctx.beginPath(); ctx.arc(lX, lY, 3.5, 0, Math.PI * 2);
                const opacity = k === primaryKey ? 1.0 : 0.6;
                ctx.fillStyle = toRgba(dcHex, opacity); ctx.fill();
                ctx.beginPath(); ctx.arc(lX, lY, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = '#fff'; ctx.fill();
                
                ctx.font = 'bold 9px monospace'; ctx.fillStyle = toRgba(dcHex, opacity); ctx.textAlign = 'right';
                // Adjust vertical placement minimally to avoid text overlap if possible
                ctx.fillText(lastValid.toFixed(1) + '%', lX - 10, lY - 4 - labelOffset);
                if (activeKeys.length > 1) labelOffset += 10;
            }
        }

        // ── X-axis date labels (matches Price & Cycle Map logic) ─
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

            const getWeek = d => {
                const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
                d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay() || 7));
                return Math.ceil(((d2 - new Date(Date.UTC(d2.getUTCFullYear(),0,1))) / 86400000 + 1) / 7);
            };

            if (count <= 14) {
                // Daily mode: every trading day, show month when it changes
                let lastMo = -1;
                viewDates.forEach((d, i) => {
                    const [y, mo, dd] = d.split('-').map(Number);
                    const lbl = mo !== lastMo ? MONTHS[mo-1] + ' ' + dd : String(dd);
                    ticks.push({ i, label: lbl });
                    lastMo = mo;
                });
            } else if (count <= 35) {
                // Weekly mode: first trading day of each calendar week
                let lastWk = -1;
                viewDates.forEach((d, i) => {
                    const dt = new Date(d);
                    const wk = dt.getFullYear() * 100 + getWeek(dt);
                    if (wk !== lastWk) {
                        const [y, mo, dd] = d.split('-').map(Number);
                        ticks.push({ i, label: MONTHS[mo-1] + ' ' + dd + (spansYears ? ' ' + y : '') });
                        lastWk = wk;
                    }
                });
            } else if (count <= 65) {
                // Biweekly mode
                let lastWk = -1, wkIdx = 0;
                viewDates.forEach((d, i) => {
                    const dt = new Date(d);
                    const wk = dt.getFullYear() * 100 + getWeek(dt);
                    if (wk !== lastWk) { lastWk = wk; wkIdx++; }
                    if (wkIdx % 2 === 1 && i > 0) {
                        const [y, mo, dd] = d.split('-').map(Number);
                        if (!ticks.length || ticks[ticks.length-1].i !== i) {
                            ticks.push({ i, label: MONTHS[mo-1] + ' ' + dd + (spansYears ? ' ' + y : '') });
                        }
                    }
                });
            } else if (monthsRange > 36) {
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

            // Draw with collision avoidance + vertical grid lines (#8)
            let lastX = -999;
            for (const t of ticks) {
                const x = toX(t.i);
                if (x - lastX < 45) continue;
                ctx.fillText(t.label, x, pad.top + cH + 16);
                // Vertical grid line from x-axis tick
                ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + cH);
                ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.stroke();
                // Tick mark
                ctx.beginPath(); ctx.moveTo(x, pad.top + cH); ctx.lineTo(x, pad.top + cH + 4);
                ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
                lastX = x;
            }
        }

        // ── Measurement drag band ─────────────────────────────
        const drag = this._dragState[ticker];
        const series = primarySeries; // Use primary series for measurement math
        if (drag?.active && drag.startIdx != null && drag.currentIdx != null && drag.startIdx !== drag.currentIdx) {
            const i1 = Math.min(drag.startIdx, drag.currentIdx);
            const i2 = Math.max(drag.startIdx, drag.currentIdx);
            const x1 = toX(i1), x2 = toX(i2);
            const v1 = series[i1], v2 = series[i2];
            const diff   = v2 - v1;
            const isPos  = diff >= 0;
            const accent = isPos ? '#3db87a' : '#e06060';
            const d1 = viewDates[i1] || '', d2 = viewDates[i2] || '';
            const MONTHS_M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const fmtD = d => { if (!d) return ''; const [y,mo,dd] = d.split('-').map(Number); return MONTHS_M[mo-1]+' '+dd+', '+y; };

            // Band fill
            ctx.save();
            ctx.fillStyle = isPos ? 'rgba(61,184,122,0.10)' : 'rgba(224,96,96,0.10)';
            ctx.fillRect(x1, pad.top, x2 - x1, cH);

            // Dashed boundary lines
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x1, pad.top); ctx.lineTo(x1, pad.top + cH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x2, pad.top); ctx.lineTo(x2, pad.top + cH); ctx.stroke();
            ctx.setLineDash([]);

            // Measurement card
            const sign = isPos ? '+' : '';
            const line1 = `${isPos ? '↑' : '↓'} ${sign}${diff.toFixed(2)}% HV`;
            const line2 = `${fmtD(d1)} – ${fmtD(d2)}`;
            ctx.font = 'bold 11px monospace';
            const w1 = ctx.measureText(line1).width;
            ctx.font = '9px monospace';
            const w2 = ctx.measureText(line2).width;
            const cardW = Math.max(w1, w2) + 20;
            const cardH = 44;
            let cardX = x1 + (x2 - x1) / 2 - cardW / 2;
            cardX = Math.max(pad.left + 2, Math.min(pad.left + cW - cardW - 2, cardX));
            const cardY = pad.top + 8;

            ctx.fillStyle = 'rgba(13,17,28,0.96)';
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(cardX, cardY, cardW, cardH, 4); ctx.fill(); ctx.stroke();
            ctx.font = 'bold 11px monospace'; ctx.fillStyle = accent; ctx.textAlign = 'left';
            ctx.fillText(line1, cardX + 8, cardY + 17);
            ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(148,163,184,0.9)';
            ctx.fillText(line2, cardX + 8, cardY + 33);
            ctx.restore();
        }

        // ── Crosshair + hover tooltip (hidden while dragging) ─
        const hIdx = this._hoverState[ticker];
        const isDragging = this._dragState[ticker]?.active;
        if (!isDragging && hIdx != null && hIdx >= 0 && hIdx < primarySeries.length) {
            const hx = toX(hIdx);
            const hDate = viewDates[hIdx] || '';

            // Vertical dashed crosshair line
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + cH); ctx.stroke();
            ctx.setLineDash([]);

            // Gather tooltip data & draw dots
            const lines = [];
            const MONTHS_TT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (hDate) {
                const [ty, tm, td] = hDate.split('-').map(Number);
                lines.push({ text: MONTHS_TT[tm-1] + ' ' + td + ', ' + ty, color: 'rgba(0,255,255,0.85)', isDate: true });
            }

            for (const k of activeKeys) {
                const s = slices[k];
                if (s && s[hIdx] != null) {
                    const hv = s[hIdx];
                    const hy = toY(hv);
                    const prevV = hIdx > 0 ? s[hIdx - 1] : null;
                    const delta = prevV != null ? hv - prevV : null;
                    const deltaStr = delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(2) + '%' : '';
                    
                    // Specific threshold for dot
                    const fullS = allSeries[k] || fullDates.map(() => 0);
                    const sortedS = [...fullS].filter(v => v != null).sort((a, b) => a - b);
                    const pFn = f => sortedS[Math.max(0, Math.floor(sortedS.length * f) - 1)] || 0;
                    const s25 = pFn(0.25), s75 = pFn(0.75), s90 = pFn(0.90);
                    const hColorHex = hv >= s90 ? '#c04040' : hv >= s75 ? '#c07828' : hv >= s25 ? '#3db87a' : '#4a80b8';
                    const isPri = k === primaryKey;

                    // Highlight dot on line
                    ctx.beginPath(); ctx.arc(hx, hy, isPri ? 4 : 3, 0, Math.PI * 2);
                    ctx.fillStyle = toRgba(hColorHex, isPri ? 1.0 : 0.6); ctx.fill();
                    ctx.strokeStyle = '#fff'; ctx.lineWidth = isPri ? 1.5 : 1; ctx.stroke();
                    
                    lines.push({
                        text: `${k.toUpperCase()}: ${hv.toFixed(1)}% ${deltaStr ? '('+deltaStr+')' : ''}`,
                        color: hColorHex,
                        isDate: false
                    });
                }
            }

            // Tooltip card metrics dynamically calculated
            if (lines.length > 0) {
                ctx.font = 'bold 9px monospace';
                let ttW = 60; // minimum
                let ttH = 8 + lines.length * 14;
                for (const l of lines) {
                    const w = ctx.measureText(l.text).width;
                    if (w > ttW) ttW = w;
                }
                ttW += 20;
                
                let ttX = hx + 10;
                if (ttX + ttW > pad.left + cW) ttX = hx - ttW - 10;
                ttX = Math.max(pad.left, ttX);
                // Try aligning vertically to the primary line if possible
                const primaryHoverVal = primarySeries[hIdx];
                const primaryHy = primaryHoverVal != null ? toY(primaryHoverVal) : (pad.top + cH/2);
                let ttY = Math.max(pad.top + 4, primaryHy - ttH / 2);
                if (ttY + ttH > pad.top + cH) ttY = pad.top + cH - ttH - 4; // prevent going below

                ctx.fillStyle = 'rgba(13,17,28,0.95)';
                ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(ttX, ttY, ttW, ttH, 4);
                ctx.fill(); ctx.stroke();

                ctx.textAlign = 'left';
                let yOff = ttY + 13;
                for (const l of lines) {
                    ctx.fillStyle = l.color;
                    ctx.font = l.isDate ? 'bold 9px monospace' : '10px monospace';
                    ctx.fillText(l.text, ttX + 8, yOff);
                    yOff += 14;
                }
            }
            ctx.restore();
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
