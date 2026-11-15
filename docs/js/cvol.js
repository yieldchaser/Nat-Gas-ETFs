/* ============================================================
   CVOL Volatility Intelligence Engine
   4th Tab of Blue Meridian
   ============================================================ */
'use strict';

const CvolState = {
    data: null,           // parsed CSV rows [{date, ngvl, dnVar, upVar, skew, skewRatio, atm, convexity, underlying}]
    dates: [],
    activeSeries: ['ngvl','underlying'],
    varActiveSeries: ['upVar','dnVar','skewRatio'],
    rangeState: { start: 0, end: 100 },
    varRangeState: { start: 0, end: 100 },
    horizonState: 'ALL',
    varHorizonState: 'ALL',
    hoverState: null,
    dragState: { active: false, startIdx: null, currentIdx: null },
    signalFilter: 'all',
    markerMode: 'surface',
    signalTypeFilter: 'all', // 'all', 'SAD', 'CI', 'CVC↓', 'CVC↑', 'RDS'
    regimeFilter: 'all',  // 'all', 'low', 'normal', 'high'
    composites: {},       // computed composite signal arrays
    percentiles: {},      // rolling percentile caches
    zscores: {},          // rolling z-score caches
    modalRange: null,     // shared for composite modals
    sigPeaksMode: false,
    sigPeaksThreshold: 95,
    hmPeaksMode: false,
    tradeable: false,     // true once ng_tradeable.csv is attached (roll-adjusted returns available)
};

// ── CSV Parser ────────────────────────────────────────────────
function parseCvolCsv(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].trim().split(',');
        if (cols.length < 9) continue;
        // DD-MM-YYYY → YYYY-MM-DD (the Date Parsing Trap)
        const dParts = cols[0].trim().split('-');
        if (dParts.length !== 3) continue;
        const date = `${dParts[2]}-${dParts[1]}-${dParts[0]}`;
        const dObj = new Date(date + 'T00:00:00Z');
        if (isNaN(dObj.getTime())) continue;
        // Sunday-evening Globex snapshots were once written as their own rows. They are not
        // trading days: counting them stretches every rolling window and forward horizon.
        const dow = dObj.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        rows.push({
            date,
            ngvl:      parseFloat(cols[1]),
            dnVar:     parseFloat(cols[2]),
            upVar:     parseFloat(cols[3]),
            skew:      parseFloat(cols[4]),
            skewRatio: parseFloat(cols[5]),
            atm:       parseFloat(cols[6]),
            convexity: parseFloat(cols[7]),
            underlying:parseFloat(cols[8]),
        });
    }
    return rows;
}

// ── Tradeable return series ───────────────────────────────────
// The CSV's UNDERLYING is the front options-month future. It switches contract around the
// 16th-21st of each month and in contango that switch prints as a one-day gain nobody earns
// (2025-10-20: +34% in the column, +6% in reality). Over 2013-2026 the column lost ~10% while
// a holder of rolled futures lost ~97%. scripts/build_cvol_tradeable.py therefore publishes:
//   idx_px - roll-adjusted unlevered NG index implied by the BOIL/KOLD pair (what a trader earns)
//   fm_px  - roll-free front-month level (for realized vol against CVOL implied vol)
// Every forward return in this engine uses idx_px and every realized vol uses fm_px. Without the
// sidecar both fall back to the raw column and CvolState.tradeable stays false.
function parseTradeableCsv(text) {
    const map = {};
    if (!text) return map;
    const lines = text.trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].trim().split(',');
        if (cols.length < 3) continue;
        const idx = parseFloat(cols[1]), fm = parseFloat(cols[2]);
        map[cols[0].trim()] = { idx: isFinite(idx) && idx > 0 ? idx : null, fm: isFinite(fm) && fm > 0 ? fm : null };
    }
    return map;
}

function attachTradeable(data, map) {
    let hits = 0;
    for (let i = 0; i < data.length; i++) {
        const t = map ? map[data[i].date] : null;
        data[i].tpx = t && t.idx != null ? t.idx : null;
        data[i].fmpx = t && t.fm != null ? t.fm : null;
        if (data[i].tpx != null) hits++;
    }
    if (hits < data.length * 0.8) {
        // Sidecar missing or badly stale: do not mix two price bases, use the raw column throughout.
        for (let i = 0; i < data.length; i++) { data[i].tpx = null; data[i].fmpx = null; }
        return false;
    }
    // Rows the sidecar does not cover yet (normally just the newest day or two) are chained on
    // with the raw column's daily change so the level series stays continuous.
    ['tpx', 'fmpx'].forEach(function(key) {
        for (let i = 1; i < data.length; i++) {
            if (data[i][key] == null && data[i - 1][key] != null && data[i].underlying > 0 && data[i - 1].underlying > 0) {
                data[i][key] = data[i - 1][key] * data[i].underlying / data[i - 1].underlying;
            }
        }
        for (let i = data.length - 2; i >= 0; i--) {
            if (data[i][key] == null && data[i + 1][key] != null && data[i].underlying > 0 && data[i + 1].underlying > 0) {
                data[i][key] = data[i + 1][key] * data[i].underlying / data[i + 1].underlying;
            }
        }
    });
    return true;
}

// Price used for forward returns (tradeable index when available).
function cvolPx(row) { return row ? (row.tpx != null ? row.tpx : row.underlying) : null; }
// Price used for realized volatility (roll-free front month when available).
function cvolVolPx(row) { return row ? (row.fmpx != null ? row.fmpx : row.underlying) : null; }

// ── Rolling Statistics ────────────────────────────────────────
function rollingPercentile(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        const slice = [];
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) slice.push(arr[j]);
        if (slice.length < 5) continue;
        slice.sort((a, b) => a - b);
        const v = arr[i];
        let rank = 0;
        for (const s of slice) if (s <= v) rank++;
        out[i] = (rank / slice.length) * 100;
    }
    return out;
}

function rollingZScore(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        let sum = 0, cnt = 0;
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) { sum += arr[j]; cnt++; }
        if (cnt < 5) continue;
        const mean = sum / cnt;
        let ss = 0;
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) ss += (arr[j] - mean) ** 2;
        const std = Math.sqrt(ss / (cnt - 1));
        out[i] = std > 0.0001 ? (arr[i] - mean) / std : 0;
    }
    return out;
}

function rollingMedian(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        const slice = [];
        for (let j = i - window + 1; j <= i; j++) if (arr[j] != null) slice.push(arr[j]);
        if (slice.length < 3) continue;
        slice.sort((a, b) => a - b);
        out[i] = slice.length % 2 === 0
            ? (slice[slice.length / 2 - 1] + slice[slice.length / 2]) / 2
            : slice[Math.floor(slice.length / 2)];
    }
    return out;
}

function rateOfChange(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window; i < arr.length; i++) {
        if (arr[i] != null && arr[i - window] != null && arr[i - window] !== 0) {
            out[i] = arr[i] - arr[i - window];
        }
    }
    return out;
}

function rollingAvg(arr, window) {
    const out = new Array(arr.length).fill(null);
    for (let i = window - 1; i < arr.length; i++) {
        let sum = 0, count = 0;
        for (let j = i - window + 1; j <= i; j++) { if (arr[j] != null) { sum += arr[j]; count++; } }
        if (count >= Math.floor(window * 0.7)) out[i] = sum / count;
    }
    return out;
}

// Causal percentile: where today's value ranks against every value up to and including today.
// Unlike a 252-session window this does not re-centre on the current season or regime, so an
// extreme stays an extreme; unlike a full-sample percentile it never looks ahead.
function expandingPercentile(arr, minN) {
    const out = new Array(arr.length).fill(null);
    const sorted = [];
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v == null || !isFinite(v)) continue;
        let lo = 0, hi = sorted.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
        sorted.splice(lo, 0, v);
        if (sorted.length >= minN) out[i] = (lo + 1) / sorted.length * 100;
    }
    return out;
}

function fullPercentile(arr, value) {
    if (value == null) return null;
    const valid = arr.filter(v => v != null);
    if (valid.length < 5) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    let rank = 0;
    for (const s of sorted) if (s <= value) rank++;
    return (rank / sorted.length) * 100;
}

// ── Composite Signal Computations ─────────────────────────────
// Surface-state model: options-market read first, directional calls only if history supports them.
const SURFACE_STATES = {
    CALM_COMPRESSION: { label: 'CALM COMPRESSION', color: '#60a8f8', bias: 'NONE', volBias: 'EXPANSION RISK', action: 'Watch for expansion', horizon: '5-21D' },
    UPSIDE_TAIL_BID: { label: 'UPSIDE TAIL BID', color: '#3db87a', bias: 'UPSIDE', volBias: 'EXPANSION RISK', action: 'Upside risk bid', horizon: '2-10D' },
    DOWNSIDE_TAIL_BID: { label: 'DOWNSIDE TAIL BID', color: '#ef4444', bias: 'DOWNSIDE', volBias: 'EXPANSION RISK', action: 'Downside risk bid', horizon: '2-10D' },
    TWO_SIDED_STRESS: { label: 'TWO-SIDED STRESS', color: '#f59e0b', bias: 'TWO_WAY', volBias: 'RANGE EXPANSION', action: 'Respect two-way risk', horizon: '2-21D' },
    PANIC_PREMIUM: { label: 'PANIC PREMIUM', color: '#c04040', bias: 'NONE', volBias: 'RICH IMPLIED', action: 'Risk already expensive', horizon: '5-21D' },
    VOL_UNDERPRICED: { label: 'VOL UNDERPRICED', color: '#a78bfa', bias: 'NONE', volBias: 'CHEAP IMPLIED', action: 'Realized outruns implied', horizon: '5-21D' },
    NORMALIZATION: { label: 'NORMALIZATION', color: '#94a3b8', bias: 'NONE', volBias: 'COOLING', action: 'Stress cooling', horizon: '5-21D' },
    NO_EDGE: { label: 'NO EDGE', color: '#6b7280', bias: 'NONE', volBias: 'NEUTRAL', action: 'Stand down', horizon: 'WAIT' },
};

function surfaceMeta(state) {
    return SURFACE_STATES[state] || SURFACE_STATES.NO_EDGE;
}

function surfaceStateColor(state) {
    return surfaceMeta(state).color;
}

function surfaceBiasText(bias, hasEdge) {
    if (bias === 'UPSIDE') return hasEdge ? 'UPSIDE EDGE' : 'UPSIDE RISK BID';
    if (bias === 'DOWNSIDE') return hasEdge ? 'DOWNSIDE EDGE' : 'DOWNSIDE RISK BID';
    if (bias === 'TWO_WAY') return 'TWO-WAY MOVE RISK';
    return 'NO DIRECTIONAL EDGE';
}

function cvolPct(v, threshold) {
    return v != null && isFinite(v) && v >= threshold;
}

function cvolLow(v, threshold) {
    return v != null && isFinite(v) && v <= threshold;
}

function cvolForwardReturn(data, i, days) {
    if (i < 0 || i + days >= data.length) return null;
    const p0 = cvolPx(data[i]), p1 = cvolPx(data[i + days]);
    if (p0 == null || p0 === 0 || p1 == null) return null;
    return (p1 - p0) / p0 * 100;
}

