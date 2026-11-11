import fs from 'fs';

const data = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8'));

const EPS = 1e-9;
const WINDOW_LAG = 21;
const TRIM_COUNT = 3;
const KAPPA_PEAK = 1.35;
const KAPPA_VALLEY = 1.60;
const W_LOCAL = 252;
const W_MACRO = 756;
const MIN_CAUSAL_WARMUP = 21;
const MACRO_TOP_PCT = 0.02;
const MIN_HIGHLIGHT_SCORE = {
  PEAKS: 25.0,
  VALLEYS: 22.0
};

function computeTrimmedMean21(buf) {
  const sorted = Array.from(buf).sort((a, b) => a - b);
  let sum = 0.0;
  const start = TRIM_COUNT;
  const end = WINDOW_LAG - TRIM_COUNT;
  for (let i = start; i < end; i++) {
    sum += sorted[i];
  }
  return sum / (end - start);
}

// Compute per-ETF metrics along its trading days
function computeEtfMetrics(history, mode = 'share') {
  const T = history.length;
  const turnover = new Float64Array(T);
  const dollarTurnover = new Float64Array(T);
  const trueRange = new Float64Array(T);
  const typPrice = new Float64Array(T);
  const abdiSpread = new Float64Array(T);

  for (let t = 0; t < T; t++) {
    const b = history[t];
    const h = b.high != null ? b.high : b.close;
    const l = b.low != null ? b.low : b.close;
    const c = b.close;
    const v = b.volume || 0;
    const tp = (h + l + 2.0 * c) * 0.25;
    typPrice[t] = tp;
    dollarTurnover[t] = v * tp;
    turnover[t] = mode === 'dollar' ? v * tp : v;

    const prevClose = t > 0 ? history[t - 1].close : (b.open != null ? b.open : c);
    const trHigh = Math.max(h, prevClose);
    const trLow = Math.min(l, prevClose);
    trueRange[t] = trHigh - trLow;

    if (t > 0) {
      const prevB = history[t - 1];
      const prevH = prevB.high != null ? prevB.high : prevB.close;
      const prevL = prevB.low != null ? prevB.low : prevB.close;
      const prevC = prevB.close;
      const cPrev = Math.log(Math.max(prevC, EPS));
      const etaPrev = 0.5 * (Math.log(Math.max(prevH, EPS)) + Math.log(Math.max(prevL, EPS)));
      const etaCurr = 0.5 * (Math.log(Math.max(h, EPS)) + Math.log(Math.max(l, EPS)));
      const s2 = 4.0 * (cPrev - etaPrev) * (cPrev - etaCurr);
      abdiSpread[t] = s2 > 0.0 ? Math.sqrt(s2) : 0.0;
    }
  }

  const peakScores = new Float64Array(T);
  const valleyScores = new Float64Array(T);
  const rvolArr = new Float64Array(T);
  const trimDollarTurnover = new Float64Array(T);

  const scratchTurnover = new Float64Array(WINDOW_LAG);
  const scratchDollar = new Float64Array(WINDOW_LAG);
  const scratchTR = new Float64Array(WINDOW_LAG);
  const scratchSpread = new Float64Array(WINDOW_LAG);

  for (let t = 0; t < T; t++) {
    if (t < WINDOW_LAG) {
      let sumDollar = 0.0;
      for (let i = 0; i <= t; i++) {
        sumDollar += dollarTurnover[i];
      }
      trimDollarTurnover[t] = sumDollar / (t + 1);
      rvolArr[t] = 1.0;
      continue;
    }

    for (let i = 0; i < WINDOW_LAG; i++) {
      const idx = t - WINDOW_LAG + i;
      scratchTurnover[i] = turnover[idx];
      scratchDollar[i] = dollarTurnover[idx];
      scratchTR[i] = trueRange[idx];
      scratchSpread[i] = abdiSpread[idx];
    }

    const trimMeanD = computeTrimmedMean21(scratchTurnover);
    const trimMeanDollar = computeTrimmedMean21(scratchDollar);
    const trimMeanTR = computeTrimmedMean21(scratchTR);
    const trimMeanSpread = computeTrimmedMean21(scratchSpread);

    trimDollarTurnover[t] = trimMeanDollar;
    if (trimMeanD <= 0.0 || turnover[t] <= 0.0) {
      rvolArr[t] = trimMeanD > 0.0 ? 0.0 : 1.0;
      peakScores[t] = 0.0;
      valleyScores[t] = 0.0;
      continue;
    }

    const rvol = turnover[t] / (trimMeanD + EPS);
    rvolArr[t] = rvol;

    let maxH22 = -Infinity;
    let minL22 = Infinity;
    for (let j = t - WINDOW_LAG; j <= t; j++) {
      const barH = history[j].high != null ? history[j].high : history[j].close;
      const barL = history[j].low != null ? history[j].low : history[j].close;
      if (barH > maxH22) maxH22 = barH;
      if (barL < minL22) minL22 = barL;
    }

    // 1. Peak (Capitulation Climax) Intensity
    const curL = history[t].low != null ? history[t].low : history[t].close;
    const curC = history[t].close;
    const volElasticity = Math.pow(1.0 + rvol, 0.55) - 1.0;
    const rangePos = Math.min(1.0, Math.max(0.0, (maxH22 - curC) / (maxH22 - minL22 + EPS)));
    const rawDownShock = Math.max(0.0, typPrice[t - 1] - curL) / (trimMeanTR + EPS);
    const shockTerm = Math.tanh(0.35 * rawDownShock);

    const isNewLow = curL <= minL22 + EPS ? 1.0 : 0.0;
    const lowerWickRatio = Math.min(1.0, Math.max(0.0, (curC - curL) / (trueRange[t] + EPS)));
    const absorptionMult = 1.0 + 0.20 * lowerWickRatio * isNewLow;

    const priceDrawdownFactor = (0.70 * Math.pow(rangePos, 1.25) + 0.30 * shockTerm) * absorptionMult;
    const peakIntensity = volElasticity * priceDrawdownFactor;
    peakScores[t] = (100.0 * peakIntensity) / Math.sqrt(peakIntensity * peakIntensity + KAPPA_PEAK * KAPPA_PEAK);

    // 2. Valley (Liquidity Drought) Intensity
    const rDrought = trimMeanD / (turnover[t] + EPS);
    const droughtBase = Math.max(0.0, Math.pow(rDrought, 0.60) - 0.85);
    const rangeComp = Math.exp(-trueRange[t] / (2.0 * trimMeanTR + EPS));
    const rawSpreadRatio = abdiSpread[t] / (trimMeanSpread + EPS);
    const spreadMult = Math.min(2.0, Math.max(0.75, rawSpreadRatio));

    const valleyIntensity = droughtBase * rangeComp * spreadMult;
    valleyScores[t] = (100.0 * valleyIntensity) / Math.sqrt(valleyIntensity * valleyIntensity + KAPPA_VALLEY * KAPPA_VALLEY);
  }

  return {
    peakScores,
    valleyScores,
    rvolArr,
    trimDollarTurnover
  };
}

