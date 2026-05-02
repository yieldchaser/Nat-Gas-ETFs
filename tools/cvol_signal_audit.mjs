import fs from 'node:fs';
import vm from 'node:vm';

const cvolJs = fs.readFileSync('docs/js/cvol.js', 'utf8');
const csv = fs.readFileSync('docs/data/cvol/ngvl_cvol_history.csv', 'utf8');
const t2p = JSON.parse(fs.readFileSync('docs/data/trough_peak_data.json', 'utf8'));

const context = vm.createContext({ console, Date, Math, setTimeout, clearTimeout });
vm.runInContext(`${cvolJs}
globalThis.__cvol = {
  CvolState,
  parseCvolCsv,
  computeComposites,
  applyT2pDecisionLayer,
  cvolFindNearestIndex
};`, context);

const { CvolState, parseCvolCsv, computeComposites, applyT2pDecisionLayer, cvolFindNearestIndex } = context.__cvol;
const data = parseCvolCsv(csv);
const comp = computeComposites(data);
applyT2pDecisionLayer(data, comp, t2p);

function rowFor(date) {
  const idx = cvolFindNearestIndex(data, date);
  const d = comp.decisionDaily[idx];
  return {
    date: data[idx].date,
    class: d.classification,
    conviction: d.conviction,
    phase: d.phase,
    top: Number(d.topScore.toFixed(2)),
    bottom: Number(d.bottomScore.toFixed(2)),
    expansion: Number(d.expansionRisk.toFixed(2)),
    conflict: Number(d.conflictScore.toFixed(2)),
    reasons: d.reasons,
  };
}

console.log('CVOL/T2P health');
console.table([comp.dataHealth]);

console.log('\nKnown windows');
console.table(comp.knownWindowAudit.map((w) => ({
  window: w.label,
  expected: w.expected,
  verdict: w.verdict,
  t2pSupport: w.t2pSupport,
  decisions: w.decisionSignals.join('; ') || '--',
  raw: w.rawSignals.join('; ') || '--',
})));

console.log('\nReference dates');
console.table(['2024-12-06', '2025-01-16', '2025-01-30', '2025-03-10', '2025-10-16', '2025-10-17'].map(rowFor));

console.log('\nRecent turning point replay');
console.table(comp.turningPointReplay.slice(0, 12).map((r) => ({
  window: r.window,
  type: r.type,
  support: r.support,
  verdict: r.verdict,
  leadLag: r.leadLag,
  fwd42: r.fwd42 == null ? null : Number(r.fwd42.toFixed(1)),
  cvSignals: r.cvSignals.join('; ') || '--',
  decisions: r.decisionSignals.join('; ') || '--',
})));

console.log('\nSignal quality against T2P turns');
console.table(comp.signalQualityAudit.map((r) => ({
  signal: r.signal,
  count: r.count,
  topHit: r.topHitRate == null ? null : Number(r.topHitRate.toFixed(0)),
  bottomHit: r.bottomHitRate == null ? null : Number(r.bottomHitRate.toFixed(0)),
  falsePositive: r.falsePositiveRate == null ? null : Number(r.falsePositiveRate.toFixed(0)),
  wrongSide: r.wrongSideRate == null ? null : Number(r.wrongSideRate.toFixed(0)),
  avgLeadLag: r.avgLeadLag == null ? null : Number(r.avgLeadLag.toFixed(1)),
  bestRegime: r.bestRegime,
})));

console.log(`\nRows: ${data.length}; raw fires: ${comp.rawFires.length}; decision events: ${comp.decisionEvents.length}; T2P clusters: ${CvolState.t2pContext.clusters.length}`);
