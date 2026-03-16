/* ============================================
   Data Layer — Fetches live data from Yahoo Finance
   Uses CORS proxy for client-side fetching
   ============================================ */

const DataService = {
    cache: {},
    lastFetch: null,

    // Yahoo Finance v8 chart API (public, no auth needed)
    // Uses period1/period2 for full daily history
    // CORS proxy required for client-side fetching
    buildUrl(ticker) {
        // Request 2 years of daily data for the dashboard (sufficient for all metrics)
        const period2 = Math.floor(Date.now() / 1000);
        const period1 = period2 - (2 * 365 * 86400); // 2 years back
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`;
    },

    async fetchETF(ticker) {
        const url = this.buildUrl(ticker);
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            return this.parseYahooResponse(ticker, json);
        } catch (err) {
            console.error(`Failed to fetch ${ticker} via allorigins:`, err);
            return this.fetchWithFallback(ticker);
        }
    },

    async fetchWithFallback(ticker) {
        const period2 = Math.floor(Date.now() / 1000);
        const period1 = period2 - (2 * 365 * 86400);
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`;
        try {
            const resp = await fetch(proxyUrl);
            if (!resp.ok) throw new Error(`Fallback HTTP ${resp.status}`);
            const json = await resp.json();
            return this.parseYahooResponse(ticker, json);
        } catch (err) {
            console.error(`Fallback also failed for ${ticker}:`, err);
            return null;
        }
    },

    parseYahooResponse(ticker, json) {
        try {
            const result = json.chart.result[0];
            const timestamps = result.timestamp;
            const quote = result.indicators.quote[0];
            const meta = result.meta;

            const data = [];
            for (let i = 0; i < timestamps.length; i++) {
                const close = quote.close[i];
                const volume = quote.volume[i];
                const open = quote.open[i];
                const high = quote.high[i];
                const low = quote.low[i];
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
                previousClose: meta.previousClose || meta.chartPreviousClose,
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

    async fetchAll() {
        const tickers = Object.keys(CONFIG.etfs);
        const promises = tickers.map(t => this.fetchETF(CONFIG.etfs[t].yahoo, t));
        const results = await Promise.allSettled(promises);

        const output = {};
        let marketState = 'closed';

        results.forEach((r, i) => {
            const ticker = tickers[i];
            if (r.status === 'fulfilled' && r.value) {
                output[ticker] = r.value;
                if (r.value.marketState === 'open') marketState = 'open';
                else if (r.value.marketState === 'pre_market' && marketState !== 'open') marketState = 'pre_market';
                else if (r.value.marketState === 'after_hours' && marketState === 'closed') marketState = 'after_hours';
            } else {
                console.warn(`No data for ${ticker}`);
                output[ticker] = null;
            }
        });

        this.cache = output;
        this.lastFetch = new Date();

        return { etfs: output, marketState: marketState };
    },

    // Try to load pre-computed data from GitHub Actions pipeline
    async fetchPrecomputed() {
        try {
            const resp = await fetch(CONFIG.dataUrl + '?t=' + Date.now());
            if (!resp.ok) return null;
            return await resp.json();
        } catch {
            return null;
        }
    }
};
