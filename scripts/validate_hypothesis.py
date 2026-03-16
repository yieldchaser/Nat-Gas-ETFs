#!/usr/bin/env python3
"""
Statistical validation of the price-volume inverse relationship hypothesis
for Natural Gas ETFs (BOIL, HNU, KOLD, HND, 3NGL, 3NGS).

Hypothesis: Volume tends to be higher when prices are lower (inverse relationship).

Tests performed per ETF:
  1. Spearman rank correlation (price vs volume)
  2. Mann-Whitney U test: volume on bottom-10th-percentile price days vs others
  3. Rolling 90-day Spearman correlation for stability
  4. Event study: average volume around N-day price lows
"""

import json
import os
import warnings
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy import stats

warnings.filterwarnings("ignore", category=UserWarning)

# ── Configuration ──────────────────────────────────────────────────────────────

EXCEL_PATH = "/home/user/Nat-Gas-ETFs/Natural Gas ETFs.xlsx"
OUTPUT_PATH = "/home/user/Nat-Gas-ETFs/data/validation_results.json"

# Sheet layout: (sheet_name, etf1_name, etf1_cols, etf2_name, etf2_cols)
# Columns are 0-indexed (A=0, B=1, ...)
SHEET_CONFIG = [
    ("BOIL & HNU", "BOIL", {"date": 0, "close": 1, "volume": 2},
                   "HNU",  {"date": 20, "close": 21, "volume": 22}),
    ("KOLD & HND", "KOLD", {"date": 0, "close": 1, "volume": 2},
                   "HND",  {"date": 20, "close": 21, "volume": 22}),
    ("3NGL & 3NGS", "3NGL", {"date": 0, "close": 1, "volume": 2},
                    "3NGS", {"date": 16, "close": 17, "volume": 18}),
]

ETF_TYPE = {
    "BOIL": "long", "HNU": "long", "3NGL": "long",
    "KOLD": "short", "HND": "short", "3NGS": "short",
}

EXCEL_EPOCH = datetime(1899, 12, 30)  # Excel serial date epoch


def excel_serial_to_date(serial):
    """Convert an Excel serial number to a Python datetime."""
    if isinstance(serial, (int, float)) and not np.isnan(serial):
        return EXCEL_EPOCH + timedelta(days=int(serial))
    return serial  # already datetime or NaT


# ── Step 1: Exploratory reading ───────────────────────────────────────────────

def explore_sheets():
    """Print column headers and first few rows of each data sheet."""
    print("=" * 80)
    print("STEP 1: EXPLORATORY READING OF EXCEL SHEETS")
    print("=" * 80)
    for sheet_name in ["BOIL & HNU", "KOLD & HND", "3NGL & 3NGS"]:
        df_raw = pd.read_excel(EXCEL_PATH, sheet_name=sheet_name, header=None,
                               nrows=7)
        print(f"\n--- {sheet_name} (first 7 rows) ---")
        print(df_raw.to_string(max_cols=25))
    print()


# ── Step 2: Extract price + volume time series ────────────────────────────────

def extract_etf_data():
    """Return dict of {etf_name: DataFrame(date, close, volume)}."""
    etf_data = {}

    for sheet_name, name1, cols1, name2, cols2 in SHEET_CONFIG:
        df_raw = pd.read_excel(EXCEL_PATH, sheet_name=sheet_name, header=None,
                               skiprows=2)  # skip row 1 (#VALUE!) and row 2 (headers)

        for etf_name, cols in [(name1, cols1), (name2, cols2)]:
            df = pd.DataFrame({
                "date": df_raw.iloc[:, cols["date"]],
                "close": df_raw.iloc[:, cols["close"]],
                "volume": df_raw.iloc[:, cols["volume"]],
            })

            # Convert dates
            df["date"] = df["date"].apply(excel_serial_to_date)
            df["date"] = pd.to_datetime(df["date"], errors="coerce")

            # Coerce numeric
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df["volume"] = pd.to_numeric(df["volume"], errors="coerce")

            # Drop rows with any NaN
            df = df.dropna().reset_index(drop=True)

            # Filter out zero-volume days (non-trading)
            df = df[df["volume"] > 0].reset_index(drop=True)

            etf_data[etf_name] = df
            print(f"  {etf_name}: {len(df)} trading days, "
                  f"date range {df['date'].min().date()} to {df['date'].max().date()}, "
                  f"price range {df['close'].min():.2f}-{df['close'].max():.2f}")

    return etf_data


# ── Step 3: Statistical tests ─────────────────────────────────────────────────

def spearman_correlation(df):
    """Spearman rank correlation between price and volume."""
    rho, pval = stats.spearmanr(df["close"], df["volume"])
    return {"rho": round(rho, 6), "p_value": float(f"{pval:.2e}"),
            "n": len(df), "significant": pval < 0.05}