function cvolForwardRealizedVol(data, i, days) {
    if (i + days >= data.length) return null;
    let sumSq = 0, count = 0;
    for (let j = i + 1; j <= i + days; j++) {
        const pj = cvolVolPx(data[j]), pp = cvolVolPx(data[j - 1]);
        if (pj != null && pp != null && pp > 0 && pj > 0) {
            const lr = Math.log(pj / pp);
            sumSq += lr * lr;
            count++;
        }
    }
    return count >= Math.max(3, Math.floor(days * 0.6)) ? Math.sqrt(sumSq / Math.max(1, count - 1) * 252) * 100 : null;
}

function cvolExpectedMove(ngvl, days) {
    return ngvl != null ? ngvl / Math.sqrt(252) * Math.sqrt(days) : null;
}

function classifySurfaceDay(data, comp, extra, i) {
    const row = data[i] || {};
    const metaNoEdge = surfaceMeta('NO_EDGE');
    if (i < 252) {
        return {
            idx: i, date: row.date, state: 'NO_EDGE', label: metaNoEdge.label, confidence: 'LOW', confidenceScore: 0,
            directionalBias: 'NONE', directionalEdge: false, directionalRead: 'NO DIRECTIONAL EDGE',
            volBias: metaNoEdge.volBias, action: metaNoEdge.action, horizon: metaNoEdge.horizon,
            evidence: ['Insufficient 252-session history for full surface context'], contradictions: [], confirms: [], negates: [], features: {}
        };
    }

    const ngvlPct = comp.ngvlPct252 ? comp.ngvlPct252[i] : null;
    const atmPct = comp.atmPct252 ? comp.atmPct252[i] : null;
    const convPct = comp.convPct63 ? comp.convPct63[i] : null;
    const upZ = comp.upVarZ21 ? comp.upVarZ21[i] : null;
    const dnZ = comp.dnVarZ21 ? comp.dnVarZ21[i] : null;
    const skewZ = comp.skewRatioZ21 ? comp.skewRatioZ21[i] : null;
    const skewRoc5 = comp.skewRatioRoc5 ? comp.skewRatioRoc5[i] : null;
    const ngvlZ = comp.ngvlZ21 ? comp.ngvlZ21[i] : null;
    const convZ = comp.convZ21 ? comp.convZ21[i] : null;
    const vrpVal = comp.vrp ? comp.vrp[i] : null;
    const vrpZ = comp.vrpZ21 ? comp.vrpZ21[i] : null;
    const realVol = comp.realVol ? comp.realVol[i] : null;
    const vov = comp.vov ? comp.vov[i] : null;
    const spread = extra.varianceSpread ? extra.varianceSpread[i] : null;
    const spreadZ = extra.varianceSpreadZ ? extra.varianceSpreadZ[i] : null;
    const volRoc5 = extra.ngvlRoc5 ? extra.ngvlRoc5[i] : null;
    const vov5Ago = i > 5 && comp.vov ? comp.vov[i - 5] : null;
    const vovFalling = vov != null && vov5Ago != null && vov < vov5Ago;
    const evidence = [], contradictions = [], confirms = [], negates = [];
    function add(list, text) { if (text && list.length < 5) list.push(text); }

    // Use rolling 21D Z-score instead of absolute skewRatio thresholds.
    // Raw threshold (>=1.08) fired for ~75% of all days because NG structurally
    // prices upside calls above puts — the median skewRatio is ~1.15, not 1.0.
    // Z-score centers on recent history so upside/downside fire symmetrically (~20% each).
    const upsidePressure = (skewZ != null && skewZ >= 0.75 ? 1.0 : 0) +
        (skewZ != null && skewZ >= 1.3 ? 0.7 : 0) +
        (skewRoc5 != null && skewRoc5 >= 0.035 ? 0.65 : 0) +
        (upZ != null && upZ >= 1.0 ? 0.85 : 0) +
        (spreadZ != null && spreadZ >= 1.0 ? 0.65 : 0);
    const downsidePressure = (skewZ != null && skewZ <= -0.75 ? 1.0 : 0) +
        (skewZ != null && skewZ <= -1.3 ? 0.7 : 0) +
        (skewRoc5 != null && skewRoc5 <= -0.035 ? 0.65 : 0) +
        (dnZ != null && dnZ >= 1.0 ? 0.85 : 0) +
        (spreadZ != null && spreadZ <= -1.0 ? 0.65 : 0);
    const tailStress = (convPct != null ? convPct / 100 : 0) + (convZ != null && convZ > 0 ? Math.min(convZ / 2, 1) : 0);
    const bothWings = upZ != null && dnZ != null && upZ >= 0.85 && dnZ >= 0.85;
    const richPremium = (vrpVal != null && vrpVal >= 10) || (vrpZ != null && vrpZ >= 1.4) || cvolPct(ngvlPct, 92);
    // "Underpriced" has to mean realized actually exceeds implied. A low 21-day z-score of the
    // premium on its own happens ~12% of the time by construction, whatever the level.
    const cheapPremium = (vrpVal != null && vrpVal <= -5) || (vrpZ != null && vrpZ <= -1.2 && vrpVal != null && vrpVal < 0) || (realVol != null && row.ngvl != null && realVol > row.ngvl * 1.12);
    const compressed = cvolLow(ngvlPct, 25) && cvolLow(atmPct, 30) && !(convPct != null && convPct >= 80);
    const cooling = ngvlZ != null && ngvlZ <= -0.75 && vovFalling && !bothWings && !cheapPremium;

    let state = 'NO_EDGE';
    let score = 22;
    if (bothWings && tailStress >= 1.25) {
        state = 'TWO_SIDED_STRESS';
        score = 64 + Math.min(22, (tailStress - 1.25) * 18 + Math.max(upZ || 0, dnZ || 0) * 3);
        add(evidence, 'Both variance wings are bid while convexity is elevated');
        add(confirms, 'Range expansion or gap risk should show up as realized vol rising');
        add(negates, 'Stress cools if both wings and convexity fall together');
    } else if (cheapPremium) {
        state = 'VOL_UNDERPRICED';
        score = 60 + Math.min(24, Math.abs(vrpZ || 0) * 6 + Math.max(0, (realVol || 0) - (row.ngvl || 0)) * 0.25);
        add(evidence, 'Realized movement is outrunning implied volatility');
        add(confirms, 'Forward realized vol should remain above implied or NG should move beyond expected range');
        add(negates, 'Risk is repriced once NGVL expands or realized vol cools');
    } else if (richPremium && (cvolPct(ngvlPct, 85) || tailStress > 1.1)) {
        state = 'PANIC_PREMIUM';
        score = 58 + Math.min(28, Math.max(0, (ngvlPct || 0) - 85) * 0.9 + Math.max(0, (vrpVal || 0) - 8) * 0.8);
        add(evidence, 'Implied volatility is rich versus recent realized movement');
        add(confirms, 'Options are already pricing stress; follow-through needs fresh realized movement');
        add(negates, 'Premium normalizes if NGVL and VRP fall together');
    } else if (upsidePressure >= 1.7 && upsidePressure >= downsidePressure + 0.55) {
        state = 'UPSIDE_TAIL_BID';
        score = 55 + Math.min(30, upsidePressure * 8 + Math.max(0, tailStress - 0.7) * 7);
        add(evidence, 'Up variance and skew ratio show upside-tail demand');
        add(confirms, 'Confirmation is NG moving higher while up variance remains firm');
        add(negates, 'Signal fades if skew ratio drops back toward 1.0 or down variance takes leadership');
    } else if (downsidePressure >= 1.7 && downsidePressure >= upsidePressure + 0.55) {
        state = 'DOWNSIDE_TAIL_BID';
        score = 55 + Math.min(30, downsidePressure * 8 + Math.max(0, tailStress - 0.7) * 7);
        add(evidence, 'Down variance and skew impulse show downside protection demand');
        add(confirms, 'Confirmation is NG moving lower while down variance remains firm');
        add(negates, 'Signal fades if skew ratio rebounds or up variance takes leadership');
    } else if (compressed) {
        state = 'CALM_COMPRESSION';
        score = 54 + Math.min(28, (25 - (ngvlPct || 25)) * 0.8 + (30 - (atmPct || 30)) * 0.55);
        add(evidence, 'NGVL and ATM vol are low versus their own one-year history');
        add(confirms, 'Compression matters if skew, convexity, or realized movement starts rising');
        add(negates, 'Compression loses value if implied vol reprices before price moves');
    } else if (cooling) {
        state = 'NORMALIZATION';
        score = 52 + Math.min(22, Math.abs(ngvlZ || 0) * 7 + (vovFalling ? 8 : 0));
        add(evidence, 'Volatility and vol-of-vol are cooling after prior stress');
        add(confirms, 'Normalization continues if NGVL, convexity, and VRP keep falling');
        add(negates, 'Fresh skew impulse or wing demand cancels the cooling read');
    } else {
        add(evidence, 'Surface components are not aligned enough for a regime read');
        add(confirms, 'Wait for skew, variance wings, convexity, or VRP to move together');
        add(negates, 'No invalidation needed; this is already a stand-down state');
    }

    if (upsidePressure > 1.2 && downsidePressure > 1.2 && state !== 'TWO_SIDED_STRESS') add(contradictions, 'Both directional wings are active, so direction is less reliable');
    if (richPremium && (state === 'UPSIDE_TAIL_BID' || state === 'DOWNSIDE_TAIL_BID')) add(contradictions, 'Directional risk is bid, but options are already expensive');
    if (volRoc5 != null && volRoc5 < -8 && (state === 'UPSIDE_TAIL_BID' || state === 'DOWNSIDE_TAIL_BID')) add(contradictions, 'Headline CVOL is falling while directional skew is active');

    const meta = surfaceMeta(state);
    const confidenceScore = Math.max(0, Math.min(100, score - contradictions.length * 7));
    const confidence = confidenceScore >= 72 ? 'HIGH' : confidenceScore >= 55 ? 'MODERATE' : 'LOW';
    return {
        idx: i, date: row.date, state, label: meta.label, signal: state, direction: meta.action,
        confidence, confidenceScore, directionalBias: meta.bias, directionalEdge: false,
        directionalRead: surfaceBiasText(meta.bias, false), volBias: meta.volBias, action: meta.action, horizon: meta.horizon,
        value: confidenceScore, composite: confidenceScore, underlying: row.underlying, ngvl: row.ngvl,
        evidence, contradictions, confirms, negates,
        features: { ngvlPct, atmPct, convPct, upZ, dnZ, skewZ, skewRoc5, spread, spreadZ, vrp: vrpVal, vrpZ, realVol, vov, volRoc5, upsidePressure, downsidePressure, tailStress },
    };
}

