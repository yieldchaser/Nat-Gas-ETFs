#!/usr/bin/env python3
"""
Historical Return Distribution & Tail Risk Engine
==================================================
Computes empirical return distributions, higher statistical moments
(Fisher-Pearson Skewness, Fisher Excess Kurtosis), non-parametric VaR/CVaR,
zero-anchored 80-bin histograms, and volume-conditioned forward return
expectancy matrices across 3 horizons (1D, 5D, 21D) and 3 regimes
(Trailing 252D, Modern LNG Era, Full Inception) for 6 ETFs and NG=F.
"""

import json
import logging
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("return_distributions")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DOCS_DATA_DIR = PROJECT_ROOT / "docs" / "data"

DASHBOARD_JSON = DATA_DIR / "dashboard_data.json"
DOCS_DASHBOARD_JSON = DOCS_DATA_DIR / "dashboard_data.json"

OUTPUT_JSON_DATA = DATA_DIR / "return_distributions.json"
OUTPUT_JSON_DOCS = DOCS_DATA_DIR / "return_distributions.json"

NG_HISTORY_DATA = DATA_DIR / "ng_history.json"
DOCS_NG_HISTORY_DATA = DOCS_DATA_DIR / "ng_history.json"

INSTRUMENTS = [
    {
        "ticker": "BOIL",
        "name": "ProShares Ultra Bloomberg Natural Gas",
        "side": "long",
        "leverage": "2x",
        "exchange": "NYSE",
    },
    {
        "ticker": "KOLD",
        "name": "ProShares UltraShort Bloomberg Natural Gas",
        "side": "short",
        "leverage": "-2x",
        "exchange": "NYSE",
    },
    {
        "ticker": "HNU.TO",
        "name": "BetaPro Natural Gas 2x Bull",
        "side": "long",
        "leverage": "2x",
        "exchange": "TSX",
    },
    {
        "ticker": "HND.TO",
        "name": "BetaPro Natural Gas Inverse 2x",
        "side": "short",
        "leverage": "-2x",
        "exchange": "TSX",
    },
    {
        "ticker": "3NGL.L",
        "name": "WisdomTree Natural Gas 3x Daily Long",
        "side": "long",
        "leverage": "3x",
        "exchange": "LSE",
    },
    {
        "ticker": "3NGS.L",
        "name": "WisdomTree Natural Gas 3x Daily Short",
        "side": "short",
        "leverage": "-3x",
        "exchange": "LSE",
    },
    {
        "ticker": "NG=F",
        "name": "Front-Month Natural Gas Futures",
        "side": "benchmark",
        "leverage": "1x",
        "exchange": "NYMEX",
    },
]

HORIZONS = [
    {"key": "1d", "days": 1, "label": "1-Day Daily Return"},
    {"key": "5d", "days": 5, "label": "5-Day Swing Cycle"},
    {"key": "21d", "days": 21, "label": "21-Day Monthly Cycle"},
]

REGIMES = [
    {"key": "trailing_252d", "label": "Trailing 252D (1 Year)"},
    {"key": "lng_era", "label": "Modern LNG Era (2023 - Present)", "start_date": "2023-01-01"},
    {"key": "full_inception", "label": "Full Inception History"},
]


def _calc_moments(returns: np.ndarray, horizon_days: int) -> Dict[str, float]:
    """Calculate sample moments with finite-sample bias corrections."""
    n = len(returns)
    if n < 4:
        return {
            "mean": 0.0,
            "median": 0.0,
            "std": 0.0,
            "ann_volatility": 0.0,
            "skewness": 0.0,
            "excess_kurtosis": 0.0,
        }

    mean_val = float(np.mean(returns))
    median_val = float(np.median(returns))
    sample_std = float(np.std(returns, ddof=1))

    # Annualized volatility: s * sqrt(252 / horizon)
    ann_vol = sample_std * math.sqrt(252.0 / horizon_days)

    # Central moments
    diff = returns - mean_val
    m2 = float(np.mean(diff ** 2))
    m3 = float(np.mean(diff ** 3))
    m4 = float(np.mean(diff ** 4))

    # Fisher-Pearson Skewness with finite-sample adjustment (G1)
    if m2 > 1e-12 and n > 2:
        skew = (math.sqrt(n * (n - 1)) / (n - 2)) * (m3 / (m2 ** 1.5))
    else:
        skew = 0.0

    # Fisher Excess Kurtosis with finite-sample adjustment (G2, normal = 0)
    if m2 > 1e-12 and n > 3:
        term1 = (n - 1) / ((n - 2) * (n - 3))
        term2 = (n + 1) * (m4 / (m2 ** 2)) - 3 * (n - 1)
        kurt = term1 * term2
    else:
        kurt = 0.0

    return {
        "mean": round(mean_val, 4),
        "median": round(median_val, 4),
        "std": round(sample_std, 4),
        "ann_volatility": round(ann_vol, 2),
        "skewness": round(float(skew), 4),
        "excess_kurtosis": round(float(kurt), 4),
    }


