/* ============================================
   Main Application Controller
   ============================================ */

const App = {
    allMetrics: {},
    ngPriceContext: null,
    ngVolMetrics: null,   // NG=F vol data for the Vol Regime Monitor
    refreshTimer: null,
    isLoading: false,

    async init() {
        console.log('[MONITOR] Initializing...');
        this.bindEvents();
        await this.refresh();
        this.startAutoRefresh();
        console.log('[MONITOR] Dashboard ready.');
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
                console.log('[MONITOR] Using pre-computed data');
                this.processPrecomputed(precomputed);
                // Overlay real-time prices on top of pre-computed signals/metrics.
                // The JSON updates ~hourly; regularMarketPrice updates continuously.
                this._overlayLivePrices();
                // Fetch NG=F live (vol regime monitor now on trough-peak page)
                DataService.fetchNG().then(ngData => {
                    if (ngData) {
                        this.ngVolMetrics = Metrics.computeAllMetrics(ngData);
                    }
                });
            } else {
                // Fall back to live Yahoo Finance fetch
                console.log('[MONITOR] Fetching live data from Yahoo Finance...');
                const [raw, ngData] = await Promise.all([
                    DataService.fetchAll(),
                    DataService.fetchNG()
                ]);
                raw.ngData = ngData;
                this.processLiveData(raw);
            }
        } catch (err) {
            console.error('[MONITOR] Refresh failed:', err);
            this.showError('Failed to fetch data. Will retry...');
        } finally {
            this.isLoading = false;
            this.setLoading(false);
        }
    },

    // Fetch regularMarketPrice from Yahoo Finance (via CORS proxy) and overlay
    // onto already-rendered cards. Runs in background after processPrecomputed.
    _overlayLivePrices() {
        const today = new Date().toISOString().split('T')[0];
        DataService.fetchAll().then(liveData => {
            let updated = false;
            for (const [ticker, liveETF] of Object.entries(liveData.etfs)) {
                if (!liveETF || !this.allMetrics[ticker]) continue;
                const livePrice = liveETF.regularMarketPrice;
                const prevClose = liveETF.previousClose;
                if (livePrice == null) continue;

                this.allMetrics[ticker].current.price = livePrice;
                if (prevClose && prevClose > 0) {
                    this.allMetrics[ticker].current.changePct =
                        (livePrice - prevClose) / prevClose * 100;
                }
                // Update today's volume from the last bar if it's today's bar
                const bars = liveETF.data;
                if (bars && bars.length > 0) {
                    const lastBar = bars[bars.length - 1];
                    if (lastBar.date === today && lastBar.volume != null) {
                        this.allMetrics[ticker].current.volume = lastBar.volume;
                        this.allMetrics[ticker].current.dollarVolume =
                            livePrice * lastBar.volume;
                    }
                }
                updated = true;
            }
            if (updated) {
                this.render();
                // Show live price timestamp separate from JSON pipeline timestamp
                const el = document.getElementById('last-updated');
                if (el) {
                    const t = new Date().toLocaleTimeString('en-US', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                    });
                    el.textContent = `Prices: LIVE ${t}`;
                }
                console.log('[MONITOR] Live price overlay applied');
            }
        }).catch(err => {
            console.warn('[MONITOR] Live price overlay failed (non-fatal):', err);
        });
    },

    processLiveData(raw) {
        // Compute metrics for each ETF
        this.allMetrics = {};
        for (const [ticker, etfData] of Object.entries(raw.etfs)) {
            if (etfData) {
                this.allMetrics[ticker] = Metrics.computeAllMetrics(etfData);
            }
        }

        // NG=F vol metrics (fetched separately, used only by Vol Regime Monitor)
        if (raw.ngData) {
            this.ngVolMetrics = Metrics.computeAllMetrics(raw.ngData);
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

            // Compute vol series / percentiles from stored history if not in pipeline JSON
            const histCloses = (etfData.history || []).map(h => h.close ?? h[1]).filter(v => v != null);
            const computedHvSeries21   = histCloses.length >= 22 ? Metrics.computeHVSeries(histCloses, 21, histCloses.length) : [];
            const computedHvPercentiles = histCloses.length >= 6 ? {
                '5d':  Metrics.computeHVPercentile(histCloses, 5),
                '21d': Metrics.computeHVPercentile(histCloses, 21),
                '63d': Metrics.computeHVPercentile(histCloses, 63),
                '252d': Metrics.computeHVPercentile(histCloses, 252),
            } : {};

            // Merge pipeline hv with computed 5d (pipeline only has 10d/21d/63d/252d)
            const hvBase = vol.hv || {};
            const hv5d   = histCloses.length >= 6 ? Metrics.computeHV(histCloses, 5) : null;
            const mergedHv = { '5d': hv5d, ...hvBase };

            const volatility = {
                hv:              mergedHv,
                hvPercentiles:   vol.hv_percentiles  || vol.hvPercentiles  || computedHvPercentiles,
                hvSeries21:      vol.hv_series21     || vol.hvSeries21     || computedHvSeries21,
                volRegimePct:    vol.vol_regime_pct  != null ? vol.vol_regime_pct  : (vol.volRegimePct    ?? null),
                hvTermStructure: vol.hv_term_structure != null ? vol.hv_term_structure : (vol.hvTermStructure ?? null),
                atr14Pct:        vol.atr14_pct       != null ? vol.atr14_pct       : (vol.atr14Pct        ?? null),
                vov21:           vol.vov21           ?? null,
            };

            // Normalise alert level to also consider sharp_spike
            if (etfData.sharp_spike && alertLevel === 'none') alertLevel = 'elevated';

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
                historical_echoes: etfData.historical_echoes || null,
                conviction_events: etfData.conviction_events || null,
                elevated_watch:    etfData.elevated_watch    || null,   // Feature 5
                decay:             etfData.decay             || null,   // Feature 6
                seasonality:       etfData.seasonality       || null,   // Feature 3
                sharpSpike:        etfData.sharp_spike       || false,  // Feature 1
                fastSignal:        etfData.fast_signal       || null,   // Feature 1
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

        this.ngPriceContext = data.ng_price_context || null;   // Feature 2
        this.sideConvergence = data.side_convergence || null;
        // Always compute market status from current wall-clock time so the
        // label is correct even when the pre-computed JSON is stale.
        this.updateMarketStatus(this.getMarketStatusNow());
        this.render();
        this.updateTimestamp(data.last_updated);
    },

    render() {
        // Section A: Long side cards
        Cards.renderAllCards(this.allMetrics, document.getElementById('long-cards'), 'long');

        // Section B: Short side cards
        Cards.renderAllCards(this.allMetrics, document.getElementById('short-cards'), 'short');

        // Section C: Signal Command Center
        Signals.renderAll(this.allMetrics, this.sideConvergence || null, this.ngPriceContext || null);

        // Vol Regime Monitor moved to trough-peak page
        if (typeof VolRegime !== 'undefined') VolRegime.render(this.allMetrics, this.ngVolMetrics);
    },

    // Returns NYSE session state based on the current wall-clock time.
    // Uses the NYSE schedule (ET) and correctly handles US DST transitions.
    // This is always called at render-time so the label is never stale.
    getMarketStatusNow() {
        const now = new Date();
        const day = now.getUTCDay(); // 0=Sun … 6=Sat
        if (day === 0 || day === 6) return 'closed';

        // US DST: starts 2nd Sunday in March at 2 AM ET, ends 1st Sunday in Nov at 2 AM ET
        const yr  = now.getUTCFullYear();
        const dstStart = this._nthSundayUTC(yr, 2, 2, 7);  // March 2nd Sun, 07:00 UTC = 2 AM EST
        const dstEnd   = this._nthSundayUTC(yr, 10, 1, 6); // Nov  1st Sun, 06:00 UTC = 2 AM EDT
        const isDST    = now >= dstStart && now < dstEnd;
        const offsetMin = isDST ? 240 : 300; // minutes behind UTC (EDT=UTC-4, EST=UTC-5)

        const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
        const etMin  = (utcMin - offsetMin + 1440) % 1440;

        if (etMin >= 570  && etMin < 960)  return 'open';        // 09:30–16:00
        if (etMin >= 240  && etMin < 570)  return 'pre_market';  // 04:00–09:30
        if (etMin >= 960  && etMin < 1200) return 'after_hours'; // 16:00–20:00
        return 'closed';
    },

    _nthSundayUTC(year, month, n, hour) {
        // month: 0-indexed (2=March, 10=November)
        const d = new Date(Date.UTC(year, month, 1, hour, 0, 0));
        const dow = d.getUTCDay();
        d.setUTCDate(d.getUTCDate() + ((7 - dow) % 7) + (n - 1) * 7);
        return d;
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
        console.warn('[MONITOR]', msg);
        // Could show a toast notification here
    },

    startAutoRefresh() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        const state    = this.getMarketStatusNow();
        const interval = state === 'open'
            ? CONFIG.refreshInterval        // 60 s during regular session
            : CONFIG.refreshIntervalClosed; // 300 s outside market hours
        this.refreshTimer = setInterval(() => this.refresh(), interval);
        console.log(`[MONITOR] Auto-refresh every ${interval / 1000}s (market: ${state})`);
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

// ============================================================
// Universal JS Tooltip Singleton
// Uses position:fixed + viewport clamping — never overflows
// panels regardless of parent overflow or layout constraints.
// ============================================================
(function () {
    const tt = document.createElement('div');
    tt.id = 'tt';
    document.body.appendChild(tt);

    let active = null;

    function show(el) {
        if (el === active) return;
        active = el;
        tt.textContent = el.getAttribute('data-tooltip');
        tt.style.display = 'block';
        tt.style.opacity = '0';

        // Position after paint so offsetWidth/Height are correct
        requestAnimationFrame(function () {
            const r   = el.getBoundingClientRect();
            const tw  = tt.offsetWidth;
            const th  = tt.offsetHeight;
            const pad = 8;

            // Default: above element, horizontally centred
            let x = r.left + r.width / 2 - tw / 2;
            let y = r.top - th - 8;

            // Flip below if no room above
            if (y < pad) y = r.bottom + 8;

            // Clamp horizontally to viewport
            x = Math.max(pad, Math.min(x, window.innerWidth - tw - pad));

            tt.style.left = x + 'px';
            tt.style.top  = y + 'px';
            tt.style.opacity = '1';
        });
    }

    function hide() {
        tt.style.opacity = '0';
        tt.style.display = 'none';
        active = null;
    }

    document.addEventListener('mouseover', function (e) {
        const el = e.target.closest('[data-tooltip]');
        if (el) show(el); else hide();
    });

    document.addEventListener('mouseleave', function () { hide(); }, true);

    // Touch: tap to show tooltip, auto-dismiss after 2.5s or on next tap elsewhere
    let touchTimer = null;
    document.addEventListener('touchstart', function (e) {
        const el = e.target.closest('[data-tooltip]');
        clearTimeout(touchTimer);
        if (el) {
            if (active === el) { hide(); return; }
            show(el);
            touchTimer = setTimeout(hide, 2500);
        } else {
            hide();
        }
    }, { passive: true });
}());
