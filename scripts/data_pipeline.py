#!/usr/bin/env python3
"""
Natural Gas ETF Data Pipeline
==============================
Fetches historical price/volume data for 6 Natural Gas ETFs via the Yahoo
Finance v8 chart API (no external dependencies beyond stdlib + numpy/pandas).
Computes a full suite of volume and price metrics and writes structured JSON
for the dashboard.

Designed to be run by GitHub Actions on a schedule, or locally.
"""

import json
import logging
import math
import os
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("data_pipeline")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DASHBOARD_JSON = DATA_DIR / "dashboard_data.json"
SIGNALS_JSON = DATA_DIR / "latest_signals.json"

YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
MAX_RETRIES = 3
RETRY_DELAY_SECS = 2

ETF_CONFIG: Dict[str, Dict[str, str]] = {
    "BOIL": {
        "side": "long",
        "pair": "KOLD",
        "name": "ProShares Ultra Bloomberg Natural Gas",
    },
    "HNU.TO": {
        "side": "long",
        "pair": "HND.TO",
        "name": "Betapro Natural Gas 2x Bull",
    },
    "3NGL.L": {
        "side": "long",
        "pair": "3NGS.L",
        "name": "WisdomTree Natural Gas 3x Daily Long",
    },
    "KOLD": {
        "side": "short",
        "pair": "BOIL",
        "name": "ProShares UltraShort Bloomberg Natural Gas",
    },
    "HND.TO": {
        "side": "short",
        "pair": "HNU.TO",
        "name": "Betapro Natural Gas Inverse 2x",
    },
    "3NGS.L": {
        "side": "short",
        "pair": "3NGL.L",
        "name": "WisdomTree Natural Gas 3x Daily Short",
    },
}

PAIRS = [
    ("BOIL", "KOLD"),
    ("HNU.TO", "HND.TO"),
    ("3NGL.L", "3NGS.L"),
]

RVOL_WINDOWS = [10, 21, 63, 126, 252]
ZSCORE_WINDOWS = RVOL_WINDOWS
VOL_PCT_WINDOWS = RVOL_WINDOWS
PRICE_PCT_WINDOWS = RVOL_WINDOWS
VROC_WINDOWS = [5, 10, 21]
MA_WINDOWS = [10, 21, 50, 200]
ROLLING_CORR_WINDOW = 30

# VPS weights
VPS_W_RVOL = 0.30
VPS_W_ZSCORE = 0.25
VPS_W_PCT = 0.30
VPS_W_VROC = 0.15

# CVI alert thresholds
CVI_WARNING = 60
CVI_CRITICAL = 80
VPS_ELEVATED = 60
VPS_CRITICAL = 80


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _safe_float(val: Any) -> Optional[float]:
    """Convert a value to float, returning None for NaN / Inf / non-numeric."""
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 6)
    except (TypeError, ValueError):
        return None


def _safe_dict(d: dict) -> dict:
    """Recursively sanitise a dict so it is JSON-serialisable."""
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out[k] = _safe_dict(v)
        elif isinstance(v, list):
            out[k] = [_safe_dict(i) if isinstance(i, dict) else _safe_float(i) if isinstance(i, (float, np.floating)) else i for i in v]
        elif isinstance(v, (float, np.floating)):
            out[k] = _safe_float(v)
        elif isinstance(v, (np.integer,)):
            out[k] = int(v)
        elif isinstance(v, (np.bool_,)):
            out[k] = bool(v)
        elif isinstance(v, pd.Timestamp):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _market_status() -> str:
    """Return a simple NYSE market-status string based on current ET time."""
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore[no-redef]

    now_et = datetime.now(ZoneInfo("America/New_York"))
    weekday = now_et.weekday()  # 0=Mon .. 6=Sun
    if weekday >= 5:
        return "closed"
    hour, minute = now_et.hour, now_et.minute
    t = hour * 60 + minute
    if t < 4 * 60:
        return "closed"
    if t < 9 * 60 + 30:
        return "pre_market"
    if t < 16 * 60:
        return "open"
    if t < 20 * 60:
        return "after_hours"
    return "closed"


