/* ============================================================
   Historical Return Distribution & Tail Risk Engine
   Blue Meridian Platform - High-Precision Quantitative Engine
   ============================================================ */

const TailRiskDrawer = {

    // ── State ──────────────────────────────────────────────
    state: {
        ticker: 'BOIL',
        horizon: '1d',               // '1d' | '5d' | '21d'
        regime: 'trailing_252d',      // 'trailing_252d' | 'lng_era' | 'full_inception'
        isOpen: false,
        hoverBin: null,
        mouseX: null,
    },

    _data: null,
    _liveQuotes: {},
    _bound: false,
    _resizeHandler: null,

    // ── Colors ─────────────────────────────────────────────
    COLORS: {
        bg: '#0d1117',
        grid: 'rgba(255, 255, 255, 0.06)',
        axis: 'rgba(255, 255, 255, 0.15)',
        text: 'rgba(255, 255, 255, 0.55)',
        posBin: 'rgba(61, 184, 122, 0.75)',
        posBinHover: 'rgba(90, 220, 150, 1.0)',
        negBin: 'rgba(192, 64, 64, 0.75)',
        negBinHover: 'rgba(240, 90, 90, 1.0)',
        zeroLine: 'rgba(255, 255, 255, 0.40)',
        varLine: '#d4a830',
        cvarLine: '#c04040',
        needle: '#5090a0',
        needleGlow: 'rgba(80, 144, 160, 0.45)',
    },

    // ── Public Initialization ──────────────────────────────
    async init() {
        if (this._bound) return;
        this._bound = true;

        // Load distribution dataset
        try {
            const res = await fetch('data/return_distributions.json');
            if (res.ok) {
                this._data = await res.json();
            } else {
                const fallback = await fetch('docs/data/return_distributions.json');
                if (fallback.ok) {
                    this._data = await fallback.json();
                }
            }
        } catch (e) {
            console.warn('TailRiskDrawer data load exception:', e);
        }

        // Bind keyboard Escape to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.state.isOpen) {
                this.close();
            }
        });

        // Window resize debounced listener
        window.addEventListener('resize', () => {
            if (this.state.isOpen) {
                clearTimeout(this._resizeHandler);
                this._resizeHandler = setTimeout(() => {
                    this.renderHistogram();
                }, 100);
            }
        });
    },

    // ── Open / Close ───────────────────────────────────────
    open(ticker, event) {
        if (event) {
            event.stopPropagation();
            if (event.preventDefault) event.preventDefault();
        }

        if (ticker) {
            this.state.ticker = ticker;
        }

        const drawer = document.getElementById('tail-risk-drawer');
        const backdrop = document.getElementById('tail-risk-backdrop');
        if (!drawer || !backdrop) return;

        this.state.isOpen = true;
        drawer.classList.add('open');
        backdrop.classList.add('open');
        document.body.style.overflow = 'hidden';

        this.render();
    },

    close() {
        const drawer = document.getElementById('tail-risk-drawer');
        const backdrop = document.getElementById('tail-risk-backdrop');
        if (drawer) drawer.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');

        this.state.isOpen = false;
        this.state.hoverBin = null;
        document.body.style.overflow = '';

        const tt = document.getElementById('tail-risk-tooltip');
        if (tt) tt.style.display = 'none';
    },

    // ── User Actions ───────────────────────────────────────
    selectTicker(ticker) {
        if (!ticker || ticker === this.state.ticker) return;
        this.state.ticker = ticker;
        this.state.hoverBin = null;
        this.render();
    },

    setHorizon(horizonKey) {
        if (!horizonKey || horizonKey === this.state.horizon) return;
        this.state.horizon = horizonKey;
        this.state.hoverBin = null;
        this.render();
    },

    setRegime(regimeKey) {
        if (!regimeKey || regimeKey === this.state.regime) return;
        this.state.regime = regimeKey;
        this.state.hoverBin = null;
        this.render();
    },

    // ── Live Price Hook ────────────────────────────────────
    updateLive(ticker, livePrice, prevClose) {
        if (!ticker || !Number.isFinite(livePrice) || !Number.isFinite(prevClose) || prevClose <= 0) return;
        const chgPct = ((livePrice - prevClose) / prevClose) * 100.0;
        if (!Number.isFinite(chgPct)) return;
        this._liveQuotes[ticker] = {
            price: livePrice,
            prevClose: prevClose,
            changePct: chgPct,
            time: Date.now(),
        };

        // If drawer is open on this ticker, refresh shock banner and needle
        if (this.state.isOpen && this.state.ticker === ticker) {
            this._renderShockBanner();
            this.renderHistogram();
        }
    },

    // ── Primary Render Dispatcher ──────────────────────────
    render() {
        if (!this._data || !this._data.instruments) {
            this._renderEmpty('Data loading or unavailable');
            return;
        }

        const inst = this._data.instruments[this.state.ticker];
        if (!inst) {
            this._renderEmpty(`Instrument ${this.state.ticker} not found`);
            return;
        }

        this._renderHeader(inst);
        this._renderTickerChips();
        this._renderControls();
        this._renderShockBanner();
        this._renderKpis(inst);
        this.renderHistogram();
        this.renderMatrix(inst);
    },

    _renderEmpty(msg) {
        const body = document.getElementById('tail-drawer-body');
        if (body) {
            body.innerHTML = `<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.45); font-size:0.85rem;">${msg}</div>`;
        }
    },

    _renderHeader(inst) {
        const titleEl = document.getElementById('tail-header-title');
        const badgeEl = document.getElementById('tail-header-badge');
        const subEl = document.getElementById('tail-header-sub');

        if (titleEl) titleEl.textContent = inst.name || inst.ticker;
        if (badgeEl) {
            badgeEl.textContent = `${inst.ticker} \u00b7 ${inst.leverage} \u00b7 ${inst.exchange}`;
            badgeEl.className = 'tail-ticker-badge ' +
                (inst.side === 'long' ? 'tail-badge-long' :
                 inst.side === 'short' ? 'tail-badge-short' : 'tail-badge-benchmark');
        }
        if (subEl) {
            subEl.textContent = `Historical Sample: ${inst.earliest_date} to ${inst.latest_date} (${inst.total_bars} Sessions)`;
        }
    },

    _renderTickerChips() {
        const container = document.getElementById('tail-ticker-chips');
        if (!container || !this._data?.instruments) return;

        const tickers = ['BOIL', 'KOLD', 'HNU.TO', 'HND.TO', '3NGL.L', '3NGS.L', 'NG=F'];
        container.innerHTML = tickers.map((t) => {
            const isActive = t === this.state.ticker;
            const disp = t.replace('.TO', '').replace('.L', '');
            return `<button class="tail-chip${isActive ? ' active' : ''}" onclick="TailRiskDrawer.selectTicker('${t}')">${disp}</button>`;
        }).join('');
    },

    _renderControls() {
        // Horizon tabs
        const hTabs = document.querySelectorAll('#tail-horizon-tabs .tail-tab-btn');
        hTabs.forEach((btn) => {
            const h = btn.getAttribute('data-horizon');
            btn.classList.toggle('active', h === this.state.horizon);
        });

        // Regime tabs
        const rTabs = document.querySelectorAll('#tail-regime-tabs .tail-tab-btn');
        rTabs.forEach((btn) => {
            const r = btn.getAttribute('data-regime');
            btn.classList.toggle('active', r === this.state.regime);
        });
    },

    _renderShockBanner() {
        const banner = document.getElementById('tail-shock-banner');
        if (!banner) return;

        const ticker = this.state.ticker;
        const live = this._liveQuotes[ticker];
        const inst = this._data?.instruments?.[ticker];
        const reg = inst?.regimes?.[this.state.regime];
        const hData = reg?.horizons?.['1d'];

        if (!live || live.changePct == null || !hData) {
            banner.innerHTML = `
                <div class="tail-shock-left">
                    <span class="tail-shock-dot"></span>
                    <span class="tail-shock-title">LIVE MONITOR PENDING</span>
                    <span class="tail-shock-metrics">Waiting for session tick\u2026</span>
                </div>
                <div class="tail-shock-right">
                    <span class="tail-shock-badge tail-shock-normal">STANDBY</span>
                </div>`;
            return;
        }

        const chg = live.changePct;
        const m = hData.moments.mean;
        const s = hData.moments.std;
        const z = s > 0 ? (chg - m) / s : 0.0;
        const absZ = Math.abs(z);

        // Empirical percentile
        const bins = hData.histogram?.bins || [];
        let empPct = 50.0;
        if (bins.length > 0) {
            if (chg < bins[0].lower) {
                empPct = bins[0].cumulative_pct;
            } else if (chg > bins[bins.length - 1].upper) {
                empPct = 100.0;
            } else {
                for (let i = 0; i < bins.length; i++) {
                    if (chg <= bins[i].upper) {
                        empPct = bins[i].cumulative_pct;
                        break;
                    }
                }
            }
        }

        let shockCls = 'tail-shock-normal';
        let shockLabel = 'NORMAL REGIME';
        let desc = 'Within 1.5\u03c3 historical fluctuation';

        if (absZ >= 2.5) {
            shockCls = 'tail-shock-critical';
            shockLabel = 'CRITICAL OUTLIER';
            desc = `Severe ${z < 0 ? 'Tail Liquidation' : 'Tail Surge'} (\u00b1${absZ.toFixed(2)}\u03c3)`;
        } else if (absZ >= 1.5) {
            shockCls = 'tail-shock-elevated';
            shockLabel = 'ELEVATED SHOCK';
            desc = `High-impact ${z < 0 ? 'Drawdown' : 'Impulse'} (${absZ.toFixed(2)}\u03c3)`;
        }

        const sign = chg >= 0 ? '+' : '';
        const zSign = z >= 0 ? '+' : '';

        banner.innerHTML = `
            <div class="tail-shock-left">
                <span class="tail-shock-dot"></span>
                <span class="tail-shock-title">LIVE 1D MOVE:</span>
                <span class="tail-shock-metrics" style="color:${chg >= 0 ? '#3db87a' : '#c04040'}">${sign}${chg.toFixed(2)}% (${zSign}${z.toFixed(2)}\u03c3)</span>
                <span style="font-size:0.68rem; color:rgba(255,255,255,0.45); font-family:ui-monospace, monospace;">\u00b7 ${desc} \u00b7 ${empPct.toFixed(1)}th Pct</span>
            </div>
            <div class="tail-shock-right">
                <span class="tail-shock-badge ${shockCls}">${shockLabel}</span>
            </div>`;
    },

    _renderKpis(inst) {
        const grid = document.getElementById('tail-kpi-grid');
        if (!grid) return;

        const reg = inst.regimes[this.state.regime];
        if (!reg) return;
        const hData = reg.horizons[this.state.horizon];
        if (!hData) return;

        const m = hData.moments;
        const r = hData.risk_metrics;

        const skewShape = m.skewness < -0.5 ? 'Heavy Left Tail' :
                          m.skewness > 0.5 ? 'Heavy Right Tail' : 'Symmetric';
        const kurtShape = m.excess_kurtosis > 1.0 ? 'Fat-Tailed (Leptokurtic)' :
                          m.excess_kurtosis < -1.0 ? 'Thin-Tailed (Platykurtic)' : 'Mesokurtic';

        const kpis = [
            {
                label: 'Mean / Median',
                val: `${(m.mean >= 0 ? '+' : '') + m.mean.toFixed(2)}% / ${(m.median >= 0 ? '+' : '') + m.median.toFixed(2)}%`,
                sub: `Expected Return (${hData.n_observations} obs)`,
                color: m.mean >= 0 ? '#3db87a' : '#c04040',
                tooltip: '&lt;strong&gt;Expected Return (First Moment)&lt;/strong&gt;&lt;br&gt;Arithmetic mean versus 50th percentile median. A median higher than mean reveals negative left-tail skew dragging arithmetic performance.',
            },
            {
                label: 'Annualized Realized Vol',
                val: `${m.ann_volatility.toFixed(1)}%`,
                sub: `Daily std: ${m.std.toFixed(2)}%`,
                color: '#d4a830',
                tooltip: '&lt;strong&gt;Annualized Realized Volatility&lt;/strong&gt;&lt;br&gt;Sample standard deviation scaled by the square root of 252 trading sessions. Quantifies annual dispersion and portfolio variance.',
            },
            {
                label: 'Skewness (G1)',
                val: `${m.skewness.toFixed(2)}`,
                sub: skewShape,
                color: m.skewness < 0 ? '#c04040' : '#3db87a',
                tooltip: '&lt;strong&gt;Fisher-Pearson Skewness (Third Moment)&lt;/strong&gt;&lt;br&gt;Degree of distribution asymmetry. Negative values denote heavy left-tail liquidation risk; positive values reflect explosive right-tail spikes.',
            },
            {
                label: 'Excess Kurtosis (G2)',
                val: `${m.excess_kurtosis.toFixed(2)}`,
                sub: kurtShape,
                color: m.excess_kurtosis > 3.0 ? '#ff5555' : 'rgba(255,255,255,0.85)',
                tooltip: '&lt;strong&gt;Fisher Excess Kurtosis (Fourth Moment)&lt;/strong&gt;&lt;br&gt;Tail fatness relative to a normal Gaussian curve (0.0). High positive values indicate leptokurtic fat tails where extreme tail events occur far more frequently.',
            },
            {
                label: 'Empirical VaR 95%',
                val: `${r.var_95.toFixed(2)}%`,
                sub: 'Worst 5th Percentile Return',
                color: '#d4a830',
                tooltip: '&lt;strong&gt;Empirical Value-at-Risk (95% Confidence)&lt;/strong&gt;&lt;br&gt;The 5th percentile worst historical loss. Losses do not exceed this cutoff on 95% of historical trading periods.',
            },
            {
                label: 'Expected Shortfall (CVaR 95%)',
                val: `${r.cvar_95.toFixed(2)}%`,
                sub: 'Mean Loss in 5% Tail',
                color: '#c04040',
                tooltip: '&lt;strong&gt;Expected Shortfall / CVaR 95%&lt;/strong&gt;&lt;br&gt;The conditional expectation of loss given that the loss has exceeded the 95% VaR threshold. Quantifies the average severity of tail risk breaches.',
            },
            {
                label: 'Empirical VaR 99%',
                val: `${r.var_99.toFixed(2)}%`,
                sub: 'Worst 1st Percentile Extreme',
                color: '#d4a830',
                tooltip: '&lt;strong&gt;Empirical Value-at-Risk (99% Confidence)&lt;/strong&gt;&lt;br&gt;The 1st percentile boundary. Quantifies the loss threshold breached in only 1 out of 100 historical trading sessions.',
            },
            {
                label: 'Tail Shock (CVaR 99%)',
                val: `${r.cvar_99.toFixed(2)}%`,
                sub: 'Mean Loss in 1% Tail',
                color: '#ff5555',
                tooltip: '&lt;strong&gt;Extreme Tail Shock / CVaR 99%&lt;/strong&gt;&lt;br&gt;Average loss during the deepest 1% catastrophic historical tail events, capturing gap openings and extreme commodity liquidation crises.',
            },
            {
                label: 'Extrema (Gain / Drawdown)',
                val: `+${r.max_gain.toFixed(1)}% / ${r.max_drawdown.toFixed(1)}%`,
                sub: `Range: ${(r.max_gain - r.max_drawdown).toFixed(1)}pp`,
                color: '#f0f4fc',
                tooltip: '&lt;strong&gt;Historical Sample Extrema&lt;/strong&gt;&lt;br&gt;Maximum single-period surge and deepest peak-to-trough single-period drawdown realized across the selected regime.',
            },
            {
                label: 'Positive Win Rate',
                val: `${r.win_rate.toFixed(1)}%`,
                sub: `Green vs Red Frequency`,
                color: r.win_rate >= 50 ? '#3db87a' : '#c04040',
                tooltip: '&lt;strong&gt;Empirical Win Rate&lt;/strong&gt;&lt;br&gt;Percentage of sessions closing positive (&gt; 0.0%). Evaluates directional momentum versus beta erosion and leveraged volatility drag.',
            },
        ];

        grid.innerHTML = kpis.map((k) => `
            <div class="tail-kpi-card" data-tooltip="${k.tooltip}">
                <span class="tail-kpi-label">${k.label}</span>
                <span class="tail-kpi-value" style="color:${k.color}">${k.val}</span>
                <span class="tail-kpi-sub">${k.sub}</span>
            </div>
        `).join('');
    },

    // ── High-DPI Histogram Canvas Rendering ────────────────
    renderHistogram() {
        const canvas = document.getElementById('tail-risk-canvas');
        if (!canvas) return;

        const inst = this._data?.instruments?.[this.state.ticker];
        const reg = inst?.regimes?.[this.state.regime];
        const hData = reg?.horizons?.[this.state.horizon];
        if (!hData || !hData.histogram) return;

        const hist = hData.histogram;
        const bins = hist.bins || [];
        if (bins.length === 0) return;

        // Set up high-DPI 2x backing store
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = rect.width;
        const h = rect.height;

        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);

        const ctx = canvas.getContext('2d');
        ctx.resetTransform();
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, w, h);

        // Chart Area Padding
        const pad = { top: 28, right: 32, bottom: 34, left: 54 };
        const chartW = w - pad.left - pad.right;
        const chartH = h - pad.top - pad.bottom;

        // Find max count for Y-axis scaling
        let maxCount = 0;
        for (let i = 0; i < bins.length; i++) {
            if (bins[i].count > maxCount) maxCount = bins[i].count;
        }
        if (maxCount === 0) maxCount = 1;
        // 10% headroom
        const yMax = Math.ceil(maxCount * 1.10);

        // Coordinate helper functions
        const rangeMin = hist.range_min;
        const rangeMax = hist.range_max;
        const rangeSpan = rangeMax - rangeMin;

        const xCoord = (rVal) => pad.left + ((rVal - rangeMin) / rangeSpan) * chartW;
        const yCoord = (cnt) => pad.top + chartH - (cnt / yMax) * chartH;

        // Horizontal Grid Lines & Y-axis labels
        const gridSteps = 4;
        ctx.lineWidth = 1;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '9px ui-monospace, monospace';

        for (let g = 0; g <= gridSteps; g++) {
            const val = Math.round((yMax / gridSteps) * g);
            const y = yCoord(val);

            ctx.strokeStyle = this.COLORS.grid;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();

            ctx.fillStyle = this.COLORS.text;
            ctx.fillText(String(val), pad.left - 8, y);
        }

        // Draw 80 Histogram Bars
        const barSpacing = 0.5;
        for (let i = 0; i < bins.length; i++) {
            const b = bins[i];
            const x1 = xCoord(b.lower);
            const x2 = xCoord(b.upper);
            const barW = Math.max(1, x2 - x1 - barSpacing);
            const barH = (b.count / yMax) * chartH;
            const barY = pad.top + chartH - barH;

            const isHovered = (this.state.hoverBin && this.state.hoverBin.bin_index === b.bin_index);

            if (b.is_negative) {
                ctx.fillStyle = isHovered ? this.COLORS.negBinHover : this.COLORS.negBin;
            } else {
                ctx.fillStyle = isHovered ? this.COLORS.posBinHover : this.COLORS.posBin;
            }

            ctx.fillRect(x1, barY, barW, barH);

            if (isHovered) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x1, barY, barW, barH);
            }
        }

        // X-Axis Baseline
        ctx.strokeStyle = this.COLORS.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top + chartH);
        ctx.lineTo(w - pad.right, pad.top + chartH);
        ctx.stroke();

        // Zero Baseline Vertical Line (at R = 0.00%)
        const zeroX = xCoord(0.0);
        ctx.strokeStyle = this.COLORS.zeroLine;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(zeroX, pad.top);
        ctx.lineTo(zeroX, pad.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Zero Label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('0.00%', zeroX, pad.top + chartH + 6);

        // Outer Range Labels
        ctx.fillStyle = this.COLORS.text;
        ctx.textAlign = 'left';
        ctx.fillText(`${rangeMin.toFixed(1)}%`, pad.left, pad.top + chartH + 6);
        ctx.textAlign = 'right';
        ctx.fillText(`+${rangeMax.toFixed(1)}%`, w - pad.right, pad.top + chartH + 6);

        // Draw VaR-95% Vertical Dashed Line
        const var95 = hData.risk_metrics.var_95;
        const varX = xCoord(var95);
        if (varX >= pad.left && varX <= w - pad.right) {
            ctx.strokeStyle = this.COLORS.varLine;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(varX, pad.top);
            ctx.lineTo(varX, pad.top + chartH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Badge tag
            ctx.fillStyle = this.COLORS.varLine;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = 'bold 9px ui-monospace, monospace';
            ctx.fillText(`VaR-95: ${var95.toFixed(1)}%`, varX, pad.top - 4);
        }

        // Draw CVaR-95% Vertical Dashed Line
        const cvar95 = hData.risk_metrics.cvar_95;
        const cvarX = xCoord(cvar95);
        if (cvarX >= pad.left && cvarX <= w - pad.right) {
            ctx.strokeStyle = this.COLORS.cvarLine;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(cvarX, pad.top + 10);
            ctx.lineTo(cvarX, pad.top + chartH);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = this.COLORS.cvarLine;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = 'bold 9px ui-monospace, monospace';
            ctx.fillText(`CVaR: ${cvar95.toFixed(1)}%`, cvarX, pad.top + 8);
        }

        // Draw Live Real-Time Outlier Needle
        const live = this._liveQuotes[this.state.ticker];
        if (live && live.changePct != null && this.state.horizon === '1d') {
            const chg = live.changePct;
            const rawNeedleX = xCoord(chg);
            const isOutOfBoundsLeft = chg < rangeMin;
            const isOutOfBoundsRight = chg > rangeMax;
            const isOutOfBounds = isOutOfBoundsLeft || isOutOfBoundsRight;

            let needleX = Math.max(pad.left, Math.min(w - pad.right, rawNeedleX));

            ctx.save();
            const needleColor = isOutOfBounds ? (isOutOfBoundsLeft ? '#ff5555' : '#3db87a') : this.COLORS.needle;
            ctx.shadowColor = needleColor;
            ctx.shadowBlur = 10;

            // Needle vertical line
            ctx.strokeStyle = needleColor;
            ctx.lineWidth = 2;
            if (isOutOfBounds) {
                ctx.setLineDash([4, 3]);
            }
            ctx.beginPath();
            ctx.moveTo(needleX, pad.top);
            ctx.lineTo(needleX, pad.top + chartH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Marker at top: arrow chevron if out-of-bounds, glowing circular cap if in-bounds
            if (isOutOfBoundsLeft) {
                ctx.fillStyle = '#ff5555';
                ctx.beginPath();
                ctx.moveTo(pad.left + 8, pad.top - 6);
                ctx.lineTo(pad.left, pad.top);
                ctx.lineTo(pad.left + 8, pad.top + 6);
                ctx.closePath();
                ctx.fill();
            } else if (isOutOfBoundsRight) {
                ctx.fillStyle = '#3db87a';
                ctx.beginPath();
                ctx.moveTo(w - pad.right - 8, pad.top - 6);
                ctx.lineTo(w - pad.right, pad.top);
                ctx.lineTo(w - pad.right - 8, pad.top + 6);
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(needleX, pad.top, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = needleColor;
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            ctx.restore();

            // Needle live badge callout pill
            const m = hData.moments.mean;
            const s = hData.moments.std;
            const z = s > 0 ? (chg - m) / s : 0.0;
            const chgSign = chg >= 0 ? '+' : '';
            const zSign = z >= 0 ? '+' : '';
            const tagStr = isOutOfBoundsLeft
                ? `\u25c0 OUTLIER: ${chgSign}${chg.toFixed(2)}% (${zSign}${z.toFixed(1)}\u03c3)`
                : isOutOfBoundsRight
                ? `OUTLIER \u25b6: ${chgSign}${chg.toFixed(2)}% (${zSign}${z.toFixed(1)}\u03c3)`
                : `LIVE: ${chgSign}${chg.toFixed(2)}% (${zSign}${z.toFixed(1)}\u03c3)`;

            ctx.font = 'bold 9px ui-monospace, monospace';
            const pillW = Math.round(ctx.measureText(tagStr).width + 12);
            const pillH = 17;
            const pillY = pad.top + 14;
            let pillX = Math.round(needleX - pillW / 2);
            pillX = Math.max(pad.left + 2, Math.min(w - pad.right - pillW - 2, pillX));

            ctx.save();
            ctx.fillStyle = 'rgba(13, 17, 23, 0.94)';
            ctx.strokeStyle = needleColor;
            ctx.lineWidth = 1;

            if (typeof ctx.roundRect === 'function') {
                ctx.beginPath();
                ctx.roundRect(pillX, pillY, pillW, pillH, 3);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fillRect(pillX, pillY, pillW, pillH);
                ctx.strokeRect(pillX, pillY, pillW, pillH);
            }

            ctx.fillStyle = needleColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tagStr, pillX + pillW / 2, pillY + pillH / 2);
            ctx.restore();
        }

        // Mouse Hover Crosshair and Bin Highlighting
        if (this.state.mouseX != null && this.state.mouseX >= pad.left && this.state.mouseX <= w - pad.right) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(this.state.mouseX, pad.top);
            ctx.lineTo(this.state.mouseX, pad.top + chartH);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Bind interactive mouse events once
        this._bindCanvasEvents(canvas, pad, chartW, chartH, rangeMin, rangeSpan, bins);
    },

    _bindCanvasEvents(canvas, pad, chartW, chartH, rangeMin, rangeSpan, bins) {
        if (canvas._eventsBound) return;
        canvas._eventsBound = true;

        const tt = document.getElementById('tail-risk-tooltip');

        const onMove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (mouseX < pad.left || mouseX > rect.width - pad.right) {
                this.state.mouseX = null;
                this.state.hoverBin = null;
                if (tt) tt.style.display = 'none';
                this.renderHistogram();
                return;
            }

            this.state.mouseX = mouseX;

            // Calculate return at mouseX using current logical chart width
            const currentChartW = rect.width - pad.left - pad.right;
            const rHover = rangeMin + ((mouseX - pad.left) / currentChartW) * rangeSpan;

            // Locate bin
            let matchedBin = null;
            for (let i = 0; i < bins.length; i++) {
                const b = bins[i];
                if (b.is_negative) {
                    if (rHover >= b.lower && rHover < b.upper) {
                        matchedBin = b;
                        break;
                    }
                } else {
                    if (b.bin_index === 40) {
                        if (rHover >= 0.0 && rHover <= b.upper) {
                            matchedBin = b;
                            break;
                        }
                    } else {
                        if (rHover > b.lower && rHover <= b.upper) {
                            matchedBin = b;
                            break;
                        }
                    }
                }
            }

            this.state.hoverBin = matchedBin;
            this.renderHistogram();

            if (matchedBin && tt) {
                tt.style.display = 'block';
                tt.innerHTML = `
                    <div class="tail-tt-header">${matchedBin.lower.toFixed(2)}% to ${matchedBin.upper.toFixed(2)}%</div>
                    <div class="tail-tt-row"><span class="tail-tt-lbl">Sessions:</span><span class="tail-tt-val">${matchedBin.count}</span></div>
                    <div class="tail-tt-row"><span class="tail-tt-lbl">Frequency:</span><span class="tail-tt-val">${(matchedBin.density * 100).toFixed(2)}%</span></div>
                    <div class="tail-tt-row"><span class="tail-tt-lbl">Cumulative:</span><span class="tail-tt-val">${matchedBin.cumulative_pct.toFixed(1)}%</span></div>
                    <div class="tail-tt-row"><span class="tail-tt-lbl">Tail Direction:</span><span class="tail-tt-val" style="color:${matchedBin.is_negative ? '#c04040' : '#3db87a'}">${matchedBin.is_negative ? 'Negative Return' : 'Positive Return'}</span></div>
                `;

                // Position tooltip
                let ttX = mouseX + 16;
                if (ttX + 170 > rect.width) {
                    ttX = mouseX - 180;
                }
                let ttY = mouseY - 40;
                if (ttY < 10) ttY = 10;

                tt.style.left = `${ttX}px`;
                tt.style.top = `${ttY}px`;
            }
        };

        const onLeave = () => {
            this.state.mouseX = null;
            this.state.hoverBin = null;
            if (tt) tt.style.display = 'none';
            this.renderHistogram();
        };

        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseleave', onLeave);
    },

    // ── Forward Return Expectancy Matrix Table ─────────────
    renderMatrix(inst) {
        const wrap = document.getElementById('tail-matrix-wrap');
        if (!wrap) return;

        const reg = inst.regimes[this.state.regime];
        if (!reg || !reg.expectancy_matrix) {
            wrap.innerHTML = '<div style="padding:15px; color:rgba(255,255,255,0.45);">No matrix data for this regime.</div>';
            return;
        }

        const rows = reg.expectancy_matrix;

        const html = `
            <table class="tail-table tail-matrix-table">
                <thead>
                    <tr>
                        <th>REGIME / CONDITION</th>
                        <th>TRIGGER DEFINITION</th>
                        <th style="text-align:right;">SAMPLES</th>
                        <th style="text-align:right;">FWD 1D WIN% (MEAN)</th>
                        <th style="text-align:right;">FWD 5D WIN% (MEAN)</th>
                        <th style="text-align:right;">FWD 10D WIN% (MEAN)</th>
                        <th>STATISTICAL EDGE</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((r) => {
                        const edgeCls = r.fwd_1d.edge === 'Strong Bullish Edge' ? 'tail-edge-strong-bull' :
                                        r.fwd_1d.edge === 'Moderate Bullish Edge' ? 'tail-edge-mod-bull' :
                                        r.fwd_1d.edge === 'Strong Bearish Edge' ? 'tail-edge-strong-bear' :
                                        r.fwd_1d.edge === 'Moderate Bearish Edge' ? 'tail-edge-mod-bear' :
                                        'tail-edge-neutral';

                        const fwdFmt = (f) => {
                            if (f.count === 0 || f.win_rate == null) return '\u2014';
                            const meanSign = f.mean >= 0 ? '+' : '';
                            const color = f.mean >= 0 ? '#3db87a' : '#c04040';
                            return `${f.win_rate.toFixed(0)}% <span style="color:${color}">(${meanSign}${f.mean.toFixed(1)}%)</span>`;
                        };

                        return `
                            <tr>
                                <td style="font-weight:700; color:#f0f4fc;">${r.label}</td>
                                <td style="color:rgba(255,255,255,0.50);">${r.definition}</td>
                                <td style="text-align:right;">${r.count}</td>
                                <td style="text-align:right;">${fwdFmt(r.fwd_1d)}</td>
                                <td style="text-align:right;">${fwdFmt(r.fwd_5d)}</td>
                                <td style="text-align:right;">${fwdFmt(r.fwd_10d)}</td>
                                <td><span class="tail-edge-badge ${edgeCls}">${r.fwd_1d.edge}</span></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        wrap.innerHTML = html;
    },
};