function addSurfaceForwardFields(data, ev) {
    const out = Object.assign({}, ev);
    out.fwd5 = cvolForwardReturn(data, ev.idx, 5);
    out.fwd10 = cvolForwardReturn(data, ev.idx, 10);
    out.fwd21 = cvolForwardReturn(data, ev.idx, 21);
    out.fwd42 = cvolForwardReturn(data, ev.idx, 42);
    out.fwd5 = out.fwd5 != null ? out.fwd5 : out.forwardRet5;
    out.fwd10 = out.fwd10 != null ? out.fwd10 : out.forwardRet10;
    out.fwd21 = out.fwd21 != null ? out.fwd21 : out.forwardRet21;
    out.fwdAbs5 = out.fwd5 != null ? Math.abs(out.fwd5) : null;
    out.fwdAbs10 = out.fwd10 != null ? Math.abs(out.fwd10) : null;
    out.fwdAbs21 = out.fwd21 != null ? Math.abs(out.fwd21) : null;
    out.forwardRealVol21 = cvolForwardRealizedVol(data, ev.idx, 21);
    out.expectedMove21 = cvolExpectedMove(ev.ngvl, 21);
    out.season = getSeason(ev.date);
    out.direction = ev.directionalRead;
    out.value = ev.confidence;
    return out;
}

function buildSurfaceEvents(data, daily) {
    const events = [];
    const lastByState = {};
    let prevState = 'NO_EDGE';
    for (let i = 0; i < daily.length; i++) {
        const d = daily[i];
        if (!d || d.state === 'NO_EDGE') {
            if (d) prevState = d.state;
            continue;
        }
        const transition = d.state !== prevState;
        const high = d.confidence !== 'LOW';
        const lastIdx = lastByState[d.state];
        if ((transition || high) && (lastIdx == null || d.idx - lastIdx >= 7)) {
            events.push(addSurfaceForwardFields(data, Object.assign({}, d)));
            lastByState[d.state] = d.idx;
        }
        prevState = d.state;
    }
    return events;
}

function buildSurfaceAnalogs(data, daily) {
    const horizons = [5, 10, 21];
    const base = {};
    horizons.forEach(function(h) {
        let up = 0, down = 0, abs = 0, count = 0, impliedBeat = 0;
        for (let i = 252; i + h < data.length; i++) {
            const ret = cvolForwardReturn(data, i, h);
            if (ret == null) continue;
            const exp = cvolExpectedMove(data[i].ngvl, h);
            if (ret > 0) up++;
            if (ret < 0) down++;
            if (exp != null && Math.abs(ret) > exp) impliedBeat++;
            abs += Math.abs(ret);
            count++;
        }
        base[h] = { count, upRate: count ? up / count * 100 : null, downRate: count ? down / count * 100 : null, avgAbs: count ? abs / count : null, impliedBeatRate: count ? impliedBeat / count * 100 : null };
    });

    const states = {};
    daily.forEach(function(d) {
        if (!d || d.state === 'NO_EDGE' || d.idx < 252) return;
        if (!states[d.state]) {
            states[d.state] = { state: d.state, label: d.label, color: surfaceStateColor(d.state), bias: d.directionalBias, count: 0, horizons: {} };
            horizons.forEach(function(h) {
                states[d.state].horizons[h] = { n: 0, avgMove: 0, avgAbsMove: 0, dirHits: 0, volExpansion: 0, impliedBeat: 0 };
            });
        }
        states[d.state].count++;
        horizons.forEach(function(h) {
            const ret = cvolForwardReturn(data, d.idx, h);
            if (ret == null) return;
            const row = states[d.state].horizons[h];
            const futureRv = cvolForwardRealizedVol(data, d.idx, h);
            const currentRv = d.features ? d.features.realVol : null;
            const expected = cvolExpectedMove(d.ngvl, h);
            row.n++;
            row.avgMove += ret;
            row.avgAbsMove += Math.abs(ret);
            if (d.directionalBias === 'UPSIDE' && ret > 0) row.dirHits++;
            if (d.directionalBias === 'DOWNSIDE' && ret < 0) row.dirHits++;
            if (futureRv != null && currentRv != null && futureRv > currentRv) row.volExpansion++;
            if (expected != null && Math.abs(ret) > expected) row.impliedBeat++;
        });
    });

    Object.keys(states).forEach(function(state) {
        const s = states[state];
        horizons.forEach(function(h) {
            const row = s.horizons[h];
            const n = row.n;
            const dirBase = s.bias === 'UPSIDE' ? base[h].upRate : s.bias === 'DOWNSIDE' ? base[h].downRate : null;
            const dirHitRate = (s.bias === 'UPSIDE' || s.bias === 'DOWNSIDE') && n ? row.dirHits / n * 100 : null;
            row.avgMove = n ? row.avgMove / n : null;
            row.avgAbsMove = n ? row.avgAbsMove / n : null;
            row.dirHitRate = dirHitRate;
            row.baseRate = dirBase;
            row.baseDirRate = dirBase;
            row.directionalEdge = dirHitRate != null && n >= 30 && dirBase != null && dirHitRate >= dirBase + 3 && dirHitRate >= 52;
            row.volExpansionRate = n ? row.volExpansion / n * 100 : null;
            row.impliedBeatRate = n ? row.impliedBeat / n * 100 : null;
            row.lowSample = n < 30;
        });
        s.primary = s.horizons[21] || s.horizons[10] || s.horizons[5];
        s.hasDirectionalEdge = !!(s.primary && s.primary.directionalEdge);
    });

    return { base, states };
}

function computeSurfaceModel(data, comp) {
    const n = data.length;
    const spread = data.map(r => (r.upVar != null && r.dnVar != null) ? r.upVar - r.dnVar : null);
    const ratio = data.map(r => (r.upVar != null && r.dnVar != null && r.dnVar !== 0) ? r.upVar / r.dnVar : r.skewRatio);
    const ngvlRoc5 = new Array(n).fill(null);
    const atmRoc5 = new Array(n).fill(null);
    const convRoc5 = new Array(n).fill(null);
    for (let i = 5; i < n; i++) {
        if (data[i].ngvl != null && data[i - 5].ngvl != null && data[i - 5].ngvl !== 0) ngvlRoc5[i] = (data[i].ngvl / data[i - 5].ngvl - 1) * 100;
        if (data[i].atm != null && data[i - 5].atm != null && data[i - 5].atm !== 0) atmRoc5[i] = (data[i].atm / data[i - 5].atm - 1) * 100;
        if (data[i].convexity != null && data[i - 5].convexity != null && data[i - 5].convexity !== 0) convRoc5[i] = (data[i].convexity / data[i - 5].convexity - 1) * 100;
    }
    const extra = {
        varianceSpread: spread,
        varianceRatio: ratio,
        varianceSpreadZ: rollingZScore(spread, 21),
        varianceRatioZ: rollingZScore(ratio, 21),
        ngvlRoc5,
        atmRoc5,
        convRoc5,
    };
    const daily = data.map((_, i) => classifySurfaceDay(data, comp, extra, i));
    const analogs = buildSurfaceAnalogs(data, daily);
    daily.forEach(function(d) {
        const analog = analogs.states[d.state];
        d.analog = analog || null;
        d.directionalEdge = !!(analog && analog.hasDirectionalEdge);
        d.directionalRead = surfaceBiasText(d.directionalBias, d.directionalEdge);
        if ((d.directionalBias === 'UPSIDE' || d.directionalBias === 'DOWNSIDE') && !d.directionalEdge) {
            if (d.contradictions.indexOf('Historical direction has not beaten base rate; treat this as risk pricing, not a trade call') < 0) {
                d.contradictions.push('Historical direction has not beaten base rate; treat this as risk pricing, not a trade call');
            }
        }
    });
    const events = buildSurfaceEvents(data, daily);
    const current = daily[daily.length - 1] || null;
    return Object.assign(extra, { surfaceDaily: daily, surfaceEvents: events, currentSurfaceRead: current, surfaceAnalogs: analogs });
}

