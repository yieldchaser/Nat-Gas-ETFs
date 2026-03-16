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
        const pctBarsHtml = percentileWindows.map(w => {
            const val = metrics.volPercentile[w];
            const pctClass = Metrics.getPercentileClass(val);
            const width = val != null ? Math.max(2, val) : 0;
            return `
                <div class="percentile-row ${pctClass}">
                    <span class="percentile-label">${w}</span>
                    <div class="percentile-bar-bg">
                        <div class="percentile-bar-fill" style="width:${width}%"></div>
                    </div>
                    <span class="percentile-value">${val != null ? val.toFixed(0) + 'th' : '--'}</span>
                </div>`;
        }).join('');

        // VCVI values (primary — vol-adjusted capitulation index)
        const vcviEntries = ['21d', '63d', '252d'].map(w => {
            const val = (metrics.vcvi || {})[w];
            const color = val != null ? Metrics.getValueColor(val, CONFIG.thresholds.vcvi) : 'var(--text-muted)';
            return `
                <div class="indicator-block">
                    <span class="indicator-label">VCVI-${w}</span>
                    <span class="indicator-value" style="color:${color}">${val != null ? val.toFixed(0) : '--'}</span>
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
                    <span class="hv-label">HV-${w}</span>
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
                    <span class="vol-regime-badge ${regimeInfo.cls}">${regimeInfo.label}${volRegimePct != null ? ' ' + volRegimePct.toFixed(0) + 'th' : ''}</span>
                </div>
                <div class="hv-bars">${hvBarRows}</div>
                <div class="vol-panel-row">
                    <div class="vol-stat">
                        <span class="vol-stat-label">ATR-14</span>
                        <span class="vol-stat-value">${atr14Pct != null ? atr14Pct.toFixed(1) + '%' : '--'}</span>
                    </div>
                    <div class="vol-stat">
                        <span class="vol-stat-label">TERM STR</span>
                        <span class="vol-stat-value ${tsInfo.cls}">${tsInfo.arrow} ${tsInfo.label}</span>
                    </div>
                    <div class="vol-stat">
                        <span class="vol-stat-label">VoV-21</span>
                        <span class="vol-stat-value" style="color:${vovColor}">${vov21 != null ? vov21.toFixed(0) + '%' : '--'}</span>
                    </div>
                </div>
            </div>`;

        // VPS
        const vpsColor = Metrics.getValueColor(metrics.vps, CONFIG.thresholds.vps);

        // MWCA
        const mwcaHtml = metrics.mwca
            ? '<span class="mwca-badge active">MWCA ACTIVE</span>'
            : `<span class="mwca-badge inactive">${metrics.mwcaCount}/${CONFIG.windows.percentile.length}</span>`;

        return `
            <div class="etf-card ${alertClass}" data-ticker="${ticker}">
                <div class="card-header">
                    <div class="card-ticker-group">
                        <span class="card-ticker">${ticker}</span>
                        <span class="card-name">${config.name}</span>
                    </div>
                    <div class="card-price-group">
                        <span class="card-price">${this.formatPrice(c.price)}</span>
                        <span class="card-change ${changeClass}">${changeSign}${c.changePct.toFixed(2)}%</span>
                    </div>
                </div>

                <div class="card-sparkline" id="spark-${ticker.replace(/\./g, '-')}">
                    <canvas></canvas>
                </div>

                <div class="card-volume-bar" id="volbar-${ticker.replace(/\./g, '-')}">
                    <canvas></canvas>
                </div>

                <div class="card-metrics">
                    <div class="metric-item">
                        <span class="metric-label">VOL</span>
                        <span class="metric-value">${this.formatNumber(c.volume, 0)}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">RVOL-21d</span>
                        <span class="metric-value" style="color:${Metrics.getValueColor(metrics.rvol['21d'], CONFIG.thresholds.rvol)}">${metrics.rvol['21d'] != null ? metrics.rvol['21d'].toFixed(1) + 'x' : '--'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">Z-SCORE</span>
                        <span class="metric-value" style="color:${Metrics.getValueColor(metrics.zScore['21d'], CONFIG.thresholds.zScore)}">${metrics.zScore['21d'] != null ? (metrics.zScore['21d'] > 0 ? '+' : '') + metrics.zScore['21d'].toFixed(1) + '\u03C3' : '--'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">VROC-10d</span>
                        <span class="metric-value">${metrics.vroc['10d'] != null ? (metrics.vroc['10d'] > 0 ? '+' : '') + metrics.vroc['10d'].toFixed(0) + '%' : '--'}</span>
                    </div>
                </div>

                <div class="card-percentiles">
                    ${pctBarsHtml}
                </div>

                ${volatilityPanelHtml}

                <div class="card-indicators">
                    ${vcviEntries}
                    <div class="indicator-block">
                        <span class="indicator-label">VPS</span>
                        <span class="indicator-value" style="color:${vpsColor}">${metrics.vps != null ? metrics.vps.toFixed(0) : '--'}</span>
                    </div>
                    <div class="indicator-block">
                        <span class="indicator-label">MWCA</span>
                        ${mwcaHtml}
                    </div>
                </div>

                <div class="card-dollar-volume">
                    <span class="dv-label">$ VOL TRADED</span>
                    <span class="dv-value">${this.formatNumber(c.dollarVolume, 0)}</span>
                </div>
            </div>`;
    },

    renderAllCards(allMetrics, container, side) {
        const tickers = Object.keys(CONFIG.etfs).filter(t => CONFIG.etfs[t].side === side);
        const html = tickers.map(t => this.renderCard(t, allMetrics[t], CONFIG.etfs[t])).join('');
        container.innerHTML = html;

        // Draw charts after DOM update
        requestAnimationFrame(() => {
            for (const t of tickers) {
                if (!allMetrics[t]) continue;
                const safeTicker = t.replace(/\./g, '-');
                const sparkContainer = document.getElementById(`spark-${safeTicker}`);
                const volContainer = document.getElementById(`volbar-${safeTicker}`);
                if (sparkContainer) {
                    const canvas = sparkContainer.querySelector('canvas');
                    const color = CONFIG.etfs[t].side === 'long' ? '#00e676' : '#ff1744';
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