# ---------------------------------------------------------------------------
# Data fetching – Yahoo Finance v8 chart API (no yfinance dependency)
# ---------------------------------------------------------------------------
def _yahoo_fetch_one(ticker: str) -> Optional[pd.DataFrame]:
    """Fetch full daily OHLCV history for a single ticker via Yahoo Finance v8 chart API.

    Uses period1/period2 parameters to request the complete daily history
    (period1 set to 2007-01-01 to capture all available data for every ETF).
    """
    period1 = int(datetime(2007, 1, 1).timestamp())
    period2 = int(datetime.now().timestamp())
    url = (
        f"{YAHOO_BASE_URL}{urllib.request.quote(ticker)}"
        f"?period1={period1}&period2={period2}&interval=1d&includePrePost=false"
    )

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            resp = urllib.request.urlopen(req, context=ctx, timeout=30)
            raw = json.loads(resp.read())

            result = raw["chart"]["result"][0]
            timestamps = result["timestamp"]
            quote = result["indicators"]["quote"][0]

            dates = [datetime.utcfromtimestamp(ts) for ts in timestamps]
            df = pd.DataFrame({
                "open": quote.get("open"),
                "high": quote.get("high"),
                "low": quote.get("low"),
                "close": quote.get("close"),
                "volume": quote.get("volume"),
            }, index=pd.DatetimeIndex(dates))

            # Drop rows with missing close or volume
            df = df.dropna(subset=["close", "volume"])
            df["volume"] = df["volume"].astype(float)
            df.sort_index(inplace=True)

            return df

        except Exception as e:
            logger.warning("Attempt %d/%d for %s failed: %s", attempt, MAX_RETRIES, ticker, e)
            if attempt < MAX_RETRIES:
                import time
                time.sleep(RETRY_DELAY_SECS * attempt)

    return None


def _fetch_all() -> Dict[str, pd.DataFrame]:
    """Download full daily OHLCV history for all 6 ETFs via Yahoo Finance v8 API."""
    frames: Dict[str, pd.DataFrame] = {}

    for ticker in ETF_CONFIG:
        logger.info("Fetching %s from Yahoo Finance …", ticker)
        df = _yahoo_fetch_one(ticker)

        if df is not None and not df.empty:
            frames[ticker] = df
            first = df.index[0].strftime("%Y-%m-%d")
            last = df.index[-1].strftime("%Y-%m-%d")
            logger.info("  → %d daily rows for %s (%s to %s)", len(df), ticker, first, last)
        else:
            logger.error("No data for %s after %d retries", ticker, MAX_RETRIES)

    return frames