function computeComposites(data) {
    const n = data.length;
    const ngvl = data.map(r => r.ngvl);
    const atm = data.map(r => r.atm);
    const skewRatio = data.map(r => r.skewRatio);
    const convexity = data.map(r => r.convexity);
    const dnVar = data.map(r => r.dnVar);
    const upVar = data.map(r => r.upVar);
    const underlying = data.map(r => r.underlying);
    const volPx = data.map(r => cvolVolPx(r));   // roll-free front month when the sidecar is attached

    // Percentiles
    const ngvlPct21 = rollingPercentile(ngvl, 21);
    const ngvlPct63 = rollingPercentile(ngvl, 63);
    const ngvlPct252 = rollingPercentile(ngvl, 252);
    const atmPct252 = rollingPercentile(atm, 252);
    const skewRatioPct63 = rollingPercentile(skewRatio, 63);
    const convPct63 = rollingPercentile(convexity, 63);

    // Z-scores
    const skewRatioZ21 = rollingZScore(skewRatio, 21);
    const dnVarZ21 = rollingZScore(dnVar, 21);
    const upVarZ21 = rollingZScore(upVar, 21);
    const atmZ21 = rollingZScore(atm, 21);
    const ngvlZ21 = rollingZScore(ngvl, 21);
    const convZ21 = rollingZScore(convexity, 21);

    // Medians
    const atmMed90 = rollingMedian(atm, 90);

    // Rate of change
    const skewRatioRoc5 = rateOfChange(skewRatio, 5);

    // ── Realized Vol (21D annualized) ──
    const realVol = new Array(n).fill(null);
    for (let i = 21; i < n; i++) {
        let sumSq = 0, cnt = 0;
        for (let j = i - 20; j <= i; j++) {
            if (volPx[j] != null && volPx[j-1] != null && volPx[j-1] > 0 && volPx[j] > 0) {
                const lr = Math.log(volPx[j] / volPx[j-1]);
                sumSq += lr * lr;
                cnt++;
            }
        }
        if (cnt >= 15) realVol[i] = Math.sqrt(sumSq / (cnt - 1) * 252) * 100; // annualized %, Bessel-corrected
    }

    // ── Vol Risk Premium (VRP) = Implied - Realized ──
    const vrp = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (ngvl[i] != null && realVol[i] != null) vrp[i] = ngvl[i] - realVol[i];
    }
    const vrpZ21 = rollingZScore(vrp, 21);

    // ── Convexity Term Structure Proxy (5D avg / 63D avg NGVL) ──
    const ngvlAvg5 = rollingAvg(ngvl, 5);
    const ngvlAvg63 = rollingAvg(ngvl, 63);
    const termStructure = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (ngvlAvg5[i] != null && ngvlAvg63[i] != null && ngvlAvg63[i] > 0)
            termStructure[i] = ngvlAvg5[i] / ngvlAvg63[i];
    }

    // ── Vol-of-Vol (VoV): 21D rolling std of NGVL ──
    const vov = new Array(n).fill(null);
    for (let i = 20; i < n; i++) {
        let sum = 0, cnt = 0;
        for (let j = i - 20; j <= i; j++) { if (ngvl[j] != null) { sum += ngvl[j]; cnt++; } }
        if (cnt >= 15) {
            const avg = sum / cnt;
            let ss = 0;
            for (let j = i - 20; j <= i; j++) { if (ngvl[j] != null) ss += (ngvl[j] - avg) * (ngvl[j] - avg); }
            vov[i] = Math.sqrt(ss / cnt);
        }
    }

    // ── SAD (Skew-ATM Divergence) ──
    const sad = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (skewRatio[i] != null && atm[i] != null && atmMed90[i] != null && atmMed90[i] > 0) {
            sad[i] = skewRatio[i] - (atm[i] / atmMed90[i]);
        }
    }

    // ── CI (Complacency Index) ──
    const ci = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (atmPct252[i] != null) ci[i] = 100 - atmPct252[i];
    }

    // ── CVC (Convexity-Variance Confirmation) ──
    const cvcDown = new Array(n).fill(null);
    const cvcUp = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (convPct63[i] != null && dnVarZ21[i] != null) {
            cvcDown[i] = (convPct63[i] / 100) * Math.max(0, dnVarZ21[i]);
        }
        if (convPct63[i] != null && upVarZ21[i] != null) {
            cvcUp[i] = (convPct63[i] / 100) * Math.max(0, upVarZ21[i]);
        }
    }

    // ── RDS (Regime Divergence Score) ──
    const rds = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (skewRatioRoc5[i] != null && convexity[i] != null && atmPct252[i] != null) {
            rds[i] = Math.abs(skewRatioRoc5[i]) * convexity[i] * (1 - atmPct252[i] / 100);
        }
    }

    // ── Raw Research Fires (strength-based selection) ──
    const sadZ = rollingZScore(sad, 63);
    const rdsZ = rollingZScore(rds, 63);
    const events = [];
    for (let i = 63; i < n; i++) {
        // Evaluate all raw inputs independently, pick strongest per day
        const candidates = [];

        // RDS spike: z > 1.8
        if (rdsZ[i] != null && rdsZ[i] > 1.8) {
            candidates.push({ signal: 'RDS', value: rds[i], composite: rdsZ[i],
                direction: skewRatioRoc5[i] > 0 ? 'UPSIDE SETUP' : 'DOWNSIDE SETUP',
                strength: rdsZ[i] / 1.8 });
        }
        // SAD divergence: |z| > 1.5
        if (sadZ[i] != null && Math.abs(sadZ[i]) > 1.5) {
            candidates.push({ signal: 'SAD', value: sad[i], composite: sadZ[i],
                direction: sadZ[i] > 0 ? 'UPSIDE SKEW' : 'DOWNSIDE SKEW',
                strength: Math.abs(sadZ[i]) / 1.5 });
        }
        // CI extreme: > 82
        if (ci[i] != null && ci[i] > 82) {
            candidates.push({ signal: 'CI', value: ci[i], composite: ci[i],
                direction: 'COMPLACENCY',
                strength: ci[i] / 82 });
        }
        // CVC Down: > 1.2
        if (cvcDown[i] != null && cvcDown[i] > 1.2) {
            candidates.push({ signal: 'CVC↓', value: cvcDown[i], composite: cvcDown[i],
                direction: 'DOWNSIDE INPUT',
                strength: cvcDown[i] / 1.2 });
        }
        // CVC Up: > 1.2
        if (cvcUp[i] != null && cvcUp[i] > 1.2) {
            candidates.push({ signal: 'CVC↑', value: cvcUp[i], composite: cvcUp[i],
                direction: 'UPSIDE INPUT',
                strength: cvcUp[i] / 1.2 });
        }

        // Sort by strength descending, emit strongest that passes dedup
        candidates.sort((a, b) => b.strength - a.strength);
        for (const cand of candidates) {
            const recent = events.filter(e => e.signal === cand.signal && i - e.idx < 10);
            if (recent.length > 0) continue;
            const fwd5  = cvolForwardReturn(data, i, 5);
            const fwd10 = cvolForwardReturn(data, i, 10);
            const fwd21 = cvolForwardReturn(data, i, 21);
            const fwd42 = cvolForwardReturn(data, i, 42);
            events.push({
                idx: i, date: data[i].date,
                signal: cand.signal, direction: cand.direction,
                value: cand.value, composite: cand.composite,
                underlying: underlying[i],
                ngvl: ngvl[i], skewRatio: skewRatio[i], convexity: convexity[i], atm: atm[i],
                fwd5, fwd10, fwd21, fwd42,
                season: getSeason(data[i].date),
            });
            break; // strongest signal wins for this day
        }
    }

    // ── Advanced Quant Signals (Derived from existing data) ──
    // Variance Spread: net directional imbalance (calls vs puts)
    const varSpread = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (upVar[i] != null && dnVar[i] != null) varSpread[i] = upVar[i] - dnVar[i];
    }
    const varSpreadZ21 = rollingZScore(varSpread, 21);

    // Skew Acceleration: 2nd derivative of skew — catches inflections BEFORE momentum does
    const skewAccel = new Array(n).fill(null);
    for (let i = 10; i < n; i++) {
        if (skewRatioRoc5[i] != null && skewRatioRoc5[i - 5] != null) {
            skewAccel[i] = skewRatioRoc5[i] - skewRatioRoc5[i - 5];
        }
    }

    // Wing Divergence Index: when wings pick a side — high = conviction
    const wingDiv = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (upVarZ21[i] != null && dnVarZ21[i] != null) {
            wingDiv[i] = Math.abs(upVarZ21[i] - dnVarZ21[i]);
        }
    }

    // Price-Skew Dislocation: rolling 10D correlation between NG returns and skew changes
    // When they decouple, smart money is repositioning ahead of a move
    const priceRet = new Array(n).fill(null);
    const skewChg = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
        if (volPx[i] != null && volPx[i-1] != null && volPx[i-1] > 0)
            priceRet[i] = (volPx[i] / volPx[i-1] - 1) * 100;
        if (skewRatio[i] != null && skewRatio[i-1] != null)
            skewChg[i] = skewRatio[i] - skewRatio[i-1];
    }
    const priceSkewCorr = new Array(n).fill(null);
    for (let i = 14; i < n; i++) {
        let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0, cnt = 0;
        for (let j = i - 9; j <= i; j++) {
            if (priceRet[j] != null && skewChg[j] != null) {
                sx += priceRet[j]; sy += skewChg[j]; sxy += priceRet[j] * skewChg[j];
                sx2 += priceRet[j] * priceRet[j]; sy2 += skewChg[j] * skewChg[j];
                cnt++;
            }
        }
        if (cnt >= 7) {
            const num = cnt * sxy - sx * sy;
            const den = Math.sqrt((cnt * sx2 - sx * sx) * (cnt * sy2 - sy * sy));
            priceSkewCorr[i] = den > 0 ? num / den : 0;
        }
    }

    // Regime Tension Score: composite pressure gauge — high tension precedes explosive moves
    const regimeTension = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (convZ21[i] != null && varSpreadZ21[i] != null) {
            const accelFactor = skewAccel[i] != null ? (1 + Math.abs(skewAccel[i]) * 10) : 1;
            regimeTension[i] = Math.abs(convZ21[i]) * Math.abs(varSpreadZ21[i]) * accelFactor;
        }
    }
    const regimeTensionPct = rollingPercentile(regimeTension, 63);

    // Convexity-Adjusted Wing Spread: weights variance spread by convexity for conviction-adjusted reads
    const convAdjWingSpread = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (varSpread[i] != null && convexity[i] != null) {
            convAdjWingSpread[i] = varSpread[i] * (convexity[i] / 100);
        }
    }

    // Surface Velocity: 5D rate of change of the VRP to track implied repricing speed
    const surfaceVelocity = new Array(n).fill(null);
    for (let i = 5; i < n; i++) {
        if (vrp[i] != null && vrp[i - 5] != null) {
            surfaceVelocity[i] = vrp[i] - vrp[i - 5];
        }
    }

    const base = {
        ngvlPct21, ngvlPct63, ngvlPct252, atmPct252, skewRatioPct63, convPct63,
        skewRatioZ21, dnVarZ21, upVarZ21, atmZ21, ngvlZ21, convZ21,
        skewRatioRoc5, atmMed90,
        sad, ci, cvcDown, cvcUp, rds,
        sadZ, rdsZ,
        realVol, vrp, vrpZ21, termStructure, vov,
        varSpread, varSpreadZ21, skewAccel, wingDiv, priceSkewCorr,
        regimeTension, regimeTensionPct, convAdjWingSpread, surfaceVelocity,
        events,
    };
    Object.assign(base, computeSurfaceModel(data, base));
    base.edge = computeEdgeModel(data, base);
    base.decay = computeDecayModel(data);
    return base;
}

// ── Directional Edge Model ────────────────────────────────────
// What the surface says about DIRECTION, tested on tradeable (roll-adjusted) returns.
// Three findings survive that test (2014-2026, circular-shift permutation p < 0.05):
//   BLOW-OFF FADE  - skew ratio >= 95th and NGVL >= 90th expanding percentile. The market is paying
//                    record premiums for upside calls. Forward tradeable returns have been deeply
//                    negative; the risk is a squeeze that keeps going (Dec-2024, Jan-2014).
//   UPSIDE STRESS  - same condition one notch down (skew 90-95th). Same sign, but ONLY once it
//                    persists: a single isolated day carried no edge, three of the last ten did,
//                    and even then only over ~10 sessions.
//   PANIC FLUSH    - NG down >= 1.5 implied sigmas in 5 sessions WHILE implied vol rises >= 5%.
//                    A sell-off that scares option buyers has tended to bounce; the same drop
//                    with no vol response has not. The first signal day is a coin flip; it
//                    only counts from the second. A short bounce tendency, not a trough call.
// A state is ACTIONABLE only once it has been on for `confirm` of the last `persistWindow`
// sessions. Each state is also scored as non-overlapping TRADES (enter when actionable and flat,
// hold `hold` sessions) against the any-day benchmark for the same side and hold - the honest
// yardstick, because on a tradeable basis simply being short NG wins 56-58% of the time.
// Troughs otherwise leave no signature in this data, so everything else is NO EDGE and inherits
// the base rate - which on a tradeable basis is itself negative (contango bleed).
// Statistics below are recomputed from the full history on every load, so they stay honest as
// data accumulates; nothing here is a hard-coded backtest number.
const EDGE_STATES = {
    BLOWOFF:       { label: 'BLOW-OFF FADE', bias: 'DOWNSIDE', color: '#ef4444', tier: 'STRONG',   confirm: 1, hold: 21, short: 'Call skew and implied vol both at historic extremes' },
    UPSIDE_STRESS: { label: 'UPSIDE STRESS', bias: 'DOWNSIDE', color: '#f59e0b', tier: 'MODERATE', confirm: 3, hold: 10, short: 'Call skew and implied vol elevated, one notch below blow-off' },
    PANIC_FLUSH:   { label: 'PANIC FLUSH',   bias: 'UPSIDE',   color: '#3db87a', tier: 'WEAK',     confirm: 2, hold: 10, short: 'Sharp sell-off with implied vol rising' },
    NEUTRAL:       { label: 'NO EDGE',       bias: 'NONE',     color: '#6b7280', tier: 'NONE',     confirm: 1, hold: 21, short: 'Surface gives no directional information beyond the base rate' },
};
const EDGE_CFG = {
    minHistory: 252,      // sessions before the first classification
    skewBlow: 95,         // expanding percentile of skew ratio
    skewStress: 90,
    volGate: 90,          // expanding percentile of NGVL required alongside skew
    flushSigma: -1.5,     // 5-session move in implied-sigma units
    flushVolRise: 0.05,   // 5-session log change in NGVL
    idxVolRatio: 0.8,     // tradeable-index vol runs ~0.8x NGVL (index holds a deferred contract)
    horizons: [5, 10, 21, 42],
    episodeGap: 10,       // sessions without the state before a new episode starts
    persistWindow: 10,    // look-back for the persistence count (each state sets its own `confirm`)
};