function isStrictlyHigherCausal(cand, candIdx, cur, curIdx, regime) {
  const cScore = regime === 'PEAKS' ? cand.peakScore : cand.valleyScore;
  const rScore = regime === 'PEAKS' ? cur.peakScore : cur.valleyScore;
  if (cScore > rScore + 1e-12) return true;
  if (cScore < rScore - 1e-12) return false;
  if (regime === 'PEAKS') {
    if (cand.maxRvol > cur.maxRvol + 1e-12) return true;
    if (cand.maxRvol < cur.maxRvol - 1e-12) return false;
  } else {
    if (cand.minRvol < cur.minRvol - 1e-12) return true;
    if (cand.minRvol > cur.minRvol + 1e-12) return false;
  }
  return candIdx > curIdx;
}

// Assemble pre-warmed composite session series across active ETF set + Stage 2a/2b causal evaluation
function computeCompositeSeries(etfsData, activeTickers, mode = 'share') {
  const etfMetrics = {};
  const indexMaps = {};
  let longestDates = [];
  let displayStartDate = null;
  const maxBars = 756 + W_MACRO + WINDOW_LAG; // 1533

  for (const t of activeTickers) {
    const rawHist = etfsData[t].history || [];
    const hm = rawHist.slice(-756);
    const hist = rawHist.length > maxBars ? rawHist.slice(-maxBars) : rawHist;
    etfMetrics[t] = computeEtfMetrics(hist, mode);
    const map = new Map();
    const dates = [];
    for (let i = 0; i < hist.length; i++) {
      map.set(hist[i].date, i);
      dates.push(hist[i].date);
    }
    indexMaps[t] = map;
    if (dates.length > longestDates.length) {
      longestDates = dates;
    }
    if (hm.length > WINDOW_LAG && hm[WINDOW_LAG].date) {
      if (!displayStartDate || hm[WINDOW_LAG].date < displayStartDate) {
        displayStartDate = hm[WINDOW_LAG].date;
      }
    }
  }

  const T = longestDates.length;
  const LAMBDA = 0.75;
  const fullRecords = [];

  for (let t = 0; t < T; t++) {
    const date = longestDates[t];
    let maxPeak = 0.0;
    let maxValley = 0.0;
    let maxRvol = 0.0;
    let minRvol = Infinity;
    let weightedPeakSum = 0.0;
    let weightedValleySum = 0.0;
    let weightSum = 0.0;
    let activeCount = 0;

    for (const ticker of activeTickers) {
      const idx = indexMaps[ticker].get(date);
      if (idx === undefined || idx < WINDOW_LAG) continue;

      const m = etfMetrics[ticker];
      const pScore = m.peakScores[idx];
      const vScore = m.valleyScores[idx];
      const rv = m.rvolArr[idx];
      const w = Math.sqrt(Math.max(0.0, m.trimDollarTurnover[idx]));

      if (pScore > maxPeak) maxPeak = pScore;
      if (vScore > maxValley) maxValley = vScore;
      if (rv > maxRvol) maxRvol = rv;
      if (rv < minRvol) minRvol = rv;

      weightedPeakSum += w * pScore;
      weightedValleySum += w * vScore;
      weightSum += w;
      activeCount++;
    }

    if (activeCount === 0) continue;

    const meanPeak = weightSum > 0.0 ? weightedPeakSum / weightSum : maxPeak;
    const meanValley = weightSum > 0.0 ? weightedValleySum / weightSum : maxValley;

    const compPeak = LAMBDA * maxPeak + (1.0 - LAMBDA) * meanPeak;
    const compValley = LAMBDA * maxValley + (1.0 - LAMBDA) * meanValley;

    const safeMinRvol = Number.isFinite(minRvol) ? minRvol : maxRvol;
    const tieKeyPeak = compPeak + 1e-7 * maxRvol + 1e-11 * t;
    const tieKeyValley = compValley + 1e-7 * (1.0 / Math.max(safeMinRvol, 1e-3)) + 1e-11 * t;

    fullRecords.push({
      index: t,
      date,
      peakScore: compPeak,
      valleyScore: compValley,
      maxRvol,
      minRvol: safeMinRvol,
      compositeTieKeyPeak: tieKeyPeak,
      compositeTieKeyValley: tieKeyValley
    });
  }

  const evaluateRegimeAt = (i, regime) => {
    const cur = fullRecords[i];
    const score = regime === 'PEAKS' ? cur.peakScore : cur.valleyScore;
    const wStart = Math.max(0, i - (W_LOCAL - 1));
    const nEff = i - wStart + 1;
    let rank = 1;
    for (let j = wStart; j < i; j++) {
      if (isStrictlyHigherCausal(fullRecords[j], j, cur, i, regime)) rank++;
    }

    const mStart = Math.max(0, i - (W_MACRO - 1));
    const nMacro = i - mStart + 1;
    const macroCutoff = Math.max(1, Math.floor(MACRO_TOP_PCT * nMacro));
    let macroRank = 1;
    for (let j = mStart; j < i; j++) {
      if (isStrictlyHigherCausal(fullRecords[j], j, cur, i, regime)) macroRank++;
    }

    const pctTop = Math.min(100, Math.max(1, Math.ceil((rank * 100) / nEff - 1e-9)));

    let visualTier = 'NONE';
    let isStructuralClimax = false;
    let dimReason = null;

    if (nEff < MIN_CAUSAL_WARMUP) {
      dimReason = 'WARMUP';
    } else {
      const k99 = Math.max(1, Math.floor(0.01 * nEff));
      const k95 = Math.max(k99 + 1, Math.floor(0.05 * nEff));
      const k90 = Math.max(k95 + 1, Math.floor(0.10 * nEff));

      if (rank <= k90 && score < MIN_HIGHLIGHT_SCORE[regime]) {
        dimReason = 'NOISE_FLOOR';
      } else if (rank <= k99) {
        visualTier = 'RED_P99';
        isStructuralClimax = macroRank <= macroCutoff;
      } else if (rank <= k95) {
        visualTier = 'ORANGE_P95';
        isStructuralClimax = macroRank <= macroCutoff;
      } else if (rank <= k90) {
        visualTier = 'AMBER_P90';
        isStructuralClimax = macroRank <= macroCutoff;
      } else {
        dimReason = 'CUTOFF';
      }
    }

    return { rank, nEff, nMacro, macroRank, macroCutoff, pctTop, visualTier, isStructuralClimax, dimReason };
  };

  const displayRecords = [];
  for (let i = 0; i < fullRecords.length; i++) {
    const rec = fullRecords[i];
    rec.causal = {
      PEAKS: evaluateRegimeAt(i, 'PEAKS'),
      VALLEYS: evaluateRegimeAt(i, 'VALLEYS')
    };
    if (!displayStartDate || rec.date >= displayStartDate) {
      displayRecords.push(rec);
    }
  }

  return displayRecords;
}

