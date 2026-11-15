#!/usr/bin/env python3
"""
cvol_edge_research.py — reproduces the evidence behind the CVOL Directional Edge panel.

Run from the repo root (needs pandas + numpy):
    python tools/cvol_edge_research.py

Sections
  1. Roll contamination of the raw UNDERLYING column
  2. Base rates: raw column vs tradeable index
  3. Forward tradeable returns by skew-ratio bucket
  4. The three edge states, with a circular-shift permutation test and split halves
  5. What the surface looks like at actual peaks and troughs
  6. Implied vs realized vol on a roll-free series
  7. Leveraged-ETF volatility drag by NGVL level

The live page (docs/js/cvol.js: computeEdgeModel) recomputes section 4 in the browser;
tools/test_cvol.js pins the definitions. This script exists so the numbers can be
re-derived independently and the thresholds re-examined as history grows.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
pd.set_option("display.width", 220)
pd.set_option("display.max_rows", 200)


def load():
    c = pd.read_csv(ROOT / "data/cvol/ngvl_cvol_history.csv")
    c["date"] = pd.to_datetime(c["Timestamp"], format="%d-%m-%Y")
    c = c.drop(columns="Timestamp").set_index("date").sort_index()
    c.columns = ["ngvl", "dn", "up", "skew", "sr", "atm", "conv", "und"]
    c = c[c.index.dayofweek < 5]                       # drop Sunday-evening snapshot rows
    t = pd.read_csv(ROOT / "data/cvol/ng_tradeable.csv", parse_dates=["Date"]).set_index("Date")
    c = c.join(t).dropna(subset=["idx_px", "fm_px"])
    dash = json.loads((ROOT / "data/dashboard_data.json").read_text())
    for tick in ("BOIL", "KOLD"):
        h = pd.DataFrame(dash["etfs"][tick]["history"])
        h["date"] = pd.to_datetime(h["date"])
        c[tick.lower()] = h.set_index("date")["close"].reindex(c.index).ffill()
    return c


def fwd(px, h):
    return px.shift(-h) / px - 1


def expanding_pct(s, min_n=252):
    v = s.values
    out = np.full(len(v), np.nan)
    for i in range(min_n - 1, len(v)):
        out[i] = (v[: i + 1] <= v[i]).mean() * 100
    return pd.Series(out, index=s.index)


def perm_p(mask, y, downside, n_shift=600):
    """Share of circularly shifted copies of the signal whose mean forward return is at least as favourable."""
    mask = np.asarray(mask)
    y = np.asarray(y, dtype=float)
    obs = np.nanmean(y[mask])
    n = len(mask)
    sims = np.array([np.nanmean(y[np.roll(mask, s)]) for s in np.linspace(63, n - 63, n_shift).astype(int)])
    return float((sims <= obs).mean() if downside else (sims >= obs).mean())


def episodes(mask, gap=10):
    idx = np.where(np.asarray(mask))[0]
    return 0 if len(idx) == 0 else 1 + int((np.diff(idx) > gap).sum())


def main():
    c = load()
    lr_idx = np.log(c.idx_px).diff()
    lr_fm = np.log(c.fm_px).diff()
    for h in (5, 10, 21, 42):
        c[f"f{h}"] = fwd(c.idx_px, h) * 100      # tradeable
        c[f"u{h}"] = fwd(c.und, h) * 100         # raw column
    d = c.iloc[252:].copy()

    print("\n1. ROLL CONTAMINATION")
    r_und, r_idx = c.und.pct_change(), c.idx_px.pct_change()
    jumps = (r_und - r_idx)[(r_und - r_idx).abs() > 0.05]
    print(f"   total return {c.index[0].date()} -> {c.index[-1].date()}: raw column {c.und.iloc[-1] / c.und.iloc[0] - 1:+.1%}"
          f" | tradeable index {c.idx_px.iloc[-1] / c.idx_px.iloc[0] - 1:+.1%}")
    print(f"   days where the raw column differs from the tradeable index by > 5%: {len(jumps)}"
          f" ({(jumps.index.day >= 13).mean():.0%} fall on or after the 13th of the month)")
    print("   largest:", ", ".join(f"{k.date()} raw {r_und[k]:+.0%} vs {r_idx[k]:+.0%}" for k in jumps.abs().nlargest(4).index))

    print("\n2. BASE RATES (share of days higher h sessions later / mean return)")
    for h in (5, 10, 21, 42):
        print(f"   {h:>2}D  raw column {(d[f'u{h}'] > 0).mean():.1%} / {d[f'u{h}'].mean():+.2f}%"
              f"   tradeable {(d[f'f{h}'] > 0).mean():.1%} / {d[f'f{h}'].mean():+.2f}%")

    print("\n3. FORWARD TRADEABLE RETURN BY SKEW-RATIO BUCKET")
    g = d.groupby(pd.cut(d.sr, [0, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 3]), observed=True)
    print(pd.DataFrame({"n": g.size(), "f5": g.f5.mean(), "f10": g.f10.mean(), "f21": g.f21.mean(),
                        "up21%": g.f21.apply(lambda x: (x > 0).mean() * 100), "f42": g.f42.mean()}).round(1).to_string())

    print("\n4. EDGE STATES")
    sr_pe, vol_pe = expanding_pct(c.sr), expanding_pct(c.ngvl)
    move5 = np.log(c.idx_px / c.idx_px.shift(5)) / (0.8 * c.ngvl.shift(5) / 100 * np.sqrt(5 / 252))
    dvol5 = np.log(c.ngvl / c.ngvl.shift(5))
    blow = (sr_pe >= 95) & (vol_pe >= 90)
    stress = (sr_pe >= 90) & (vol_pe >= 90) & ~blow
    flush = (move5 <= -1.5) & (dvol5 > 0.05) & ~blow & ~stress
    half = pd.Timestamp("2020-06-01")
    for name, m, down in (("BLOW-OFF FADE", blow, True), ("UPSIDE STRESS", stress, True), ("PANIC FLUSH", flush, False)):
        m = m.reindex(d.index).fillna(False).values
        x = d[m]
        print(f"   {name:14s} days {m.sum():4d}  episodes {episodes(m):3d}")
        for h in (5, 10, 21, 42):
            print(f"      {h:>2}D mean {x[f'f{h}'].mean():+6.1f}%  median {x[f'f{h}'].median():+6.1f}%  up {(x[f'f{h}'] > 0).mean():4.0%}"
                  f"  permutation p = {perm_p(m, d[f'f{h}'].values, down):.3f}")
        a, b = x[x.index < half], x[x.index >= half]
        print(f"      halves (21D mean / up): pre-Jun-2020 {a.f21.mean():+.1f}% / {(a.f21 > 0).mean():.0%} (n={len(a)})"
              f"   post {b.f21.mean():+.1f}% / {(b.f21 > 0).mean():.0%} (n={len(b)})")
    on = pd.Series(stress.reindex(d.index).fillna(False).values.astype(int), index=d.index)
    persist = on.rolling(10, min_periods=1).sum()
    for lab, m in (("isolated (<3 of last 10)", (on == 1) & (persist < 3)), ("confirmed (>=3 of last 10)", (on == 1) & (persist >= 3))):
        x = d[m]
        print(f"   UPSIDE STRESS {lab:27s} n={len(x):3d}  21D {x.f21.mean():+.1f}%  up {(x.f21 > 0).mean():.0%}")
    drop = move5.reindex(d.index) <= -1.5
    for lab, m in (("vol rising  > +5%", dvol5.reindex(d.index) > 0.05), ("vol flat", dvol5.reindex(d.index).between(-0.05, 0.05)),
                   ("vol falling < -5%", dvol5.reindex(d.index) < -0.05)):
        x = d[drop & m]
        print(f"   5D drop >= 1.5 sigma & {lab:18s} n={len(x):3d}  10D {x.f10.mean():+.1f}%  21D {x.f21.mean():+.1f}%  up {(x.f21 > 0).mean():.0%}")

    print("\n5. SURFACE AT 25% SWING PEAKS AND TROUGHS (median across events)")
    lp = np.log(c.idx_px.values)
    piv, hi, lo, trend, thr = [], 0, 0, 0, np.log(1.25)
    for i in range(1, len(lp)):
        if trend >= 0:
            if lp[i] > lp[hi]:
                hi = i
            if lp[hi] - lp[i] > thr:
                piv.append((hi, "P")); trend = -1; lo = i
        if trend <= 0:
            if lp[i] < lp[lo]:
                lo = i
            if lp[i] - lp[lo] > thr:
                piv.append((lo, "T")); trend = 1; hi = i
    c["sr_p63"] = c.sr.rolling(63).rank(pct=True) * 100
    c["svcorr21"] = lr_idx.rolling(21).corr(np.log(c.ngvl).diff())
    for kind, lab in (("P", "peaks"), ("T", "troughs")):
        idx = [i for i, k in piv if k == kind and i > 260]
        ev = c.iloc[idx]
        pre = c.iloc[[i - 5 for i in idx]]
        print(f"   {lab:8s} n={len(idx):2d}  skew-ratio 63d pct {ev.sr_p63.median():5.1f}  share >80th {(ev.sr_p63 > 80).mean():4.0%}"
              f"  NGVL at pivot {ev.ngvl.median():5.1f} vs 5 sessions earlier {pre.ngvl.median():5.1f}  spot-vol corr {ev.svcorr21.median():+.2f}")
    print(f"   all days: skew-ratio 63d pct {c.sr_p63.median():.1f}, spot-vol corr {c.svcorr21.median():+.2f}")

    print("\n6. IMPLIED vs REALIZED (21 sessions, annualised %)")
    rv_raw = np.log(c.und).diff().rolling(21).std() * np.sqrt(252) * 100
    rv_fm = lr_fm.rolling(21).std() * np.sqrt(252) * 100
    frv_fm = lr_fm[::-1].rolling(21).std()[::-1].shift(-1) * np.sqrt(252) * 100
    print(f"   median trailing RV: raw column {rv_raw.median():.1f} | roll-free front month {rv_fm.median():.1f} | NGVL {c.ngvl.median():.1f}")
    print(f"   days trailing RV > NGVL: raw column {(rv_raw > c.ngvl).mean():.1%} | roll-free {(rv_fm > c.ngvl).mean():.1%}")
    print(f"   forward roll-free RV / NGVL: median {(frv_fm / c.ngvl).median():.2f}; forward RV exceeded NGVL on {(frv_fm > c.ngvl).mean():.1%} of days")
    both = pd.concat([np.log(frv_fm), np.log(c.ngvl), np.log(rv_fm)], axis=1).dropna()
    print(f"   forecasting forward RV: corr^2 with NGVL {both.iloc[:, 0].corr(both.iloc[:, 1]) ** 2:.2f} | with trailing RV {both.iloc[:, 0].corr(both.iloc[:, 2]) ** 2:.2f}")

    print("\n7. LEVERAGED-ETF VOLATILITY DRAG OVER 21 SESSIONS, BY NGVL")
    li = np.log(c.idx_px.shift(-21) / c.idx_px)
    drag_b = (np.exp(np.log(c.boil.shift(-21) / c.boil) - 2 * li) - 1) * 100
    drag_k = (np.exp(np.log(c.kold.shift(-21) / c.kold) + 2 * li) - 1) * 100
    g = pd.DataFrame({"ngvl": c.ngvl, "BOIL": drag_b, "KOLD": drag_k}).dropna().groupby(
        lambda k: pd.cut([c.ngvl[k]], [0, 40, 55, 70, 85, 100, 250])[0], observed=True)
    print(g.agg(n=("BOIL", "size"), BOIL_median=("BOIL", "median"), KOLD_median=("KOLD", "median")).round(1).to_string())
    print()


if __name__ == "__main__":
    main()