function edgeMedian(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort(function(a, b) { return a - b; });
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function edgeQuantile(arr, q) {
    const s = arr.filter(function(v) { return v != null && isFinite(v); }).sort(function(a, b) { return a - b; });
    if (!s.length) return null;
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// Circular-shift permutation test: slide the signal dates through time as a block (keeping their
// clustering intact) and ask how often a shifted copy does as well as the real one. This respects
// the autocorrelation of both the signal and the returns, which a t-test on daily rows does not.
function edgePermutationP(idxList, fwd, lo, hi, bias) {
    const N = hi - lo;
    if (idxList.length < 10 || N < 500) return null;
    function meanAt(shift) {
        let sum = 0, cnt = 0;
        for (let k = 0; k < idxList.length; k++) {
            const v = fwd[lo + ((idxList[k] - lo + shift) % N)];
            if (v != null) { sum += v; cnt++; }
        }
        return cnt ? sum / cnt : null;
    }
    const obs = meanAt(0);
    if (obs == null) return null;
    let extreme = 0, total = 0;
    const step = Math.max(1, Math.floor(N / 600));
    for (let sh = 63; sh < N - 63; sh += step) {
        const m = meanAt(sh);
        if (m == null) continue;
        total++;
        if (bias === 'DOWNSIDE' ? m <= obs : m >= obs) extreme++;
    }
    return total ? extreme / total : null;
}

// P(X >= k) for X ~ Binomial(n, p): how surprising a win count is against a benchmark win rate.
function edgeBinomTail(k, n, p) {
    if (n <= 0 || p == null) return null;
    let logC = 0, tail = 0;
    for (let i = 0; i <= n; i++) {
        if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
        if (i >= k) tail += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log(1 - p));
    }
    return Math.min(1, tail);
}

// Non-overlapping trades: enter at the close of the first actionable day while flat, exit `hold`
// sessions later, then look for the next entry. P&L is signed so positive = the read was right.
function edgeBuildTrades(data, actionable, hold, bias, startIdx) {
    const n = data.length, sgn = bias === 'DOWNSIDE' ? -1 : 1, trades = [];
    let i = startIdx;
    while (i < n - 1) {
        if (!actionable[i]) { i++; continue; }
        const j = Math.min(n - 1, i + hold), p0 = cvolPx(data[i]), p1 = cvolPx(data[j]);
        let heat = 0;
        for (let k = i + 1; k <= j; k++) {
            const pk = cvolPx(data[k]);
            if (pk == null || !p0) continue;
            const mv = sgn * (pk / p0 - 1) * 100;
            if (mv < heat) heat = mv;
        }
        trades.push({
            entryIdx: i, exitIdx: j, entry: data[i].date, exit: data[j].date, sessions: j - i,
            skewRatio: data[i].skewRatio, ngvl: data[i].ngvl,
            ng: p0 && p1 != null ? (p1 / p0 - 1) * 100 : null,
            pnl: p0 && p1 != null ? sgn * (p1 / p0 - 1) * 100 : null,
            heat: heat, open: i + hold > n - 1,
        });
        i = j + 1;
    }
    return trades;
}

function edgeTradeStats(trades, bench) {
    const done = trades.filter(function(t) { return !t.open && t.pnl != null; });
    const pnl = done.map(function(t) { return t.pnl; });
    const wins = pnl.filter(function(v) { return v > 0; });
    const gain = wins.reduce(function(a, b) { return a + b; }, 0);
    const loss = -pnl.filter(function(v) { return v < 0; }).reduce(function(a, b) { return a + b; }, 0);
    return {
        n: done.length, wins: wins.length,
        winRate: done.length ? wins.length / done.length * 100 : null,
        mean: done.length ? pnl.reduce(function(a, b) { return a + b; }, 0) / done.length : null,
        median: edgeMedian(pnl),
        profitFactor: loss > 0 ? gain / loss : (gain > 0 ? Infinity : null),
        worst: pnl.length ? Math.min.apply(null, pnl) : null,
        worstHeat: done.length ? Math.min.apply(null, done.map(function(t) { return t.heat; })) : null,
        benchWinRate: bench ? bench.winRate : null, benchMean: bench ? bench.mean : null,
        p: bench && bench.winRate != null && done.length ? edgeBinomTail(wins.length, done.length, bench.winRate / 100) : null,
    };
}

function computeEdgeModel(data, comp) {
    const n = data.length, cfg = EDGE_CFG;
    const skewPe = expandingPercentile(data.map(function(r) { return r.skewRatio; }), cfg.minHistory);
    const ngvlPe = expandingPercentile(data.map(function(r) { return r.ngvl; }), cfg.minHistory);
    const move5 = new Array(n).fill(null), volChg5 = new Array(n).fill(null);
    for (let i = 5; i < n; i++) {
        const p1 = cvolPx(data[i]), p0 = cvolPx(data[i - 5]);
        const v1 = data[i].ngvl, v0 = data[i - 5].ngvl;
        if (p1 > 0 && p0 > 0 && v0 > 0) move5[i] = Math.log(p1 / p0) / (cfg.idxVolRatio * v0 / 100 * Math.sqrt(5 / 252));
        if (v1 > 0 && v0 > 0) volChg5[i] = Math.log(v1 / v0);
    }

    const daily = new Array(n);
    for (let i = 0; i < n; i++) {
        let state = 'NEUTRAL';
        if (i >= cfg.minHistory && skewPe[i] != null && ngvlPe[i] != null) {
            const volHot = ngvlPe[i] >= cfg.volGate;
            if (volHot && skewPe[i] >= cfg.skewBlow) state = 'BLOWOFF';
            else if (volHot && skewPe[i] >= cfg.skewStress) state = 'UPSIDE_STRESS';
            else if (move5[i] != null && volChg5[i] != null && move5[i] <= cfg.flushSigma && volChg5[i] > cfg.flushVolRise) state = 'PANIC_FLUSH';
        }
        daily[i] = state;
    }

    // Persistence: how many of the last persistWindow sessions (today included) were in today's state.
    const persist = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        if (daily[i] === 'NEUTRAL') continue;
        let c = 0;
        for (let j = Math.max(0, i - cfg.persistWindow + 1); j <= i; j++) if (daily[j] === daily[i]) c++;
        persist[i] = c;
    }

    const fwd = {};
    cfg.horizons.forEach(function(h) {
        fwd[h] = new Array(n).fill(null);
        for (let i = cfg.minHistory; i < n; i++) fwd[h][i] = cvolForwardReturn(data, i, h);
    });

    function summarize(idxList, bias) {
        const out = {};
        cfg.horizons.forEach(function(h) {
            const vals = [];
            idxList.forEach(function(i) { if (fwd[h][i] != null) vals.push(fwd[h][i]); });
            const up = vals.filter(function(v) { return v > 0; }).length;
            out[h] = {
                n: vals.length,
                mean: vals.length ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : null,
                median: edgeMedian(vals),
                upRate: vals.length ? up / vals.length * 100 : null,
                p: bias && bias !== 'NONE' ? edgePermutationP(idxList, fwd[h], cfg.minHistory, n, bias) : null,
            };
        });
        return out;
    }

    function buildEpisodes(key, bias) {
        const eps = [];
        let cur = null;
        for (let i = cfg.minHistory; i < n; i++) {
            if (daily[i] !== key) continue;
            if (cur && i - cur.endIdx <= cfg.episodeGap) { cur.endIdx = i; cur.days++; }
            else { cur = { startIdx: i, endIdx: i, days: 1 }; eps.push(cur); }
        }
        eps.forEach(function(e) {
            const s = e.startIdx, p0 = cvolPx(data[s]);
            e.start = data[s].date; e.end = data[e.endIdx].date;
            e.skewRatio = data[s].skewRatio; e.ngvl = data[s].ngvl;
            e.fwd10 = fwd[10] ? fwd[10][s] : null;
            e.fwd21 = fwd[21] ? fwd[21][s] : null;
            e.fwd42 = fwd[42] ? fwd[42][s] : null;
            // Worst move AGAINST the read within 21 sessions of the first signal day - the heat a position takes.
            let worst = 0;
            for (let j = s + 1; j <= Math.min(n - 1, s + 21); j++) {
                const pj = cvolPx(data[j]);
                if (pj == null || !p0) continue;
                const mv = (pj / p0 - 1) * 100;
                if (bias === 'DOWNSIDE' ? mv > worst : mv < worst) worst = mv;
            }
            e.adverse21 = worst;
            e.open = s + 21 >= n;
            e.active = e.endIdx >= n - 1 - cfg.episodeGap;
            e.right21 = e.fwd21 == null ? null : (bias === 'DOWNSIDE' ? e.fwd21 < 0 : e.fwd21 > 0);
            e.right42 = e.fwd42 == null ? null : (bias === 'DOWNSIDE' ? e.fwd42 < 0 : e.fwd42 > 0);
        });
        return eps;
    }

    const allIdx = [];
    for (let i = cfg.minHistory; i < n; i++) allIdx.push(i);
    const base = summarize(allIdx, null);

    const states = {};
    Object.keys(EDGE_STATES).forEach(function(key) {
        const meta = EDGE_STATES[key];
        const idxList = allIdx.filter(function(i) { return daily[i] === key; });
        const st = { key: key, label: meta.label, bias: meta.bias, color: meta.color, short: meta.short, days: idxList.length, horizons: summarize(idxList, meta.bias) };
        if (key !== 'NEUTRAL') {
            st.tier = meta.tier; st.confirm = meta.confirm; st.hold = meta.hold;
            const conf = idxList.filter(function(i) { return persist[i] >= meta.confirm; });
            const fresh = idxList.filter(function(i) { return persist[i] < meta.confirm; });
            st.confirmed = { days: conf.length, horizons: summarize(conf, meta.bias) };
            st.fresh = { days: fresh.length, horizons: summarize(fresh, meta.bias) };
            // Trades: the state scored the way it would actually be used.
            const actionable = new Array(n).fill(false);
            conf.forEach(function(i) { actionable[i] = true; });
            const sgn = meta.bias === 'DOWNSIDE' ? -1 : 1;
            let bw = 0, bs = 0, bn = 0;
            for (let i = cfg.minHistory; i + meta.hold < n; i++) {
                const r = cvolForwardReturn(data, i, meta.hold);
                if (r == null) continue;
                bn++; bs += sgn * r; if (sgn * r > 0) bw++;
            }
            st.bench = { winRate: bn ? bw / bn * 100 : null, mean: bn ? bs / bn : null, n: bn };
            st.trades = edgeBuildTrades(data, actionable, meta.hold, meta.bias, cfg.minHistory);
            st.tradeStats = edgeTradeStats(st.trades, st.bench);
            st.episodes = buildEpisodes(key, meta.bias);
            const done21 = st.episodes.filter(function(e) { return e.right21 != null; });
            const done42 = st.episodes.filter(function(e) { return e.right42 != null; });
            st.episodeCount = st.episodes.length;
            st.right21 = done21.filter(function(e) { return e.right21; }).length; st.done21 = done21.length;
            st.right42 = done42.filter(function(e) { return e.right42; }).length; st.done42 = done42.length;
            st.medianEpisode21 = edgeMedian(done21.map(function(e) { return e.fwd21; }));
            const adv = st.episodes.map(function(e) { return e.adverse21; });
            st.worstAdverse = adv.length ? (meta.bias === 'DOWNSIDE' ? Math.max.apply(null, adv) : Math.min.apply(null, adv)) : null;
            st.medianAdverse = edgeMedian(adv);
        }
        states[key] = st;
    });

    const last = n - 1;
    const curKey = n ? daily[last] : 'NEUTRAL';
    let since = last;
    while (since > 0 && daily[since - 1] === curKey) since--;
    const current = n ? {
        state: curKey, label: EDGE_STATES[curKey].label, bias: EDGE_STATES[curKey].bias, color: EDGE_STATES[curKey].color,
        short: EDGE_STATES[curKey].short, date: data[last].date, since: data[since].date, streak: last - since + 1,
        persist: persist[last], tier: EDGE_STATES[curKey].tier, confirm: EDGE_STATES[curKey].confirm,
        confirmed: curKey !== 'NEUTRAL' && persist[last] >= EDGE_STATES[curKey].confirm,
        features: { skewRatio: data[last].skewRatio, skewPe: skewPe[last], ngvl: data[last].ngvl, ngvlPe: ngvlPe[last], move5: move5[last], volChg5: volChg5[last] },
    } : null;

    return {
        daily: daily, persist: persist, skewPe: skewPe, ngvlPe: ngvlPe, move5: move5, volChg5: volChg5,
        base: base, states: states, current: current, tradeable: data.some(function(r) { return r.tpx != null; }),
        thresholds: {
            skewBlow: edgeQuantile(data.map(function(r) { return r.skewRatio; }), cfg.skewBlow / 100),
            skewStress: edgeQuantile(data.map(function(r) { return r.skewRatio; }), cfg.skewStress / 100),
            ngvlGate: edgeQuantile(data.map(function(r) { return r.ngvl; }), cfg.volGate / 100),
        },
    };
}

