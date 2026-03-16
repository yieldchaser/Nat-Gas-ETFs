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

        // CVI values
        const cviEntries = ['21d', '63d', '252d'].map(w => {
            const val = metrics.cvi[w];
            const color = val != null ? Metrics.getValueColor(val, CONFIG.thresholds.cvi) : 'var(--text-muted)';
            return `
                <div class="indicator-block">
                    <span class="indicator-label">CVI-${w}</span>
                    <span class="indicator-value" style="color:${color}">${val != null ? val.toFixed(0) : '--'}</span>
                </div>`;
        }).join('');

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

                <div class="card-indicators">
                    ${cviEntries}
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
