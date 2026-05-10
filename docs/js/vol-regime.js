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
    _activeOverlays: {},  // ticker -> array of active overlay keys ['tr','vov','signals']

    // ── Config ─────────────────────────────────────────────
    _instruments: ['NG=F', 'BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L'],

    _pairs: [
        { long: 'BOIL',   short: 'KOLD',   label: 'BOIL ↔ KOLD',   sub: 'NYSE · 2×' },
        { long: 'HNU.TO', short: 'HND.TO', label: 'HNU ↔ HND',     sub: 'TSX · 2×'  },
        { long: '3NGL.L', short: '3NGS.L', label: '3NGL ↔ 3NGS',   sub: 'LSE · 3×'  },
    ],

    _hvWindows: [
        { key: '5d',   label: '5D HV',   tooltip: 'Ultra-short volatility — catches weather events & storage shocks in {T} before the longer windows react' },
        { key: '21d',  label: '21D HV',  tooltip: 'Monthly baseline volatility — the standard reference for {T} structural risk and position sizing' },
        { key: '63d',  label: '63D HV',  tooltip: 'Seasonal-quarter volatility — aligns with {T} injection/withdrawal macro cycles (~3 months)' },
        { key: '252d', label: '252D HV', tooltip: 'Full annual volatility — the complete 1-year baseline for {T}' },
    ],

    // Regime buckets: percentile of current HV vs all available history
    _regime(pct) {
        if (pct == null) return { label: '--',       cls: 'vrm-reg-unknown',  color: 'rgba(255, 255, 255, 0.85)' };
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
                            data-tooltip="1-UP Mode: Analyze a single instrument's full historical volatility profile in deep detail."
                            onclick="VolRegime._setMode('1up')">1-UP</button>
                    <button class="vrm-mode-btn${isPair ? ' active' : ''}"
                            data-tooltip="PAIR Mode: Compare identical-leverage long and short ETFs side-by-side to track structural spread anomalies."
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
                data-tooltip="${cfg ? cfg.name + ' · ' + cfg.leverage + ' leverage · ' + cfg.exchange : 'NYMEX Front-Month Natural Gas Futures'}"
                >${disp}</button>`;
        }).join('');
    },

    _chipsPair() {
        return this._pairs.map((p, idx) => {
            const isActive = idx === this.selectedPair;
            return `<button
                class="vrm-chip vrm-chip-pair${isActive ? ' vrm-chip-active' : ''}"
                data-tooltip="Compare structural volatility differences between ${p.long} and ${p.short} over time."
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

    _toggleOverlay(ticker, key) {
        if (!this._activeOverlays[ticker]) this._activeOverlays[ticker] = [];
        const active = this._activeOverlays[ticker];
        if (active.includes(key)) {
            this._activeOverlays[ticker] = active.filter(k => k !== key);
        } else {
            this._activeOverlays[ticker].push(key);
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
        const color   = anomaly ? 'var(--orange)' : 'rgba(255, 255, 255, 0.85)';
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
        const vovSeries = (vol.vovSeries || []).filter(v => v != null);
        const vovPct   = vov != null && vovSeries.length >= 20
            ? +(vovSeries.filter(v => v <= vov).length / vovSeries.length * 100).toFixed(1)
            : null;

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

        // Trend Ratio
        const trData     = m.tr || {};
        const trCurrent  = trData.current   ?? null;
        const trPct      = trData.percentile ?? null;
        const trInfo     = this._trLabel(trCurrent, trPct);
        const regSignal  = this._regimeSignal(hvPcts['21d'], trCurrent, ts);

        // Regime duration: consecutive sessions at the same 21D HV regime label
        let regimeDuration = 0;
        const hv21Full = m?.volatility?.hvSeriesAll?.['21d'] || [];
        if (hv21Full.length > 5 && hvPcts['21d'] != null) {
            const s21s = [...hv21Full].filter(v => v != null).sort((a,b) => a-b);
            const pr   = f => s21s.length ? s21s[Math.max(0, Math.floor(s21s.length * f) - 1)] : 0;
            const [rd25, rd75, rd90] = [pr(0.25), pr(0.75), pr(0.90)];
            const getR = v => v >= rd90 ? 'SPIKE' : v >= rd75 ? 'ELEVATED' : v >= rd25 ? 'NORMAL' : 'LOW';
            const curR = regBadge.label;
            for (let i = hv21Full.length - 1; i >= 0 && regimeDuration < 9999; i--) {
                if (hv21Full[i] == null || getR(hv21Full[i]) !== curR) break;
                regimeDuration++;
            }
        }

        // Annualised rebalancing decay drag: (L-1)² × σ²/2, expressed as %
        const decayDrag = (!isNG && hv['21d'] != null && levMult > 1)
            ? +(Math.pow(levMult - 1, 2) * Math.pow(hv['21d'] / 100, 2) / 2 * 100).toFixed(1)
            : null;

        // Signal quality: percentile-based so the badge only fires when VoV is
        // elevated vs this instrument's own history (≥90th = unreliable, ≥75th = noisy).
        // Pure absolute thresholds fire permanently on nat gas ETFs and carry no information.
        const signalQuality = vovPct != null && vovPct >= 90
            ? { label: '⚠ SIGNALS UNRELIABLE', cls: 'sqw-unstable',
                tip: `VoV-21 is at its ${vovPct.toFixed(0)}th percentile (${vov.toFixed(1)}%) — volatility of volatility is higher than ${vovPct.toFixed(0)}% of all recorded sessions for ${ticker}. Regime signals and TR readings are unreliable. Avoid structural positions based solely on current classification.` }
            : vovPct != null && vovPct >= 75
            ? { label: '~ SIGNALS NOISY', cls: 'sqw-shifting',
                tip: `VoV-21 is at its ${vovPct.toFixed(0)}th percentile (${vov.toFixed(1)}%) — noisier than ${vovPct.toFixed(0)}% of ${ticker}'s history. Regime may be transitioning. Confirm signals with price action before acting.` }
            : null;

        // Actionable one-line tactical read
        const tactRead = this._tacticalRead(regSignal, vovInfo, levMult, decayDrag, isNG, side);

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
            const tTip = w.tooltip.replace('{T}', ticker) + (pct != null ? ` — currently at the ${pct.toFixed(0)}th percentile of ${ticker}'s entire trading history` : '');
            return `
                <div class="vrm-hv-box${activeClass}" onclick="VolRegime._toggleSeries('${ticker}', '${w.key}')" data-tooltip="${tTip}" style="cursor:pointer">
                    <div class="vrm-hv-label">${w.label}</div>
                    <div class="vrm-hv-val" style="color:${reg.color}">
                        ${val != null ? val.toFixed(1) + '%' : '--'}
                    </div>
                    <div class="vrm-hv-regime-pip ${reg.cls}" data-tooltip="${reg.label} REGIME"></div>
                </div>`;
        }).join('');

        return `
            <div class="vrm-card vrm-card-${side}">

                <div class="vrm-card-hdr">
                    <span class="vrm-ticker" style="color:${tickerColor}">${ticker}</span>
                    ${lev   ? `<span class="vrm-badge-lev">${lev}</span>` : ''}
                    ${exch  ? `<span class="vrm-badge-exch">${exch}</span>` : ''}
                    <span class="vrm-regime-badge ${regBadge.cls}"
                          data-tooltip="${ticker} Vol Regime: 21D HV currently sits at the ${hvPcts['21d'] != null ? hvPcts['21d'].toFixed(0)+'th' : '--'} percentile of all available history${regimeDuration > 1 ? '. Current regime active for ' + regimeDuration + ' consecutive sessions.' : ''}">
                        ${regBadge.label}${regimeDuration > 2 ? `<span class="vrm-regime-dur">&nbsp;·&nbsp;${regimeDuration}d</span>` : ''}
                    </span>
                    ${regSignal ? `<span class="vrm-regime-signal ${regSignal.cls}" data-tooltip="${regSignal.tip}">${regSignal.label}</span>` : ''}
                    ${spikeEvt ? `<span class="vrm-spike-badge"
                        data-tooltip="SPIKE EVENT in ${ticker} — 5D HV (${hv['5d'].toFixed(1)}%) exceeds 2× the 252D baseline (${hv['252d'].toFixed(1)}%). Near-term vol has completely broken from the annual norm.">⚡ SPIKE EVENT</span>` : ''}
                    ${signalQuality ? `<span class="vrm-sqw ${signalQuality.cls}" data-tooltip="${signalQuality.tip}">${signalQuality.label}</span>` : ''}
                </div>

                ${tactRead ? `<div class="vrm-tactical-read ${tactRead.cls}" data-tooltip="Regime implication for ${ticker} — synthesises composite signal + VoV quality into a one-line tactical read."><span class="vrm-tac-lbl">IMPLICATION</span><span class="vrm-tac-txt">${tactRead.text}</span></div>` : ''}

                <div class="vrm-hv-boxes">${boxes}</div>

                ${(() => {
                    const ao = this._activeOverlays[ticker] || [];
                    return `<div class="vrm-overlay-row">
                        <span class="vrm-overlay-lbl">OVERLAYS</span>
                        <button class="vrm-overlay-btn ov-tr${ao.includes('tr')?' active':''}"
                                onclick="VolRegime._toggleOverlay('${ticker}','tr')"
                                data-tooltip="Show historical Trend Ratio as a cyan line overlay. Secondary right Y-axis. TR ≥ 1.2 = trending, TR < 0.8 = choppy.">TR</button>
                        <button class="vrm-overlay-btn ov-vov${ao.includes('vov')?' active':''}"
                                onclick="VolRegime._toggleOverlay('${ticker}','vov')"
                                data-tooltip="Show historical Vol-of-Vol (VoV-21) as an amber line overlay. High VoV = regime instability — signals are less reliable.">VoV</button>
                        <button class="vrm-overlay-btn ov-signals${ao.includes('signals')?' active':''}"
                                onclick="VolRegime._toggleOverlay('${ticker}','signals')"
                                data-tooltip="Show composite regime signal timeline at chart bottom. ⚡ Surge=red · → Trending=green · ↔ Choppy=amber · ↗ Quiet Trend=cyan · ◎ Coiling=gray">SIGNALS</button>
                    </div>`;
                })()}

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
                    <div class="vrm-stat-box" data-tooltip="5D/63D HV ratio — when over 1.35×, near-term ${ticker} volatility is accelerating faster than the seasonal trend. This is a key immediate risk signal.">
                        <span class="vrm-stat-lbl">TERM STRUCT</span>
                        <span class="vrm-stat-val ${tsInfo.cls}">${tsInfo.label}&nbsp;${tsInfo.arrow}</span>
                    </div>
                    <div class="vrm-stat-box" data-tooltip="${ticker} Vol-of-Vol (21-day std of rolling HV-10). High VoV means volatility itself is volatile — structural regime shift is likely imminent.">
                        <span class="vrm-stat-lbl">VoV-21</span>
                        <span class="vrm-stat-val ${vovInfo.cls}">${vov != null ? vov.toFixed(1) + '%' : '--'}&nbsp;${vovInfo.label}</span>
                    </div>
                    <div class="vrm-stat-box" data-tooltip="Trend Ratio (TR): weekly-sampled RV ÷ daily-sampled RV over 20 sessions. TR ≥ 1.2 = sustained directional moves dominate (trending). TR < 0.8 = intraday noise dominates (choppy). Audit-validated signal (t=3.42, p&lt;0.001): low TR periods in ${ticker} show +4% better 21d forward returns vs high TR. Does NOT predict direction — only regime character.">
                        <span class="vrm-stat-lbl">TREND RATIO</span>
                        <span class="vrm-stat-val ${trInfo.cls}">${trCurrent != null ? trCurrent.toFixed(3) : '--'}&nbsp;${trInfo.arrow}&nbsp;${trInfo.label}</span>
                    </div>
                    ${effVol != null ? `
                    <div class="vrm-stat-box" data-tooltip="Effective ETF volatility = HV-21 × ${levMult}× leverage. This represents the realistic annual swing scale for ${ticker} — expressing what you are actually mathematically exposed to.">
                        <span class="vrm-stat-lbl">EFF VOL ${levMult}×</span>
                        <span class="vrm-stat-val vrm-eff-vol">${effVol.toFixed(1)}%</span>
                    </div>` : ''}
                    ${decayDrag != null ? `
                    <div class="vrm-stat-box" data-tooltip="Annualised rebalancing decay drag = (L−1)² × σ²/2. At ${levMult}× leverage with ${hv['21d'].toFixed(1)}% HV-21, long holders lose approx ${decayDrag.toFixed(1)}% annually to path dependency alone, before any directional move. Decay scales with the SQUARE of volatility — doubling HV quadruples drag.">
                        <span class="vrm-stat-lbl">DECAY DRAG</span>
                        <span class="vrm-stat-val ${decayDrag > 30 ? 'dd-extreme' : decayDrag > 15 ? 'dd-high' : decayDrag > 5 ? 'dd-moderate' : 'dd-low'}">${decayDrag.toFixed(1)}%&nbsp;/yr</span>
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
            const trCurrent    = histCloses.length >= 21 ? Metrics.computeTR(histCloses)            : null;
            const trPercentile = histCloses.length >= 25 ? Metrics.computeTRPercentile(histCloses) : null;
            const trSeriesRaw  = histCloses.length >= 21 ? Metrics.computeTRSeries(histCloses)     : [];
            const trSeries     = [...Array(histCloses.length - trSeriesRaw.length).fill(null), ...trSeriesRaw];
            const vovSeriesRaw = histCloses.length >= 32 ? Metrics.computeVoVSeries(histCloses)    : [];
            const vovSeries    = [...Array(histCloses.length - vovSeriesRaw.length).fill(null), ...vovSeriesRaw];
            const vov21Current = histCloses.length >= 32 ? Metrics.computeVoV21(histCloses) : null;

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
                    vov21:       vov21Current ?? vol.vov21 ?? null,
                    volRegimePct: vol.vol_regime_pct ?? vol.volRegimePct ?? null,
                    atr14Pct:    vol.atr14_pct   ?? vol.atr14Pct        ?? null,
                    vovSeries,
                },
                tr: { current: trCurrent, percentile: trPercentile, series: trSeries },
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
        const trSeriesRaw  = Metrics.computeTRSeries(closes);
        const trSeries     = [...Array(closes.length - trSeriesRaw.length).fill(null), ...trSeriesRaw];
        const vovSeriesRaw = Metrics.computeVoVSeries(closes);
        const vovSeries    = [...Array(closes.length - vovSeriesRaw.length).fill(null), ...vovSeriesRaw];
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
                vovSeries,
            },
            tr: {
                current:    Metrics.computeTR(closes),
                percentile: Metrics.computeTRPercentile(closes),
                series:     trSeries,
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
                startPct = idx === -1 ? 0 : Math.min(99, Math.floor((idx / n) * 100));
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

        // ── Overlay state ────────────────────────────────────────
        const activeOverlays = this._activeOverlays[ticker] || [];
        const showTR      = activeOverlays.includes('tr');
        const showVoV     = activeOverlays.includes('vov');
        const showSignals = activeOverlays.includes('signals');
        const trSeriesFull  = m?.tr?.series           || [];
        const vovSeriesFull = m?.volatility?.vovSeries || [];
        const trSlice  = trSeriesFull.slice(si, ei);
        const vovSlice = vovSeriesFull.slice(si, ei);

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
        // p25/p75/p90 right-side text labels — hide when overlay axis occupies same space
        if (!showTR && !showVoV) {
            ctx.font = '9px monospace'; ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            for (const tick of yTicks) ctx.fillText(tick.toFixed(0) + '%', pad.left + cW + 5, toY(tick) + 3.5);
        }

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

        // ── Secondary overlays: TR and VoV ───────────────────────
        if (showTR || showVoV) {
            // Build secondary Y scale from whichever overlay is "primary"
            const ovSlice = showTR ? trSlice : vovSlice;
            const ovVals  = ovSlice.filter(v => v != null);
            const ovMin   = showTR ? Math.min(0.4, ovVals.length ? Math.min(...ovVals) * 0.9 : 0.4) : 0;
            const ovMax   = showTR ? Math.max(1.6, ovVals.length ? Math.max(...ovVals) * 1.1 : 1.6)
                                   : Math.max(30,  ovVals.length ? Math.max(...ovVals) * 1.1 : 30);
            const ovRange = ovMax - ovMin || 1;
            const toYov   = v => pad.top + cH - ((v - ovMin) / ovRange) * cH;

            const drawOverlayLine = (slice, color, lw) => {
                ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash([]);
                let px = null, py = null;
                for (let i = 0; i < slice.length; i++) {
                    if (slice[i] == null) { px = null; continue; }
                    const [x, y] = [toX(i), toYov(slice[i])];
                    if (px != null) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); }
                    [px, py] = [x, y];
                }
            };

            if (showTR) {
                // TR=1.2 (trending) and TR=0.8 (choppy) threshold guides
                ctx.setLineDash([2, 4]); ctx.lineWidth = 0.7;
                for (const [v, col] of [[1.2,'rgba(61,184,122,0.30)'],[0.8,'rgba(192,120,40,0.30)']]) {
                    const ty = toYov(v);
                    if (ty >= pad.top && ty <= pad.top + cH) {
                        ctx.strokeStyle = col;
                        ctx.beginPath(); ctx.moveTo(pad.left, ty); ctx.lineTo(pad.left + cW, ty); ctx.stroke();
                    }
                }
                ctx.setLineDash([]);
                drawOverlayLine(trSlice,  'rgba(0,212,255,0.72)', 1.5);
            }
            if (showVoV) drawOverlayLine(vovSlice, 'rgba(192,120,40,0.68)', 1.2);

            // Right Y-axis: TR wins over VoV for label space
            const axColor = showTR ? 'rgba(0,212,255,0.55)' : 'rgba(192,120,40,0.55)';
            ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = axColor;
            const axTicks = showTR ? [0.6,0.8,1.0,1.2,1.4] : [5,10,15,20,25];
            for (const v of axTicks) {
                if (v < ovMin || v > ovMax) continue;
                const ty = toYov(v);
                if (ty >= pad.top && ty <= pad.top + cH)
                    ctx.fillText(showTR ? v.toFixed(1) : v + '%', pad.left + cW + 5, ty + 3.5);
            }
            // Tiny axis label rotated along right edge
            ctx.save();
            ctx.translate(cssW - 4, pad.top + cH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center'; ctx.font = '8px monospace'; ctx.fillStyle = axColor;
            ctx.fillText(showTR ? 'TR' : 'VoV', 0, 0);
            ctx.restore();
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

        // ── Regime signal timeline strip (below chart baseline) ─
        if (showSignals) {
            const hv21S  = (allSeries['21d'] || []).slice(si, ei);
            const hv5dS  = (allSeries['5d']  || []).slice(si, ei);
            const hv63dS = (allSeries['63d'] || []).slice(si, ei);
            const s21all = [...(allSeries['21d'] || [])].filter(v => v != null).sort((a,b) => a-b);
            const pFn21  = f => s21all.length ? s21all[Math.max(0, Math.floor(s21all.length * f) - 1)] : 0;
            const [sr25, sr75, sr90] = [pFn21(0.25), pFn21(0.75), pFn21(0.90)];
            const SIG_COL = {
                'rs-surge':    'rgba(192,64,64,0.90)',
                'rs-trending': 'rgba(61,184,122,0.90)',
                'rs-choppy':   'rgba(192,120,40,0.90)',
                'rs-qtrend':   'rgba(0,212,255,0.90)',
                'rs-coiling':  'rgba(255,255,255,0.28)',
            };
            const stripH = 7;
            const stripY = pad.top + cH + 4; // below chart baseline, above x-axis text

            // Solid faint base so strip is always a continuous band (not patchy)
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(pad.left, stripY, cW, stripH);

            // Collect contiguous same-signal runs and flush as single rects (no gaps)
            let runStart = 0, runSig = null;
            const flush = (end) => {
                if (runSig == null || !SIG_COL[runSig.cls]) return;
                ctx.fillStyle = SIG_COL[runSig.cls];
                ctx.fillRect(toX(runStart), stripY, toX(end) - toX(runStart) + 1, stripH);
            };
            for (let i = 0; i < hv21S.length; i++) {
                const hv21 = hv21S[i];
                if (hv21 == null) { flush(i - 1); runSig = null; runStart = i + 1; continue; }
                const hvPct = hv21 >= sr90 ? 92 : hv21 >= sr75 ? 80 : hv21 >= sr25 ? 50 : 15;
                const ts_i  = (hv5dS[i] > 0 && hv63dS[i] > 0) ? hv5dS[i] / hv63dS[i] : null;
                const sig   = this._regimeSignal(hvPct, trSlice[i] ?? null, ts_i);
                const cls   = sig?.cls ?? null;
                if (cls !== runSig?.cls) { flush(i - 1); runSig = sig; runStart = i; }
            }
            flush(hv21S.length - 1);

            // Inline mini-legend in top padding (right-aligned)
            const LEGEND = [
                ['⚡', 'rgba(192,64,64,0.85)',  'SURGE'],
                ['→', 'rgba(61,184,122,0.85)', 'TREND'],
                ['↔', 'rgba(192,120,40,0.85)', 'CHOP'],
                ['↗', 'rgba(0,212,255,0.85)',  'QUIET'],
                ['◎', 'rgba(255,255,255,0.4)', 'COIL'],
            ];
            ctx.font = '7.5px monospace';
            let lx = pad.left + cW;
            for (let i = LEGEND.length - 1; i >= 0; i--) {
                const [sym, col, lbl] = LEGEND[i];
                const symW = ctx.measureText(sym + ' ').width;
                const lblW = ctx.measureText(lbl).width;
                ctx.fillStyle = col;
                ctx.textAlign = 'left';
                ctx.fillText(sym, lx - symW - lblW, 12);
                ctx.fillStyle = 'rgba(255,255,255,0.30)';
                ctx.fillText(lbl, lx - lblW, 12);
                lx -= symW + lblW + 7;
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

            // Overlay values at hover point
            if (showTR && trSlice[hIdx] != null) {
                const tv = trSlice[hIdx];
                const tl = tv >= 1.2 ? 'TRENDING' : tv >= 1.0 ? 'MIXED' : tv >= 0.8 ? 'CHOPPY' : 'EXTREME CHOP';
                lines.push({ text: `TR: ${tv.toFixed(3)} · ${tl}`, color: 'rgba(0,212,255,0.85)', isDate: false });
            }
            if (showVoV && vovSlice[hIdx] != null) {
                const vv = vovSlice[hIdx];
                const vl = vv >= 20 ? 'UNSTABLE' : vv >= 12 ? 'SHIFTING' : vv >= 6 ? 'MODERATE' : 'STABLE';
                lines.push({ text: `VoV: ${vv.toFixed(1)}% · ${vl}`, color: 'rgba(192,120,40,0.85)', isDate: false });
            }
            if (showSignals) {
                // Reuse already-computed p25/p75/p90 (primary series = 21D by default)
                const hv21h  = (allSeries['21d'] || [])[si + hIdx];
                const hv5dh  = (allSeries['5d']  || [])[si + hIdx];
                const hv63dh = (allSeries['63d'] || [])[si + hIdx];
                if (hv21h != null) {
                    const hvPct = hv21h >= p90 ? 92 : hv21h >= p75 ? 80 : hv21h >= p25 ? 50 : 15;
                    const ts_h  = (hv5dh > 0 && hv63dh > 0) ? hv5dh / hv63dh : null;
                    const sig   = this._regimeSignal(hvPct, trSeriesFull[si + hIdx] ?? null, ts_h);
                    if (sig) lines.push({ text: `REGIME: ${sig.label}`, color: 'rgba(255,255,255,0.55)', isDate: false });
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

    // TR (Trend Ratio) label — uses percentile rank since leveraged ETFs are structurally < 1.0
    // Audit-validated thresholds: TR > 1.2 (P76) = trending, TR < 0.8 (P35) = choppy
    _trLabel(trCurrent, trPct) {
        if (trCurrent == null) return { label: '--',          cls: '',            arrow: ''  };
        if (trCurrent >= 1.2)  return { label: 'TRENDING',   cls: 'tr-trending', arrow: '→' };
        if (trCurrent >= 1.0)  return { label: 'MIXED',      cls: 'tr-mixed',    arrow: '~' };
        if (trCurrent >= 0.8)  return { label: 'CHOPPY',     cls: 'tr-choppy',   arrow: '↔' };
        return                        { label: 'EXTREME CHOP', cls: 'tr-extreme', arrow: '↔' };
    },

    // Composite regime signal: HV level × Trend Ratio × term structure
    // Backed by data audit (t=3.42, p<0.001 for TR → 21d forward return difference)
    _regimeSignal(hvPct, trCurrent, ts) {
        if (hvPct == null) return null;
        const highHV  = hvPct >= 75;
        const lowHV   = hvPct <= 25;
        const trending = trCurrent != null && trCurrent >= 1.2;
        const choppy   = trCurrent != null && trCurrent < 0.8;
        const surge    = ts != null && ts >= 1.35;

        if (surge && highHV)
            return { label: '⚡ VOL SURGE',    cls: 'rs-surge',
                     tip: 'Near-term vol (5D HV) is accelerating at >1.35× the 63D seasonal baseline. Sustained high-vol move underway — sizing risk is elevated.' };
        if (highHV && trending)
            return { label: '→ TRENDING VOL',  cls: 'rs-trending',
                     tip: 'Elevated vol driven by sustained directional moves (TR ≥ 1.2). Audit finding: high-TR environments follow through directionally at 21d. Trend-following setups preferred.' };
        if (highHV && choppy)
            return { label: '↔ CHOPPY VOL',    cls: 'rs-choppy',
                     tip: 'Elevated vol but most movement is leveraged intraday noise (TR < 0.8). Audit finding: low TR + high HV = worst forward return profile for long ETFs. Mean-reversion and decay management preferred.' };
        if (lowHV && trending)
            return { label: '↗ QUIET TREND',   cls: 'rs-qtrend',
                     tip: 'Low absolute vol but relatively directional price action (TR ≥ 1.2). Often an accumulation/distribution phase before vol expansion. Watch for term structure acceleration.' };
        if (lowHV && !trending)
            return { label: '◎ COILING',        cls: 'rs-coiling',
                     tip: 'Low-vol chop — quiet compression (HV ≤ 25th pct). Historical pattern: vol expansion typically follows coiling. Monitor term structure for early breakout signal.' };
        return null;
    },

    // One-line actionable tactical read synthesising composite regime + VoV quality
    _tacticalRead(regSignal, vovInfo, levMult, decayDrag, isNG, side) {
        const dd      = decayDrag != null ? ` (est. ${decayDrag.toFixed(0)}%/yr drag)` : '';
        const isLong  = side === 'long';
        const isShort = side === 'short';

        // Signal quality overrides trump everything
        if (vovInfo.cls === 'vov-high')
            return { text: 'Regime signals unreliable — VoV unstable. Avoid structural positions based on current classification.', cls: 'tac-warn' };
        if (vovInfo.cls === 'vov-mid')
            return { text: 'Signals moderately noisy — VoV shifting. Reduce conviction on regime calls, confirm with price action.', cls: 'tac-caution' };

        if (!regSignal)
            return isNG
                ? { text: 'Normal vol — no vol-based directional edge.', cls: 'tac-neutral' }
                : { text: 'Normal regime — standard position sizing applicable.', cls: 'tac-neutral' };

        switch (regSignal.cls) {
            case 'rs-surge':
                if (isNG)    return { text: 'Vol spike — options premium elevated; directional positions require wider stops and smaller size.', cls: 'tac-danger' };
                if (isLong)  return { text: `Extreme decay environment${dd} — reduce leveraged long exposure or hedge urgently.`, cls: 'tac-danger' };
                if (isShort) return { text: `High vol aids short ETF via long-side decay${dd}. Monitor for vol mean-reversion which caps upside.`, cls: 'tac-caution' };
                break;
            case 'rs-trending':
                if (isNG)    return { text: 'Trending vol — directional momentum strategies have edge. Follow trend with defined stops.', cls: 'tac-trend' };
                if (isLong)  return { text: `Elevated decay${dd} but sustained trend offsets it. Momentum valid — tight stops required, do not hold through reversals.`, cls: 'tac-trend' };
                if (isShort) return { text: 'Trending vol: confirm NG direction before sizing — short ETF at risk if sustained rally is underway.', cls: 'tac-caution' };
                break;
            case 'rs-choppy':
                if (isNG)    return { text: 'Choppy vol — mean-reversion and range strategies preferred. Breakout trades have low win rate.', cls: 'tac-caution' };
                if (isLong)  return { text: `Worst-case for leveraged long: high decay${dd} + intraday noise cancels weekly gains. Reduce or exit.`, cls: 'tac-danger' };
                if (isShort) return { text: `Choppy high-vol structurally aids short ETF — long-side decay${dd} + noise erodes long holders. Regime favours this side.`, cls: 'tac-trend' };
                break;
            case 'rs-qtrend':
                if (isNG)    return { text: 'Quiet directional drift — low-cost entry window for positioning ahead of potential vol expansion.', cls: 'tac-good' };
                if (isLong)  return { text: `Low decay window${dd} — favourable entry for directional longs. Watch term structure acceleration as breakout trigger.`, cls: 'tac-good' };
                if (isShort) return { text: 'Quiet trend: low decay both sides. Short ETF less favoured if NG is trending upward.', cls: 'tac-watch' };
                break;
            case 'rs-coiling':
                if (isNG)    return { text: 'Vol compression — breakout likely. Monitor storage data and term structure for direction catalyst.', cls: 'tac-watch' };
                if (isLong)  return { text: `Low decay${dd}, no clear trend. Small long tolerable — monitor term structure acceleration for breakout signal.`, cls: 'tac-watch' };
                if (isShort) return { text: `Coiling: low decay${dd} environment for short ETF. Watch for vol expansion trigger and confirm direction before adding.`, cls: 'tac-watch' };
                break;
        }
        return { text: 'Monitor for regime confirmation.', cls: 'tac-neutral' };
    },
};
