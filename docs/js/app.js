/* ============================================
   Main Application Controller
   ============================================ */

const App = {
    allMetrics: {},
    refreshTimer: null,
    isLoading: false,

    async init() {
        console.log('[RADAR] Initializing...');
        this.bindEvents();
        await this.refresh();
        this.startAutoRefresh();
        console.log('[RADAR] Dashboard ready.');
    },

    bindEvents() {
        document.getElementById('refresh-btn').addEventListener('click', () => this.refresh());
        window.addEventListener('resize', () => this.handleResize());
    },

    async refresh() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.setLoading(true);

        try {
            // Try pre-computed data first (from GitHub Actions pipeline)
            let precomputed = await DataService.fetchPrecomputed();

            if (precomputed && precomputed.etfs) {
                console.log('[RADAR] Using pre-computed data');
                this.processPrecomputed(precomputed);
            } else {
                // Fall back to live Yahoo Finance fetch
                console.log('[RADAR] Fetching live data from Yahoo Finance...');
                const raw = await DataService.fetchAll();
                this.processLiveData(raw);
            }
        } catch (err) {
            console.error('[RADAR] Refresh failed:', err);
            this.showError('Failed to fetch data. Will retry...');
        } finally {
            this.isLoading = false;
            this.setLoading(false);
        }
    },

    processLiveData(raw) {
        // Compute metrics for each ETF
        this.allMetrics = {};
        for (const [ticker, etfData] of Object.entries(raw.etfs)) {
            if (etfData) {
                this.allMetrics[ticker] = Metrics.computeAllMetrics(etfData);
            }
        }

        this.updateMarketStatus(raw.marketState);
        this.render();
        this.updateTimestamp();
    },

    processPrecomputed(data) {
        this.allMetrics = {};

        for (const [ticker, etfData] of Object.entries(data.etfs)) {
            if (!etfData || !etfData.current) continue;

            // Normalise current snapshot: pipeline uses snake_case, renderer expects camelCase
            const raw = etfData.current || {};
            const current = {
                price:        raw.price       ?? null,
                volume:       raw.volume      ?? 0,
                changePct:    raw.change_pct  ?? raw.changePct    ?? 0,
                dollarVolume: raw.dollar_volume ?? raw.dollarVolume ?? 0,
            };
            if (etfData.history && etfData.history.length > 0) {
                sparkData = etfData.history.slice(-CONFIG.sparklineDays).map(h => ({
                    date: h.date || h[0],
                    close: h.close != null ? h.close : h[1],
                    volume: h.volume != null ? h.volume : h[2]
                }));
            }

            // Build metrics object from pre-computed data
            // Alert level uses VCVI when available (vol-adjusted is primary signal)
            const vcviData  = etfData.vcvi  || etfData.cvi || {};
            const maxVcvi = Math.max(...Object.values(vcviData).filter(v => v != null && !isNaN(v)), 0);
            let alertLevel = 'none';
            const tv = CONFIG.thresholds.vcvi;
            if (maxVcvi >= tv.extreme) alertLevel = 'extreme';
            else if (maxVcvi >= tv.critical) alertLevel = 'critical';
            else if (maxVcvi >= tv.high)     alertLevel = 'high';
            else if (maxVcvi >= tv.elevated) alertLevel = 'elevated';

            // Count MWCA windows
            const mwcaThreshold = CONFIG.thresholds.mwca_threshold;
            let mwcaCount = 0;
            for (const w of CONFIG.windows.percentile) {
                const key = `${w}d`;
                if (etfData.vol_percentile && etfData.vol_percentile[key] >= mwcaThreshold) mwcaCount++;
            }

            // Map alerts from signals
            const alerts = (data.signals || [])
                .filter(s => s.ticker === ticker)
                .map(s => {
                    const tp = s.type;
                    let type = 'rvol';
                    if (tp.includes('vcvi'))       type = 'vcvi';
                    else if (tp.includes('cvi'))   type = 'cvi';
                    else if (tp.includes('mwca'))  type = 'mwca';
                    else if (tp.includes('vov'))   type = 'vov';
                    else if (tp.includes('atr'))   type = 'atr_breakout';
                    else if (tp.includes('vol_regime')) type = 'vol_regime';
                    const level = tp.includes('critical') ? 'critical'
                        : tp.includes('extreme') ? 'extreme'
                        : tp.includes('warning') ? 'elevated'
                        : 'elevated';
                    return {
                        type, level,
                        ticker,
                        time: new Date(s.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                        message: s.message
                    };
                });

            // Normalise volatility block (pipeline uses snake_case)
            const vol = etfData.volatility || {};
            const volatility = {
                hv:             vol.hv             || {},
                volRegimePct:   vol.vol_regime_pct  != null ? vol.vol_regime_pct  : (vol.volRegimePct   ?? null),
                hvTermStructure: vol.hv_term_structure != null ? vol.hv_term_structure : (vol.hvTermStructure ?? null),
                atr14Pct:       vol.atr14_pct       != null ? vol.atr14_pct       : (vol.atr14Pct       ?? null),
                vov21:          vol.vov21           ?? null,
            };

            this.allMetrics[ticker] = {
                ticker: ticker,
                current: current,
                rvol: etfData.rvol || {},
                zScore: etfData.z_score || etfData.zScore || {},
                vroc: etfData.vroc || {},
                volPercentile: etfData.vol_percentile || etfData.volPercentile || {},
                pricePercentile: etfData.price_percentile || etfData.pricePercentile || {},
                cvi:  etfData.cvi  || {},
                vcvi: etfData.vcvi || etfData.cvi || {},
                volatility,
                vps: etfData.vps || 0,
                mwca: etfData.mwca || false,
                mwcaCount: mwcaCount,
                priceMAs: (etfData.moving_averages || {}).price || etfData.priceMAs || {},
                volumeMAs: (etfData.moving_averages || {}).volume || etfData.volumeMAs || {},
                rollingCorr: etfData.rolling_correlation != null ? etfData.rolling_correlation : (etfData.rollingCorr || null),
                alerts: alerts,
                alertLevel: alertLevel,
                sparkData: sparkData,
                historyLength: (etfData.history || []).length
            };
        }

        this.updateMarketStatus(data.market_status || 'unknown');
        this.render();
        this.updateTimestamp(data.last_updated);
    },

    render() {
        // Section A: Long side cards
        Cards.renderAllCards(this.allMetrics, document.getElementById('long-cards'), 'long');

        // Section B: Short side cards
        Cards.renderAllCards(this.allMetrics, document.getElementById('short-cards'), 'short');

        // Section C: Signal Command Center
        Signals.renderAll(this.allMetrics);
    },

    updateMarketStatus(state) {
        const el = document.getElementById('market-status');
        if (!el) return;

        el.className = 'market-status';
        const text = el.querySelector('.status-text');

        switch (state) {
            case 'open':
                el.classList.add('open');
                text.textContent = 'MARKET OPEN';
                break;
            case 'pre_market':
                el.classList.add('pre');
                text.textContent = 'PRE-MARKET';
                break;
            case 'after_hours':
                el.classList.add('pre');
                text.textContent = 'AFTER HOURS';
                break;
            default:
                el.classList.add('closed');
                text.textContent = 'MARKET CLOSED';
        }
    },

    updateTimestamp(iso) {
        const el = document.getElementById('last-updated');
        if (!el) return;
        const t = iso ? new Date(iso) : new Date();
        el.textContent = `Updated: ${t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    },

    setLoading(on) {
        const btn = document.getElementById('refresh-btn');
        if (on) btn.classList.add('spinning');
        else btn.classList.remove('spinning');
    },

    showError(msg) {
        console.warn('[RADAR]', msg);
        // Could show a toast notification here
    },

    startAutoRefresh() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        // Check market status and set appropriate interval
        const interval = CONFIG.refreshInterval;
        this.refreshTimer = setInterval(() => this.refresh(), interval);
        console.log(`[RADAR] Auto-refresh every ${interval / 1000}s`);
    },

    handleResize() {
        // Redraw charts on resize
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            this.render();
        }, 200);
    }
};

// Banner toggle
function toggleBanner() {
    const banner = document.getElementById('hypothesis-banner');
    banner.classList.toggle('collapsed');
}

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