// ── Leveraged-ETF Holding Cost ────────────────────────────────
// A daily-reset 2x fund loses roughly sigma^2 * T to volatility drag and a -2x fund roughly
// 3 * sigma^2 * T, whatever the direction. NGVL is the market's forecast of that sigma, so it
// prices the cost of holding BOIL or KOLD. Rather than trust the formula, this looks up what the
// drag actually was over the 21 sessions following past days with NGVL within +/-15% of today.
function computeDecayModel(data) {
    const n = data.length;
    if (!n || !data.some(function(r) { return r.tpx != null; })) return null;
    const H = 21;
    const cumI = new Array(n).fill(0), cumB = new Array(n).fill(0), cumK = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        const p1 = data[i].tpx, p0 = data[i - 1].tpx;
        let r = (p1 > 0 && p0 > 0) ? p1 / p0 - 1 : 0;
        r = Math.max(-0.45, Math.min(0.45, r));
        cumI[i] = cumI[i - 1] + Math.log(1 + r);
        cumB[i] = cumB[i - 1] + Math.log(1 + 2 * r);
        cumK[i] = cumK[i - 1] + Math.log(1 - 2 * r);
    }
    const cur = data[n - 1].ngvl;
    if (!(cur > 0)) return null;
    const boil = [], kold = [], absMove = [];
    for (let i = EDGE_CFG.minHistory; i + H < n; i++) {
        const v = data[i].ngvl;
        if (!(v > 0) || Math.abs(Math.log(v / cur)) > 0.15) continue;
        const dI = cumI[i + H] - cumI[i];
        boil.push((Math.exp(cumB[i + H] - cumB[i] - 2 * dI) - 1) * 100);
        kold.push((Math.exp(cumK[i + H] - cumK[i] + 2 * dI) - 1) * 100);
        absMove.push(Math.abs(Math.exp(dI) - 1) * 100);
    }
    if (boil.length < 20) return { ngvl: cur, n: boil.length, lowSample: true };
    return {
        ngvl: cur, n: boil.length, horizon: H,
        boilMedian: edgeMedian(boil), boilP25: edgeQuantile(boil, 0.25), boilP75: edgeQuantile(boil, 0.75),
        koldMedian: edgeMedian(kold), koldP25: edgeQuantile(kold, 0.25), koldP75: edgeQuantile(kold, 0.75),
        idxAbsMoveMedian: edgeMedian(absMove),
    };
}

function getSeason(dateStr) {
    const m = parseInt(dateStr.split('-')[1]);
    if (m >= 11 || m <= 2) return 'winter';
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    return 'fall';
}

// ── Regime Classification ─────────────────────────────────────
function ngvlRegime(pct) {
    if (pct == null) return { label: '—', cls: 'cvol-reg-unknown', color: '#666' };
    if (pct >= 90) return { label: 'EXTREME', cls: 'cvol-reg-extreme', color: '#c04040' };
    if (pct >= 75) return { label: 'ELEVATED', cls: 'cvol-reg-elevated', color: '#c07828' };
    if (pct >= 25) return { label: 'NORMAL', cls: 'cvol-reg-normal', color: '#3db87a' };
    return { label: 'LOW', cls: 'cvol-reg-low', color: '#4a80b8' };
}

// ── Format Helpers ────────────────────────────────────────────
function fmt(n, d = 1) { return n != null && isFinite(n) ? n.toFixed(d) : '—'; }
function fmtPct(n) { return n != null && isFinite(n) ? n.toFixed(0) + 'th' : '—'; }
function fmtSign(n, d = 1) { return n != null && isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(d) + '%' : '—'; }

const SEASON_CFG = {
    winter: { emoji: '❄', color: '#60a8f8' },
    spring: { emoji: '✿', color: '#6ddc8b' },
    summer: { emoji: '☀', color: '#f5c542' },
    fall:   { emoji: '◈', color: '#f5a742' },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(d) {
    const [y, m, dd] = d.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + dd + ', ' + y;
}

// ── Series Config ─────────────────────────────────────────────
const SERIES_CFG = {
    ngvl:       { label: 'NGVL',       color: '#00e5ff', axis: 'left',  unit: '%',   key: 'ngvl' },
    atm:        { label: 'ATM',        color: '#8b5cf6', axis: 'left',  unit: '%',   key: 'atm' },
    upVar:      { label: 'UP VAR',     color: '#3db87a', axis: 'left',  unit: '%',   key: 'upVar' },
    dnVar:      { label: 'DOWN VAR',   color: '#ef4444', axis: 'left',  unit: '%',   key: 'dnVar' },
    realVol:    { label: 'REALIZED',   color: '#a78bfa', axis: 'left',  unit: '%',   key: 'realVol', dashed: true },
    skewRatio:  { label: 'SKEW RATIO', color: '#f59e0b', axis: 'right2',unit: 'x',   key: 'skewRatio' },
    convexity:  { label: 'CONVEXITY',  color: '#ec4899', axis: 'right2',unit: 'x',   key: 'convexity' },
    underlying: { label: 'NG PRICE',   color: '#94a3b8', axis: 'right', unit: '$',   key: 'underlying' },
    skew:       { label: 'SKEW (pts)', color: '#a78bfa', axis: 'left',  unit: 'pts', key: 'skew' },
};

const VAR_SERIES_CFG = {
    upVar:     { label: 'UP VAR',     color: '#3db87a', key: 'upVar',  desc: 'Bullish Demand Check: Measures the premium paid for upside protection (OTM calls). Rising green area signals aggressive institutional buying often seen before explosive short-gamma breakouts.' },
    dnVar:     { label: 'DN VAR',     color: '#ef4444', key: 'dnVar',  desc: 'Bearish Fear Check: Tracks the cost of downside tail-risk insurance. When the red area expands, the market is bracing for a violent gap-down or capitulation event.' },
    skewRatio: { label: 'SKEW RATIO', color: '#f59e0b', key: 'skewRatio', desc: 'Directional Pressure Gauge: Up variance divided by down variance. >1.0 means upside variance is richer; <1.0 means downside variance is richer.' },
    underlying:{ label: 'NG PRICE',   color: '#94a3b8', key: 'underlying', desc: 'Price Correlation Context: Overlays the absolute front-month Natural Gas settlement price. Vital for identifying if directional volatility spikes are leading or lagging absolute price pivots.' },
    skewRoc5:  { label: 'SKEW MOM',   color: '#818cf8', key: 'skewRoc5', desc: 'Skew Momentum (5D ROC): Rate of change in skew ratio over 5 sessions. Positive = skew accelerating bullish. Negative = skew accelerating bearish. Sharp moves precede directional breakouts.' },
    varSpread: { label: 'VAR SPREAD', color: '#2dd4bf', key: 'varSpread', desc: 'Net Directional Imbalance: UpVar minus DnVar. Positive = call-side richer (bullish demand), negative = put-side richer (downside hedging). The Z-score filters seasonal noise to isolate genuine conviction shifts.' },
    wingDiv:   { label: 'WING DIV',   color: '#fb923c', key: 'wingDiv', desc: 'Wing Divergence Index: |UpVarZ - DnVarZ|. When variance wings diverge, the market is picking a side. High values signal directional conviction; low values signal two-way uncertainty or complacency.' },
    regimeTension: { label: 'TENSION', color: '#fbbf24', key: 'regimeTension', desc: 'Regime Tension Score: ConvexityZ × |VarSpreadZ| × SkewAccel. Composite pressure gauge — elevated tension precedes explosive directional moves or vol expansions. Think of it as the spring being compressed.' },
};

// ── X-Axis engine (reused from flows.html pattern) ────────────
function drawXAxis(ctx, dates, getX, chartW, yBase, pad) {
    const months = MONTHS;
    const count = dates.length;
    if (count < 2) return;
    let ticks = [];
    let isYearMode = false;
    if (count <= 14) {
        for (let i = 0; i < count; i++) ticks.push(i);
    } else if (count <= 65) {
        ticks.push(0); ticks.push(count - 1);
        for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 10))) {
            if (i !== 0 && i !== count - 1) ticks.push(i);
        }
    } else {
        const monthsRange = (new Date(dates[count - 1]) - new Date(dates[0])) / (30 * 86400000);
        if (monthsRange > 36) {
            isYearMode = true;
            const maxYL = Math.floor(chartW / 120);
            const yInt = [1, 2, 3, 5, 10].find(c => c >= Math.max(1, Math.round(monthsRange / 12 / maxYL))) || 1;
            const sy = new Date(dates[0]).getFullYear(), ey = new Date(dates[count - 1]).getFullYear();
            for (let yr = Math.ceil(sy / yInt) * yInt; yr <= ey; yr += yInt) {
                const target = `${yr}-01-01`;
                for (let i = 0; i < count; i++) { if (dates[i] >= target) { if (i !== 0 && i !== count - 1) ticks.push(i); break; } }
            }
        } else {
            ticks.push(0); ticks.push(count - 1);
            const maxL = Math.floor(chartW / 120);
            const mInt = [1, 2, 3, 6, 12].find(c => c >= Math.max(1, Math.round(monthsRange / maxL))) || 1;
            let lastMT = -1;
            dates.forEach((d, i) => {
                const [y, m] = d.split('-').map(Number);
                const mt = y * 12 + m;
                if (mt !== lastMT && (lastMT === -1 || mt - lastMT >= mInt)) {
                    if (i !== 0 && i !== count - 1) ticks.push(i);
                    lastMT = mt;
                }
            });
        }
    }
    ticks = [...new Set(ticks)].sort((a, b) => a - b);
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    let lastLX = -1;
    ticks.forEach(idx => {
        if (!dates[idx]) return;
        const [y, m, day] = dates[idx].split('-').map(Number);
        const x = getX(idx);
        if (x < pad.left + 15 || x > pad.left + chartW - 15) return;
        if (lastLX > -1 && Math.abs(x - lastLX) < 45) return;
        let txt;
        if (count <= 14) txt = months[m - 1] + ' ' + day;
        else if (isYearMode) txt = String(y);
        else txt = months[m - 1] + (count > 365 ? ' ' + y : '');
        ctx.fillText(txt, x, yBase);
        lastLX = x;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + (yBase - pad.top - 15));
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.setLineDash([]); ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.setLineDash([]);
}

