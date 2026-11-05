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
    _suiteCache: null,
    _payload: null,
    _rafId: null,

    STUDIES: {
        classic: [
            { key: 'vol', label: 'VOLUME', tip: 'RVOL-FLOW: Split-invariant relative volume with continuous order-flow pressure bar coloring.' },
            { key: 'osc', label: 'VOL OSC', tip: 'DV-OSC: Directional volume velocity oscillator (EMA5 - EMA21 signed flow momentum) with participation acceleration envelope.' },
            { key: 'net', label: 'NET VOL', tip: 'EW-NETFLOW: Exponentially weighted 21-day net impulse accumulation with stationary Z-score bounds, eliminating boxcar drop-off jumps.' },
            { key: 'cmf', label: 'CMF', tip: 'ACMF: Adaptive True-Range Chaikin Money Flow with 10-bar efficiency ratio, dynamically contracting lag in squeezes.' },
            { key: 'obv', label: 'OBV', tip: 'IOBV: Split-invariant continuous cumulative flow with EMA5/KAMA14/EMA34 ribbon, stationary Z-OBV oscillator, and Day-1 crash breaker.' },
            { key: 'pvt', label: 'PVT', tip: 'Invariant Price-Volume Trend (IPVT): Split-invariant Kyle-Bouchaud flow kernel with Dual Zero-Lag EMA ribbon, stationary bounded Z-score oscillator, and regime-asymmetric execution engine.' },
        ],
        micro: [
            { key: 'vpin', label: 'BVC-VPIN', tip: 'Bulk Volume Classification Imbalance (OFI) & Order-Flow Toxicity (VPIN): tracks institutional adverse selection; extreme peaks signal panic capitulation bottoms or blow-off tops.' },
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

    // Robust 14.3% Trimmed Mean over buffer (3 lowest and 3 highest trimmed from 21 bars)
    trimmedMean21(buf) {
        if (!buf || !buf.length) return 0;
        const valid = [];
        for (let i = 0; i < buf.length; i++) {
            const v = buf[i];
            if (v != null && isFinite(v)) valid.push(v);
        }
        if (!valid.length) return 0;
        if (valid.length < 7) {
            let s = 0;
            for (let i = 0; i < valid.length; i++) s += valid[i];
            return s / valid.length;
        }
        valid.sort((a, b) => a - b);
        const trimCount = valid.length >= 21 ? 3 : Math.floor(valid.length * 0.142857);
        let s = 0, count = 0;
        for (let i = trimCount; i < valid.length - trimCount; i++) {
            s += valid[i];
            count++;
        }
        return count > 0 ? s / count : valid[Math.floor(valid.length / 2)];
    },

    // 14-period Average True Range (Wilder smoothing / EMA alpha = 1/14)
    computeATR14(highs, lows, closes) {
        const n = Math.min(highs.length, lows.length, closes.length);
        const tr = new Float64Array(n);
        const atr = new Float64Array(n);
        if (n === 0) return atr;
        for (let i = 0; i < n; i++) {
            const h = highs[i] != null ? highs[i] : closes[i];
            const l = lows[i] != null ? lows[i] : closes[i];
            const prevC = (i > 0 && closes[i - 1] != null) ? closes[i - 1] : closes[i];
            tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
        }
        const alpha = 1.0 / 14;
        let prevAtr = tr[0];
        atr[0] = prevAtr;
        for (let i = 1; i < n; i++) {
            prevAtr = alpha * tr[i] + (1.0 - alpha) * prevAtr;
            atr[i] = prevAtr;
        }
        return atr;
    },

    // Zero-Lag Exponential Moving Average (ZLEMA)
    zlema(values, n = 21, lag = null) {
        const len = values ? values.length : 0;
        const out = new Array(len).fill(null);
        if (!values || len === 0 || n <= 0) return out;
        const actualLag = (lag != null && lag >= 0) ? lag : Math.floor((n - 1) / 2);
        const k = 2 / (n + 1);
        let prev = null;
        for (let i = 0; i < len; i++) {
            const v = values[i];
            if (v == null || !isFinite(v)) continue;
            const pastVal = (i >= actualLag && values[i - actualLag] != null && isFinite(values[i - actualLag]))
                ? values[i - actualLag]
                : v;
            const zeroLagSample = 2 * v - pastVal;
            if (prev == null) {
                prev = zeroLagSample;
            } else {
                prev = zeroLagSample * k + prev * (1 - k);
            }
            out[i] = prev;
        }
        return out;
    },

    // ============================================
    // UPGRADED QUANTITATIVE VOLUME SUITE (MODERNIZED)
    // ============================================

    computeUpgradedVolumeSuite(primaryBars, ticker = 'BOIL', sisterBars = null) {
        if (!primaryBars || !primaryBars.length) return null;
        const n = primaryBars.length;
        const dates = new Array(n);
        const opens = new Float64Array(n);
        const highs = new Float64Array(n);
        const lows = new Float64Array(n);
        const closes = new Float64Array(n);
        const volumes = new Float64Array(n);

        for (let i = 0; i < n; i++) {
            const b = primaryBars[i] || {};
            const c = b.close != null ? b.close : 0;
            dates[i] = b.date || '';
            closes[i] = c;
            opens[i] = (b.open != null && isFinite(b.open)) ? b.open : c;
            highs[i] = (b.high != null && isFinite(b.high)) ? b.high : c;
            lows[i] = (b.low != null && isFinite(b.low)) ? b.low : c;
            volumes[i] = (b.volume != null && isFinite(b.volume)) ? b.volume : 0;
        }

        const isShortEtp = (ticker === 'KOLD' || ticker === 'HND.TO' || ticker === '3NGS.L' ||
            (typeof CONFIG !== 'undefined' && CONFIG.etfs && CONFIG.etfs[ticker] && CONFIG.etfs[ticker].side === 'short'));

        // 1. Typical Price, Dollar Turnover, True Range, CLV, Log Returns
        const tp = new Float64Array(n);
        const turnover = new Float64Array(n);
        const clvTR = new Float64Array(n);
        const logRet = new Float64Array(n);
        const absLogRet = new Float64Array(n);
        const EPS = 1e-9;

        for (let i = 0; i < n; i++) {
            const h = highs[i], l = lows[i], c = closes[i];
            const p = (h + l + 2 * c) * 0.25;
            tp[i] = p;
            turnover[i] = volumes[i] * p;

            const prevC = i > 0 ? closes[i - 1] : opens[i];
            const trH = Math.max(h, prevC);
            const trL = Math.min(l, prevC);
            const tr = trH - trL;

            const hlSpan = h - l;
            clvTR[i] = hlSpan > EPS
                ? ((c - l) - (h - c)) / hlSpan
                : ((c - trL) - (trH - c)) / (tr + EPS);

            if (i > 0) {
                const lr = (prevC > EPS && c > EPS) ? Math.log(c / prevC) : 0;
                logRet[i] = lr;
                absLogRet[i] = Math.abs(lr);
            }
        }

        // 2. Lagged Outlier-Trimmed Baseline & Kyle-Bouchaud RVOL
        const baseTurnover = new Float64Array(n);
        const rvol = new Float64Array(n);
        const volWeight = new Float64Array(n);
        const phi = new Float64Array(n);
        const impulse = new Float64Array(n);

        const ringD = new Float64Array(21);
        const ringSig = new Float64Array(21);
        const sortScratch = new Float64Array(21);
        let countD = 0, headD = 0;

        for (let i = 0; i < n; i++) {
            if (i < 21) {
                let s = 0;
                for (let k = 0; k < countD; k++) s += ringD[k];
                const avgD = countD > 0 ? (s / countD) : Math.max(turnover[i], 1.0);
                baseTurnover[i] = avgD;
                rvol[i] = Math.max(0.01, Math.min(25.0, turnover[i] / (avgD + EPS)));
                volWeight[i] = Math.pow(rvol[i], 0.55);
                phi[i] = clvTR[i] * 0.45;
                impulse[i] = volWeight[i] * phi[i];
            } else {
                // Trimmed Mean of Turnover
                for (let k = 0; k < 21; k++) sortScratch[k] = ringD[k];
                sortScratch.sort();
                let sumD = 0;
                for (let k = 3; k < 18; k++) sumD += sortScratch[k];
                const trimD = sumD / 15.0;
                baseTurnover[i] = trimD;

                // Trimmed Mean of Volatility
                for (let k = 0; k < 21; k++) sortScratch[k] = ringSig[k];
                sortScratch.sort();
                let sumSig = 0;
                for (let k = 3; k < 18; k++) sumSig += sortScratch[k];
                const trimSig = (sumSig / 15.0) * 1.2533;

                const rv = Math.max(0.01, Math.min(25.0, turnover[i] / (trimD + EPS)));
                rvol[i] = rv;
                const wV = Math.pow(rv, 0.55);
                volWeight[i] = wV;

                const rNorm = Math.tanh((0.65 * logRet[i]) / (trimSig + EPS));
                const phi_t = Math.max(-1.0, Math.min(1.0, 0.55 * rNorm + 0.45 * clvTR[i]));
                phi[i] = phi_t;
                impulse[i] = wV * phi_t;
            }

            ringD[headD] = turnover[i];
            ringSig[headD] = absLogRet[i];
            headD = (headD + 1) % 21;
            if (countD < 21) countD++;
        }

        // 3. IOBV Cumulative Flow & Adaptive KAMA Ribbon
        const iobv = new Float64Array(n);
        const ema5 = new Float64Array(n);
        const kama14 = new Float64Array(n);
        const ema34 = new Float64Array(n);
        const er10 = new Float64Array(n);
        const zObv = new Float64Array(n);

        let runningIobv = 0;
        const alpha5 = 2.0 / (5.0 + 1.0);
        const alpha21 = 2.0 / (21.0 + 1.0);
        const alpha34 = 2.0 / (34.0 + 1.0);
        const kamaFastSC = 2.0 / (3.0 + 1.0);
        const kamaSlowSC = 2.0 / (34.0 + 1.0);

        const obvSpreadRing = new Float64Array(21);
        let obvRingCount = 0, obvRingHead = 0;

        for (let i = 0; i < n; i++) {
            runningIobv += impulse[i];
            iobv[i] = runningIobv;

            // Efficiency Ratio ER_10
            let netDelta = Math.abs(iobv[i] - iobv[Math.max(0, i - 10)]);
            let sumAbsF = 0;
            for (let j = 0; j < 10 && i - j >= 0; j++) sumAbsF += Math.abs(impulse[i - j]);
            const er = sumAbsF > EPS ? Math.min(1.0, netDelta / sumAbsF) : 0;
            er10[i] = er;

            if (i === 0) {
                ema5[i] = runningIobv;
                kama14[i] = runningIobv;
                ema34[i] = runningIobv;
            } else {
                const sc = Math.pow(er * (kamaFastSC - kamaSlowSC) + kamaSlowSC, 2.0);
                kama14[i] = kama14[i - 1] + sc * (runningIobv - kama14[i - 1]);
                ema5[i] = ema5[i - 1] + alpha5 * (runningIobv - ema5[i - 1]);
                ema34[i] = ema34[i - 1] + alpha34 * (runningIobv - ema34[i - 1]);
            }

            const obvSpread = runningIobv - kama14[i];
            obvSpreadRing[obvRingHead] = obvSpread * obvSpread;
            obvRingHead = (obvRingHead + 1) % 21;
            if (obvRingCount < 21) obvRingCount++;

            let sumObvSq = 0;
            for (let k = 0; k < obvRingCount; k++) sumObvSq += obvSpreadRing[k];
            const rmsObv = Math.sqrt(sumObvSq / obvRingCount + EPS);
            const z = obvSpread / rmsObv;
            zObv[i] = (100.0 * z) / Math.sqrt(z * z + 2.25);
        }

        // 4. VOL OSC (DV-OSC) & Participation Acceleration
        const volScalarAccel = new Float64Array(n);
        const dvOsc = new Float64Array(n);
        const dvOscState = new Array(n);
        let ema5VolW = 1.0, ema21VolW = 1.0;
        let ema5Flow = 0.0, ema21Flow = 0.0;
        const dvSpreadRing = new Float64Array(21);
        let dvRingCount = 0, dvRingHead = 0;

        for (let i = 0; i < n; i++) {
            const wV = volWeight[i];
            const f_t = impulse[i];
            ema5VolW = i === 0 ? wV : ema5VolW + alpha5 * (wV - ema5VolW);
            ema21VolW = i === 0 ? wV : ema21VolW + alpha21 * (wV - ema21VolW);
            volScalarAccel[i] = (100.0 * (ema5VolW - ema21VolW)) / (ema21VolW + EPS);

            ema5Flow = i === 0 ? f_t : ema5Flow + alpha5 * (f_t - ema5Flow);
            ema21Flow = i === 0 ? f_t : ema21Flow + alpha21 * (f_t - ema21Flow);
            const flowSpread = ema5Flow - ema21Flow;

            dvSpreadRing[dvRingHead] = flowSpread * flowSpread;
            dvRingHead = (dvRingHead + 1) % 21;
            if (dvRingCount < 21) dvRingCount++;

            let sumDvSq = 0;
            for (let k = 0; k < dvRingCount; k++) sumDvSq += dvSpreadRing[k];
            const rmsDv = Math.sqrt(sumDvSq / dvRingCount + EPS);
            const z = flowSpread / rmsDv;
            const dv = (100.0 * z) / Math.sqrt(z * z + 2.25);
            dvOsc[i] = dv;

            dvOscState[i] = (dv >= 20.0 && volScalarAccel[i] > 0)
                ? 'BULL_EXPANSION'
                : (dv <= -20.0 && volScalarAccel[i] > 0)
                ? 'BEAR_EXPANSION'
                : 'CONTRACTION_CHOP';
        }

        // 5. NET VOL (EW-NETFLOW)
        const ewNet21 = new Float64Array(n);
        const ewNetZ = new Float64Array(n);
        let runningEwNet = 0;
        const netSqRing = new Float64Array(21);
        let netRingCount = 0, netRingHead = 0;

        for (let i = 0; i < n; i++) {
            runningEwNet = (1.0 - alpha21) * runningEwNet + impulse[i];
            ewNet21[i] = runningEwNet;

            netSqRing[netRingHead] = runningEwNet * runningEwNet;
            netRingHead = (netRingHead + 1) % 21;
            if (netRingCount < 21) netRingCount++;

            let sumNetSq = 0;
            for (let k = 0; k < netRingCount; k++) sumNetSq += netSqRing[k];
            const rmsNet = Math.sqrt(sumNetSq / netRingCount + EPS);
            const z = runningEwNet / rmsNet;
            ewNetZ[i] = (100.0 * z) / Math.sqrt(z * z + 2.25);
        }

        // 6. CMF (ACMF)
        const acmf = new Float64Array(n);
        const acmfRegime = new Array(n);
        let acmfNum = 0, acmfDen = 1.0;

        for (let i = 0; i < n; i++) {
            const er = er10[i];
            const alphaAcmf = 0.0909 + er * (0.40 - 0.0909);
            acmfNum = (1.0 - alphaAcmf) * acmfNum + phi[i] * volWeight[i];
            acmfDen = (1.0 - alphaAcmf) * acmfDen + volWeight[i];
            const val = Math.max(-1.0, Math.min(1.0, acmfNum / (acmfDen + EPS)));
            acmf[i] = val;
            acmfRegime[i] = val >= 0.08 ? 'ACCUMULATION' : val <= -0.08 ? 'DISTRIBUTION' : 'NEUTRAL_DEADBAND';
        }

        // 7. Single Asset Composite & 14-bar Stochastic Divergences
        const composite = new Float64Array(n);
        const bullDiv = new Array(n).fill(false);
        const bearDiv = new Array(n).fill(false);

        for (let i = 0; i < n; i++) {
            composite[i] = 0.40 * zObv[i] + 0.35 * (100.0 * acmf[i]) + 0.25 * dvOsc[i];

            if (i >= 21 + 14) {
                let minP = Infinity, maxP = -Infinity;
                let minObv = Infinity, maxObv = -Infinity;
                for (let j = i - 13; j <= i; j++) {
                    if (lows[j] < minP) minP = lows[j];
                    if (highs[j] > maxP) maxP = highs[j];
                    if (iobv[j] < minObv) minObv = iobv[j];
                    if (iobv[j] > maxObv) maxObv = iobv[j];
                }
                const pLoc = (closes[i] - minP) / (maxP - minP + EPS);
                const obvLoc = (iobv[i] - minObv) / (maxObv - minObv + EPS);

                bullDiv[i] = pLoc <= 0.15 && (obvLoc - pLoc >= 0.30 || acmf[i] >= 0.05) && impulse[i] > 0.20;
                bearDiv[i] = pLoc >= 0.85 && (pLoc - obvLoc >= 0.30 || acmf[i] <= -0.05) && impulse[i] < -0.20;
            }
        }

        // 8. Date-Keyed Cross-Pair Coherence (Guardrail 5)
        const crossPair = new Float64Array(n);
        const sisterConfirmed = new Array(n).fill('STANDALONE');

        if (sisterBars && sisterBars.length) {
            const sisterTicker = (typeof CONFIG !== 'undefined' && CONFIG.etfs && CONFIG.etfs[ticker] && CONFIG.etfs[ticker].pair)
                ? CONFIG.etfs[ticker].pair
                : (isShortEtp ? 'BOIL' : 'KOLD');
            const sisterSuite = this.computeUpgradedVolumeSuite(sisterBars, sisterTicker, null);
            if (sisterSuite && sisterSuite.dates && sisterSuite.composite) {
                const sisterMap = new Map();
                for (let k = 0; k < sisterSuite.dates.length; k++) {
                    sisterMap.set(sisterSuite.dates[k], sisterSuite.composite[k]);
                }
                for (let i = 0; i < n; i++) {
                    const d = dates[i];
                    if (sisterMap.has(d)) {
                        const zSister = sisterMap.get(d);
                        crossPair[i] = 0.65 * composite[i] - 0.35 * zSister;
                        if (isShortEtp) {
                            sisterConfirmed[i] = zSister <= -15 ? 'CONFIRMED' : 'DIVERGENT';
                        } else {
                            sisterConfirmed[i] = zSister <= 0 ? 'CONFIRMED' : 'DIVERGENT';
                        }
                    } else {
                        crossPair[i] = composite[i];
                        sisterConfirmed[i] = 'STANDALONE';
                    }
                }
            }
        } else {
            for (let i = 0; i < n; i++) {
                crossPair[i] = composite[i];
                sisterConfirmed[i] = 'STANDALONE';
            }
        }

        // 9. Causal Regime-Asymmetric Execution Engine (Guardrail 3)
        const atr14 = this.computeATR14(highs, lows, closes);
        const inPosition = new Array(n).fill(false);
        const actions = new Array(n).fill('NEUTRAL / CASH');
        const statuses = new Array(n).fill('Monitoring order-flow dynamics');
        const trailingStops = new Array(n).fill(null);

        let posActive = false;
        let entryIdx = -1;
        let highestPricePrior = 0;
        let stopPrice = 0;

        for (let i = 0; i < n; i++) {
            if (i < 21) {
                actions[i] = 'WARMUP / INITIALIZING';
                statuses[i] = 'Accumulating baseline turnover and volatility distribution';
                inPosition[i] = false;
                continue;
            }

            const c = closes[i];
            const h = highs[i];
            const l = lows[i];
            const prevAtr = (i > 0 && atr14[i - 1] != null) ? atr14[i - 1] : (c * 0.03);
            const zObvCurr = zObv[i];
            const fCurr = impulse[i];
            const acmfCurr = acmf[i];
            const crossComp = crossPair[i];
            const fastAboveKama = ema5[i] > kama14[i];
            const kamaAboveSlow = kama14[i] > ema34[i];

            if (isShortEtp) {
                // INVERSE CARRY REGIME (KOLD, HND.TO, 3NGS.L)
                if (posActive) {
                    // Evaluate trailing stop against prior highest price
                    const activeStop = Math.max(stopPrice, highestPricePrior - 2.5 * prevAtr);
                    stopPrice = activeStop;
                    trailingStops[i] = activeStop;

                    if (fCurr <= -2.0 && iobv[i] < kama14[i]) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'CRASH BREAKER EJECTION';
                        statuses[i] = `Emergency Day-1 cash exit: violent negative flow shock (f_t = ${fCurr.toFixed(2)} <= -2.0)`;
                    } else if (l <= activeStop || c <= activeStop) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'TRAILING STOP EXIT';
                        statuses[i] = `2.5x ATR trailing volatility stop hit at $${activeStop.toFixed(2)}; profit locked`;
                    } else if (!fastAboveKama && crossComp <= -10.0) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'TREND BREAKDOWN EXIT';
                        statuses[i] = 'Fast EMA-5 crossed below KAMA-14 with negative composite conviction';
                    } else {
                        posActive = true;
                        inPosition[i] = true;
                        actions[i] = 'HOLDING SHORT CARRY';
                        statuses[i] = `Structural positive roll yield capture active; 2.5x ATR trailing stop at $${activeStop.toFixed(2)}`;
                        highestPricePrior = Math.max(highestPricePrior, h);
                    }
                } else {
                    const trendEntry = crossComp >= 22.0 && acmfCurr >= 0.08 && fastAboveKama && (kamaAboveSlow || er10[i] >= 0.35);
                    if ((trendEntry || (bullDiv[i] && crossComp >= 5.0)) && fCurr > -1.5) {
                        posActive = true;
                        entryIdx = i;
                        highestPricePrior = h;
                        stopPrice = h - 2.5 * prevAtr;
                        inPosition[i] = true;
                        trailingStops[i] = stopPrice;
                        actions[i] = 'TREND ACCUMULATION';
                        statuses[i] = `Contango harvest entry triggered: cross-pair conviction +${crossComp.toFixed(1)} with ribbon alignment`;
                    } else {
                        actions[i] = 'NEUTRAL / CASH';
                        statuses[i] = 'Contango drift monitoring; awaiting high-conviction institutional accumulation';
                    }
                }
            } else {
                // LONG DECAY REGIME (BOIL, HNU.TO, 3NGL.L) - Guardrail 3 Causal Trailing Stop
                if (posActive) {
                    const holdDays = i - entryIdx;
                    const activeStop = Math.max(stopPrice, highestPricePrior - 1.5 * prevAtr);
                    stopPrice = activeStop;
                    trailingStops[i] = activeStop;

                    if (zObvCurr >= 70.0 || acmfCurr >= 0.42 || bearDiv[i]) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'CLIMAX EXHAUSTION EXIT';
                        statuses[i] = `Parabolic climax profit taken: Z-OBV ${zObvCurr.toFixed(1)} or ACMF ${acmfCurr.toFixed(2)}`;
                    } else if (l <= activeStop || c <= activeStop) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = '1.5x ATR TRAILING STOP EXIT';
                        statuses[i] = `1.5x ATR trailing volatility stop hit at $${activeStop.toFixed(2)}; exiting before contango collapse`;
                    } else if (holdDays >= 7) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = '7-DAY MAX HOLD TIME EXIT';
                        statuses[i] = '7-bar maximum holding period reached; exiting to avoid physical contango bleed';
                    } else if (fCurr <= -0.45 || !fastAboveKama) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'FLOW STALL EXIT';
                        statuses[i] = `Flow impulse stalled (f_t = ${fCurr.toFixed(2)}) or EMA-5 fell below KAMA-14`;
                    } else {
                        posActive = true;
                        inPosition[i] = true;
                        actions[i] = 'HOLDING SQUEEZE';
                        statuses[i] = `Mean-reversion squeeze active (Day ${holdDays + 1}/7); trailing stop at $${activeStop.toFixed(2)}`;
                        highestPricePrior = Math.max(highestPricePrior, h);
                    }
                } else {
                    const priorOversold = Math.min(zObv[i - 1] || 0, zObv[i - 2] || 0) <= -35.0;
                    const stoppingVolThrust = priorOversold && fCurr >= 1.50 && dvOsc[i] > (dvOsc[i - 1] || 0) && crossComp >= 8.0;

                    if (bullDiv[i] || stoppingVolThrust) {
                        posActive = true;
                        entryIdx = i;
                        highestPricePrior = h;
                        stopPrice = h - 1.5 * prevAtr;
                        inPosition[i] = true;
                        trailingStops[i] = stopPrice;
                        actions[i] = bullDiv[i] ? 'BULLISH DIVERGENCE ENTRY' : 'IMPULSE SQUEEZE TRIGGER';
                        statuses[i] = bullDiv[i]
                            ? `14-bar stochastic divergence confirmed with positive flow impulse (+${fCurr.toFixed(2)})`
                            : `Oversold thrust entry (f_t = +${fCurr.toFixed(2)} >= 1.50) from trough (${(zObv[i - 1] || 0).toFixed(1)})`;
                    } else {
                        actions[i] = 'NEUTRAL / CASH';
                        statuses[i] = 'Structural contango bleed avoidance — 100% capital preserved in cash';
                    }
                }
            }
        }

        return {
            dates,
            closes: Array.from(closes),
            highs: Array.from(highs),
            lows: Array.from(lows),
            volumes: Array.from(volumes),
            turnover: Array.from(turnover),
            baseTurnover: Array.from(baseTurnover),
            rvol: Array.from(rvol),
            volWeight: Array.from(volWeight),
            phi: Array.from(phi),
            impulse: Array.from(impulse),
            volScalarAccel: Array.from(volScalarAccel),
            dvOsc: Array.from(dvOsc),
            dvOscState,
            ewNet21: Array.from(ewNet21),
            ewNetZ: Array.from(ewNetZ),
            acmf: Array.from(acmf),
            acmfRegime,
            er10: Array.from(er10),
            iobv: Array.from(iobv),
            ema5: Array.from(ema5),
            kama14: Array.from(kama14),
            ema34: Array.from(ema34),
            zObv: Array.from(zObv),
            composite: Array.from(composite),
            crossPair: Array.from(crossPair),
            sisterConfirmed,
            bullDiv,
            bearDiv,
            actions,
            statuses,
            inPosition,
            trailingStops,
            side: isShortEtp ? 'short' : 'long',
            regime: isShortEtp ? 'INVERSE_CARRY' : 'LONG_DECAY'
        };
    },

    _getSuiteData(ticker, history, options) {
        if (!this._suiteCache) {
            this._suiteCache = new Map();
        }
        const t = ticker || this.state.ticker || 'BOIL';
        if (!history || !history.length) return null;
        const lastDate = history[history.length - 1] ? (history[history.length - 1].date || '') : '';

        // Determine sister ETF bars
        const etfCfg = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? CONFIG.etfs[t] : null;
        const pairTicker = etfCfg ? etfCfg.pair : null;
        let sisterBars = null;
        if (pairTicker && typeof App !== 'undefined' && App.allMetrics && App.allMetrics[pairTicker]) {
            sisterBars = App.allMetrics[pairTicker].history;
        } else if (pairTicker && typeof window !== 'undefined' && window.allData && window.allData.etfs && window.allData.etfs[pairTicker]) {
            sisterBars = window.allData.etfs[pairTicker].history;
        } else if (options && options.sisterBars) {
            sisterBars = options.sisterBars;
        }

        const sisterLen = sisterBars ? sisterBars.length : 0;
        const cacheKey = `${t}|${history.length}|${lastDate}|${pairTicker || ''}|${sisterLen}`;

        if (this._suiteCache.has(cacheKey)) {
            return this._suiteCache.get(cacheKey);
        }

        const suite = this.computeUpgradedVolumeSuite(history, t, sisterBars);
        if (suite) {
            this._suiteCache.set(cacheKey, suite);
        }
        return suite;
    },

    // Definitive Invariant Price-Volume Trend (IPVT) & Asymmetric Alpha Engine
    computeInvariantPVTEngine(primaryBars, ticker = 'BOIL', sisterBars = null) {
        if (!primaryBars || !primaryBars.length) return null;
        const n = primaryBars.length;
        const dates = new Array(n);
        const opens = new Float64Array(n);
        const highs = new Float64Array(n);
        const lows = new Float64Array(n);
        const closes = new Float64Array(n);
        const volumes = new Float64Array(n);

        for (let i = 0; i < n; i++) {
            const b = primaryBars[i] || {};
            const c = b.close != null ? b.close : 0;
            dates[i] = b.date || '';
            closes[i] = c;
            opens[i] = b.open != null ? b.open : c;
            highs[i] = b.high != null ? b.high : c;
            lows[i] = b.low != null ? b.low : c;
            volumes[i] = b.volume != null ? b.volume : 0;
        }

        const isShortEtp = (ticker === 'KOLD' || ticker === 'HND.TO' || ticker === '3NGS.L' || 
            (typeof CONFIG !== 'undefined' && CONFIG.etfs && CONFIG.etfs[ticker] && CONFIG.etfs[ticker].side === 'short'));

        // 1. Split-invariant typical price P_tilde and notional turnover D_t
        const typPrice = new Float64Array(n);
        const turnover = new Float64Array(n);
        const trueRange = new Float64Array(n);
        const clv = new Float64Array(n);

        for (let i = 0; i < n; i++) {
            const h = highs[i], l = lows[i], c = closes[i];
            const tp = (h + l + 2 * c) * 0.25;
            typPrice[i] = tp;
            turnover[i] = volumes[i] * tp;

            const prevC = i > 0 ? closes[i - 1] : opens[i];
            trueRange[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));

            const range = h - l;
            clv[i] = range > 1e-8 ? ((c - l) - (h - c)) / range : 0;
        }

        // 2. Hybrid return: 0.70 * ln(C/C_-1) + 0.30 * CLV * (TR / P_tilde_-1)
        const hybridRet = new Float64Array(n);
        for (let i = 1; i < n; i++) {
            const cPrev = closes[i - 1];
            const cCurr = closes[i];
            const logRet = (cPrev > 0 && cCurr > 0) ? Math.log(cCurr / cPrev) : 0;
            const pPrev = typPrice[i - 1] > 1e-8 ? typPrice[i - 1] : (cPrev > 0 ? cPrev : 1.0);
            const intradayShock = clv[i] * (trueRange[i] / pPrev);
            hybridRet[i] = 0.70 * logRet + 0.30 * intradayShock;
        }

        // 3. Lagged 21-bar 14.3% trimmed mean turnover and robust RVOL multiple
        const rvol = new Float64Array(n);
        const volWeight = new Float64Array(n);
        const ringD = new Float64Array(21);
        const sortScratch = new Float64Array(21);
        let countD = 0;
        let headD = 0;

        for (let i = 0; i < n; i++) {
            let trimD = 0;
            if (i === 0) {
                trimD = Math.max(turnover[0], 1.0);
            } else {
                if (countD < 7) {
                    let s = 0;
                    for (let k = 0; k < countD; k++) s += ringD[k];
                    trimD = countD > 0 ? (s / countD) : 0;
                } else {
                    for (let k = 0; k < countD; k++) sortScratch[k] = ringD[k];
                    for (let m = 1; m < countD; m++) {
                        const x = sortScratch[m];
                        let j = m - 1;
                        while (j >= 0 && sortScratch[j] > x) {
                            sortScratch[j + 1] = sortScratch[j];
                            j--;
                        }
                        sortScratch[j + 1] = x;
                    }
                    const trimCount = countD >= 21 ? 3 : Math.floor(countD * 0.142857);
                    let s = 0, c = 0;
                    for (let m = trimCount; m < countD - trimCount; m++) {
                        s += sortScratch[m];
                        c++;
                    }
                    trimD = c > 0 ? s / c : sortScratch[Math.floor(countD / 2)];
                }
                if (trimD <= 0) trimD = Math.max(turnover[i], 1.0);
            }
            const rv = Math.max(0.01, Math.min(25.0, turnover[i] / trimD));
            rvol[i] = rv;
            // Concave Kyle-Bouchaud volume weighting: w^V = RVOL^0.55
            volWeight[i] = Math.pow(rv, 0.55);

            if (countD < 21) {
                ringD[countD++] = turnover[i];
            } else {
                ringD[headD] = turnover[i];
                headD = (headD + 1) % 21;
            }
        }

        // 4. Lagged trimmed volatility sigma_trim and normalized flow impulse f_t
        const sigmaTrim = new Float64Array(n);
        const impulse = new Float64Array(n);
        const ringRet = new Float64Array(21);
        let countRet = 0;
        let headRet = 0;

        for (let i = 0; i < n; i++) {
            if (i === 0) {
                sigmaTrim[i] = 0.03;
                impulse[i] = 0;
            } else {
                if (countRet >= 7) {
                    for (let k = 0; k < countRet; k++) sortScratch[k] = ringRet[k];
                    for (let m = 1; m < countRet; m++) {
                        const x = sortScratch[m];
                        let j = m - 1;
                        while (j >= 0 && sortScratch[j] > x) {
                            sortScratch[j + 1] = sortScratch[j];
                            j--;
                        }
                        sortScratch[j + 1] = x;
                    }
                    const trimK = countRet >= 21 ? 3 : Math.floor(countRet * 0.142857);
                    let sum = 0, sumSq = 0, c = 0;
                    for (let k = trimK; k < countRet - trimK; k++) {
                        const r = sortScratch[k];
                        sum += r;
                        sumSq += r * r;
                        c++;
                    }
                    if (c > 1) {
                        const mean = sum / c;
                        const variance = Math.max(0, (sumSq - (sum * sum) / c) / (c - 1));
                        sigmaTrim[i] = Math.max(0.005, Math.sqrt(variance));
                    } else {
                        sigmaTrim[i] = 0.03;
                    }
                } else {
                    sigmaTrim[i] = 0.03;
                }
                // f_t = w^V * (r^eff / sigma^trim)
                impulse[i] = volWeight[i] * (hybridRet[i] / sigmaTrim[i]);
            }
            if (i > 0) {
                if (countRet < 21) {
                    ringRet[countRet++] = hybridRet[i];
                } else {
                    ringRet[headRet] = hybridRet[i];
                    headRet = (headRet + 1) % 21;
                }
            }
        }

        // 5. Cumulative IPVT series
        const ipvt = new Float64Array(n);
        let acc = 0;
        for (let i = 0; i < n; i++) {
            acc += impulse[i];
            ipvt[i] = acc;
        }

        // 6. Dual Zero-Lag EMA (ZLEMA-8, ZLEMA-21)
        const ipvtArr = Array.from(ipvt);
        const zlema8 = this.zlema(ipvtArr, 8, 3);
        const zlema21 = this.zlema(ipvtArr, 21, 10);

        // 7. Kaufman Adaptive Moving Average (KAMA-14) with ER-10
        const kama14 = new Array(n).fill(null);
        const er10 = new Array(n).fill(0);
        let prevKama = ipvt[0];
        kama14[0] = prevKama;

        const diffIpvt = new Float64Array(n);
        for (let i = 1; i < n; i++) diffIpvt[i] = Math.abs(ipvt[i] - ipvt[i - 1]);
        let rollVol10 = 0;
        for (let i = 1; i <= 10 && i < n; i++) rollVol10 += diffIpvt[i];

        for (let i = 1; i < n; i++) {
            if (i < 10) {
                kama14[i] = ipvt[i];
                prevKama = ipvt[i];
                er10[i] = 0;
                continue;
            }
            if (i > 10) {
                rollVol10 += diffIpvt[i] - diffIpvt[i - 10];
            }
            const change = Math.abs(ipvt[i] - ipvt[i - 10]);
            const er = rollVol10 > 1e-8 ? Math.max(0, Math.min(1, change / rollVol10)) : 0;
            er10[i] = er;
            const sc = Math.pow(er * (2 / 3 - 2 / 31) + 2 / 31, 2);
            prevKama = prevKama + sc * (ipvt[i] - prevKama);
            kama14[i] = prevKama;
        }

        // 8. Stationary Bounded Z-Score Oscillator Z_PVT in (-100, +100) via algebraic sigmoid
        const zScore = new Float64Array(n);
        const { means: ipvtMeans, stds: ipvtStds } = this.rollingMeanAndStd(ipvtArr, 21);

        for (let i = 0; i < n; i++) {
            const m = ipvtMeans[i];
            const s = ipvtStds[i];
            if (m != null && s != null && s > 1e-4) {
                const z = (ipvt[i] - m) / s;
                zScore[i] = 100.0 * (z / Math.sqrt(z * z + 2.25));
            } else if (i > 0) {
                zScore[i] = zScore[i - 1] * 0.95;
            } else {
                zScore[i] = 0;
            }
        }

        // 9. 14-bar stochastic divergence detector (Bullish & Bearish)
        const bullishDiv = new Array(n).fill(false);
        const bearishDiv = new Array(n).fill(false);

        for (let i = 14; i < n; i++) {
            let minC = Infinity, minIpvt = Infinity;
            let maxC = -Infinity, maxIpvt = -Infinity;
            for (let j = i - 14; j < i; j++) {
                if (closes[j] < minC) minC = closes[j];
                if (closes[j] > maxC) maxC = closes[j];
                if (ipvt[j] < minIpvt) minIpvt = ipvt[j];
                if (ipvt[j] > maxIpvt) maxIpvt = ipvt[j];
            }
            if (closes[i] <= minC * 1.005 && ipvt[i] > minIpvt && impulse[i] > 0.25) {
                bullishDiv[i] = true;
            }
            if (closes[i] >= maxC * 0.995 && ipvt[i] < maxIpvt && impulse[i] < -0.25) {
                bearishDiv[i] = true;
            }
        }

        // 10. Cross-pair flow coherence checking with sister ETF
        const crossPair = new Float64Array(n);
        const sisterConfirmed = new Array(n).fill('STANDALONE');

        if (sisterBars && sisterBars.length) {
            const sisterEngine = this.computeInvariantPVTEngine(sisterBars, isShortEtp ? 'BOIL' : 'KOLD', null);
            if (sisterEngine && sisterEngine.dates && sisterEngine.zScore) {
                const sisterMap = new Map();
                for (let k = 0; k < sisterEngine.dates.length; k++) {
                    sisterMap.set(sisterEngine.dates[k], sisterEngine.zScore[k]);
                }
                for (let i = 0; i < n; i++) {
                    const d = dates[i];
                    if (sisterMap.has(d)) {
                        const zSister = sisterMap.get(d);
                        crossPair[i] = 0.65 * zScore[i] - 0.35 * zSister;
                        if (isShortEtp) {
                            sisterConfirmed[i] = zSister <= -15 ? 'CONFIRMED' : 'DIVERGENT';
                        } else {
                            sisterConfirmed[i] = (zSister <= -15 || zSister < 0) ? 'CONFIRMED' : 'DIVERGENT';
                        }
                    } else {
                        crossPair[i] = zScore[i];
                        sisterConfirmed[i] = 'STANDALONE';
                    }
                }
            }
        } else {
            for (let i = 0; i < n; i++) {
                crossPair[i] = zScore[i];
                sisterConfirmed[i] = 'STANDALONE';
            }
        }

        // 11. Regime-Asymmetric Execution State Machine
        const atr14 = this.computeATR14(highs, lows, closes);
        const inPosition = new Array(n).fill(false);
        const actions = new Array(n).fill('');
        const statuses = new Array(n).fill('');
        const trailingStops = new Array(n).fill(null);

        let posActive = false;
        let entryIdx = -1;
        let entryPrice = 0;
        let highestPrice = 0;
        let stopPrice = 0;

        for (let i = 0; i < n; i++) {
            if (i < 21) {
                actions[i] = 'WARMUP / INITIALIZING';
                statuses[i] = 'Accumulating baseline turnover and volatility distribution';
                inPosition[i] = false;
                continue;
            }

            const c = closes[i];
            const h = highs[i];
            const l = lows[i];
            const curAtr = atr14[i] || (c * 0.03);
            const zCurr = zScore[i];
            const zFast = zlema8[i] || 0;
            const zSlow = zlema21[i] || 0;
            const fCurr = impulse[i];

            if (isShortEtp) {
                // Short/Inverse ETP State Machine (KOLD, HND.TO, 3NGS.L)
                if (posActive) {
                    highestPrice = Math.max(highestPrice, h);
                    const newStop = highestPrice - 2.5 * curAtr;
                    stopPrice = Math.max(stopPrice, newStop);
                    trailingStops[i] = stopPrice;

                    // 1. Crash Breaker Ejection
                    if (fCurr <= -2.2) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'CRASH BREAKER EJECTION';
                        statuses[i] = `Emergency Day-1 cash exit: violent negative flow shock (f_t = ${fCurr.toFixed(2)} <= -2.2)`;
                    // 2. Trailing Stop Volatility Exit
                    } else if (l <= stopPrice || c <= stopPrice) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'TRAILING STOP EXIT';
                        statuses[i] = `2.5x ATR trailing volatility stop hit at $${stopPrice.toFixed(2)}; profit locked`;
                    // 3. Trend Reversal Exit (ZLEMA bear cross)
                    } else if (zFast < zSlow) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'TREND REVERSAL EXIT';
                        statuses[i] = 'Fast ZLEMA-8 crossed below baseline ZLEMA-21; carry momentum exhausted';
                    // 4. Continue Riding Trend
                    } else {
                        inPosition[i] = true;
                        actions[i] = 'HOLDING SHORT CARRY';
                        statuses[i] = `Structural positive roll yield capture active; 2.5x ATR trailing stop at $${stopPrice.toFixed(2)}`;
                    }
                } else {
                    // Entry Condition: Z_PVT >= +25 AND ZLEMA_8 > ZLEMA_21
                    const entryTrigger = (zCurr >= 25 && zFast > zSlow);
                    if (entryTrigger && fCurr > -1.5) {
                        posActive = true;
                        entryIdx = i;
                        entryPrice = c;
                        highestPrice = h;
                        stopPrice = highestPrice - 2.5 * curAtr;
                        inPosition[i] = true;
                        trailingStops[i] = stopPrice;
                        actions[i] = 'TREND ACCUMULATION';
                        statuses[i] = `Contango harvest entry triggered: Z-score +${zCurr.toFixed(1)} with bullish ZLEMA filter`;
                    } else if (fCurr <= -2.2) {
                        actions[i] = 'CRASH BREAKER ACTIVE';
                        statuses[i] = `Downside flow collapse (f_t = ${fCurr.toFixed(2)}); capital protected in cash`;
                    } else if (zCurr >= 25) {
                        actions[i] = 'ACCUMULATION WATCH';
                        statuses[i] = `Elevated accumulation flow (Z = +${zCurr.toFixed(1)}) awaiting ZLEMA-8 confirmation`;
                    } else {
                        actions[i] = 'NEUTRAL / CASH';
                        statuses[i] = 'Contango drift monitoring; awaiting high-conviction institutional accumulation';
                    }
                }
            } else {
                // Long Leveraged ETP State Machine (BOIL, HNU.TO, 3NGL.L)
                if (posActive) {
                    highestPrice = Math.max(highestPrice, h);
                    const newStop = highestPrice - 1.5 * curAtr;
                    stopPrice = Math.max(stopPrice, newStop);
                    trailingStops[i] = stopPrice;
                    const holdDays = i - entryIdx;

                    // 1. Climax Take-Profit
                    if (zCurr >= 72) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = 'CLIMAX EXHAUSTION EXIT';
                        statuses[i] = `Parabolic climax profit taken: stationary Z-score ${zCurr.toFixed(1)} >= 72`;
                    // 2. Trailing Stop Volatility Exit
                    } else if (l <= stopPrice || c <= stopPrice) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = '1.5x ATR TRAILING STOP EXIT';
                        statuses[i] = `1.5x ATR trailing volatility stop hit at $${stopPrice.toFixed(2)}; exiting before contango collapse`;
                    // 3. Max 7-Day Time Stop
                    } else if (holdDays >= 7) {
                        posActive = false;
                        inPosition[i] = false;
                        actions[i] = '7-DAY MAX HOLD TIME EXIT';
                        statuses[i] = '7-bar maximum holding period reached; exiting to avoid physical contango bleed';
                    // 4. Continue Riding Squeeze
                    } else {
                        inPosition[i] = true;
                        actions[i] = 'HOLDING SQUEEZE';
                        statuses[i] = `Mean-reversion squeeze active (Day ${holdDays + 1}/7); trailing stop at $${stopPrice.toFixed(2)}`;
                    }
                } else {
                    const priorZ = Math.min(zScore[i - 1] || 0, zScore[i - 2] || 0, zScore[i - 3] || 0);
                    const impulseTrigger = (priorZ < -35 && fCurr >= 1.60 && zFast > zSlow);
                    const divTrigger = bullishDiv[i];

                    if (impulseTrigger) {
                        posActive = true;
                        entryIdx = i;
                        entryPrice = c;
                        highestPrice = h;
                        stopPrice = highestPrice - 1.5 * curAtr;
                        inPosition[i] = true;
                        trailingStops[i] = stopPrice;
                        actions[i] = 'IMPULSE SQUEEZE TRIGGER';
                        statuses[i] = `Fast impulse thrust entry (f_t = +${fCurr.toFixed(2)} >= 1.60) from oversold trough (${priorZ.toFixed(1)})`;
                    } else if (divTrigger) {
                        posActive = true;
                        entryIdx = i;
                        entryPrice = c;
                        highestPrice = h;
                        stopPrice = highestPrice - 1.5 * curAtr;
                        inPosition[i] = true;
                        trailingStops[i] = stopPrice;
                        actions[i] = 'BULLISH DIVERGENCE ENTRY';
                        statuses[i] = `14-bar stochastic divergence confirmed: price low with positive flow impulse (+${fCurr.toFixed(2)})`;
                    } else if (fCurr >= 1.60) {
                        actions[i] = 'IMPULSE WATCH';
                        statuses[i] = `High flow impulse detected (+${fCurr.toFixed(2)}) awaiting ZLEMA alignment`;
                    } else if (bullishDiv[i]) {
                        actions[i] = 'BULLISH DIVERGENCE';
                        statuses[i] = 'Stochastic accumulation divergence forming';
                    } else {
                        actions[i] = 'NEUTRAL / CASH';
                        statuses[i] = 'Structural contango bleed avoidance — 100% capital preserved in cash';
                    }
                }
            }
        }

        return {
            dates,
            closes: Array.from(closes),
            highs: Array.from(highs),
            lows: Array.from(lows),
            volumes: Array.from(volumes),
            turnover: Array.from(turnover),
            rvol: Array.from(rvol),
            volWeight: Array.from(volWeight),
            hybridReturn: Array.from(hybridRet),
            sigmaTrim: Array.from(sigmaTrim),
            impulse: Array.from(impulse),
            ipvt: ipvtArr,
            zlema8,
            zlema21,
            kama14,
            er10,
            zScore: Array.from(zScore),
            bullishDiv,
            bearishDiv,
            crossPair: Array.from(crossPair),
            sisterConfirmed,
            actions,
            statuses,
            inPosition,
            trailingStops,
            side: isShortEtp ? 'short' : 'long',
            regime: isShortEtp ? 'INVERSE_CARRY' : 'LONG_DECAY'
        };
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
        if (rangeKey === '1m') days = 30;
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
                Object.entries(actualExtra.extraData).map(([k, v]) => [k, (Array.isArray(v) || ArrayBuffer.isView(v)) ? slice(v) : v])
            ) : {}
        };
    },

    _buildInvariantPVTPayload(history, dates, closes, highs, lows, rawVolumes, dollarVolumes, startIdx, endIdx, extraBase, options) {
        const ticker = (options && options.ticker) || this.state.ticker || 'BOIL';
        const etfCfg = (typeof CONFIG !== 'undefined' && CONFIG.etfs) ? CONFIG.etfs[ticker] : null;
        const pairTicker = etfCfg ? etfCfg.pair : null;

        // Pull sister ETF history from App.allMetrics if available
        let sisterBars = null;
        if (pairTicker && typeof App !== 'undefined' && App.allMetrics && App.allMetrics[pairTicker]) {
            sisterBars = App.allMetrics[pairTicker].history;
        } else if (pairTicker && typeof window !== 'undefined' && window.allData && window.allData.etfs && window.allData.etfs[pairTicker]) {
            sisterBars = window.allData.etfs[pairTicker].history;
        } else if (options && options.sisterBars) {
            sisterBars = options.sisterBars;
        }

        const engine = this.computeInvariantPVTEngine(history, ticker, sisterBars);
        if (!engine) return null;

        // Viewport anchoring for visual display
        const base = (engine.ipvt && engine.ipvt[startIdx] != null) ? engine.ipvt[startIdx] : 0;
        const line = engine.ipvt.map(v => v - base);
        const zl8 = engine.zlema8.map(v => v == null ? null : v - base);
        const zl21 = engine.zlema21.map(v => v == null ? null : v - base);
        const kama = engine.kama14.map(v => v == null ? null : v - base);

        return this._buildPayload(dates, closes, rawVolumes, startIdx, endIdx, {
            ...extraBase,
            bars: null,
            line,
            ma: zl21,
            secondaryLine: zl8,
            zeroCentered: false,
            study: 'pvt',
            extraData: {
                rawIpvt: engine.ipvt,
                zl8,
                zl21,
                kama,
                er10: engine.er10,
                impulse: engine.impulse,
                rvol: engine.rvol,
                volWeight: engine.volWeight,
                hybridReturn: engine.hybridReturn,
                sigmaTrim: engine.sigmaTrim,
                zScore: engine.zScore,
                crossPair: engine.crossPair,
                sisterConfirmed: engine.sisterConfirmed,
                actions: engine.actions,
                statuses: engine.statuses,
                inPosition: engine.inPosition,
                trailingStops: engine.trailingStops,
                bullishDiv: engine.bullishDiv,
                bearishDiv: engine.bearishDiv,
                etfSide: engine.side,
                regime: engine.regime,
                ticker
            }
        });
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
        const suite = (study === 'vol' || study === 'osc' || study === 'net' || study === 'cmf' || study === 'obv')
            ? this._getSuiteData(options.ticker || this.state.ticker, history, options)
            : null;

        if (study === 'vol' && suite) {
            const isDollar = unit === 'dollar';
            const barsData = isDollar ? suite.turnover : suite.rvol;
            const maData = isDollar ? suite.baseTurnover : null;
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: barsData,
                line: null,
                ma: maData,
                zeroCentered: false,
                study: 'vol',
                extraData: {
                    rvol: suite.rvol,
                    phi: suite.phi,
                    impulse: suite.impulse,
                    turnover: suite.turnover,
                    baseTurnover: suite.baseTurnover,
                    volWeight: suite.volWeight
                }
            });
        }

        if (study === 'osc' && suite) {
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: null,
                line: suite.dvOsc,
                secondaryLine: suite.volScalarAccel,
                zeroCentered: true,
                study: 'osc',
                extraData: {
                    dvOsc: suite.dvOsc,
                    volScalarAccel: suite.volScalarAccel,
                    dvOscState: suite.dvOscState
                }
            });
        }

        if (study === 'net' && suite) {
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: suite.impulse,
                line: suite.ewNet21,
                zeroCentered: true,
                study: 'net',
                extraData: {
                    impulse: suite.impulse,
                    ewNet21: suite.ewNet21,
                    ewNetZ: suite.ewNetZ
                }
            });
        }

        if (study === 'cmf' && suite) {
            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: null,
                line: suite.acmf,
                ma: null,
                zeroCentered: true,
                study: 'cmf',
                extraData: {
                    acmf: suite.acmf,
                    acmfRegime: suite.acmfRegime,
                    er10: suite.er10,
                    bullDiv: suite.bullDiv,
                    bearDiv: suite.bearDiv
                }
            });
        }

        if (study === 'obv' && suite) {
            // Viewport anchoring strictly applied to cumulative IOBV & ribbon (Guardrail 1)
            const base = (suite.iobv && suite.iobv[startIdx] != null) ? suite.iobv[startIdx] : 0;
            const line = suite.iobv.map(v => v - base);
            const ema5Line = suite.ema5.map(v => v - base);
            const kama14Line = suite.kama14.map(v => v - base);
            const ema34Line = suite.ema34.map(v => v - base);

            return this._buildPayload(dates, closes, volumes, startIdx, endIdx, {
                ...extraBase,
                bars: null,
                line: line,
                ma: kama14Line,
                secondaryLine: ema5Line,
                zeroCentered: false,
                study: 'obv',
                extraData: {
                    rawIobv: suite.iobv,
                    ema5: ema5Line,
                    kama14: kama14Line,
                    ema34: ema34Line,
                    zObv: suite.zObv,
                    er10: suite.er10,
                    composite: suite.composite,
                    crossPair: suite.crossPair,
                    sisterConfirmed: suite.sisterConfirmed,
                    bullDiv: suite.bullDiv,
                    bearDiv: suite.bearDiv,
                    actions: suite.actions,
                    statuses: suite.statuses,
                    inPosition: suite.inPosition,
                    trailingStops: suite.trailingStops,
                    side: suite.side,
                    regime: suite.regime
                }
            });
        }

        if (study === 'pvt') {
            return this._buildInvariantPVTPayload(history, dates, closes, highs, lows, rawVolumes, dollarVolumes, startIdx, endIdx, extraBase, options);
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
            customEnd: this.state.customRange ? this.state.customRange.endIdx : null,
            ticker: ticker
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
        if (study === 'vol') {
            if (unit === 'dollar') return v => '$' + this.fmtVol(v);
            return v => v.toFixed(1) + '×';
        }
        if (study === 'osc') return v => (v >= 0 ? '+' : '') + v.toFixed(0);
        if (study === 'net') return v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' fl';
        if (study === 'cmf') return v => (v >= 0 ? '+' : '') + v.toFixed(2);
        if (study === 'obv') return v => (v >= 0 ? '+' : '') + v.toFixed(0) + ' fl';
        if (study === 'vpin') return v => (v >= 0 ? '+' : '') + v.toFixed(2);
        if (study === 'illiq' || study === 'esvd' || study === 'vwapz') return v => (v >= 0 ? '+' : '') + v.toFixed(1) + 'σ';
        if (study === 'lmsw') return v => (v >= 0 ? '+' : '') + v.toFixed(2);
        if (study === 'tkvf') return v => (v >= 0 ? '+' : '') + v.toFixed(0);
        if (study === 'pvt') return v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' fl';
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
        if (payload.study === 'obv' && payload.extraData && payload.extraData.ema34) {
            consider(payload.extraData.ema34);
        }
        if (!isFinite(yMin) || !isFinite(yMax)) { this._drawMessage('No data in range'); return; }
        if (bars && !payload.zeroCentered) { yMin = Math.min(0, yMin); }
        if (payload.zeroCentered || (yMin < 0 && yMax > 0)) {
            yMin = Math.min(0, yMin); yMax = Math.max(0, yMax);
        }

        // Bounded normalization and winsorization
        if (payload.study === 'vol') {
            if (payload.unit === 'dollar') {
                // Winsorized dollar mode ceiling
                const vals = bars ? bars.filter(v => v != null && isFinite(v)) : [];
                vals.sort((a, b) => a - b);
                const p98 = vals[Math.floor(vals.length * 0.98)] || (yMax * 0.8);
                yMin = 0;
                yMax = Math.max(yMax * 0.5, p98 * 1.25);
            } else {
                // Winsorized RVOL ceiling (Guardrail 4)
                const vals = bars ? bars.filter(v => v != null && isFinite(v)) : [];
                vals.sort((a, b) => a - b);
                const p98 = vals[Math.floor(vals.length * 0.98)] || 2.0;
                yMin = 0;
                yMax = Math.max(3.5, Math.min(6.0, p98 * 1.25));
            }
        } else if (payload.study === 'osc') {
            yMin = Math.min(-100, yMin);
            yMax = Math.max(100, yMax);
        } else if (payload.study === 'net') {
            const maxAbs = Math.max(Math.abs(yMin), Math.abs(yMax), 1.0);
            yMin = -maxAbs;
            yMax = maxAbs;
        } else if (payload.study === 'cmf') {
            yMin = Math.min(-1.0, yMin);
            yMax = Math.max(1.0, yMax);
        } else if (payload.study === 'vpin') {
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
        if (payload.study !== 'vol') {
            const padY = (yMax - yMin) * 0.05;
            yMin -= padY; yMax += padY;
        }
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

        // Reference Guides
        if (payload.study === 'vol') {
            if (payload.unit !== 'dollar') {
                drawGuide(1.0, 'rgba(255,255,255,0.25)', [3, 3], '1.0× BASELINE');
                drawGuide(2.0, 'rgba(61,184,122,0.40)', [2, 2], '2.0× EXPANSION');
                drawGuide(4.0, 'rgba(212,168,48,0.45)', [2, 2], '4.0× CLIMAX');
            }
        } else if (payload.study === 'osc') {
            drawGuide(20.0, 'rgba(61,184,122,0.35)', [3, 3], '+20 BULL EXPANSION');
            drawGuide(-20.0, 'rgba(192,64,64,0.35)', [3, 3], '-20 BEAR EXPANSION');
        } else if (payload.study === 'cmf') {
            drawGuide(0.08, 'rgba(61,184,122,0.35)', [3, 3], '+0.08 ACCUMULATION');
            drawGuide(-0.08, 'rgba(192,64,64,0.35)', [3, 3], '-0.08 DISTRIBUTION');
        } else if (payload.study === 'vpin') {
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
            const isVolTab = payload.study === 'vol';
            const extra = payload.extraData || {};
            const phiArr = extra.phi || [];

            const fillBar = (v, sign, phiVal, x, bw) => {
                let color;
                if (isVolTab) {
                    const phi_t = phiVal != null ? phiVal : 0;
                    const absPhi = Math.abs(phi_t);
                    const alpha = 0.40 + 0.60 * absPhi;
                    if (phi_t >= 0.15) {
                        color = `rgba(61, 184, 122, ${alpha.toFixed(2)})`; // Bullish green
                    } else if (phi_t <= -0.15) {
                        color = `rgba(192, 64, 64, ${alpha.toFixed(2)})`;   // Bearish red
                    } else {
                        color = `rgba(212, 168, 48, 0.65)`;                 // Neutral amber churn
                    }
                } else if (payload.study === 'esvd') {
                    color = v > 0 ? '#d4a830' : (v < 0 ? '#5090a0' : this.COLORS.flat);
                } else {
                    color = sign > 0 ? this.COLORS.up : sign < 0 ? this.COLORS.down : this.COLORS.flat;
                }
                const isCapped = isVolTab && v > yMax;
                const renderVal = Math.min(v, yMax);
                const yv = clampY(mapY(renderVal));
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.85;
                const hBar = Math.max(1.5, Math.abs(zeroY - yv));
                ctx.fillRect(x, Math.min(yv, zeroY), bw, hBar);
                ctx.globalAlpha = 1;

                // Subtle top-cap marker on bars exceeding maxY (Guardrail 4)
                if (isCapped) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x - 0.5, pad.top, bw + 1, 2.5);
                }
            };

            if (colW < 1) {
                const per = Math.ceil(n / Math.max(1, Math.floor(chartW)));
                const nCols = Math.ceil(n / per);
                const colStep = chartW / nCols;
                const bw = Math.max(1, colStep * 0.7);
                for (let c = 0; c < nCols; c++) {
                    let sum = 0, cnt = 0, dir = 0, sumPhi = 0;
                    const i0 = c * per, i1 = Math.min(n, i0 + per);
                    for (let i = i0; i < i1; i++) {
                        const v = bars[i];
                        if (v == null || !isFinite(v)) continue;
                        sum += v;
                        cnt++;
                        dir += payload.colorSigns ? payload.colorSigns[i] : (v > 0 ? 1 : v < 0 ? -1 : 0);
                        if (phiArr[i] != null) sumPhi += phiArr[i];
                    }
                    if (!cnt) continue;
                    fillBar(sum / cnt, dir > 0 ? 1 : dir < 0 ? -1 : 0, sumPhi / cnt, pad.left + c * colStep + (colStep - bw) / 2, bw);
                }
            } else {
                for (let i = 0; i < n; i++) {
                    const v = bars[i];
                    if (v == null || !isFinite(v)) continue;
                    const sign = payload.colorSigns ? payload.colorSigns[i] : (v > 0 ? 1 : v < 0 ? -1 : 0);
                    const phiVal = phiArr[i];
                    fillBar(v, sign, phiVal, pad.left + i * colW + (colW - barW) / 2, barW);
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
        } else if (line && payload.study === 'pvt') {
            const zl8 = payload.secondaryLine;
            const zl21 = payload.ma;

            // Render Dynamic Soft Ribbon Fill between Fast ZLEMA-8 and Baseline ZLEMA-21
            if (zl8 && zl21) {
                for (let i = 0; i < n - 1; i++) {
                    const v8_1 = zl8[i], v8_2 = zl8[i + 1];
                    const v21_1 = zl21[i], v21_2 = zl21[i + 1];
                    if (v8_1 == null || v8_2 == null || v21_1 == null || v21_2 == null) continue;
                    if (!isFinite(v8_1) || !isFinite(v8_2) || !isFinite(v21_1) || !isFinite(v21_2)) continue;

                    const x1 = getX(i), x2 = getX(i + 1);
                    const y8_1 = clampY(mapY(v8_1)), y8_2 = clampY(mapY(v8_2));
                    const y21_1 = clampY(mapY(v21_1)), y21_2 = clampY(mapY(v21_2));

                    const isBull = (v8_1 + v8_2) >= (v21_1 + v21_2);
                    ctx.fillStyle = isBull ? 'rgba(61, 184, 122, 0.12)' : 'rgba(192, 64, 64, 0.12)';
                    ctx.beginPath();
                    ctx.moveTo(x1, y8_1);
                    ctx.lineTo(x2, y8_2);
                    ctx.lineTo(x2, y21_2);
                    ctx.lineTo(x1, y21_1);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            // Render Baseline ZLEMA-21 (Amber Gold, dashed [3, 3], width 1.3)
            if (zl21) {
                drawPath(zl21, '#d4a830', 1.3, [3, 3]);
            }

            // Render Fast ZLEMA-8 (Emerald Green, width 1.3)
            if (zl8) {
                drawPath(zl8, '#3db87a', 1.3, null);
            }

            // Render Viewport-Anchored IPVT Curve (Cyan, width 1.8)
            drawPath(line, '#38bdf8', 1.8, null);
        } else if (line && payload.study === 'obv') {
            const extra = payload.extraData || {};
            const ema5Arr = extra.ema5 || payload.secondaryLine;
            const kama14Arr = extra.kama14 || payload.ma;
            const ema34Arr = extra.ema34;

            // Ribbon Fill between EMA-5 and KAMA-14 (Guardrail 2)
            if (ema5Arr && kama14Arr) {
                for (let i = 0; i < n - 1; i++) {
                    const v5_1 = ema5Arr[i], v5_2 = ema5Arr[i + 1];
                    const vk_1 = kama14Arr[i], vk_2 = kama14Arr[i + 1];
                    if (v5_1 == null || v5_2 == null || vk_1 == null || vk_2 == null) continue;
                    if (!isFinite(v5_1) || !isFinite(v5_2) || !isFinite(vk_1) || !isFinite(vk_2)) continue;

                    const x1 = getX(i), x2 = getX(i + 1);
                    const y5_1 = clampY(mapY(v5_1)), y5_2 = clampY(mapY(v5_2));
                    const yk_1 = clampY(mapY(vk_1)), yk_2 = clampY(mapY(vk_2));

                    const isBull = (v5_1 + v5_2) >= (vk_1 + vk_2);
                    ctx.fillStyle = isBull ? 'rgba(61, 184, 122, 0.12)' : 'rgba(192, 64, 64, 0.12)';
                    ctx.beginPath();
                    ctx.moveTo(x1, y5_1);
                    ctx.lineTo(x2, y5_2);
                    ctx.lineTo(x2, yk_2);
                    ctx.lineTo(x1, yk_1);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            // Draw EMA34, KAMA14, EMA5, and IOBV Curve
            if (ema34Arr) drawPath(ema34Arr, '#818cf8', 1.1, [2, 2]); // Slow EMA34
            if (kama14Arr) drawPath(kama14Arr, '#d4a830', 1.3, [3, 3]); // Adaptive KAMA14
            if (ema5Arr) drawPath(ema5Arr, '#3db87a', 1.3, null);       // Fast EMA5
            drawPath(line, '#38bdf8', 1.8, null);                       // Viewport IOBV
        } else if (line) {
            const lineColor = payload.study === 'esvd' ? '#e06c75' : (payload.study === 'net' ? '#38bdf8' : this.COLORS.line);
            drawPath(line, lineColor, 1.4, null);
        }

        // Render Secondary Line (e.g. VPIN Unsigned Toxicity Line, Vol Accel)
        if (secondaryLine && payload.study !== 'pvt' && payload.study !== 'obv') {
            drawPath(secondaryLine, '#d4a830', 1.2, [3, 3]);
        }

        // Render Moving Average or Trigger Signal Line
        if (ma && payload.study !== 'pvt' && payload.study !== 'obv') {
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
                    const yv = clampY(mapY(Math.min(v, yMax)));
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
                    ctx.fillStyle = payload.study === 'esvd' ? '#e06c75' : (payload.study === 'pvt' || payload.study === 'obv' || payload.study === 'net' ? '#38bdf8' : this.COLORS.line);
                    ctx.fill();
                }
            }
            if (secondaryLine) {
                const sv = secondaryLine[i];
                if (sv != null && isFinite(sv)) {
                    ctx.beginPath();
                    ctx.arc(x, clampY(mapY(sv)), 3, 0, Math.PI * 2);
                    ctx.fillStyle = (payload.study === 'pvt' || payload.study === 'obv') ? '#3db87a' : '#d4a830';
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
            pvt: 'INVARIANT PVT (IPVT)',
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
                let regimeDesc = '';
                if (vpin >= 0.45 && ofi <= -0.40) {
                    badgeText = 'SELLING CLIMAX (BOTTOM)';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'Extreme panic selling exhaustion into bids — historical capitulation bottom buy zone';
                } else if (vpin >= 0.45 && ofi >= 0.40) {
                    badgeText = 'BUYING CLIMAX (TOP)';
                    badgeColor = '#d4a830';
                    regimeDesc = 'Extreme aggressive buying exhaustion into offers — historical blow-off top risk';
                } else if (ofi >= 0.25) {
                    badgeText = 'INFORMED BUYING';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'Persistent buyer-initiated volume imbalance (institutional accumulation)';
                } else if (ofi <= -0.25) {
                    badgeText = 'INFORMED SELLING';
                    badgeColor = this.COLORS.down;
                    regimeDesc = 'Persistent seller-initiated volume imbalance (institutional distribution)';
                } else if (vpin >= 0.40) {
                    badgeText = 'ELEVATED TOXICITY';
                    badgeColor = '#d4a830';
                    regimeDesc = 'High one-sided adverse selection; market makers may widen spreads';
                } else {
                    badgeText = 'BALANCED FLOW';
                    badgeColor = this.COLORS.label;
                    regimeDesc = 'Routine two-sided volume without directional toxicity';
                }
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">VPIN TOXICITY</span>
                        <span class="vs-tt-val" style="color:${vpin >= 0.40 ? '#d4a830' : 'inherit'};">${(vpin * 100).toFixed(1)}%</span>
                    </div>
                    <div class="vs-tt-subtext">
                        ${regimeDesc}
                    </div>
                `;
            }
        } else if (payload.study === 'illiq') {
            const lai = payload.bars ? payload.bars[i] : null;
            const zIlliq = payload.line ? payload.line[i] : null;
            const zDv = payload.extraData && payload.extraData.zDv ? payload.extraData.zDv[i] : null;
            studyValStr = lai == null ? 'n/a' : (lai >= 0 ? '+' : '') + lai.toFixed(2);
            if (lai != null && zIlliq != null) {
                let regimeDesc = '';
                if (lai >= 2.0 && (zDv == null || zDv >= 1.2)) {
                    badgeText = 'INSTITUTIONAL ABSORPTION WALL';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'High turnover with compressed price impact; passive limit walls absorbing supply';
                } else if (zIlliq >= 1.5 && (zDv == null || zDv < 0)) {
                    badgeText = 'LIQUIDITY VACUUM';
                    badgeColor = '#d4a830';
                    regimeDesc = 'Thin order book; price moving on low turnover due to vacuum in resting liquidity';
                } else if (zIlliq <= -1.0 && (zDv == null || zDv <= -1.0)) {
                    badgeText = 'THIN CONSOLIDATION';
                    badgeColor = this.COLORS.label;
                    regimeDesc = 'Light trading with deep resting liquidity; tight consolidation band';
                } else {
                    badgeText = lai > 0 ? 'NET ABSORPTION' : 'NORMAL LIQUIDITY';
                    badgeColor = lai > 0 ? this.COLORS.up : this.COLORS.label;
                    regimeDesc = lai > 0 ? 'Volume expansion exceeds price impact' : 'Standard order book depth and price impact';
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
                extraRowsHtml += `
                    <div class="vs-tt-subtext">
                        ${regimeDesc}
                    </div>
                `;
            }
        } else if (payload.study === 'esvd') {
            const esvd = payload.bars ? payload.bars[i] : null;
            const zSpread = payload.line ? payload.line[i] : null;
            const spreadAR = payload.extraData && payload.extraData.spreadAR ? payload.extraData.spreadAR[i] : null;
            studyValStr = esvd == null ? 'n/a' : (esvd >= 0 ? '+' : '') + esvd.toFixed(2) + 'σ';
            if (esvd != null && zSpread != null) {
                let regimeDesc = '';
                if (esvd >= 1.5 && zSpread >= 1.0) {
                    badgeText = 'SPREAD STRESS / WITHDRAWAL';
                    badgeColor = this.COLORS.down;
                    regimeDesc = 'Effective bid-ask spread widened sharply while volume lagged; market makers pulling depth';
                } else if (esvd <= -1.5) {
                    badgeText = 'DEEP LIQUIDITY SPONSORSHIP';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'High turnover with tight spreads; active institutional participation';
                } else {
                    badgeText = esvd > 0 ? 'SPREAD SPREADING' : 'BALANCED SPREAD';
                    badgeColor = esvd > 0 ? '#d4a830' : this.COLORS.label;
                    regimeDesc = esvd > 0 ? 'Spread widening moderately relative to volume' : 'Spread and volume dynamically aligned';
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
                    <div class="vs-tt-subtext">
                        ${regimeDesc}
                    </div>
                `;
            }
        } else if (payload.study === 'lmsw') {
            const rho = payload.line ? payload.line[i] : null;
            studyValStr = rho == null ? 'n/a' : (rho >= 0 ? '+' : '') + rho.toFixed(3);
            if (rho != null) {
                let regimeDesc = '';
                if (rho >= 0.25) {
                    badgeText = 'INFORMED CONTINUATION';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'Volume positively predicts returns; institutional momentum trend continuation';
                } else if (rho <= -0.25) {
                    badgeText = 'LIQUIDITY REVERSAL REGIME';
                    badgeColor = this.COLORS.down;
                    regimeDesc = 'Volume negatively predicts returns; liquidity-driven inventory rebalancing and mean reversion';
                } else {
                    badgeText = 'NOISE / NEUTRAL REGIME';
                    badgeColor = this.COLORS.label;
                    regimeDesc = 'Uncorrelated order flow; standard random noise';
                }
                extraRowsHtml += `
                    <div class="vs-tt-subtext">
                        ${regimeDesc}
                    </div>
                `;
            }
        } else if (payload.study === 'vwapz') {
            const vwapZ = payload.line ? payload.line[i] : null;
            const rvwap = payload.extraData && payload.extraData.rvwap ? payload.extraData.rvwap[i] : null;
            const slope = payload.extraData && payload.extraData.slopeVwap ? payload.extraData.slopeVwap[i] : null;
            studyValStr = vwapZ == null ? 'n/a' : (vwapZ >= 0 ? '+' : '') + vwapZ.toFixed(2) + 'σ';
            if (vwapZ != null) {
                let regimeDesc = '';
                if (vwapZ >= 2.0) {
                    badgeText = 'COST-BASIS STRETCH (PEAK)';
                    badgeColor = '#d4a830';
                    regimeDesc = 'Price >2σ above 21-day volume-weighted cost basis; extended premium and exhaustion top risk';
                } else if (vwapZ <= -2.0) {
                    badgeText = 'CAPITULATION STRETCH (TROUGH)';
                    badgeColor = this.COLORS.down;
                    regimeDesc = 'Price >2σ below 21-day volume-weighted cost basis; deep discount and statistical mean reversion buy zone';
                } else if (Math.abs(vwapZ) < 0.50 && slope != null && slope > 0.08) {
                    badgeText = 'INST PULLBACK DEFENSE';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'Institutional defense of rising volume-weighted cost basis; trend pullback support';
                } else {
                    badgeText = 'FAIR VALUE BAND';
                    badgeColor = this.COLORS.label;
                    regimeDesc = 'Price trading inside normal 1σ institutional volume-weighted fair value channel';
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
                extraRowsHtml += `
                    <div class="vs-tt-subtext">
                        ${regimeDesc}
                    </div>
                `;
            }
        } else if (payload.study === 'tkvf') {
            const tkvf = payload.line ? payload.line[i] : null;
            const trig = payload.ma ? payload.ma[i] : null;
            studyValStr = tkvf == null ? 'n/a' : (tkvf >= 0 ? '+' : '') + tkvf.toFixed(1);
            if (tkvf != null && trig != null) {
                let regimeDesc = '';
                if (tkvf > trig && tkvf > 0) {
                    badgeText = 'BULLISH VOLUME FORCE';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'True-range volume force accelerating above 9-day trigger; strong buying persistence';
                } else if (tkvf < trig && tkvf < 0) {
                    badgeText = 'BEARISH VOLUME FORCE';
                    badgeColor = this.COLORS.down;
                    regimeDesc = 'True-range volume force decelerating below 9-day trigger; strong selling persistence';
                } else if (tkvf > trig && tkvf <= 0) {
                    badgeText = 'BULLISH CROSSOVER';
                    badgeColor = this.COLORS.up;
                    regimeDesc = 'Bullish trigger crossover from oversold territory; early volume force rebound';
                } else {
                    badgeText = 'BEARISH CROSSOVER';
                    badgeColor = '#d4a830';
                    regimeDesc = 'Bearish trigger crossover from overbought territory; fading volume force';
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
                extraRowsHtml += `
                    <div class="vs-tt-subtext">
                        ${regimeDesc}
                    </div>
                `;
            }
        } else if (payload.study === 'vol') {
            const extra = payload.extraData || {};
            const rvol = extra.rvol ? extra.rvol[i] : null;
            const phi_t = extra.phi ? extra.phi[i] : null;
            const baseD = extra.baseTurnover ? extra.baseTurnover[i] : null;

            studyValStr = rvol != null ? rvol.toFixed(2) + '×' : 'n/a';
            badgeText = phi_t >= 0.15 ? 'NET ACCUMULATION' : phi_t <= -0.15 ? 'NET DISTRIBUTION' : 'TWO-WAY ABSORPTION';
            badgeColor = phi_t >= 0.15 ? this.COLORS.up : phi_t <= -0.15 ? this.COLORS.down : '#d4a830';

            extraRowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">UNCAPPED RVOL</span>
                    <span class="vs-tt-val" style="color:${rvol >= 2.0 ? this.COLORS.up : 'inherit'};font-weight:700;">${rvol != null ? rvol.toFixed(2) + '×' : 'n/a'}</span>
                </div>
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">FLOW PRESSURE (Φ)</span>
                    <span class="vs-tt-val" style="color:${badgeColor};font-weight:700;">${phi_t != null ? (phi_t >= 0 ? '+' : '') + (phi_t * 100).toFixed(1) + '%' : 'n/a'}</span>
                </div>
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">BASELINE TURNOVER</span>
                    <span class="vs-tt-val">$${this.fmtVol(baseD)}</span>
                </div>
                <div class="vs-tt-subtext">
                    Continuous order-flow pressure combining 55% normalized returns and 45% True-Range Close Location Value (solves gap-down hammer misclassification).
                </div>
            `;
        } else if (payload.study === 'osc') {
            const extra = payload.extraData || {};
            const dv = extra.dvOsc ? extra.dvOsc[i] : null;
            const accel = extra.volScalarAccel ? extra.volScalarAccel[i] : null;
            const state = extra.dvOscState ? extra.dvOscState[i] : 'CHOP';

            studyValStr = dv != null ? (dv >= 0 ? '+' : '') + dv.toFixed(1) : 'n/a';
            badgeText = state.replace('_', ' ');
            badgeColor = state === 'BULL_EXPANSION' ? this.COLORS.up : state === 'BEAR_EXPANSION' ? this.COLORS.down : this.COLORS.label;

            extraRowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">DV-OSC (Z-SCORE)</span>
                    <span class="vs-tt-val" style="color:${badgeColor};font-weight:700;">${studyValStr}</span>
                </div>
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">PARTICIPATION ACCEL</span>
                    <span class="vs-tt-val" style="color:${accel > 0 ? this.COLORS.up : this.COLORS.down};">${accel != null ? (accel >= 0 ? '+' : '') + accel.toFixed(1) + '%' : 'n/a'}</span>
                </div>
                <div class="vs-tt-subtext">
                    Directional Volume Velocity: 5d vs 21d signed flow impulse momentum normalized by trailing 21-day RMS volatility.
                </div>
            `;
        } else if (payload.study === 'net') {
            const extra = payload.extraData || {};
            const impulse = extra.impulse ? extra.impulse[i] : null;
            const zNet = extra.ewNetZ ? extra.ewNetZ[i] : null;
            const ewNet = extra.ewNet21 ? extra.ewNet21[i] : null;

            studyValStr = impulse != null ? (impulse >= 0 ? '+' : '') + impulse.toFixed(2) + ' fl' : 'n/a';
            badgeText = zNet >= 25 ? 'SUSTAINED INFLOW' : zNet <= -25 ? 'SUSTAINED OUTFLOW' : 'BALANCED FLOW';
            badgeColor = zNet >= 25 ? this.COLORS.up : zNet <= -25 ? this.COLORS.down : this.COLORS.label;

            extraRowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">DAY IMPULSE (f_t)</span>
                    <span class="vs-tt-val" style="color:${impulse > 0 ? this.COLORS.up : this.COLORS.down};font-weight:700;">${studyValStr}</span>
                </div>
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">EW-21 NET ACCUM</span>
                    <span class="vs-tt-val">${ewNet != null ? (ewNet >= 0 ? '+' : '') + ewNet.toFixed(1) + ' fl' : 'n/a'}</span>
                </div>
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">STATIONARY Z-SCORE</span>
                    <span class="vs-tt-val" style="color:${badgeColor};">${zNet != null ? (zNet >= 0 ? '+' : '') + zNet.toFixed(1) : 'n/a'}</span>
                </div>
                <div class="vs-tt-subtext">
                    Exponentially decaying accumulation window (alpha = 1/11): zero 21-day rectangular boxcar drop-off jumps.
                </div>
            `;
        } else if (payload.study === 'cmf') {
            const extra = payload.extraData || {};
            const acmfVal = extra.acmf ? extra.acmf[i] : null;
            const er = extra.er10 ? extra.er10[i] : null;
            const bullD = extra.bullDiv ? extra.bullDiv[i] : false;
            const bearD = extra.bearDiv ? extra.bearDiv[i] : false;

            studyValStr = acmfVal != null ? (acmfVal >= 0 ? '+' : '') + acmfVal.toFixed(3) : 'n/a';
            badgeText = bullD ? 'BULLISH DIVERGENCE' : bearD ? 'BEARISH DIVERGENCE' : (acmfVal >= 0.08 ? 'INST ACCUMULATION' : acmfVal <= -0.08 ? 'INST DISTRIBUTION' : 'NEUTRAL DEADBAND');
            badgeColor = bullD ? this.COLORS.up : bearD ? this.COLORS.down : (acmfVal >= 0.08 ? this.COLORS.up : acmfVal <= -0.08 ? this.COLORS.down : this.COLORS.label);

            extraRowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">ACMF-14</span>
                    <span class="vs-tt-val" style="color:${badgeColor};font-weight:700;">${studyValStr}</span>
                </div>
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">EFFICIENCY RATIO</span>
                    <span class="vs-tt-val" style="color:#d4a830;">${er != null ? (er * 100).toFixed(0) + '%' : 'n/a'} <span style="font-size:0.58rem;">(${er >= 0.5 ? 'TRENDING' : 'CHOP'})</span></span>
                </div>
                <div class="vs-tt-subtext">
                    Adaptive True-Range CMF: lookback contracts dynamically from 21 bars down to 4.5 bars during high-efficiency squeezes.
                </div>
            `;
        } else if (payload.study === 'obv') {
            const extra = payload.extraData || {};
            const zObvVal = extra.zObv ? extra.zObv[i] : null;
            const er = extra.er10 ? extra.er10[i] : null;
            const action = extra.actions ? extra.actions[i] : 'NEUTRAL / CASH';
            const trailingStop = extra.trailingStops ? extra.trailingStops[i] : null;

            studyValStr = value != null ? (value >= 0 ? '+' : '') + value.toFixed(1) + ' fl' : 'n/a';
            badgeText = action;
            badgeColor = action.includes('TRIGGER') || action.includes('ENTRY') ? this.COLORS.up : action.includes('EXIT') ? '#f59e0b' : action.includes('CRASH') ? '#ef4444' : this.COLORS.label;

            extraRowsHtml += `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">VIEWPORT IOBV</span>
                    <span class="vs-tt-val" style="color:#38bdf8;font-weight:700;">${studyValStr}</span>
                </div>
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">Z-OBV OSCILLATOR</span>
                    <span class="vs-tt-val" style="color:${zObvVal >= 25 ? this.COLORS.up : zObvVal <= -25 ? this.COLORS.down : 'inherit'};font-weight:700;">${zObvVal != null ? (zObvVal >= 0 ? '+' : '') + zObvVal.toFixed(1) : 'n/a'}</span>
                </div>
                ${trailingStop != null ? `
                <div class="vs-tt-row">
                    <span class="vs-tt-lbl">CAUSAL TRAILING STOP</span>
                    <span class="vs-tt-val" style="color:#f59e0b;font-weight:700;">$${this.fmtPrice(trailingStop)}</span>
                </div>` : ''}
                <div class="vs-tt-subtext">
                    Split-invariant continuous cumulative order flow with adaptive EMA5/KAMA14/EMA34 ribbon. Zero ZLEMA ringing after volume climax spikes.
                </div>
            `;
        } else if (payload.study === 'pvt') {
            const extra = payload.extraData || {};
            const impulse = extra.impulse ? extra.impulse[i] : null;
            const rvol = extra.rvol ? extra.rvol[i] : null;
            const volWeight = extra.volWeight ? extra.volWeight[i] : null;
            const zScore = extra.zScore ? extra.zScore[i] : null;
            const zl8 = extra.zl8 ? extra.zl8[i] : null;
            const zl21 = extra.zl21 ? extra.zl21[i] : null;
            const crossPair = extra.crossPair ? extra.crossPair[i] : null;
            const sisterConf = extra.sisterConfirmed ? extra.sisterConfirmed[i] : null;
            const action = extra.actions ? extra.actions[i] : 'NEUTRAL / CASH';
            const status = extra.statuses ? extra.statuses[i] : '';
            const trailingStop = extra.trailingStops ? extra.trailingStops[i] : null;
            const side = extra.etfSide || 'long';

            studyValStr = value == null ? 'n/a' : (value >= 0 ? '+' : '') + value.toFixed(1) + ' fl';

            badgeText = action;
            if (action.includes('TRIGGER') || action.includes('ENTRY')) {
                badgeColor = this.COLORS.up;
            } else if (action.includes('CRASH BREAKER')) {
                badgeColor = '#ef4444';
            } else if (action.includes('EXIT')) {
                badgeColor = '#f59e0b';
            } else if (action.includes('ACCUMULATION') || action.includes('HOLDING')) {
                badgeColor = '#38bdf8';
            } else {
                badgeColor = this.COLORS.label;
            }

            if (impulse != null) {
                const impColor = impulse >= 1.6 ? this.COLORS.up : (impulse <= -2.2 ? '#ef4444' : (impulse > 0 ? this.COLORS.up : this.COLORS.down));
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">FLOW IMPULSE (f_t)</span>
                        <span class="vs-tt-val" style="color:${impColor};font-weight:700;">${(impulse >= 0 ? '+' : '') + impulse.toFixed(2)} fl</span>
                    </div>
                `;
            }

            if (rvol != null) {
                const rvColor = rvol >= 2.0 ? this.COLORS.up : (rvol >= 1.2 ? '#38bdf8' : 'inherit');
                const vwStr = volWeight != null ? ` (w^V = ${volWeight.toFixed(2)})` : '';
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">RVOL-21 (TRIMMED)</span>
                        <span class="vs-tt-val" style="color:${rvColor};">${rvol.toFixed(2)}×<span style="font-size:0.58rem;opacity:0.8;">${vwStr}</span></span>
                    </div>
                `;
            }

            if (zScore != null) {
                let zZone = 'NEUTRAL';
                let zColor = this.COLORS.label;
                if (zScore >= 72) { zZone = 'CLIMAX EXHAUSTION'; zColor = '#d4a830'; }
                else if (zScore >= 25) { zZone = 'ACCUMULATION'; zColor = this.COLORS.up; }
                else if (zScore <= -25) { zZone = 'DISTRIBUTION'; zColor = this.COLORS.down; }
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">Z-SCORE OSCILLATOR</span>
                        <span class="vs-tt-val" style="color:${zColor};font-weight:700;">${(zScore >= 0 ? '+' : '') + zScore.toFixed(1)} <span style="font-size:0.58rem;">(${zZone})</span></span>
                    </div>
                `;
            }

            if (zl8 != null) {
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">FAST ZLEMA-8</span>
                        <span class="vs-tt-val" style="color:#3db87a;">${(zl8 >= 0 ? '+' : '') + zl8.toFixed(1)} fl</span>
                    </div>
                `;
            }

            if (zl21 != null) {
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">BASELINE ZLEMA-21</span>
                        <span class="vs-tt-val" style="color:#d4a830;">${(zl21 >= 0 ? '+' : '') + zl21.toFixed(1)} fl</span>
                    </div>
                `;
            }

            if (crossPair != null) {
                const confColor = sisterConf === 'CONFIRMED' ? this.COLORS.up : (crossPair < 0 ? this.COLORS.down : '#d4a830');
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">CROSS-PAIR CONF</span>
                        <span class="vs-tt-val" style="color:${confColor};">${(crossPair >= 0 ? '+' : '') + crossPair.toFixed(1)} <span style="font-size:0.58rem;">(${sisterConf || 'ALIGNED'})</span></span>
                    </div>
                `;
            }

            if (trailingStop != null) {
                extraRowsHtml += `
                    <div class="vs-tt-row">
                        <span class="vs-tt-lbl">TRAILING STOP</span>
                        <span class="vs-tt-val" style="color:#f59e0b;font-weight:700;">$${this.fmtPrice(trailingStop)}</span>
                    </div>
                `;
            }

            if (status) {
                extraRowsHtml += `
                    <div class="vs-tt-subtext">
                        <strong>${side === 'short' ? 'INVERSE CARRY REGIME' : 'LONG SQUEEZE REGIME'}:</strong> ${status}
                    </div>
                `;
            }
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

        if (payload.ma && payload.ma[i] != null && payload.study !== 'tkvf' && payload.study !== 'pvt') {
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

        // Adaptive Corner Docking: Always dock in top corner opposite the mouse cursor
        // Leaves mouse cursor, active candle, and indicators 100% unobstructed.
        const PADDING = 12;
        let left;
        if (m.x < twrap * 0.5) {
            // Mouse is on left half -> dock in top-right corner
            left = twrap - tw - PADDING;
        } else {
            // Mouse is on right half -> dock in top-left corner
            left = PADDING;
        }
        let top = PADDING;

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
                if (vpin >= 0.45 && ofi <= -0.40) { flowText = 'PANIC SELLING CLIMAX'; flowColor = this.COLORS.up; }
                else if (vpin >= 0.45 && ofi >= 0.40) { flowText = 'BLOW-OFF BUYING CLIMAX'; flowColor = '#d4a830'; }
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
            const extra = payload.extraData || {};
            const rvol = extra.rvol ? extra.rvol[last] : null;
            const phi_t = extra.phi ? extra.phi[last] : null;
            const rvolColor = rvol >= 2.0 ? this.COLORS.up : rvol >= 1.2 ? '#38bdf8' : 'inherit';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">RVOL-ROB</span> <span style="color:${rvolColor};font-weight:700;">${rvol != null ? rvol.toFixed(2) + '×' : 'n/a'}</span></span>`);
            const flowText = phi_t >= 0.15 ? 'NET ACCUMULATION' : phi_t <= -0.15 ? 'NET DISTRIBUTION' : 'TWO-WAY ABSORPTION';
            const flowColor = phi_t >= 0.15 ? this.COLORS.up : phi_t <= -0.15 ? this.COLORS.down : '#d4a830';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">PRESSURE</span> <span style="color:${flowColor}">${flowText} (${phi_t != null ? (phi_t * 100).toFixed(0) : 0}%)</span></span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">VALUE</span> $${this.fmtVol(dollarVol)}</span>`);
        } else if (study === 'osc') {
            const extra = payload.extraData || {};
            const dv = extra.dvOsc ? extra.dvOsc[last] : null;
            const state = extra.dvOscState ? extra.dvOscState[last] : 'CHOP';
            const stateColor = state === 'BULL_EXPANSION' ? this.COLORS.up : state === 'BEAR_EXPANSION' ? this.COLORS.down : this.COLORS.label;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">DV-OSC</span> <span style="font-weight:700;color:${stateColor}">${dv != null ? (dv >= 0 ? '+' : '') + dv.toFixed(1) : 'n/a'}</span></span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">STATE</span> <span style="color:${stateColor}">${state.replace('_', ' ')}</span></span>`);
        } else if (study === 'net') {
            const extra = payload.extraData || {};
            const impulse = extra.impulse ? extra.impulse[last] : null;
            const zNet = extra.ewNetZ ? extra.ewNetZ[last] : null;
            const zColor = zNet >= 25 ? this.COLORS.up : zNet <= -25 ? this.COLORS.down : this.COLORS.label;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">DAY IMPULSE</span> <span style="font-weight:700;color:${impulse > 0 ? this.COLORS.up : this.COLORS.down}">${impulse != null ? (impulse >= 0 ? '+' : '') + impulse.toFixed(2) + ' fl' : 'n/a'}</span></span>`);
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">EW-21 Z</span> <span style="color:${zColor}">${zNet != null ? (zNet >= 0 ? '+' : '') + zNet.toFixed(1) : 'n/a'}</span></span>`);
        } else if (study === 'cmf') {
            const extra = payload.extraData || {};
            const acmfVal = extra.acmf ? extra.acmf[last] : (payload.line ? payload.line[last] : null);
            const er = extra.er10 ? extra.er10[last] : null;
            const bullD = extra.bullDiv ? extra.bullDiv[last] : false;
            const bearD = extra.bearDiv ? extra.bearDiv[last] : false;
            const cmfColor = acmfVal >= 0.08 ? this.COLORS.up : acmfVal <= -0.08 ? this.COLORS.down : this.COLORS.label;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">ACMF-14</span> <span style="font-weight:700;color:${cmfColor}">${acmfVal != null ? (acmfVal >= 0 ? '+' : '') + acmfVal.toFixed(3) : 'n/a'}</span></span>`);
            let divText = bullD ? 'BULLISH DIVERGENCE' : bearD ? 'BEARISH DIVERGENCE' : null;
            let divColor = bullD ? this.COLORS.up : bearD ? this.COLORS.down : '#d4a830';
            if (!divText) {
                const back = Math.max(0, last - 21);
                const pLast = payload.closes[last];
                const pBack = payload.closes[back];
                const priceDelta = (pLast != null && pBack != null && pBack > 0) ? ((pLast - pBack) / pBack) : 0;
                if (priceDelta < -0.01 && acmfVal > 0) {
                    divText = 'BULLISH DIVERGENCE';
                    divColor = this.COLORS.up;
                } else if (priceDelta > 0.01 && acmfVal < 0) {
                    divText = 'BEARISH DIVERGENCE';
                    divColor = this.COLORS.down;
                } else if (priceDelta > 0.01 && acmfVal > 0) {
                    divText = 'VOLUME CONFIRMED';
                    divColor = this.COLORS.up;
                } else if (priceDelta < -0.01 && acmfVal < 0) {
                    divText = 'DISTRIBUTION CONFIRMED';
                    divColor = this.COLORS.down;
                } else {
                    divText = acmfVal > 0 ? 'ACCUMULATION' : acmfVal < 0 ? 'DISTRIBUTION' : ((er != null && er >= 0.5) ? 'TRENDING FLOW' : 'CHOP');
                    divColor = acmfVal > 0 ? this.COLORS.up : acmfVal < 0 ? this.COLORS.down : '#d4a830';
                }
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">SIGNAL</span> <span style="color:${divColor}">${divText}</span></span>`);
        } else if (study === 'obv') {
            const extra = payload.extraData || {};
            const zObvVal = extra.zObv ? extra.zObv[last] : null;
            const action = extra.actions ? extra.actions[last] : null;
            const trailingStop = extra.trailingStops ? extra.trailingStops[last] : null;
            const zColor = zObvVal >= 25 ? this.COLORS.up : zObvVal <= -25 ? this.COLORS.down : this.COLORS.label;
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">Z-OBV</span> <span style="font-weight:700;color:${zColor}">${zObvVal != null ? (zObvVal >= 0 ? '+' : '') + zObvVal.toFixed(1) : 'n/a'}</span></span>`);
            if (trailingStop != null) {
                parts.push(`<span class="vs-reading-item"><span class="vs-lbl">STOP</span> <span style="color:#f59e0b;font-weight:700;">$${this.fmtPrice(trailingStop)}</span></span>`);
            }
            const bullD = extra.bullDiv ? extra.bullDiv[last] : false;
            const bearD = extra.bearDiv ? extra.bearDiv[last] : false;
            let divText = bullD ? 'BULLISH DIVERGENCE' : bearD ? 'BEARISH DIVERGENCE' : null;
            let divColor = bullD ? this.COLORS.up : bearD ? this.COLORS.down : '#d4a830';
            if (!divText) {
                const back = Math.max(0, last - 21);
                const pLast = payload.closes[last];
                const pBack = payload.closes[back];
                const priceDelta = (pLast != null && pBack != null && pBack > 0) ? ((pLast - pBack) / pBack) : 0;
                const line = payload.line || [];
                const lv = line[last];
                const delta = (lv != null && line[back] != null) ? lv - line[back] : null;
                const sig = delta != null ? delta : (zObvVal != null ? zObvVal : 0);
                if (priceDelta < -0.01 && sig > 0) {
                    divText = 'BULLISH DIVERGENCE';
                    divColor = this.COLORS.up;
                } else if (priceDelta > 0.01 && sig < 0) {
                    divText = 'BEARISH DIVERGENCE';
                    divColor = this.COLORS.down;
                } else if (priceDelta > 0.01 && sig > 0) {
                    divText = 'VOLUME CONFIRMED';
                    divColor = this.COLORS.up;
                } else if (priceDelta < -0.01 && sig < 0) {
                    divText = 'DISTRIBUTION CONFIRMED';
                    divColor = this.COLORS.down;
                }
            }
            if (divText) {
                parts.push(`<span class="vs-reading-item"><span class="vs-lbl">SIGNAL</span> <span style="color:${divColor}">${divText}</span></span>`);
            }
            if (action) {
                let actionBg = 'rgba(255,255,255,0.06)';
                let actionColor = this.COLORS.label;
                let actionBorder = 'rgba(255,255,255,0.15)';
                if (action.includes('TRIGGER') || action.includes('ENTRY')) {
                    actionBg = 'rgba(61, 184, 122, 0.20)';
                    actionColor = this.COLORS.up;
                    actionBorder = 'rgba(61, 184, 122, 0.50)';
                } else if (action.includes('CRASH BREAKER')) {
                    actionBg = 'rgba(239, 68, 68, 0.25)';
                    actionColor = '#ef4444';
                    actionBorder = 'rgba(239, 68, 68, 0.70)';
                } else if (action.includes('EXIT')) {
                    actionBg = 'rgba(245, 158, 11, 0.20)';
                    actionColor = '#f59e0b';
                    actionBorder = 'rgba(245, 158, 11, 0.50)';
                } else if (action.includes('ACCUMULATION') || action.includes('HOLDING')) {
                    actionBg = 'rgba(56, 189, 248, 0.20)';
                    actionColor = '#38bdf8';
                    actionBorder = 'rgba(56, 189, 248, 0.50)';
                }
                parts.push(`<span class="vs-reading-item"><span class="vs-lbl">ACTION</span> <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:0.64rem;font-weight:700;background:${actionBg};color:${actionColor};border:1px solid ${actionBorder};">${action}</span></span>`);
            }
        } else if (study === 'pvt') {
            const extra = payload.extraData || {};
            const side = extra.etfSide || 'long';
            const zScore = extra.zScore ? extra.zScore[last] : null;
            const zl8 = extra.zl8 ? extra.zl8[last] : null;
            const zl21 = extra.zl21 ? extra.zl21[last] : null;
            const crossPair = extra.crossPair ? extra.crossPair[last] : null;
            const sisterConf = extra.sisterConfirmed ? extra.sisterConfirmed[last] : null;
            const action = extra.actions ? extra.actions[last] : 'NEUTRAL / CASH';

            // 1. REGIME
            const regimeLabel = side === 'short' ? 'INVERSE CARRY' : 'LONG SQUEEZE';
            const regimeColor = side === 'short' ? '#38bdf8' : '#e06c75';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">REGIME</span> <span style="color:${regimeColor};font-weight:700;">${regimeLabel}</span></span>`);

            // 2. Z-SCORE
            let zZone = 'NEUTRAL';
            let zColor = this.COLORS.label;
            if (zScore != null) {
                if (zScore >= 72) { zZone = 'CLIMAX'; zColor = '#d4a830'; }
                else if (zScore >= 25) { zZone = 'ACCUMULATION'; zColor = this.COLORS.up; }
                else if (zScore <= -25) { zZone = 'DISTRIBUTION'; zColor = this.COLORS.down; }
            }
            const zStr = zScore != null ? `${zScore >= 0 ? '+' : ''}${zScore.toFixed(1)} (${zZone})` : 'n/a';
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">Z-SCORE</span> <span style="color:${zColor};font-weight:700;">${zStr}</span></span>`);

            // 3. DUAL ZLEMA
            let zlemaStr = 'n/a';
            let zlemaColor = 'inherit';
            if (zl8 != null && zl21 != null) {
                const spread = zl8 - zl21;
                const isBull = spread >= 0;
                zlemaColor = isBull ? this.COLORS.up : this.COLORS.down;
                zlemaStr = `${isBull ? 'BULLISH' : 'BEARISH'} (${spread >= 0 ? '+' : ''}${spread.toFixed(1)})`;
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">DUAL ZLEMA</span> <span style="color:${zlemaColor};">${zlemaStr}</span></span>`);

            // 4. CONFIRMATION
            let confStr = 'n/a';
            let confColor = this.COLORS.label;
            if (crossPair != null) {
                const isAligned = sisterConf === 'CONFIRMED' || (side === 'short' && crossPair >= 25) || (side === 'long' && crossPair >= 20);
                confColor = isAligned ? this.COLORS.up : (crossPair < 0 ? this.COLORS.down : '#d4a830');
                const tag = isAligned ? 'ALIGNED' : (sisterConf || 'DIVERGENT');
                confStr = `${crossPair >= 0 ? '+' : ''}${crossPair.toFixed(1)} · ${tag}`;
            } else {
                confStr = 'STANDALONE';
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">CONFIRMATION</span> <span style="color:${confColor};">${confStr}</span></span>`);

            // 5. ACTION (Pill badge)
            let actionBg = 'rgba(255,255,255,0.06)';
            let actionColor = this.COLORS.label;
            let actionBorder = 'rgba(255,255,255,0.15)';
            if (action.includes('TRIGGER') || action.includes('ENTRY')) {
                actionBg = 'rgba(61, 184, 122, 0.20)';
                actionColor = this.COLORS.up;
                actionBorder = 'rgba(61, 184, 122, 0.50)';
            } else if (action.includes('CRASH BREAKER')) {
                actionBg = 'rgba(239, 68, 68, 0.25)';
                actionColor = '#ef4444';
                actionBorder = 'rgba(239, 68, 68, 0.70)';
            } else if (action.includes('EXIT')) {
                actionBg = 'rgba(245, 158, 11, 0.20)';
                actionColor = '#f59e0b';
                actionBorder = 'rgba(245, 158, 11, 0.50)';
            } else if (action.includes('ACCUMULATION') || action.includes('HOLDING')) {
                actionBg = 'rgba(56, 189, 248, 0.20)';
                actionColor = '#38bdf8';
                actionBorder = 'rgba(56, 189, 248, 0.50)';
            }
            parts.push(`<span class="vs-reading-item"><span class="vs-lbl">ACTION</span> <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:0.64rem;font-weight:700;background:${actionBg};color:${actionColor};border:1px solid ${actionBorder};">${action}</span></span>`);
        }
        el.innerHTML = parts.join('');
    }
};

if (typeof window !== 'undefined') {
    window.VolumeStudies = VolumeStudies;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolumeStudies;
}
