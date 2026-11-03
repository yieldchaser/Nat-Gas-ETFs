import fs from 'fs';

const data = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8'));

function calcPVT(bars) {
  const pvt = new Float64Array(bars.length);
  let acc = 0;
  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].close;
    if (pc > 0 && bars[i].close != null) {
      acc += (bars[i].volume || 0) * (bars[i].close - pc) / pc;
    }
    pvt[i] = acc;
  }
  return pvt;
}

function calcSMA(arr, len) {
  const sma = new Float64Array(arr.length);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= len) sum -= arr[i - len];
    if (i >= len - 1) sma[i] = sum / len;
    else sma[i] = NaN;
  }
  return sma;
}

function calcEMA(arr, len) {
  const ema = new Float64Array(arr.length);
  const alpha = 2 / (len + 1);
  let prev = arr[0];
  ema[0] = prev;
  for (let i = 1; i < arr.length; i++) {
    if (isNaN(arr[i])) {
      ema[i] = NaN;
      continue;
    }
    prev = alpha * arr[i] + (1 - alpha) * prev;
    ema[i] = prev;
  }
  return ema;
}

function evaluateStrategy(bars, indicator, ma) {
  const n = bars.length;
  let inPosition = false;
  let capital = 10000;
  let peakCapital = 10000;
  let maxDrawdown = 0;
  let trades = 0;
  let wins = 0;
  let entryPrice = 0;
  let totalWinPct = 0;
  let totalLossPct = 0;

  for (let i = 22; i < n; i++) {
    const isAbove = indicator[i] > ma[i];
    const prevAbove = indicator[i - 1] > ma[i - 1];

    if (!inPosition && !prevAbove && isAbove) {
      inPosition = true;
      entryPrice = bars[i].close;
      trades++;
    } else if (inPosition && prevAbove && !isAbove) {
      inPosition = false;
      const exitPrice = bars[i].close;
      const ret = (exitPrice - entryPrice) / entryPrice;
      capital *= (1 + ret);
      if (capital > peakCapital) peakCapital = capital;
      const dd = (peakCapital - capital) / peakCapital;
      if (dd > maxDrawdown) maxDrawdown = dd;

      if (ret > 0) {
        wins++;
        totalWinPct += ret;
      } else {
        totalLossPct += Math.abs(ret);
      }
    } else if (inPosition) {
      const curReturn = (bars[i].close - entryPrice) / entryPrice;
      const curCap = capital * (1 + curReturn);
      if (curCap > peakCapital) peakCapital = curCap;
      const dd = (peakCapital - curCap) / peakCapital;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  const bnhReturn = (bars[n - 1].close - bars[22].close) / bars[22].close;
  const stratReturn = (capital - 10000) / 10000;
  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const profitFactor = totalLossPct > 0 ? (totalWinPct / totalLossPct) : 0;

  return {
    trades,
    winRate: winRate.toFixed(1) + '%',
    stratReturn: (stratReturn * 100).toFixed(1) + '%',
    bnhReturn: (bnhReturn * 100).toFixed(1) + '%',
    maxDrawdown: (maxDrawdown * 100).toFixed(1) + '%',
    profitFactor: profitFactor.toFixed(2)
  };
}

console.log('========================================================================');
console.log('EMPIRICAL RESEARCH AUDIT: PRICE-VOLUME TREND (PVT) CROSSOVER DYNAMICS');
console.log('========================================================================\n');

for (const [ticker, etf] of Object.entries(data.etfs)) {
  const bars = etf.history;
  const pvt = calcPVT(bars);
  const closes = bars.map(b => b.close);

  const pvtSma21 = calcSMA(pvt, 21);
  const pvtEma21 = calcEMA(pvt, 21);
  const priceSma21 = calcSMA(closes, 21);

  const resPvtSma = evaluateStrategy(bars, pvt, pvtSma21);
  const resPvtEma = evaluateStrategy(bars, pvt, pvtEma21);
  const resPriceSma = evaluateStrategy(bars, closes, priceSma21);

  console.log(`Instrument: ${ticker} (${bars.length} sessions, ${bars[0].date} to ${bars[bars.length - 1].date})`);
  console.log('  1. User Intuition: PVT > SMA(21) vs SMA(21):');
  console.log(`     Trades: ${resPvtSma.trades} | WinRate: ${resPvtSma.winRate} | Strat Ret: ${resPvtSma.stratReturn} | B&H Ret: ${resPvtSma.bnhReturn} | MaxDD: ${resPvtSma.maxDrawdown} | ProfitFactor: ${resPvtSma.profitFactor}`);
  console.log('  2. Fast Variant: PVT > EMA(21) vs EMA(21):');
  console.log(`     Trades: ${resPvtEma.trades} | WinRate: ${resPvtEma.winRate} | Strat Ret: ${resPvtEma.stratReturn} | MaxDD: ${resPvtEma.maxDrawdown} | ProfitFactor: ${resPvtEma.profitFactor}`);
  console.log('  3. Price Only Benchmark: Close > SMA(21) on Price:');
  console.log(`     Trades: ${resPriceSma.trades} | WinRate: ${resPriceSma.winRate} | Strat Ret: ${resPriceSma.stratReturn} | MaxDD: ${resPriceSma.maxDrawdown} | ProfitFactor: ${resPriceSma.profitFactor}`);
  console.log('------------------------------------------------------------------------');
}