// ── toRgba helper ─────────────────────────────────────────────
function toRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

// ── Composite Meta (for expanded cards) ───────────────────────
var COMP_META = {
    sad:     { label: 'SAD - Skew-ATM Divergence', color: '#f59e0b', desc: 'Research input: skew ratio diverging from the ATM volatility baseline. It describes surface pressure; it is not a standalone directional signal.',     threshold: null, thresholdType: 'z', thresholdVal: 1.5 },
    ci:      { label: 'CI - Complacency Index',     color: '#60a8f8', desc: 'Research input: inverse of the 1-year ATM volatility percentile. High values mean fragile calm and possible expansion risk, not automatic direction.',       threshold: 82, thresholdType: 'raw', thresholdVal: 82 },
    cvcDown: { label: 'CVC Down - Convexity/Down Var', color: '#ef4444', desc: 'Research input: convexity aligned with downside variance. It says downside tail protection is bid; historical edge must be checked before treating it as directional.',       threshold: 1.2, thresholdType: 'raw', thresholdVal: 1.2 },
    cvcUp:   { label: 'CVC Up - Convexity/Up Var',   color: '#3db87a', desc: 'Research input: convexity aligned with upside variance. It says upside tail exposure is bid; historical edge must be checked before treating it as directional.',     threshold: 1.2, thresholdType: 'raw', thresholdVal: 1.2 },
    rds:     { label: 'RDS - Regime Divergence Score', color: '#ec4899', desc: 'Research input: fast skew movement, convexity, and low ATM percentile. It flags surface instability and expansion risk, not guaranteed directional edge.',   threshold: null, thresholdType: 'z', thresholdVal: 1.8 },
};

// ── Correlation Matrix ────────────────────────────────────────
var CORR_KEYS = ['ngvl','dnVar','upVar','skew','skewRatio','atm','convexity','underlying'];
var CORR_LABELS = ['NGVL','DN VAR','UP VAR','SKEW','SK RATIO','ATM','CONV','NG $'];

function computeCorrelation(xArr, yArr) {
    var n = 0, sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (var i = 0; i < xArr.length; i++) {
        if (xArr[i] == null || yArr[i] == null) continue;
        n++; sx += xArr[i]; sy += yArr[i]; sxy += xArr[i] * yArr[i];
        sx2 += xArr[i] * xArr[i]; sy2 += yArr[i] * yArr[i];
    }
    if (n < 10) return null;
    var num = n * sxy - sx * sy;
    var den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
    return den > 0 ? num / den : 0;
}

function computeCorrMatrix(data, startIdx, endIdx) {
    var sliced = data;
    if (startIdx != null && endIdx != null) sliced = data.slice(startIdx, endIdx + 1);
    var cols = {};
    CORR_KEYS.forEach(function(k) { cols[k] = sliced.map(function(r) { return r[k]; }); });
    var matrix = [];
    for (var i = 0; i < CORR_KEYS.length; i++) {
        var row = [];
        for (var j = 0; j < CORR_KEYS.length; j++) {
            row.push(i === j ? 1.0 : computeCorrelation(cols[CORR_KEYS[i]], cols[CORR_KEYS[j]]));
        }
        matrix.push(row);
    }
    return matrix;
}

// ── Event Confluence Scoring ──────────────────────────────────
function computeEventConfluence(events) {
    var confMap = {};
    for (var i = 0; i < events.length; i++) {
        var count = 0;
        for (var j = 0; j < events.length; j++) {
            if (i === j || events[j].signal === events[i].signal) continue;
            if (Math.abs(events[j].idx - events[i].idx) <= 5) count++;
        }
        confMap[events[i].idx] = count;
    }
    return confMap;
}

// ── Backtest Scorecard ────────────────────────────────────────
function computeScorecard(composites, regimeFilter) {
    var events = composites.events || [];
    var pct252 = composites.ngvlPct252 || [];
    // Apply regime filter
    if (regimeFilter && regimeFilter !== 'all') {
        events = events.filter(function(ev) {
            var p = pct252[ev.idx];
            if (p == null) return false;
            if (regimeFilter === 'low') return p < 25;
            if (regimeFilter === 'normal') return p >= 25 && p < 75;
            if (regimeFilter === 'high') return p >= 75;
            return true;
        });
    }
    var signals = {};
    events.forEach(function(ev) {
        var key = ev.signal.replace('↓','Down').replace('↑','Up');
        if (!signals[key]) signals[key] = { count: 0, hit5: 0, hit10: 0, hit21: 0, hit42: 0, ret5: [], ret10: [], ret21: [], ret42: [], name: ev.signal, seasonHit: {} };
        signals[key].count++;
        var isDown = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
        var dir = isDown ? -1 : 1; // direction multiplier: makes all ret arrays signal-P&L (positive = signal was right)
        if (ev.fwd5  != null) { signals[key].ret5.push(ev.fwd5  * dir); if ((isDown && ev.fwd5  < 0) || (!isDown && ev.fwd5  > 0)) signals[key].hit5++; }
        if (ev.fwd10 != null) { signals[key].ret10.push(ev.fwd10 * dir); if ((isDown && ev.fwd10 < 0) || (!isDown && ev.fwd10 > 0)) signals[key].hit10++; }
        if (ev.fwd21 != null) {
            signals[key].ret21.push(ev.fwd21 * dir);
            var hit21 = (isDown && ev.fwd21 < 0) || (!isDown && ev.fwd21 > 0);
            if (hit21) signals[key].hit21++;
            var ssn = ev.season || 'unknown';
            if (!signals[key].seasonHit[ssn]) signals[key].seasonHit[ssn] = { hits: 0, total: 0 };
            signals[key].seasonHit[ssn].total++;
            if (hit21) signals[key].seasonHit[ssn].hits++;
        }
        if (ev.fwd42 != null) { signals[key].ret42.push(ev.fwd42 * dir); if ((isDown && ev.fwd42 < 0) || (!isDown && ev.fwd42 > 0)) signals[key].hit42++; }
    });
    // helper: sharpe from a return array
    function calcSharpe(arr) {
        if (arr.length < 3) return null;
        var mean = arr.reduce(function(a,b){return a+b;},0) / arr.length;
        var std = Math.sqrt(arr.reduce(function(a,b){return a+(b-mean)*(b-mean);},0) / arr.length);
        return std > 0 ? mean / std : null;
    }
    var rows = [];
    Object.keys(signals).forEach(function(key) {
        var s = signals[key];
        var avg5  = s.ret5.length  ? s.ret5.reduce(function(a,b){return a+b;},0)  / s.ret5.length  : null;
        var avg10 = s.ret10.length ? s.ret10.reduce(function(a,b){return a+b;},0) / s.ret10.length : null;
        var avg21 = s.ret21.length ? s.ret21.reduce(function(a,b){return a+b;},0) / s.ret21.length : null;
        var avg42 = s.ret42.length ? s.ret42.reduce(function(a,b){return a+b;},0) / s.ret42.length : null;
        var sharpe5  = calcSharpe(s.ret5);
        var sharpe10 = calcSharpe(s.ret10);
        var sharpe21 = calcSharpe(s.ret21);
        var sharpe42 = calcSharpe(s.ret42);
        // Optimal horizon: horizon with best absolute Sharpe (needs ≥3 samples)
        var horizons = [
            { label: '5D',  sharpe: sharpe5,  hr: s.ret5.length  > 0 ? s.hit5  / s.ret5.length  * 100 : null, avg: avg5,  n: s.ret5.length  },
            { label: '10D', sharpe: sharpe10, hr: s.ret10.length > 0 ? s.hit10 / s.ret10.length * 100 : null, avg: avg10, n: s.ret10.length },
            { label: '21D', sharpe: sharpe21, hr: s.ret21.length > 0 ? s.hit21 / s.ret21.length * 100 : null, avg: avg21, n: s.ret21.length },
            { label: '42D', sharpe: sharpe42, hr: s.ret42.length > 0 ? s.hit42 / s.ret42.length * 100 : null, avg: avg42, n: s.ret42.length },
        ];
        var optHorizon = horizons.reduce(function(best, h) {
            if (h.sharpe == null || h.sharpe <= 0 || h.n < 5) return best;
            if (best == null || h.sharpe > best.sharpe) return h;
            return best;
        }, null);
        var sorted21 = s.ret21.slice().sort(function(a,b){return a-b;});
        var median21 = null;
        if (sorted21.length) { var mid = Math.floor(sorted21.length/2); median21 = sorted21.length%2!==0 ? sorted21[mid] : (sorted21[mid-1]+sorted21[mid])/2; }
        var mag21 = s.ret21.length ? s.ret21.reduce(function(a,b){return a+Math.abs(b);},0)/s.ret21.length : null;
        rows.push({
            signal: s.name,
            count: s.count,
            hitRate5:  s.ret5.length  > 0 ? (s.hit5  / s.ret5.length  * 100) : null,
            hitRate10: s.ret10.length > 0 ? (s.hit10 / s.ret10.length * 100) : null,
            hitRate21: s.ret21.length > 0 ? (s.hit21 / s.ret21.length * 100) : null,
            hitRate42: s.ret42.length > 0 ? (s.hit42 / s.ret42.length * 100) : null,
            avgRet5: avg5, avgRet10: avg10, avgRet21: avg21, avgRet42: avg42,
            median21: median21, mag21: mag21,
            best21:  s.ret21.length ? Math.max.apply(null, s.ret21) : null,
            worst21: s.ret21.length ? Math.min.apply(null, s.ret21) : null,
            sharpe5: sharpe5, sharpe10: sharpe10, sharpe21: sharpe21, sharpe42: sharpe42,
            sharpe: sharpe21,  // keep existing field for summary row compat
            horizons: horizons,
            optHorizon: optHorizon,
            seasonalHit21: s.seasonHit,
        });
    });
    // ── Ensemble Confluence Rows ──
    var confMap = computeEventConfluence(events);
    [2, 3].forEach(function(minConf) {
        var confEvents = events.filter(function(ev) { return (confMap[ev.idx] || 0) >= minConf; });
        if (confEvents.length < 2) return;
        var h5=0, h10=0, h21=0, h42=0, r5=[], r10=[], r21=[], r42=[];
        confEvents.forEach(function(ev) {
            var isDown = ev.direction.indexOf('TOP') >= 0 || ev.direction.indexOf('DOWNSIDE') >= 0;
            var dir = isDown ? -1 : 1;
            if (ev.fwd5  != null) { r5.push(ev.fwd5   * dir); if ((isDown && ev.fwd5  < 0) || (!isDown && ev.fwd5  > 0)) h5++;  }
            if (ev.fwd10 != null) { r10.push(ev.fwd10  * dir); if ((isDown && ev.fwd10 < 0) || (!isDown && ev.fwd10 > 0)) h10++; }
            if (ev.fwd21 != null) { r21.push(ev.fwd21  * dir); if ((isDown && ev.fwd21 < 0) || (!isDown && ev.fwd21 > 0)) h21++; }
            if (ev.fwd42 != null) { r42.push(ev.fwd42  * dir); if ((isDown && ev.fwd42 < 0) || (!isDown && ev.fwd42 > 0)) h42++; }
        });
        var a5  = r5.length  ? r5.reduce(function(a,b){return a+b;},0)/r5.length   : null;
        var a10 = r10.length ? r10.reduce(function(a,b){return a+b;},0)/r10.length : null;
        var a21 = r21.length ? r21.reduce(function(a,b){return a+b;},0)/r21.length : null;
        var a42 = r42.length ? r42.reduce(function(a,b){return a+b;},0)/r42.length : null;
        var sh5  = calcSharpe(r5);
        var sh10 = calcSharpe(r10);
        var sh21 = calcSharpe(r21);
        var sh42 = calcSharpe(r42);
        var eHorizons = [
            { label: '5D',  sharpe: sh5,  hr: r5.length  > 0 ? h5  / r5.length  * 100 : null, avg: a5,  n: r5.length  },
            { label: '10D', sharpe: sh10, hr: r10.length > 0 ? h10 / r10.length * 100 : null, avg: a10, n: r10.length },
            { label: '21D', sharpe: sh21, hr: r21.length > 0 ? h21 / r21.length * 100 : null, avg: a21, n: r21.length },
            { label: '42D', sharpe: sh42, hr: r42.length > 0 ? h42 / r42.length * 100 : null, avg: a42, n: r42.length },
        ];
        var eOpt = eHorizons.reduce(function(best, h) {
            if (h.sharpe == null || h.sharpe <= 0 || h.n < 5) return best;
            if (best == null || h.sharpe > best.sharpe) return h;
            return best;
        }, null);
        var s21 = r21.slice().sort(function(a,b){return a-b;});
        var med = null;
        if (s21.length) { var mid = Math.floor(s21.length/2); med = s21.length%2!==0 ? s21[mid] : (s21[mid-1]+s21[mid])/2; }
        var mag = r21.length ? r21.reduce(function(a,b){return a+Math.abs(b);},0)/r21.length : null;
        rows.push({
            signal: 'CONF \u2265' + minConf, isEnsemble: true, count: confEvents.length,
            hitRate5: r5.length > 0 ? (h5/r5.length*100) : null,
            hitRate10: r10.length > 0 ? (h10/r10.length*100) : null,
            hitRate21: r21.length > 0 ? (h21/r21.length*100) : null,
            hitRate42: r42.length > 0 ? (h42/r42.length*100) : null,
            avgRet5: a5, avgRet10: a10, avgRet21: a21, avgRet42: a42,
            median21: med, mag21: mag,
            best21: s21.length ? Math.max.apply(null, s21) : null,
            worst21: s21.length ? Math.min.apply(null, s21) : null,
            sharpe5: sh5, sharpe10: sh10, sharpe21: sh21, sharpe42: sh42,
            sharpe: sh21,
            horizons: eHorizons,
            optHorizon: eOpt,
        });
    });
    return rows;
}

