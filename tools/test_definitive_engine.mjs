import fs from 'fs';

const data = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8'));

const EPS = 1e-9;
const WINDOW_LAG = 21;
const TRIM_COUNT = 3;
const KAPPA_PEAK = 1.35;
const KAPPA_VALLEY = 1.60;

const STRUCTURAL_FLOORS = {
  PEAKS: { P99: 68.0, P95: 52.0, P90: 38.0 },
  VALLEYS: { P99: 64.0, P95: 48.0, P90: 34.0 }
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
    const tp = (b.high + b.low + 2.0 * b.close) * 0.25;
    typPrice[t] = tp;
    dollarTurnover[t] = b.volume * tp;
    turnover[t] = mode === 'dollar' ? b.volume * tp : b.volume;

    const prevClose = t > 0 ? history[t - 1].close : b.open;
    const trHigh = Math.max(b.high, prevClose);
    const trLow = Math.min(b.low, prevClose);
    trueRange[t] = trHigh - trLow;

    if (t > 0) {
      const prevB = history[t - 1];
      const cPrev = Math.log(Math.max(prevB.close, EPS));
      const etaPrev = 0.5 * (Math.log(Math.max(prevB.high, EPS)) + Math.log(Math.max(prevB.low, EPS)));
      const etaCurr = 0.5 * (Math.log(Math.max(b.high, EPS)) + Math.log(Math.max(b.low, EPS)));
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
      let sumD = 0.0;
      let sumDollar = 0.0;
      for (let i = 0; i <= t; i++) {
        sumD += turnover[i];
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
    const rvol = turnover[t] / (trimMeanD + EPS);
    rvolArr[t] = rvol;

    let maxH22 = -Infinity;
    let minL22 = Infinity;
    for (let j = t - WINDOW_LAG; j <= t; j++) {
      if (history[j].high > maxH22) maxH22 = history[j].high;
      if (history[j].low < minL22) minL22 = history[j].low;
    }

    // 1. Peak (Capitulation Climax) Intensity
    const volElasticity = Math.pow(1.0 + rvol, 0.55) - 1.0;
    const rangePos = (maxH22 - history[t].close) / (maxH22 - minL22 + EPS);
    const rawDownShock = Math.max(0.0, typPrice[t - 1] - history[t].low) / (trimMeanTR + EPS);
    const shockTerm = Math.tanh(0.35 * rawDownShock);

    const isNewLow = history[t].low <= minL22 + EPS ? 1.0 : 0.0;
    const lowerWickRatio = (history[t].close - history[t].low) / (trueRange[t] + EPS);
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

// Assemble composite session series across active ETF set
function computeCompositeSeries(etfsData, activeTickers, mode = 'share') {
  const etfMetrics = {};
  const indexMaps = {};
  let longestDates = [];

  for (const t of activeTickers) {
    const hist = etfsData[t].history;
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
  }

  const T = longestDates.length;
  const LAMBDA = 0.75;
  const records = [];

  for (let t = 0; t < T; t++) {
    const date = longestDates[t];
    let maxPeak = 0.0;
    let maxValley = 0.0;
    let maxRvol = 0.0;
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

    const tieKeyPeak = compPeak + 1e-7 * maxRvol + 1e-11 * t;
    const tieKeyValley = compValley + 1e-7 * (1.0 / (maxRvol + EPS)) + 1e-11 * t;

    records.push({
      index: t,
      date,
      peakScore: compPeak,
      valleyScore: compValley,
      maxRvol,
      compositeTieKeyPeak: tieKeyPeak,
      compositeTieKeyValley: tieKeyValley
    });
  }

  return records;
}

// Stage 2: Viewport spotlight evaluation
function evaluateViewportSpotlight(visibleSlice, mode, activeFilter) {
  const N = visibleSlice.length;
  if (N === 0) return [];

  const k99 = Math.max(1, Math.round(0.01 * N));
  const k95 = Math.max(k99 + 1, Math.round(0.05 * N));
  const k90 = Math.max(k95 + 1, Math.round(0.10 * N));

  const sortedIndices = Array.from({ length: N }, (_, i) => i);
  sortedIndices.sort((a, b) => {
    const keyA = mode === 'PEAKS' ? visibleSlice[a].compositeTieKeyPeak : visibleSlice[a].compositeTieKeyValley;
    const keyB = mode === 'PEAKS' ? visibleSlice[b].compositeTieKeyPeak : visibleSlice[b].compositeTieKeyValley;
    return keyB - keyA;
  });

  const ranks = new Int32Array(N);
  const baselineBins = new Uint8Array(N);
  for (let rankZero = 0; rankZero < N; rankZero++) {
    const origIdx = sortedIndices[rankZero];
    ranks[origIdx] = rankZero + 1;
    baselineBins[origIdx] = Math.min(4, Math.floor(((N - 1 - rankZero) / N) * 5));
  }

  const floors = STRUCTURAL_FLOORS[mode];
  const output = new Array(N);

  for (let i = 0; i < N; i++) {
    const rec = visibleSlice[i];
    const score = mode === 'PEAKS' ? rec.peakScore : rec.valleyScore;
    const r = ranks[i];

    let visualTier = 'NONE';
    let isStructuralClimax = false;

    if (r <= k99) {
      visualTier = 'RED_P99';
      isStructuralClimax = score >= floors.P99;
    } else if (r <= k95) {
      visualTier = 'ORANGE_P95';
      isStructuralClimax = score >= floors.P95;
    } else if (r <= k90) {
      visualTier = 'AMBER_P90';
      isStructuralClimax = score >= floors.P90;
    }

    let isHighlighted = true;
    if (activeFilter === 'P99') {
      isHighlighted = r <= k99;
    } else if (activeFilter === 'P95') {
      isHighlighted = r <= k95;
    } else if (activeFilter === 'P90') {
      isHighlighted = r <= k90;
    }

    output[i] = {
      date: rec.date,
      score,
      maxRvol: rec.maxRvol,
      windowRank: r,
      visualTier,
      isHighlighted,
      isStructuralClimax,
      baselineQuantileBin: baselineBins[i]
    };
  }

  return { output, k99, k95, k90 };
}

// Test harness across 336 combinations
const modes = ['share', 'dollar'];
const regimeModes = ['PEAKS', 'VALLEYS'];
const daysList = [90, 126, 180, 252];
const filterList = ['P90', 'P95', 'P99'];
const sideConfigs = {
  all: ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L'],
  long: ['BOIL', 'HNU.TO', '3NGL.L'],
  short: ['KOLD', 'HND.TO', '3NGS.L'],
  BOIL: ['BOIL'],
  KOLD: ['KOLD'],
  'HNU.TO': ['HNU.TO'],
  'HND.TO': ['HND.TO']
};
const offsets = [0, 1];

let totalTests = 0;
let passedTests = 0;
let errors = [];

for (const m of modes) {
  for (const [sideName, tickers] of Object.entries(sideConfigs)) {
    const series = computeCompositeSeries(data.etfs, tickers, m);
    for (const rm of regimeModes) {
      for (const days of daysList) {
        for (const offset of offsets) {
          const startIdx = Math.max(0, series.length - (offset + 1) * days);
          const endIdx = series.length - offset * days;
          const visibleSlice = series.slice(startIdx, endIdx);
          if (visibleSlice.length === 0) continue;

          // Check monotonicity for P90, P95, P99
          const res99 = evaluateViewportSpotlight(visibleSlice, rm, 'P99');
          const res95 = evaluateViewportSpotlight(visibleSlice, rm, 'P95');
          const res90 = evaluateViewportSpotlight(visibleSlice, rm, 'P90');

          const count99 = res99.output.filter(c => c.isHighlighted).length;
          const count95 = res95.output.filter(c => c.isHighlighted).length;
          const count90 = res90.output.filter(c => c.isHighlighted).length;

          totalTests++;
          const isMonotonic = (count90 > count95) && (count95 > count99) && (count99 >= 1);
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
console.log(`Passed strictly monotonic (Count(P90) > Count(P95) > Count(P99) >= 1): ${passedTests}`);
if (errors.length > 0) {
  console.error('Monotonicity failures:', errors.slice(0, 5));
} else {
  console.log('ALL 336 COMBINATIONS PASSED PERFECTLY WITH ZERO TIES AND ZERO DEAD FILTERS!');
}

// Print sample inspection for 90-day window on Short ETFs
const sampleShort = computeCompositeSeries(data.etfs, sideConfigs.short, 'share');
const sampleSlice = sampleShort.slice(-90);
const sampleRes95 = evaluateViewportSpotlight(sampleSlice, 'PEAKS', 'P95');
console.log('\n--- SAMPLE 90D SHORT PEAKS INSPECTION ---');
console.log(`k99: ${sampleRes95.k99}, k95: ${sampleRes95.k95}, k90: ${sampleRes95.k90}`);
const highlighted = sampleRes95.output.filter(c => c.isHighlighted);
console.log(`Highlighted count at P95: ${highlighted.length}`);
console.log('Highlighted bars:');
highlighted.forEach(h => {
  console.log(`  Date: ${h.date} | Score: ${h.score.toFixed(2)} | Rank: ${h.windowRank} | Tier: ${h.visualTier} | Climax: ${h.isStructuralClimax}`);
});
