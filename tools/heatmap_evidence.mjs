// Scores the Volume Heat Map's highlighted days against forward natural-gas returns.
//
//   node tools/heatmap_evidence.mjs
//
// The heat map's own detection code (Signals.computeHeatGlobalPercentiles in docs/js/signals.js)
// is run over the full history instead of the 756 sessions the page shows. Each highlighted day
// type is then scored as non-overlapping 10- and 21-session trades on the tradeable NG index
// (docs/js/alert-engine.js) against the any-day rate, with a two-sided exact binomial p-value.
//
// Result on 2012-2026: no day type separates from the any-day rate for any ETF selection, which
// is why the panel describes the heat score as a record of where volume pressure concentrated
// and marks the days on which a tested Active Alerts setup was triggered.
import fs from 'fs';
import vm from 'vm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const AE = require('../docs/js/alert-engine.js');

const ctx = { console, Math, Date, JSON, Map, Set, Float64Array, Array, Object, Number, isFinite, parseFloat, parseInt, Infinity };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('docs/js/config.js', 'utf8') + '\n;globalThis.__CFG = CONFIG;', ctx);
vm.runInContext(fs.readFileSync('docs/js/signals.js', 'utf8') + '\n;globalThis.__S = Signals;', ctx);
const Signals = ctx.__S;
ctx.__CFG.heatmapDays = 100000;   // score the whole history, not only the visible window

const ETFS = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8')).etfs;
const START = '2012-06-01';        // first date on which all six ETFs have bars
const all = {};
for (const t of Object.keys(ETFS)) {
    const h = ETFS[t].history.filter((b) => b && b.close > 0 && b.date >= START).map((b) => ({ ...b, dollarVolume: b.close * (b.volume || 0) }));
    all[t] = { history: h, heatmapData: h };
}
const f = AE.buildFrame(ETFS.BOIL.history, ETFS.KOLD.history, null, null);
const at = {}; f.dates.forEach((d, i) => { at[d] = i; });
const baseRate = (hold) => { let n = 0, up = 0; for (let i = AE.CFG.minHistory; i + hold < f.n; i++) { n++; if (f.li[i + hold] > f.li[i]) up++; } return up / n; };
const BASE = { 10: baseRate(10), 21: baseRate(21) };

const TYPES = [
    ['Peak, top 5%', (e) => e.causal && e.causal.PEAKS.pctTop <= 5 && e.peakScore >= 25],
    ['Peak, top 1%', (e) => e.causal && e.causal.PEAKS.pctTop <= 1 && e.peakScore >= 25],
    ['Macro climax', (e) => e.causal && e.causal.PEAKS.isStructuralClimax],
    ['Valley, top 5%', (e) => e.causal && e.causal.VALLEYS.pctTop <= 5 && e.valleyScore >= 22],
    ['Valley, top 1%', (e) => e.causal && e.causal.VALLEYS.pctTop <= 1 && e.valleyScore >= 22],
    ['Macro drought', (e) => e.causal && e.causal.VALLEYS.isStructuralClimax],
];

console.log('NG higher on any day: ' + (BASE[10] * 100).toFixed(1) + '% after 10 sessions, ' + (BASE[21] * 100).toFixed(1) + '% after 21\n');
console.log('selection  day type          days   10 sessions: NG higher (avg)     p      21 sessions: NG higher (avg)     p');
let tests = 0, minP = 1;
for (const side of ['all', 'long', 'short', 'BOIL', 'KOLD']) {
    const series = Signals.computeHeatGlobalPercentiles(all, 'share', side).series;
    for (const [name, flag] of TYPES) {
        const cols = [];
        let days = 0;
        for (const hold of [10, 21]) {
            let n = 0, up = 0, sum = 0, next = -1; days = 0;
            for (const e of series) {
                if (!flag(e)) continue;
                days++;
                const i = at[e.date];
                if (i == null || i < AE.CFG.minHistory || i + hold >= f.n || i < next) continue;
                const m = f.li[i + hold] - f.li[i];
                n++; if (m > 0) up++; sum += Math.exp(m) - 1; next = i + hold + 1;
            }
            const lo = AE.binomTail(up, n, BASE[hold]), hi = 1 - AE.binomTail(up + 1, n, BASE[hold]);
            const p = Math.min(1, 2 * Math.min(lo, hi));
            tests++; if (p < minP) minP = p;
            const avg = sum / n * 100;
            const cell = (up + '/' + n).padStart(7) + ' ' + (up / n * 100).toFixed(0).padStart(3) + '% (' + (avg >= 0 ? '+' : '') + avg.toFixed(1) + '%)';
            cols.push(cell.padEnd(26) + p.toFixed(2).padStart(6));
        }
        console.log(side.padEnd(11) + name.padEnd(17) + String(days).padStart(5) + '   ' + cols.join('      '));
    }
}
console.log('\n' + tests + ' tests, smallest p-value ' + minP.toFixed(2) + '.');
