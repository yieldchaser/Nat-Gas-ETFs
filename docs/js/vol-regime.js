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
        this.selected = ticker;
        this._buildSelector();
        this._renderContent();
    },

    _pickPair(idx) {
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

        // Draw sparklines after DOM settles
        requestAnimationFrame(() => this._drawAll());
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
                    <div class="vrm-spark-label">Rolling 21D HV — last 90 sessions
                        <span class="vrm-spark-legend">
                            <span class="vrm-leg-dot vrm-reg-low"></span>Low
                            <span class="vrm-leg-dot vrm-reg-normal"></span>Normal
                            <span class="vrm-leg-dot vrm-reg-elevated"></span>Elevated
                            <span class="vrm-leg-dot vrm-reg-spike"></span>Spike
                        </span>
                    </div>
                    <canvas class="vrm-spark-canvas" id="${canvasId}"></canvas>
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
        const id  = 'vrm-spark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');
        const cvs = document.getElementById(id);
        if (!cvs) return;

        const series = m?.volatility?.hvSeries21 || [];
        const ctx    = cvs.getContext('2d');
        const W      = cvs.width  = cvs.parentElement.clientWidth || 300;
        const H      = cvs.height = 90;
        ctx.clearRect(0, 0, W, H);

        if (series.length < 5) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.font      = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Insufficient history', W / 2, H / 2 + 4);
            return;
        }

        // Percentile thresholds from the series itself
        const sorted  = [...series].sort((a, b) => a - b);
        const idx     = f => sorted[Math.max(0, Math.floor(sorted.length * f) - 1)];
        const p25 = idx(0.25), p75 = idx(0.75), p90 = idx(0.90);

        const padL = 30, padR = 6, padT = 6, padB = 18;
        const cW = W - padL - padR;
        const cH = H - padT - padB;

        const rawMin = Math.min(...series);
        const rawMax = Math.max(...series);
        const vMin   = rawMin * 0.88;
        const vMax   = rawMax * 1.08;
        const vRange = vMax - vMin || 1;

        const toY = v  => padT + cH - ((v - vMin) / vRange) * cH;
        const toX = i  => padL + (i / Math.max(series.length - 1, 1)) * cW;

        // ── Background regime zones ──────────────────────────
        const zones = [
            { lo: p90,  hi: vMax, color: 'rgba(192,64,64,0.13)'   },   // Spike
            { lo: p75,  hi: p90,  color: 'rgba(192,120,40,0.11)'  },   // Elevated
            { lo: p25,  hi: p75,  color: 'rgba(61,184,122,0.08)'  },   // Normal
            { lo: vMin, hi: p25,  color: 'rgba(74,128,184,0.11)'  },   // Low
        ];
        for (const z of zones) {
            const y1 = toY(Math.min(z.hi, vMax));
            const y2 = toY(Math.max(z.lo, vMin));
            if (y2 > y1) { ctx.fillStyle = z.color; ctx.fillRect(padL, y1, cW, y2 - y1); }
        }

        // ── Threshold dashes ────────────────────────────────
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 4]);
        for (const [val, col] of [[p25,'rgba(74,128,184,0.5)'],[p75,'rgba(61,184,122,0.5)'],[p90,'rgba(192,64,64,0.5)']]) {
            const y = toY(val);
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
            ctx.strokeStyle = col; ctx.stroke();
        }
        ctx.setLineDash([]);

        // ── HV line — colour-segmented by live regime ────────
        ctx.lineWidth = 1.8;
        for (let i = 1; i < series.length; i++) {
            const v = series[i];
            ctx.strokeStyle = v >= p90 ? '#c04040' : v >= p75 ? '#c07828' : v >= p25 ? '#3db87a' : '#4a80b8';
            ctx.beginPath();
            ctx.moveTo(toX(i - 1), toY(series[i - 1]));
            ctx.lineTo(toX(i),     toY(v));
            ctx.stroke();
        }

        // ── Current value dot + label ────────────────────────
        const lastV = series[series.length - 1];
        const lastX = toX(series.length - 1);
        const lastY = toY(lastV);
        const dotColor = lastV >= p90 ? '#c04040' : lastV >= p75 ? '#c07828' : lastV >= p25 ? '#3db87a' : '#4a80b8';

        ctx.beginPath();
        ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = dotColor; ctx.fill();

        ctx.font = 'bold 8px monospace';
        ctx.fillStyle = dotColor;
        ctx.textAlign = lastX > W * 0.85 ? 'right' : 'left';
        const lblX = lastX > W * 0.85 ? lastX - 7 : lastX + 7;
        ctx.fillText(lastV.toFixed(1) + '%', lblX, lastY + 3);

        // ── Y-axis tick labels ───────────────────────────────
        ctx.font = '7px monospace';
        ctx.textAlign = 'right';
        const ticks = [vMin, p25, p75, p90].filter(v => v >= vMin && v <= vMax);
        for (const tick of ticks) {
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.fillText(tick.toFixed(0) + '%', padL - 3, toY(tick) + 3);
        }

        // ── X-axis end labels ────────────────────────────────
        ctx.font = '7px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'left';
        ctx.fillText('← 90 sessions', padL, H - 4);
        ctx.textAlign = 'right';
        ctx.fillText('now →', W - padR, H - 4);
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
