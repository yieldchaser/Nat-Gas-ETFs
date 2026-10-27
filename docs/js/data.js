/* ============================================
   Data Layer — Fetches live data from Yahoo Finance
   Uses resilient CORS proxy pool with AbortController
   and client-side localStorage caching
   ============================================ */

const DataService = {
    cache: {},
    lastFetch: null,

    // AbortController-backed fetch with configurable timeout
    async fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal });
            return resp;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    // Build standard Yahoo Finance URL for 2-year chart or 5-day quote
    buildYahooUrl(ticker, light = false) {
        if (light) {
            return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d&includePrePost=false`;
        }
        const period2 = Math.floor(Date.now() / 1000);
        const period1 = period2 - (2 * 365 * 86400); // 2 years back
        return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
    },

    // Legacy helper endpoints
    buildUrl(ticker) {
        const yahooUrl = this.buildYahooUrl(ticker, false);
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`;
    },

    buildQuoteUrl(ticker) {
        const yahooUrl = this.buildYahooUrl(ticker, true);
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`;
    },

    // Structured proxy failover pool with hard timeouts and fast failover
    async fetchETF(ticker, light) {
        const yahooUrl = this.buildYahooUrl(ticker, light);

        const providers = [
            {
                name: 'allorigins_raw',
                buildUrl: (yUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`,
                parse: async (resp) => {
                    const text = await resp.text();
                    const json = JSON.parse(text);
                    return this.parseYahooResponse(ticker, json);
                }
            },
            {
                name: 'allorigins_get',
                buildUrl: (yUrl) => `https://api.allorigins.win/get?url=${encodeURIComponent(yUrl)}`,
                parse: async (resp) => {
                    const outer = await resp.json();
                    if (!outer || !outer.contents) throw new Error('Missing contents in allorigins get response');
                    if (outer.status && outer.status.http_code && outer.status.http_code !== 200) {
                        throw new Error(`Target HTTP ${outer.status.http_code}`);
                    }
                    const json = typeof outer.contents === 'string' ? JSON.parse(outer.contents) : outer.contents;
                    return this.parseYahooResponse(ticker, json);
                }
            },
            {
                name: 'codetabs',
                buildUrl: (yUrl) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(yUrl)}`,
                parse: async (resp) => {
                    const text = await resp.text();
                    const json = JSON.parse(text);
                    return this.parseYahooResponse(ticker, json);
                }
            }
        ];

        for (const provider of providers) {
            try {
                const proxyUrl = provider.buildUrl(yahooUrl);
                const resp = await this.fetchWithTimeout(proxyUrl, {}, 3500);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const result = await provider.parse(resp);
                if (result && result.data) {
                    return result;
                }
                throw new Error('Parsed response missing data');
            } catch (err) {
                console.warn(`Provider ${provider.name} failed for ${ticker}:`, err.name === 'AbortError' ? 'Timeout (3500ms)' : (err.message || err));
                // Immediately fail over to next provider
            }
        }

        console.error(`All proxies failed for ${ticker}`);
        return null;
    },

    // Backwards-compatible alias for proxy fallback
    async fetchWithFallback(ticker, light) {
        return this.fetchETF(ticker, light);
    },

    parseYahooResponse(ticker, json) {
        try {
            if (!json || !json.chart || !json.chart.result || !json.chart.result[0]) {
                return null;
            }
            const result = json.chart.result[0];
            const timestamps = result.timestamp || [];
            const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
            const meta = result.meta || {};

            const data = [];
            for (let i = 0; i < timestamps.length; i++) {
                const close = quote.close ? quote.close[i] : null;
                const volume = quote.volume ? quote.volume[i] : null;
                const open = quote.open ? quote.open[i] : null;
                const high = quote.high ? quote.high[i] : null;
                const low = quote.low ? quote.low[i] : null;
                if (close == null || volume == null) continue;
                data.push({
                    date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                    timestamp: timestamps[i],
                    open: open,
                    high: high,
                    low: low,
                    close: close,
                    volume: volume
                });
            }

            return {
                ticker: ticker,
                currency: meta.currency,
                exchangeName: meta.exchangeName,
                regularMarketPrice: meta.regularMarketPrice,
                regularMarketVolume: meta.regularMarketVolume != null ? meta.regularMarketVolume : null,
                previousClose: meta.previousClose || null,
                regularMarketTime: meta.regularMarketTime,
                marketState: meta.currentTradingPeriod ? this.getMarketState(meta.currentTradingPeriod) : 'unknown',
                data: data
            };
        } catch (err) {
            console.error(`Parse error for ${ticker}:`, err);
            return null;
        }
    },

    getMarketState(tradingPeriod) {
        const now = Math.floor(Date.now() / 1000);
        if (tradingPeriod.regular) {
            const start = tradingPeriod.regular.start;
            const end = tradingPeriod.regular.end;
            if (now >= start && now <= end) return 'open';
        }
        if (tradingPeriod.pre) {
            const start = tradingPeriod.pre.start;
            const end = tradingPeriod.pre.end;
            if (now >= start && now <= end) return 'pre_market';
        }
        if (tradingPeriod.post) {
            const start = tradingPeriod.post.start;
            const end = tradingPeriod.post.end;
            if (now >= start && now <= end) return 'after_hours';
        }
        return 'closed';
    },

    // Fetch all ETFs with 40ms stagger to prevent burst rate limits
    async fetchAll(light) {
        const tickers = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? Object.keys(CONFIG.etfs) : ['BOIL', 'KOLD', 'HNU.TO', 'HND.TO', '3NGL.L', '3NGS.L'];
        const promises = tickers.map((ticker, idx) => {
            const yahooTicker = (typeof CONFIG !== 'undefined' && CONFIG.etfs && CONFIG.etfs[ticker] && CONFIG.etfs[ticker].yahoo)
                ? CONFIG.etfs[ticker].yahoo
                : ticker;
            return new Promise(resolve => {
                setTimeout(async () => {
                    try {
                        const val = await this.fetchETF(yahooTicker, !!light);
                        resolve({ ticker, val });
                    } catch (e) {
                        resolve({ ticker, val: null });
                    }
                }, idx * 40); // 40ms stagger
            });
        });

        const results = await Promise.all(promises);

        const output = {};
        let marketState = 'closed';

        for (const item of results) {
            const ticker = item.ticker;
            const val = item.val;
            if (val) {
                output[ticker] = val;
                if (val.marketState === 'open') marketState = 'open';
                else if (val.marketState === 'pre_market' && marketState !== 'open') marketState = 'pre_market';
                else if (val.marketState === 'after_hours' && marketState === 'closed') marketState = 'after_hours';
            } else {
                console.warn(`No data for ${ticker}`);
                output[ticker] = null;
            }
        }

        this.cache = output;
        this.lastFetch = new Date();

        return { etfs: output, marketState: marketState };
    },

    // Light overlay fetch: 5-day bars per ETF instead of 2 years (same response shape)
    async fetchQuotesLight() {
        return this.fetchAll(true);
    },

    // Try to load pre-computed data from GitHub Actions pipeline
    async fetchPrecomputed() {
        try {
            const url = (typeof CONFIG !== 'undefined' && CONFIG.dataUrl) ? CONFIG.dataUrl : 'data/pipeline_output.json';
            const resp = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
            if (!resp.ok) return null;
            return await resp.json();
        } catch {
            return null;
        }
    },

    // Client-side cache persistence for resilient reloads
    saveLiveQuotesToStorage(quotes, session = null) {
        try {
            if (!quotes || typeof quotes !== 'object') return;
            if (typeof localStorage === 'undefined') return;

            const now = Date.now();
            const dateStr = session?.dateStr || (typeof App !== 'undefined' && App.getMarketSessionInfo ? App.getMarketSessionInfo().dateStr : new Date().toISOString().slice(0, 10));
            const sessionStatus = session?.status || (typeof App !== 'undefined' && App.getMarketSessionInfo ? App.getMarketSessionInfo().status : 'open');
            const etTimeStr = session?.etTimeStr || '';

            const payload = {
                dateStr: dateStr,
                sessionStatus: sessionStatus,
                etTimeStr: etTimeStr,
                timestamp: now,
                quotes: {}
            };

            for (const [ticker, q] of Object.entries(quotes)) {
                if (!q || q.price == null) continue;
                payload.quotes[ticker] = {
                    ticker: ticker,
                    price: Number(q.price),
                    volume: q.volume != null ? Number(q.volume) : null,
                    dollarVolume: q.dollarVolume != null ? Number(q.dollarVolume) : ((q.price != null && q.volume != null) ? Number(q.price) * Number(q.volume) : null),
                    changePct: q.changePct != null ? Number(q.changePct) : null,
                    regularMarketTime: q.regularMarketTime || null,
                    marketState: q.marketState || 'open',
                    etTimeStr: q.etTimeStr || etTimeStr,
                    timestamp: q.timestamp || now
                };
            }

            localStorage.setItem('bm_live_quotes_cache', JSON.stringify(payload));
        } catch (e) {
            console.warn('Failed to save live quotes to localStorage:', e);
        }
    },

    loadLiveQuotesFromStorage(session = null) {
        try {
            if (typeof localStorage === 'undefined') return null;
            const raw = localStorage.getItem('bm_live_quotes_cache');
            if (!raw) return null;

            const cached = JSON.parse(raw);
            if (!cached || !cached.quotes || typeof cached.quotes !== 'object') return null;

            const sess = session || (typeof App !== 'undefined' && App.getMarketSessionInfo ? App.getMarketSessionInfo() : null);
            const now = Date.now();

            if (sess && sess.dateStr) {
                // If market is active, cached date must match today's ET market date
                if (sess.isMarketActive) {
                    if (cached.dateStr !== sess.dateStr) {
                        return null;
                    }
                    // Max age during active market: 4 hours
                    if (now - cached.timestamp > 4 * 60 * 60 * 1000) {
                        return null;
                    }
                } else {
                    // When market is closed / weekend / holiday:
                    // Check if cached date matches today or the prior completed trading day
                    const priorDate = sess.priorClose?.dateStr;
                    const isMatchingDate = (cached.dateStr === sess.dateStr) || (priorDate && cached.dateStr === priorDate);
                    if (!isMatchingDate) {
                        return null;
                    }
                    // Max age outside market hours: 4 days (96 hours)
                    if (now - cached.timestamp > 96 * 60 * 60 * 1000) {
                        return null;
                    }
                }
            } else {
                if (now - cached.timestamp > 4 * 60 * 60 * 1000) {
                    return null;
                }
            }

            const validCount = Object.values(cached.quotes).filter(q => q && q.price != null).length;
            if (validCount === 0) return null;

            return cached;
        } catch (e) {
            console.warn('Failed to load live quotes from localStorage:', e);
            return null;
        }
    }
};