def _calc_risk_metrics(returns: np.ndarray) -> Dict[str, float]:
    """Calculate non-parametric VaR, CVaR, extrema, and win rate."""
    n = len(returns)
    if n == 0:
        return {
            "var_95": 0.0,
            "cvar_95": 0.0,
            "var_99": 0.0,
            "cvar_99": 0.0,
            "max_gain": 0.0,
            "max_drawdown": 0.0,
            "win_rate": 0.0,
        }

    # Non-parametric empirical percentiles
    var_95 = float(np.percentile(returns, 5))
    var_99 = float(np.percentile(returns, 1))

    # Expected Shortfall (CVaR): conditional mean of tail observations
    tail_95 = returns[returns <= var_95]
    cvar_95 = float(np.mean(tail_95)) if len(tail_95) > 0 else var_95

    tail_99 = returns[returns <= var_99]
    cvar_99 = float(np.mean(tail_99)) if len(tail_99) > 0 else var_99

    max_gain = float(np.max(returns))
    max_dd = float(np.min(returns))
    win_rate = float(np.sum(returns > 0) / n * 100.0)

    return {
        "var_95": round(var_95, 2),
        "cvar_95": round(cvar_95, 2),
        "var_99": round(var_99, 2),
        "cvar_99": round(cvar_99, 2),
        "max_gain": round(max_gain, 2),
        "max_drawdown": round(max_dd, 2),
        "win_rate": round(win_rate, 2),
    }


def _build_zero_anchored_histogram(returns: np.ndarray) -> Dict[str, Any]:
    """
    Construct zero-anchored 80-bin histogram.
    Symmetric range M = max(|R_min|, |R_max|).
    40 negative bins [-M + j*step, -M + (j+1)*step) for j = 0..39.
    40 positive bins (k*step, (k+1)*step] for k = 0..39.
    Exact zero is assigned to the first positive bin [0, step].
    Total counts sum exactly to n, and densities sum to 1.0.
    """
    n = len(returns)
    if n == 0:
        return {"bin_count": 80, "range_min": -10.0, "range_max": 10.0, "step": 0.25, "bins": []}

    r_min = float(np.min(returns))
    r_max = float(np.max(returns))
    m_val = max(abs(r_min), abs(r_max))
    if m_val < 0.001:
        m_val = 1.0

    # Microscopic epsilon expansion so extrema are strictly inside bounds
    m_boundary = m_val * 1.00001
    step = m_boundary / 40.0

    bins_list = []
    running_count = 0

    # 40 Negative Bins: j = 0..39 (strictly R < 0.0)
    for j in range(40):
        low = -(40 - j) * step
        high = -(39 - j) * step if j < 39 else 0.0
        center = (low + high) / 2.0

        # Bin condition: strictly negative, low <= r < high
        mask = (returns < 0.0) & (returns >= low) & (returns < high)
        cnt = int(np.sum(mask))
        running_count += cnt
        density = cnt / n
        cum_pct = (running_count / n) * 100.0

        bins_list.append({
            "bin_index": j,
            "lower": round(low, 4),
            "upper": round(high, 4),
            "center": round(center, 4),
            "count": cnt,
            "density": round(density, 6),
            "cumulative_pct": round(cum_pct, 4),
            "is_negative": True,
        })

    # 40 Positive Bins: k = 0..39 (strictly R >= 0.0)
    for k in range(40):
        low = k * step
        high = (k + 1) * step
        center = (low + high) / 2.0

        # For k == 0: include exact zero [0.0, step]
        if k == 0:
            mask = (returns >= 0.0) & (returns <= high)
        else:
            mask = (returns > low) & (returns <= high)

        cnt = int(np.sum(mask))
        running_count += cnt
        density = cnt / n
        cum_pct = (running_count / n) * 100.0

        bins_list.append({
            "bin_index": 40 + k,
            "lower": round(low, 4),
            "upper": round(high, 4),
            "center": round(center, 4),
            "count": cnt,
            "density": round(density, 6),
            "cumulative_pct": round(cum_pct, 4),
            "is_negative": False,
        })

    return {
        "bin_count": 80,
        "range_min": round(-m_boundary, 4),
        "range_max": round(m_boundary, 4),
        "step": round(step, 4),
        "bins": bins_list,
    }


