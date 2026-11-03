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

console.log('=== FORWARD RETURNS AFTER CROSSOVERS ===\n');

for (const ticker of ['BOIL', 'KOLD', 'HNU.TO', 'HND.TO']) {
  const bars = data.etfs[ticker].history;
  const pvt = calcPVT(bars);
  const sma21 = calcSMA(pvt, 21);
  const sma10 = calcSMA(pvt, 10);
  const sma50 = calcSMA(pvt, 50);

  const testWindows = [5, 10, 21, 63];
  
  console.log(`--- ${ticker} (${bars.length} sessions) ---`);
  
  for (const [maName, maArr] of [['SMA-10', sma10], ['SMA-21', sma21], ['SMA-50', sma50]]) {
    const fwdReturnsBull = { 5: [], 10: [], 21: [], 63: [] };
    const fwdReturnsBear = { 5: [], 10: [], 21: [], 63: [] };
    let bullCount = 0;
    let bearCount = 0;

    for (let i = 50; i < bars.length - 63; i++) {
      const prevAbove = pvt[i - 1] > maArr[i - 1];
      const isAbove = pvt[i] > maArr[i];

      if (!prevAbove && isAbove) {
        bullCount++;
        for (const w of testWindows) {
          fwdReturnsBull[w].push((bars[i + w].close - bars[i].close) / bars[i].close);
        }
      } else if (prevAbove && !isAbove) {
        bearCount++;
        for (const w of testWindows) {
          fwdReturnsBear[w].push((bars[i + w].close - bars[i].close) / bars[i].close);
        }
      }
    }

    const fmt = arr => {
      const avg = (arr.reduce((a, b) => a + b, 0) / arr.length * 100).toFixed(2);
      const win = ((arr.filter(r => r > 0).length / arr.length) * 100).toFixed(1);
      return `${avg}% (win ${win}%)`;
    };

    console.log(`  [${maName}] Bullish Crosses: ${bullCount} | Bearish Crosses: ${bearCount}`);
    console.log(`    BULL: 5d: ${fmt(fwdReturnsBull[5])} | 10d: ${fmt(fwdReturnsBull[10])} | 21d: ${fmt(fwdReturnsBull[21])} | 63d: ${fmt(fwdReturnsBull[63])}`);
    console.log(`    BEAR: 5d: ${fmt(fwdReturnsBear[5])} | 10d: ${fmt(fwdReturnsBear[10])} | 21d: ${fmt(fwdReturnsBear[21])} | 63d: ${fmt(fwdReturnsBear[63])}`);
  }
}