def mann_whitney_test(df, percentile=10):
    """Mann-Whitney U test: volume on bottom-percentile price days vs rest."""
    threshold = np.percentile(df["close"], percentile)
    low_price_vol = df.loc[df["close"] <= threshold, "volume"]
    other_vol = df.loc[df["close"] > threshold, "volume"]

    if len(low_price_vol) < 5 or len(other_vol) < 5:
        return {"error": "insufficient data"}

    u_stat, pval = stats.mannwhitneyu(low_price_vol, other_vol,
                                      alternative="greater")
    return {
        "U_statistic": float(u_stat),
        "p_value": float(f"{pval:.2e}"),
        "significant": pval < 0.05,
        "price_threshold_pct": percentile,
        "price_threshold_value": round(float(threshold), 4),
        "n_low_price_days": int(len(low_price_vol)),
        "n_other_days": int(len(other_vol)),
        "median_volume_low_price": float(low_price_vol.median()),
        "median_volume_other": float(other_vol.median()),
        "volume_ratio": round(float(low_price_vol.median() / other_vol.median()), 4)
            if other_vol.median() > 0 else None,
    }


def rolling_spearman(df, window=90):
    """Rolling 90-day Spearman correlation. Returns summary stats."""
    if len(df) < window:
        return {"error": "insufficient data for rolling window"}

    rolling_rhos = []
    for i in range(len(df) - window + 1):
        chunk = df.iloc[i:i + window]
        rho, _ = stats.spearmanr(chunk["close"], chunk["volume"])
        if not np.isnan(rho):
            rolling_rhos.append(rho)

    arr = np.array(rolling_rhos)
    pct_negative = float(np.mean(arr < 0) * 100)
    return {
        "window_days": window,
        "n_windows": len(rolling_rhos),
        "mean_rho": round(float(np.mean(arr)), 6),
        "median_rho": round(float(np.median(arr)), 6),
        "std_rho": round(float(np.std(arr)), 6),
        "min_rho": round(float(np.min(arr)), 6),
        "max_rho": round(float(np.max(arr)), 6),
        "pct_windows_negative": round(pct_negative, 2),
        "pct_windows_positive": round(100 - pct_negative, 2),
    }


def event_study(df, lookback=60, window_around=5):
    """Average volume around N-day price lows.

    Finds dates where price hits a rolling `lookback`-day low, then measures
    average volume in a +/- `window_around` day window around those events.
    """
    if len(df) < lookback + window_around:
        return {"error": "insufficient data"}

    # Find rolling low points
    rolling_min = df["close"].rolling(window=lookback, min_periods=lookback).min()
    is_low = (df["close"] == rolling_min) & rolling_min.notna()
    low_indices = df.index[is_low].tolist()

    if len(low_indices) < 3:
        return {"error": "too few low events found", "n_events": len(low_indices)}

    # Collect volume around each event
    event_volumes = []
    baseline_volumes = []
    for idx in low_indices:
        start = max(0, idx - window_around)
        end = min(len(df), idx + window_around + 1)
        event_vol = df.iloc[start:end]["volume"].mean()
        event_volumes.append(event_vol)

    # Baseline: overall median volume
    baseline_median = df["volume"].median()

    event_arr = np.array(event_volumes)
    return {
        "lookback_days": lookback,
        "window_around_days": window_around,
        "n_low_events": len(low_indices),
        "mean_volume_at_lows": round(float(np.mean(event_arr)), 2),
        "median_volume_at_lows": round(float(np.median(event_arr)), 2),
        "baseline_median_volume": round(float(baseline_median), 2),
        "volume_uplift_ratio": round(float(np.median(event_arr) / baseline_median), 4)
            if baseline_median > 0 else None,
    }


def run_all_tests(etf_data):
    """Run all statistical tests for every ETF."""
    results = {}
    for etf_name, df in etf_data.items():
        print(f"\n  Testing {etf_name} ({ETF_TYPE[etf_name]} ETF, n={len(df)})...")
        r = {
            "etf_name": etf_name,
            "etf_type": ETF_TYPE[etf_name],
            "n_observations": len(df),
            "date_range": {
                "start": str(df["date"].min().date()),
                "end": str(df["date"].max().date()),
            },
            "price_stats": {
                "min": round(float(df["close"].min()), 4),
                "max": round(float(df["close"].max()), 4),
                "mean": round(float(df["close"].mean()), 4),
                "median": round(float(df["close"].median()), 4),
            },
            "volume_stats": {
                "min": round(float(df["volume"].min()), 4),
                "max": round(float(df["volume"].max()), 4),
                "mean": round(float(df["volume"].mean()), 4),
                "median": round(float(df["volume"].median()), 4),
            },
        }

        # Test 1: Spearman correlation
        r["spearman_correlation"] = spearman_correlation(df)

        # Test 2: Mann-Whitney U
        r["mann_whitney_u"] = mann_whitney_test(df, percentile=10)

        # Test 3: Rolling 90-day Spearman
        r["rolling_spearman_90d"] = rolling_spearman(df, window=90)

        # Test 4: Event study
        r["event_study_60d_lows"] = event_study(df, lookback=60, window_around=5)

        results[etf_name] = r

    return results