// Stage 2: Causal spotlight evaluation
function evaluateViewportSpotlight(visibleSlice, mode, activeFilter) {
  const N = visibleSlice.length;
  if (N === 0) return { output: [] };

  const output = new Array(N);
  for (let i = 0; i < N; i++) {
    const rec = visibleSlice[i];
    const score = mode === 'PEAKS' ? rec.peakScore : rec.valleyScore;
    const c = rec.causal[mode];

    let isHighlighted = true;
    if (activeFilter === 'P99') {
      isHighlighted = c.visualTier === 'RED_P99';
    } else if (activeFilter === 'P95') {
      isHighlighted = c.visualTier === 'RED_P99' || c.visualTier === 'ORANGE_P95';
    } else if (activeFilter === 'P90') {
      isHighlighted = c.visualTier !== 'NONE';
    }

    output[i] = {
      date: rec.date,
      score,
      maxRvol: rec.maxRvol,
      rank: c.rank,
      nEff: c.nEff,
      pctTop: c.pctTop,
      windowRank: c.rank,
      visualTier: c.visualTier,
      isHighlighted,
      isStructuralClimax: c.isStructuralClimax,
      dimReason: isHighlighted ? null : (c.dimReason || 'CUTOFF'),
      baselineQuantileBin: Math.min(4, Math.floor(((c.nEff - c.rank) / c.nEff) * 5))
    };
  }

  return { output };
}