def _classify_edge(win_rate: float, mean_ret: float) -> str:
    """Classify statistical directional edge."""
    if win_rate >= 60.0 and mean_ret > 0:
        return "Strong Bullish Edge"
    if win_rate <= 40.0 and mean_ret < 0:
        return "Strong Bearish Edge"
    if win_rate >= 55.0 and mean_ret > 0:
        return "Moderate Bullish Edge"
    if win_rate <= 45.0 and mean_ret < 0:
        return "Moderate Bearish Edge"
    return "Neutral / Mean Reverting"


def _build_expectancy_matrix(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Build Volume-Conditioned Forward Return Expectancy Matrix.
    Conditions:
      1. Panic Climax: Z_1D <= -1.5 sigma & RVOL_21D >= 1.5x
      2. Panic Drift:  Z_1D <= -1.5 sigma & RVOL_21D < 1.5x
      3. Rally Climax: Z_1D >= +1.5 sigma & RVOL_21D >= 1.5x
      4. Rally Drift:  Z_1D >= +1.5 sigma & RVOL_21D < 1.5x
      5. Stationary Range: |Z_1D| < 1.5 sigma
    Evaluates forward 1D, 5D, 10D mean, median, win-rate, and edge classification.
    """
    n = len(df)
    if n < 40:
        return []

    close_series = df["close"].values
    vol_series = df["volume"].values

    # 1D percentage returns
    ret_1d = np.zeros(n)
    ret_1d[1:] = ((close_series[1:] - close_series[:-1]) / close_series[:-1]) * 100.0

    # Trailing 21-day rolling stats for Z_1D and RVOL_21D
    z_scores = np.zeros(n)
    rvol_21 = np.ones(n)

    for i in range(21, n):
        # Lookback 21 returns
        window_ret = ret_1d[i - 20 : i + 1]
        m_r = np.mean(window_ret)
        s_r = np.std(window_ret, ddof=1)
        z_scores[i] = (ret_1d[i] - m_r) / s_r if s_r > 1e-6 else 0.0

        # Lookback 21 volumes
        window_vol = vol_series[i - 20 : i + 1]
        mean_vol = np.mean(window_vol)
        rvol_21[i] = vol_series[i] / mean_vol if mean_vol > 1e-6 else 1.0

    # Define buckets
    buckets = {
        "panic_climax": {
            "key": "panic_climax",
            "label": "Panic Climax",
            "definition": "Z <= -1.5\u03c3 & RVOL >= 1.5\u00d7",
            "fwd_1d": [],
            "fwd_5d": [],
            "fwd_10d": [],
        },
        "panic_drift": {
            "key": "panic_drift",
            "label": "Panic Drift",
            "definition": "Z <= -1.5\u03c3 & RVOL < 1.5\u00d7",
            "fwd_1d": [],
            "fwd_5d": [],
            "fwd_10d": [],
        },
        "rally_climax": {
            "key": "rally_climax",
            "label": "Rally Climax",
            "definition": "Z >= +1.5\u03c3 & RVOL >= 1.5\u00d7",
            "fwd_1d": [],
            "fwd_5d": [],
            "fwd_10d": [],
        },
        "rally_drift": {
            "key": "rally_drift",
            "label": "Rally Drift",
            "definition": "Z >= +1.5\u03c3 & RVOL < 1.5\u00d7",
            "fwd_1d": [],
            "fwd_5d": [],
            "fwd_10d": [],
        },
        "stationary_range": {
            "key": "stationary_range",
            "label": "Stationary Range",
            "definition": "|Z| < 1.5\u03c3 (Normal)",
            "fwd_1d": [],
            "fwd_5d": [],
            "fwd_10d": [],
        },
    }

    # Evaluate forward returns for each day from index 21 up to n - 10
    for i in range(21, n - 10):
        z = z_scores[i]
        rv = rvol_21[i]
        p_curr = close_series[i]

        fwd_1 = ((close_series[i + 1] - p_curr) / p_curr) * 100.0
        fwd_5 = ((close_series[i + 5] - p_curr) / p_curr) * 100.0
        fwd_10 = ((close_series[i + 10] - p_curr) / p_curr) * 100.0

        if z <= -1.5:
            cond_key = "panic_climax" if rv >= 1.5 else "panic_drift"
        elif z >= 1.5:
            cond_key = "rally_climax" if rv >= 1.5 else "rally_drift"
        else:
            cond_key = "stationary_range"

        target_bucket = buckets[cond_key]
        target_bucket["fwd_1d"].append(fwd_1)
        target_bucket["fwd_5d"].append(fwd_5)
        target_bucket["fwd_10d"].append(fwd_10)

    # Format result matrix
    matrix_rows = []
    order = ["panic_climax", "panic_drift", "rally_climax", "rally_drift", "stationary_range"]

    for k in order:
        b = buckets[k]
        cnt = len(b["fwd_1d"])

        def _stats(arr: List[float]) -> Dict[str, Any]:
            if not arr:
                return {"mean": 0.0, "median": 0.0, "win_rate": 0.0, "edge": "Neutral / Mean Reverting"}
            np_arr = np.array(arr)
            m = float(np.mean(np_arr))
            med = float(np.median(np_arr))
            wr = float(np.sum(np_arr > 0) / len(np_arr) * 100.0)
            edge = _classify_edge(wr, m)
            return {
                "mean": round(m, 2),
                "median": round(med, 2),
                "win_rate": round(wr, 1),
                "edge": edge,
            }

        matrix_rows.append({
            "condition_key": b["key"],
            "label": b["label"],
            "definition": b["definition"],
            "count": cnt,
            "fwd_1d": _stats(b["fwd_1d"]),
            "fwd_5d": _stats(b["fwd_5d"]),
            "fwd_10d": _stats(b["fwd_10d"]),
        })

    return matrix_rows


def _load_history(ticker: str, dashboard_data: dict) -> pd.DataFrame:
    """Load historical OHLCV DataFrame for a ticker."""
    if ticker in dashboard_data.get("etfs", {}):
        hist = dashboard_data["etfs"][ticker].get("history", [])
        if hist:
            df = pd.DataFrame(hist)
            df["date"] = pd.to_datetime(df["date"])
            df.set_index("date", inplace=True)
            df.sort_index(inplace=True)
            for c in ("open", "high", "low", "close", "volume"):
                if c in df.columns:
                    df[c] = df[c].astype(float)
            return df

    # Fallback for NG=F
    if ticker == "NG=F":
        target_path = NG_HISTORY_DATA if NG_HISTORY_DATA.exists() else DOCS_NG_HISTORY_DATA
        if target_path.exists():
            with open(target_path, "r", encoding="utf-8") as f:
                hist = json.load(f)
            df = pd.DataFrame(hist)
            df["date"] = pd.to_datetime(df["date"])
            df.set_index("date", inplace=True)
            df.sort_index(inplace=True)
            for c in ("open", "high", "low", "close", "volume"):
                if c in df.columns:
                    df[c] = df[c].astype(float)
            return df

    return pd.DataFrame()


def generate_distributions() -> Dict[str, Any]:
    """Generate the complete return distribution payload."""
    dash_path = DASHBOARD_JSON if DASHBOARD_JSON.exists() else DOCS_DASHBOARD_JSON
    if not dash_path.exists():
        logger.error("Dashboard data file not found at %s", dash_path)
        sys.exit(1)

    with open(dash_path, "r", encoding="utf-8") as f:
        dashboard_data = json.load(f)

    payload: Dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "description": "Historical Return Distribution & Tail Risk Engine",
        "instruments": {},
    }

    for inst in INSTRUMENTS:
        ticker = inst["ticker"]
        logger.info("Processing return distributions for %s...", ticker)
        df_full = _load_history(ticker, dashboard_data)

        if df_full.empty or len(df_full) < 30:
            logger.warning("Insufficient history for %s (len: %d)", ticker, len(df_full))
            continue

        last_row = df_full.iloc[-1]
        prev_row = df_full.iloc[-2] if len(df_full) > 1 else last_row
        ret_1d_val = (
            float(((last_row["close"] - prev_row["close"]) / prev_row["close"]) * 100.0)
            if prev_row["close"] > 0
            else 0.0
        )

        inst_data: Dict[str, Any] = {
            "ticker": ticker,
            "name": inst["name"],
            "side": inst["side"],
            "leverage": inst["leverage"],
            "exchange": inst["exchange"],
            "total_bars": len(df_full),
            "earliest_date": df_full.index[0].strftime("%Y-%m-%d"),
            "latest_date": df_full.index[-1].strftime("%Y-%m-%d"),
            "latest_bar": {
                "date": df_full.index[-1].strftime("%Y-%m-%d"),
                "close": round(float(last_row["close"]), 4),
                "prev_close": round(float(prev_row["close"]), 4),
                "return_pct": round(ret_1d_val, 4),
                "volume": int(last_row.get("volume", 0)),
            },
            "regimes": {},
        }

        # Calculate for each regime
        for reg in REGIMES:
            reg_key = reg["key"]

            if reg_key == "trailing_252d":
                df_reg = df_full.iloc[-252:].copy() if len(df_full) >= 252 else df_full.copy()
            elif reg_key == "lng_era":
                df_reg = df_full[df_full.index >= reg["start_date"]].copy()
                if df_reg.empty:
                    df_reg = df_full.iloc[-252:].copy()
            else:  # full_inception
                df_reg = df_full.copy()

            reg_data: Dict[str, Any] = {
                "key": reg_key,
                "label": reg["label"],
                "start_date": df_reg.index[0].strftime("%Y-%m-%d"),
                "end_date": df_reg.index[-1].strftime("%Y-%m-%d"),
                "bars": len(df_reg),
                "horizons": {},
                "expectancy_matrix": _build_expectancy_matrix(df_reg),
            }

            # Calculate for each horizon
            for h in HORIZONS:
                h_key = h["key"]
                h_days = h["days"]

                # Close prices
                closes = df_reg["close"].values
                if len(closes) <= h_days:
                    continue

                # Percentage return: (P_t - P_{t-h}) / P_{t-h} * 100
                returns = ((closes[h_days:] - closes[:-h_days]) / closes[:-h_days]) * 100.0

                # Statistical moments
                moments = _calc_moments(returns, h_days)

                # Tail risk metrics
                risk_metrics = _calc_risk_metrics(returns)

                # Zero-anchored 80-bin histogram
                histogram = _build_zero_anchored_histogram(returns)

                reg_data["horizons"][h_key] = {
                    "horizon_key": h_key,
                    "horizon_days": h_days,
                    "horizon_label": h["label"],
                    "n_observations": len(returns),
                    "moments": moments,
                    "risk_metrics": risk_metrics,
                    "histogram": histogram,
                }

            inst_data["regimes"][reg_key] = reg_data

        payload["instruments"][ticker] = inst_data

    # Write identical JSON artifacts to both paths
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)

    with open(OUTPUT_JSON_DATA, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    logger.info("Wrote %s (%.1f KB)", OUTPUT_JSON_DATA, OUTPUT_JSON_DATA.stat().st_size / 1024)

    with open(OUTPUT_JSON_DOCS, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    logger.info("Wrote %s (%.1f KB)", OUTPUT_JSON_DOCS, OUTPUT_JSON_DOCS.stat().st_size / 1024)

    return payload


if __name__ == "__main__":
    generate_distributions()
