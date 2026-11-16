#!/usr/bin/env python3
"""
build_cvol_tradeable.py — tradeable NG return series for the CVOL tab.

WHY THIS EXISTS
The UNDERLYING column in ngvl_cvol_history.csv is the front options-month
future. It switches contract around the 16th-21st of every month, and in a
contango market that switch prints as a one-day "gain" nobody can earn
(e.g. 2025-10-20: +34% in the column, +6% in reality). Measured on that
column NG lost ~10% between Oct-2013 and Nov-2026; an investor actually
holding rolled futures lost ~97%. Any forward-return or realized-vol
statistic computed on the raw column is therefore biased:
  * forward returns  -> inflated up-rates, worst in winter (steep contango)
  * realized vol     -> inflated by roll jumps, which fakes a "vol underpriced" read

This script writes two clean level series, aligned to the CVOL dates:
  idx_px : roll-adjusted, unlevered NG exposure. Built from the BOIL / KOLD
           pair: (r_BOIL - r_KOLD) / 4 is the daily return of the index both
           funds track, with fees cancelling. This is the return a BOIL/KOLD
           trader actually receives (before leverage decay).
  fm_px  : roll-free front-month level. Daily return = median of
           (raw CVOL underlying, Yahoo NG=F, beta * index). The two front-month
           sources roll on different days, so the median discards whichever
           one is rolling. Used for realized vol against CVOL implied vol.

Stdlib only. Run from the repo root:
    python scripts/build_cvol_tradeable.py
"""

import csv
import json
import sys
from datetime import date
from pathlib import Path

CVOL_CSV = Path("data/cvol/ngvl_cvol_history.csv")
DASHBOARD_JSON = Path("data/dashboard_data.json")
NG_HISTORY_JSON = Path("data/ng_history.json")
OUT_PATHS = [Path("data/cvol/ng_tradeable.csv"), Path("docs/data/cvol/ng_tradeable.csv")]

FRONT_BETA = 1.04          # front-month vs index daily beta on non-roll days
PAIR_DISAGREE = 0.08       # |r_BOIL/2 + r_KOLD/2| above this = bad print / unadjusted split
ROLL_TOLERANCE = 0.03      # two-source fallback: accept raw front-month move within this of beta*index


def load_cvol_underlying():
    """Return [(iso_date, underlying)] for weekday rows, sorted."""
    rows = []
    with CVOL_CSV.open(newline="") as fh:
        reader = csv.DictReader(fh)
        for r in reader:
            try:
                dd, mm, yyyy = r["Timestamp"].strip().split("-")
                d = date(int(yyyy), int(mm), int(dd))
                und = float(r["UNDERLYING"])
            except (ValueError, KeyError):
                continue
            if d.weekday() >= 5:      # Sunday-evening Globex snapshots are not trading days
                continue
            rows.append((d.isoformat(), und))
    rows.sort()
    return rows


def load_closes(history):
    out = {}
    for bar in history:
        c = bar.get("close")
        if c is not None and c > 0:
            out[bar["date"]] = float(c)
    return out


def build_index_levels(boil, kold):
    """Roll-adjusted unlevered index on the ETF calendar. Returns {date: level}."""
    dates = sorted(set(boil) & set(kold))
    levels = {}
    level = 100.0
    warnings = 0
    for i, d in enumerate(dates):
        if i > 0:
            p = dates[i - 1]
            rb = boil[d] / boil[p] - 1.0
            rk = kold[d] / kold[p] - 1.0
            if abs(rb / 2.0 + rk / 2.0) > PAIR_DISAGREE:
                # The pair should mirror each other. When it does not, trust the smaller move.
                r = rb / 2.0 if abs(rb) < abs(rk) else -rk / 2.0
                warnings += 1
            else:
                r = (rb - rk) / 4.0
            level *= 1.0 + r
        levels[d] = level
    if warnings:
        print(f"  warning: {warnings} day(s) where BOIL and KOLD disagreed by > {PAIR_DISAGREE:.0%}")
    return levels


def build_closing_pressure(boil_bars, kold_bars, window=21, min_history=252):
    """
    Closing pressure: (CMF21_BOIL - CMF21_KOLD) / 2 on dollar volume,
    and its expanding percentile with min_history. Matches AlertEngine.buildFrame.
    Returns {date: cp_percentile}.
    """
    b_map = {b["date"]: b for b in boil_bars if b and b.get("close", 0) > 0}
    k_map = {b["date"]: b for b in kold_bars if b and b.get("close", 0) > 0}
    dates = sorted(set(b_map) & set(k_map))
    if len(dates) < min_history + 30:
        return {}

    def calc_cmf(bars):
        mfv = []
        dv = []
        for d in dates:
            b = bars[d]
            h = b.get("high", b["close"])
            l = b.get("low", b["close"])
            c = b["close"]
            v = b.get("volume", 0) or 0
            dvol = c * v
            m = ((c - l) - (h - c)) / (h - l) * dvol if (h is not None and l is not None and h > l) else 0.0
            mfv.append(m)
            dv.append(dvol)
        out = [None] * len(dates)
        a = 0.0
        tot_d = 0.0
        for i in range(len(dates)):
            a += mfv[i]
            tot_d += dv[i]
            if i >= window:
                a -= mfv[i - window]
                tot_d -= dv[i - window]
            if i >= window - 1 and tot_d > 0:
                out[i] = a / tot_d
        return out

    cb = calc_cmf(b_map)
    ck = calc_cmf(k_map)
    cp = [None if cb[i] is None or ck[i] is None else (cb[i] - ck[i]) / 2.0 for i in range(len(dates))]

    cp_pe = {}
    for i in range(min_history - 1, len(dates)):
        v = cp[i]
        if v is None:
            continue
        count = 0
        below = 0.0
        for j in range(i + 1):
            u = cp[j]
            if u is not None:
                count += 1
                if u < v:
                    below += 1.0
                elif u == v:
                    below += 0.5
        if count >= min_history:
            cp_pe[dates[i]] = (below / count) * 100.0
    return cp_pe