// Test harness across all 828 combinations (2 modes x 9 subjects x 2 regimes x 4 horizons x all offsets)
const modes = ['share', 'dollar'];
const regimeModes = ['PEAKS', 'VALLEYS'];
const daysList = [90, 126, 180, 252];
const sideConfigs = {
  all: ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L'],
  long: ['BOIL', 'HNU.TO', '3NGL.L'],
  short: ['KOLD', 'HND.TO', '3NGS.L'],
  BOIL: ['BOIL'],
  'HNU.TO': ['HNU.TO'],
  '3NGL.L': ['3NGL.L'],
  KOLD: ['KOLD'],
  'HND.TO': ['HND.TO'],
  '3NGS.L': ['3NGS.L']
};

let totalTests = 0;
let passedTests = 0;
let boundaryLeaks = 0;
let nanCount = 0;
let errors = [];

for (const m of modes) {
  for (const [sideName, tickers] of Object.entries(sideConfigs)) {
    const series = computeCompositeSeries(data.etfs, tickers, m);
    for (const r of series) {
      if (!Number.isFinite(r.peakScore) || !Number.isFinite(r.valleyScore)) nanCount++;
      for (const rm of regimeModes) {
        const c = r.causal[rm];
        if (c.nEff >= 100 && c.dimReason !== 'NOISE_FLOOR') {
          if ((c.pctTop <= 1) !== (c.visualTier === 'RED_P99')) boundaryLeaks++;
          if ((c.pctTop <= 5) !== (c.visualTier === 'RED_P99' || c.visualTier === 'ORANGE_P95')) boundaryLeaks++;
          if ((c.pctTop <= 10) !== (c.visualTier !== 'NONE')) boundaryLeaks++;
        }
      }
    }
    for (const rm of regimeModes) {
      for (const days of daysList) {
        const maxOffset = Math.max(0, Math.floor((series.length - 1) / days));
        for (let offset = 0; offset <= maxOffset; offset++) {
          const startIdx = Math.max(0, series.length - (offset + 1) * days);
          const endIdx = series.length - offset * days;
          const visibleSlice = series.slice(startIdx, endIdx);
          if (visibleSlice.length === 0) continue;

          // Check weak monotonicity for P90, P95, P99
          const res99 = evaluateViewportSpotlight(visibleSlice, rm, 'P99');
          const res95 = evaluateViewportSpotlight(visibleSlice, rm, 'P95');
          const res90 = evaluateViewportSpotlight(visibleSlice, rm, 'P90');

          const count99 = res99.output.filter(c => c.isHighlighted).length;
          const count95 = res95.output.filter(c => c.isHighlighted).length;
          const count90 = res90.output.filter(c => c.isHighlighted).length;

          totalTests++;
          const isMonotonic = (count90 >= count95) && (count95 >= count99) && (count99 >= 0);
          if (isMonotonic) {
            passedTests++;
          } else {
            errors.push({
              mode: m,
              side: sideName,
              regime: rm,
              days,
              offset,
              count99,
              count95,
              count90
            });
          }
        }
      }
    }
  }
}

