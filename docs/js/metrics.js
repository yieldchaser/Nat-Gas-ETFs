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

    // ---- VOLATILITY MODELLING ----

    // Realized historical volatility (annualized %)
    // Returns std of log-returns × √252 × 100
    computeHV(closes, window) {
        if (closes.length < window + 1) return null;
        const slice = closes.slice(-(window + 1));
        const logRets = [];
        for (let i = 1; i < slice.length; i++) {
            if (slice[i - 1] > 0 && slice[i] > 0) logRets.push(Math.log(slice[i] / slice[i - 1]));
        }
        if (logRets.length < 2) return null;
        return this.std(logRets) * Math.sqrt(252) * 100;
    },

    // ATR-14 as % of current price (uses OHLC)
    computeATR14pct(highs, lows, closes) {
        const n = Math.min(highs.length, lows.length, closes.length);
        if (n < 15) return null;
        const trs = [];
        for (let i = n - 14; i < n; i++) {
            const h = highs[i], l = lows[i], prevC = closes[i - 1];
            if (h == null || l == null || prevC == null) continue;
            trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
        }
        if (trs.length < 7) return null;
        const atr = this.mean(trs);
        const price = closes[n - 1];
        return price > 0 ? (atr / price) * 100 : null;
    },

    // Vol regime percentile: where does current HV21 sit vs its trailing 252-day history?
    // Returns 0–100 (0=historically quiet, 100=historically extreme)
    computeVolRegimePct(closes) {
        const needed = 252 + 21 + 1;
        if (closes.length < needed) return null;
        const slice = closes.slice(-needed);
        // Build a series of HV21 values (one per day over the 252-day window)
        const hvSeries = [];
        for (let i = 21; i < slice.length; i++) {
            const hv = this.computeHV(slice.slice(0, i + 1), 21);
            if (hv != null) hvSeries.push(hv);
        }
        if (hvSeries.length < 2) return null;
        const current = hvSeries[hvSeries.length - 1];
        return this.percentileRank(current, hvSeries);
    },

    // Rolling HV series for the Vol Regime sparkline.
    // Returns the last `seriesLength` daily values of the rolling HV-hvWindow series.
    computeHVSeries(closes, hvWindow, seriesLength) {
        const minNeeded = hvWindow + 1;
        if (closes.length < minNeeded) return [];
        const startIdx = Math.max(hvWindow, closes.length - seriesLength - hvWindow);
        const series = [];
        for (let i = startIdx; i < closes.length; i++) {
            const hv = this.computeHV(closes.slice(0, i + 1), hvWindow);
            if (hv != null) series.push(hv);
        }
        return series.slice(-seriesLength);
    },

    // Per-window HV percentile: where does the current HV-N sit in its own full available history?
    // Returns 0–100. Uses ALL available closes as reference population.
    computeHVPercentile(closes, hvWindow) {
        const minNeeded = hvWindow + 5;
        if (closes.length < minNeeded) return null;
        // Build a series of HV values across all available history
        const series = [];
        for (let i = hvWindow; i < closes.length; i++) {
            const hv = this.computeHV(closes.slice(0, i + 1), hvWindow);
            if (hv != null) series.push(hv);
        }
        if (series.length < 5) return null;
        return this.percentileRank(series[series.length - 1], series);
    },

    // HV term structure: HV10 / HV63
    // < 0.65 = calming  |  ~1.0 = stable  |  > 1.35 = accelerating
    computeHVTermStructure(closes) {
        const hv10 = this.computeHV(closes, 10);
        const hv63 = this.computeHV(closes, 63);
        if (hv10 == null || hv63 == null || hv63 === 0) return null;
        return hv10 / hv63;
    },

    // Vol-of-Vol (VoV-21): 21-period std of the 10d HV series.
    // Units: percentage points (how much annualized HV10 swings over 21 days).
    // High VoV → vol itself is rapidly changing → unstable regime.
    computeVoV21(closes) {
        const needed = 21 + 10 + 1; // 32 closes for 21 HV10 values
        if (closes.length < needed) return null;
        const slice = closes.slice(-needed);
        const hv10Series = [];
        for (let i = 10; i < slice.length; i++) {
            const hv = this.computeHV(slice.slice(0, i + 1), 10);
            if (hv != null) hv10Series.push(hv);
        }
        if (hv10Series.length < 10) return null;
        // hv10Series values are already annualized % — no re-annualization needed
        return this.std(hv10Series);
    },

    // VCVI: Vol-adjusted CVI
    // Boosts signal when vol is quiet (0th pct → ×1.5), discounts in turbulent regimes (100th → ×0.5)
    computeVCVI(cvi, volRegimePct) {
        if (cvi == null) return null;
        if (volRegimePct == null) return cvi;
        const multiplier = 1.5 - volRegimePct / 100.0;
        return Math.max(0, cvi * multiplier);
    },

    // Human-readable vol regime label
    getVolRegimeLabel(volRegimePct) {
        if (volRegimePct == null) return { label: '--', cls: 'vr-unknown' };
        const t = CONFIG.thresholds.volRegime;
        if (volRegimePct >= t.extreme)  return { label: 'EXTREME', cls: 'vr-extreme' };
        if (volRegimePct >= t.high)     return { label: 'HIGH',    cls: 'vr-high' };
        if (volRegimePct >= t.normal)   return { label: 'NORMAL',  cls: 'vr-normal' };
        if (volRegimePct >= t.low)      return { label: 'QUIET',   cls: 'vr-quiet' };
        return { label: 'LOW',  cls: 'vr-low' };
    },

    // HV term structure label + arrow
    getTermStructureLabel(ratio) {
        if (ratio == null) return { label: '--', arrow: '', cls: 'ts-neutral' };
        const t = CONFIG.thresholds.hvTermStructure;
        if (ratio >= t.accelerating)   return { label: ratio.toFixed(2) + 'x', arrow: '↑↑', cls: 'ts-accel' };
        if (ratio >= t.stable_high)    return { label: ratio.toFixed(2) + 'x', arrow: '↑',  cls: 'ts-building' };
        if (ratio >= t.stable_low)     return { label: ratio.toFixed(2) + 'x', arrow: '→',  cls: 'ts-neutral' };
        if (ratio >= t.calming)        return { label: ratio.toFixed(2) + 'x', arrow: '↓',  cls: 'ts-easing' };
        return { label: ratio.toFixed(2) + 'x', arrow: '↓↓', cls: 'ts-calm' };
    },

    // ---- FULL ETF METRIC SUITE ----

    computeAllMetrics(etfData) {
        if (!etfData || !etfData.data || etfData.data.length < 30) return null;

        const d = etfData.data;
        const closes = d.map(x => x.close);
        const highs  = d.map(x => x.high);
        const lows   = d.map(x => x.low);
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

        // ---- Volatility modelling ----
        const hv = {
            '5d':  this.computeHV(closes, 5),
            '10d': this.computeHV(closes, 10),
            '21d': this.computeHV(closes, 21),
            '63d': this.computeHV(closes, 63),
            '252d': this.computeHV(closes, 252),
        };
        // Rolling 21D HV series for the Vol Regime sparkline (full available history)
        const hvSeries21 = this.computeHVSeries(closes, 21, closes.length);
        // Per-window HV percentiles vs full available history (for regime colouring)
        const hvPercentiles = {
            '5d':  this.computeHVPercentile(closes, 5),
            '21d': this.computeHVPercentile(closes, 21),
            '63d': this.computeHVPercentile(closes, 63),
            '252d': this.computeHVPercentile(closes, 252),
        };
        const atr14Pct       = this.computeATR14pct(highs, lows, closes);
        const volRegimePct   = this.computeVolRegimePct(closes);
        const hvTermStructure = this.computeHVTermStructure(closes);
        const vov21          = this.computeVoV21(closes);

        // VCVI per window
        const vcvi = {};
        for (const w of CONFIG.windows.percentile) {
            vcvi[`${w}d`] = this.computeVCVI(cvi[`${w}d`], volRegimePct);
        }

        // VPS using 21d window as primary + inverted vol regime as 5th component
        const w = CONFIG.vpsWeights;
        const rvolNorm   = rvol['21d']         != null ? Math.min(100, Math.max(0, (Math.log2(Math.max(0.5, rvol['21d'])) + 1) * 33.3)) : 0;
        const zNorm      = zScore['21d']        != null ? Math.min(100, Math.max(0, (zScore['21d'] + 2) * 12.5)) : 0;
        const pctNorm    = volPercentile['21d'] != null ? volPercentile['21d'] : 0;
        const vrocNorm   = vroc['10d']          != null ? Math.min(100, Math.max(0, (vroc['10d'] + 100) / 5)) : 0;
        const invVolReg  = volRegimePct         != null ? (100 - volRegimePct) : 50;
        const vps = w.rvol * rvolNorm + w.zScore * zNorm + w.percentile * pctNorm
                  + w.vroc * vrocNorm + w.volRegime * invVolReg;

        // ---- end volatility block ----

        // ---- Dollar Volume Metrics ----
        const dvSeries = closes.map((c, i) => c * volumes[i]);
        const dvRvol = {};
        const dvZScore = {};
        const dvPercentile = {};
        const dvVroc = {};
        for (const dw of CONFIG.windows.rvol) {
            dvRvol[`${dw}d`] = this.computeRVOL(dvSeries, dw);
            dvZScore[`${dw}d`] = this.computeZScore(dvSeries, dw);
            dvPercentile[`${dw}d`] = this.computePercentile(dvSeries[dvSeries.length - 1], dvSeries, dw);
        }
        for (const dw of CONFIG.windows.vroc) {
            dvVroc[`${dw}d`] = this.computeVROC(dvSeries, dw);
        }
        // DVCVI = dv_percentile × (1 − price_percentile / 100)
        const dvcvi = {};
        for (const dw of CONFIG.windows.percentile) {
            dvcvi[`${dw}d`] = this.computeCVI(dvPercentile[`${dw}d`], pricePercentile[`${dw}d`]);
        }
        // VDDS = DV-RVOL-21d / S-RVOL-21d (current reading)
        const dvRvol21 = dvRvol['21d'];
        const sRvol21  = rvol['21d'];
        const vdds = (dvRvol21 != null && sRvol21 != null && sRvol21 !== 0) ? dvRvol21 / sRvol21 : null;
        // DV-VPS (same weights as VPS but using DV metrics)
        const dvRvolNorm  = dvRvol['21d']         != null ? Math.min(100, Math.max(0, (Math.log2(Math.max(0.5, dvRvol['21d'])) + 1) * 33.3)) : 0;
        const dvZNorm     = dvZScore['21d']        != null ? Math.min(100, Math.max(0, (dvZScore['21d'] + 2) * 12.5)) : 0;
        const dvPctNorm   = dvPercentile['21d']    != null ? dvPercentile['21d'] : 0;
        const dvVrocNorm  = dvVroc['10d']          != null ? Math.min(100, Math.max(0, (dvVroc['10d'] + 100) / 5)) : 0;
        const dvVps = w.rvol * dvRvolNorm + w.zScore * dvZNorm + w.percentile * dvPctNorm
                    + w.vroc * dvVrocNorm + w.volRegime * invVolReg;
        // ---- end dollar volume block ----

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
            cvi, vcvi, vps, rvol, zScore, volPercentile, mwca,
            volRegimePct, vov21, atr14Pct, changePct
        });

        // Get alert level for card styling — use VCVI (vol-adjusted) as primary signal
        const maxVcvi = Math.max(...Object.values(vcvi).filter(v => v != null), 0);
        const tv = CONFIG.thresholds.vcvi;
        let alertLevel = 'none';
        if (maxVcvi >= tv.extreme || mwca) alertLevel = 'extreme';
        else if (maxVcvi >= tv.critical)   alertLevel = 'critical';
        else if (maxVcvi >= tv.high)       alertLevel = 'high';
        else if (maxVcvi >= tv.elevated)   alertLevel = 'elevated';

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
            cvi, vcvi, vps, mwca, mwcaCount,
            volatility: { hv, hvSeries21, hvPercentiles, atr14Pct, volRegimePct, hvTermStructure, vov21 },
            dvRvol, dvZScore, dvPercentile, dvVroc, dvcvi, dvVps, vdds,
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

        // VCVI alerts — vol-adjusted CVI (primary capitulation signal)
        for (const [window, value] of Object.entries(metrics.vcvi || {})) {
            if (value == null) continue;
            if (value >= t.vcvi.extreme) {
                alerts.push({ type: 'vcvi', level: 'extreme', ticker, time: now,
                    message: `VCVI-${window} at ${value.toFixed(0)} — EXTREME vol-adj capitulation` });
            } else if (value >= t.vcvi.critical) {
                alerts.push({ type: 'vcvi', level: 'critical', ticker, time: now,
                    message: `VCVI-${window} at ${value.toFixed(0)} — vol-adj capitulation watch` });
            }
        }

        // MWCA
        if (metrics.mwca) {
            alerts.push({ type: 'mwca', level: 'extreme', ticker, time: now,
                message: `MWCA triggered — top ${t.mwca_threshold}th pct across ALL windows` });
        }

        // RVOL
        for (const [window, value] of Object.entries(metrics.rvol)) {
            if (value != null && value >= t.rvol.critical) {
                alerts.push({ type: 'rvol', level: 'critical', ticker, time: now,
                    message: `RVOL-${window} at ${value.toFixed(1)}x — Major volume surge` });
            }
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
        if (value == null) return 'rgba(255, 255, 255, 0.85)';
        if (value >= thresholds.extreme) return 'var(--purple)';
        if (value >= thresholds.critical) return 'var(--red)';
        if (value >= thresholds.high) return 'var(--orange)';
        if (value >= thresholds.elevated) return 'var(--yellow)';
        return 'var(--blue)';
    }
};