// ── Regime Heatmap Data ───────────────────────────────────────
function computeHeatmapData(data) {
    // Group by year-month, compute mean NGVL & regime
    var months = {};
    data.forEach(function(r) {
        var parts = r.date.split('-');
        var key = parts[0] + '-' + parts[1]; // YYYY-MM
        if (!months[key]) months[key] = { ngvl: [], underlying: [], skewRatio: [] };
        if (r.ngvl != null) months[key].ngvl.push(r.ngvl);
        if (r.underlying != null) months[key].underlying.push(r.underlying);
        if (r.skewRatio != null) months[key].skewRatio.push(r.skewRatio);
    });
    // Rank each month's avg NGVL against ALL monthly averages (not daily data)
    var sortedKeys = Object.keys(months).sort();
    var allMonthlyAvgs = sortedKeys.map(function(key) {
        return months[key].ngvl.reduce(function(a,b){return a+b;},0) / months[key].ngvl.length;
    });
    var rankedMonthlyAvgs = allMonthlyAvgs.slice().sort(function(a,b) { return a - b; });
    var result = {};
    sortedKeys.forEach(function(key, ki) {
        var m = months[key];
        var avgNgvl = allMonthlyAvgs[ki];
        var avgUnd = m.underlying.reduce(function(a,b){return a+b;},0) / m.underlying.length;
        var avgSk = m.skewRatio.length ? m.skewRatio.reduce(function(a,b){return a+b;},0) / m.skewRatio.length : null;
        // Percentile of avgNgvl vs all other monthly averages
        var rank = 0;
        for (var i = 0; i < rankedMonthlyAvgs.length; i++) { if (rankedMonthlyAvgs[i] <= avgNgvl) rank++; }
        var pct = (rank / rankedMonthlyAvgs.length) * 100;
        result[key] = { avgNgvl: avgNgvl, avgUnderlying: avgUnd, avgSkewRatio: avgSk, pct: pct, regime: ngvlRegime(pct) };
    });
    return result;
}

// ── Threshold Sensitivity ─────────────────────────────────────
// For each signal, re-detect events at 3 threshold levels and report count + hit rate.
function computeThresholdSensitivity(composites, data) {
    var n = data.length;
    var underlying = data.map(function(r) { return r.underlying; });
    var sadZ = composites.sadZ;
    var rdsZ = composites.rdsZ;
    var ci   = composites.ci ? null : null; // ci is direct value, not a Z
    // Reconstruct component arrays
    var ciArr = [], cvcDownArr = [], cvcUpArr = [];
    data.forEach(function(r) {
        ciArr.push(r.ci != null ? r.ci : (composites.ci ? composites.ci[data.indexOf(r)] : null));
        cvcDownArr.push(r.cvcDown != null ? r.cvcDown : null);
        cvcUpArr.push(r.cvcUp != null ? r.cvcUp : null);
    });
    // Use composites arrays directly
    var ciA    = composites.ci    || data.map(function(r){ return r.ci || null; });
    var cvcDA  = composites.cvcDown || data.map(function(r){ return r.cvcDown || null; });
    var cvcUA  = composites.cvcUp   || data.map(function(r){ return r.cvcUp || null; });
    var sadZA  = composites.sadZ  || [];
    var rdsZA  = composites.rdsZ  || [];

    // Signal configs: { name, key, thresholds: [tight, base, loose], getVal, isAbove }
    var configs = [
        { name: 'RDS',  getVal: function(i) { return rdsZA[i]; }, thresholds: [2.3, 1.8, 1.3], isAbove: true,
          dirFn: function(i) { return composites.skewRatioRoc5 && composites.skewRatioRoc5[i] > 0 ? 'UPSIDE SETUP' : 'DOWNSIDE SETUP'; } },
        { name: 'SAD',  getVal: function(i) { return sadZA[i] != null ? Math.abs(sadZA[i]) : null; }, thresholds: [2.0, 1.5, 1.0], isAbove: true,
          dirFn: function(i) { return sadZA[i] != null && sadZA[i] > 0 ? 'UPSIDE SKEW' : 'DOWNSIDE SKEW'; } },
        { name: 'CI',   getVal: function(i) { return ciA[i]; }, thresholds: [87, 82, 77], isAbove: true,
          dirFn: function() { return 'COMPLACENCY'; } },
        { name: 'CVC\u2193', getVal: function(i) { return cvcDA[i]; }, thresholds: [1.7, 1.2, 0.8], isAbove: true,
          dirFn: function() { return 'DOWNSIDE INPUT'; } },
        { name: 'CVC\u2191', getVal: function(i) { return cvcUA[i]; }, thresholds: [1.7, 1.2, 0.8], isAbove: true,
          dirFn: function() { return 'UPSIDE INPUT'; } },
    ];

    function hitRateAtThreshold(cfg, threshold) {
        var events = [], lastFire = {};
        for (var i = 63; i < n; i++) {
            var val = cfg.getVal(i);
            if (val == null) continue;
            var triggered = cfg.isAbove ? val > threshold : val < threshold;
            if (!triggered) continue;
            var lastIdx = lastFire[cfg.name] || -999;
            if (i - lastIdx < 10) continue;
            lastFire[cfg.name] = i;
            var dir = cfg.dirFn(i);
            var isDown = dir.indexOf('TOP') >= 0 || dir.indexOf('DOWNSIDE') >= 0;
            var fwd21 = cvolForwardReturn(data, i, 21);
            if (fwd21 != null) {
                var hit = (isDown && fwd21 < 0) || (!isDown && fwd21 > 0);
                events.push({ hit: hit });
            }
        }
        if (events.length === 0) return { count: 0, hitRate: null };
        var hits = events.filter(function(e) { return e.hit; }).length;
        return { count: events.length, hitRate: hits / events.length * 100 };
    }

    var result = [];
    configs.forEach(function(cfg) {
        var levels = [
            { label: 'TIGHTER (+0.5)', threshold: cfg.thresholds[0] },
            { label: 'BASELINE', threshold: cfg.thresholds[1] },
            { label: 'LOOSER (-0.5)', threshold: cfg.thresholds[2] },
        ];
        var rows = levels.map(function(lv) {
            var r = hitRateAtThreshold(cfg, lv.threshold);
            return { label: lv.label, threshold: lv.threshold, count: r.count, hitRate: r.hitRate };
        });
        result.push({ signal: cfg.name, rows: rows });
    });
    return result;
}