def ffill_lookup(series):
    """Return f(date) giving the last value on or before date (None before first)."""
    keys = sorted(series)

    def lookup(d):
        lo, hi = 0, len(keys)
        while lo < hi:
            mid = (lo + hi) // 2
            if keys[mid] <= d:
                lo = mid + 1
            else:
                hi = mid
        return series[keys[lo - 1]] if lo else None

    return lookup


def median3(a, b, c):
    return sorted((a, b, c))[1]


def main():
    for p in (CVOL_CSV, DASHBOARD_JSON, NG_HISTORY_JSON):
        if not p.exists():
            print(f"build_cvol_tradeable: missing {p} — nothing written")
            return 0

    cvol = load_cvol_underlying()
    dash = json.loads(DASHBOARD_JSON.read_text())
    etfs = dash.get("etfs", {})
    if "BOIL" not in etfs or "KOLD" not in etfs:
        print("build_cvol_tradeable: BOIL/KOLD history missing — nothing written")
        return 0
    boil = load_closes(etfs["BOIL"].get("history", []))
    kold = load_closes(etfs["KOLD"].get("history", []))
    ngf = load_closes(json.loads(NG_HISTORY_JSON.read_text()))

    idx_levels = build_index_levels(boil, kold)
    idx_at = ffill_lookup(idx_levels)
    ngf_at = ffill_lookup(ngf)
    cp_dict = build_closing_pressure(etfs["BOIL"].get("history", []), etfs["KOLD"].get("history", []))
    cp_at = ffill_lookup(cp_dict)

    out_rows = []
    fm_level = None
    prev = None  # (und, idx, ngf)
    for d, und in cvol:
        idx = idx_at(d)
        nf = ngf_at(d)
        cp_val = cp_at(d)
        if fm_level is None:
            fm_level = und
        elif prev is not None:
            p_und, p_idx, p_ngf = prev
            r_und = und / p_und - 1.0 if p_und else None
            r_idx = idx / p_idx - 1.0 if (idx and p_idx) else None
            r_ngf = nf / p_ngf - 1.0 if (nf and p_ngf) else None
            if r_und is not None and r_idx is not None and r_ngf is not None:
                r = median3(r_und, r_ngf, FRONT_BETA * r_idx)
            elif r_und is not None and r_idx is not None:
                r = r_und if abs(r_und - FRONT_BETA * r_idx) < ROLL_TOLERANCE else FRONT_BETA * r_idx
            elif r_und is not None:
                r = r_und
            else:
                r = 0.0
            fm_level *= 1.0 + r
        out_rows.append((d, idx, fm_level, cp_val))
        prev = (und, idx, nf)

    # Re-anchor the roll-free front-month level so its last value equals the last raw underlying.
    if out_rows and cvol:
        scale = cvol[-1][1] / out_rows[-1][2] if out_rows[-1][2] else 1.0
        out_rows = [(d, idx, fm * scale, cp) for d, idx, fm, cp in out_rows]

    for path in OUT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["Date", "idx_px", "fm_px", "cp_pe"])
            for d, idx, fm, cp in out_rows:
                w.writerow([
                    d,
                    "" if idx is None else f"{idx:.6f}",
                    f"{fm:.6f}",
                    "" if cp is None else f"{cp:.2f}"
                ])

    have_idx = [r for r in out_rows if r[1] is not None]
    print(f"build_cvol_tradeable: {len(out_rows)} rows ({len(have_idx)} with index level), "
          f"{out_rows[0][0]} -> {out_rows[-1][0]}")
    if len(have_idx) > 1:
        tot_idx = have_idx[-1][1] / have_idx[0][1] - 1.0
        tot_raw = cvol[-1][1] / cvol[0][1] - 1.0
        print(f"  raw underlying total return {tot_raw:+.1%} | tradeable index {tot_idx:+.1%}")

    # Settle sanity check: compare latest UNDERLYING with latest ng_history.json close
    if cvol and ngf:
        latest_cvol_date, latest_und = cvol[-1]
        latest_ngf_close = ngf.get(latest_cvol_date)
        if latest_ngf_close:
            try:
                day_num = int(latest_cvol_date.split("-")[2])
            except Exception:
                day_num = 1
            diff_pct = abs(latest_und / latest_ngf_close - 1.0)
            if (day_num < 16 or day_num > 21) and diff_pct > 0.01:
                print(f"  warning: latest UNDERLYING ({latest_und}) differs from NG close ({latest_ngf_close}) by {diff_pct:.2%}")
            else:
                print(f"  sanity check: latest UNDERLYING ({latest_und}) vs NG close ({latest_ngf_close}) gap = {diff_pct * 10000:.1f} bp")
    return 0


if __name__ == "__main__":
    sys.exit(main())
