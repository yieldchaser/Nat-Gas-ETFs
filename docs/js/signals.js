/* ============================================
   Signal Command Center Rendering
   ============================================ */

const Signals = {

    // Icon/prefix for each alert type
    _alertIcon(type) {
        const icons = {
            vcvi: '⚡', cvi: '🔥', mwca: '💥', rvol: '📈', vps: '📊',
            atr_breakout: '📐', vov: '🌀', vol_regime: '🌡', ipsi_stress: '⚠'
        };
        return icons[type] || '●';
    },

    renderAlertFeed(allMetrics) {
        const feed = document.getElementById('alert-feed');
        if (!feed) return;

        // Collect all alerts from all ETFs
        const allAlerts = [];
        for (const [ticker, m] of Object.entries(allMetrics)) {
            if (m && m.alerts) {
                allAlerts.push(...m.alerts);
            }
        }

        // Sort by severity
        const severityOrder = { extreme: 0, critical: 1, high: 2, elevated: 3 };
        allAlerts.sort((a, b) => (severityOrder[a.level] || 4) - (severityOrder[b.level] || 4));

        if (allAlerts.length === 0) {
            feed.innerHTML = '<div class="no-alerts">No active alerts — all volumes within normal ranges</div>';
            return;
        }

        feed.innerHTML = allAlerts.slice(0, 15).map(a => {
            const tickerColor = CONFIG.etfs[a.ticker]?.side === 'long' ? 'var(--green)' : 'var(--red)';
            const icon = this._alertIcon(a.type);
            return `
                <div class="alert-item alert-${a.type} alert-level-${a.level}">
                    <span class="alert-time">${a.time}</span>
                    <span class="alert-ticker" style="color:${tickerColor}">${a.ticker}</span>
                    <span class="alert-icon">${icon}</span>
                    <span class="alert-message">${a.message}</span>
                </div>`;
        }).join('');
    },

    renderStressMatrix(allMetrics) {
        const tbody = document.getElementById('stress-matrix-body');
        if (!tbody) return;

        tbody.innerHTML = CONFIG.pairs.map(pair => {
            const longM  = allMetrics[pair.long];
            const shortM = allMetrics[pair.short];
            const ipsi   = Metrics.computeIPSI(longM, shortM);
            const status = Metrics.computePairStatus(ipsi);

            const longRvol  = longM?.rvol?.['21d'];
            const shortRvol = shortM?.rvol?.['21d'];

            // Use VCVI as the primary capitulation signal in the stress matrix
            const shortVcvi = shortM?.vcvi?.['63d'] ?? shortM?.cvi?.['63d'];
            const longVcvi  = longM?.vcvi?.['63d']  ?? longM?.cvi?.['63d'];
            const displayVcvi = Math.max(shortVcvi || 0, longVcvi || 0);

            // Vol regime: show the pair's long side vol regime (both should be similar)
            const volReg = longM?.volatility?.volRegimePct ?? shortM?.volatility?.volRegimePct;
            const regInfo = Metrics.getVolRegimeLabel(volReg);

            const rvolColor  = v => v != null ? Metrics.getValueColor(v, CONFIG.thresholds.rvol) : 'var(--text-muted)';
            const vcviColor  = displayVcvi != null ? Metrics.getValueColor(displayVcvi, CONFIG.thresholds.vcvi) : 'var(--text-muted)';
            const ipsiColor  = ipsi != null ? Metrics.getValueColor(ipsi, CONFIG.thresholds.ipsi) : 'var(--text-muted)';

            return `
                <tr>
                    <td class="pair-name">${pair.label}</td>
                    <td style="color:${rvolColor(longRvol)}">${longRvol != null ? longRvol.toFixed(1) + 'x' : '--'}</td>
                    <td style="color:${rvolColor(shortRvol)}">${shortRvol != null ? shortRvol.toFixed(1) + 'x' : '--'}</td>
                    <td style="color:${vcviColor}">${displayVcvi != null ? displayVcvi.toFixed(0) : '--'}</td>
                    <td style="color:${ipsiColor}">${ipsi != null ? ipsi.toFixed(1) + 'x' : '--'}</td>
                    <td><span class="vol-regime-badge ${regInfo.cls}" style="font-size:0.6rem">${regInfo.label}</span></td>
                    <td><span class="stress-status ${status}">${status.toUpperCase()}</span></td>
                </tr>`;
        }).join('');
    },

    renderHeatCalendar(allMetrics) {
        const container = document.getElementById('heat-calendar');
        if (!container) return;

        // Build daily max CVI scores across all ETFs for last 90 days
        // Use the longest available history
        const allTickers = Object.keys(allMetrics).filter(t => allMetrics[t] != null);
        if (allTickers.length === 0) return;

        // Find ETF with most data to get date index
        let longestData = [];
        for (const t of allTickers) {
            const data = allMetrics[t].sparkData;
            if (data && data.length > longestData.length) longestData = data;
        }

        // For a proper heatmap, we need to compute CVI for each historical day
        // Simplified: use volume percentile as proxy (already have sparkData)
        const days = Math.min(CONFIG.heatmapDays, longestData.length);
        const dailyScores = [];

        for (let i = longestData.length - days; i < longestData.length; i++) {
            let maxScore = 0;
            const date = longestData[i]?.date || '';

            for (const t of allTickers) {
                const sd = allMetrics[t].sparkData;
                if (!sd || i >= sd.length) continue;

                // Quick CVI proxy: how extreme is volume relative to recent mean
                const volumes = sd.slice(Math.max(0, i - 21), i + 1).map(d => d.volume);
                const closes = sd.slice(Math.max(0, i - 21), i + 1).map(d => d.close);
                if (volumes.length < 5) continue;

                const volPct = Metrics.percentileRank(volumes[volumes.length - 1], volumes);
                const pricePct = Metrics.percentileRank(closes[closes.length - 1], closes);
                const cvi = volPct * (1 - pricePct / 100);
                maxScore = Math.max(maxScore, cvi);
            }

            dailyScores.push({ date, score: maxScore });
        }

        Charts.drawHeatCalendar(container, dailyScores);
    },

    renderConvergenceGauges(allMetrics) {
        const container = document.getElementById('convergence-gauges');
        if (!container) return;

        const total = CONFIG.windows.percentile.length;
        const tickers = Object.keys(CONFIG.etfs);

        container.innerHTML = tickers.map(t => {
            const m = allMetrics[t];
            const count = m ? m.mwcaCount : 0;
            return Charts.createGaugeRing(count, total, t);
        }).join('');
    },

    renderCorrelationBars(allMetrics) {
        const container = document.getElementById('correlation-bars');
        if (!container) return;

        // Order: long first, then short
        const orderedTickers = Object.keys(CONFIG.etfs).sort((a, b) => {
            const sideA = CONFIG.etfs[a].side === 'long' ? 0 : 1;
            const sideB = CONFIG.etfs[b].side === 'long' ? 0 : 1;
            return sideA - sideB;
        });

        container.innerHTML = orderedTickers.map(t => {
            const m = allMetrics[t];
            const corr = m ? m.rollingCorr : null;
            return Charts.createCorrelationBar(t, corr, CONFIG.etfs[t].side);
        }).join('');
    },

    renderValidationBanner(allMetrics) {
        const grid = document.getElementById('validation-grid');
        if (!grid) return;

        grid.innerHTML = Object.keys(CONFIG.etfs).map(t => {
            const m = allMetrics[t];
            const corr = m ? m.rollingCorr : null;
            const side = CONFIG.etfs[t].side;
            const color = corr != null
                ? (corr < -0.1 ? 'var(--red)' : corr > 0.1 ? 'var(--green)' : 'var(--text-muted)')
                : 'var(--text-muted)';
            const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';

            return `
                <div class="validation-card">
                    <div class="ticker" style="color:${tickerColor}">${t}</div>
                    <div class="corr-value" style="color:${color}">${corr != null ? corr.toFixed(3) : '--'}</div>
                    <div class="corr-label">30d Spearman</div>
                    <div class="pvalue">${corr != null && corr < -0.2 ? 'CONFIRMED' : corr != null && corr < 0 ? 'Weak' : '--'}</div>
                </div>`;
        }).join('');
    },

    renderAll(allMetrics) {
        this.renderAlertFeed(allMetrics);
        this.renderStressMatrix(allMetrics);
        this.renderHeatCalendar(allMetrics);
        this.renderConvergenceGauges(allMetrics);
        this.renderCorrelationBars(allMetrics);
        this.renderValidationBanner(allMetrics);
    }
};
