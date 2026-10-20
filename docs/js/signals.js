/* ============================================
   Signal Command Center Rendering
   ============================================ */

const Signals = {

    // Icon/prefix for each alert type
    _alertIcon(type) {
        const icons = {
            vcvi: '⚡', cvi: '🔥', mwca: '💥', rvol: '📈', vps: '📊',
            atr_breakout: '📐', vov: '🌀', vol_regime: '🌡', ipsi_stress: '⚠',
            fast_spike: '⚡', weather: '⛈', flow_accel: '▲'
        };
        return icons[type] || '●';
    },

    computeHeatGlobalPercentiles(allMetrics, mode = 'share', side = 'all') {
        const allTickers = Object.keys(allMetrics).filter(t => allMetrics[t] != null);
        if (allTickers.length === 0) return { p90: 90, p95: 95, p99: 99 };

        let activeTickers = allTickers;
        if (side === 'long') {
            activeTickers = allTickers.filter(t => CONFIG.etfs[t] && CONFIG.etfs[t].side === 'long');
        } else if (side === 'short') {
            activeTickers = allTickers.filter(t => CONFIG.etfs[t] && CONFIG.etfs[t].side === 'short');
        } else if (allTickers.includes(side)) {
            activeTickers = [side];
        }

        if (activeTickers.length === 0) return { p90: 90, p95: 95, p99: 99 };

        let longestData = [];
        for (const t of activeTickers) {
            const data = allMetrics[t].heatmapData;
            if (data && data.length > longestData.length) longestData = data;
        }
        if (longestData.length === 0) return { p90: 90, p95: 95, p99: 99 };

        const indexMaps = {};
        for (const t of activeTickers) {
            const sd = allMetrics[t].heatmapData;
            const map = new Map();
            if (sd) {
                for (let idx = 0; idx < sd.length; idx++) {
                    if (sd[idx] && sd[idx].date) {
                        map.set(sd[idx].date, idx);
                    }
                }
            }
            indexMaps[t] = map;
        }

        const scores = [];
        const valleyScores = [];
        for (let i = 0; i < longestData.length; i++) {
            let maxScore = 0;
            let sumDrought = 0;
            let droughtCount = 0;
            const date = longestData[i]?.date || '';
            if (!date) continue;
            let hasData = false;

            for (const t of activeTickers) {
                const sd = allMetrics[t].heatmapData;
                const map = indexMaps[t];
                if (!sd || !map) continue;

                const idx = map.get(date);
                if (idx === undefined) continue;

                const subData = sd.slice(Math.max(0, idx - 21), idx + 1);
                if (subData.length < 5) continue;

                let values;
                if (mode === 'dollar') {
                    values = subData.map(d => (d.volume || 0) * (d.close || 0));
                } else {
                    values = subData.map(d => d.volume || 0);
                }
                const closes = subData.map(d => d.close || 0);

                const valPct = Metrics.percentileRank(values[values.length - 1], values);
                const pricePct = Metrics.percentileRank(closes[closes.length - 1], closes);
                const cvi = valPct * (1 - pricePct / 100);
                maxScore = Math.max(maxScore, cvi);

                sumDrought += (100 - valPct);
                droughtCount++;
                hasData = true;
            }
            if (hasData) {
                scores.push(maxScore);
                if (droughtCount > 0) {
                    valleyScores.push(sumDrought / droughtCount);
                }
            }
        }

        if (scores.length === 0) {
            return {
                p90: 90, p95: 95, p99: 99,
                peaks: { p90: 90, p95: 95, p99: 99 },
                valleys: { p90: 90, p95: 95, p99: 99 }
            };
        }
        scores.sort((a, b) => a - b);
        valleyScores.sort((a, b) => a - b);

        const getPercentile = (p, arr) => {
            const idx = Math.floor((p / 100) * arr.length);
            return arr[Math.min(idx, arr.length - 1)];
        };

        const peaks = {
            p90: getPercentile(90, scores),
            p95: getPercentile(95, scores),
            p99: getPercentile(99, scores)
        };
        const valleys = {
            p90: getPercentile(90, valleyScores),
            p95: getPercentile(95, valleyScores),
            p99: getPercentile(99, valleyScores)
        };

        return {
            p90: peaks.p90,
            p95: peaks.p95,
            p99: peaks.p99,
            peaks,
            valleys
        };
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

            const rvolColor  = v => v != null ? Metrics.getValueColor(v, CONFIG.thresholds.rvol) : 'rgba(255, 255, 255, 0.85)';
            const lCapColor  = longVcvi  != null ? Metrics.getValueColor(longVcvi,  CONFIG.thresholds.vcvi) : 'rgba(255, 255, 255, 0.85)';
            const sCapColor  = shortVcvi != null ? Metrics.getValueColor(shortVcvi, CONFIG.thresholds.vcvi) : 'rgba(255, 255, 255, 0.85)';
            const ipsiColor  = ipsi != null ? Metrics.getValueColor(ipsi, CONFIG.thresholds.ipsi) : 'rgba(255, 255, 255, 0.85)';

            // 5d fast-window VCVI for both sides (Feature 1)
            const longVcvi5  = longM?.vcvi?.['5d']  ?? longM?.cvi?.['5d'];
            const shortVcvi5 = shortM?.vcvi?.['5d'] ?? shortM?.cvi?.['5d'];
            const anySpike   = longM?.sharpSpike || shortM?.sharpSpike;
            const spikeTicker = longM?.sharpSpike ? pair.long : shortM?.sharpSpike ? pair.short : null;

            const fastColor = v => {
                if (v == null) return 'rgba(255, 255, 255, 0.85)';
                if (v >= 65) return 'var(--purple)';
                if (v >= 45) return 'var(--orange)';
                if (v >= 30) return 'var(--yellow)';
                return 'rgba(255,255,255,0.85)';
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
                    <td style="color:${lCapColor}" data-tooltip="Long-side VCVI-63d (${pair.long}) — GAS BOTTOM signal. Threshold: 55 watch, 72 critical.">${longVcvi != null ? longVcvi.toFixed(0) : '--'}</td>
                    <td style="color:${sCapColor}" data-tooltip="Short-side VCVI-63d (${pair.short}) — GAS TOP signal. Threshold: 55 watch, 72 critical.">${shortVcvi != null ? shortVcvi.toFixed(0) : '--'}</td>
                    <td style="color:${fastColor(longVcvi5||shortVcvi5)}" data-tooltip="5d fast-window VCVI — L:${longVcvi5!=null?longVcvi5.toFixed(0):'—'} S:${shortVcvi5!=null?shortVcvi5.toFixed(0):'—'}. Threshold 45. Fires on weather spikes before 21d window catches up.">${longVcvi5!=null?longVcvi5.toFixed(0):'—'}/${shortVcvi5!=null?shortVcvi5.toFixed(0):'—'}</td>
                    <td data-tooltip="${anySpike?`SHARP SPIKE detected on ${spikeTicker} — move >2×ATR with VCVI-5d>45`:'No sharp spike'}">${anySpike ? '<span class="spike-badge-sm">⚡</span>' : '—'}</td>
                    <td style="color:${ipsiColor}" data-tooltip="${ipsiTip}">${ipsi != null ? ipsi.toFixed(1) + 'x' : '--'}</td>
                    <td data-tooltip="Volatility regime"><span class="vol-regime-badge ${regInfo.cls}" style="font-size:0.6rem">${regInfo.label}</span></td>
                    <td><span class="stress-status ${status}">${status.toUpperCase()}</span></td>
                </tr>`;
        }).join('');
    },

    renderHeatCalendar(allMetrics, offset = 0, mode = 'share', side = 'all', spotlightMode = 'off', peaksThreshold = 95, globalPercentiles = null) {
        const container = document.getElementById('heat-calendar');
        if (!container) return;

        // If mode/side not explicitly passed, fallback to window.App values
        if (window.App) {
            if (arguments.length < 3) mode = window.App.heatMode || 'share';
            if (arguments.length < 4) side = window.App.heatSide || 'all';
            if (arguments.length < 5) spotlightMode = window.App.heatSpotlightMode || (window.App.heatPeaksMode ? 'peaks' : 'off');
            if (arguments.length < 6) peaksThreshold = window.App.heatPeaksThreshold || 95;
            if (arguments.length < 7) {
                const globalObj = window.App.heatGlobalPercentiles;
                globalPercentiles = (globalObj && globalObj[mode]) ? globalObj[mode][side] : null;
            }
        }
        if (spotlightMode === true) spotlightMode = 'peaks';
        else if (!spotlightMode) spotlightMode = 'off';

        // Build daily max CVI scores across all ETFs
        const allTickers = Object.keys(allMetrics).filter(t => allMetrics[t] != null);
        if (allTickers.length === 0) return;

        // Filter active tickers by side
        let activeTickers = allTickers;
        if (side === 'long') {
            activeTickers = allTickers.filter(t => CONFIG.etfs[t] && CONFIG.etfs[t].side === 'long');
        } else if (side === 'short') {
            activeTickers = allTickers.filter(t => CONFIG.etfs[t] && CONFIG.etfs[t].side === 'short');
        } else if (allTickers.includes(side)) {
            activeTickers = [side];
        }

        if (activeTickers.length === 0) {
            container.innerHTML = `<div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem; font-style: italic;">No active ETFs for the selected filter.</div>`;
            return;
        }

        // Find ETF with most data to get date index
        let longestData = [];
        for (const t of activeTickers) {
            const data = allMetrics[t].heatmapData;
            if (data && data.length > longestData.length) longestData = data;
        }

        if (longestData.length === 0) return;

        // Pagination controls
        const maxOffset = Math.floor((longestData.length - 1) / 90);
        offset = Math.max(0, Math.min(offset, maxOffset));

        const hp = document.getElementById('heat-prev');
        const hn = document.getElementById('heat-next');
        const titleEl = document.getElementById('heat-calendar-title');
        if (hp) hp.disabled = (offset >= maxOffset);
        if (hn) hn.disabled = (offset === 0);

        if (titleEl) {
            const startDay = offset * 90 + 1;
            const endDay = Math.min((offset + 1) * 90, longestData.length);
            const modeLabel = mode === 'dollar' ? 'DOLLAR VOL' : 'VOLUME';
            const subjectLabel = (side === 'all') ? '' : ` [${side.replace('.TO', '').replace('.L', '')}]`;
            titleEl.innerHTML = `${modeLabel} HEAT MAP${subjectLabel} <span style="font-size:0.58rem; font-weight:normal; color:rgba(255,255,255,0.45); text-transform:none; margin-left:3px;">(${startDay}-${endDay}d)</span>`;
        }

        // Build a date-to-index map for each active ETF to ensure date alignment across holidays
        const indexMaps = {};
        for (const t of activeTickers) {
            const sd = allMetrics[t].heatmapData;
            const map = new Map();
            if (sd) {
                for (let idx = 0; idx < sd.length; idx++) {
                    if (sd[idx] && sd[idx].date) {
                        map.set(sd[idx].date, idx);
                    }
                }
            }
            indexMaps[t] = map;
        }

        const days = 90;
        const dailyScores = [];
        const dataLength = longestData.length;
        const startIndex = dataLength - (offset + 1) * days;
        const endIndex = dataLength - offset * days;
        const isValleys = (spotlightMode === 'valleys');

        for (let i = Math.max(0, startIndex); i < endIndex; i++) {
            let maxScore = 0;
            let sumDrought = 0;
            let droughtCount = 0;
            const date = longestData[i]?.date || '';
            if (!date) continue;

            for (const t of activeTickers) {
                const sd = allMetrics[t].heatmapData;
                const map = indexMaps[t];
                if (!sd || !map) continue;

                const idx = map.get(date);
                if (idx === undefined) continue;

                const subData = sd.slice(Math.max(0, idx - 21), idx + 1);
                if (subData.length < 5) continue;

                let values;
                if (mode === 'dollar') {
                    values = subData.map(d => (d.volume || 0) * (d.close || 0));
                } else {
                    values = subData.map(d => d.volume || 0);
                }
                const closes = subData.map(d => d.close || 0);

                const valPct = Metrics.percentileRank(values[values.length - 1], values);
                if (isValleys) {
                    sumDrought += (100 - valPct);
                    droughtCount++;
                } else {
                    const pricePct = Metrics.percentileRank(closes[closes.length - 1], closes);
                    const cvi = valPct * (1 - pricePct / 100);
                    maxScore = Math.max(maxScore, cvi);
                }
            }

            const dayScore = isValleys
                ? (droughtCount > 0 ? (sumDrought / droughtCount) : 0)
                : maxScore;
            dailyScores.push({ date, score: dayScore });
        }

        const spotlightCount = Charts.drawHeatCalendar(container, dailyScores, mode, spotlightMode, peaksThreshold, globalPercentiles, side);
        const peakBadge = document.getElementById('heat-peak-count');
        if (peakBadge) {
            if (spotlightMode === 'peaks') {
                peakBadge.textContent = `${spotlightCount} ${spotlightCount === 1 ? 'PEAK' : 'PEAKS'}`;
                peakBadge.className = 'heat-peak-count visible peak-style';
            } else if (spotlightMode === 'valleys') {
                peakBadge.textContent = `${spotlightCount} ${spotlightCount === 1 ? 'VALLEY' : 'VALLEYS'}`;
                peakBadge.className = 'heat-peak-count visible valley-style';
            } else {
                peakBadge.className = 'heat-peak-count';
            }
        }
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
                ? (corr < -0.2 ? 'var(--green)' : corr < -0.1 ? 'rgba(255, 255, 255, 0.85)' : corr > 0.1 ? 'var(--red)' : 'rgba(255,255,255,0.85)')
                : 'rgba(255,255,255,0.85)';
            const tickerColor = side === 'long' ? 'var(--green)' : 'var(--red)';
            const tipText = `${t} tracking validation card. 30-day Spearman correlation to NG spot is ${corr != null ? corr.toFixed(3) : 'N/A'}. ${side === 'short' ? 'Inverse ETF requires negative correlation to be effective.' : 'Long ETF requires positive correlation to be effective.'}`;

            return `
                <div class="validation-card" data-tooltip="${tipText}">
                    <div class="ticker" style="color:${tickerColor}">${t}</div>
                    <div class="corr-value" style="color:${color}">${corr != null ? corr.toFixed(3) : '--'}</div>
                    <div class="corr-label">30d Spearman</div>
                    <div class="pvalue ${corr != null && corr < -0.2 ? 'pv-confirmed' : corr != null && corr < 0 ? 'pv-weak' : 'pv-none'}">${corr != null && corr < -0.2 ? 'INVERSE' : corr != null && corr < 0 ? 'WEAK' : '--'}</div>
                </div>`;
        }).join('');
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
                quiet:     'rgba(255,255,255,0.85)',
            };
            const statusLabels = {
                converged: 'CONVERGED',
                partial:   'PARTIAL',
                single:    'SINGLE',
                quiet:     'QUIET',
            };
            const statusColor = statusColors[status] || 'rgba(255,255,255,0.85)';
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
            seasonal_mid: 'rgba(255, 255, 255, 0.85)'
        };
        const tierColor = tierColors[tier] || 'rgba(255, 255, 255, 0.85)';

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
        const regimeColor = regimeCfg.color || 'rgba(255,255,255,0.85)';
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

    // ---- TOP-OF-PAGE CONVERGENCE FLASH BANNER ----
    // Shown when any side reaches CONVERGED status — hard to miss regardless
    // of where the user is scrolled to.
    // Handles Bilateral Climax Resolution if BOTH sides converge simultaneously.
    renderConvergenceFlash(sideConvergence, ngPriceContext, allMetrics) {
        const el = document.getElementById('convergence-flash');
        if (!el) return;

        if (!sideConvergence) { el.style.display = 'none'; return; }

        const shortConverged = (sideConvergence.short || {}).status === 'converged';
        const longConverged  = (sideConvergence.long  || {}).status === 'converged';

        if (!shortConverged && !longConverged) {
            el.style.display = 'none';
            return;
        }

        // Case 1: BILATERAL CLIMAX (Both Long and Short ETFs spiked simultaneously)
        if (shortConverged && longConverged) {
            const scShort = sideConvergence.short;
            const scLong  = sideConvergence.long;
            const shortSpread = scShort.window_spread_days ?? 7;
            const longSpread  = scLong.window_spread_days ?? 7;
            const maxSpread   = Math.max(shortSpread, longSpread);

            const sz = ngPriceContext?.seasonal_zscore;
            const tier = ngPriceContext?.tier;
            const pct2yr = ngPriceContext?.percentile_2yr;
            const gateShort = ngPriceContext?.gate_short;
            const gateLong  = ngPriceContext?.gate_long;

            // Trend determination:
            // 15-year empirical backtest (2011-2026, N=74):
            // Dual spikes at cycle highs mark a Parabolic Blow-Off Top (BOIL -19.7% avg 63d, KOLD +13.9% win rate 63%).
            // Dual spikes at cycle lows mark a Liquidation Trap / False Bottom (BOIL drops -31.7% with 85.7% loss rate).
            const isHigh = (gateShort === true) || tier === 'extreme_high' || tier === 'seasonal_high' || (sz != null && sz >= 0.5) || (pct2yr != null && pct2yr >= 60);
            const isLow  = (gateLong === true)  || tier === 'extreme_low'  || tier === 'seasonal_low'  || (sz != null && sz <= -0.5) || (pct2yr != null && pct2yr <= 40);

            if (isHigh) {
                el.innerHTML = `
                    <div class="convergence-flash-inner flash-dual-top">
                        <span class="flash-icon">⚡</span>
                        <span class="flash-body">
                            <strong>DUAL LEVERAGED CLIMAX: PARABOLIC BLOW-OFF TOP WATCH</strong> — Both Long & Short ETFs Spiked Across All Exchanges (Spread: ${maxSpread}d)
                            <span class="flash-etfs">Empirical 15-yr edge: Long ETFs drop −19.7% over 63d (win rate 27.4%), Short ETFs (KOLD) gain +13.9% (t=+2.36, p=0.02). Natural Gas blow-off climax in progress.</span>
                        </span>
                        <span class="flash-setup">↓ EXTREME GAS TOP PROBABILITY</span>
                    </div>`;
            } else if (isLow) {
                el.innerHTML = `
                    <div class="convergence-flash-inner flash-dual-waterfall">
                        <span class="flash-icon">⚠</span>
                        <span class="flash-body">
                            <strong>DUAL VOLUME TURNOVER: LIQUIDATION WATERFALL (FALSE BOTTOM WARNING)</strong> — High Churn at Cycle Lows Across All Exchanges (Spread: ${maxSpread}d)
                            <span class="flash-etfs">Empirical 15-yr edge: Dual climaxes at lows have an 85.7% failure rate for Longs (−31.7% avg 63d drop). Downside cascade ongoing; do NOT buy bottom dip.</span>
                        </span>
                        <span class="flash-setup">⚠ CASCADE WARNING — AVOID LONGS</span>
                    </div>`;
            } else {
                el.innerHTML = `
                    <div class="convergence-flash-inner flash-neutral">
                        <span class="flash-icon">⚡</span>
                        <span class="flash-body">
                            <strong>BILATERAL LIQUIDITY EXPANSION: TWO-SIDED CHURN</strong> — Long and Short ETFs active simultaneously (Spread: ${maxSpread}d)
                            <span class="flash-etfs">Institutional position rebalancing / calendar roll turnover. Two-sided volume without directional consensus. Await confirmed directional break.</span>
                        </span>
                        <span class="flash-setup">↔ BALANCED TURNOVER — NO BIAS</span>
                    </div>`;
            }
            el.style.display = 'block';
            return;
        }

        // Case 2: SINGLE SIDE CONVERGED
        const sides = [
            { key: 'short', label: 'SHORT SIDE', direction: 'GAS TOP', setupLabel: '↓ SHORT / INVERSE SETUP', cls: 'flash-short' },
            { key: 'long',  label: 'LONG SIDE',  direction: 'GAS BOTTOM', setupLabel: '↑ LONG / LEVERAGED SETUP', cls: 'flash-long' },
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
                        <strong>${s.label} CONVERGED</strong> — All 3 ETFs spiked within ${spread} calendar days
                        <span class="flash-etfs">${etfList}</span>
                    </span>
                    <span class="flash-setup">${s.setupLabel} — ${s.direction} CANDIDATE</span>
                </div>`;
            });

        el.innerHTML = banners.join('');
        el.style.display = 'block';
    },

    // ---- VDDS CROSS-ETF COMPARISON BAR ----
    // mode: 'vol' = show S-RVOL-21d (pure share volume bar, centre=1.0, range 0.5–3x)
    //        'dv'  = show VDDS ratio DV-RVOL-21d / S-RVOL-21d (original mode)
    renderVddsBar(allMetrics, mode) {
        const el = document.getElementById('vdds-bar');
        if (!el) return;
        const tickers = Object.keys(allMetrics);
        if (!tickers.length) { el.innerHTML = '<span class="vdds-na">No data</span>'; return; }

        const isVolMode = (mode !== 'dv');

        const rows = tickers.map(ticker => {
            const m = allMetrics[ticker];
            if (!m) return '';
            const side = (CONFIG.etfs[ticker] || {}).side || 'long';
            const sideColor = side === 'long' ? 'var(--long-accent)' : 'var(--short-accent)';

            let displayVal, barColor, tip, fillStart, fillWidth;

            if (isVolMode) {
                // --- VOL MODE: S-RVOL-21d pure volume bars ---
                // Scale: 0.5x → 0% | 1.0x → 20% (baseline) | 3.0x → 100%
                const sRvol = (m.rvol || {})['21d'];
                const clamped = Math.max(0.5, Math.min(3.0, sRvol ?? 1.0));
                const pct = ((clamped - 0.5) / 2.5) * 100;
                const basePct = ((1.0 - 0.5) / 2.5) * 100; // 20% = 1x normal
                fillStart = Math.min(pct, basePct);
                fillWidth = Math.abs(pct - basePct);
                barColor = sRvol == null ? 'rgba(255,255,255,0.3)'
                    : sRvol < 0.8  ? 'rgba(255,255,255,0.3)'  // sub-normal (dim)
                    : sRvol < 1.2  ? 'rgba(255,255,255,0.55)' // normal
                    : sRvol < 1.5  ? 'var(--blue)'             // mild surge
                    : sRvol < 2.0  ? 'var(--yellow)'           // notable
                    : sRvol < 2.5  ? 'var(--orange)'           // high
                    : sRvol < 3.0  ? 'var(--red)'              // extreme
                    : 'var(--purple)';                          // absolute extreme
                displayVal = sRvol != null ? sRvol.toFixed(2) + 'x' : '--';
                tip = `S-RVOL-21d for ${ticker}: current share volume is ${displayVal} of the 21-day average. >1.5x = notable surge; >2x = extreme volume event.`;
            } else {
                // --- DV MODE: VDDS ratio (DV-RVOL / S-RVOL) ---
                const vdds = m.vdds;
                const clamped = Math.max(0.5, Math.min(1.5, vdds ?? 1.0));
                const pct = ((clamped - 0.5) / 1.0) * 100;
                const centerPct = 50;
                fillStart = Math.min(pct, centerPct);
                fillWidth = Math.abs(pct - centerPct);
                barColor = vdds == null ? 'rgba(255,255,255,0.85)'
                    : vdds < 0.85 ? 'var(--green)'
                    : vdds < 0.95 ? 'var(--blue)'
                    : vdds <= 1.05 ? 'rgba(255, 255, 255, 0.85)'
                    : vdds <= 1.15 ? 'var(--orange)'
                    : 'var(--red)';
                const dvRvol = (m.dvRvol || {})['21d'];
                const sRvol  = (m.rvol   || {})['21d'];
                displayVal = vdds != null ? vdds.toFixed(2) + 'x' : '--';
                tip = `VDDS for ${ticker}: DV-RVOL=${dvRvol!=null?dvRvol.toFixed(2):'--'} ÷ S-RVOL=${sRvol!=null?sRvol.toFixed(2):'--'} = ${displayVal}. ${vdds!=null&&vdds<0.90?'Capitulation pattern — share vol outpacing dollar vol.':vdds!=null&&vdds>1.10?'Momentum pattern — dollar vol outpacing share vol.':'Neutral — balanced flows.'}`;
            }

            // Baseline marker: sits at 1x in VOL mode (20%), or at ratio centre in DV mode (50%)
            const markPct = isVolMode ? ((1.0 - 0.5) / 2.5) * 100 : 50;

            return `
                <div class="vdds-row">
                    <span class="vdds-ticker" style="color:${sideColor}" data-tooltip="${tip}">${ticker}</span>
                    <div class="vdds-track">
                        <div class="vdds-center-mark" style="left:${markPct}%"></div>
                        <div class="vdds-fill" style="left:${fillStart}%;width:${fillWidth}%;background:${barColor}"></div>
                    </div>
                    <span class="vdds-value" style="color:${barColor}">${displayVal}</span>
                </div>`;
        }).join('');
        el.innerHTML = rows || '<span class="vdds-na">No VDDS data available</span>';
    },

    renderAll(allMetrics, sideConvergence, ngPriceContext) {
        const vddsMode = (window.App && window.App.vddsMode) ? window.App.vddsMode : 'vol';
        this.renderConvergenceFlash(sideConvergence, ngPriceContext, allMetrics);
        this.renderNgPriceBar(ngPriceContext);
        this.renderVddsBar(allMetrics, vddsMode);
        this.renderAlertFeed(allMetrics);
        this.renderStressMatrix(allMetrics);
        this.renderSideConvergence(sideConvergence);
        this.renderHeatCalendar(allMetrics, window.App ? window.App.heatOffset : 0, window.App ? window.App.heatMode : 'share', window.App ? window.App.heatSide : 'all');
        this.renderConvergenceGauges(allMetrics);
        this.renderCorrelationBars(allMetrics);
        this.renderValidationBanner(allMetrics);
    }
};