# ---------------------------------------------------------------------------
# Metric computation
# ---------------------------------------------------------------------------
def _percentile_rank(series: pd.Series, window: int) -> pd.Series:
    """Rolling percentile rank of the last value within the window (0-100)."""
    def _rank_last(arr):
        if len(arr) < 2:
            return np.nan
        val = arr[-1]
        return (np.sum(arr < val) / (len(arr) - 1)) * 100.0

    return series.rolling(window, min_periods=max(2, window // 2)).apply(_rank_last, raw=True)


def compute_etf_metrics(df: pd.DataFrame) -> dict:
    """
    Given a DataFrame with columns [open, high, low, close, volume],
    compute the full metric suite and return a dict.
    """
    if df.empty:
        return {}

    close = df["close"]
    volume = df["volume"].astype(float)
    dollar_volume = close * volume
    pct_change = close.pct_change() * 100

    # --- RVOL ---
    rvol = {}
    for w in RVOL_WINDOWS:
        avg = volume.rolling(w, min_periods=max(1, w // 2)).mean()
        rvol[f"{w}d"] = _safe_float((volume.iloc[-1] / avg.iloc[-1]) if avg.iloc[-1] != 0 else np.nan)

    # --- Volume Z-Score ---
    z_score = {}
    for w in ZSCORE_WINDOWS:
        mean_ = volume.rolling(w, min_periods=max(1, w // 2)).mean()
        std_ = volume.rolling(w, min_periods=max(1, w // 2)).std()
        val = (volume.iloc[-1] - mean_.iloc[-1]) / std_.iloc[-1] if std_.iloc[-1] != 0 else np.nan
        z_score[f"{w}d"] = _safe_float(val)

    # --- VROC ---
    vroc = {}
    for w in VROC_WINDOWS:
        if len(volume) > w:
            old = volume.iloc[-w - 1]
            cur = volume.iloc[-1]
            vroc[f"{w}d"] = _safe_float(((cur - old) / old) * 100 if old != 0 else np.nan)
        else:
            vroc[f"{w}d"] = None

    # --- Volume Percentile ---
    vol_pct_series = {}
    vol_pct = {}
    for w in VOL_PCT_WINDOWS:
        s = _percentile_rank(volume, w)
        vol_pct_series[w] = s
        vol_pct[f"{w}d"] = _safe_float(s.iloc[-1])

    # --- Price Percentile ---
    price_pct_series = {}
    price_pct = {}
    for w in PRICE_PCT_WINDOWS:
        s = _percentile_rank(close, w)
        price_pct_series[w] = s
        price_pct[f"{w}d"] = _safe_float(s.iloc[-1])

    # --- CVI (Capitulation Volume Index) ---
    # CVI = vol_percentile * (1 - price_percentile / 100), scaled 0-100
    # Computed for ALL ETFs (long AND short)
    cvi = {}
    for w in VOL_PCT_WINDOWS:
        vp = vol_pct.get(f"{w}d")
        pp = price_pct.get(f"{w}d")
        if vp is not None and pp is not None:
            cvi[f"{w}d"] = _safe_float(vp * (1.0 - pp / 100.0))
        else:
            cvi[f"{w}d"] = None

    # --- VPS (Volume Pressure Score) ---
    # Normalise components to 0-100 then weighted sum
    def _norm_0_100(val, lo, hi):
        if val is None or lo is None or hi is None or hi == lo:
            return 50.0
        return max(0, min(100, (val - lo) / (hi - lo) * 100))

    # Use 21-day window as representative
    rvol_val = rvol.get("21d")
    zscore_val = z_score.get("21d")
    pct_val = vol_pct.get("21d")
    vroc_val = vroc.get("10d")

    rvol_norm = _norm_0_100(rvol_val, 0.3, 3.0)
    zscore_norm = _norm_0_100(zscore_val, -2.0, 4.0)
    pct_norm = pct_val if pct_val is not None else 50.0
    vroc_norm = _norm_0_100(vroc_val, -80, 200)

    vps = _safe_float(
        VPS_W_RVOL * rvol_norm
        + VPS_W_ZSCORE * zscore_norm
        + VPS_W_PCT * pct_norm
        + VPS_W_VROC * vroc_norm
    )

    # --- MWCA (Multi-Window Convergence Alarm) ---
    mwca = all(
        vol_pct.get(f"{w}d") is not None and vol_pct[f"{w}d"] > 90
        for w in VOL_PCT_WINDOWS
    )

    # --- Rolling Spearman Correlation (price-volume, 30d) ---
    rolling_corr = None
    if len(df) >= ROLLING_CORR_WINDOW:
        try:
            corr_series = close.rolling(ROLLING_CORR_WINDOW).corr(volume)
            rolling_corr = _safe_float(corr_series.iloc[-1])
        except Exception:
            pass

    # --- Moving Averages ---
    ma_price = {}
    ma_volume = {}
    for w in MA_WINDOWS:
        if len(close) >= w:
            ma_price[f"{w}d"] = _safe_float(close.rolling(w).mean().iloc[-1])
            ma_volume[f"{w}d"] = _safe_float(volume.rolling(w).mean().iloc[-1])
        else:
            ma_price[f"{w}d"] = None
            ma_volume[f"{w}d"] = None

    # --- Alerts ---
    alerts: List[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for w_key, cvi_val in cvi.items():
        if cvi_val is not None and cvi_val >= CVI_CRITICAL:
            alerts.append({
                "type": "cvi_critical",
                "message": f"CVI ({w_key}) = {cvi_val:.1f} — extreme capitulation signal",
                "timestamp": now_iso,
            })
        elif cvi_val is not None and cvi_val >= CVI_WARNING:
            alerts.append({
                "type": "cvi_warning",
                "message": f"CVI ({w_key}) = {cvi_val:.1f} — elevated capitulation signal",
                "timestamp": now_iso,
            })

    if vps is not None and vps >= VPS_CRITICAL:
        alerts.append({
            "type": "vps_critical",
            "message": f"VPS = {vps:.1f} — extreme volume pressure",
            "timestamp": now_iso,
        })
    elif vps is not None and vps >= VPS_ELEVATED:
        alerts.append({
            "type": "vps_elevated",
            "message": f"VPS = {vps:.1f} — elevated volume pressure",
            "timestamp": now_iso,
        })

    if mwca:
        alerts.append({
            "type": "mwca_alarm",
            "message": "Volume percentile > 90th across ALL windows simultaneously",
            "timestamp": now_iso,
        })

    # --- History (last 252 trading days of OHLCV) ---
    hist_df = df.tail(252).copy()
    history: List[dict] = []
    for dt, row in hist_df.iterrows():
        history.append({
            "date": dt.strftime("%Y-%m-%d"),
            "open": _safe_float(row["open"]),
            "high": _safe_float(row["high"]),
            "low": _safe_float(row["low"]),
            "close": _safe_float(row["close"]),
            "volume": int(row["volume"]) if not np.isnan(row["volume"]) else 0,
        })

    # --- Current snapshot ---
    current = {
        "price": _safe_float(close.iloc[-1]),
        "volume": int(volume.iloc[-1]) if not np.isnan(volume.iloc[-1]) else 0,
        "change_pct": _safe_float(pct_change.iloc[-1]),
        "dollar_volume": _safe_float(dollar_volume.iloc[-1]),
    }

    # --- Full RVOL series (needed for IPSI computation later) ---
    # We store the 21d RVOL series tail so the caller can use it
    rvol_21_series = volume / volume.rolling(21, min_periods=1).mean()

    return {
        "current": current,
        "rvol": rvol,
        "z_score": z_score,
        "vroc": vroc,
        "vol_percentile": vol_pct,
        "price_percentile": price_pct,
        "cvi": cvi,
        "vps": vps,
        "mwca": mwca,
        "rolling_correlation": rolling_corr,
        "moving_averages": {"price": ma_price, "volume": ma_volume},
        "history": history,
        "alerts": alerts,
        "_rvol_21_last": _safe_float(rvol_21_series.iloc[-1]),
    }


# ---------------------------------------------------------------------------
# Cross-instrument metrics
# ---------------------------------------------------------------------------
def compute_pairs(
    metrics: Dict[str, dict],
) -> Dict[str, dict]:
    """Compute IPSI and pair status for each long/short pair."""
    pairs_out: Dict[str, dict] = {}
    for long_t, short_t in PAIRS:
        key = f"{long_t}_{short_t}"
        long_rvol = metrics.get(long_t, {}).get("_rvol_21_last")
        short_rvol = metrics.get(short_t, {}).get("_rvol_21_last")

        if long_rvol and short_rvol and long_rvol != 0:
            ipsi = _safe_float(short_rvol / long_rvol)
        else:
            ipsi = None

        # Status buckets
        if ipsi is None:
            status = "quiet"
        elif ipsi > 2.0:
            status = "stress"
        elif ipsi > 1.3:
            status = "elevated"
        else:
            status = "quiet"

        pairs_out[key] = {
            "ipsi": ipsi,
            "long_rvol": long_rvol,
            "short_rvol": short_rvol,
            "status": status,
        }

    return pairs_out


# ---------------------------------------------------------------------------
# Pipeline orchestration
# ---------------------------------------------------------------------------
def run_pipeline() -> None:
    """Execute the full data pipeline."""
    logger.info("=" * 60)
    logger.info("Natural Gas ETF Data Pipeline – starting")
    logger.info("=" * 60)

    # Ensure output directory exists
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ---- 1. Fetch live data from Yahoo Finance ----
    frames = _fetch_all()

    if not frames:
        logger.error("No data frames available – aborting")
        sys.exit(1)

    # ---- 2. Compute per-ETF metrics ----
    all_metrics: Dict[str, dict] = {}
    for ticker, df in frames.items():
        logger.info("Computing metrics for %s …", ticker)
        try:
            m = compute_etf_metrics(df)
            all_metrics[ticker] = m
        except Exception:
            logger.exception("Metric computation failed for %s", ticker)

    # ---- 3. Cross-instrument metrics ----
    pairs_data = compute_pairs(all_metrics)

    # ---- 4. Aggregate signals ----
    all_signals: List[dict] = []
    for ticker, m in all_metrics.items():
        for alert in m.get("alerts", []):
            all_signals.append({**alert, "ticker": ticker})

    # Add pair-level alerts
    for pair_key, pair_info in pairs_data.items():
        if pair_info["status"] == "stress":
            all_signals.append({
                "type": "ipsi_stress",
                "ticker": pair_key,
                "message": f"IPSI stress for {pair_key} — ratio {pair_info['ipsi']:.2f}" if pair_info["ipsi"] else f"IPSI stress for {pair_key}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    # ---- 5. Build output ----
    etfs_out: Dict[str, dict] = {}
    for ticker, m in all_metrics.items():
        cfg = ETF_CONFIG[ticker]
        entry = {
            "side": cfg["side"],
            "pair": cfg["pair"],
            "name": cfg["name"],
            "current": m["current"],
            "rvol": m["rvol"],
            "z_score": m["z_score"],
            "vroc": m["vroc"],
            "vol_percentile": m["vol_percentile"],
            "price_percentile": m["price_percentile"],
            "cvi": m["cvi"],
            "vps": m["vps"],
            "mwca": m["mwca"],
            "rolling_correlation": m["rolling_correlation"],
            "moving_averages": m["moving_averages"],
            "history": m["history"],
            "alerts": m["alerts"],
        }
        etfs_out[ticker] = _safe_dict(entry)

    dashboard = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "market_status": _market_status(),
        "etfs": etfs_out,
        "pairs": _safe_dict(pairs_data),
        "signals": all_signals,
    }

    # ---- 6. Write dashboard JSON ----
    with open(DASHBOARD_JSON, "w") as f:
        json.dump(dashboard, f, indent=2, default=str)
    logger.info("Wrote %s (%.1f KB)", DASHBOARD_JSON, DASHBOARD_JSON.stat().st_size / 1024)

    # ---- 7. Write lightweight signals JSON ----
    latest_signals = {
        "last_updated": dashboard["last_updated"],
        "market_status": dashboard["market_status"],
        "signals": all_signals,
        "pair_status": {k: v["status"] for k, v in pairs_data.items()},
        "etf_summary": {
            ticker: {
                "price": etfs_out[ticker]["current"]["price"],
                "change_pct": etfs_out[ticker]["current"]["change_pct"],
                "vps": etfs_out[ticker]["vps"],
                "mwca": etfs_out[ticker]["mwca"],
            }
            for ticker in etfs_out
        },
    }
    with open(SIGNALS_JSON, "w") as f:
        json.dump(latest_signals, f, indent=2, default=str)
    logger.info("Wrote %s (%.1f KB)", SIGNALS_JSON, SIGNALS_JSON.stat().st_size / 1024)

    logger.info("Pipeline complete – %d ETFs, %d signals", len(etfs_out), len(all_signals))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    run_pipeline()
