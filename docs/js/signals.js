/* ============================================
   Signal Command Center Rendering
   ============================================ */

const Signals = {

    // Icon/prefix for each alert type
    _alertIcon(type) {
        const icons = {
            vcvi: '⚡', cvi: '🔥', mwca: '💥', rvol: '📈', vps: '📊',
            atr_breakout: '📐', vov: '🌀', vol_regime: '🌡', ipsi_stress: '⚠',
            fast_spike: '⚡', weather: '⛈'
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
            const side = a.side || CONFIG.etfs[a.ticker]?.side;
            const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';
            const icon = this._alertIcon(a.type);
            // Only show the setup badge on VCVI/CVI alerts — those are the directional ones
            const isCapAlert = a.type?.startsWith('vcvi') || a.type?.startsWith('cvi');
            const setupBadge = isCapAlert
                ? (side === 'long'
                    ? '<span class="setup-badge setup-bottom">↑ BOTTOM</span>'
                    : '<span class="setup-badge setup-top">↓ TOP</span>')
                : '';
            return `
                <div class="alert-item alert-${a.type} alert-level-${a.level}">
                    <span class="alert-time">${a.time}</span>
                    <span class="alert-ticker" style="color:${tickerColor}">${a.ticker}</span>
                    ${setupBadge}
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

            // Keep long and short VCVI separate — they signal OPPOSITE directions:
            // Long-side VCVI spike  = long ETF price low + high vol = gas BOTTOM signal
            // Short-side VCVI spike = short ETF price low + high vol = gas TOP signal
            const shortVcvi = shortM?.vcvi?.['63d'] ?? shortM?.cvi?.['63d'];
            const longVcvi  = longM?.vcvi?.['63d']  ?? longM?.cvi?.['63d'];

            // Vol regime: show the pair's long side vol regime (both should be similar)
            const volReg = longM?.volatility?.volRegimePct ?? shortM?.volatility?.volRegimePct;
            const regInfo = Metrics.getVolRegimeLabel(volReg);

            const rvolColor  = v => v != null ? Metrics.getValueColor(v, CONFIG.thresholds.rvol) : 'var(--text-muted)';
            const lCapColor  = longVcvi  != null ? Metrics.getValueColor(longVcvi,  CONFIG.thresholds.vcvi) : 'var(--text-muted)';
            const sCapColor  = shortVcvi != null ? Metrics.getValueColor(shortVcvi, CONFIG.thresholds.vcvi) : 'var(--text-muted)';
            const ipsiColor  = ipsi != null ? Metrics.getValueColor(ipsi, CONFIG.thresholds.ipsi) : 'var(--text-muted)';

            // 5d fast-window VCVI for both sides (Feature 1)
            const longVcvi5  = longM?.vcvi?.['5d']  ?? longM?.cvi?.['5d'];
            const shortVcvi5 = shortM?.vcvi?.['5d'] ?? shortM?.cvi?.['5d'];
            const anySpike   = longM?.sharpSpike || shortM?.sharpSpike;
            const spikeTicker = longM?.sharpSpike ? pair.long : shortM?.sharpSpike ? pair.short : null;

            const fastColor = v => {
                if (v == null) return 'var(--text-muted)';
                if (v >= 65) return 'var(--purple)';
                if (v >= 45) return 'var(--orange)';
                if (v >= 30) return 'var(--yellow)';
                return 'var(--text-dim)';
            };

            const ipsiTip = ipsi != null ? `IPSI ${ipsi.toFixed(2)}x — short RVOL ÷ long RVOL for this pair` : 'IPSI unavailable';

            // Season badge for this pair (use long side)
            const season = longM?.seasonality?.season;
            const sw = longM?.seasonality?.weight;
            const seasonCfg = season ? (CONFIG.seasonDisplay[season] || {}) : null;
            const seasonTag = seasonCfg
                ? `<span class="matrix-season" style="color:${seasonCfg.color}" data-tooltip="Season: ${season} ×${sw?.toFixed(2)||'1.00'}">${seasonCfg.emoji}</span>`
                : '';

            return `
                <tr>
                    <td class="pair-name">${pair.label}${seasonTag}</td>
                    <td style="color:${rvolColor(longRvol)}" data-tooltip="Long ETF 21d RVOL">${longRvol != null ? longRvol.toFixed(1) + 'x' : '--'}</td>
                    <td style="color:${rvolColor(shortRvol)}" data-tooltip="Short/Inverse ETF 21d RVOL">${shortRvol != null ? shortRvol.toFixed(1) + 'x' : '--'}</td>
                    <td style="color:${lCapColor}" data-tooltip="Long-side VCVI-63d (${pair.long}) — gas BOTTOM signal. Threshold: 55 watch, 72 critical.">${longVcvi != null ? longVcvi.toFixed(0) : '--'}</td>
                    <td style="color:${sCapColor}" data-tooltip="Short-side VCVI-63d (${pair.short}) — gas TOP signal. Threshold: 55 watch, 72 critical.">${shortVcvi != null ? shortVcvi.toFixed(0) : '--'}</td>
                    <td style="color:${fastColor(longVcvi5||shortVcvi5)}" data-tooltip="5d fast-window VCVI — L:${longVcvi5!=null?longVcvi5.toFixed(0):'—'} S:${shortVcvi5!=null?shortVcvi5.toFixed(0):'—'}. Threshold 45. Fires on weather spikes before 21d window catches up.">${longVcvi5!=null?longVcvi5.toFixed(0):'—'}/${shortVcvi5!=null?shortVcvi5.toFixed(0):'—'}</td>
                    <td data-tooltip="${anySpike?`SHARP SPIKE detected on ${spikeTicker} — move >2×ATR with VCVI-5d>45`:'No sharp spike'}">${anySpike ? '<span class="spike-badge-sm">⚡</span>' : '—'}</td>
                    <td style="color:${ipsiColor}" data-tooltip="${ipsiTip}">${ipsi != null ? ipsi.toFixed(1) + 'x' : '--'}</td>
                    <td data-tooltip="Volatility regime"><span class="vol-regime-badge ${regInfo.cls}" style="font-size:0.6rem">${regInfo.label}</span></td>
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
            // Negative correlation = inverse relationship active (green); positive = co-directional (red)
            const color = corr != null
                ? (corr < -0.2 ? 'var(--green)' : corr < -0.1 ? 'var(--text-secondary)' : corr > 0.1 ? 'var(--red)' : 'var(--text-muted)')
                : 'var(--text-muted)';
            const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';

            return `
                <div class="validation-card">
                    <div class="ticker" style="color:${tickerColor}">${t}</div>
                    <div class="corr-value" style="color:${color}">${corr != null ? corr.toFixed(3) : '--'}</div>
                    <div class="corr-label">30d Spearman</div>
                    <div class="pvalue ${corr != null && corr < -0.2 ? 'pv-confirmed' : corr != null && corr < 0 ? 'pv-weak' : 'pv-none'}">${corr != null && corr < -0.2 ? 'INVERSE' : corr != null && corr < 0 ? 'WEAK' : '--'}</div>
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

        // Draw forward return curves once DOM is ready
        requestAnimationFrame(() => {
            CONFIG.pairs.forEach(pair => {
                [pair.long, pair.short].forEach(ticker => {
                    const echoes = allMetrics[ticker]?.historical_echoes || null;
                    if (!echoes) return;
                    const canvas = container.querySelector(`canvas[data-ticker="${ticker}"]`);
                    if (canvas) Charts.drawForwardReturnCurve(canvas, echoes);
                });
            });
        });
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

        // Landmark windows only — compact but covers full horizon
        const landmarkWindows = ['5d', '21d', '63d', '252d'];
        const rows = landmarkWindows.map(w => {
            const s = fwd[w];
            if (!s) return '';
            const medColor = s.median > 2  ? 'var(--green)'
                           : s.median < -2 ? 'var(--red)'
                           : 'var(--text-secondary)';
            const wrColor  = s.win_rate > 55 ? 'var(--green)'
                           : s.win_rate < 45  ? 'var(--red)'
                           : 'var(--text-secondary)';
            const sign = s.median >= 0 ? '+' : '';
            const isEdgeRow = w === echoes.signal_edge_window;
            return `
                <tr${isEdgeRow ? ' class="echo-edge-row"' : ''}>
                    <td class="echo-window" data-tooltip="Forward return statistics over ${w} trading sessions (n=${s.count})${isEdgeRow ? ' ★ Best signal edge window' : ''}">${w}${isEdgeRow ? ' ★' : ''}</td>
                    <td class="echo-median" style="color:${medColor}" data-tooltip="Median return — robust central tendency over ${s.count} instances">${sign}${s.median.toFixed(1)}%</td>
                    <td class="echo-winrate" style="color:${wrColor}" data-tooltip="${s.win_rate.toFixed(0)}% of ${s.count} past instances ended positive after ${w}">${s.win_rate.toFixed(0)}%</td>
                    <td class="echo-range" data-tooltip="Clipped best/worst (±200% cap to exclude data artifacts)">${s.best >= 0 ? '+' : ''}${s.best.toFixed(0)} / ${s.worst.toFixed(0)}</td>
                </tr>`;
        }).join('');

        // Bias from the signal_edge_window (capped at 63d), fallback to 21d
        const edgeW    = echoes.signal_edge_window || '21d';
        const edgeFwd  = fwd[edgeW] || fwd['21d'] || {};
        const edgeMed  = edgeFwd.median  ?? 0;
        const edgeWr   = edgeFwd.win_rate ?? 50;
        const edgeLabel = `${edgeW} edge window`;
        let bias, biasClass;
        if (edgeMed > 3 && edgeWr > 55)       { bias = `↑ Bullish edge @ ${edgeLabel}`;  biasClass = 'bias-bull'; }
        else if (edgeMed < -3 && edgeWr < 45) { bias = `↓ Bearish edge @ ${edgeLabel}`;  biasClass = 'bias-bear'; }
        else                                   { bias = `→ Mixed outcome @ ${edgeLabel}`; biasClass = 'bias-neutral'; }

        // Lead-time annotation (Feature 4)
        const lt = echoes.lead_time;
        const leadTimeHtml = lt && lt.median_days != null
            ? `<div class="echo-lead-time" data-tooltip="Days from VCVI signal to peak forward return (n=${lt.count}). IQR: ${lt.p25_days}–${lt.p75_days}d">⏱ Peak ~${lt.median_days}d  <span style="color:var(--text-dim)">(IQR ${lt.p25_days}–${lt.p75_days}d)</span></div>`
            : '';

        // Recent occurrences — last 5 with edge-window return, season tag, and lead-time
        const recent = (echoes.occurrences || []).slice(0, 5);
        const recentHtml = recent.map(o => {
            const retEdge = o.fwd?.[edgeW] ?? o.fwd?.['21d'];
            const retColor = retEdge == null ? 'var(--text-muted)'
                : retEdge > 0 ? 'var(--green)' : 'var(--red)';
            const retLabel = retEdge != null
                ? `${retEdge >= 0 ? '+' : ''}${retEdge.toFixed(1)}% over ${edgeW}`
                : 'no fwd data';
            const seasonCfg = o.season ? (CONFIG.seasonDisplay[o.season] || {}) : null;
            const seasonEmoji = seasonCfg ? seasonCfg.emoji : '';
            const leadNote = o.days_to_peak != null ? ` peak@${o.days_to_peak}d` : '';
            return `<span class="echo-past-date" style="color:${retColor}"
                data-tooltip="VCVI=${o.vcvi?.toFixed(0)} VolReg=${o.vol_regime_pct?.toFixed(0)}th @ $${o.price?.toFixed(2)} → ${retLabel}${leadNote} [${o.season||'?'} ×${(o.seasonality_weight||1).toFixed(2)}]">${seasonEmoji}${o.date.slice(0,7)}</span>`;
        }).join('');

        const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';
        // Setup label makes the trade direction explicit — this was the original thesis
        const setupLabel = side === 'long'
            ? '<span class="setup-badge setup-bottom" data-tooltip="Long-side VCVI spike: long ETF has high volume at a low price → gas is near a BOTTOM → long/leveraged setup favored">↑ BOTTOM SETUP</span>'
            : '<span class="setup-badge setup-top"    data-tooltip="Short-side VCVI spike: short ETF has high volume at a low price (gas at HIGH) → gas is near a TOP → short/inverse setup favored">↓ TOP SETUP</span>';
        return `
            <div class="echo-card echo-${side}">
                <div class="echo-card-header">
                    <span class="echo-ticker" style="color:${tickerColor}">${ticker}</span>
                    ${setupLabel}
                    <span class="echo-count" data-tooltip="Total distinct signal instances found in full history (VCVI≥${echoes.threshold_vcvi}, VolRegime≤${echoes.threshold_vol_regime}th). Dashed line separates signal-reliable (&lt;63d) from decay-dominated (&gt;63d) zone.">${echoes.count} instances</span>
                </div>
                <div class="echo-curve-container">
                    <canvas class="echo-curve-canvas" data-ticker="${ticker}"></canvas>
                </div>
                <table class="echo-table">
                    <thead>
                        <tr>
                            <th data-tooltip="Forward window (★ = best signal edge)">FWD</th>
                            <th data-tooltip="Median return (robust)">MED%</th>
                            <th data-tooltip="Win rate — % positive outcomes">WIN%</th>
                            <th data-tooltip="Best / Worst clipped at ±200%">B/W</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="echo-bias ${biasClass}" data-tooltip="Scored by |median|×(win_rate−50)² across ≤63d windows — beyond 63d leveraged ETF decay dominates">${bias}</div>
                ${leadTimeHtml}
                <div class="echo-recent">
                    <span class="echo-recent-label">Recent:</span>
                    ${recentHtml || '<span style="color:var(--text-muted)">—</span>'}
                </div>
                ${this._echoRegimeBlock(echoes)}
            </div>`;
    },

    // Regime-stratified forward return summary for echo card
    _echoRegimeBlock(echoes) {
        const byRegime = echoes.forward_returns_by_regime;
        if (!byRegime || Object.keys(byRegime).length === 0) return '';

        const regimeCfg = CONFIG.thresholds?.ngRegime || {};
        const REGIME_ORDER = ['normal', 'elevated', 'extreme'];
        const displayWindow = echoes.signal_edge_window || '21d';

        const rows = REGIME_ORDER.filter(r => byRegime[r]).map(r => {
            const rd = byRegime[r];
            const s  = rd.forward_returns?.[displayWindow];
            if (!s) return '';
            const cfg = regimeCfg[r] || {};
            const color = cfg.color || 'var(--text-dim)';
            const icon  = r === 'extreme' ? '🚨' : r === 'elevated' ? '⚠' : '●';
            const med   = s.median;
            const medColor = med > 2 ? 'var(--green)' : med < -2 ? 'var(--red)' : 'var(--text-secondary)';
            const wrColor  = s.win_rate > 55 ? 'var(--green)' : s.win_rate < 45 ? 'var(--red)' : 'var(--text-secondary)';
            const tip = `${cfg.label || r}: n=${rd.count} instances, median ${med >= 0 ? '+' : ''}${med?.toFixed(1)}% over ${displayWindow}, ${s.win_rate?.toFixed(0)}% win rate`;
            return `<tr data-tooltip="${tip}">
                <td style="color:${color}">${icon} ${(cfg.label || r).toLowerCase()}</td>
                <td class="echo-regime-n" style="color:var(--text-dim)">n=${rd.count}</td>
                <td style="color:${medColor}">${med >= 0 ? '+' : ''}${med?.toFixed(1)}%</td>
                <td style="color:${wrColor}">${s.win_rate?.toFixed(0)}% win</td>
            </tr>`;
        }).join('');

        if (!rows) return '';
        return `
            <div class="echo-regime-block">
                <div class="echo-regime-label">Returns by NG regime (${displayWindow})</div>
                <table class="echo-regime-table">${rows}</table>
            </div>`;
    },

    // ---- CONVICTION EVENTS ----
    renderConvictionEvents(allMetrics) {
        const container = document.getElementById('conviction-container');
        if (!container) return;

        const tickers = Object.keys(CONFIG.etfs);
        const hasAny = tickers.some(t => allMetrics[t]?.conviction_events?.count > 0);

        if (!hasAny) {
            container.innerHTML = '<div class="conviction-empty">No conviction events detected in available history — filters are working as intended.</div>';
            return;
        }

        // Build per-pair display
        const rows = CONFIG.pairs.map(pair => {
            const longM  = allMetrics[pair.long];
            const shortM = allMetrics[pair.short];
            const longCE  = longM?.conviction_events;
            const shortCE = shortM?.conviction_events;

            if ((!longCE || longCE.count === 0) && (!shortCE || shortCE.count === 0)) return '';

            return `
                <div class="conviction-pair-group">
                    <div class="conviction-pair-label">${pair.label}</div>
                    <div class="conviction-pair-cards">
                        ${longCE && longCE.count > 0  ? this._convictionCard(pair.long,  longCE,  'long')  : ''}
                        ${shortCE && shortCE.count > 0 ? this._convictionCard(pair.short, shortCE, 'short') : ''}
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = rows || '<div class="conviction-empty">No conviction events in history.</div>';
    },

    _convictionCard(ticker, ce, side) {
        const gates = ce.gates || {};
        const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';
        const rateStr = ce.annual_rate != null ? ce.annual_rate.toFixed(1) : '—';
        const setupLabel = side === 'long'
            ? '<span class="setup-badge setup-bottom" data-tooltip="Long-side conviction: all 4 gates fired on long ETF → gas near BOTTOM → long/leveraged setup">↑ BOTTOM SETUP</span>'
            : '<span class="setup-badge setup-top"    data-tooltip="Short-side conviction: all 4 gates fired on short ETF (gas near TOP) → short/inverse setup">↓ TOP SETUP</span>';

        // Gate spec display
        const gateSpec = `VCVI≥${gates.vcvi_min || 72} · ${gates.breadth_min || 3}/5 windows≥${gates.breadth_pct || 85}th · Move>${gates.atr_mult || 1.5}×ATR · VolReg≤${gates.vol_regime_max || 70}th · Gate5:NG-z${side==='long'?'≤'+(gates.ng_z_long??-1.0):'≥'+(gates.ng_z_short??1.0)} | Override:VCVI≥${gates.extreme_override_vcvi||90}+Move>${gates.extreme_override_atr||2.0}×ATR`;

        // Event rows (most recent first) — with season tag
        const eventRows = (ce.events || []).slice(0, 15).map(e => {
            const moveColor = e.daily_move_pct > 0 ? 'var(--green)' : 'var(--red)';
            const sign = e.daily_move_pct >= 0 ? '+' : '';
            const seasonCfg = e.season ? (CONFIG.seasonDisplay[e.season] || {}) : null;
            const seasonTag = seasonCfg
                ? `<span style="color:${seasonCfg.color}" data-tooltip="${e.season} ×${(e.seasonality_weight||1).toFixed(2)}">${seasonCfg.emoji}</span>`
                : '';
            const overrideBadge = e.extreme_override
                ? `<span class="ce-override-badge" data-tooltip="Extreme override: VCVI≥90 + Move>2×ATR bypassed Gate 1 minimum">⚡</span>`
                : '';
            const guardBadge = e.momentum_guard_active
                ? `<span class="ce-guard-badge" data-tooltip="Momentum guard active: short-side VCVI bar raised (gas in seasonal uptrend)">🛡</span>`
                : '';
            const ngZStr = e.ng_seasonal_z != null ? e.ng_seasonal_z.toFixed(2) : '—';
            const ngZColor = e.ng_seasonal_z != null
                ? (e.ng_seasonal_z <= -1 ? 'var(--green)' : e.ng_seasonal_z >= 1 ? 'var(--red)' : 'var(--text-dim)')
                : '';
            const evRegime = e.ng_regime || 'unknown';
            const evRegimeCfg = (CONFIG.thresholds?.ngRegime || {})[evRegime] || {};
            const evRegimeColor = evRegimeCfg.color || 'var(--text-dim)';
            const evRegimeTip = evRegimeCfg.note || evRegime;
            const evRegimeBadge = evRegime !== 'unknown'
                ? `<span class="ce-regime-badge ce-regime-${evRegime}" style="color:${evRegimeColor}" data-tooltip="NG regime on signal date: ${evRegimeTip}">${evRegime === 'extreme' ? '🚨' : evRegime === 'elevated' ? '⚠' : '●'}</span>`
                : '';
            return `
                <tr>
                    <td class="ce-date">${e.date} ${seasonTag}${overrideBadge}${guardBadge}</td>
                    <td class="ce-vcvi" data-tooltip="VCVI-21 on signal date">${e.vcvi?.toFixed(0) || '—'}</td>
                    <td class="ce-move" style="color:${moveColor}" data-tooltip="Daily price move">${sign}${e.daily_move_pct?.toFixed(1) || '—'}%</td>
                    <td class="ce-atr" data-tooltip="Multiple of ATR-14">${e.atr_ratio?.toFixed(1) || '—'}×</td>
                    <td class="ce-breadth" data-tooltip="Vol pct windows ≥ 85th">${e.breadth_count}/5</td>
                    <td class="ce-price" data-tooltip="Price at signal">$${e.price?.toFixed(2) || '—'}</td>
                    <td class="ce-ngz" style="color:${ngZColor}" data-tooltip="NG=F seasonal z-score on signal date">${ngZStr}</td>
                    <td class="ce-regime" data-tooltip="NG=F volatility regime on signal date">${evRegimeBadge}</td>
                </tr>`;
        }).join('');

        // Forward return stats
        const fwd = ce.forward_returns || {};
        const fwdKeys = ['5d', '10d', '21d', '42d', '63d'];
        const fwdLabels = ['5d', '10d', '21d', '42d', '63d'];
        const hasFwd = fwdKeys.some(k => fwd[k]);

        const fwdHtml = hasFwd ? `
            <div class="ce-fwd-returns">
                <div class="ce-fwd-label">Forward returns after event</div>
                <table class="ce-fwd-table">
                    <thead><tr>${fwdLabels.map(l => `<th>${l}</th>`).join('')}</tr></thead>
                    <tbody>
                        <tr class="ce-fwd-row">${fwdKeys.map(k => {
                            const s = fwd[k];
                            if (!s) return '<td>—</td>';
                            const v = s.median;
                            const c = v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : '';
                            const sign = v >= 0 ? '+' : '';
                            return `<td style="color:${c}" data-tooltip="Median fwd return (${s.count} samples)">${sign}${v.toFixed(1)}%</td>`;
                        }).join('')}</tr>
                        <tr class="ce-fwd-wr">${fwdKeys.map(k => {
                            const s = fwd[k];
                            if (!s) return '<td>—</td>';
                            const wr = s.win_rate;
                            const c = wr >= 55 ? 'var(--green)' : wr <= 45 ? 'var(--red)' : 'var(--text-dim)';
                            return `<td style="color:${c}" data-tooltip="Win rate: % of events with positive return">${wr.toFixed(0)}% win</td>`;
                        }).join('')}</tr>
                    </tbody>
                </table>
            </div>` : '';

        return `
            <div class="conviction-card conviction-${side}">
                <div class="conviction-header">
                    <span class="conviction-ticker" style="color:${tickerColor}">${ticker}</span>
                    ${setupLabel}
                    <span class="conviction-count">${ce.count} events</span>
                    <span class="conviction-rate" data-tooltip="Average events per year across full history">${rateStr}/yr</span>
                </div>
                <div class="conviction-gates" data-tooltip="All 4 gates must fire simultaneously">${gateSpec}</div>
                <table class="conviction-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th data-tooltip="VCVI-21d level">VCVI</th>
                            <th data-tooltip="Daily price move %">Move</th>
                            <th data-tooltip="Move as multiple of ATR-14">ATR×</th>
                            <th data-tooltip="Vol pct windows above 85th">Breadth</th>
                            <th>Price</th>
                            <th data-tooltip="NG=F seasonal z-score (Gate 5)">NG-z</th>
                            <th data-tooltip="NG=F volatility regime on signal date (normal/elevated/extreme)">Rgm</th>
                        </tr>
                    </thead>
                    <tbody>${eventRows}</tbody>
                </table>
                ${fwdHtml}
            </div>`;
    },

    // ---- SIDE-WIDE VOLUME CONVERGENCE (SWVC) ----
    renderSideConvergence(sideConvergence) {
        const container = document.getElementById('swvc-container');
        if (!container) return;

        if (!sideConvergence) {
            container.innerHTML = '<div class="swvc-empty">No convergence data available.</div>';
            return;
        }

        const sides = [
            { key: 'long',  label: 'LONG SIDE',  tickers: ['BOIL', 'HNU.TO', '3NGL.L'] },
            { key: 'short', label: 'SHORT SIDE', tickers: ['KOLD', 'HND.TO', '3NGS.L'] },
        ];

        const html = sides.map(({ key, label, tickers }) => {
            const sc = sideConvergence[key];
            if (!sc) return '';

            const status     = sc.status || 'quiet';
            const score      = sc.score  || 0;
            const total      = sc.total  || 3;
            const lookback   = sc.lookback_days  || 15;
            const windowDays = sc.window_days || 10;
            const spread     = sc.window_spread_days;
            const threshold  = sc.threshold_rvol  || 2.0;

            const statusColors = {
                converged: 'var(--red)',
                partial:   'var(--orange)',
                single:    'var(--yellow)',
                quiet:     'var(--text-muted)',
            };
            const statusLabels = {
                converged: 'CONVERGED',
                partial:   'PARTIAL',
                single:    'SINGLE',
                quiet:     'QUIET',
            };
            const statusColor = statusColors[status] || 'var(--text-muted)';
            const statusLabel = statusLabels[status] || 'QUIET';

            // Score pills: one circle per ETF
            const pills = tickers.map(t => {
                const etf = (sc.etfs || {})[t] || {};
                const spiked = etf.spiked;
                const daysAgo = etf.days_ago != null ? etf.days_ago : null;
                const rvol = etf.peak_rvol;
                const date = etf.date || '—';
                const pillColor = spiked ? (key === 'long' ? 'var(--green)' : 'var(--red)') : 'var(--bg-panel)';
                const pillBorder = spiked ? (key === 'long' ? 'var(--long-accent)' : 'var(--short-accent)') : 'var(--border-primary)';
                const tip = spiked
                    ? `${t}: RVOL ${rvol?.toFixed(1)}× on ${date} (${daysAgo}d ago)`
                    : `${t}: no spike ≥${threshold}× in last ${lookback} trading days`;
                return `<div class="swvc-pill ${spiked ? 'spiked' : ''}"
                             style="background:${pillColor};border-color:${pillBorder}"
                             data-tooltip="${tip}">
                    <span class="swvc-pill-ticker">${t}</span>
                    ${spiked ? `<span class="swvc-pill-days">${daysAgo}d</span>` : '<span class="swvc-pill-days">—</span>'}
                </div>`;
            }).join('');

            // Timeline strip: last `lookback` trading days, mark spike positions
            const timelineCells = Array.from({ length: lookback }, (_, i) => {
                const dayOffset = lookback - 1 - i;  // 0 = today, lookback-1 = oldest
                const spikeTickers = tickers.filter(t => {
                    const etf = (sc.etfs || {})[t] || {};
                    return etf.spiked && etf.days_ago === dayOffset;
                });
                const hasSpike = spikeTickers.length > 0;
                const isToday  = dayOffset === 0;
                const cellColor = hasSpike
                    ? (key === 'short' ? 'var(--red)' : 'var(--green)')
                    : isToday ? 'rgba(255,255,255,0.06)' : 'transparent';
                const tip = hasSpike
                    ? `Day −${dayOffset}: ${spikeTickers.join(', ')} spiked`
                    : isToday ? 'Today' : `−${dayOffset}d`;
                return `<div class="swvc-cell ${hasSpike ? 'spike' : ''} ${isToday ? 'today' : ''}"
                             style="background:${cellColor}"
                             data-tooltip="${tip}"></div>`;
            }).join('');

            const spreadTxt = spread != null
                ? `${score}/3 ETFs within ${spread}d spread`
                : score === 0
                    ? `No spikes in last ${lookback} trading days`
                    : `${score}/3 ETFs active`;

            return `
                <div class="swvc-side swvc-${key}">
                    <div class="swvc-side-header">
                        <span class="swvc-side-label">${label}</span>
                        <span class="swvc-status-badge" style="color:${statusColor}">${statusLabel}</span>
                        <span class="swvc-spread-txt">${spreadTxt}</span>
                    </div>
                    <div class="swvc-pills">${pills}</div>
                    <div class="swvc-timeline-wrap">
                        <div class="swvc-timeline">${timelineCells}</div>
                        <div class="swvc-timeline-labels">
                            <span>−${lookback - 1}d</span>
                            <span>−7d</span>
                            <span>today</span>
                        </div>
                    </div>
                    ${status === 'converged' ? `
                    <div class="swvc-alert-banner" style="border-color:${statusColor}">
                        All 3 ${key}-side ETFs (US / CA / UK) spiked within ${spread} calendar days
                        — independent cross-market capitulation signal
                    </div>` : ''}
                </div>`;
        }).join('');

        container.innerHTML = html ||
            '<div class="swvc-empty">No data available.</div>';
    },

    // ---- NG PRICE CONTEXT BAR (Feature 2) ----
    renderNgPriceBar(ngPriceContext) {
        const bar = document.getElementById('ng-price-bar');
        if (!bar) return;

        if (!ngPriceContext || ngPriceContext.price == null) {
            bar.innerHTML = '<span class="ng-bar-label">NG=F</span><span class="ng-bar-na">—  price data unavailable</span>';
            return;
        }

        const p = ngPriceContext.price;
        const pct = ngPriceContext.percentile_2yr;
        const sz  = ngPriceContext.seasonal_zscore;
        const tier = ngPriceContext.tier || 'seasonal_mid';
        const gateShort = ngPriceContext.gate_short;
        const gateLong  = ngPriceContext.gate_long;
        const note = ngPriceContext.seasonal_note || '';

        // Tier color: red = seasonally high, green = seasonally low, muted = mid
        const tierColors = {
            extreme_high: 'var(--purple)', seasonal_high: 'var(--red)',
            extreme_low: 'var(--green)',   seasonal_low:  'var(--blue)',
            seasonal_mid: 'var(--text-secondary)'
        };
        const tierColor = tierColors[tier] || 'var(--text-secondary)';

        // Z-score bar: center=0, ±3σ fills the track. Clamp to -3..+3.
        const zClamped   = Math.max(-3, Math.min(3, sz ?? 0));
        const fillLeft   = sz != null ? ((zClamped / 3) * 50 + 50) : 50;  // pct from left
        const fillWidth  = sz != null ? Math.abs(zClamped / 3 * 50) : 0;
        const fillStart  = sz != null ? (sz >= 0 ? 50 : fillLeft) : 50;

        // Z-score label: +1.8σ above seasonal norm
        const zLabel = sz != null ? `${sz >= 0 ? '+' : ''}${sz.toFixed(1)}σ` : '—σ';
        const tierLabel = tier.replace('_', ' ').toUpperCase();

        const shortGateNote = `Seasonal z=${sz!=null?sz.toFixed(1):'—'}. Gate fires when z ≥ +1.5σ (gas anomalously HIGH for this month). ${note}`;
        const longGateNote  = `Seasonal z=${sz!=null?sz.toFixed(1):'—'}. Gate fires when z ≤ −1.5σ (gas anomalously LOW for this month). ${note}`;

        const shortGateHtml = gateShort === true  ? `<span class="ng-gate active"   data-tooltip="${shortGateNote}">SHORT ✓</span>`
                            : gateShort === false ? `<span class="ng-gate inactive" data-tooltip="${shortGateNote}">SHORT ✗</span>`
                            : '<span class="ng-gate unknown">SHORT ?</span>';
        const longGateHtml  = gateLong  === true  ? `<span class="ng-gate active"   data-tooltip="${longGateNote}">LONG ✓</span>`
                            : gateLong  === false ? `<span class="ng-gate inactive" data-tooltip="${longGateNote}">LONG ✗</span>`
                            : '<span class="ng-gate unknown">LONG ?</span>';

        // Regime badge
        const regime = ngPriceContext.regime || 'normal';
        const regimeCfg = (CONFIG.thresholds.ngRegime || {})[regime] || CONFIG.thresholds.ngRegime?.normal || {};
        const regimeColor = regimeCfg.color || 'var(--text-dim)';
        const regimeLabel = regimeCfg.label || regime.toUpperCase();
        const regimeNote  = regimeCfg.note  || '';
        const hvPct = ngPriceContext.ng_hv_pct;
        const hvStr = hvPct != null ? `NG vol at ${hvPct.toFixed(0)}th pct of own 2yr history` : '';
        const regimeTip = `Regime: ${regimeLabel}. ${regimeNote}. ${hvStr ? hvStr + '. ' : ''}Anchored to known outlier periods: 2022 bull run ($9/MMBtu, z~+3σ) and Jan 2026 cold snap (>$7/MMBtu).`;
        const regimeBadge = `<span class="ng-regime-badge ng-regime-${regime}" style="color:${regimeColor};border-color:${regimeColor}" data-tooltip="${regimeTip}">${regime === 'extreme' ? '🚨 ' : regime === 'elevated' ? '⚠ ' : ''}${regimeLabel}</span>`;
        // Extreme regime warning strip
        const regimeWarning = regime === 'extreme'
            ? `<div class="ng-regime-warning" style="color:${regimeColor}">⚠ EXTREME REGIME — ${regimeNote}. Historical signal outcomes may not reflect behavior in this environment.</div>`
            : regime === 'elevated'
            ? `<div class="ng-regime-warning ng-regime-warning-dim" style="color:${regimeColor}">⚠ ${regimeNote}</div>`
            : '';

        const fullTip = `NG=F Henry Hub futures — $${p.toFixed(3)}, seasonal z-score ${zLabel} (${tierLabel}). ${note}. 2yr pct: ${pct!=null?pct.toFixed(0):'—'}th (for reference only — seasonal z-score drives the gates).`;

        bar.innerHTML = `
            <span class="ng-bar-label">NG=F</span>
            <span class="ng-bar-price" style="color:${tierColor}" data-tooltip="${fullTip}">$${p.toFixed(3)}</span>
            <div class="ng-bar-track ng-bar-zscore" data-tooltip="${fullTip}">
                <div class="ng-bar-center-mark"></div>
                ${sz != null ? `<div class="ng-bar-fill" style="left:${fillStart}%;width:${fillWidth}%;background:${tierColor}"></div>` : ''}
                <div class="ng-bar-z-neg15" style="left:25%"></div>
                <div class="ng-bar-z-pos15" style="left:75%"></div>
            </div>
            <span class="ng-bar-pct" style="color:${tierColor}">${zLabel}</span>
            <span class="ng-gates">${longGateHtml}${shortGateHtml}</span>
            ${regimeBadge}
            ${regimeWarning}`;
    },

    // ---- ELEVATED WATCH (Feature 5) ----
    renderElevatedWatch(allMetrics) {
        const container = document.getElementById('elevated-watch-container');
        if (!container) return;

        const tickers = Object.keys(CONFIG.etfs);
        const hasAny = tickers.some(t => allMetrics[t]?.elevated_watch?.count > 0);

        if (!hasAny) {
            container.innerHTML = '<div class="watch-empty">No elevated watch events in history.</div>';
            return;
        }

        const rows = CONFIG.pairs.map(pair => {
            const longM  = allMetrics[pair.long];
            const shortM = allMetrics[pair.short];
            const longW  = longM?.elevated_watch;
            const shortW = shortM?.elevated_watch;
            if ((!longW || longW.count === 0) && (!shortW || shortW.count === 0)) return '';
            return `
                <div class="watch-pair-group">
                    <div class="watch-pair-label">${pair.label}</div>
                    <div class="watch-pair-cards">
                        ${longW  && longW.count  > 0 ? this._watchCard(pair.long,  longW,  'long')  : ''}
                        ${shortW && shortW.count > 0 ? this._watchCard(pair.short, shortW, 'short') : ''}
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = rows || '<div class="watch-empty">No elevated watch events.</div>';
    },

    _watchCard(ticker, watch, side) {
        const gates = watch.gates || {};
        const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';
        const rateStr = watch.annual_rate != null ? watch.annual_rate.toFixed(1) : '—';
        const setupLabel = side === 'long'
            ? '<span class="setup-badge setup-bottom" style="opacity:0.8">↑ WATCH-BOTTOM</span>'
            : '<span class="setup-badge setup-top"    style="opacity:0.8">↓ WATCH-TOP</span>';

        const gateSpec = `VCVI≥${gates.vcvi_min||60} · ${gates.breadth_min||2}/N windows≥${gates.breadth_pct||75}th · Move>${gates.atr_mult||1.2}×ATR`;

        const eventRows = (watch.events || []).slice(0, 10).map(e => {
            const moveColor = e.daily_move_pct > 0 ? 'var(--green)' : 'var(--red)';
            const sign = e.daily_move_pct >= 0 ? '+' : '';
            const seasonCfg = e.season ? (CONFIG.seasonDisplay[e.season] || {}) : {};
            const seasonTag = e.season ? `<span style="color:${seasonCfg.color||'var(--text-muted)'};" data-tooltip="Season: ${e.season}, weight: ×${(e.seasonality_weight||1).toFixed(2)}">${seasonCfg.emoji||''}</span>` : '';
            return `
                <tr>
                    <td class="ce-date">${e.date} ${seasonTag}</td>
                    <td class="ce-vcvi">${e.vcvi?.toFixed(0)||'—'}</td>
                    <td class="ce-move" style="color:${moveColor}">${sign}${e.daily_move_pct?.toFixed(1)||'—'}%</td>
                    <td class="ce-atr">${e.atr_ratio?.toFixed(1)||'—'}×</td>
                    <td class="ce-price">$${e.price?.toFixed(2)||'—'}</td>
                </tr>`;
        }).join('');

        const fwd = watch.forward_returns || {};
        const fwdKeys = ['5d', '10d', '21d', '42d', '63d'];
        const hasFwd = fwdKeys.some(k => fwd[k]);
        const fwdHtml = hasFwd ? `
            <div class="ce-fwd-returns">
                <div class="ce-fwd-label">Fwd returns after watch event</div>
                <table class="ce-fwd-table">
                    <thead><tr>${fwdKeys.map(l=>`<th>${l}</th>`).join('')}</tr></thead>
                    <tbody>
                        <tr>${fwdKeys.map(k=>{const s=fwd[k];if(!s)return'<td>—</td>';const v=s.median;const c=v>0?'var(--green)':v<0?'var(--red)':'';return`<td style="color:${c}" data-tooltip="${s.count} samples">${v>=0?'+':''}${v.toFixed(1)}%</td>`}).join('')}</tr>
                        <tr>${fwdKeys.map(k=>{const s=fwd[k];if(!s)return'<td>—</td>';const wr=s.win_rate;const c=wr>=55?'var(--green)':wr<=45?'var(--red)':'var(--text-dim)';return`<td style="color:${c}">${wr.toFixed(0)}%</td>`}).join('')}</tr>
                    </tbody>
                </table>
            </div>` : '';

        return `
            <div class="conviction-card watch-card conviction-${side}">
                <div class="conviction-header">
                    <span class="conviction-ticker" style="color:${tickerColor}">${ticker}</span>
                    ${setupLabel}
                    <span class="conviction-count">${watch.count} events</span>
                    <span class="conviction-rate" data-tooltip="Average watch events/year">${rateStr}/yr</span>
                </div>
                <div class="conviction-gates watch-gates" data-tooltip="3-gate softer filter (no vol-regime gate)">${gateSpec}</div>
                <table class="conviction-table">
                    <thead><tr><th>Date</th><th>VCVI</th><th>Move</th><th>ATR×</th><th>Price</th></tr></thead>
                    <tbody>${eventRows}</tbody>
                </table>
                ${fwdHtml}
            </div>`;
    },

    // ---- TOP-OF-PAGE CONVERGENCE FLASH BANNER ----
    // Shown when any side reaches CONVERGED status — hard to miss regardless
    // of where the user is scrolled to.
    renderConvergenceFlash(sideConvergence) {
        const el = document.getElementById('convergence-flash');
        if (!el) return;

        if (!sideConvergence) { el.style.display = 'none'; return; }

        const sides = [
            { key: 'short', label: 'SHORT SIDE', direction: 'gas TOP', setupLabel: '↓ SHORT / INVERSE SETUP', cls: 'flash-short' },
            { key: 'long',  label: 'LONG SIDE',  direction: 'gas BOTTOM', setupLabel: '↑ LONG / LEVERAGED SETUP', cls: 'flash-long' },
        ];

        const banners = sides
            .filter(s => (sideConvergence[s.key] || {}).status === 'converged')
            .map(s => {
                const sc = sideConvergence[s.key];
                const spread = sc.window_spread_days;
                const etfList = Object.entries(sc.etfs || {})
                    .filter(([, v]) => v.spiked)
                    .map(([t, v]) => `${t} (${v.days_ago}d ago, ${v.peak_rvol?.toFixed(1)}×)`)
                    .join(' · ');
                return `<div class="convergence-flash-inner ${s.cls}">
                    <span class="flash-icon">⚡</span>
                    <span class="flash-body">
                        <strong>${s.label} CONVERGED</strong> — all 3 ETFs spiked within ${spread} calendar days
                        <span class="flash-etfs">${etfList}</span>
                    </span>
                    <span class="flash-setup">${s.setupLabel} — ${s.direction} candidate</span>
                </div>`;
            });

        if (banners.length === 0) {
            el.style.display = 'none';
        } else {
            el.innerHTML = banners.join('');
            el.style.display = 'block';
        }
    },

    // ---- VDDS CROSS-ETF COMPARISON BAR ----
    renderVddsBar(allMetrics) {
        const el = document.getElementById('vdds-bar');
        if (!el) return;
        const tickers = Object.keys(allMetrics);
        if (!tickers.length) { el.innerHTML = '<span class="vdds-na">No data</span>'; return; }

        const rows = tickers.map(ticker => {
            const m = allMetrics[ticker];
            if (!m) return '';
            const vdds = m.vdds;
            const side = (CONFIG.etfs[ticker] || {}).side || 'long';
            const sideColor = side === 'long' ? 'var(--long-accent)' : 'var(--short-accent)';
            // Bar: centre at 1.0, range 0.5–1.5 (100% width)
            const clamped = Math.max(0.5, Math.min(1.5, vdds ?? 1.0));
            const pct = ((clamped - 0.5) / 1.0) * 100;
            const centerPct = 50; // 1.0 maps to center
            const fillLeft  = Math.min(pct, centerPct);
            const fillWidth = Math.abs(pct - centerPct);
            const fillStart = pct < centerPct ? pct : centerPct;
            const barColor = vdds == null ? 'var(--text-dim)'
                : vdds < 0.85 ? 'var(--green)'
                : vdds < 0.95 ? 'var(--blue)'
                : vdds > 1.15 ? 'var(--orange)'
                : 'var(--text-dim)';
            const dvRvol = (m.dvRvol || {})['21d'];
            const sRvol  = (m.rvol   || {})['21d'];
            const tip = `VDDS for ${ticker}: DV-RVOL=${dvRvol!=null?dvRvol.toFixed(2):'--'} ÷ S-RVOL=${sRvol!=null?sRvol.toFixed(2):'--'} = ${vdds!=null?vdds.toFixed(2):'--'}x. ${vdds!=null&&vdds<0.90?'Capitulation pattern — share vol outpacing dollar vol.':vdds!=null&&vdds>1.10?'Momentum pattern — dollar vol outpacing share vol.':'Neutral — balanced flows.'}`;
            return `
                <div class="vdds-row">
                    <span class="vdds-ticker" style="color:${sideColor}" data-tooltip="${tip}">${ticker}</span>
                    <div class="vdds-track">
                        <div class="vdds-center-mark"></div>
                        <div class="vdds-fill" style="left:${fillStart}%;width:${fillWidth}%;background:${barColor}"></div>
                    </div>
                    <span class="vdds-value" style="color:${barColor}">${vdds != null ? vdds.toFixed(2) + 'x' : '--'}</span>
                </div>`;
        }).join('');
        el.innerHTML = rows || '<span class="vdds-na">No VDDS data available</span>';
    },

    renderAll(allMetrics, sideConvergence, ngPriceContext) {
        this.renderConvergenceFlash(sideConvergence);
        this.renderNgPriceBar(ngPriceContext);
        this.renderVddsBar(allMetrics);
        this.renderAlertFeed(allMetrics);
        this.renderStressMatrix(allMetrics);
        this.renderSideConvergence(sideConvergence);
        this.renderConvictionEvents(allMetrics);
        this.renderElevatedWatch(allMetrics);
        this.renderHistoricalEchoes(allMetrics);
        this.renderHeatCalendar(allMetrics);
        this.renderConvergenceGauges(allMetrics);
        this.renderCorrelationBars(allMetrics);
        this.renderValidationBanner(allMetrics);
    }
};
