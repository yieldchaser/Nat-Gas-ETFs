/* ============================================
   Price-Volume Studies — Institutional Suite
   Classic Technical (Volume, Vol Osc, Net Vol, CMF, OBV, PVT)
   Institutional Microstructure (BVC-VPIN, ILLIQ-Z, ESVD, LMSW-ρ, VWAP-Z, TKVF)
   ============================================ */

const VolumeStudies = {
    state: {
        ticker: 'BOIL',
        suite: 'classic',    // 'classic' | 'micro'
        study: 'vol',        // 'vol'|'osc'|'net'|'cmf'|'obv'|'pvt' | 'vpin'|'illiq'|'esvd'|'lmsw'|'vwapz'|'tkvf'
        unit: 'shares',      // 'shares' | 'dollar'
        range: '1y',
        customRange: null,   // { startIdx, endIdx }
        hoverIdx: null,
        lastMouse: { x: 0, y: 0 }
    },
    _bound: false,
    _sliderBound: false,
    _chipsBuilt: false,
    _cache: null,
    _payload: null,
    _rafId: null,

    STUDIES: {
        classic: [
            { key: 'vol', label: 'VOLUME', tip: 'Daily share volume with 21-day average line. Up days green, down days red.' },
            { key: 'osc', label: 'VOL OSC', tip: 'Volume oscillator: percentage spread between 5-day and 21-day volume moving averages.' },
            { key: 'net', label: 'NET VOL', tip: 'Daily signed volume (+V on up days, -V on down days) with 21-day running total.' },
            { key: 'cmf', label: 'CMF', tip: 'Chaikin Money Flow (21-day): measures accumulation/distribution using close location in daily range.' },
            { key: 'obv', label: 'OBV', tip: 'On-Balance Volume: cumulative running total of signed volume with 21-day signal line.' },
            { key: 'pvt', label: 'PVT', tip: 'Price-Volume Trend: cumulative volume scaled continuously by percentage price change.' },
        ],
        micro: [
            { key: 'vpin', label: 'BVC-VPIN', tip: 'Bulk Volume Classification Imbalance (OFI) & Order-Flow Toxicity (VPIN) based on volatility-scaled Gaussian probability partitioning.' },
            { key: 'illiq', label: 'ILLIQ-Z', tip: 'Range-Adjusted Amihud Illiquidity Z-score & Liquidity Absorption Index (LAI = Z_vol - Z_illiq) isolating institutional limit walls.' },
            { key: 'esvd', label: 'ESVD', tip: 'Abdi-Ranaldo Effective Spread-Volume Divergence: detects market maker liquidity withdrawal before volatility regime shifts.' },
            { key: 'lmsw', label: 'LMSW-ρ', tip: 'Llorente-Michaely-Saar-Wang Return-Volume Serial Correlation: separates informed continuation (rho > 0.25) from liquidity reversal (rho < -0.25).' },
            { key: 'vwapz', label: 'VWAP-Z', tip: 'Volume-Weighted Typical Price Dispersion & Institutional Cost Basis Z-Score: measures stretch away from 21-day rolling VWAP.' },
            { key: 'tkvf', label: 'TKVF', tip: 'True-Range Adjusted Klinger-Arms Volume Force Oscillator with 9-day trigger line: captures gap-inclusive institutional force persistence.' },
        ]
    },

    COLORS: {
        up: '#3db87a',
        down: '#c04040',
        flat: 'rgba(255,255,255,0.30)',
        line: '#5090a0',
        ma: '#d4a830',
        secondaryLine: '#d4a830',
        grid: 'rgba(255,255,255,0.06)',
        label: 'rgba(255,255,255,0.40)',
        crosshair: 'rgba(255,255,255,0.35)'
    },

    PAD: { top: 12, right: 14, bottom: 24, left: 58 },

    _cfg() {
        const fallback = { oscillator: { fast: 5, slow: 21 }, ma: 21, cmf: 21 };
        if (typeof CONFIG === 'undefined') return fallback;
        return CONFIG.volumeStudies || fallback;
    },

    fmtVol(v, unit) {
        if (v == null || !isFinite(v)) return '—';
        const prefix = unit === 'dollar' ? '$' : '';
        const a = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        if (a >= 1e12) return sign + prefix + (a / 1e12).toFixed(2) + 'T';
        if (a >= 1e9) return sign + prefix + (a / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return sign + prefix + (a / 1e6).toFixed(2) + 'M';
        if (a >= 1e3) return sign + prefix + (a / 1e3).toFixed(0) + 'K';
        return sign + prefix + a.toFixed(0);
    },

    fmtSigned(v, unit) {
        if (v == null || !isFinite(v)) return '—';
        const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
        const prefix = unit === 'dollar' ? '$' : '';
        const a = Math.abs(v);
        if (a >= 1e12) return sign + prefix + (a / 1e12).toFixed(2) + 'T';
        if (a >= 1e9) return sign + prefix + (a / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return sign + prefix + (a / 1e6).toFixed(2) + 'M';
        if (a >= 1e3) return sign + prefix + (a / 1e3).toFixed(0) + 'K';
        return sign + prefix + a.toFixed(0);
    },

    fmtPct(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    },

    fmtPrice(p) {
        if (p == null || !isFinite(p)) return '—';
        const a = Math.abs(p);
        if (a >= 1e9) return (p / 1e9).toFixed(2) + 'B';
        if (a >= 1e6) return (p / 1e6).toFixed(1) + 'M';
        if (a >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        if (a >= 100) return p.toFixed(1);
        if (a >= 1) return p.toFixed(2);
        return p.toFixed(3);
    },

    fmtDate(d) {
        if (!d) return '—';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const m = parseInt(d.slice(5, 7), 10);
        return (months[m - 1] || '?') + " '" + d.slice(2, 4);
    },

    fmtFullDate(d) {
        if (!d) return '—';
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dt = new Date(d + 'T00:00:00');
        const dayName = isNaN(dt.getDay()) ? '' : days[dt.getDay()];
        const formatted = typeof formatDisplayDate === 'function' ? formatDisplayDate(d) : d;
        return dayName ? dayName + ', ' + formatted : formatted;
    },

    // Mathematical Primitives & Moving Averages
    sma(values, n) {
        const out = new Array(values.length).fill(null);
        if (!values || n <= 0) return out;
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i] || 0;
            if (i >= n) sum -= values[i - n] || 0;
            if (i >= n - 1) out[i] = sum / n;
        }
        return out;
    },

    ema(values, n) {
        const out = new Array(values.length).fill(null);
        if (!values || n <= 0) return out;
        const k = 2 / (n + 1);
        let prev = null;
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v == null || !isFinite(v)) continue;
            if (prev == null) {
                prev = v;
            } else {
                prev = v * k + prev * (1 - k);
            }
            out[i] = prev;
        }
        return out;
    },

    rollingSum(series, n) {
        const out = new Array(series.length).fill(null);
        if (!series || n <= 0) return out;
        let sum = 0;
        for (let i = 0; i < series.length; i++) {
            sum += series[i] || 0;
            if (i >= n) sum -= series[i - n] || 0;
            if (i >= n - 1) out[i] = sum;
        }
        return out;
    },

    rollingMeanAndStd(values, n) {
        const len = values.length;
        const means = new Array(len).fill(null);
        const stds = new Array(len).fill(null);
        if (len < n || n <= 1) return { means, stds };

        let sum = 0, sumSq = 0;
        for (let i = 0; i < len; i++) {
            const v = values[i] || 0;
            sum += v;
            sumSq += v * v;
            if (i >= n) {
                const old = values[i - n] || 0;
                sum -= old;
                sumSq -= old * old;
            }
            if (i >= n - 1) {
                const mean = sum / n;
                const variance = Math.max(0, (sumSq - (sum * sum) / n) / (n - 1));
                means[i] = mean;
                stds[i] = Math.sqrt(variance);
            }
        }
        return { means, stds };
    },

    // Abramowitz & Stegun (7.1.26) polynomial error function approximation
    erf(x) {
        const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741, a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
        const sign = x < 0 ? -1 : 1;
        const absX = Math.abs(x);
        const t = 1.0 / (1.0 + p * absX);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
        return sign * y;
    },

    normCdf(z) {
        if (z == null || !isFinite(z)) return 0.5;
        return 0.5 * (1.0 + this.erf(z / Math.SQRT2));
    },

    signSeries(closes) {
        const out = new Array(closes.length).fill(0);
        for (let i = 1; i < closes.length; i++) {
            out[i] = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
        }
        return out;
    },

    signedVolume(closes, volumes) {
        const signs = this.signSeries(closes);
        return volumes.map((v, i) => signs[i] * (v || 0));
    },

    obv(closes, volumes) {
        const signs = this.signSeries(closes);
        const out = new Array(closes.length).fill(0);
        let acc = 0;
        for (let i = 1; i < closes.length; i++) {
            acc += signs[i] * (volumes[i] || 0);
            out[i] = acc;
        }
        return out;
    },

    pvt(closes, volumes) {
        const out = new Array(closes.length).fill(0);
        let acc = 0;
        for (let i = 1; i < closes.length; i++) {
            const pc = closes[i - 1];
            if (pc > 0 && closes[i] != null) acc += (volumes[i] || 0) * (closes[i] - pc) / pc;
            out[i] = acc;
        }
        return out;
    },

    volumeOscillator(volumes, fast, slow) {
        const f = this.sma(volumes, fast);
        const s = this.sma(volumes, slow);
        return volumes.map((_, i) => {
            if (f[i] == null || s[i] == null) return null;
            if (s[i] === 0) return f[i] === 0 ? 0 : 100;
            return ((f[i] - s[i]) / s[i]) * 100;
        });
    },

    cmf(highs, lows, closes, volumes, len = 21) {
        const n = closes.length;
        const out = new Array(n).fill(null);
        if (n < len || len <= 0) return out;
        const mfv = new Array(n);
        for (let i = 0; i < n; i++) {
            const h = highs[i], l = lows[i], c = closes[i], v = volumes[i];
            const range = h - l;
            const clv = (range > 0) ? ((c - l) - (h - c)) / range : 0;
            mfv[i] = clv * v;
        }
        let sumMfv = 0;
        let sumVol = 0;
        for (let i = 0; i < len; i++) {
            sumMfv += mfv[i];
            sumVol += volumes[i];
        }
        out[len - 1] = sumVol > 0 ? Math.max(-1, Math.min(1, sumMfv / sumVol)) : 0;
        for (let i = len; i < n; i++) {
            sumMfv += mfv[i] - mfv[i - len];
            sumVol += volumes[i] - volumes[i - len];
            out[i] = sumVol > 0 ? Math.max(-1, Math.min(1, sumMfv / sumVol)) : 0;
        }
        return out;
    },

    // ============================================
    // INSTITUTIONAL MICROSTRUCTURE ALGORITHMS
    // ============================================

    // 1. Bulk Volume Classification (BVC) & Order-Flow Toxicity (VPIN)
    bvcVpin(closes, dollarVolumes, w = 21, m = 10) {
        const n = closes.length;
        const ofi = new Array(n).fill(null);
        const vpin = new Array(n).fill(null);
        if (n < w + m) return { ofi, vpin };

        const logRet = new Array(n).fill(0);
        for (let i = 1; i < n; i++) {
            logRet[i] = (closes[i - 1] > 0 && closes[i] > 0) ? Math.log(closes[i] / closes[i - 1]) : 0;
        }

        const { means: retMeans, stds: retStds } = this.rollingMeanAndStd(logRet, w);

        const buyVol = new Array(n).fill(0);
        const sellVol = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            const sigma = retStds[i];
            const mean = retMeans[i] || 0;
            const dv = dollarVolumes[i] || 0;
            if (sigma && sigma > 1e-8) {
                const z = (logRet[i] - mean) / sigma;
                const probBuy = this.normCdf(z);
                buyVol[i] = dv * probBuy;
                sellVol[i] = dv * (1 - probBuy);
            } else {
                buyVol[i] = dv * 0.5;
                sellVol[i] = dv * 0.5;
            }
        }

        let sumImb = 0, sumAbs = 0, sumDv = 0;
        for (let i = 0; i < m; i++) {
            const diff = buyVol[i] - sellVol[i];
            sumImb += diff;
            sumAbs += Math.abs(diff);
            sumDv += dollarVolumes[i] || 0;
        }
        if (sumDv > 0 && (m - 1) >= w) {
            ofi[m - 1] = Math.max(-1, Math.min(1, sumImb / sumDv));
            vpin[m - 1] = Math.max(0, Math.min(1, sumAbs / sumDv));
        }

        for (let i = m; i < n; i++) {
            const newDiff = buyVol[i] - sellVol[i];
            const oldDiff = buyVol[i - m] - sellVol[i - m];
            sumImb += newDiff - oldDiff;
            sumAbs += Math.abs(newDiff) - Math.abs(oldDiff);
            sumDv += (dollarVolumes[i] || 0) - (dollarVolumes[i - m] || 0);

            if (sumDv > 0 && i >= w) {
                ofi[i] = Math.max(-1, Math.min(1, sumImb / sumDv));
                vpin[i] = Math.max(0, Math.min(1, sumAbs / sumDv));
            }
        }
        return { ofi, vpin };
    },

    // 2. Range-Adjusted Amihud Illiquidity (ILLIQ-Z) & Liquidity Absorption Index (LAI)
    amihudIlliqLai(highs, lows, closes, dollarVolumes, w = 21, m = 5) {
        const n = closes.length;
        const illiqZ = new Array(n).fill(null);
        const lai = new Array(n).fill(null);
        const zDvSeries = new Array(n).fill(null);
        if (n < w + m) return { illiqZ, lai, zDv: zDvSeries };

        const dvSma = this.sma(dollarVolumes, w);
        const { means: dvMeans, stds: dvStds } = this.rollingMeanAndStd(dollarVolumes, w);

        const logLambda = new Array(n).fill(0);
        for (let i = 1; i < n; i++) {
            const c0 = closes[i - 1], c1 = closes[i], h = highs[i], l = lows[i];
            const r = (c0 > 0 && c1 > 0) ? Math.abs(Math.log(c1 / c0)) : 0;
            const park = (h > 0 && l > 0 && h >= l) ? Math.log(h / l) : 0;
            const rdv = (dvSma[i] && dvSma[i] > 0) ? (dollarVolumes[i] / dvSma[i]) : 1.0;
            const lambda = (r + 0.5 * park) / (rdv + 1e-8);
            logLambda[i] = Math.log(lambda + 1e-8);
        }

        const smoothLogLambda = this.ema(logLambda, m);
        const { means: lMeans, stds: lStds } = this.rollingMeanAndStd(logLambda, w);

        for (let i = w; i < n; i++) {
            const lStd = lStds[i], lMean = lMeans[i];
            const dvStd = dvStds[i], dvMean = dvMeans[i];
            if (lStd && lStd > 0 && smoothLogLambda[i] != null) {
                const zIlliq = (smoothLogLambda[i] - lMean) / lStd;
                illiqZ[i] = zIlliq;
                if (dvStd && dvStd > 0) {
                    const zDv = (dollarVolumes[i] - dvMean) / dvStd;
                    zDvSeries[i] = zDv;
                    lai[i] = zDv - zIlliq;
                }
            }
        }
        return { illiqZ, lai, zDv: zDvSeries };
    },

    // 3. Abdi-Ranaldo Effective Spread-Volume Divergence (ESVD)
    abdiRanaldoEsvd(opens, highs, lows, closes, dollarVolumes, m = 10, w = 21) {
        const n = closes.length;
        const spreadAR = new Array(n).fill(null);
        const esvd = new Array(n).fill(null);
        const zSpread = new Array(n).fill(null);
        const zDv = new Array(n).fill(null);
        if (n < w + m) return { spreadAR, esvd, zSpread, zDv };

        const s2 = new Array(n).fill(0);
        for (let i = 1; i < n; i++) {
            if (closes[i - 1] > 0 && highs[i - 1] > 0 && lows[i - 1] > 0 && highs[i] > 0 && lows[i] > 0) {
                const cPrev = Math.log(closes[i - 1]);
                const etaPrev = 0.5 * (Math.log(highs[i - 1]) + Math.log(lows[i - 1]));
                const etaCurr = 0.5 * (Math.log(highs[i]) + Math.log(lows[i]));
                const val = 4 * (cPrev - etaPrev) * (cPrev - etaCurr);
                s2[i] = Math.max(0, val);
            }
        }

        const rawSpread = new Array(n).fill(0);
        let sumS2 = 0;
        for (let i = 0; i < m; i++) sumS2 += s2[i];
        rawSpread[m - 1] = Math.sqrt(sumS2 / m) * 100;
        spreadAR[m - 1] = rawSpread[m - 1];

        for (let i = m; i < n; i++) {
            sumS2 += s2[i] - s2[i - m];
            rawSpread[i] = Math.sqrt(Math.max(0, sumS2 / m)) * 100;
            spreadAR[i] = rawSpread[i];
        }

        const logDv = dollarVolumes.map(v => Math.log(Math.max(1, v || 0)));
        const { means: sMeans, stds: sStds } = this.rollingMeanAndStd(rawSpread, w);
        const { means: vMeans, stds: vStds } = this.rollingMeanAndStd(logDv, w);

        for (let i = w; i < n; i++) {
            if (sStds[i] && sStds[i] > 0 && vStds[i] && vStds[i] > 0) {
                const zs = (rawSpread[i] - sMeans[i]) / sStds[i];
                const zv = (logDv[i] - vMeans[i]) / vStds[i];
                zSpread[i] = zs;
                zDv[i] = zv;
                esvd[i] = zs - zv;
            }
        }
        return { spreadAR, esvd, zSpread, zDv };
    },

    // 4. LMSW Return-Volume Serial Correlation (LMSW-ρ)
    lmswRho(closes, dollarVolumes, w = 21, m = 21) {
        const n = closes.length;
        const out = new Array(n).fill(null);
        if (n < w + m + 2) return out;

        const logRet = new Array(n).fill(0);
        const logDv = new Array(n).fill(0);
        for (let i = 1; i < n; i++) {
            logRet[i] = (closes[i - 1] > 0 && closes[i] > 0) ? Math.log(closes[i] / closes[i - 1]) : 0;
            logDv[i] = Math.log(Math.max(1, dollarVolumes[i] || 0));
        }

        const dvSma = this.sma(logDv, w);
        const psi = new Array(n).fill(0);
        for (let i = 1; i < n; i++) {
            const vTilde = dvSma[i] != null ? (logDv[i] - dvSma[i]) : 0;
            const vClamped = Math.max(-3, Math.min(3, vTilde));
            const rClamped = Math.max(-0.5, Math.min(0.5, logRet[i]));
            psi[i] = vClamped * rClamped;
        }

        for (let i = w + m; i < n; i++) {
            let sumR = 0, sumPsi = 0;
            for (let j = 0; j < m; j++) {
                sumR += logRet[i - j];
                sumPsi += psi[i - j - 1];
            }
            const meanR = sumR / m;
            const meanPsi = sumPsi / m;

            let num = 0, denR = 0, denPsi = 0;
            for (let j = 0; j < m; j++) {
                const dr = logRet[i - j] - meanR;
                const dp = psi[i - j - 1] - meanPsi;
                num += dr * dp;
                denR += dr * dr;
                denPsi += dp * dp;
            }
            const den = Math.sqrt(denR * denPsi);
            out[i] = den > 1e-12 ? Math.max(-1, Math.min(1, num / den)) : 0;
        }
        return out;
    },

    // 5. Rolling VWAP & Intrabar Dispersion Z-Score (VWAP-Z)
    rollingVwapZ(highs, lows, closes, volumes, m = 21, k = 5) {
        const n = closes.length;
        const vwapZ = new Array(n).fill(null);
        const rvwap = new Array(n).fill(null);
        const slopeVwap = new Array(n).fill(null);
        if (n < m + k) return { vwapZ, rvwap, slopeVwap };

        const typ = new Array(n);
        const barVar = new Array(n);
        for (let i = 0; i < n; i++) {
            typ[i] = (highs[i] + lows[i] + 2 * closes[i]) / 4;
            const range = highs[i] - lows[i];
            barVar[i] = (range * range) / 12;
        }

        for (let i = m - 1; i < n; i++) {
            let sumPv = 0, sumV = 0;
            for (let j = 0; j < m; j++) {
                const idx = i - j;
                const v = volumes[idx] || 0;
                sumPv += typ[idx] * v;
                sumV += v;
            }
            if (sumV <= 0) continue;
            const curVwap = sumPv / sumV;
            rvwap[i] = curVwap;

            let sumVwDisp = 0;
            for (let j = 0; j < m; j++) {
                const idx = i - j;
                const v = volumes[idx] || 0;
                const d = typ[idx] - curVwap;
                sumVwDisp += v * (d * d + barVar[idx]);
            }
            const sigmaVw = Math.sqrt(sumVwDisp / sumV);
            if (sigmaVw > 0) {
                vwapZ[i] = (closes[i] - curVwap) / sigmaVw;
                if (i >= m - 1 + k && rvwap[i - k] != null) {
                    slopeVwap[i] = (curVwap - rvwap[i - k]) / (k * sigmaVw);
                }
            }
        }
        return { vwapZ, rvwap, slopeVwap };
    },

    // 6. True-Range Adjusted Klinger-Arms Volume Force (TKVF)
    tkvfOscillator(highs, lows, closes, dollarVolumes, w = 21, kf = 13, ks = 34, ksig = 9) {
        const n = closes.length;
        const tkvf = new Array(n).fill(null);
        const trig = new Array(n).fill(null);
        const hist = new Array(n).fill(null);
        if (n < Math.max(w, ks) + ksig) return { tkvf, trig, hist };

        const dvSma = this.sma(dollarVolumes, w);
        const vf = new Array(n).fill(0);

        let prevT = 0, prevCm = 0, prevDm = 0;
        for (let i = 1; i < n; i++) {
            const th = Math.max(highs[i], closes[i - 1]);
            const tl = Math.min(lows[i], closes[i - 1]);
            const dm = th - tl;
            const typCurr = (highs[i] + lows[i] + closes[i]) / 3;
            const typPrev = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
            const t = typCurr > typPrev ? 1 : -1;

            let cm = 0;
            if (t === prevT) {
                cm = prevCm + dm;
            } else {
                cm = prevDm + dm;
            }
            prevT = t;
            prevCm = cm;
            prevDm = dm;

            const rdv = (dvSma[i] && dvSma[i] > 0) ? (dollarVolumes[i] / dvSma[i]) : 1.0;
            const ratio = cm > 0 ? (dm / cm) : 0.5;
            vf[i] = rdv * t * Math.abs(2 * ratio - 1) * 100;
        }

        const fastEma = this.ema(vf, kf);
        const slowEma = this.ema(vf, ks);
        const diff = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            if (fastEma[i] != null && slowEma[i] != null) {
                diff[i] = fastEma[i] - slowEma[i];
                tkvf[i] = diff[i];
            }
        }

        const sigEma = this.ema(diff, ksig);
        for (let i = 0; i < n; i++) {
            trig[i] = sigEma[i];
            if (tkvf[i] != null && trig[i] != null) {
                hist[i] = tkvf[i] - trig[i];
            }
        }
        return { tkvf, trig, hist };
    },

    // ============================================
    // SLICING & PAYLOAD ASSEMBLY
    // ============================================

    sliceStartForDays(dates, days, nowMs) {
        if (!dates || !dates.length) return 0;
        if (days == null) return 0;
        const now = (nowMs == null) ? Date.now() : nowMs;
        const cutoff = new Date(now - days * 864e5).toISOString().slice(0, 10);
        let idx = 0;
        while (idx < dates.length && dates[idx] < cutoff) idx++;
        return Math.min(idx, Math.max(0, dates.length - 2));
    },

    _sliceStart(dates, rangeKey) {
        const cfg = this._cfg();
        let days = null;
        const ranges = cfg.ranges || [];
        for (const r of ranges) {
            if (r.key === rangeKey) { days = r.days; break; }
        }
        return this.sliceStartForDays(dates, days);
    },

    _buildPayload(dates, closes, volumes, startIdx, endIdx, extra) {
        let actualEnd = endIdx;
        let actualExtra = extra;
        if (typeof endIdx === 'object' && endIdx !== null && extra === undefined) {
            actualExtra = endIdx;
            actualEnd = dates.length - 1;
        }
        const end = (actualEnd != null) ? actualEnd : dates.length - 1;
        const slice = arr => arr ? arr.slice(startIdx, end + 1) : null;
        return {
            dates: dates.slice(startIdx, end + 1),
            closes: closes.slice(startIdx, end + 1),
            volumes: volumes.slice(startIdx, end + 1),
            rawVolumes: ((actualExtra && actualExtra.rawVolumes) || volumes).slice(startIdx, end + 1),
            dollarVolumes: ((actualExtra && actualExtra.dollarVolumes) || []).slice(startIdx, end + 1),
            bars: slice(actualExtra && actualExtra.bars),
            line: slice(actualExtra && actualExtra.line),
            ma: slice(actualExtra && actualExtra.ma),
            secondaryLine: slice(actualExtra && actualExtra.secondaryLine),
            colorSigns: slice(actualExtra && actualExtra.colorSigns),
            zeroCentered: !!(actualExtra && actualExtra.zeroCentered),
            study: actualExtra ? actualExtra.study : null,
            unit: (actualExtra && actualExtra.unit) || 'shares',
            startIdx,
            endIdx: end,
            fullLength: dates.length,
            extraData: actualExtra && actualExtra.extraData ? Object.fromEntries(
                Object.entries(actualExtra.extraData).map(([k, v]) => [k, Array.isArray(v) ? slice(v) : v])
            ) : {}
        };
    },

    compute(history, study, rangeKey, opts) {
        if (!history || !history.length) return null;
        const options = opts || {};
        const unit = options.unit || this.state.unit || 'shares';
        const dates = [], opens = [], closes = [], highs = [], lows = [], rawVolumes = [], dollarVolumes = [];
        for (const b of history) {
            if (!b || b.close == null) continue;
            const c = b.close;
            const o = (b.open != null && isFinite(b.open)) ? b.open : c;
            const v = b.volume || 0;
            dates.push(b.date);
            opens.push(o);
            closes.push(c);
            highs.push(b.high != null ? b.high : c);
            lows.push(b.low != null ? b.low : c);
            rawVolumes.push(v);
            dollarVolumes.push(c * v);
        }
        if (dates.length < 2) return null;

        const volumes = (unit === 'dollar') ? dollarVolumes : rawVolumes;

        let startIdx = 0;
        let endIdx = dates.length - 1;
        if (options.customStart != null && options.customEnd != null) {
            startIdx = Math.max(0, Math.min(dates.length - 2, options.customStart));
            endIdx = Math.max(startIdx + 1, Math.min(dates.length - 1, options.customEnd));
        } else if (rangeKey === 'custom' && this.state.customRange) {
            startIdx = Math.max(0, Math.min(dates.length - 2, this.state.customRange.startIdx));
            endIdx = Math.max(startIdx + 1, Math.min(dates.length - 1, this.state.customRange.endIdx));
        } else {
            startIdx = this._sliceStart(dates, rangeKey);
            endIdx = dates.length - 1;
        }

        const cfg = this._cfg();
        const fast = (cfg.oscillator || {}).fast || 5;
        const slow = (cfg.oscillator || {}).slow || 21;
        const maLen = cfg.ma || 21;

        const extraBase = {
            unit,
            rawVolumes,
            dollarVolumes
        };

        // --- CLASSIC TECHNICAL SUITE ---
        if (study === 'vol') {
            const ma = this.sma(volumes, maLen);
            const signs = this.signSeries(closes);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: volumes, line: null, ma, colorSigns: signs, zeroCentered: false, study
            });
        }
        if (study === 'osc') {
            const line = this.volumeOscillator(volumes, fast, slow);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: null, line, ma: null, zeroCentered: true, study
            });
        }
        if (study === 'net') {
            const signed = this.signedVolume(closes, volumes);
            const line = this.rollingSum(signed, maLen);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: signed, line, ma: null, zeroCentered: true, study
            });
        }
        if (study === 'cmf') {
            const cmfLen = (cfg && cfg.cmf) || maLen || 21;
            const line = this.cmf(highs, lows, closes, volumes, cmfLen);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: null, line, ma: null, zeroCentered: true, study
            });
        }
        if (study === 'obv' || study === 'pvt') {
            const full = study === 'obv' ? this.obv(closes, volumes) : this.pvt(closes, volumes);
            const base = full[startIdx];
            const line = full.map(v => v - base);
            const maFull = this.sma(full, maLen);
            const ma = maFull.map(v => v == null ? null : v - base);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase, bars: null, line, ma, zeroCentered: false, study
            });
        }

        // --- INSTITUTIONAL MICROSTRUCTURE SUITE ---
        if (study === 'vpin' || study === 'bvc') {
            const { ofi, vpin } = this.bvcVpin(closes, dollarVolumes, maLen, 10);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: null,
                line: ofi,
                secondaryLine: vpin,
                zeroCentered: true,
                study: 'vpin',
                extraData: { ofi, vpin }
            });
        }
        if (study === 'illiq') {
            const { illiqZ, lai, zDv } = this.amihudIlliqLai(highs, lows, closes, dollarVolumes, maLen, 5);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: lai,
                line: illiqZ,
                zeroCentered: true,
                study: 'illiq',
                extraData: { illiqZ, lai, zDv }
            });
        }
        if (study === 'esvd') {
            const { spreadAR, esvd, zSpread, zDv } = this.abdiRanaldoEsvd(opens, highs, lows, closes, dollarVolumes, 10, maLen);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: esvd,
                line: zSpread,
                zeroCentered: true,
                study: 'esvd',
                extraData: { spreadAR, esvd, zSpread, zDv }
            });
        }
        if (study === 'lmsw') {
            const rho = this.lmswRho(closes, dollarVolumes, maLen, maLen);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: null,
                line: rho,
                zeroCentered: true,
                study: 'lmsw',
                extraData: { rho }
            });
        }
        if (study === 'vwapz') {
            const { vwapZ, rvwap, slopeVwap } = this.rollingVwapZ(highs, lows, closes, volumes, maLen, 5);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: null,
                line: vwapZ,
                zeroCentered: true,
                study: 'vwapz',
                extraData: { vwapZ, rvwap, slopeVwap }
            });
        }
        if (study === 'tkvf') {
            const { tkvf, trig, hist } = this.tkvfOscillator(highs, lows, closes, dollarVolumes, maLen, 13, 34, 9);
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: hist,
                line: tkvf,
                ma: trig,
                zeroCentered: true,
                study: 'tkvf',
                extraData: { tkvf, trig, hist }
            });
        }

        return null;
    },

    _getPayload(ticker, history) {
        const last = history.length ? (history[history.length - 1].date || '') : '';
        const customPart = this.state.customRange ? (this.state.customRange.startIdx + '-' + this.state.customRange.endIdx) : '';
        const key = ticker + '|' + this.state.suite + '|' + this.state.study + '|' + this.state.unit + '|' + this.state.range + '|' + customPart + '|' + history.length + '|' + last;
        if (this._cache && this._cache.key === key) return this._cache.payload;
        const payload = this.compute(history, this.state.study, this.state.range, {
            unit: this.state.unit,
            customStart: this.state.customRange ? this.state.customRange.startIdx : null,
            customEnd: this.state.customRange ? this.state.customRange.endIdx : null
        });
        this._cache = { key, payload };
        return payload;
    },

    // ============================================
    // DOM & RENDERING MANAGEMENT
    // ============================================

    renderStudyTabs() {
        const container = document.getElementById('vs-study-tabs');
        if (!container) return;
        const currentSuite = this.state.suite || 'classic';
        const studies = this.STUDIES[currentSuite] || this.STUDIES.classic;

        container.innerHTML = '';
        for (const s of studies) {
            const btn = document.createElement('button');
            const isActive = s.key === this.state.study || (s.key === 'vpin' && this.state.study === 'bvc');
            btn.className = 'tab-btn' + (isActive ? ' active' : '');
            btn.setAttribute('data-study', s.key);
            btn.setAttribute('data-tooltip', s.tip);
            btn.textContent = s.label;
            btn.addEventListener('click', () => {
                container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.study = s.key;
                this.state.hoverIdx = null;
                this._cache = null;
                this.render();
            });
            container.appendChild(btn);
        }
    },

    render() {
        const panel = document.getElementById('vs-panel');
        if (!panel) return;
        this._bind();

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        const tickers = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? Object.keys(CONFIG.etfs) : [];

        if (!all[this.state.ticker] || !(all[this.state.ticker] || {}).history) {
            const first = tickers.find(t => all[t] && all[t].history && all[t].history.length > 30);
            if (first) this.state.ticker = first;
        }
        this._updateChips();

        const metrics = all[this.state.ticker];
        const history = (metrics && metrics.history) || [];
        if (history.length < 3) {
            this._payload = null;
            this._drawMessage('Waiting for price-volume history…');
            this._updateReading(null, null);
            return;
        }

        const payload = this._getPayload(this.state.ticker, history);
        if (!payload || payload.dates.length < 2) {
            this._payload = null;
            this._drawMessage('Insufficient history for selected range');
            this._updateReading(null, null);
            return;
        }
        this._payload = payload;
        this._syncSliderToRange(payload.fullLength, payload.startIdx, payload.endIdx);

        // Synchronize suite controller tabs
        const suiteTabs = document.getElementById('vs-suite-tabs');
        if (suiteTabs) {
            suiteTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-suite') === (this.state.suite || 'classic'));
            });
        }

        // Synchronize header subtitle
        const sub = document.getElementById('vs-subtitle');
        if (sub) {
            sub.textContent = (this.state.suite === 'micro')
                ? '· INSTITUTIONAL MICROSTRUCTURE'
                : '· TECHNICAL INDICATORS';
        }

        // Synchronize study tabs
        const studyTabs = document.getElementById('vs-study-tabs');
        if (studyTabs) {
            const curStudy = this.state.study === 'bvc' ? 'vpin' : this.state.study;
            studyTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-study') === curStudy);
            });
        }

        const unitTabs = document.getElementById('vs-unit-tabs');
        if (unitTabs) {
            unitTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-unit') === (this.state.unit || 'shares'));
            });
        }
        const rangeTabs = document.getElementById('vs-range-tabs');
        if (rangeTabs && this.state.range !== 'custom') {
            rangeTabs.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-range') === this.state.range);
            });
        }
        this._draw();
        this._updateReading(metrics, payload, null);
        this.updateCardSelection();
    },

    _bind() {
        if (this._bound) return;
        const suiteTabs = document.getElementById('vs-suite-tabs');
        const unitTabs = document.getElementById('vs-unit-tabs');
        const rangeTabs = document.getElementById('vs-range-tabs');
        const chips = document.getElementById('vs-chips');
        const canvas = document.getElementById('vs-canvas');
        if (!rangeTabs || !chips || !canvas) return;

        this.renderStudyTabs();

        if (suiteTabs) {
            suiteTabs.addEventListener('click', e => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const newSuite = btn.getAttribute('data-suite');
                if (newSuite === this.state.suite) return;
                this.state.suite = newSuite;
                suiteTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const sub = document.getElementById('vs-subtitle');
                if (sub) {
                    sub.textContent = newSuite === 'micro'
                        ? '· INSTITUTIONAL MICROSTRUCTURE'
                        : '· TECHNICAL INDICATORS';
                }

                // If current study is not in selected suite, switch to first study in suite
                const currentInSuite = this.STUDIES[newSuite].some(s => s.key === this.state.study || (s.key === 'vpin' && this.state.study === 'bvc'));
                if (!currentInSuite) {
                    this.state.study = this.STUDIES[newSuite][0].key;
                }

                this.renderStudyTabs();
                this.state.hoverIdx = null;
                this._cache = null;
                this.render();
            });
        }

        if (unitTabs) {
            unitTabs.addEventListener('click', e => {
                const btn = e.target.closest('button');
                if (!btn) return;
                unitTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.unit = btn.getAttribute('data-unit') || 'shares';
                this.state.hoverIdx = null;
                this._cache = null;
                this.render();
            });
        }

        rangeTabs.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            rangeTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.state.range = btn.getAttribute('data-range');
            this.state.customRange = null;
            this.state.hoverIdx = null;
            this._cache = null;
            this.render();
        });

        canvas.addEventListener('mousemove', e => this._onMove(e));
        canvas.addEventListener('mouseleave', () => this._onLeave());

        const getTouchPos = e => {
            if (!e.touches || !e.touches.length) return null;
            const rect = canvas.getBoundingClientRect();
            return {
                x: e.touches[0].clientX - rect.left,
                y: e.touches[0].clientY - rect.top
            };
        };
        canvas.addEventListener('touchstart', e => {
            const pos = getTouchPos(e);
            if (pos) {
                this._onMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
            }
        }, { passive: true });
        canvas.addEventListener('touchmove', e => {
            const pos = getTouchPos(e);
            if (pos) {
                this._onMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
            }
        }, { passive: true });
        canvas.addEventListener('touchend', () => this._onLeave(), { passive: true });
        canvas.addEventListener('touchcancel', () => this._onLeave(), { passive: true });

        this._initSlider();
        this._bound = true;
    },

    _initSlider() {
        const sStart = document.getElementById('vs-range-start');
        const sEnd = document.getElementById('vs-range-end');
        if (!sStart || !sEnd || this._sliderBound) return;

        const MIN_GAP = 5;

        const onChange = (e) => {
            const payload = this._payload;
            if (!payload || !payload.fullLength) return;
            const maxVal = payload.fullLength - 1;
            let v1 = parseInt(sStart.value, 10);
            let v2 = parseInt(sEnd.value, 10);

            if (e.target.id === 'vs-range-start') {
                if (v1 > v2 - MIN_GAP) {
                    v1 = Math.max(0, v2 - MIN_GAP);
                    sStart.value = v1;
                }
            } else {
                if (v2 < v1 + MIN_GAP) {
                    v2 = Math.min(maxVal, v1 + MIN_GAP);
                    sEnd.value = v2;
                }
            }

            if (v2 - v1 < 2) {
                if (v2 >= maxVal) {
                    v1 = Math.max(0, maxVal - MIN_GAP);
                    v2 = maxVal;
                } else {
                    v2 = Math.min(maxVal, v1 + MIN_GAP);
                }
                sStart.value = v1;
                sEnd.value = v2;
            }

            if (v1 > maxVal - 60) {
                sStart.style.zIndex = '5';
                sEnd.style.zIndex = '4';
            } else {
                sStart.style.zIndex = '4';
                sEnd.style.zIndex = '3';
            }

            this.state.range = 'custom';
            this.state.customRange = { startIdx: v1, endIdx: v2 };
            this.state.hoverIdx = null;

            const rangeTabs = document.getElementById('vs-range-tabs');
            if (rangeTabs) {
                rangeTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            }

            this._updateSliderHighlight(v1, v2, maxVal);
            this.render();
        };

        const elevateThumb = (e) => {
            if (e.target) e.target.style.zIndex = '6';
        };
        sStart.addEventListener('mousedown', elevateThumb);
        sStart.addEventListener('touchstart', elevateThumb);
        sEnd.addEventListener('mousedown', elevateThumb);
        sEnd.addEventListener('touchstart', elevateThumb);

        sStart.addEventListener('input', onChange);
        sEnd.addEventListener('input', onChange);
        this._sliderBound = true;
    },

    _syncSliderToRange(totalBars, startIdx, endIdx) {
        const sStart = document.getElementById('vs-range-start');
        const sEnd = document.getElementById('vs-range-end');
        if (!sStart || !sEnd || totalBars < 2) return;

        const maxVal = totalBars - 1;
        sStart.max = maxVal;
        sEnd.max = maxVal;
        sStart.value = startIdx;
        sEnd.value = endIdx;

        this._updateSliderHighlight(startIdx, endIdx, maxVal);
    },

    _updateSliderHighlight(v1, v2, maxVal) {
        const highlight = document.getElementById('vs-range-highlight');
        const lblActive = document.getElementById('vs-range-active-label');

        if (maxVal <= 0) return;
        const p1 = (v1 / maxVal);
        const p2 = (v2 / maxVal);

        if (highlight) {
            highlight.style.left = 'calc(' + (p1 * 100) + '% + ' + (10 - p1 * 20) + 'px)';
            highlight.style.width = 'calc(' + ((p2 - p1) * 100) + '% + ' + ((p1 - p2) * 20) + 'px)';
        }

        if (lblActive) {
            lblActive.textContent = (this.state.range === 'custom')
                ? 'CUSTOM SELECTION'
                : 'PRESET: ' + this.state.range.toUpperCase();
        }
    },

    _buildChips() {
        const container = document.getElementById('vs-chips');
        if (!container || this._chipsBuilt) return;
        container.innerHTML = '';
        const etfs = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? CONFIG.etfs : {};
        for (const t of Object.keys(etfs)) {
            const side = (etfs[t] || {}).side || 'long';
            const name = (etfs[t] || {}).name || t;
            const color = side === 'long' ? this.COLORS.up : this.COLORS.down;
            const chip = document.createElement('button');
            chip.className = 'vs-chip';
            chip.textContent = t;
            chip.setAttribute('data-ticker', t);
            chip.setAttribute('data-tooltip', t + ' (' + name + ')');
            chip.style.color = color;
            chip.style.borderColor = color;
            chip.addEventListener('click', () => {
                this.selectTicker(t);
            });
            container.appendChild(chip);
        }
        this._chipsBuilt = true;
    },

    _updateChips() {
        this._buildChips();
        const container = document.getElementById('vs-chips');
        if (!container) return;
        container.querySelectorAll('.vs-chip').forEach(chip => {
            const active = chip.getAttribute('data-ticker') === this.state.ticker;
            chip.classList.toggle('active', active);
            chip.classList.toggle('inactive', !active);
        });
        this.updateCardSelection();
    },

    selectTicker(ticker) {
        if (!ticker) return;
        this.state.ticker = ticker;
        this.state.hoverIdx = null;
        this._cache = null;
        this.render();
        this.updateCardSelection();
        if (!VolumeStudies._syncing) {
            VolumeStudies._syncing = true;
            try {
                if (typeof VolumeProfile !== 'undefined' && typeof VolumeProfile.selectTicker === 'function') {
                    if (VolumeProfile.state && VolumeProfile.state.ticker !== ticker) {
                        VolumeProfile.selectTicker(ticker);
                    }
                }
            } finally {
                VolumeStudies._syncing = false;
            }
        }
    },

    updateCardSelection() {
        if (typeof document === 'undefined') return;
        const selected = this.state.ticker;
        document.querySelectorAll('.etf-card[data-ticker]').forEach(card => {
            card.classList.toggle('card-selected', card.getAttribute('data-ticker') === selected);
        });
    },

    _drawMessage(text) {
        const canvas = document.getElementById('vs-canvas');
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) return;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.font = '11px monospace';
        ctx.fillStyle = this.COLORS.label;
        ctx.textAlign = 'center';
        ctx.fillText(text, rect.width / 2, rect.height / 2);
        const tooltip = document.getElementById('vs-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    },

    _yFormat(study, unit) {
        if (study === 'osc') return v => (v >= 0 ? '+' : '') + v.toFixed(0) + '%';
        if (study === 'cmf') return v => (v >= 0 ? '+' : '') + v.toFixed(2);
        if (study === 'vpin') return v => (v >= 0 ? '+' : '') + v.toFixed(2);
        if (study === 'illiq' || study === 'esvd' || study === 'vwapz') return v => (v >= 0 ? '+' : '') + v.toFixed(1) + 'σ';
        if (study === 'lmsw') return v => (v >= 0 ? '+' : '') + v.toFixed(2);
        if (study === 'tkvf') return v => (v >= 0 ? '+' : '') + v.toFixed(0);
        if (unit === 'dollar') return v => (v < 0 ? '-' : '') + '$' + this.fmtVol(Math.abs(v));
        return v => this.fmtVol(v);
    },

    // ============================================
    // CANVAS RENDERING ENGINE
    // ============================================

    _draw() {
        const payload = this._payload;
        const canvas = document.getElementById('vs-canvas');
        if (!payload || !canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) return;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const w = rect.width, h = rect.height;
        const pad = this.PAD;
        const chartW = w - pad.left - pad.right;
        const chartH = h - pad.top - pad.bottom;
        if (chartW < 10 || chartH < 10) return;

        const n = payload.dates.length;
        const bars = payload.bars, line = payload.line, ma = payload.ma, secondaryLine = payload.secondaryLine;

        let yMin = Infinity, yMax = -Infinity;
        const consider = arr => {
            if (!arr) return;
            for (const v of arr) {
                if (v == null || !isFinite(v)) continue;
                if (v < yMin) yMin = v;
                if (v > yMax) yMax = v;
            }
        };
        consider(bars); consider(line); consider(ma); consider(secondaryLine);
        if (!isFinite(yMin) || !isFinite(yMax)) { this._drawMessage('No data in range'); return; }
        if (bars && !payload.zeroCentered) { yMin = Math.min(0, yMin); }
        if (payload.zeroCentered || (yMin < 0 && yMax > 0)) {
            yMin = Math.min(0, yMin); yMax = Math.max(0, yMax);
        }

        // Bounded normalization for institutional indicators
        if (payload.study === 'vpin') {
            yMin = Math.min(-1.0, yMin);
            yMax = Math.max(1.0, yMax);
        } else if (payload.study === 'lmsw') {
            yMin = Math.min(-0.5, yMin);
            yMax = Math.max(0.5, yMax);
        } else if (payload.study === 'illiq' || payload.study === 'esvd' || payload.study === 'vwapz') {
            yMin = Math.min(-2.5, yMin);
            yMax = Math.max(2.5, yMax);
        }

        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const padY = (yMax - yMin) * 0.05;
        yMin -= padY; yMax += padY;
        if (bars && !payload.zeroCentered) yMin = Math.max(0, yMin);

        const getX = i => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * chartW);
        const mapY = v => pad.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
        const clampY = v => Math.max(pad.top, Math.min(pad.top + chartH, v));

        // Horizontal Guide Helper
        const drawGuide = (val, color, dash, label) => {
            if (val < yMin || val > yMax) return;
            const gy = clampY(mapY(val));
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            if (dash) ctx.setLineDash(dash);
            ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + chartW, gy); ctx.stroke();
            if (label) {
                ctx.fillStyle = color;
                ctx.font = '8px monospace';
                ctx.textAlign = 'right';
                ctx.fillText(label, pad.left + chartW - 4, gy - 2);
                ctx.textAlign = 'left';
            }
            ctx.restore();
        };

        ctx.font = '9px monospace';

        // Background Grid & Y-Axis Scale
        const yFmt = this._yFormat(payload.study, payload.unit);
        for (let i = 0; i <= 4; i++) {
            const v = yMax - (i / 4) * (yMax - yMin);
            const y = pad.top + (i / 4) * chartH;
            ctx.strokeStyle = this.COLORS.grid;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
            ctx.fillStyle = this.COLORS.label;
            ctx.textAlign = 'right';
            ctx.fillText(yFmt(v), pad.left - 6, y + 3);
        }

        // X-Axis Date Labels
        ctx.fillStyle = this.COLORS.label;
        const xTicks = Math.min(5, n);
        for (let k = 0; k < xTicks; k++) {
            const i = Math.round((k / Math.max(1, xTicks - 1)) * (n - 1));
            ctx.textAlign = k === 0 ? 'left' : k === xTicks - 1 ? 'right' : 'center';
            ctx.fillText(this.fmtDate(payload.dates[i]), getX(i), pad.top + chartH + 14);
        }
        ctx.textAlign = 'left';

        // Zero Reference Line
        if (yMin < 0 && yMax > 0) {
            const zy = mapY(0);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(pad.left, zy); ctx.lineTo(pad.left + chartW, zy); ctx.stroke();
            ctx.setLineDash([]);
        }

        // Institutional Microstructure Reference Bands & Zones
        if (payload.study === 'vpin') {
            drawGuide(0.40, 'rgba(212,168,48,0.40)', [3, 3], 'TOXIC 0.40');
        } else if (payload.study === 'illiq') {
            drawGuide(2.0, 'rgba(61,184,122,0.40)', [3, 3], '+2.0σ ABSORPTION');
        } else if (payload.study === 'esvd') {
            drawGuide(1.5, 'rgba(224,108,117,0.40)', [3, 3], '+1.5σ STRESS');
        } else if (payload.study === 'lmsw') {
            if (0.25 < yMax) {
                const yTop = clampY(mapY(yMax));
                const yBottom = clampY(mapY(0.25));
                ctx.fillStyle = 'rgba(61,184,122,0.06)';
                ctx.fillRect(pad.left, yTop, chartW, Math.max(0, yBottom - yTop));
            }
            if (-0.25 > yMin) {
                const yTop = clampY(mapY(-0.25));
                const yBottom = clampY(mapY(yMin));
                ctx.fillStyle = 'rgba(192,64,64,0.06)';
                ctx.fillRect(pad.left, yTop, chartW, Math.max(0, yBottom - yTop));
            }
            drawGuide(0.25, 'rgba(61,184,122,0.40)', [3, 3], '+0.25 CONTINUATION');
            drawGuide(-0.25, 'rgba(192,64,64,0.40)', [3, 3], '-0.25 REVERSAL');
        } else if (payload.study === 'vwapz') {
            if (2.0 < yMax) {
                const yTop = clampY(mapY(yMax));
                const yBottom = clampY(mapY(2.0));
                ctx.fillStyle = 'rgba(212,168,48,0.07)';
                ctx.fillRect(pad.left, yTop, chartW, Math.max(0, yBottom - yTop));
            }
            if (-2.0 > yMin) {
                const yTop = clampY(mapY(-2.0));
                const yBottom = clampY(mapY(yMin));
                ctx.fillStyle = 'rgba(192,64,64,0.07)';
                ctx.fillRect(pad.left, yTop, chartW, Math.max(0, yBottom - yTop));
            }
            drawGuide(2.0, 'rgba(212,168,48,0.45)', [3, 3], '+2.0σ PEAK');
            drawGuide(1.0, 'rgba(255,255,255,0.12)', [2, 2], '+1.0σ');
            drawGuide(-1.0, 'rgba(255,255,255,0.12)', [2, 2], '-1.0σ');
            drawGuide(-2.0, 'rgba(192,64,64,0.45)', [3, 3], '-2.0σ TROUGH');
        }

        // Render Histogram Bars
        if (bars) {
            const colW = chartW / n;
            const barW = Math.max(1, colW * 0.7);
            const zeroY = (yMin < 0 && yMax > 0) ? mapY(0) : pad.top + chartH;
            const fillBar = (v, sign, x, bw) => {
                let color = sign > 0 ? this.COLORS.up : sign < 0 ? this.COLORS.down : this.COLORS.flat;
                if (payload.study === 'esvd') {
                    color = v > 0 ? '#d4a830' : (v < 0 ? '#5090a0' : this.COLORS.flat);
                }
                const yv = clampY(mapY(v));
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.70;
                const hBar = Math.max(1.5, Math.abs(zeroY - yv));
                ctx.fillRect(x, Math.min(yv, zeroY), bw, hBar);
                ctx.globalAlpha = 1;
            };

            if (colW < 1) {
                const per = Math.ceil(n / Math.max(1, Math.floor(chartW)));
                const nCols = Math.ceil(n / per);
                const colStep = chartW / nCols;
                const bw = Math.max(1, colStep * 0.7);
                for (let c = 0; c < nCols; c++) {
                    let sum = 0, cnt = 0, dir = 0;
                    const i0 = c * per, i1 = Math.min(n, i0 + per);
                    for (let i = i0; i < i1; i++) {
                        const v = bars[i];
                        if (v == null || !isFinite(v)) continue;
                        sum += v;
                        cnt++;
                        dir += payload.colorSigns ? payload.colorSigns[i] : (v > 0 ? 1 : v < 0 ? -1 : 0);
                    }
                    if (!cnt) continue;
                    fillBar(sum / cnt, dir > 0 ? 1 : dir < 0 ? -1 : 0, pad.left + c * colStep + (colStep - bw) / 2, bw);
                }
            } else {
                for (let i = 0; i < n; i++) {
                    const v = bars[i];
                    if (v == null || !isFinite(v)) continue;
                    const sign = payload.colorSigns ? payload.colorSigns[i] : (v > 0 ? 1 : v < 0 ? -1 : 0);
                    fillBar(v, sign, pad.left + i * colW + (colW - barW) / 2, barW);
                }
            }
        }

        const drawPath = (arr, color, width, dash) => {
            if (!arr) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            if (dash) ctx.setLineDash(dash);
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < n; i++) {
                const v = arr[i];
                if (v == null || !isFinite(v)) { started = false; continue; }
                const x = getX(i), y = clampY(mapY(v));
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            if (dash) ctx.setLineDash([]);
        };

        // Render Directional Gradient Fills for Oscillators
        if (line && (payload.study === 'osc' || payload.study === 'cmf' || payload.study === 'vpin')) {
            const colW = chartW / n;
            const zeroY = mapY(0);
            for (let i = 0; i < n; i++) {
                const v = line[i];
                if (v == null || !isFinite(v)) continue;
                ctx.fillStyle = v >= 0 ? 'rgba(61,184,122,0.14)' : 'rgba(192,64,64,0.14)';
                const x = pad.left + i * colW;
                const yv = clampY(mapY(v));
                ctx.fillRect(x, Math.min(yv, zeroY), colW, Math.abs(zeroY - yv));
            }
            drawPath(line, this.COLORS.line, 1.4, null);
        } else if (line) {
            const lineColor = payload.study === 'esvd' ? '#e06c75' : this.COLORS.line;
            drawPath(line, lineColor, 1.4, null);
        }

        // Render Secondary Line (e.g. VPIN Unsigned Toxicity Line)
        if (secondaryLine) {
            drawPath(secondaryLine, '#d4a830', 1.2, [3, 3]);
        }

        // Render Moving Average or Trigger Signal Line
        if (ma) {
            drawPath(ma, this.COLORS.ma, 1.1, [3, 3]);
        }

        // Render Active Hover Crosshair
        if (this.state.hoverIdx != null && this.state.hoverIdx >= 0 && this.state.hoverIdx < n) {
            const i = this.state.hoverIdx;
            const x = getX(i);
            ctx.strokeStyle = this.COLORS.crosshair;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + chartH); ctx.stroke();
            ctx.setLineDash([]);

            if (bars) {
                const colW = chartW / n;
                const barW = Math.max(1, colW * 0.7);
                const bx = pad.left + i * colW + (colW - barW) / 2;
                const v = bars[i];
                if (v != null && isFinite(v)) {
                    const yv = clampY(mapY(v));
                    const y0 = (yMin < 0 && yMax > 0) ? mapY(0) : pad.top + chartH;
                    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(bx - 0.5, Math.min(yv, y0) - 0.5, barW + 1, Math.max(1.5, Math.abs(y0 - yv)) + 1);
                }
            }
            if (line) {
                const v = line[i];
                if (v != null && isFinite(v)) {
                    ctx.beginPath();
                    ctx.arc(x, clampY(mapY(v)), 3.5, 0, Math.PI * 2);
                    ctx.fillStyle = payload.study === 'esvd' ? '#e06c75' : this.COLORS.line;
                    ctx.fill();
                }
            }
            if (secondaryLine) {
                const sv = secondaryLine[i];
                if (sv != null && isFinite(sv)) {
                    ctx.beginPath();
                    ctx.arc(x, clampY(mapY(sv)), 3, 0, Math.PI * 2);
                    ctx.fillStyle = '#d4a830';
                    ctx.fill();
                }
            }
            if (ma) {
                const mv = ma[i];
                if (mv != null && isFinite(mv)) {
                    ctx.beginPath();
                    ctx.arc(x, clampY(mapY(mv)), 3, 0, Math.PI * 2);
                    ctx.fillStyle = this.COLORS.ma;
                    ctx.fill();
                }
            }
        }
    },

    // ============================================
    // USER INTERACTION & TOOLTIPS
    // ============================================

    _onMove(e) {
        if (!this._payload) return;
        const canvas = document.getElementById('vs-canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const pad = this.PAD;
        const chartW = rect.width - pad.left - pad.right;
        const n = this._payload.dates.length;
        if (chartW <= 0 || n < 2) return;

        if (x < pad.left - 4 || x > rect.width - pad.right + 4) {
            this._onLeave();
            return;
        }

        let idx = Math.round(((x - pad.left) / chartW) * (n - 1));
        idx = Math.max(0, Math.min(n - 1, idx));
        this.state.hoverIdx = idx;
        this.state.lastMouse = { x, y };
        this._scheduleDraw();
        this._showTooltip(idx);

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        this._updateReading(all[this.state.ticker], this._payload, idx);
    },

    _onLeave() {
        this.state.hoverIdx = null;
        const tooltip = document.getElementById('vs-tooltip');
        if (tooltip) tooltip.style.display = 'none';
        this._scheduleDraw();

        const all = (typeof App !== 'undefined' && App.allMetrics) ? App.allMetrics : {};
        this._updateReading(all[this.state.ticker], this._payload, null);
    },

    _scheduleDraw() {
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._draw();
        });
    },

    _showTooltip(idx) {
        const tooltip = document.getElementById('vs-tooltip');
        const wrap = document.getElementById('vs-canvas-wrap');
        const payload = this._payload;
        if (!tooltip || !wrap || !payload) return;
        const i = idx;
        const date = payload.dates[i];
        const close = payload.closes[i];
        const prevClose = (i > 0) ? payload.closes[i - 1] : close;
        const priceChg = close - prevClose;
        const pricePct = prevClose > 0 ? (priceChg / prevClose) * 100 : 0;
        const priceChgColor = priceChg > 0 ? this.COLORS.up : priceChg < 0 ? this.COLORS.down : this.COLORS.flat;
        const priceChgSign = priceChg > 0 ? '+' : '';

        const rawVol = payload.rawVolumes ? payload.rawVolumes[i] : payload.volumes[i];
        const dollarVol = payload.dollarVolumes ? payload.dollarVolumes[i] : (close * rawVol);

        const studyNames = {
            vol: 'VOLUME',
            osc: 'VOL OSC',
            net: 'NET VOL',
            cmf: 'CMF-21',
            obv: 'OBV',
            pvt: 'PVT',
            vpin: 'OFI (IMBALANCE)',
            illiq: 'LAI (ABSORPTION)',
            esvd: 'ESVD (DIVERGENCE)',
            lmsw: 'LMSW-ρ',
            vwapz: 'VWAP-Z',
            tkvf: 'TKVF'
        };

        let value = null, valueLabel = studyNames[payload.study] || payload.study;
        if (payload.bars) value = payload.bars[i];
        else if (payload.line) value = payload.line[i];

        const dirSign = payload.colorSigns ? (payload.colorSigns[i] || 0) : (value > 0 ? 1 : value < 0 ? -1 : 0);
        const dirColor = ' style="color:' + (dirSign > 0 ? this.COLORS.up : dirSign < 0 ? this.COLORS.down : this.COLORS.flat) + '"';

        let studyValStr = 'n/a';
        let badgeText = '';
        let badgeColor = '';
        let extraRowsHtml = '';

        // --- STUDY-SPECIFIC METRIC & BADGE EXTRACTION ---
        if (payload.study === 'vpin') {
            const ofi = payload.line ? payload.line[i] : null;
            const vpin = payload.secondaryLine ? payload.secondaryLine[i] : null;
            studyValStr = ofi == null ? 'n/a' : (ofi >= 0 ? '+' : '') + ofi.toFixed(3);
            if (ofi != null && vpin != null) {
                if (vpin >= 0.45 && Math.abs(ofi) >= 0.40) {
                    badgeText = 'TOXICITY CLIMAX';
                    badgeColor = '#d4a830';
                } else if (ofi >= 0.25) {
                    badgeText = 'INFORMED BUYING';
                    badgeColor = this.COLORS.up;
                } else if (ofi <= -0.25) {
                    badgeText = 'INFORMED SELLING';
                    badgeColor = this.COLORS.down;
                } else if (vpin >= 0.40) {
                    badgeText = 'ELEVATED TOXICITY';
                    badgeColor = '#d4a830';
                } else {
                    badgeText = 'BALANCED FLOW';
                    badgeColor = this.COLORS.label;
                }
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">VPIN TOXICITY</span>
                        <span class="vs-tt-val" style="color:${vpin >= 0.40 ? '#d4a830' : 'inherit'};">${(vpin * 100).toFixed(1)}%</span>
                    </div>
                `;
            }
        } else if (payload.study === 'illiq') {
            const lai = payload.bars ? payload.bars[i] : null;
            const zIlliq = payload.line ? payload.line[i] : null;
            const zDv = payload.extraData && payload.extraData.zDv ? payload.extraData.zDv[i] : null;
            studyValStr = lai == null ? 'n/a' : (lai >= 0 ? '+' : '') + lai.toFixed(2);
            if (lai != null && zIlliq != null) {
                if (lai >= 2.0 && (zDv == null || zDv >= 1.2)) {
                    badgeText = 'INSTITUTIONAL ABSORPTION WALL';
                    badgeColor = this.COLORS.up;
                } else if (zIlliq >= 1.5 && (zDv == null || zDv < 0)) {
                    badgeText = 'LIQUIDITY VACUUM';
                    badgeColor = '#d4a830';
                } else if (zIlliq <= -1.0 && (zDv == null || zDv <= -1.0)) {
                    badgeText = 'THIN CONSOLIDATION';
                    badgeColor = this.COLORS.label;
                } else {
                    badgeText = lai > 0 ? 'NET ABSORPTION' : 'NORMAL LIQUIDITY';
                    badgeColor = lai > 0 ? this.COLORS.up : this.COLORS.label;
                }
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">ILLIQ-Z</span>
                        <span class="vs-tt-val" style="color:${this.COLORS.line};">${(zIlliq >= 0 ? '+' : '') + zIlliq.toFixed(2)}σ</span>
                    </div>
                `;
                if (zDv != null) {
                    extraRowsHtml += `
                        <div class="vs-tt-row">
                            <span class="vs-tt-lbl">VOL Z-SCORE</span>
                            <span class="vs-tt-val">${(zDv >= 0 ? '+' : '') + zDv.toFixed(2)}σ</span>
                        </div>
                    `;
                }
            }
        } else if (payload.study === 'esvd') {
            const esvd = payload.bars ? payload.bars[i] : null;
            const zSpread = payload.line ? payload.line[i] : null;
            const spreadAR = payload.extraData && payload.extraData.spreadAR ? payload.extraData.spreadAR[i] : null;
            studyValStr = esvd == null ? 'n/a' : (esvd >= 0 ? '+' : '') + esvd.toFixed(2) + 'σ';
            if (esvd != null && zSpread != null) {
                if (esvd >= 1.5 && zSpread >= 1.0) {
                    badgeText = 'SPREAD STRESS / WITHDRAWAL';
                    badgeColor = this.COLORS.down;
                } else if (esvd <= -1.5) {
                    badgeText = 'DEEP LIQUIDITY SPONSORSHIP';
                    badgeColor = this.COLORS.up;
                } else {
                    badgeText = esvd > 0 ? 'SPREAD SPREADING' : 'BALANCED SPREAD';
                    badgeColor = esvd > 0 ? '#d4a830' : this.COLORS.label;
                }
                if (spreadAR != null) {
                    extraRowsHtml += `
                        <div class="vs-tt-row">
                            <span class="vs-tt-lbl">EFF SPREAD</span>
                            <span class="vs-tt-val" style="color:#e06c75;">${spreadAR.toFixed(2)}%</span>
                        </div>
                    `;
                }
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">SPREAD Z-SCORE</span>
                        <span class="vs-tt-val">${(zSpread >= 0 ? '+' : '') + zSpread.toFixed(2)}σ</span>
                    </div>
                `;
            }
        } else if (payload.study === 'lmsw') {
            const rho = payload.line ? payload.line[i] : null;
            studyValStr = rho == null ? 'n/a' : (rho >= 0 ? '+' : '') + rho.toFixed(3);
            if (rho != null) {
                if (rho >= 0.25) {
                    badgeText = 'INFORMED CONTINUATION';
                    badgeColor = this.COLORS.up;
                } else if (rho <= -0.25) {
                    badgeText = 'LIQUIDITY REVERSAL REGIME';
                    badgeColor = this.COLORS.down;
                } else {
                    badgeText = 'NOISE / NEUTRAL REGIME';
                    badgeColor = this.COLORS.label;
                }
            }
        } else if (payload.study === 'vwapz') {
            const vwapZ = payload.line ? payload.line[i] : null;
            const rvwap = payload.extraData && payload.extraData.rvwap ? payload.extraData.rvwap[i] : null;
            const slope = payload.extraData && payload.extraData.slopeVwap ? payload.extraData.slopeVwap[i] : null;
            studyValStr = vwapZ == null ? 'n/a' : (vwapZ >= 0 ? '+' : '') + vwapZ.toFixed(2) + 'σ';
            if (vwapZ != null) {
                if (vwapZ >= 2.0) {
                    badgeText = 'COST-BASIS STRETCH (PEAK)';
                    badgeColor = '#d4a830';
                } else if (vwapZ <= -2.0) {
                    badgeText = 'CAPITULATION STRETCH (TROUGH)';
                    badgeColor = this.COLORS.down;
                } else if (Math.abs(vwapZ) < 0.50 && slope != null && slope > 0.08) {
                    badgeText = 'INST PULLBACK DEFENSE';
                    badgeColor = this.COLORS.up;
                } else {
                    badgeText = 'FAIR VALUE BAND';
                    badgeColor = this.COLORS.label;
                }
                if (rvwap != null) {
                    extraRowsHtml += `
                        <div class="vs-tt-row">
                            <span class="vs-tt-lbl">ROLLING VWAP</span>
                            <span class="vs-tt-val" style="color:${this.COLORS.line};">$${this.fmtPrice(rvwap)}</span>
                        </div>
                    `;
                }
                if (slope != null) {
                    extraRowsHtml += `
                        <div class="vs-tt-row">
                            <span class="vs-tt-lbl">MIGRATION SLOPE</span>
                            <span class="vs-tt-val">${(slope >= 0 ? '+' : '') + slope.toFixed(2)}σ/d</span>
                        </div>
                    `;
                }
            }
        } else if (payload.study === 'tkvf') {
            const tkvf = payload.line ? payload.line[i] : null;
            const trig = payload.ma ? payload.ma[i] : null;
            studyValStr = tkvf == null ? 'n/a' : (tkvf >= 0 ? '+' : '') + tkvf.toFixed(1);
            if (tkvf != null && trig != null) {
                if (tkvf > trig && tkvf > 0) {
                    badgeText = 'BULLISH VOLUME FORCE';
                    badgeColor = this.COLORS.up;
                } else if (tkvf < trig && tkvf < 0) {
                    badgeText = 'BEARISH VOLUME FORCE';
                    badgeColor = this.COLORS.down;
                } else if (tkvf > trig && tkvf <= 0) {
                    badgeText = 'BULLISH CROSSOVER';
                    badgeColor = this.COLORS.up;
                } else {
                    badgeText = 'BEARISH CROSSOVER';
                    badgeColor = '#d4a830';
                }
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">TRIGGER (9D)</span>
                        <span class="vs-tt-val" style="color:${this.COLORS.ma};">${(trig >= 0 ? '+' : '') + trig.toFixed(1)}</span>
                    </div>
                `;
                const hist = payload.bars ? payload.bars[i] : null;
                if (hist != null) {
                    extraRowsHtml += `
                        <div class="vs-tt-row">
                            <span class="vs-tt-lbl">FORCE HIST</span>
                            <span class="vs-tt-val" style="color:${hist >= 0 ? this.COLORS.up : this.COLORS.down};">${(hist >= 0 ? '+' : '') + hist.toFixed(1)}</span>
                        </div>
                    `;
                }
            }
        } else if (payload.study === 'osc') {
            studyValStr = value == null ? 'n/a' : (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
            if (value != null) {
                badgeText = value > 0 ? 'EXPANSION' : value < 0 ? 'CONTRACTION' : 'NEUTRAL';
                badgeColor = value > 0 ? this.COLORS.up : value < 0 ? this.COLORS.down : this.COLORS.label;
            }
        } else if (payload.study === 'cmf') {
            studyValStr = value == null ? 'n/a' : (value >= 0 ? '+' : '') + value.toFixed(3);
            if (value != null) {
                badgeText = value >= 0.10 ? 'INSTITUTIONAL ACCUMULATION'
                    : value <= -0.10 ? 'INSTITUTIONAL DISTRIBUTION'
                    : value > 0 ? 'ACCUMULATION'
                    : value < 0 ? 'DISTRIBUTION'
                    : 'NEUTRAL';
                badgeColor = value > 0 ? this.COLORS.up : value < 0 ? this.COLORS.down : this.COLORS.label;
            }
        } else if (payload.study === 'vol') {
            studyValStr = value == null ? 'n/a' : (payload.unit === 'dollar' ? '$' + this.fmtVol(value) : this.fmtVol(value));
            badgeText = dirSign > 0 ? 'UP DAY' : dirSign < 0 ? 'DOWN DAY' : 'FLAT';
            badgeColor = dirSign > 0 ? this.COLORS.up : dirSign < 0 ? this.COLORS.down : this.COLORS.label;
        } else if (payload.study === 'net') {
            studyValStr = value == null ? 'n/a' : (payload.unit === 'dollar' ? (value > 0 ? '+$' : (value < 0 ? '-$' : '')) + this.fmtVol(Math.abs(value)) : this.fmtSigned(value));
            badgeText = value > 0 ? 'NET INFLOW' : value < 0 ? 'NET OUTFLOW' : 'FLAT';
            badgeColor = value > 0 ? this.COLORS.up : value < 0 ? this.COLORS.down : this.COLORS.label;
        } else {
            studyValStr = value == null ? 'n/a' : (payload.unit === 'dollar' ? (value > 0 ? '+$' : (value < 0 ? '-$' : '')) + this.fmtVol(Math.abs(value)) : this.fmtSigned(value));
            const maVal = payload.ma ? payload.ma[i] : null;
            if (value != null && maVal != null) {
                badgeText = value >= maVal ? 'ACCUMULATION' : 'DISTRIBUTION';
                badgeColor = value >= maVal ? this.COLORS.up : this.COLORS.down;
            }
        }

        let rowsHtml = '';

        rowsHtml += `
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">CLOSE</span>
                <span class="vs-tt-val">$${this.fmtPrice(close)} <span style="color:${priceChgColor};font-size:0.58rem;">(${priceChgSign}${pricePct.toFixed(1)}%)</span></span>
            </div>
        `;

        rowsHtml += `
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">${valueLabel}</span>
                <span class="vs-tt-val"${dirColor}>${studyValStr}</span>
            </div>
        `;

        rowsHtml += extraRowsHtml;

        if (payload.ma && payload.ma[i] != null && payload.study !== 'tkvf') {
            const maVal = payload.ma[i];
            const maFmt = payload.study === 'vol'
                ? (payload.unit === 'dollar' ? '$' + this.fmtVol(maVal) : this.fmtVol(maVal))
                : (payload.unit === 'dollar' ? (maVal > 0 ? '+$' : (maVal < 0 ? '-$' : '')) + this.fmtVol(Math.abs(maVal)) : this.fmtSigned(maVal));
            rowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">21D MA</span>
                    <span class="vs-tt-val" style="color:${this.COLORS.ma};">${maFmt}</span>
                </div>
            `;
            if (payload.study === 'vol' && maVal > 0 && value != null) {
                const rvol = value / maVal;
                const rColor = rvol >= 2.0 ? this.COLORS.up : rvol >= 1.2 ? 'var(--cyan)' : 'inherit';
                rowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">RVOL-21</span>
                        <span class="vs-tt-val" style="color:${rColor};">${rvol.toFixed(2)}×</span>
                    </div>
                `;
            }
        }

        if (payload.study === 'net' && payload.line && payload.line[i] != null) {
            const r = payload.line[i];
            const rFmt = payload.unit === 'dollar'
                ? (r > 0 ? '+$' : (r < 0 ? '-$' : '')) + this.fmtVol(Math.abs(r))
                : this.fmtSigned(r);
            rowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">NET 21D</span>
                    <span class="vs-tt-val">${rFmt}</span>
                </div>
            `;
        }

        rowsHtml += '<div class="vs-tt-divider"></div>';
        rowsHtml += `
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">SHARES</span>
                <span class="vs-tt-val">${this.fmtVol(rawVol)}</span>
            </div>
            <div class="vs-tt-row">
                <span class="vs-tt-lbl">DOLLAR VOL</span>
                <span class="vs-tt-val">$${this.fmtVol(dollarVol)}</span>
            </div>
        `;

        const badgeHtml = badgeText ? `<span class="vs-tt-badge" style="background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}44;">${badgeText}</span>` : '';

        tooltip.innerHTML = `
            <div class="vs-tt-header">
                <span class="vs-tt-date">${this.fmtFullDate(date)}</span>
                ${badgeHtml}
            </div>
            ${rowsHtml}
        `;

        const twrap = wrap.clientWidth, thrap = wrap.clientHeight;
        tooltip.style.display = 'block';
        const m = this.state.lastMouse;
        const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
        let left = m.x + 14;
        if (left + tw > twrap - 4) left = m.x - tw - 14;
        left = Math.max(4, left);
        let top = m.y + 12;
        if (top + th > thrap - 4) top = thrap - th - 4;
        top = Math.max(4, top);
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    },

    // ============================================
    // QUANTITATIVE READING BAR
    // ============================================

    _updateReading(metrics, payload, hoverIdx) {
        const el = document.getElementById('vs-reading');
        if (!el) return;
        if (!payload || !payload.dates.length) {
            el.innerHTML = '<span class="vs-reading-na">No data</span>';
            return;
        }

        const study = payload.study;
        const last = (hoverIdx != null && hoverIdx >= 0 && hoverIdx < payload.dates.length)
            ? hoverIdx
            : payload.dates.length - 1;

        const isHover = (hoverIdx != null && hoverIdx !== payload.dates.length - 1);
        const dateTag = isHover ? `<span class="vs-reading-item"><span class="vs-lbl">DATE</span> ${typeof formatDisplayDate === 'function' ? formatDisplayDate(payload.dates[last]) : payload.dates[last]}</span>` : '';

        const close = payload.closes[last];
        const prev = last > 0 ? payload.closes[last - 1] : close;
        const pctChg = prev > 0 ? ((close - prev) / prev) * 100 : 0;
        const chgColor = pctChg > 0 ? this.COLORS.up : pctChg < 0 ? this.COLORS.down : this.COLORS.flat;
        const chgSign = pctChg > 0 ? '+' : '';
        const closeTag = `<span class="vs-reading-item"><span class="vs-lbl">CLOSE</span> $${this.fmtPrice(close)} <span style="color:${chgColor};font-size:0.68rem;font-weight:700;">(${chgSign}${pctChg.toFixed(1)}%)</span></span>`;

        const rawVol = payload.rawVolumes ? payload.rawVolumes[last] : payload.volumes[last];
        const dollarVol = payload.dollarVolumes ? payload.dollarVolumes[last] : (close * rawVol);

        const parts = [];
        if (dateTag) parts.push(dateTag);
        parts.push(closeTag);

        // --- MICROSTRUCTURE STUDIES READING LOGIC ---
        if (study === 'vpin') {
            const ofi = payload.line ? payload.line[last] : null;
            const vpin = payload.secondaryLine ? payload.secondaryLine[last] : null;
            const ofiStr = ofi != null ? (ofi >= 0 ? '+' : '') + ofi.toFixed(3) : 'n/a';
            const vpinStr = vpin != null ? (vpin * 100).toFixed(1) + '%' : 'n/a';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">OFI</span> ${ofiStr}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VPIN</span> ${vpinStr}</span>`);
            let flowText = 'BALANCED';
            let flowColor = this.COLORS.label;
            if (ofi != null && vpin != null) {
                if (vpin >= 0.45 && Math.abs(ofi) >= 0.40) { flowText = 'TOXICITY CLIMAX'; flowColor = '#d4a830'; }
                else if (ofi >= 0.25) { flowText = 'INFORMED BUY'; flowColor = this.COLORS.up; }
                else if (ofi <= -0.25) { flowText = 'INFORMED SELL'; flowColor = this.COLORS.down; }
                else if (vpin >= 0.40) { flowText = 'ELEVATED TOXICITY'; flowColor = '#d4a830'; }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">FLOW</span> <span style="color:${flowColor}">${flowText}</span></span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VALUE</span> $${this.fmtVol(dollarVol)}</span>`);
        } else if (study === 'illiq') {
            const lai = payload.bars ? payload.bars[last] : null;
            const zIlliq = payload.line ? payload.line[last] : null;
            const zDv = payload.extraData && payload.extraData.zDv ? payload.extraData.zDv[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">LAI</span> ${lai != null ? (lai >= 0 ? '+' : '') + lai.toFixed(2) : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">ILLIQ-Z</span> ${zIlliq != null ? (zIlliq >= 0 ? '+' : '') + zIlliq.toFixed(2) + 'σ' : 'n/a'}</span>`);
            let regText = 'NORMAL';
            let regColor = this.COLORS.label;
            if (lai != null && zIlliq != null) {
                if (lai >= 2.0 && (zDv == null || zDv >= 1.2)) { regText = 'ABSORPTION WALL'; regColor = this.COLORS.up; }
                else if (zIlliq >= 1.5 && (zDv == null || zDv < 0)) { regText = 'LIQUIDITY VACUUM'; regColor = '#d4a830'; }
                else if (zIlliq <= -1.0) { regText = 'CONSOLIDATION'; regColor = this.COLORS.label; }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">REGIME</span> <span style="color:${regColor}">${regText}</span></span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VALUE</span> $${this.fmtVol(dollarVol)}</span>`);
        } else if (study === 'esvd') {
            const esvd = payload.bars ? payload.bars[last] : null;
            const zSpread = payload.line ? payload.line[last] : null;
            const spreadAR = payload.extraData && payload.extraData.spreadAR ? payload.extraData.spreadAR[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">ESVD</span> ${esvd != null ? (esvd >= 0 ? '+' : '') + esvd.toFixed(2) + 'σ' : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">SPREAD</span> ${spreadAR != null ? spreadAR.toFixed(2) + '%' : 'n/a'}</span>`);
            let stateText = 'BALANCED';
            let stateColor = this.COLORS.label;
            if (esvd != null && zSpread != null) {
                if (esvd >= 1.5 && zSpread >= 1.0) { stateText = 'LIQUIDITY WITHDRAWAL'; stateColor = this.COLORS.down; }
                else if (esvd <= -1.5) { stateText = 'DEEP SPONSORSHIP'; stateColor = this.COLORS.up; }
                else if (esvd > 0) { stateText = 'SPREAD STRETCH'; stateColor = '#d4a830'; }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">STATE</span> <span style="color:${stateColor}">${stateText}</span></span>`);
        } else if (study === 'lmsw') {
            const rho = payload.line ? payload.line[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">LMSW-ρ</span> ${rho != null ? (rho >= 0 ? '+' : '') + rho.toFixed(3) : 'n/a'}</span>`);
            let regText = 'NOISE / NEUTRAL';
            let regColor = this.COLORS.label;
            if (rho != null) {
                if (rho >= 0.25) { regText = 'INFORMED CONTINUATION'; regColor = this.COLORS.up; }
                else if (rho <= -0.25) { regText = 'LIQUIDITY REVERSAL'; regColor = this.COLORS.down; }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">REGIME</span> <span style="color:${regColor}">${regText}</span></span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VALUE</span> $${this.fmtVol(dollarVol)}</span>`);
        } else if (study === 'vwapz') {
            const vwapZ = payload.line ? payload.line[last] : null;
            const rvwap = payload.extraData && payload.extraData.rvwap ? payload.extraData.rvwap[last] : null;
            const slope = payload.extraData && payload.extraData.slopeVwap ? payload.extraData.slopeVwap[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VWAP-Z</span> ${vwapZ != null ? (vwapZ >= 0 ? '+' : '') + vwapZ.toFixed(2) + 'σ' : 'n/a'}</span>`);
            if (rvwap != null) parts.push(`<span class="vs-reading-item"><span class="vs-lbl">RVWAP</span> $${this.fmtPrice(rvwap)}</span>`);
            if (slope != null) parts.push(`<span class="vs-reading-item"><span class="vs-lbl">SLOPE</span> ${(slope >= 0 ? '+' : '') + slope.toFixed(2)}σ/d</span>`);
            let zoneText = 'FAIR VALUE';
            let zoneColor = this.COLORS.label;
            if (vwapZ != null) {
                if (vwapZ >= 2.0) { zoneText = 'OVERBOUGHT STRETCH'; zoneColor = '#d4a830'; }
                else if (vwapZ <= -2.0) { zoneText = 'CAPITULATION STRETCH'; zoneColor = this.COLORS.down; }
                else if (Math.abs(vwapZ) < 0.50 && slope != null && slope > 0.08) { zoneText = 'INST PULLBACK DEFENSE'; zoneColor = this.COLORS.up; }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">ZONE</span> <span style="color:${zoneColor}">${zoneText}</span></span>`);
        } else if (study === 'tkvf') {
            const tkvf = payload.line ? payload.line[last] : null;
            const trig = payload.ma ? payload.ma[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">TKVF</span> ${tkvf != null ? (tkvf >= 0 ? '+' : '') + tkvf.toFixed(1) : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">TRIG</span> ${trig != null ? (trig >= 0 ? '+' : '') + trig.toFixed(1) : 'n/a'}</span>`);
            let forceText = 'NEUTRAL';
            let forceColor = this.COLORS.label;
            if (tkvf != null && trig != null) {
                if (tkvf > trig && tkvf > 0) { forceText = 'BULLISH FORCE'; forceColor = this.COLORS.up; }
                else if (tkvf < trig && tkvf < 0) { forceText = 'BEARISH FORCE'; forceColor = this.COLORS.down; }
                else if (tkvf > trig) { forceText = 'BULLISH REBOUND'; forceColor = this.COLORS.up; }
                else { forceText = 'BEARISH EXHAUSTION'; forceColor = '#d4a830'; }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">FORCE</span> <span style="color:${forceColor}">${forceText}</span></span>`);
        // --- CLASSIC STUDIES READING LOGIC ---
        } else if (study === 'vol') {
            const ma = payload.ma ? payload.ma[last] : null;
            const rvol = (ma && ma > 0) ? (payload.bars[last] / ma) : ((metrics && metrics.rvol) ? metrics.rvol['21d'] : null);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">RVOL-21</span> ${rvol != null ? rvol.toFixed(2) + '×' : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VOL</span> ${this.fmtVol(rawVol)}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VALUE</span> $${this.fmtVol(dollarVol)}</span>`);
        } else if (study === 'osc') {
            const v = payload.line ? payload.line[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">OSC</span> ${v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">STATE</span> <span style="color:${v > 0 ? this.COLORS.up : v < 0 ? this.COLORS.down : 'inherit'}">${v == null ? 'n/a' : v > 0 ? 'EXPANSION' : v < 0 ? 'CONTRACTION' : 'NEUTRAL'}</span></span>`);
        } else if (study === 'net') {
            const r = payload.line ? payload.line[last] : null;
            const day = payload.bars ? payload.bars[last] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">DAY</span> ${day != null ? this.fmtSigned(day) : 'n/a'}</span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">21D</span> ${r != null ? this.fmtSigned(r) : 'n/a'}</span>`);
        } else if (study === 'cmf') {
            const v = payload.line ? payload.line[last] : null;
            const cmfStr = v != null ? (v >= 0 ? '+' : '') + v.toFixed(3) : 'n/a';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">CMF-21</span> ${cmfStr}</span>`);
            const regime = v == null ? 'n/a' : (v >= 0.10 ? 'INST ACCUMULATION' : v <= -0.10 ? 'INST DISTRIBUTION' : v > 0 ? 'ACCUMULATION' : v < 0 ? 'DISTRIBUTION' : 'NEUTRAL');
            const regimeColor = v == null ? 'inherit' : v > 0 ? this.COLORS.up : v < 0 ? this.COLORS.down : this.COLORS.label;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">REGIME</span> <span style="color:${regimeColor}">${regime}</span></span>`);

            const back = Math.max(0, last - 21);
            const pLast = payload.closes[last];
            const pBack = payload.closes[back];
            const priceDelta = (pLast != null && pBack != null && pBack > 0) ? ((pLast - pBack) / pBack) : 0;
            const indicatorSignal = v;

            let divText = 'NEUTRAL';
            let divColor = this.COLORS.label;
            if (indicatorSignal != null) {
                if (priceDelta < -0.01 && indicatorSignal > 0) {
                    divText = 'BULLISH DIVERGENCE';
                    divColor = this.COLORS.up;
                } else if (priceDelta > 0.01 && indicatorSignal < 0) {
                    divText = 'BEARISH DIVERGENCE';
                    divColor = this.COLORS.down;
                } else if (priceDelta > 0.01 && indicatorSignal > 0) {
                    divText = 'VOLUME CONFIRMED';
                    divColor = this.COLORS.up;
                } else if (priceDelta < -0.01 && indicatorSignal < 0) {
                    divText = 'DISTRIBUTION CONFIRMED';
                    divColor = this.COLORS.down;
                } else {
                    divText = indicatorSignal > 0 ? 'ACCUMULATION' : indicatorSignal < 0 ? 'DISTRIBUTION' : 'NEUTRAL';
                    divColor = indicatorSignal > 0 ? this.COLORS.up : indicatorSignal < 0 ? this.COLORS.down : this.COLORS.label;
                }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">SIGNAL</span> <span style="color:${divColor}">${divText}</span></span>`);
        } else if (study === 'obv' || study === 'pvt') {
            const line = payload.line || [];
            const ma = payload.ma || [];
            const lv = line[last], mv = ma[last];
            const state = (lv != null && mv != null) ? (lv >= mv ? 'ABOVE' : 'BELOW') : 'n/a';
            const stateColor = state === 'ABOVE' ? this.COLORS.up : state === 'BELOW' ? this.COLORS.down : 'inherit';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">MA</span> <span style="color:${stateColor}">${state}</span></span>`);
            const back = Math.max(0, last - 21);
            const delta = (lv != null && line[back] != null) ? lv - line[back] : null;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">21D Δ</span> ${delta != null ? this.fmtSigned(delta) : 'n/a'}</span>`);
            const bias = delta == null ? 'n/a' : delta > 0 ? 'ACCUMULATION' : delta < 0 ? 'DISTRIBUTION' : 'FLAT';
            const biasColor = bias === 'ACCUMULATION' ? this.COLORS.up : bias === 'DISTRIBUTION' ? this.COLORS.down : 'inherit';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">BIAS</span> <span style="color:${biasColor}">${bias}</span></span>`);

            const pLast = payload.closes[last];
            const pBack = payload.closes[back];
            const priceDelta = (pLast != null && pBack != null && pBack > 0) ? ((pLast - pBack) / pBack) : 0;
            const indicatorSignal = delta;

            let divText = 'NEUTRAL';
            let divColor = this.COLORS.label;
            if (indicatorSignal != null) {
                if (priceDelta < -0.01 && indicatorSignal > 0) {
                    divText = 'BULLISH DIVERGENCE';
                    divColor = this.COLORS.up;
                } else if (priceDelta > 0.01 && indicatorSignal < 0) {
                    divText = 'BEARISH DIVERGENCE';
                    divColor = this.COLORS.down;
                } else if (priceDelta > 0.01 && indicatorSignal > 0) {
                    divText = 'VOLUME CONFIRMED';
                    divColor = this.COLORS.up;
                } else if (priceDelta < -0.01 && indicatorSignal < 0) {
                    divText = 'DISTRIBUTION CONFIRMED';
                    divColor = this.COLORS.down;
                } else {
                    divText = indicatorSignal > 0 ? 'ACCUMULATION' : indicatorSignal < 0 ? 'DISTRIBUTION' : 'NEUTRAL';
                    divColor = indicatorSignal > 0 ? this.COLORS.up : indicatorSignal < 0 ? this.COLORS.down : this.COLORS.label;
                }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">SIGNAL</span> <span style="color:${divColor}">${divText}</span></span>`);
        }
        el.innerHTML = parts.join('');
    }
};
