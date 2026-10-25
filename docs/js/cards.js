/* ============================================
   ETF Card Rendering
   ============================================ */

const Cards = {

    formatNumber(n, decimals = 2) {
        if (n == null || isNaN(n)) return '—';
        if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toFixed(decimals);
    },

    formatPrice(n) {
        if (n == null) return '—';
        if (n >= 10000) return n.toFixed(0);
        if (n >= 100) return n.toFixed(2);
        if (n >= 1) return n.toFixed(2);
        return n.toFixed(4);
    },

    formatPct(n) {
        if (n == null) return '—';
        return n.toFixed(1) + '%';
    },

    formatOrdinal(n) {
        if (n == null || isNaN(n)) return '—';
        const v = Math.round(n);
        const j = v % 10, k = v % 100;
        if (j === 1 && k !== 11) return v + 'st';
        if (j === 2 && k !== 12) return v + 'nd';
        if (j === 3 && k !== 13) return v + 'rd';
        return v + 'th';
    },

    getBenchmark(ticker) {
        const benchmarks = {
            'BOIL': 'Bloomberg Natural Gas Subindex',
            'KOLD': 'Bloomberg Natural Gas Subindex',
            'HNU.TO': 'Solactive Natural Gas Winter MD Rolling Futures Index',
            'HND.TO': 'Solactive Natural Gas Winter MD Rolling Futures Index',
            '3NGL.L': 'NASDAQ Commodity Natural Gas ER Index',
            '3NGS.L': 'NASDAQ Commodity Natural Gas ER Index'
        };
        return benchmarks[ticker] || 'Natural Gas Benchmark';
    },

    getExchangeSession(exchange, ticker, marketState, date) {
        const d = date ? (date instanceof Date ? date : new Date(date)) : new Date();
        let etMinutes = 0;
        let weekday = 'Mon';
        try {
            const fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/New_York',
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            });
            const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
            weekday = parts.weekday;
            etMinutes = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
        } catch (e) {
            const h = (d.getUTCHours() - 5 + 24) % 24;
            etMinutes = h * 60 + d.getUTCMinutes();
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            weekday = days[d.getUTCDay()];
        }

        const isWeekend = (weekday === 'Sat' || weekday === 'Sun');
        const ex = (exchange || '').toUpperCase();

        if (ex === 'LSE' || (ticker && ticker.endsWith('.L'))) {
            // LSE: 08:00 – 16:30 London = 03:00 – 11:30 ET Monday–Friday
            if (marketState === 'open' || (!isWeekend && etMinutes >= 180 && etMinutes < 690)) {
                return { text: 'LSE OPEN', cls: 'session-open session-lse', tooltip: 'London Stock Exchange is OPEN (08:00 – 16:30 London / 03:00 – 11:30 ET)' };
            }
            return { text: 'SETTLED', cls: 'session-settled', tooltip: 'London Stock Exchange is CLOSED (08:00 – 16:30 London / 03:00 – 11:30 ET)' };
        }

        // TSX & NYSE: 09:30 – 16:00 ET Monday–Friday
        if (marketState === 'open' || (!isWeekend && etMinutes >= 570 && etMinutes < 960)) {
            return { text: 'LIVE', cls: 'session-open session-live', tooltip: `${ex} regular session is LIVE (09:30 – 16:00 ET)` };
        }
        return { text: 'SETTLED', cls: 'session-settled', tooltip: `${ex} regular session is CLOSED (09:30 – 16:00 ET)` };
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

        // Percentile bars across all 6 lookback windows
        const percentileWindows = ['5d', '10d', '21d', '63d', '126d', '252d'];
        const pctTips = {
            '5d': 'Volume percentile vs 5-day history — short-term event context',
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
                <div class="percentile-row ${pctClass}" data-window="${w}">
                    <span class="percentile-label" data-tooltip="${pctTips[w]}">${w}</span>
                    <div class="percentile-bar-bg">
                        <div class="percentile-bar-fill" style="width:${width}%"></div>
                    </div>
                    <span class="percentile-value">${val != null ? this.formatOrdinal(val) : '—'}</span>
                </div>`;
        }).join('');

        // VCVI values (primary — vol-adjusted capitulation index)
        const decay = metrics.decay || {};

        const spikeHtml = metrics.sharpSpike
            ? `<span class="spike-badge" data-tooltip="SHARP SPIKE: 5d VCVI + move > 2×ATR. ${metrics.fastSignal === 'weather_top_candidate' ? 'Weather Top Candidate — GAS may have peaked.' : 'Weather Bottom Candidate — GAS may have bottomed.'}">SPIKE</span>`
            : '';

        const vcviEntries = ['5d', '21d', '63d'].map(w => {
            const val = (metrics.vcvi || {})[w];
            const color = val != null ? Metrics.getValueColor(val, CONFIG.thresholds.vcvi) : 'rgba(255, 255, 255, 0.85)';
            // Show decay-adjusted value alongside 21d if available
            let decayNote = '';
            if (w === '21d' && decay.correction_active && decay.adj_vcvi_21d != null) {
                const diff = decay.adj_vcvi_21d - (val || 0);
                const diffStr = diff >= 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0);
                const adjColor = Metrics.getValueColor(decay.adj_vcvi_21d, CONFIG.thresholds.vcvi);
                decayNote = ` <span style="color:${adjColor};font-size:0.65rem" data-tooltip="Decay-corrected VCVI-21d: removes ETF price drift due to daily rebalancing decay (~${(decay.annual_rate*100).toFixed(0)}%/yr). Raw: ${val!=null?val.toFixed(0):'—'}, Adj: ${decay.adj_vcvi_21d.toFixed(0)} (${diffStr})">†${decay.adj_vcvi_21d.toFixed(0)}</span>`;
            }
            return `
                <div class="indicator-block">
                    <span class="indicator-label" data-tooltip="Vol-Adjusted Capitulation Index (${w}). ${w==='5d'?'FAST window — weather event detection. Threshold: 45.':'Quiet regimes ×1.5, turbulent ×0.5.'} Scale 0–100.">VCVI-${w}</span>
                    <span class="indicator-value" style="color:${color}">${val != null ? val.toFixed(0) : '—'}${decayNote}</span>
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

        // HV bars — show HV10d, HV21d, HV63d; bar fill capped at 300% HV as max width
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
                    <span class="hv-value">${v != null ? v.toFixed(0) + '%' : '—'}</span>
                </div>`;
        }).join('');

        // VoV colour
        const vovColor = vov21 == null ? 'rgba(255, 255, 255, 0.85)'
            : vov21 >= CONFIG.thresholds.vov.extreme  ? 'var(--purple)'
            : vov21 >= CONFIG.thresholds.vov.critical ? 'var(--red)'
            : vov21 >= CONFIG.thresholds.vov.high     ? 'var(--orange)'
            : vov21 >= CONFIG.thresholds.vov.elevated ? 'var(--yellow)'
            : 'var(--blue)';

        const volatilityPanelHtml = `
            <div class="card-volatility">
                <div class="vol-panel-header">
                    <span class="vol-panel-title">VOLATILITY</span>
                    <span class="vol-regime-badge ${regimeInfo.cls}" data-tooltip="Vol Regime Percentile — where today's HV21 sits within its own 252-day history. 0th = historically quiet (signals stronger). 100th = historically extreme (signals discounted). Current: ${volRegimePct != null ? this.formatOrdinal(volRegimePct) + ' pct' : '—'}">${regimeInfo.label}${volRegimePct != null ? ' ' + this.formatOrdinal(volRegimePct) : ''}</span>
                </div>
                <div class="hv-bars">${hvBarRows}</div>
                <div class="vol-panel-row">
                    <div class="vol-stat">
                        <span class="vol-stat-label" data-tooltip="Average True Range (14-day) as % of current price — the expected daily trading range. Today's ATR: ${atr14Pct != null ? atr14Pct.toFixed(1) + '% of price' : '—'}. Use to judge if today's move is anomalous.">ATR-14</span>
                        <span class="vol-stat-value">${atr14Pct != null ? atr14Pct.toFixed(1) + '%' : '—'}</span>
                    </div>
                    <div class="vol-stat">
                        <span class="vol-stat-label" data-tooltip="HV Term Structure — ratio of HV10 ÷ HV63. Below 0.65: short-term vol calming (storm passed). Above 1.35: short-term vol surging (storm building). Current: ${hvTermStructure != null ? hvTermStructure.toFixed(2) + 'x' : '—'}">TERM STR</span>
                        <span class="vol-stat-value ${tsInfo.cls}">${tsInfo.arrow} ${tsInfo.label}</span>
                    </div>
                    <div class="vol-stat">
                        <span class="vol-stat-label" data-tooltip="Vol-of-Vol (21d) — std dev of the 10d HV series over 21 days, in percentage points. Measures regime instability: how much the short-term realized vol is itself fluctuating. High VoV = unstable regime, potential for sudden vol spike.">VoV-21</span>
                        <span class="vol-stat-value" style="color:${vovColor}">${vov21 != null ? vov21.toFixed(0) + 'pp' : '—'}</span>
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
                <div class="percentile-row ${pctClass}" data-window="${w}">
                    <span class="percentile-label" data-tooltip="Dollar Volume percentile vs ${w} history — split-agnostic value flow">$${w}</span>
                    <div class="percentile-bar-bg">
                        <div class="percentile-bar-fill" style="width:${width}%"></div>
                    </div>
                    <span class="percentile-value">${val != null ? this.formatOrdinal(val) : '—'}</span>
                </div>`;
        }).join('');

        // DVCVI entries
        const dvcviEntries = ['5d', '21d', '63d'].map(w => {
            const val = dvcvi[w];
            const color = val != null ? Metrics.getValueColor(val, CONFIG.thresholds.vcvi) : 'rgba(255, 255, 255, 0.85)';
            return `
                <div class="indicator-block">
                    <span class="indicator-label" data-tooltip="Dollar-Volume Capitulation Index (${w}). Same formula as VCVI but uses dollar volume percentile — doubly penalised when price is low (cheap shares AND low dollar value). Stronger capitulation signal.">DVCVI-${w}</span>
                    <span class="indicator-value" style="color:${color}">${val != null ? val.toFixed(0) : '—'}</span>
                </div>`;
        }).join('');

        // VDDS colour — < 0.85 = capitulation, > 1.15 = momentum/accumulation
        const vddsColor = vdds == null ? 'rgba(255, 255, 255, 0.85)'
            : vdds < 0.75 ? 'var(--green)'
            : vdds < 0.90 ? 'var(--blue)'
            : vdds > 1.25 ? 'var(--red)'
            : vdds > 1.10 ? 'var(--orange)'
            : 'rgba(255, 255, 255, 0.85)';
        const vddsTip = `VDDS — Volume-Dollar Divergence Score: DV-RVOL-21d ÷ S-RVOL-21d. < 0.90: share volume outpacing dollar volume — price is low per unit, capitulation pattern. > 1.10: dollar value outpacing shares — price rising per unit, momentum/accumulation. Current: ${vdds != null ? vdds.toFixed(2) + 'x' : '—'}`;
        const dvVpsColor = Metrics.getValueColor(dvVps, CONFIG.thresholds.vps);

        const safeTicker = ticker.replace(/\./g, '-');
        const sideLabel = (config.side === 'long') ? 'Long' : 'Short';
        const decayRate = (CONFIG.etfDecayRates && CONFIG.etfDecayRates[ticker] != null) ? CONFIG.etfDecayRates[ticker] : (decay.annual_rate || 0.35);
        const decayPct = Math.round(decayRate * 100);
        const metaTooltip = `${config.exchange || 'NYSE'} · ${config.leverage || '2x'} ${sideLabel} — Annual rebalancing decay rate: ~${decayPct}%/yr`;
        const metaBadge = `<span class="card-pill-meta" data-tooltip="${metaTooltip}">${config.exchange || 'NYSE'} · ${config.leverage || '2x'} ${sideLabel}</span>`;
        const session = this.getExchangeSession(config.exchange, ticker);
        const benchmark = this.getBenchmark(ticker);
        const nameTooltip = `${config.name} — ${config.leverage || '2x'} ${sideLabel} · ${config.exchange || 'NYSE'} (Benchmark: ${benchmark})`;

        return `
            <div class="etf-card ${alertClass}" data-ticker="${ticker}" data-mode="share">
                <div class="card-header">
                    <div class="card-ticker-group">
                        <div class="card-ticker-row">
                            <span class="card-ticker">${ticker}</span>
                            ${metaBadge}
                            <span class="session-badge ${session.cls}" data-live="session" data-tooltip="${session.tooltip}">${session.text}</span>
                            ${spikeHtml}
                        </div>
                        <span class="card-name" data-tooltip="${nameTooltip}">${config.name}</span>
                    </div>
                    <div class="card-header-right">
                        <div class="card-header-actions">
                            <button class="card-study-btn" data-tooltip="Open full Price-Volume Study for ${ticker}" onclick="Cards.openStudy('${ticker}', event)">Study ↗</button>
                            <div class="mode-toggle" title="Toggle Share / Dollar Volume mode">
                                <span class="mode-pill share-pill active-pill" onclick="Cards.setMode(this,'share')">S</span>
                                <span class="mode-pill dollar-pill" onclick="Cards.setMode(this,'dollar')">$</span>
                            </div>
                        </div>
                        <div class="card-price-group">
                            <span class="card-price" data-live="price">${this.formatPrice(c.price)}</span>
                            <span class="card-change ${changeClass}" data-live="change">${changeSign}${c.changePct.toFixed(2)}%</span>
                        </div>
                    </div>
                </div>

                <div class="card-chart-interactive" id="chart-wrap-${safeTicker}" data-ticker="${ticker}">
                    <div class="card-sparkline" id="spark-${safeTicker}">
                        <canvas></canvas>
                    </div>

                    <div class="card-volume-bar" id="volbar-${safeTicker}">
                        <canvas></canvas>
                    </div>
                </div>

                <!-- SHARE MODE sections -->
                <div class="card-metrics share-section">
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Today's raw share volume traded">VOL</span>
                        <span class="metric-value" data-live="vol">${this.formatNumber(c.volume, 0)}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Relative Volume — today's share volume ÷ 21-day average. 2x = twice normal." data-tt-pos="right">RVOL-21d</span>
                        <span class="metric-value" data-live="rvol-21" style="color:${Metrics.getValueColor(metrics.rvol['21d'], CONFIG.thresholds.rvol)}">${metrics.rvol['21d'] != null ? metrics.rvol['21d'].toFixed(1) + 'x' : '—'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Z-Score — standard deviations above/below the 21-day mean share volume. &gt;2σ is statistically unusual.">Z-SCORE</span>
                        <span class="metric-value" data-live="zscore-21" style="color:${Metrics.getValueColor(metrics.zScore['21d'], CONFIG.thresholds.zScore)}">${metrics.zScore['21d'] != null ? (metrics.zScore['21d'] > 0 ? '+' : '') + metrics.zScore['21d'].toFixed(1) + '\u03C3' : '—'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Volume Rate of Change — % change in share volume vs 10 sessions ago." data-tt-pos="right">VROC-10d</span>
                        <span class="metric-value">${metrics.vroc['10d'] != null ? (metrics.vroc['10d'] > 0 ? '+' : '') + metrics.vroc['10d'].toFixed(0) + '%' : '—'}</span>
                    </div>
                </div>
                <div class="card-percentiles share-section">${pctBarsHtml}</div>
                <div class="card-indicators share-section">
                    ${vcviEntries}
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="Volume Pressure Score — 5-component composite: RVOL (25%) + Z-Score (20%) + Vol Percentile (25%) + VROC (10%) + Inv. Vol Regime (20%). 0–100." data-tt-pos="right">VPS</span>
                        <span class="indicator-value" style="color:${vpsColor}">${metrics.vps != null ? metrics.vps.toFixed(0) : '—'}</span>
                    </div>
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="Multi-Window Convergence Alarm — fires when share volume exceeds the 90th percentile simultaneously across ALL 6 windows." data-tt-pos="right">MWCA</span>
                        ${mwcaHtml}
                    </div>
                </div>

                                <div class="card-metrics dollar-section" style="display:none">
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Today's dollar volume traded (price × shares). Split-agnostic capital flow metric.">$ VOL</span>
                        <span class="metric-value" data-live="dvol">${this.formatNumber(c.dollarVolume, 0)}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Dollar Volume RVOL — today's dollar volume ÷ 21-day average. Measures capital flow intensity." data-tt-pos="right">DV-RVOL</span>
                        <span class="metric-value" data-live="dvrvol-21" style="color:${dvRvol21Color}">${dv['21d'] != null ? dv['21d'].toFixed(1) + 'x' : '—'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Dollar Volume Z-Score — σ from 21-day mean dollar volume. Measures statistical significance of capital flow.">DV-Z</span>
                        <span class="metric-value" data-live="dvzscore-21" style="color:${dvZ21Color}">${dvZ['21d'] != null ? (dvZ['21d'] > 0 ? '+' : '') + dvZ['21d'].toFixed(1) + '\u03C3' : '—'}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label" data-tooltip="Dollar Volume Rate of Change — % change vs 10 sessions ago. Catches capital flow acceleration." data-tt-pos="right">DV-VROC</span>
                        <span class="metric-value">${dvVr['10d'] != null ? (dvVr['10d'] > 0 ? '+' : '') + dvVr['10d'].toFixed(0) + '%' : '—'}</span>
                    </div>
                </div>
                <div class="card-percentiles dollar-section" style="display:none">${dvPctBarsHtml}</div>
                <div class="card-indicators dollar-section" style="display:none">
                    ${dvcviEntries}
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="Dollar Volume Pressure Score — parallel to VPS but uses dollar volume metrics. Measures intensity of capital flow pressure. 0–100." data-tt-pos="right">DV-VPS</span>
                        <span class="indicator-value" style="color:${dvVpsColor}">${dvVps != null ? dvVps.toFixed(0) : '—'}</span>
                    </div>
                    <div class="indicator-block">
                        <span class="indicator-label" data-tooltip="${vddsTip}" data-tt-pos="right">VDDS</span>
                        <span class="indicator-value" style="color:${vddsColor}">${vdds != null ? vdds.toFixed(2) + 'x' : '—'}</span>
                    </div>
                </div>

                ${volatilityPanelHtml}

                <div class="card-dollar-volume">
                    <span class="dv-label">$ VOL TRADED</span>
                    <span class="dv-value" data-live="dvol">${this.formatNumber(c.dollarVolume, 0)}</span>
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

        // Hide/show redundant dollar volume footer
        const dvFooter = card.querySelector('.card-dollar-volume');
        if (dvFooter) {
            dvFooter.style.display = mode === 'dollar' ? 'none' : '';
        }

        // Redraw volume bars for active mode
        const ticker = card.dataset.ticker;
        if (ticker && typeof App !== 'undefined' && App.allMetrics && App.allMetrics[ticker]) {
            const safeTicker = ticker.replace(/\./g, '-');
            const volContainer = document.getElementById(`volbar-${safeTicker}`);
            const volCanvas = volContainer ? volContainer.querySelector('canvas') : null;
            const data = App.allMetrics[ticker].sparkData;
            if (volCanvas && data) {
                Charts.drawVolumeBars(volCanvas, data, null, null, mode);
            }
        }
    },

    openStudy(ticker, event) {
        if (event) {
            event.stopPropagation();
        }
        if (typeof VolumeStudies !== 'undefined') {
            if (typeof VolumeStudies.selectTicker === 'function') {
                VolumeStudies.selectTicker(ticker);
            } else {
                VolumeStudies.state.ticker = ticker;
                VolumeStudies.state.hoverIdx = null;
                VolumeStudies._cache = null;
                VolumeStudies.render();
            }
        }
        this.highlightSelectedCard(ticker);
        const panel = document.getElementById('vs-panel');
        if (panel) {
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    highlightSelectedCard(ticker) {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('.etf-card[data-ticker]').forEach(c => {
            c.classList.toggle('card-selected', c.getAttribute('data-ticker') === ticker);
        });
    },

    // Live overhead for quote overlay: refreshes price/volume fields and recalculates
    // live signal metrics (RVOL-21, Z-Score, percentiles) incrementally.
    updateLive(allMetrics, containers) {
        for (const container of containers) {
            if (!container) continue;
            for (const card of container.querySelectorAll('.etf-card[data-ticker]')) {
                const ticker = card.dataset.ticker;
                const m = allMetrics[ticker];
                if (!m || !m.current) continue;
                const c = m.current;
                const config = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? CONFIG.etfs[ticker] : {};

                // Update session badge
                const sessionEl = card.querySelector('[data-live="session"]');
                if (sessionEl) {
                    const session = this.getExchangeSession(config?.exchange, ticker);
                    sessionEl.className = 'session-badge ' + session.cls;
                    sessionEl.textContent = session.text;
                    sessionEl.setAttribute('data-tooltip', session.tooltip);
                }

                // Update price and change
                const priceEl = card.querySelector('[data-live="price"]');
                if (priceEl) priceEl.textContent = this.formatPrice(c.price);

                const chgEl = card.querySelector('[data-live="change"]');
                if (chgEl && c.changePct != null) {
                    chgEl.className = 'card-change ' + (c.changePct >= 0 ? 'positive' : 'negative');
                    chgEl.textContent = (c.changePct >= 0 ? '+' : '') + c.changePct.toFixed(2) + '%';
                }

                // Update volume and dollar volume
                const volEl = card.querySelector('[data-live="vol"]');
                if (volEl) volEl.textContent = this.formatNumber(c.volume, 0);

                for (const dvEl of card.querySelectorAll('[data-live="dvol"]')) {
                    dvEl.textContent = this.formatNumber(c.dollarVolume, 0);
                }

                // Live incremental metric calculations using m.history
                const hist = m.history || [];
                if (hist.length >= 5 && typeof Metrics !== 'undefined') {
                    const liveVol = c.volume;
                    const prevVols = hist.map(h => (h.volume != null ? h.volume : h[2])).filter(v => v != null && v > 0);

                    if (liveVol != null && liveVol > 0 && prevVols.length >= 21) {
                        const lookback21 = prevVols.slice(-21);
                        const mean21 = Metrics.mean(lookback21);
                        const std21 = Metrics.std(lookback21);
                        const liveRvol21 = mean21 > 0 ? liveVol / mean21 : null;
                        const liveZScore21 = std21 > 0 ? (liveVol - mean21) / std21 : 0;

                        if (m.rvol) m.rvol['21d'] = liveRvol21;
                        if (m.zScore) m.zScore['21d'] = liveZScore21;

                        const rvolEl = card.querySelector('[data-live="rvol-21"]');
                        if (rvolEl && liveRvol21 != null) {
                            rvolEl.textContent = liveRvol21.toFixed(1) + 'x';
                            rvolEl.style.color = Metrics.getValueColor(liveRvol21, CONFIG.thresholds.rvol);
                        }

                        const zEl = card.querySelector('[data-live="zscore-21"]');
                        if (zEl && liveZScore21 != null) {
                            zEl.textContent = (liveZScore21 > 0 ? '+' : '') + liveZScore21.toFixed(1) + '\u03C3';
                            zEl.style.color = Metrics.getValueColor(liveZScore21, CONFIG.thresholds.zScore);
                        }

                        // Percentiles across all 6 windows
                        const windows = [5, 10, 21, 63, 126, 252];
                        for (const w of windows) {
                            const key = w + 'd';
                            const lookback = prevVols.slice(-w);
                            const pct = Metrics.percentileRank(liveVol, lookback);
                            if (m.volPercentile) m.volPercentile[key] = pct;

                            const row = card.querySelector(`.share-section .percentile-row[data-window="${key}"]`);
                            if (row) {
                                const pctClass = Metrics.getPercentileClass(pct);
                                row.className = `percentile-row ${pctClass}`;
                                const fill = row.querySelector('.percentile-bar-fill');
                                if (fill) fill.style.width = Math.max(2, pct) + '%';
                                const valEl = row.querySelector('.percentile-value');
                                if (valEl) valEl.textContent = this.formatOrdinal(pct);
                            }
                        }
                    }

                    const liveDVol = c.dollarVolume;
                    const prevDVols = hist.map(h => {
                        const cl = h.close != null ? h.close : h[1];
                        const vo = h.volume != null ? h.volume : h[2];
                        return (cl != null && vo != null) ? cl * vo : null;
                    }).filter(v => v != null && v > 0);

                    if (liveDVol != null && liveDVol > 0 && prevDVols.length >= 21) {
                        const lookbackDv21 = prevDVols.slice(-21);
                        const meanDv21 = Metrics.mean(lookbackDv21);
                        const stdDv21 = Metrics.std(lookbackDv21);
                        const liveDvRvol21 = meanDv21 > 0 ? liveDVol / meanDv21 : null;
                        const liveDvZScore21 = stdDv21 > 0 ? (liveDVol - meanDv21) / stdDv21 : 0;

                        if (m.dvRvol) m.dvRvol['21d'] = liveDvRvol21;
                        if (m.dvZScore) m.dvZScore['21d'] = liveDvZScore21;

                        const dvRvolEl = card.querySelector('[data-live="dvrvol-21"]');
                        if (dvRvolEl && liveDvRvol21 != null) {
                            dvRvolEl.textContent = liveDvRvol21.toFixed(1) + 'x';
                            dvRvolEl.style.color = Metrics.getValueColor(liveDvRvol21, CONFIG.thresholds.rvol);
                        }

                        const dvZEl = card.querySelector('[data-live="dvzscore-21"]');
                        if (dvZEl && liveDvZScore21 != null) {
                            dvZEl.textContent = (liveDvZScore21 > 0 ? '+' : '') + liveDvZScore21.toFixed(1) + '\u03C3';
                            dvZEl.style.color = Metrics.getValueColor(liveDvZScore21, CONFIG.thresholds.zScore);
                        }

                        const windows = [5, 10, 21, 63, 126, 252];
                        for (const w of windows) {
                            const key = w + 'd';
                            const lookback = prevDVols.slice(-w);
                            const pct = Metrics.percentileRank(liveDVol, lookback);
                            if (m.dvPercentile) m.dvPercentile[key] = pct;

                            const row = card.querySelector(`.dollar-section .percentile-row[data-window="${key}"]`);
                            if (row) {
                                const pctClass = Metrics.getPercentileClass(pct);
                                row.className = `percentile-row ${pctClass}`;
                                const fill = row.querySelector('.percentile-bar-fill');
                                if (fill) fill.style.width = Math.max(2, pct) + '%';
                                const valEl = row.querySelector('.percentile-value');
                                if (valEl) valEl.textContent = this.formatOrdinal(pct);
                            }
                        }
                    }
                }
            }
        }
    },

    renderAllCards(allMetrics, container, side) {
        const tickers = Object.keys(CONFIG.etfs).filter(t => CONFIG.etfs[t].side === side);

        // Snapshot current toggle mode per card before regenerating DOM.
        const savedModes = {};
        for (const card of container.querySelectorAll('.etf-card[data-ticker]')) {
            savedModes[card.dataset.ticker] = card.dataset.mode || 'share';
        }

        const html = tickers.map(t => this.renderCard(t, allMetrics[t], CONFIG.etfs[t])).join('');
        container.innerHTML = html;

        // Re-apply saved modes
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

        // Highlight selected card from VolumeStudies
        if (typeof VolumeStudies !== 'undefined' && VolumeStudies.state && VolumeStudies.state.ticker) {
            this.highlightSelectedCard(VolumeStudies.state.ticker);
        }

        // Draw charts after DOM update & bind interactive hovers
        requestAnimationFrame(() => {
            for (const t of tickers) {
                if (!allMetrics[t]) continue;
                const safeTicker = t.replace(/\./g, '-');
                const wrap = document.getElementById(`chart-wrap-${safeTicker}`);
                const sparkContainer = document.getElementById(`spark-${safeTicker}`);
                const volContainer = document.getElementById(`volbar-${safeTicker}`);
                const sparkCanvas = sparkContainer ? sparkContainer.querySelector('canvas') : null;
                const volCanvas = volContainer ? volContainer.querySelector('canvas') : null;
                const color = CONFIG.etfs[t].side === 'long' ? '#3db87a' : '#c04040';
                const data = allMetrics[t].sparkData;
                const card = wrap ? wrap.closest('.etf-card') : null;
                const mode = (card && card.dataset.mode) || 'share';

                if (sparkCanvas) {
                    Charts.drawSparkline(sparkCanvas, data, color);
                }
                if (volCanvas) {
                    Charts.drawVolumeBars(volCanvas, data, null, null, mode);
                }

                if (wrap && sparkCanvas && volCanvas && data && data.length >= 2) {
                    Cards.bindCardHover(wrap, sparkCanvas, volCanvas, data, color, t);
                }
            }
        });
    },

    bindCardHover(wrap, sparkCanvas, volCanvas, data, color, ticker) {
        let tooltipEl = document.getElementById('card-chart-tooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'card-chart-tooltip';
            document.body.appendChild(tooltipEl);
        }

        // Inline defensive styling to guarantee visibility even if external CSS is cached
        tooltipEl.style.position = 'fixed';
        tooltipEl.style.pointerEvents = 'none';
        tooltipEl.style.zIndex = '99999';
        tooltipEl.style.background = 'rgba(15, 17, 26, 0.96)';
        tooltipEl.style.border = '1px solid rgba(255, 255, 255, 0.18)';
        tooltipEl.style.borderRadius = '6px';
        tooltipEl.style.padding = '8px 12px';
        tooltipEl.style.fontSize = '0.72rem';
        tooltipEl.style.color = '#f0f4fc';
        tooltipEl.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.65)';
        tooltipEl.style.minWidth = '160px';

        const maxVol = Math.max(...data.map(x => x.volume || 0)) || 1;

        const onMove = (clientX, clientY) => {
            const rect = wrap.getBoundingClientRect();
            const mouseX = clientX - rect.left;
            const w = rect.width;
            if (w <= 0 || !data || !data.length) return;

            const card = wrap.closest('.etf-card');
            const mode = (card && card.dataset.mode) || 'share';

            const step = w / data.length;
            const idx = Math.min(data.length - 1, Math.max(0, Math.floor(mouseX / step)));
            const d = data[idx];
            if (!d) return;

            // Redraw sparkline and volume bars with crosshairs & dot at idx
            Charts.drawSparkline(sparkCanvas, data, color, 0.1, idx);
            Charts.drawVolumeBars(volCanvas, data, null, idx, mode);

            const prev = idx > 0 ? data[idx - 1].close : null;
            const diff = prev != null && d.close != null ? (d.close - prev) : null;
            const pct = prev != null && prev > 0 && diff != null ? (diff / prev) * 100 : null;
            const dollarVol = (d.close != null && d.volume != null) ? (d.close * d.volume) : null;
            const vol = d.volume != null ? d.volume : 0;
            const ratio = vol / maxVol;

            let volTag = '';
            if (ratio > 0.90) {
                volTag = '<span style="color:#bf80ff;font-weight:800">● EXTREME SPIKE</span>';
            } else if (ratio > 0.75) {
                volTag = '<span style="color:#ff6b6b;font-weight:700">● HEAVY SURGE</span>';
            } else if (ratio > 0.50) {
                volTag = '<span style="color:#f59e0b;font-weight:700">● NOTABLE VOLUME</span>';
            } else if (ratio > 0.30) {
                volTag = '<span style="color:#60a5fa;font-weight:600">● MODERATE</span>';
            } else if (ratio > 0.15) {
                volTag = '<span style="color:rgba(255,255,255,0.45)">● QUIET</span>';
            } else {
                volTag = '<span style="color:#38bdf8;font-weight:700">● DEAD CALM</span>';
            }

            const changeHtml = diff != null
                ? `<div class="tt-row">
                       <span class="tt-lbl">Change</span>
                       <span class="tt-val" style="color:${diff >= 0 ? 'var(--green)' : 'var(--red)'}">${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct != null ? pct.toFixed(2) : '0.00'}%)</span>
                   </div>`
                : '';

            tooltipEl.innerHTML = `
                <div class="tt-header">
                    <span class="tt-ticker" style="color:${color}">${ticker}</span>
                    <span class="tt-date">${typeof formatDisplayDate === 'function' ? formatDisplayDate(d.date) : (d.date || '—')}</span>
                </div>
                <div class="tt-row">
                    <span class="tt-lbl">Price</span>
                    <span class="tt-val" style="color:var(--text-bright)">$${Cards.formatPrice(d.close)}</span>
                </div>
                ${changeHtml}
                <div class="tt-row">
                    <span class="tt-lbl">Volume</span>
                    <span class="tt-val">${Cards.formatNumber(vol, 0)} (${Number(vol).toLocaleString()})</span>
                </div>
                <div class="tt-row">
                    <span class="tt-lbl">Dollar Vol</span>
                    <span class="tt-val">$${Cards.formatNumber(dollarVol, 1)}</span>
                </div>
                <div class="tt-row" style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.08);">
                    <span class="tt-lbl">Activity</span>
                    <span class="tt-val">${volTag}</span>
                </div>
            `;

            tooltipEl.style.display = 'block';
            const tw = tooltipEl.offsetWidth || 170;
            const th = tooltipEl.offsetHeight || 135;

            let left = clientX + 16;
            if (left + tw > window.innerWidth - 10) {
                left = clientX - tw - 16;
            }
            left = Math.max(10, left);

            let top = clientY - th / 2;
            if (top + th > window.innerHeight - 10) {
                top = window.innerHeight - th - 10;
            }
            top = Math.max(10, top);

            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
        };

        const onLeave = () => {
            const card = wrap.closest('.etf-card');
            const mode = (card && card.dataset.mode) || 'share';
            Charts.drawSparkline(sparkCanvas, data, color, 0.1, null);
            Charts.drawVolumeBars(volCanvas, data, null, null, mode);
            if (tooltipEl) tooltipEl.style.display = 'none';
        };

        wrap.onmousemove = (e) => onMove(e.clientX, e.clientY);
        wrap.onmouseleave = onLeave;

        wrap.ontouchmove = (e) => {
            if (e.touches && e.touches[0]) {
                onMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        };
        wrap.ontouchend = onLeave;
        wrap.ontouchcancel = onLeave;
    }
};