console.log(`Total test combinations: ${totalTests}`);
console.log(`Passed weak monotonicity (Count(P90) >= Count(P95) >= Count(P99) >= 0): ${passedTests}`);
console.log(`Boundary leaks (nEff >= 100): ${boundaryLeaks}`);
console.log(`NaN / non-finite scores: ${nanCount}`);

if (totalTests !== 828 || passedTests !== 828 || boundaryLeaks !== 0 || nanCount !== 0 || errors.length > 0) {
  console.error('Failures:', errors.slice(0, 5));
  process.exit(1);
}

// Causal prefix invariance check (500x vol / 0.005x price shock after 2025-06-30)
const cutoffDate = '2025-06-30';
const shockedEtfs = {};
for (const [tk, val] of Object.entries(data.etfs)) {
  shockedEtfs[tk] = {
    history: val.history.map(b => b.date > cutoffDate
      ? { ...b, open: b.open * 0.005, high: b.high * 0.005, low: b.low * 0.005, close: b.close * 0.005, volume: b.volume * 500 }
      : b)
  };
}
let prefixDiffs = 0;
for (const m of modes) {
  for (const [sideName, tickers] of Object.entries(sideConfigs)) {
    const basePre = computeCompositeSeries(data.etfs, tickers, m).filter(r => r.date <= cutoffDate);
    const shockPre = computeCompositeSeries(shockedEtfs, tickers, m).filter(r => r.date <= cutoffDate);
    if (basePre.length !== shockPre.length) {
      prefixDiffs++;
      continue;
    }
    for (let i = 0; i < basePre.length; i++) {
      const b = basePre[i];
      const s = shockPre[i];
      if (b.date !== s.date || Math.abs(b.peakScore - s.peakScore) > 1e-12 || Math.abs(b.valleyScore - s.valleyScore) > 1e-12) {
        prefixDiffs++;
      }
      for (const rm of regimeModes) {
        const bc = b.causal[rm];
        const sc = s.causal[rm];
        if (bc.rank !== sc.rank || bc.visualTier !== sc.visualTier || bc.isStructuralClimax !== sc.isStructuralClimax) {
          prefixDiffs++;
        }
      }
    }
  }
}
console.log(`Causal prefix invariance diffs (> ${cutoffDate} shocked): ${prefixDiffs}`);
if (prefixDiffs !== 0) process.exit(1);
console.log('ALL 828 PAGES, BOUNDARY PARITY, ZERO-NaN & CAUSAL PREFIX INVARIANCE PASSED!');

// Print sample inspection for 90-day and 252-day windows on Short ETFs
const sampleShort = computeCompositeSeries(data.etfs, sideConfigs.short, 'share');
for (const win of [90, 252]) {
  const sampleSlice = sampleShort.slice(-win);
  console.log(`\n--- SAMPLE ${win}D SHORT PEAKS INSPECTION ---`);
  for (const filt of ['P99', 'P95', 'P90']) {
    const res = evaluateViewportSpotlight(sampleSlice, 'PEAKS', filt);
    const highlighted = res.output.filter(c => c.isHighlighted);
    const macroCount = highlighted.filter(c => c.isStructuralClimax).length;
    console.log(`  ${filt}: ${highlighted.length} PEAKS (${macroCount} Macro)`);
  }
}
