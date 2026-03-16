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

            const ipsiTip = ipsi != null ? `IPSI ${ipsi.toFixed(2)}x — short RVOL ÷ long RVOL for this pair` : 'IPSI unavailable';
            return `
                <tr>
                    <td class="pair-name">${pair.label}</td>
                    <td style="color:${rvolColor(longRvol)}" data-tooltip="Long ETF 21d RVOL — volume relative to its own 21-day average">${longRvol != null ? longRvol.toFixed(1) + 'x' : '--'}</td>
                    <td style="color:${rvolColor(shortRvol)}" data-tooltip="Short/Inverse ETF 21d RVOL — elevated short-side RVOL signals directional capitulation">${shortRvol != null ? shortRvol.toFixed(1) + 'x' : '--'}</td>
                    <td style="color:${vcviColor}" data-tooltip="Highest VCVI-63d across long/short pair — vol-adjusted capitulation index. Threshold: 55 warning, 72 critical.">${displayVcvi != null ? displayVcvi.toFixed(0) : '--'}</td>
                    <td style="color:${ipsiColor}" data-tooltip="${ipsiTip}">${ipsi != null ? ipsi.toFixed(1) + 'x' : '--'}</td>
                    <td data-tooltip="Volatility regime — where current HV21 sits vs 252-day history. LOW/QUIET = signals more reliable in this environment."><span class="vol-regime-badge ${regInfo.cls}" style="font-size:0.6rem">${regInfo.label}</span></td>
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
            const tip = `MWCA: ${count}/${total} windows above 90th vol pct. ${count === total ? 'ALARM — all windows converging!' : count >= total - 1 ? 'Near-alarm — one window short.' : 'No alarm.'}`;
            return Charts.createGaugeRing(count, total, t, tip);
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

    // ---- HISTORICAL ECHOES ----
    renderHistoricalEchoes(allMetrics) {
        const container = document.getElementById('echoes-container');
        if (!container) return;

        // Build one card per pair
        const rows = CONFIG.pairs.map(pair => {
            const longM  = allMetrics[pair.long];
            const shortM = allMetrics[pair.short];
            const longE  = longM?.historical_echoes  || null;
            const shortE = shortM?.historical_echoes || null;

            if (!longE && !shortE) return '';

            return `
                <div class="echoes-pair-group">
                    <div class="echoes-pair-label">${pair.label}</div>
                    <div class="echoes-pair-cards">
                        ${longE  ? this._echoCard(pair.long,  longE,  'long')  : ''}
                        ${shortE ? this._echoCard(pair.short, shortE, 'short') : ''}
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = rows || '<div class="echoes-loading">No historical echo data available.</div>';
    },

    _echoCard(ticker, echoes, side) {
        if (!echoes || echoes.count === 0) {
            return `
                <div class="echo-card echo-${side}">
                    <div class="echo-ticker" style="color:${side==='long'?'var(--green)':'var(--red)'}">${ticker}</div>
                    <div class="echo-empty">No matching historical instances</div>
                </div>`;
        }

        const fwd = echoes.forward_returns;
        const rows = ['5d', '10d', '21d'].map(w => {
            const s = fwd[w];
            if (!s) return '';
            const medColor = s.median > 2  ? 'var(--green)'
                           : s.median < -2 ? 'var(--red)'
                           : 'var(--text-secondary)';
            const wrColor  = s.win_rate > 55 ? 'var(--green)'
                           : s.win_rate < 45  ? 'var(--red)'
                           : 'var(--text-secondary)';
            const sign = s.median >= 0 ? '+' : '';
            return `
                <tr>
                    <td class="echo-window" data-tooltip="Forward return statistics over ${w} trading sessions (n=${s.count})">${w}</td>
                    <td class="echo-median" style="color:${medColor}" data-tooltip="Median return — robust central tendency over ${s.count} instances">${sign}${s.median.toFixed(1)}%</td>
                    <td class="echo-winrate" style="color:${wrColor}" data-tooltip="${s.win_rate.toFixed(0)}% of ${s.count} past instances ended positive after ${w}">${s.win_rate.toFixed(0)}%</td>
                    <td class="echo-range" data-tooltip="Clipped best/worst (±200% cap to exclude data artifacts)">${s.best >= 0 ? '+' : ''}${s.best.toFixed(0)} / ${s.worst.toFixed(0)}</td>
                </tr>`;
        }).join('');

        // Determine directional bias
        const med21 = fwd['21d']?.median ?? 0;
        const wr21  = fwd['21d']?.win_rate ?? 50;
        let bias, biasClass;
        if (med21 > 3 && wr21 > 55)       { bias = '↑ Historically bullish after signal'; biasClass = 'bias-bull'; }
        else if (med21 < -3 && wr21 < 45) { bias = '↓ Historically bearish after signal'; biasClass = 'bias-bear'; }
        else                               { bias = '→ Mixed historical outcome';            biasClass = 'bias-neutral'; }

        // Recent occurrences — last 5
        const recent = (echoes.occurrences || []).slice(0, 5);
        const recentHtml = recent.map(o => {
            const ret21 = o.fwd?.['21d'];
            const retColor = ret21 == null ? 'var(--text-muted)'
                : ret21 > 0 ? 'var(--green)' : 'var(--red)';
            const retLabel = ret21 != null
                ? `${ret21 >= 0 ? '+' : ''}${ret21.toFixed(1)}% over 21d`
                : 'no fwd data';
            return `<span class="echo-past-date" style="color:${retColor}"
                data-tooltip="VCVI=${o.vcvi?.toFixed(0)} VolReg=${o.vol_regime_pct?.toFixed(0)}th @ $${o.price?.toFixed(2)} → ${retLabel}">${o.date.slice(0,7)}</span>`;
        }).join('');

        const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';
        return `
            <div class="echo-card echo-${side}">
                <div class="echo-card-header">
                    <span class="echo-ticker" style="color:${tickerColor}">${ticker}</span>
                    <span class="echo-count" data-tooltip="Total distinct signal instances found in full history (VCVI≥${echoes.threshold_vcvi}, VolRegime≤${echoes.threshold_vol_regime}th)">${echoes.count} instances</span>
                </div>
                <table class="echo-table">
                    <thead>
                        <tr>
                            <th data-tooltip="Forward window">FWD</th>
                            <th data-tooltip="Median return (robust)">MED%</th>
                            <th data-tooltip="Win rate — % positive outcomes">WIN%</th>
                            <th data-tooltip="Best / Worst clipped at ±200%">B/W</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="echo-bias ${biasClass}" data-tooltip="Based on 21-day median return and win rate across all historical instances">${bias}</div>
                <div class="echo-recent">
                    <span class="echo-recent-label">Recent:</span>
                    ${recentHtml || '<span style="color:var(--text-muted)">—</span>'}
                </div>
            </div>`;
    },

    renderAll(allMetrics) {
        this.renderAlertFeed(allMetrics);
        this.renderStressMatrix(allMetrics);
        this.renderHistoricalEchoes(allMetrics);
        this.renderHeatCalendar(allMetrics);
        this.renderConvergenceGauges(allMetrics);
        this.renderCorrelationBars(allMetrics);
        this.renderValidationBanner(allMetrics);
    }
};
