/* ============================================
   Metrics Engine — All volume calculations
   Computes CVI, VPS, RVOL, Z-Score, VROC,
   MWCA, IPSI, percentiles, correlations
   ============================================ */

const Metrics = {

    // ---- BASIC HELPERS ----

    mean(arr) {
        if (!arr.length) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    },

    std(arr) {
        if (arr.length < 2) return 0;
        const m = this.mean(arr);
        return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
    },

    percentileRank(value, arr) {
        if (!arr.length) return 50;
        const sorted = [...arr].sort((a, b) => a - b);
        let count = 0;
        for (const v of sorted) {
            if (v < value) count++;
            else break;
        }
        return (count / sorted.length) * 100;
    },

    // Spearman rank correlation
    spearmanCorrelation(x, y) {
        if (x.length !== y.length || x.length < 3) return 0;
        const n = x.length;
        const rankX = this.ranks(x);
        const rankY = this.ranks(y);
        let sumD2 = 0;
        for (let i = 0; i < n; i++) {
            const d = rankX[i] - rankY[i];
            sumD2 += d * d;
        }
        return 1 - (6 * sumD2) / (n * (n * n - 1));
    },

    ranks(arr) {
        const indexed = arr.map((v, i) => ({ v, i }));
        indexed.sort((a, b) => a.v - b.v);
        const ranks = new Array(arr.length);
        for (let i = 0; i < indexed.length; i++) {
            ranks[indexed[i].i] = i + 1;
        }
        return ranks;
    },

    // ---- METRIC COMPUTATIONS ----

    computeRVOL(volumes, window) {
        if (volumes.length < window + 1) return null;
        const current = volumes[volumes.length - 1];
        const lookback = volumes.slice(-window - 1, -1);
        const avg = this.mean(lookback);
        return avg > 0 ? current / avg : null;
    },

    computeZScore(volumes, window) {
        if (volumes.length < window + 1) return null;
        const current = volumes[volumes.length - 1];
        const lookback = volumes.slice(-window - 1, -1);
        const avg = this.mean(lookback);
        const s = this.std(lookback);
        return s > 0 ? (current - avg) / s : 0;
    },

    computeVROC(volumes, period) {
        if (volumes.length < period + 1) return null;
        const current = volumes[volumes.length - 1];
        const past = volumes[volumes.length - 1 - period];
        return past > 0 ? ((current - past) / past) * 100 : null;
    },

    computePercentile(value, series, window) {
        if (series.length < window) return null;
        const lookback = series.slice(-window);
        return this.percentileRank(value, lookback);
    },

    computeCVI(volPercentile, pricePercentile) {
        // CVI = vol_percentile * (1 - price_percentile/100)
        // High when volume is high AND price is low
        if (volPercentile == null || pricePercentile == null) return null;
        return volPercentile * (1 - pricePercentile / 100);
    },

    computeVPS(rvol, zScore, percentile, vroc) {
        // Normalize each component to 0-100
        const w = CONFIG.vpsWeights;

        // RVOL: 0.5x=0, 1x=25, 2x=50, 4x=75, 8x=100
        const rvolNorm = rvol != null ? Math.min(100, Math.max(0, (Math.log2(Math.max(0.5, rvol)) + 1) * 33.3)) : 0;

        // Z-Score: -2=0, 0=25, 2=50, 4=75, 6=100
        const zNorm = zScore != null ? Math.min(100, Math.max(0, (zScore + 2) * 12.5)) : 0;

        // Percentile: already 0-100
        const pctNorm = percentile != null ? percentile : 0;

        // VROC: -100%=0, 0%=25, +200%=75, +400%=100
        const vrocNorm = vroc != null ? Math.min(100, Math.max(0, (vroc + 100) / 5)) : 0;

        return w.rvol * rvolNorm + w.zScore * zNorm + w.percentile * pctNorm + w.vroc * vrocNorm;
    },

    computeMA(values, window) {
        if (values.length < window) return null;
        return this.mean(values.slice(-window));
    },

    // ---- FULL ETF METRIC SUITE ----

    computeAllMetrics(etfData) {
        if (!etfData || !etfData.data || etfData.data.length < 30) return null;

        const d = etfData.data;
        const closes = d.map(x => x.close);
        const volumes = d.map(x => x.volume);
        const currentPrice = closes[closes.length - 1];
        const currentVol = volumes[volumes.length - 1];
        const prevClose = closes.length > 1 ? closes[closes.length - 2] : currentPrice;
        const changePct = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
        const dollarVolume = currentPrice * currentVol;

        // RVOL across windows
        const rvol = {};
        for (const w of CONFIG.windows.rvol) {
            rvol[`${w}d`] = this.computeRVOL(volumes, w);
        }

        // Z-Score across windows
        const zScore = {};
        for (const w of CONFIG.windows.zScore) {
            zScore[`${w}d`] = this.computeZScore(volumes, w);
        }

        // VROC across windows
        const vroc = {};
        for (const w of CONFIG.windows.vroc) {
            vroc[`${w}d`] = this.computeVROC(volumes, w);
        }

        // Volume percentile across windows
        const volPercentile = {};
        for (const w of CONFIG.windows.percentile) {
            volPercentile[`${w}d`] = this.computePercentile(currentVol, volumes, w);
        }

        // Price percentile across windows
        const pricePercentile = {};
        for (const w of CONFIG.windows.percentile) {
            pricePercentile[`${w}d`] = this.computePercentile(currentPrice, closes, w);
        }

        // CVI across windows
        const cvi = {};
        for (const w of CONFIG.windows.percentile) {
            cvi[`${w}d`] = this.computeCVI(volPercentile[`${w}d`], pricePercentile[`${w}d`]);
        }

        // VPS using 63d window as primary
        const vps = this.computeVPS(
            rvol['63d'],
            zScore['63d'],
            volPercentile['63d'],
            vroc['10d']
        );

        // Moving averages
        const priceMAs = {};
        const volumeMAs = {};
        for (const w of CONFIG.windows.ma) {
            priceMAs[`${w}d`] = this.computeMA(closes, w);
            volumeMAs[`${w}d`] = this.computeMA(volumes, w);
        }

        // Rolling 30-day price-volume Spearman correlation
        const corrWindow = CONFIG.windows.correlation;
        let rollingCorr = null;
        if (closes.length >= corrWindow) {
            const recentPrices = closes.slice(-corrWindow);
            const recentVolumes = volumes.slice(-corrWindow);
            rollingCorr = this.spearmanCorrelation(recentPrices, recentVolumes);
        }

        // MWCA: volume in top 90th percentile across ALL windows
        const mwcaThreshold = CONFIG.thresholds.mwca_threshold;
        const mwcaWindows = CONFIG.windows.percentile;
        let mwcaCount = 0;
        for (const w of mwcaWindows) {
            if (volPercentile[`${w}d`] != null && volPercentile[`${w}d`] >= mwcaThreshold) {
                mwcaCount++;
            }
        }
        const mwca = mwcaCount === mwcaWindows.length;

        // Generate alerts
        const alerts = this.generateAlerts(etfData.ticker, {
            cvi, vps, rvol, zScore, volPercentile, mwca
        });

        // Get alert level for card styling
        const maxCvi = Math.max(...Object.values(cvi).filter(v => v != null));
        let alertLevel = 'none';
        if (maxCvi >= CONFIG.thresholds.cvi.extreme || mwca) alertLevel = 'extreme';
        else if (maxCvi >= CONFIG.thresholds.cvi.critical) alertLevel = 'critical';
        else if (maxCvi >= CONFIG.thresholds.cvi.high) alertLevel = 'high';
        else if (maxCvi >= CONFIG.thresholds.cvi.elevated) alertLevel = 'elevated';

        // Sparkline data (last N days)
        const sparkData = d.slice(-CONFIG.sparklineDays);

        return {
            ticker: etfData.ticker,
            current: {
                price: currentPrice,
                volume: currentVol,
                changePct: changePct,
                dollarVolume: dollarVolume,
                prevClose: prevClose
            },
            rvol, zScore, vroc,
            volPercentile, pricePercentile,
            cvi, vps, mwca, mwcaCount,
            priceMAs, volumeMAs,
            rollingCorr,
            alerts, alertLevel,
            sparkData,
            historyLength: d.length
        };
    },

    generateAlerts(ticker, metrics) {
        const alerts = [];
        const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const t = CONFIG.thresholds;

        // CVI alerts
        for (const [window, value] of Object.entries(metrics.cvi)) {
            if (value == null) continue;
            if (value >= t.cvi.extreme) {
                alerts.push({ type: 'cvi', level: 'extreme', ticker, time: now,
                    message: `CVI-${window} at ${value.toFixed(0)} — EXTREME CAPITULATION` });
            } else if (value >= t.cvi.critical) {
                alerts.push({ type: 'cvi', level: 'critical', ticker, time: now,
                    message: `CVI-${window} crossed ${t.cvi.critical} — Capitulation watch` });
            }
        }

        // MWCA
        if (metrics.mwca) {
            alerts.push({ type: 'mwca', level: 'extreme', ticker, time: now,
                message: `MWCA triggered — top ${CONFIG.thresholds.mwca_threshold}th pct across ALL windows` });
        }

        // RVOL
        for (const [window, value] of Object.entries(metrics.rvol)) {
            if (value != null && value >= t.rvol.critical) {
                alerts.push({ type: 'rvol', level: 'critical', ticker, time: now,
                    message: `RVOL-${window} at ${value.toFixed(1)}x — Major volume surge` });
            }
        }

        // VPS
        if (metrics.vps >= t.vps.extreme) {
            alerts.push({ type: 'vps', level: 'extreme', ticker, time: now,
                message: `VPS at ${metrics.vps.toFixed(0)}/100 — Volume pressure extreme` });
        }

        return alerts;
    },

    // ---- CROSS-INSTRUMENT METRICS ----

    computeIPSI(longMetrics, shortMetrics) {
        if (!longMetrics || !shortMetrics) return null;
        const longRvol = longMetrics.rvol['21d'];
        const shortRvol = shortMetrics.rvol['21d'];
        if (longRvol == null || shortRvol == null || longRvol === 0) return null;
        return shortRvol / longRvol;
    },

    computePairStatus(ipsi) {
        if (ipsi == null) return 'unknown';
        const t = CONFIG.thresholds.ipsi;
        if (ipsi >= t.critical) return 'critical';
        if (ipsi >= t.stress) return 'stress';
        if (ipsi >= t.high) return 'elevated';
        if (ipsi >= t.elevated) return 'elevated';
        return 'quiet';
    },

    getPercentileClass(value) {
        if (value == null) return 'pct-quiet';
        const t = CONFIG.thresholds.percentile;
        if (value >= t.extreme) return 'pct-extreme';
        if (value >= t.critical) return 'pct-critical';
        if (value >= t.high) return 'pct-high';
        if (value >= t.elevated) return 'pct-elevated';
        return 'pct-quiet';
    },

    getValueColor(value, thresholds) {
        if (value == null) return 'var(--text-muted)';
        if (value >= thresholds.extreme) return 'var(--purple)';
        if (value >= thresholds.critical) return 'var(--red)';
        if (value >= thresholds.high) return 'var(--orange)';
        if (value >= thresholds.elevated) return 'var(--yellow)';
        return 'var(--blue)';
    }
};
