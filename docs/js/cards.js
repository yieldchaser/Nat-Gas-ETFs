/* ============================================
   ETF Card Rendering
   ============================================ */

const Cards = {

    formatNumber(n, decimals = 2) {
        if (n == null || isNaN(n)) return '--';
        if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toFixed(decimals);
    },

    formatPrice(n) {
        if (n == null) return '--';
        if (n >= 10000) return n.toFixed(0);
        if (n >= 100) return n.toFixed(2);
        if (n >= 1) return n.toFixed(2);
        return n.toFixed(4);
    },

    formatPct(n) {
        if (n == null) return '--';
        return n.toFixed(1) + '%';
    },

    renderCard(ticker, metrics, config) {
        if (!metrics) {
            return `
                <div class="etf-card">
                    <div class="card-header">
                        <div class="card-ticker-group">
                            <span class="card-ticker">${ticker}</span>
                        </div>
                        <span class="text-muted" style="font-size:0.7rem">No data available</span>
                    </div>
                </div>`;
        }

        const c = metrics.current;
        const changeClass = c.changePct >= 0 ? 'positive' : 'negative';
        const changeSign = c.changePct >= 0 ? '+' : '';
        const alertClass = metrics.alertLevel !== 'none' ? `alert-${metrics.alertLevel}` : '';

        // Percentile bars
        const percentileWindows = ['10d', '21d', '63d', '126d', '252d'];
        const pctTips = {
            '10d': 'Volume percentile vs 10-day history — short-term context',
            '21d': 'Volume percentile vs 21-day history — monthly context',
            '63d': 'Volume percentile vs 63-day history — quarterly context',
            '126d': 'Volume percentile vs 126-day history — semi-annual context',
            '252d': 'Volume percentile vs 252-day history — full-year context'
        };
        const pctBarsHtml = percentileWindows.map(w => {
            const val = metrics.volPercentile[w];
            const pctClass = Metrics.getPercentileClass(val);
            const width = val != null ? Math.max(2, val) : 0;
            return `
                <div class="percentile-row ${pctClass}">
                    <span class="percentile-label" data-tooltip="${pctTips[w]}">${w}</span>
                    <div class="percentile-bar-bg">
                        <div class="percentile-bar-fill" style="width:${width}%"></div>
                    </div>
                    <span class="percentile-value">${val != null ? val.toFixed(0) + 'th' : '--'}</span>
                </div>`;
        }).join('');

        // VCVI values (primary — vol-adjusted capitulation index)
        // Show 5d fast-window first, then 21d and 63d with decay-adj badge if available
        const decay = metrics.decay || {};
        const seasonality = metrics.seasonality || {};
        const seasonCfg = seasonality.season ? (CONFIG.seasonDisplay[seasonality.season] || {}) : {};
        const seasonBadge = seasonality.season
            ? `<span class="season-badge" style="color:${seasonCfg.color||'var(--text-muted)'}" data-tooltip="Seasonal weight: ${seasonality.season} × ${(seasonality.weight||1).toFixed(2)} — amplifies vol signals in high-demand seasons. Seasonally-adj VCVI-21d: ${seasonality.adj_vcvi_21d != null ? seasonality.adj_vcvi_21d.toFixed(0) : '--'} (share-vol mode only)">${seasonCfg.emoji||''} ×${(seasonality.weight||1).toFixed(2)}</span>`
            : '';

        const spikeHtml = metrics.sharpSpike
            ? `<span class="spike-badge" data-tooltip="SHARP SPIKE: 5d VCVI + move > 2×ATR. ${metrics.fastSignal === 'weather_top_candidate' ? 'Weather Top Candidate — gas may have peaked.' : 'Weather Bottom Candidate — gas may have bottomed.'}">⚡ SPIKE</span>`
            : '';

        const vcviEntries = ['5d', '21d', '63d'].map(w => {
            const val = (metrics.vcvi || {})[w];
            const color = val != null ? Metrics.getValueColor(val, CONFIG.thresholds.vcvi) : 'var(--text-muted)';
            // Show decay-adjusted value alongside 21d if available
            let decayNote = '';
            if (w === '21d' && decay.correction_active && decay.adj_vcvi_21d != null) {
                const diff = decay.adj_vcvi_21d - (val || 0);
                const diffStr = diff >= 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0);
                const adjColor = Metrics.getValueColor(decay.adj_vcvi_21d, CONFIG.thresholds.vcvi);
                decayNote = ` <span style="color:${adjColor};font-size:0.65rem" data-tooltip="Decay-corrected VCVI-21d: removes ETF price drift due to daily rebalancing decay (~${(decay.annual_rate*100).toFixed(0)}%/yr). Raw: ${val!=null?val.toFixed(0):'--'}, Adj: ${decay.adj_vcvi_21d.toFixed(0)} (${diffStr})">†${decay.adj_vcvi_21d.toFixed(0)}</span>`;
            }
            return `
                <div class="indicator-block">
                    <span class="indicator-label" data-tooltip="Vol-Adjusted Capitulation Index (${w}). ${w==='5d'?'FAST window — weather event detection. Threshold: 45.':'Quiet regimes ×1.5, turbulent ×0.5.'} Scale 0–100.">VCVI-${w}</span>
                    <span class="indicator-value" style="color:${color}">${val != null ? val.toFixed(0) : '--'}${decayNote}</span>
                </div>`;
        }).join('');

        // Build Volatility Panel
        const vol = metrics.volatility || {};
        const volRegimePct    = vol.volRegimePct    ?? null;
        const hvTermStructure = vol.hvTermStructure ?? null;
        const atr14Pct        = vol.atr14Pct        ?? null;
        const vov21           = vol.vov21           ?? null;
        const hv              = vol.hv              || {};

        const regimeInfo = Metrics.getVolRegimeLabel(volRegimePct);
        const tsInfo     = Metrics.getTermStructureLabel(hvTermStructure);

        // HV bars — show HV10d and HV21d; bar fill capped at 300% HV as max width
        const HV_BAR_MAX = 300; // 300% annualized HV = 100% bar width
        const hvBarRows = ['10d', '21d', '63d'].map(w => {
            const v = hv[w];
            const fill = v != null ? Math.min(100, (v / HV_BAR_MAX) * 100) : 0;
            // Colour by regime percentile, not by absolute level (since leveraged ETFs are always "high")
            const barClass = volRegimePct == null ? 'hv-bar-quiet'
                : volRegimePct >= 80 ? 'hv-bar-extreme'
                : volRegimePct >= 60 ? 'hv-bar-high'
                : volRegimePct >= 30 ? 'hv-bar-normal'
                : 'hv-bar-low';
            return `
                <div class="hv-row">
                    <span class="hv-label" data-tooltip="${w === '10d' ? 'HV-10d: 10-day realized vol (annualized %). Most sensitive to recent moves.' : w === '21d' ? 'HV-21d: 21-day realized vol (annualized %). Used for vol regime classification.' : 'HV-63d: 63-day (quarterly) realized vol. Medium-term volatility trend.'}" data-tt-pos="right">HV-${w}</span>
                    <div class="hv-bar-bg">
                        <div class="hv-bar-fill ${barClass}" style="width:${fill}%"></div>
                    </div>
                    <span class="hv-value">${v != null ? v.toFixed(0) + '%' : '--'}</span>
                </div>`;
        }).join('');

        // VoV colour
        const vovColor = vov21 == null ? 'var(--text-muted)'
            : vov21 >= CONFIG.thresholds.vov.extreme  ? 'var(--purple)'
            : vov21 >= CONFIG.thresholds.vov.critical ? 'var(--red)'
            : vov21 >= CONFIG.thresholds.vov.high     ? 'var(--orange)'
            : vov21 >= CONFIG.thresholds.vov.elevated ? 'var(--yellow)'
            : 'var(--blue)';

        const volatilityPanelHtml = `
            <div class="card-volatility">
                <div class="vol-panel-header">
                    <span class="vol-panel-title">VOLATILITY</span>
                    <span class="vol-regime-badge ${regimeInfo.cls}" data-tooltip="Vol Regime Percentile — where today's HV21 sits within its own 252-day history. 0th = historically quiet (signals stronger). 100th = historically extreme (signals discounted). Current: ${volRegimePct != null ? volRegimePct.toFixed(0) + 'th pct' : '--'}">${regimeInfo.label}${volRegimePct != null ? ' ' + volRegimePct.toFixed(0) + 'th' : ''}</span>
                </div>
                <div class="hv-bars">${hvBarRows}</div>
                <div class="vol-panel-row">
                    <div class="vol-stat">
                        <span class="vol-stat-label" data-tooltip="Average True Range (14-day) as % of current price — the expected daily trading range. Today's ATR: ${atr14Pct != null ? atr14Pct.toFixed(1) + '% of price' : '--'}. Use to judge if today's move is anomalous.">ATR-14</span>
                        <span class="vol-stat-value">${atr14Pct != null ? atr14Pct.toFixed(1) + '%' : '--'}</span>
                    </div>
                    <div class="vol-stat">
                        <span class="vol-stat-label" data-tooltip="HV Term Structure — ratio of HV10 ÷ HV63. Below 0.65: short-term vol calming (storm passed). Above 1.35: short-term vol surging (storm building). Current: ${hvTermStructure != null ? hvTermStructure.toFixed(2) + 'x' : '--'}">TERM STR</span>
                        <span class="vol-stat-value ${tsInfo.cls}">${tsInfo.arrow} ${tsInfo.label}</span>
                    </div>
                    <div class="vol-stat">
                        <span class="vol-stat-label" data-tooltip="Vol-of-Vol (21d) — std dev of the 10d HV series over 21 days, in percentage points. Measures regime instability: how much the short-term realized vol is itself fluctuating. High VoV = unstable regime, potential for sudden vol spike.">VoV-21</span>
                        <span class="vol-stat-value" style="color:${vovColor}">${vov21 != null ? vov21.toFixed(0) + 'pp' : '--'}</span>
                    </div>
                </div>
            </div>`;

        // VPS
        const vpsColor = Metrics.getValueColor(metrics.vps, CONFIG.thresholds.vps);

        // MWCA
        const mwcaHtml = metrics.mwca
            ? '<span class="mwca-badge active">MWCA ACTIVE</span>'
            : `<span class="mwca-badge inactive">${metrics.mwcaCount}/${CONFIG.windows.percentile.length}</span>`;

        // Dollar mode metrics
        const dv = metrics.dvRvol || {};
        const dvZ = metrics.dvZScore || {};
        const dvP = metrics.dvPercentile || {};
        const dvVr = metrics.dvVroc || {};
        const dvcvi = metrics.dvcvi || {};
        const dvVps = metrics.dvVps;
        const vdds = metrics.vdds;

        // DV-RVOL-21d colour
        const dvRvol21Color = Metrics.getValueColor(dv['21d'], CONFIG.thresholds.rvol);
        const dvZ21Color = Metrics.getValueColor(dvZ['21d'], CONFIG.thresholds.zScore);

        // DV percentile bars
        const dvPctBarsHtml = percentileWindows.map(w => {
            const val = dvP[w];
            const pctClass = Metrics.getPercentileClass(val);
            const width = val != null ? Math.max(2, val) : 0;
            return `
                <div class="percentile-row ${pctClass}">
                    <span class="percentile-label" data-tooltip="Dollar Volume percentile vs ${w} history — split-agnostic value flow">$${w}</span>
                    <div class="percentile-bar-bg">
                        <div class="percentile-bar-fill" style="width:${width}%"></div>
                    </div>
                    <span class="percentile-value">${val != null ? val.toFixed(0) + 'th' : '--'}</span>
                </div>`;
        }).join('');

        // DVCVI entries
        const dvcviEntries = ['5d', '21d', '63d'].map(w => {
            const val = dvcvi[w];
            const color = val != null ? Metrics.getValueColor(val, CONFIG.thresholds.vcvi) : 'var(--text-muted)';
            return `
                <div class="indicator-block">
                    <span class="indicator-label" data-tooltip="Dollar-Volume Capitulation Index (${w}). Same formula as VCVI but uses dollar volume percentile — doubly penalised when price is low (cheap shares AND low dollar value). Stronger capitulation signal.">DVCVI-${w}</span>
                    <span class="indicator-value" style="color:${color}">${val != null ? val.toFixed(0) : '--'}</span>
                </div>`;
        }).join('');

        // VDDS colour — < 0.85 = capitulation, > 1.15 = momentum/accumulation
        const vddsColor = vdds == null ? 'var(--text-muted)'
            : vdds < 0.75 ? 'var(--green)'
            : vdds < 0.90 ? 'var(--blue)'
            : vdds > 1.25 ? 'var(--red)'
            : vdds > 1.10 ? 'var(--orange)'
            : 'var(--text-secondary)';
        const vddsTip = `VDDS — Volume-Dollar Divergence Score: DV-RVOL-21d ÷ S-RVOL-21d. < 0.90: share volume outpacing dollar volume — price is low per unit, capitulation pattern. > 1.10: dollar value outpacing shares — price rising per unit, momentum/accumulation. Current: ${vdds != null ? vdds.toFixed(2) + 'x' : '--'}`;
        const dvVpsColor = Metrics.getValueColor(dvVps, CONFIG.thresholds.vps);

        const safeTicker = ticker.replace(/\./g, '-');

        return `
            <div class="etf-card ${alertClass}" data-ticker="${ticker}" data-mode="share">
                <div class="card-header">
                    <div class="card-ticker-group">
                        <span class="card-ticker">${ticker}</span>
                        <span class="card-name">${config.name}</span>
                        ${seasonBadge}${spikeHtml}
                    </div>
                    <div class="card-header-right">
                        <div class="mode-toggle" title="Toggle Share / Dollar Volume mode">
                            <span class="mode-pill share-pill active-pill" onclick="Cards.setMode(this,'share')">S</span>
                            <span class="mode-pill dollar-pill" onclick="Cards.setMode(this,'dollar')">$</span>
                        </div>
                        <div class="card-price-group">
                            <span class="card-price">${this.formatPrice(c.price)}</span>
                            <span class="card-change ${changeClass}">${changeSign}${c.changePct.toFixed(2)}%</span>
                        </div>
                    </div>
                </div>

                <div class="card-sparkline" id="spark-${safeTicker}">
                    <canvas></canvas>
                </div>

                <div class="card-volume-bar" id="volbar-${safeTicker}">
                    <canvas></canvas>
                </div>

                <!-- SHARE MODE sections -->
                <div class="card-metrics share-section">
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Today's raw share volume traded">VOL</span>
                        <span class="metric-value">${this.formatNumber(c.volume, 0)}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Relative Volume — today's share volume ÷ 21-day average. 2x = twice normal." data-tt-pos="right">RVOL-21d</span>
                        <span class="metric-value" style="color:${Metrics.getValueColor(metrics.rvol['21d'], CONFIG.thresholds.rvol)}">${metrics.rvol['21d'] != null ? metrics.rvol['21d'].toFixed(1) + 'x' : '--'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Z-Score — standard deviations above/below the 21-day mean share volume. &gt;2σ is statistically unusual.">Z-SCORE</span>
                        <span class="metric-value" style="color:${Metrics.getValueColor(metrics.zScore['21d'], CONFIG.thresholds.zScore)}">${metrics.zScore['21d'] != null ? (metrics.zScore['21d'] > 0 ? '+' : '') + metrics.zScore['21d'].toFixed(1) + '\u03C3' : '--'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Volume Rate of Change — % change in share volume vs 10 sessions ago." data-tt-pos="right">VROC-10d</span>
                        <span class="metric-value">${metrics.vroc['10d'] != null ? (metrics.vroc['10d'] > 0 ? '+' : '') + metrics.vroc['10d'].toFixed(0) + '%' : '--'}</span>
                    </div>
                </div>
                <div class="card-percentiles share-section">${pctBarsHtml}</div>
                <div class="card-indicators share-section">
                    ${vcviEntries}
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="Volume Pressure Score — 5-component composite: RVOL (25%) + Z-Score (20%) + Vol Percentile (25%) + VROC (10%) + Inv. Vol Regime (20%). 0–100." data-tt-pos="right">VPS</span>
                        <span class="indicator-value" style="color:${vpsColor}">${metrics.vps != null ? metrics.vps.toFixed(0) : '--'}</span>
                    </div>
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="Multi-Window Convergence Alarm — fires when share volume exceeds the 90th percentile simultaneously across ALL 5 windows." data-tt-pos="right">MWCA</span>
                        ${mwcaHtml}
                    </div>
                </div>

                <!-- DOLLAR MODE sections (hidden by default) -->
                <div class="card-metrics dollar-section" style="display:none">
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Today's dollar volume traded (price × shares). Split-agnostic capital flow metric.">$ VOL</span>
                        <span class="metric-value">${this.formatNumber(c.dollarVolume, 0)}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Dollar Volume RVOL — today's dollar volume ÷ 21-day average. Measures capital flow intensity." data-tt-pos="right">DV-RVOL</span>
                        <span class="metric-value" style="color:${dvRvol21Color}">${dv['21d'] != null ? dv['21d'].toFixed(1) + 'x' : '--'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Dollar Volume Z-Score — σ from 21-day mean dollar volume. Measures statistical significance of capital flow.">DV-Z</span>
                        <span class="metric-value" style="color:${dvZ21Color}">${dvZ['21d'] != null ? (dvZ['21d'] > 0 ? '+' : '') + dvZ['21d'].toFixed(1) + '\u03C3' : '--'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Dollar Volume Rate of Change — % change vs 10 sessions ago. Catches capital flow acceleration." data-tt-pos="right">DV-VROC</span>
                        <span class="metric-value">${dvVr['10d'] != null ? (dvVr['10d'] > 0 ? '+' : '') + dvVr['10d'].toFixed(0) + '%' : '--'}</span>
                    </div>
                </div>
                <div class="card-percentiles dollar-section" style="display:none">${dvPctBarsHtml}</div>
                <div class="card-indicators dollar-section" style="display:none">
                    ${dvcviEntries}
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="Dollar Volume Pressure Score — parallel to VPS but uses dollar volume metrics. Measures intensity of capital flow pressure. 0–100." data-tt-pos="right">DV-VPS</span>
                        <span class="indicator-value" style="color:${dvVpsColor}">${dvVps != null ? dvVps.toFixed(0) : '--'}</span>
                    </div>
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="${vddsTip}" data-tt-pos="right">VDDS</span>
                        <span class="indicator-value" style="color:${vddsColor}">${vdds != null ? vdds.toFixed(2) + 'x' : '--'}</span>
                    </div>
                </div>

                ${volatilityPanelHtml}

                <div class="card-dollar-volume">
                    <span class="dv-label">$ VOL TRADED</span>
                    <span class="dv-value">${this.formatNumber(c.dollarVolume, 0)}</span>
                </div>
            </div>`;
    },

    // Toggle between share-volume mode (S) and dollar-volume mode ($)
    setMode(pillEl, mode) {
        const card = pillEl.closest('.etf-card');
        if (!card) return;
        card.dataset.mode = mode;
        // Swap pill active state
        card.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active-pill'));
        pillEl.classList.add('active-pill');
        // Show/hide sections
        const show = mode === 'share' ? 'share-section' : 'dollar-section';
        const hide = mode === 'share' ? 'dollar-section' : 'share-section';
        card.querySelectorAll('.' + show).forEach(el => el.style.display = '');
        card.querySelectorAll('.' + hide).forEach(el => el.style.display = 'none');
    },

    renderAllCards(allMetrics, container, side) {
        const tickers = Object.keys(CONFIG.etfs).filter(t => CONFIG.etfs[t].side === side);

        // Snapshot current toggle mode per card before regenerating DOM.
        // Without this, every refresh resets all cards to default 'share' mode,
        // silently discarding the user's toggle choice.
        const savedModes = {};
        for (const card of container.querySelectorAll('.etf-card[data-ticker]')) {
            savedModes[card.dataset.ticker] = card.dataset.mode || 'share';
        }

        const html = tickers.map(t => this.renderCard(t, allMetrics[t], CONFIG.etfs[t])).join('');
        container.innerHTML = html;

        // Re-apply saved modes — re-triggers section visibility without re-rendering.
        for (const t of tickers) {
            const mode = savedModes[t];
            if (mode && mode !== 'share') {
                const card = container.querySelector(`.etf-card[data-ticker="${t}"]`);
                if (card) {
                    const pill = card.querySelector('.dollar-pill');
                    if (pill) this.setMode(pill, mode);
                }
            }
        }

        // Draw charts after DOM update
        requestAnimationFrame(() => {
            for (const t of tickers) {
                if (!allMetrics[t]) continue;
                const safeTicker = t.replace(/\./g, '-');
                const sparkContainer = document.getElementById(`spark-${safeTicker}`);
                const volContainer = document.getElementById(`volbar-${safeTicker}`);
                if (sparkContainer) {
                    const canvas = sparkContainer.querySelector('canvas');
                    const color = CONFIG.etfs[t].side === 'long' ? '#3db87a' : '#c04040';
                    Charts.drawSparkline(canvas, allMetrics[t].sparkData, color);
                }
                if (volContainer) {
                    const canvas = volContainer.querySelector('canvas');
                    Charts.drawVolumeBars(canvas, allMetrics[t].sparkData);
                }
            }
        });
    }
};
