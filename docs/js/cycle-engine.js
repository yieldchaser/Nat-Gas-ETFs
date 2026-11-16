// CycleEngine: ZigZag cycle detection, episode tracking and trade verification.
// Implements the cycle-frame specification defined in docs/cycle_frame_spec.md.

(function () {
    'use strict';

    function median(a) {
        if (!a || !a.length) return null;
        const s = [...a].sort((x, y) => x - y);
        const m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    function pivots(p, pct = 30) {
        const thr = pct / 100, out = [];
        let dir = null, k = 0;
        for (let i = 1; i < p.length; i++) {
            const ch = (p[i] - p[k]) / p[k];
            if (dir === null) {
                if (ch >= thr) { out.push({ i: k, type: 'T' }); dir = 'up'; k = i; }
                else if (ch <= -thr) { out.push({ i: k, type: 'P' }); dir = 'dn'; k = i; }
            } else if (dir === 'up') {
                if (p[i] >= p[k]) k = i;
                else if ((p[k] - p[i]) / p[k] >= thr) { out.push({ i: k, type: 'P' }); dir = 'dn'; k = i; }
            } else {
                if (p[i] <= p[k]) k = i;
                else if ((p[i] - p[k]) / p[k] >= thr) { out.push({ i: k, type: 'T' }); dir = 'up'; k = i; }
            }
        }
        return out;
    }

    function episodes(mask, gap = 10, skip = 60) {
        const out = [];
        let last = -1e9;
        for (let i = skip; i < mask.length; i++) {
            if (mask[i]) {
                if (i - last > gap) out.push(i);
                last = i;
            }
        }
        return out;
    }

    function entry(c, piv, t) {
        const pk = piv.find(x => x.type === 'P' && x.i > t);
        if (!pk) return null;
        let lo = Infinity;
        for (let j = t; j <= pk.i; j++) lo = Math.min(lo, c[j]);
        const nearLow = piv.some(x => x.type === 'T' && Math.abs(x.i - t) <= 10 && c[t] <= c[x.i] * 1.15);
        let worked = false;
        for (let j = t + 1; j < Math.min(c.length, t + 250); j++) {
            const r = c[j] / c[t] - 1;
            if (r >= 0.30) { worked = true; break; }
            if (r <= -0.20) break;
        }
        return { run: c[pk.i] / c[t] - 1, heat: lo / c[t] - 1, nearLow, worked };
    }

    function anyDay(c, piv, skip = 60) {
        const all = [];
        for (let i = skip; i < c.length; i++) {
            const e = entry(c, piv, i);
            if (e) all.push(e);
        }
        const pct = (a, f) => a.length ? a.filter(f).length / a.length * 100 : null;
        return {
            n: all.length,
            workedPct: pct(all, r => r.worked),
            nearLowPct: pct(all, r => r.nearLow),
            run: all.length ? median(all.map(r => r.run)) * 100 : null,
            heat: all.length ? median(all.map(r => r.heat)) * 100 : null
        };
    }

    function record(c, mask, dates = null, gap = 10, skip = 60) {
        const piv = pivots(c);
        const eps = episodes(mask, gap, skip);
        const rows = eps.map(t => entry(c, piv, t)).filter(Boolean);
        const any = anyDay(c, piv, skip);
        const pct = (a, f) => a.length ? a.filter(f).length / a.length * 100 : null;

        const troughs = piv.filter(x => x.type === 'T');
        let caught = 0;
        for (const tr of troughs) {
            const start = Math.max(0, tr.i - 10);
            const end = Math.min(mask.length - 1, tr.i + 10);
            let hit = false;
            for (let k = start; k <= end; k++) {
                if (mask[k]) { hit = true; break; }
            }
            if (hit) caught++;
        }
        const caughtPct = troughs.length ? (caught / troughs.length * 100) : null;

        const byYear = {};
        if (Array.isArray(dates)) {
            for (let idx = 0; idx < eps.length; idx++) {
                const t = eps[idx];
                const e = entry(c, piv, t);
                if (!e) continue;
                const yr = String(dates[t] || '').slice(0, 4);
                if (yr) {
                    if (!byYear[yr]) byYear[yr] = { n: 0, worked: 0 };
                    byYear[yr].n++;
                    if (e.worked) byYear[yr].worked++;
                }
            }
        }

        return {
            n: rows.length,
            worked: rows.filter(r => r.worked).length,
            workedPct: pct(rows, r => r.worked),
            nearLowPct: pct(rows, r => r.nearLow),
            run: rows.length ? median(rows.map(r => r.run)) * 100 : null,
            heat: rows.length ? median(rows.map(r => r.heat)) * 100 : null,
            caughtPct,
            any,
            byYear
        };
    }

    const CycleEngine = {
        pivots,
        episodes,
        entry,
        anyDay,
        record
    };

    if (typeof window !== 'undefined') {
        window.CycleEngine = CycleEngine;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CycleEngine;
    }
})();
