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

    // Precomputed log-return series (null = invalid pair, matching computeHV's skip).
    // Enables O(n) rolling HV instead of re-slicing closes per day.
    _logRets(closes) {
        const out = new Array(Math.max(0, closes.length - 1));
        for (let i = 1; i < closes.length; i++) {
            const a = closes[i - 1], b = closes[i];
            out[i - 1] = (a > 0 && b > 0) ? Math.log(b / a) : null;
        }
        return out;
    },

    // Sample stddev over rets[start, end), skipping nulls — identical arithmetic
    // to std() of the equivalent filtered log-return list.
    _stdSegment(rets, start, end) {
        let cnt = 0, sum = 0;
        for (let i = start; i < end; i++) { const v = rets[i]; if (v != null) { cnt++; sum += v; } }
        if (cnt < 2) return null;
        const mean = sum / cnt;
        let sq = 0;
        for (let i = start; i < end; i++) { const v = rets[i]; if (v != null) sq += (v - mean) ** 2; }
        return Math.sqrt(sq / (cnt - 1));
    },

    _hvFromRets(rets, start, end) {
        const s = this._stdSegment(rets, start, end);
        if (s == null) return null;
        return s * Math.sqrt(252) * 100;
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
        const rets = this._logRets(slice);
        const hvSeries = [];
        for (let i = 21; i < slice.length; i++) {
            const hv = this._hvFromRets(rets, i - 21, i);
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
        const rets = this._logRets(closes);
        const series = [];
        for (let i = startIdx; i < closes.length; i++) {
            const hv = this._hvFromRets(rets, i - hvWindow, i);
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
        const rets = this._logRets(closes);
        const series = [];
        for (let i = hvWindow; i < closes.length; i++) {
            const hv = this._hvFromRets(rets, i - hvWindow, i);
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
        const rets = this._logRets(slice);
        const hv10Series = [];
        for (let i = 10; i < slice.length; i++) {
            const hv = this._hvFromRets(rets, i - 10, i);
            if (hv != null) hv10Series.push(hv);
        }
        if (hv10Series.length < 10) return null;
        // hv10Series values are already annualized % — no re-annualization needed
        return this.std(hv10Series);
    },

    // ── Trend Ratio (TR) ──────────────────────────────────────────────────────
    // Compares RV sampled weekly to RV sampled daily over a 20-day window.
    // When weekly vol < daily vol, intraday noise dominates (chop).
    // When weekly vol ≈ daily vol, sustained directional moves dominate (trend).
    //
    // For leveraged ETFs, TR is structurally < 1.0 due to daily rebalancing decay,
    // so use computeTRPercentile for regime signals rather than absolute thresholds.
    //
    // Method from weekly-sampled RV literature:
    //   daily_RV  = sqrt(mean(logRet_daily²)) × sqrt(252) × 100
    //   weekly_RV = std(4 five-day log-returns)  × sqrt(251/20) × 100
    //   TR = weekly_RV / daily_RV
    computeTR(closes, window = 20) {
        if (closes.length < window + 1) return null;
        const c = closes.slice(-(window + 1));

        // Daily RV (uses mean of squared returns, not std — matches Yang-Zhang convention)
        const dailyRets = [];
        for (let i = 1; i < c.length; i++) {
            if (c[i-1] > 0 && c[i] > 0) dailyRets.push(Math.log(c[i] / c[i-1]));
        }
        if (dailyRets.length < 5) return null;
        const meanSq = dailyRets.reduce((a, b) => a + b * b, 0) / dailyRets.length;
        const rvDaily = Math.sqrt(meanSq) * Math.sqrt(252) * 100;
        if (rvDaily === 0) return null;

        // Weekly RV: 4 non-overlapping 5-day log-returns
        // Annualize by sqrt(252/5) — there are 252/5 ≈ 50.4 weeks in a trading year.
        // Using sqrt(251/20) would be wrong by a factor of ~2× and make TR > 1.0 near-impossible.
        const weeklyRets = [];
        for (let j = 1; j <= 4; j++) {
            const p0 = c[(j - 1) * 5], p1 = c[j * 5];
            if (p0 > 0 && p1 > 0) weeklyRets.push(Math.log(p1 / p0));
        }
        if (weeklyRets.length < 3) return null;
        const rvWeekly = this.std(weeklyRets) * Math.sqrt(252 / 5) * 100;

        return rvWeekly / rvDaily;
    },

    // TR from a shared log-return series at window start s — identical arithmetic
    // to computeTR(closes.slice(s, s + 21)).
    _trFromRets(closes, rets, s, window = 20) {
        let cnt = 0, sqSum = 0;
        for (let k = s; k < s + window; k++) { const v = rets[k]; if (v != null) { cnt++; sqSum += v * v; } }
        if (cnt < 5) return null;
        const rvDaily = Math.sqrt(sqSum / cnt) * Math.sqrt(252) * 100;
        if (rvDaily === 0) return null;
        const weeklyRets = [];
        for (let j = 1; j <= 4; j++) {
            const p0 = closes[s + (j - 1) * 5], p1 = closes[s + j * 5];
            if (p0 > 0 && p1 > 0) weeklyRets.push(Math.log(p1 / p0));
        }
        if (weeklyRets.length < 3) return null;
        const rvWeekly = this.std(weeklyRets) * Math.sqrt(252 / 5) * 100;
        return rvWeekly / rvDaily;
    },

    // Rolling TR series — uses window slicing to avoid O(n) allocs per iteration
    computeTRSeries(closes, seriesLength) {
        if (closes.length < 21) return [];
        const n = closes.length;
        const startIdx = seriesLength ? Math.max(20, n - seriesLength) : 20;
        const out = [];
        for (let i = startIdx; i < n; i++) {
            out.push(this.computeTR(closes.slice(Math.max(0, i - 20), i + 1)));
        }
        return out;
    },

    // Rolling VoV-21 series — null-padded to align with closes
    computeVoVSeries(closes, seriesLength) {
        const needed = 32; // 21 + 10 + 1
        if (closes.length < needed) return [];
        const n = closes.length;
        const startIdx = seriesLength ? Math.max(needed - 1, n - seriesLength) : needed - 1;
        const out = [];
        for (let i = startIdx; i < n; i++) {
            out.push(this.computeVoV21(closes.slice(Math.max(0, i - (needed - 1)), i + 1)));
        }
        return out;
    },

    // TR percentile: where does current TR sit vs full available history?
    // Returns 0–100. Needed because leveraged ETFs are always structurally below TR=1.0.
    computeTRPercentile(closes) {
        if (closes.length < 25) return null;
        const rets = this._logRets(closes);
        const series = [];
        for (let i = 20; i < closes.length; i++) {
            const tr = this._trFromRets(closes, rets, i - 20);
            if (tr != null) series.push(tr);
        }
        if (series.length < 5) return null;
        return this.percentileRank(series[series.length - 1], series);
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
        if (volRegimePct == null) return { label: '—', cls: 'vr-unknown' };
        const t = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.thresholds && CONFIG.thresholds.volRegime)
            ? CONFIG.thresholds.volRegime
            : { extreme: 92, high: 80, normal: 60, low: 30 };
        if (volRegimePct >= t.extreme)  return { label: 'EXTREME', cls: 'vr-extreme' };
        if (volRegimePct >= t.high)     return { label: 'HIGH',    cls: 'vr-high' };
        if (volRegimePct >= t.normal)   return { label: 'NORMAL',  cls: 'vr-normal' };
        if (volRegimePct >= t.low)      return { label: 'QUIET',   cls: 'vr-quiet' };
        return { label: 'LOW',  cls: 'vr-low' };
    },

    // HV term structure label + arrow
    getTermStructureLabel(ratio) {
        if (ratio == null) return { label: '—', arrow: '', cls: 'ts-neutral' };
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
        // Upgraded VDDS kernel (volume-preserving, split-invariant)
        const upgradedVddsSeries = this.computeUpgradedVDDS(d);
        const latestVddsRecord = (upgradedVddsSeries && upgradedVddsSeries.length)
            ? upgradedVddsSeries[upgradedVddsSeries.length - 1]
            : null;
        const dvRvol21 = dvRvol['21d'];
        const sRvol21  = rvol['21d'];
        const vdds = latestVddsRecord ? latestVddsRecord.vddsStar : ((dvRvol21 != null && sRvol21 != null && sRvol21 !== 0) ? dvRvol21 / sRvol21 : null);
        const drvol = latestVddsRecord ? latestVddsRecord.drvol : dvRvol21;
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
            dvRvol, dvZScore, dvPercentile, dvVroc, dvcvi, dvVps, vdds, drvol, vddsRecord: latestVddsRecord,
            priceMAs, volumeMAs,
            rollingCorr,
            alerts, alertLevel,
            sparkData,
            history: d,
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

        // Flow Velocity & Acceleration Alerts
        if (metrics.vel_z_1d != null) {
            if (metrics.vel_z_1d >= 2.0) {
                alerts.push({ type: 'flow_accel', level: 'critical', ticker, time: now,
                    message: `[FLOW ACCELERATION] Vel Z at +${metrics.vel_z_1d.toFixed(2)}σ — Bull Launch Impulse` });
            } else if (metrics.vel_z_1d <= -2.0) {
                alerts.push({ type: 'flow_accel', level: 'critical', ticker, time: now,
                    message: `[FLOW ACCELERATION] Vel Z at ${metrics.vel_z_1d.toFixed(2)}σ — Bear Surge Impulse` });
            }
        }

        return alerts;
    },

    // ---- CROSS-INSTRUMENT METRICS & UPGRADED STRESS ENGINE ----

    _clamp(val, min, max) {
        if (typeof val !== 'number' || !Number.isFinite(val)) return min;
        return val < min ? min : val > max ? max : val;
    },

    _sigmoid(x) {
        if (typeof x !== 'number' || !Number.isFinite(x)) return 0.5;
        if (x >= 30.0) return 1.0;
        if (x <= -30.0) return 0.0;
        return 1.0 / (1.0 + Math.exp(-x));
    },

    _softWinsorizeVolTrack(drvol, knee = 2.25, maxTrack = 3.0, scale = 1.5) {
        if (!Number.isFinite(drvol) || drvol <= 0.0) return 0.0;
        if (drvol <= knee) return drvol;
        return this._clamp(knee + (maxTrack - knee) * Math.tanh((drvol - knee) / scale), 0.0, maxTrack);
    },

    _resolveVolModeColorBand(drvol) {
        if (!Number.isFinite(drvol) || drvol < 0.8) return 'rgba(255, 255, 255, 0.35)';
        if (drvol < 1.2) return 'rgba(255, 255, 255, 0.70)';
        if (drvol < 1.5) return 'var(--blue)';
        if (drvol < 2.0) return 'var(--yellow)';
        if (drvol < 2.5) return 'var(--orange)';
        if (drvol < 3.0) return 'var(--red)';
        return 'var(--purple)';
    },

    _resolveDollarModeColorBand(vddsStar) {
        if (!Number.isFinite(vddsStar)) return 'rgba(255, 255, 255, 0.70)';
        if (vddsStar < 0.78) return '#10b981'; // Emerald (Deep Capitulation)
        if (vddsStar < 0.97) return '#06b6d4'; // Cyan (Mild Capitulation / Distribution)
        if (vddsStar <= 1.03) return 'rgba(255, 255, 255, 0.70)'; // Neutral Balanced
        if (vddsStar <= 1.25) return '#f97316'; // Orange (Accumulation)
        return '#ef4444'; // Red (Strong Momentum)
    },

    /**
     * Upgraded Volume-Dollar Flow Divergence (VDDS*) Kernel
     * Grounded in Kyle-Bouchaud microstructure impact physics:
     * Eliminates the volume cancellation dilemma (V_t vanishing in C_t / VWAP_21),
     * guarantees split-invariance via notional turnover D_t = P_typ * V_t,
     * and bounds output cleanly within [0.50, 1.50] with 1.00x neutral center.
     */
    computeUpgradedVDDS(barHistory, options = {}) {
        if (!Array.isArray(barHistory) || barHistory.length === 0) return [];

        const cacheKey = barHistory.length > 0
            ? `${barHistory.length}|${barHistory[barHistory.length - 1].date || ''}|${barHistory[0].date || ''}`
            : '';
        if (!this._vddsCache) this._vddsCache = new Map();
        if (cacheKey && this._vddsCache.has(cacheKey)) {
            return this._vddsCache.get(cacheKey);
        }

        const ewmaSpan = Math.max(options.ewmaSpan ?? 21, 2);
        const atrSpan = Math.max(options.atrSpan ?? 14, 2);
        const baselineCapMultiple = Math.max(options.baselineOutlierCap ?? 5.0, 1.5);
        const kappaD = Math.max(options.vddsParticipationPrior ?? 0.25, 0.01);
        const gammaD = this._clamp(options.vddsParticipationPower ?? 0.65, 0.1, 1.5);
        const kappaE = Math.max(options.vddsEfficiencyPrior ?? 0.35, 0.01);
        const betaE = this._clamp(options.vddsEfficiencyPower ?? 0.35, 0.1, 1.0);
        const lambdaV = Math.max(options.vddsTanhLambda ?? 0.90, 0.1);
        const splitJumpThreshold = Math.max(options.splitJumpRatioThreshold ?? 2.8, 1.8);
        const priceEpsilon = 1e-4;
        const epsilon = 1e-9;

        const byDate = new Map();
        for (let i = 0; i < barHistory.length; i++) {
            const b = barHistory[i];
            const px = (b.close != null ? b.close : b.price);
            if (b && typeof b.date === 'string' && b.date.length >= 10 && Number.isFinite(px) && px > 0) {
                byDate.set(b.date.slice(0, 10), b);
            }
        }
        const sorted = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        if (sorted.length === 0) return [];

        const alpha21 = 2.0 / (ewmaSpan + 1.0);
        const alphaAtr = 2.0 / (atrSpan + 1.0);

        let ewmaDollarVol = 0.0;
        let ewmaShareVol = 0.0;
        let ewmaPctAtr = 0.03;
        let ewmaVariance = 0.0009;
        let ewmaEfficiency = 0.0;
        let syntheticPriceIndex = 100.0;
        let dwmaSyntheticPriceIndex = 100.0;

        const canonicalSplits = [4, 5, 8, 10, 12, 15, 20, 25, 0.5, 0.25, 0.2, 0.1];
        const output = new Array(sorted.length);

        for (let i = 0; i < sorted.length; i++) {
            const bar = sorted[i];
            const close = Math.max(bar.close != null ? bar.close : bar.price, priceEpsilon);
            const high = Number.isFinite(bar.high) && bar.high >= close ? bar.high : close;
            const low = Number.isFinite(bar.low) && bar.low <= close && bar.low > 0 ? bar.low : close;
            const volume = Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : 0.0;

            const typicalPrice = (high + low + 2.0 * close) * 0.25;
            const dollarTurnover = typicalPrice * volume;

            const prevRawClose = i > 0 ? Math.max(sorted[i - 1].close != null ? sorted[i - 1].close : sorted[i - 1].price, priceEpsilon) : close;
            let effPrevClose = prevRawClose;
            let isSplitBar = false;
            let splitFactor = 1.0;

            if (i > 0) {
                const explicitSplit = Number.isFinite(bar.splitFactor) && bar.splitFactor > 0 ? bar.splitFactor : 1.0;
                if (Math.abs(explicitSplit - 1.0) > 1e-6) {
                    effPrevClose = prevRawClose * explicitSplit;
                    isSplitBar = true;
                    splitFactor = explicitSplit;
                } else {
                    const rawRatio = close / prevRawClose;
                    if (rawRatio >= splitJumpThreshold || rawRatio <= 1.0 / splitJumpThreshold) {
                        const openPx = Number.isFinite(bar.open) && bar.open > 0 ? bar.open : close;
                        const openRatio = openPx / prevRawClose;
                        let bestFactor = openRatio;
                        let minErr = Infinity;
                        for (let k = 0; k < canonicalSplits.length; k++) {
                            const cand = canonicalSplits[k];
                            const err = Math.abs(openRatio - cand) / cand;
                            if (err < minErr && err < 0.25) {
                                minErr = err;
                                bestFactor = cand;
                            }
                        }
                        effPrevClose = prevRawClose * bestFactor;
                        isSplitBar = true;
                        splitFactor = bestFactor;
                    }
                }
            }
            effPrevClose = Math.max(effPrevClose, priceEpsilon);

            const logReturn = i > 0 ? Math.log(this._clamp(close / effPrevClose, 0.05, 20.0)) : 0.0;
            const intrabarRange = Math.max(0.0, high - low);
            const trueRange = i > 0
                ? Math.max(intrabarRange, Math.abs(high - effPrevClose), Math.abs(low - effPrevClose), priceEpsilon * close)
                : Math.max(intrabarRange, 0.015 * close, priceEpsilon * close);
            const pctTrueRange = this._clamp(trueRange / effPrevClose, priceEpsilon, 2.0);

            if (i === 0) {
                ewmaDollarVol = Math.max(dollarTurnover, epsilon);
                ewmaShareVol = Math.max(volume, epsilon);
                ewmaPctAtr = Math.max(pctTrueRange, 0.005);
                ewmaVariance = ewmaPctAtr * ewmaPctAtr;
                ewmaEfficiency = dollarTurnover / ewmaPctAtr;
                syntheticPriceIndex = 100.0;
                dwmaSyntheticPriceIndex = 100.0;
            } else {
                syntheticPriceIndex *= Math.exp(logReturn);
            }

            const baselineDollarVol = Math.max(ewmaDollarVol, epsilon);
            const baselineShareVol = isSplitBar && splitFactor > 0
                ? Math.max(ewmaShareVol / splitFactor, epsilon)
                : Math.max(ewmaShareVol, epsilon);
            const causalPctAtr = Math.max(ewmaPctAtr, priceEpsilon);
            const causalDailySigma = Math.max(Math.sqrt(ewmaVariance), priceEpsilon);
            const baselineEfficiency = Math.max(ewmaEfficiency, epsilon);

            // 1. Causal Notional Dollar RVOL & Split-Guarded Share RVOL
            const drvol = dollarTurnover > 0 ? dollarTurnover / baselineDollarVol : 0.0;
            const srvol = volume > 0 ? volume / baselineShareVol : 0.0;

            // 2. Concave Participation Gate W_part,t
            const regDrvol = (dollarTurnover + kappaD * baselineDollarVol) / ((1.0 + kappaD) * baselineDollarVol);
            const participationGate = Math.pow(Math.max(regDrvol, 0.0), gammaD) * this._sigmoid((drvol - 0.75) / 0.25);

            // 3. Continuous Order-Flow Pressure Kernel Phi_t in [-1, +1]
            const clvDenom = Math.max(intrabarRange, 0.25 * causalPctAtr * close, priceEpsilon * close);
            const clv = this._clamp((2.0 * close - high - low) / clvDenom, -1.0, 1.0);
            const returnImpulse = Math.tanh(logReturn / causalPctAtr);
            const orderFlowPhi = Math.tanh(0.55 * clv + 0.75 * returnImpulse);

            // 4. Capital Intensity per Unit of Volatility E_t
            const effectiveVolFloor = Math.max(pctTrueRange, 0.20 * causalDailySigma, priceEpsilon);
            const currentEfficiency = dollarTurnover / effectiveVolFloor;
            const regEfficiency = (currentEfficiency + kappaE * baselineEfficiency) / ((1.0 + kappaE) * baselineEfficiency);
            const volatilityEfficiency = this._clamp(Math.pow(Math.max(regEfficiency, 0.0), betaE), 0.50, 2.00);

            // 5. Split-Invariant Notional-Anchored Price Displacement q_t in [-1, +1]
            const anchorDisplacement = Math.tanh(
                Math.log(Math.max(syntheticPriceIndex, epsilon) / Math.max(dwmaSyntheticPriceIndex, epsilon)) /
                Math.max(2.5 * causalDailySigma, priceEpsilon)
            );

            // 6. Synthesize VDDS* in [0.50, 1.50]
            const directionalComposite = 0.70 * orderFlowPhi + 0.30 * anchorDisplacement;
            const flowKernel = participationGate * volatilityEfficiency * directionalComposite;
            const vddsStar = this._clamp(1.0 + 0.50 * Math.tanh(lambdaV * flowKernel), 0.50, 1.50);

            // 7. Dual-Mode UI Geometry
            const volClamped = this._softWinsorizeVolTrack(drvol, 2.25, 3.0, 1.5);
            const volTrackWidthPct = this._clamp((volClamped / 3.0) * 100.0, 0.0, 100.0);
            const signedOffsetPct = this._clamp((vddsStar - 1.0) * 100.0, -50.0, 50.0);
            const barLeftPct = signedOffsetPct < 0 ? 50.0 + signedOffsetPct : 50.0;
            const barWidthPct = Math.abs(signedOffsetPct);

            output[i] = {
                date: bar.date.slice(0, 10),
                close,
                volume,
                dollarTurnover,
                drvol,
                srvol,
                vddsStar,
                orderFlowPhi,
                participationGate,
                volatilityEfficiency,
                anchorDisplacement,
                syntheticPriceIndex,
                logReturn,
                atr14Pct: causalPctAtr,
                hv21Annualized: Math.sqrt(Math.max(ewmaVariance, epsilon) * 252.0),
                isSplitAdjustedBar: isSplitBar,
                inferredSplitFactor: splitFactor,
                ui: {
                    volMode: {
                        displayValue: Number(this._clamp(drvol, 0.0, 15.0).toFixed(2)),
                        clampedValue: Number(volClamped.toFixed(3)),
                        trackWidthPct: Number(volTrackWidthPct.toFixed(2)),
                        baselineAnchorPct: 33.33,
                        colorBand: this._resolveVolModeColorBand(drvol)
                    },
                    dollarMode: {
                        displayValue: Number(vddsStar.toFixed(2)),
                        centerAnchorPct: 50.0,
                        barLeftPct: Number(barLeftPct.toFixed(2)),
                        barWidthPct: Number(barWidthPct.toFixed(2)),
                        direction: vddsStar < 0.97 ? 'CAPITULATION_LEFT' : (vddsStar > 1.03 ? 'MOMENTUM_RIGHT' : 'BALANCED_CENTER'),
                        colorBand: this._resolveDollarModeColorBand(vddsStar)
                    }
                }
            };

            if (!bar.isHolidayCarryover) {
                const cappedDollarVol = Math.min(dollarTurnover, baselineCapMultiple * baselineDollarVol);
                const cappedShareVol = Math.min(volume, baselineCapMultiple * baselineShareVol);
                const cappedEff = Math.min(currentEfficiency, baselineCapMultiple * baselineEfficiency);

                ewmaDollarVol = alpha21 * cappedDollarVol + (1.0 - alpha21) * baselineDollarVol;
                ewmaShareVol = alpha21 * cappedShareVol + (1.0 - alpha21) * baselineShareVol;
                ewmaPctAtr = alphaAtr * pctTrueRange + (1.0 - alphaAtr) * causalPctAtr;
                ewmaVariance = alpha21 * (logReturn * logReturn) + (1.0 - alpha21) * ewmaVariance;
                ewmaEfficiency = alpha21 * cappedEff + (1.0 - alpha21) * baselineEfficiency;

                const dwmaNum = alpha21 * cappedDollarVol * syntheticPriceIndex + (1.0 - alpha21) * baselineDollarVol * dwmaSyntheticPriceIndex;
                const dwmaDen = Math.max(alpha21 * cappedDollarVol + (1.0 - alpha21) * baselineDollarVol, epsilon);
                dwmaSyntheticPriceIndex = dwmaNum / dwmaDen;
            }
        }

        if (cacheKey) {
            this._vddsCache.set(cacheKey, output);
        }
        return output;
    },

    /**
     * Enriches a single leg with participation-gated VCVI* and continuous fast-shock impulse.
     */
    enrichLegMicrostructureSeries(barHistory, options = {}) {
        const vddsSeries = this.computeUpgradedVDDS(barHistory, options);
        const n = vddsSeries.length;
        if (n === 0) return [];

        const dollarTurnovers = vddsSeries.map(r => r.dollarTurnover);
        const syntheticPrices = vddsSeries.map(r => r.syntheticPriceIndex);
        const hv21Series = vddsSeries.map(r => r.hv21Annualized);

        const enriched = new Array(n);
        let smoothedVcvi63 = 0.0;
        let smoothedVcvi5 = 0.0;

        for (let i = 0; i < n; i++) {
            const vdds = vddsSeries[i];
            const dvWin63 = dollarTurnovers.slice(Math.max(0, i - 62), i + 1);
            const pxWin63 = syntheticPrices.slice(Math.max(0, i - 62), i + 1);
            const dvWin21 = dollarTurnovers.slice(Math.max(0, i - 20), i + 1);
            const pxWin21 = syntheticPrices.slice(Math.max(0, i - 20), i + 1);
            const dvWin5 = dollarTurnovers.slice(Math.max(0, i - 4), i + 1);
            const pxWin5 = syntheticPrices.slice(Math.max(0, i - 4), i + 1);
            const hvWin252 = hv21Series.slice(Math.max(0, i - 251), i + 1);

            const volRegimePct = this.percentileRank(hv21Series[i], hvWin252);
            const volRegime = this.getVolRegimeLabel(volRegimePct).label;
            const volMultiplier = this._clamp(1.5 - volRegimePct / 100.0, 0.5, 1.5);

            const cvi63Raw = this.percentileRank(dollarTurnovers[i], dvWin63) * (1.0 - this.percentileRank(syntheticPrices[i], pxWin63) / 100.0);
            const cvi21Raw = this.percentileRank(dollarTurnovers[i], dvWin21) * (1.0 - this.percentileRank(syntheticPrices[i], pxWin21) / 100.0);
            const cvi5Raw = this.percentileRank(dollarTurnovers[i], dvWin5) * (1.0 - this.percentileRank(syntheticPrices[i], pxWin5) / 100.0);

            // Participation gate eliminates the 3NGL.L low-volume percentile mirage (L-CAP 70 on 0.7x RVOL)
            const capParticipationGate = this._sigmoid((vdds.drvol - 0.90) / 0.20);

            const vcvi63Instant = this._clamp(cvi63Raw * volMultiplier * capParticipationGate, 0.0, 100.0);
            const vcvi21Instant = this._clamp(cvi21Raw * volMultiplier * capParticipationGate, 0.0, 100.0);
            const vcvi5Instant = this._clamp(cvi5Raw * volMultiplier * capParticipationGate, 0.0, 100.0);

            smoothedVcvi63 = i === 0 ? vcvi63Instant : 0.65 * vcvi63Instant + 0.35 * smoothedVcvi63;
            smoothedVcvi5 = i === 0 ? vcvi5Instant : 0.75 * vcvi5Instant + 0.25 * smoothedVcvi5;

            const absPctReturn = Math.abs(Math.exp(vdds.logReturn) - 1.0);
            const absReturnAtrMultiple = absPctReturn / Math.max(vdds.atr14Pct, 1e-4);
            const spikeActivation = this._sigmoid((vcvi5Instant - 42.0) / 4.0) * this._sigmoid((absReturnAtrMultiple - 1.85) / 0.25);

            enriched[i] = {
                ...vdds,
                cvi63Raw: Number(cvi63Raw.toFixed(2)),
                vcvi63: Number(smoothedVcvi63.toFixed(2)),
                vcvi21: Number(vcvi21Instant.toFixed(2)),
                vcvi5: Number(smoothedVcvi5.toFixed(2)),
                volRegimePct: Number(volRegimePct.toFixed(2)),
                volRegime,
                absReturnAtrMultiple: Number(absReturnAtrMultiple.toFixed(2)),
                spikeActivation: Number(spikeActivation.toFixed(4)),
                sharpSpikeFlag: spikeActivation >= 0.50,
                isHolidayCarryover: false,
                stalenessDays: 0
            };
        }

        return enriched;
    },

    /**
     * Upgraded Cross-Pair Stress Index (IPSI*)
     * Split- & float-invariant notional dollar formulation with Tikhonov prior (kappa = 0.50),
     * concave participation gate, structural carry asymmetry, and Schmitt-trigger hysteresis.
     */
    computeUpgradedIPSI(longHistory, shortHistory, options = {}) {
        if (!Array.isArray(longHistory) || !Array.isArray(shortHistory) || longHistory.length === 0 || shortHistory.length === 0) {
            return [];
        }

        const cacheKey = `${longHistory.length}|${shortHistory.length}|${longHistory[longHistory.length - 1].date || ''}|${shortHistory[shortHistory.length - 1].date || ''}`;
        if (!this._ipsiCache) this._ipsiCache = new Map();
        if (cacheKey && this._ipsiCache.has(cacheKey)) {
            return this._ipsiCache.get(cacheKey);
        }

        const kappa = Math.max(options.regularizationKappa ?? 0.50, 0.05);
        const gammaP = Math.max(options.participationGamma ?? 1.10, 0.1);
        const etaP = this._clamp(options.participationExponent ?? 0.65, 0.1, 1.5);
        const lambdaCap = this._clamp(options.capitulationWeight ?? 0.35, 0.0, 1.0);
        const tauZ = Math.max(options.sigmoidScaleTau ?? 1.15, 0.2);
        const maxStalenessDays = Math.max(options.maxHolidayStalenessDays ?? 4, 1);

        const longSeries = this.enrichLegMicrostructureSeries(longHistory, options);
        const shortSeries = this.enrichLegMicrostructureSeries(shortHistory, options);
        if (longSeries.length === 0 || shortSeries.length === 0) return [];

        const longByDate = new Map();
        for (let i = 0; i < longSeries.length; i++) longByDate.set(longSeries[i].date, longSeries[i]);

        const shortByDate = new Map();
        for (let i = 0; i < shortSeries.length; i++) shortByDate.set(shortSeries[i].date, shortSeries[i]);

        const unionDates = Array.from(new Set([...longByDate.keys(), ...shortByDate.keys()])).sort();

        const records = [];
        let prevState = null;
        let lastValidLong = null;
        let lastValidShort = null;

        for (let i = 0; i < unionDates.length; i++) {
            const date = unionDates[i];
            let lMetrics = longByDate.get(date) ?? null;
            let sMetrics = shortByDate.get(date) ?? null;

            if (!lMetrics && lastValidLong) {
                const stale = this._daysBetween(lastValidLong.date, date);
                if (stale <= maxStalenessDays) {
                    lMetrics = { ...lastValidLong, date, isHolidayCarryover: true, stalenessDays: stale };
                }
            } else if (lMetrics) {
                lastValidLong = lMetrics;
            }

            if (!sMetrics && lastValidShort) {
                const stale = this._daysBetween(lastValidShort.date, date);
                if (stale <= maxStalenessDays) {
                    sMetrics = { ...lastValidShort, date, isHolidayCarryover: true, stalenessDays: stale };
                }
            } else if (sMetrics) {
                lastValidShort = sMetrics;
            }

            if (!lMetrics || !sMetrics) continue;

            const drvolL = Math.max(lMetrics.drvol, 0.0);
            const drvolS = Math.max(sMetrics.drvol, 0.0);

            // 1. Regularized Log Turnover Ratio (immunized against denominator collapse)
            const logTurnoverRatio = Math.log((drvolS + kappa) / (drvolL + kappa));

            // 2. Concave Pair Participation Gate Omega_t in [0, 1]
            const avgPairDrvol = 0.5 * (drvolL + drvolS);
            const participationGate = Math.tanh(gammaP * Math.pow(Math.max(avgPairDrvol, 0.0), etaP));

            // 3. Structural Carry & Capitulation Differential Delta_cap,t
            const vcviLEff = 0.60 * lMetrics.vcvi63 + 0.40 * lMetrics.vcvi5;
            const vcviSEff = 0.60 * sMetrics.vcvi63 + 0.40 * sMetrics.vcvi5;
            const capitulationDifferential = lambdaCap * ((vcviSEff - vcviLEff) / 100.0);

            // 4. Latent Cross-Pair Stress Score Z_IPSI,t & Bounded Projections
            const latentScoreZ = participationGate * (logTurnoverRatio + capitulationDifferential);
            const tanhProjected = Math.tanh(latentScoreZ / tauZ);

            const ipsiSigned = this._clamp(100.0 * tanhProjected, -100.0, 100.0);
            const ipsi0to10 = this._clamp(5.0 + 5.0 * tanhProjected, 0.0, 10.0);
            const ipsiRegularizedRatio = this._clamp(Math.exp(latentScoreZ), 0.20, 5.00);

            const ipsiStar = {
                ipsiSigned: Number(ipsiSigned.toFixed(2)),
                ipsi0to10: Number(ipsi0to10.toFixed(2)),
                ipsiRegularizedRatio: Number(ipsiRegularizedRatio.toFixed(2)),
                participationGate: Number(participationGate.toFixed(4)),
                capitulationDifferential: Number(capitulationDifferential.toFixed(4)),
                latentScoreZ: Number(latentScoreZ.toFixed(4))
            };

            const stressState = this.evaluatePairStressState(ipsiStar, lMetrics, sMetrics, prevState);
            prevState = stressState;

            records.push({
                date,
                ipsiStar,
                longMetrics: lMetrics,
                shortMetrics: sMetrics,
                stressState
            });
        }

        if (cacheKey) {
            this._ipsiCache.set(cacheKey, records);
        }
        return records;
    },

    _daysBetween(dateA, dateB) {
        if (!dateA || !dateB) return Infinity;
        const tA = Date.UTC(Number(dateA.slice(0, 4)), Number(dateA.slice(5, 7)) - 1, Number(dateA.slice(8, 10)));
        const tB = Date.UTC(Number(dateB.slice(0, 4)), Number(dateB.slice(5, 7)) - 1, Number(dateB.slice(8, 10)));
        if (!Number.isFinite(tA) || !Number.isFinite(tB)) return Infinity;
        return Math.round(Math.abs(tB - tA) / 86400000);
    },

    /**
     * Evaluates the continuous multi-factor stress potentials (Psi_L, Psi_S) and resolves
     * the 8-state classification via a volatility-conditioned Schmitt-Trigger hysteresis machine.
     */
    evaluatePairStressState(ipsiStar, longMetrics, shortMetrics, previousState = null) {
        const maxStale = Math.max(longMetrics?.stalenessDays ?? 0, shortMetrics?.stalenessDays ?? 0);
        const avgVolPct = this._clamp(0.5 * ((longMetrics?.volRegimePct ?? 50) + (shortMetrics?.volRegimePct ?? 50)), 0.0, 100.0);
        const volRegime = this.getVolRegimeLabel(avgVolPct).label;

        if (maxStale > 4) {
            return {
                status: 'DATA_STALE',
                longTier: 0,
                shortTier: 0,
                longPotential: 0.0,
                shortPotential: 0.0,
                dwellBars: 1,
                hysteresisLatchActive: false,
                volRegime,
                volRegimePct: Number(avgVolPct.toFixed(1))
            };
        }

        const prevStatus = previousState?.status ?? 'QUIET';
        const prevLongTier = previousState?.longTier ?? 0;
        const prevShortTier = previousState?.shortTier ?? 0;
        const prevDwellBars = previousState?.dwellBars ?? 0;

        const ipsiSigned = this._clamp(ipsiStar?.ipsiSigned ?? 0.0, -100.0, 100.0);

        function computePotential(leg, signedIpsiForLeg, selfRef) {
            const s63 = selfRef._clamp(leg.vcvi63 ?? 0.0, 0.0, 100.0);
            const s5 = selfRef._clamp((55.0 / 45.0) * (leg.vcvi5 ?? 0.0), 0.0, 100.0);
            const drvol = Math.max(leg.drvol ?? 0.0, 0.05);
            const sDrvol = 100.0 * selfRef._sigmoid(1.65 * (Math.log(drvol) - 0.28));

            // Log-Sum-Exp aggregation over (s63, s5, sDrvol)
            const beta = 0.12;
            const maxS = Math.max(s63, s5, sDrvol);
            const lseCore = maxS + Math.log(
                Math.exp(beta * (s63 - maxS)) +
                Math.exp(beta * (s5 - maxS)) +
                Math.exp(beta * (sDrvol - maxS))
            ) / beta - (0.35 * Math.log(3.0)) / beta;

            const spikeBoost = 18.0 * selfRef._clamp(leg.spikeActivation ?? 0.0, 0.0, 1.0);
            const ipsiBoost = 20.0 * selfRef._clamp((signedIpsiForLeg - 20.0) / 80.0, 0.0, 1.0);
            const stalenessDecay = Math.exp(-0.35 * Math.max(0, leg.stalenessDays ?? 0));

            const rawPotential = Math.max(0.0, lseCore + spikeBoost + ipsiBoost) * stalenessDecay;
            return selfRef._clamp(100.0 * Math.tanh(rawPotential / 82.0), 0.0, 100.0);
        }

        const longPotential = computePotential(longMetrics, -ipsiSigned, this);
        const shortPotential = computePotential(shortMetrics, +ipsiSigned, this);

        // Volatility regime threshold shift delta_reg (-1.5 in LOW to +3.0 in EXTREME)
        const regimeShift = avgVolPct < 30.0 ? -1.5 : (avgVolPct < 60.0 ? -0.5 : (avgVolPct < 80.0 ? 0.0 : (avgVolPct < 92.0 ? +1.5 : +3.0)));

        const upThresholds = [0.0, 55.0 + regimeShift, 65.0 + regimeShift, 75.0 + regimeShift];
        const downThresholds = [0.0, 48.0 + regimeShift, 58.0 + regimeShift, 67.0 + regimeShift];

        function resolveTier(potential, prevTier) {
            for (let t = 3; t > prevTier; t--) {
                if (potential >= upThresholds[t]) return t;
            }
            let tier = prevTier;
            while (tier > 0 && potential < downThresholds[tier]) {
                tier--;
            }
            return tier;
        }

        const longTier = resolveTier(longPotential, prevLongTier);
        const shortTier = resolveTier(shortPotential, prevShortTier);

        const dualRetentionFloor = 46.0 + regimeShift;
        const holdDualFromPrev = prevStatus === 'DUAL' && longPotential >= dualRetentionFloor && shortPotential >= dualRetentionFloor;

        let status = 'QUIET';
        if ((longTier >= 1 && shortTier >= 1) || holdDualFromPrev) {
            status = 'DUAL';
        } else if (longTier >= 1) {
            status = longTier === 3 ? 'L-CRITICAL' : (longTier === 2 ? 'L-STRESS' : 'L-ELEVATED');
        } else if (shortTier >= 1) {
            status = shortTier === 3 ? 'S-CRITICAL' : (shortTier === 2 ? 'S-STRESS' : 'S-ELEVATED');
        }

        const hysteresisLatchActive = holdDualFromPrev ||
            (longTier > 0 && longPotential < upThresholds[longTier]) ||
            (shortTier > 0 && shortPotential < upThresholds[shortTier]);

        const dwellBars = status === prevStatus ? prevDwellBars + 1 : 1;

        return {
            status,
            longTier: holdDualFromPrev && longTier === 0 ? 1 : longTier,
            shortTier: holdDualFromPrev && shortTier === 0 ? 1 : shortTier,
            longPotential: Number(longPotential.toFixed(2)),
            shortPotential: Number(shortPotential.toFixed(2)),
            dwellBars,
            hysteresisLatchActive,
            volRegime,
            volRegimePct: Number(avgVolPct.toFixed(1))
        };
    },

    computeIPSI(longMetrics, shortMetrics) {
        if (!longMetrics || !shortMetrics) return null;

        if (longMetrics.history && shortMetrics.history && longMetrics.history.length && shortMetrics.history.length) {
            const ipsiSeries = this.computeUpgradedIPSI(longMetrics.history, shortMetrics.history);
            if (ipsiSeries && ipsiSeries.length) {
                const latest = ipsiSeries[ipsiSeries.length - 1];
                const ratio = latest.ipsiStar.ipsiRegularizedRatio;
                const num = new Number(ratio);
                num.ipsiStar = latest.ipsiStar;
                num.signed = latest.ipsiStar.ipsiSigned;
                num.scale10 = latest.ipsiStar.ipsi0to10;
                num.stressState = latest.stressState;
                num.latestRecord = latest;
                return num;
            }
        }

        const longRvol = longMetrics?.drvol ?? longMetrics?.rvol?.['21d'];
        const shortRvol = shortMetrics?.drvol ?? shortMetrics?.rvol?.['21d'];
        if (longRvol == null || shortRvol == null) return null;
        const regRatio = this._clamp((shortRvol + 0.5) / (longRvol + 0.5), 0.20, 5.00);
        return Number(regRatio.toFixed(2));
    },

    computePairStatus(ipsi, longMetrics, shortMetrics) {
        if (ipsi && ipsi.stressState) {
            const st = ipsi.stressState;
            const status = st.status;
            let cls = 'quiet';
            if (status.includes('CRITICAL')) cls = 'critical';
            else if (status.includes('STRESS') || status === 'DUAL') cls = 'stress';
            else if (status.includes('ELEVATED')) cls = 'elevated';

            let tooltip = '';
            if (status === 'DUAL') {
                tooltip = `Dual Stress: Both long and short legs are under elevated volume pressure (Long: ${st.longPotential.toFixed(0)} pts, Short: ${st.shortPotential.toFixed(0)} pts). Dwell: ${st.dwellBars} bars.`;
            } else if (status.startsWith('L-')) {
                tooltip = `Long-Side ${status.slice(2)}: Capitulation pressure on long ETF (Potential: ${st.longPotential.toFixed(0)} pts, VCVI: ${longMetrics?.vcvi?.['63d']?.toFixed(0) ?? '—'}). Historically signals commodity bottom / exhaustion. Dwell: ${st.dwellBars} bars.`;
            } else if (status.startsWith('S-')) {
                tooltip = `Short-Side ${status.slice(2)}: Panic buying/hedging into inverse ETF (Potential: ${st.shortPotential.toFixed(0)} pts, VCVI: ${shortMetrics?.vcvi?.['63d']?.toFixed(0) ?? '—'}). Signals commodity top exhaustion. Dwell: ${st.dwellBars} bars.`;
            } else {
                tooltip = `Balanced (QUIET): Neither ETF exhibits abnormal volume pressure or capitulation spikes (Long: ${st.longPotential.toFixed(0)} pts, Short: ${st.shortPotential.toFixed(0)} pts).`;
            }

            return {
                label: status,
                cls,
                tooltip,
                stressState: st
            };
        }

        // Fallback for isolated metrics without full history
        const tIpsi = CONFIG.thresholds.ipsi;
        const tVcvi = CONFIG.thresholds.vcvi;
        const longVcvi = longMetrics?.vcvi?.['63d'] ?? longMetrics?.cvi?.['63d'];
        const shortVcvi = shortMetrics?.vcvi?.['63d'] ?? shortMetrics?.cvi?.['63d'];
        const longVcvi5 = longMetrics?.vcvi?.['5d'] ?? longMetrics?.cvi?.['5d'];
        const shortVcvi5 = shortMetrics?.vcvi?.['5d'] ?? shortMetrics?.cvi?.['5d'];
        const longRvol = longMetrics?.drvol ?? longMetrics?.rvol?.['21d'];
        const shortRvol = shortMetrics?.drvol ?? shortMetrics?.rvol?.['21d'];

        const hasLongCap = (longVcvi != null && longVcvi >= tVcvi.elevated) || (longVcvi5 != null && longVcvi5 >= 45) || (longRvol != null && longRvol >= 1.5) || (longMetrics?.sharpSpike === true);
        const hasShortCap = (shortVcvi != null && shortVcvi >= tVcvi.elevated) || (shortVcvi5 != null && shortVcvi5 >= 45) || (shortRvol != null && shortRvol >= 1.5) || (ipsi != null && ipsi >= tIpsi.elevated) || (shortMetrics?.sharpSpike === true);

        if (hasLongCap && hasShortCap) return { label: 'DUAL', cls: 'stress', tooltip: 'Dual Stress: Both legs under elevated volume pressure.' };
        if (hasLongCap) {
            if ((longVcvi != null && longVcvi >= tVcvi.critical) || (longVcvi5 != null && longVcvi5 >= 65) || (longRvol != null && longRvol >= 3.0)) return { label: 'L-CRITICAL', cls: 'critical', tooltip: 'Long-Side Critical: Exceptional capitulation spike on long ETF.' };
            if ((longVcvi != null && longVcvi >= tVcvi.high) || (longVcvi5 != null && longVcvi5 >= 45) || (longRvol != null && longRvol >= 2.0) || longMetrics?.sharpSpike) return { label: 'L-STRESS', cls: 'stress', tooltip: 'Long-Side Stress: Strong capitulation pressure on long ETF.' };
            return { label: 'L-ELEVATED', cls: 'elevated', tooltip: 'Long-Side Elevated: Above-average buying/volume pressure on long ETF.' };
        }
        if (hasShortCap) {
            if ((shortVcvi != null && shortVcvi >= tVcvi.critical) || (shortVcvi5 != null && shortVcvi5 >= 65) || (shortRvol != null && shortRvol >= 3.0) || (ipsi != null && ipsi >= tIpsi.critical)) return { label: 'S-CRITICAL', cls: 'critical', tooltip: 'Short-Side Critical: Severe panic buying into inverse ETF.' };
            if ((shortVcvi != null && shortVcvi >= tVcvi.high) || (shortVcvi5 != null && shortVcvi5 >= 45) || (shortRvol != null && shortRvol >= 2.0) || (ipsi != null && ipsi >= tIpsi.stress) || shortMetrics?.sharpSpike) return { label: 'S-STRESS', cls: 'stress', tooltip: 'Short-Side Stress: Inverse ETF volume surging relative to long peer.' };
            return { label: 'S-ELEVATED', cls: 'elevated', tooltip: 'Short-Side Elevated: Modest directional stress favoring inverse ETF.' };
        }
        return { label: 'QUIET', cls: 'quiet', tooltip: 'Balanced: Neither ETF in this pair exhibits abnormal volume pressure.' };
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

if (typeof window !== 'undefined') {
    window.Metrics = Metrics;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Metrics;
}