# ── Step 4 & 5: Save JSON and print summary ───────────────────────────────────

def save_results(results):
    """Save results to JSON."""
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to {OUTPUT_PATH}")


def print_summary(results):
    """Print a clear summary report."""
    print("\n" + "=" * 80)
    print("SUMMARY REPORT: Price-Volume Inverse Relationship Hypothesis")
    print("=" * 80)

    # Group by ETF type
    for etf_type_label, etf_type in [("LONG ETFs (bullish nat gas)", "long"),
                                      ("SHORT ETFs (bearish nat gas)", "short")]:
        print(f"\n{'─' * 40}")
        print(f"  {etf_type_label}")
        print(f"{'─' * 40}")

        for name, r in results.items():
            if r["etf_type"] != etf_type:
                continue

            sp = r["spearman_correlation"]
            mw = r["mann_whitney_u"]
            rs = r["rolling_spearman_90d"]
            ev = r["event_study_60d_lows"]

            print(f"\n  {name}  ({r['n_observations']} days, "
                  f"{r['date_range']['start']} to {r['date_range']['end']})")
            print(f"    Price range: {r['price_stats']['min']:.2f} - "
                  f"{r['price_stats']['max']:.2f}")

            # Spearman
            direction = "NEGATIVE (inverse)" if sp["rho"] < 0 else "POSITIVE"
            sig = "***" if sp["significant"] else "(n.s.)"
            print(f"    Spearman rho = {sp['rho']:+.4f}  p = {sp['p_value']:.2e}  "
                  f"{direction} {sig}")

            # Mann-Whitney
            if "error" not in mw:
                mw_dir = "HIGHER" if mw["volume_ratio"] and mw["volume_ratio"] > 1 else "LOWER"
                mw_sig = "***" if mw["significant"] else "(n.s.)"
                print(f"    Mann-Whitney: vol at low prices {mw['volume_ratio']:.2f}x "
                      f"vs others  {mw_dir} {mw_sig}")
            else:
                print(f"    Mann-Whitney: {mw['error']}")

            # Rolling stability
            if "error" not in rs:
                print(f"    Rolling 90d: mean rho = {rs['mean_rho']:+.4f}, "
                      f"{rs['pct_windows_negative']:.0f}% negative windows")
            else:
                print(f"    Rolling 90d: {rs['error']}")

            # Event study
            if "error" not in ev:
                print(f"    Event study: volume at 60d lows = "
                      f"{ev['volume_uplift_ratio']:.2f}x baseline "
                      f"({ev['n_low_events']} events)")
            else:
                print(f"    Event study: {ev.get('error', 'N/A')}")

    # Overall verdict
    print(f"\n{'=' * 80}")
    print("OVERALL ASSESSMENT")
    print("=" * 80)

    neg_count = sum(1 for r in results.values()
                    if r["spearman_correlation"]["rho"] < 0)
    sig_neg = sum(1 for r in results.values()
                  if r["spearman_correlation"]["rho"] < 0
                  and r["spearman_correlation"]["significant"])
    total = len(results)

    print(f"\n  Spearman correlation negative: {neg_count}/{total} ETFs")
    print(f"  Statistically significant (p<0.05): {sig_neg}/{total} ETFs")

    mw_support = sum(1 for r in results.values()
                     if "error" not in r["mann_whitney_u"]
                     and r["mann_whitney_u"].get("significant", False))
    print(f"  Mann-Whitney supports higher vol at low prices: {mw_support}/{total} ETFs")

    # Check if long vs short behave differently
    print("\n  By ETF type:")
    for etype in ["long", "short"]:
        etfs = [r for r in results.values() if r["etf_type"] == etype]
        rhos = [r["spearman_correlation"]["rho"] for r in etfs]
        mean_rho = np.mean(rhos)
        print(f"    {etype.upper()}: avg Spearman rho = {mean_rho:+.4f}")

    print()


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("Natural Gas ETF Price-Volume Hypothesis Validation")
    print("=" * 80)

    # Step 1: Explore
    explore_sheets()

    # Step 2: Extract
    print("=" * 80)
    print("STEP 2: EXTRACTING ETF DATA")
    print("=" * 80)
    etf_data = extract_etf_data()

    # Step 3: Test
    print("\n" + "=" * 80)
    print("STEP 3: RUNNING STATISTICAL TESTS")
    print("=" * 80)
    results = run_all_tests(etf_data)

    # Step 4: Save
    save_results(results)

    # Step 5: Summary
    print_summary(results)


if __name__ == "__main__":
    main()
