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

# Volatility modelling windows
HV_WINDOWS = [10, 21, 63, 252]  # Realized historical volatility windows
ATR_WINDOW = 14                  # ATR lookback
VOV_WINDOW = 21                  # Vol-of-vol: std of 10d HV over this many periods
VOL_REGIME_WINDOW = 252          # Window for vol regime percentile ranking

# VPS weights — now 5-component; vol regime inverse adds context-sensitivity
VPS_W_RVOL = 0.25       # was 0.30
VPS_W_ZSCORE = 0.20     # was 0.25
VPS_W_PCT = 0.25        # was 0.30
VPS_W_VROC = 0.10       # was 0.15
VPS_W_VOLREGIME = 0.20  # NEW: inverted vol regime (high when vol is quiet → signals stronger)

# CVI / VCVI alert thresholds
CVI_WARNING = 60
CVI_CRITICAL = 80
VCVI_WARNING = 55   # VCVI thresholds slightly lower since it's already vol-adjusted
VCVI_CRITICAL = 72
VPS_ELEVATED = 60
VPS_CRITICAL = 80

# Volatility alert thresholds
VOV_WARNING = 60          # Vol-of-vol: regime becoming unstable
VOV_CRITICAL = 90         # Vol-of-vol: extreme regime instability
ATR_BREAKOUT_MULT = 2.0   # Alert when daily move > N × ATR-14
ATR_BREAKOUT_RVOL = 1.5   # ...and RVOL exceeds this
VOL_REGIME_HIGH = 80      # Alert when vol regime is in top 20th pct of own history

# Conviction Event thresholds — strict multi-gate filter for true anomalies (~1-2/yr)
CONVICTION_VCVI_MIN = 72        # Gate 1: VCVI-21 must reach "critical" level
CONVICTION_BREADTH_MIN = 3      # Gate 2: min N of 5 vol pct windows ≥ 85th pct
CONVICTION_BREADTH_PCT = 85     # Gate 2: percentile threshold per window
CONVICTION_ATR_MULT = 1.5       # Gate 3: |daily move| > N × ATR-14
CONVICTION_VOL_REGIME_MAX = 70  # Gate 4: vol regime must be ≤ this (non-turbulent)
CONVICTION_MIN_GAP_DAYS = 15    # Dedup: min calendar days between distinct events

# Side-Wide Volume Convergence (SWVC) — rolling tri-ETF same-side detection
SWVC_RVOL_THRESHOLD = 2.0   # Min RVOL-21d to qualify as a "spike" for one ETF
SWVC_LOOKBACK_DAYS  = 15    # How many trading days back to search for spikes
SWVC_WINDOW_DAYS    = 10    # All 3 spikes must fall within this window to "converge"


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

    # =========================================================================
    # VOLATILITY MODELLING BLOCK
    # =========================================================================

    # --- Realized Historical Volatility (annualized %) ---
    # HV = rolling std of log returns × √252 × 100
    log_ret = np.log(close / close.shift(1))
    hv_series: Dict[int, pd.Series] = {}
    hv: Dict[str, Optional[float]] = {}
    for w in HV_WINDOWS:
        s = log_ret.rolling(w, min_periods=max(2, w // 2)).std() * np.sqrt(252) * 100
        hv_series[w] = s
        hv[f"{w}d"] = _safe_float(s.iloc[-1])

    # --- ATR-14 (Average True Range as % of current price) ---
    high_s = df["high"]
    low_s = df["low"]
    true_range = pd.concat([
        high_s - low_s,
        (high_s - close.shift(1)).abs(),
        (low_s - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    atr14_series = true_range.rolling(ATR_WINDOW, min_periods=max(2, ATR_WINDOW // 2)).mean()
    atr14_raw = atr14_series.iloc[-1]
    atr14_pct = _safe_float(
        (atr14_raw / close.iloc[-1] * 100) if (close.iloc[-1] > 0 and not np.isnan(atr14_raw)) else np.nan
    )

    # --- Vol Regime Percentile ---
    # Where does the current 21d HV sit relative to its own 252-day history?
    # 0th = historically quiet, 100th = historically extreme
    # Keep full series for historical echoes computation.
    vol_regime_full_series = _percentile_rank(hv_series[21], VOL_REGIME_WINDOW)
    vol_regime_pct = _safe_float(vol_regime_full_series.iloc[-1])

    # --- HV Term Structure (HV10 / HV63) ---
    # < 0.7 = calming / storm passed   |   > 1.3 = accelerating / building storm
    hv10_val = hv.get("10d")
    hv63_val = hv.get("63d")
    if hv10_val is not None and hv63_val is not None and hv63_val > 0:
        hv_term_structure = _safe_float(hv10_val / hv63_val)
    else:
        hv_term_structure = None

    # --- Vol-of-Vol (VoV-21) ---
    # 21-period std of the 10d HV series (already in % annualized).
    # Units: percentage points — how much the annualized short-term vol swings day-to-day.
    # High VoV means the volatility itself is rapidly changing — unstable regime.
    vov21 = _safe_float(
        hv_series[10].rolling(VOV_WINDOW, min_periods=max(2, VOV_WINDOW // 2)).std().iloc[-1]
    )

    # --- VCVI (Vol-Adjusted Capitulation Volume Index) ---
    # VCVI = CVI × (1.5 − vol_regime_pct / 100)
    #   vol_regime=0th  → ×1.5  (quiet vol env → volume spike is MORE remarkable)
    #   vol_regime=50th → ×1.0  (neutral)
    #   vol_regime=100th → ×0.5 (turbulent env → volume spikes expected, discount signal)
    vcvi: Dict[str, Optional[float]] = {}
    for w in VOL_PCT_WINDOWS:
        cvi_val = cvi.get(f"{w}d")
        if cvi_val is not None and vol_regime_pct is not None:
            multiplier = 1.5 - vol_regime_pct / 100.0
            vcvi[f"{w}d"] = _safe_float(max(0.0, cvi_val * multiplier))
        else:
            vcvi[f"{w}d"] = cvi_val  # Fallback to raw CVI

    # --- Historical Echoes ---
    # Reconstruct rolling VCVI-21 series from already-computed intermediates
    # cvi_21_rolling = vol_pct_21 * (1 - price_pct_21 / 100) vectorised over full history
    cvi_21_rolling = vol_pct_series[21] * (1.0 - price_pct_series[21] / 100.0)
    vcvi_21_rolling = (cvi_21_rolling * (1.5 - vol_regime_full_series / 100.0)).clip(lower=0)

    historical_echoes = _compute_historical_echoes(
        close=close,
        vcvi_21_series=vcvi_21_rolling,
        vol_regime_series=vol_regime_full_series,
        vcvi_threshold=VCVI_WARNING,     # 55 — same as alert threshold
        vol_regime_max=60.0,             # only count signals in non-turbulent regimes
        fwd_windows=[5, 10, 21, 42, 63, 126, 252],
    )

    # --- Conviction Events (strict multi-gate anomaly filter) ---
    conviction_events = _detect_conviction_events(
        close=close,
        pct_change=pct_change,
        vcvi_21_series=vcvi_21_rolling,
        vol_regime_series=vol_regime_full_series,
        vol_pct_series_dict=vol_pct_series,
        atr14_series=atr14_series,
        windows=VOL_PCT_WINDOWS,
    )

    # =========================================================================
    # END VOLATILITY BLOCK
    # =========================================================================

    # --- VPS (Volume Pressure Score) — now 5-component with vol regime ---
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
    # InvVolRegime: 100 when vol is quiet → signals more significant; 0 when turbulent
    inv_vol_regime_norm = (100.0 - vol_regime_pct) if vol_regime_pct is not None else 50.0

    vps = _safe_float(
        VPS_W_RVOL * rvol_norm
        + VPS_W_ZSCORE * zscore_norm
        + VPS_W_PCT * pct_norm
        + VPS_W_VROC * vroc_norm
        + VPS_W_VOLREGIME * inv_vol_regime_norm
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

    # VCVI alerts (preferred over raw CVI — vol-regime-adjusted signal)
    for w_key, vcvi_val in vcvi.items():
        if vcvi_val is not None and vcvi_val >= VCVI_CRITICAL:
            alerts.append({
                "type": "vcvi_critical",
                "message": f"VCVI ({w_key}) = {vcvi_val:.1f} — vol-adjusted extreme capitulation",
                "timestamp": now_iso,
            })
        elif vcvi_val is not None and vcvi_val >= VCVI_WARNING:
            alerts.append({
                "type": "vcvi_warning",
                "message": f"VCVI ({w_key}) = {vcvi_val:.1f} — vol-adjusted capitulation signal",
                "timestamp": now_iso,
            })

    # Legacy CVI alerts (retained for compatibility)
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

    # ATR breakout alert: today's move > N × ATR-14 AND elevated RVOL
    today_move_pct = abs(float(pct_change.iloc[-1])) if not np.isnan(pct_change.iloc[-1]) else 0.0
    if (atr14_pct is not None and atr14_pct > 0
            and today_move_pct > ATR_BREAKOUT_MULT * atr14_pct
            and rvol_val is not None and rvol_val > ATR_BREAKOUT_RVOL):
        ratio = today_move_pct / atr14_pct
        alerts.append({
            "type": "atr_breakout",
            "message": (
                f"ATR breakout: {today_move_pct:.1f}% move = {ratio:.1f}× ATR-14 "
                f"({atr14_pct:.1f}%), RVOL {rvol_val:.1f}x"
            ),
            "timestamp": now_iso,
        })

    # VoV spike: regime instability warning
    if vov21 is not None and vov21 >= VOV_CRITICAL:
        alerts.append({
            "type": "vov_extreme",
            "message": f"VoV-21 = {vov21:.0f}% — extreme volatility regime instability",
            "timestamp": now_iso,
        })
    elif vov21 is not None and vov21 >= VOV_WARNING:
        alerts.append({
            "type": "vov_elevated",
            "message": f"VoV-21 = {vov21:.0f}% — volatility regime becoming unstable",
            "timestamp": now_iso,
        })

    # High vol regime warning: volume signals should be discounted
    if vol_regime_pct is not None and vol_regime_pct >= VOL_REGIME_HIGH:
        alerts.append({
            "type": "high_vol_regime",
            "message": (
                f"Vol regime {vol_regime_pct:.0f}th pct — high-volatility environment; "
                "volume spikes are less anomalous"
            ),
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
        "vcvi": vcvi,
        "volatility": {
            "hv": hv,
            "vol_regime_pct": vol_regime_pct,
            "hv_term_structure": hv_term_structure,
            "atr14_pct": atr14_pct,
            "vov21": vov21,
        },
        "historical_echoes": historical_echoes,
        "conviction_events": conviction_events,
        "vps": vps,
        "mwca": mwca,
        "rolling_correlation": rolling_corr,
        "moving_averages": {"price": ma_price, "volume": ma_volume},
        "history": history,
        "alerts": alerts,
        "_rvol_21_last": _safe_float(rvol_21_series.iloc[-1]),
    }


# ---------------------------------------------------------------------------
# Historical Echoes — pattern matching + forward-return study
# ---------------------------------------------------------------------------
def _compute_historical_echoes(
    close: pd.Series,
    vcvi_21_series: pd.Series,
    vol_regime_series: pd.Series,
    vcvi_threshold: float = 55.0,
    vol_regime_max: float = 60.0,
    fwd_windows: list = None,
    min_gap_days: int = 10,
    max_display: int = 8,
) -> dict:
    """
    Scan the full history for dates where:
      - VCVI-21d >= vcvi_threshold  (capitulation signal active)
      - vol_regime_pct <= vol_regime_max  (not in extreme-turbulence regime)

    For each qualifying date, compute forward returns at each window.
    Return aggregated stats + the most recent individual instances.

    min_gap_days ensures we count distinct events, not consecutive days
    of the same signal episode.
    """
    if fwd_windows is None:
        fwd_windows = [5, 10, 21, 42, 63, 126, 252]

    # Align series to common index
    df_work = pd.DataFrame({
        "close": close,
        "vcvi_21": vcvi_21_series,
        "vol_regime": vol_regime_series,
    }).dropna(subset=["close", "vcvi_21", "vol_regime"])

    if df_work.empty:
        return {"count": 0, "threshold_vcvi": vcvi_threshold,
                "threshold_vol_regime": vol_regime_max,
                "forward_returns": {}, "occurrences": []}

    # Exclude the most recent 21 days — need full forward windows
    cutoff = df_work.index[-1] - pd.Timedelta(days=max(fwd_windows) * 2)
    df_hist = df_work[df_work.index <= cutoff]

    if df_hist.empty:
        return {"count": 0, "threshold_vcvi": vcvi_threshold,
                "threshold_vol_regime": vol_regime_max,
                "forward_returns": {}, "occurrences": []}

    signal_mask = (df_hist["vcvi_21"] >= vcvi_threshold) & \
                  (df_hist["vol_regime"] <= vol_regime_max)

    signal_idx = df_hist.index[signal_mask].tolist()

    # Deduplicate: enforce min_gap_days between recorded instances
    deduplicated: list = []
    last_date = None
    for dt in signal_idx:
        if last_date is None or (dt - last_date).days >= min_gap_days:
            deduplicated.append(dt)
            last_date = dt

    if not deduplicated:
        return {"count": 0, "threshold_vcvi": vcvi_threshold,
                "threshold_vol_regime": vol_regime_max,
                "forward_returns": {}, "occurrences": []}

    # Compute forward returns for each qualifying date
    close_arr = df_work["close"]
    occurrences = []
    for dt in deduplicated:
        entry_pos = df_work.index.get_loc(dt)
        entry_price = close_arr.iloc[entry_pos]
        if entry_price <= 0:
            continue

        fwd_rets: Dict[str, Optional[float]] = {}
        for w in fwd_windows:
            exit_pos = entry_pos + w
            if exit_pos < len(close_arr):
                exit_price = close_arr.iloc[exit_pos]
                fwd_rets[f"{w}d"] = _safe_float((exit_price / entry_price - 1) * 100)
            else:
                fwd_rets[f"{w}d"] = None

        occurrences.append({
            "date": dt.strftime("%Y-%m-%d"),
            "vcvi": _safe_float(df_hist.loc[dt, "vcvi_21"]),
            "vol_regime_pct": _safe_float(df_hist.loc[dt, "vol_regime"]),
            "price": _safe_float(entry_price),
            "fwd": fwd_rets,
        })

    if not occurrences:
        return {"count": 0, "threshold_vcvi": vcvi_threshold,
                "threshold_vol_regime": vol_regime_max,
                "forward_returns": {}, "occurrences": []}

    # Aggregate forward return statistics
    # Clip at ±200% before computing mean/best/worst — anything beyond is a data artifact
    # (reverse splits etc.) that would distort statistics. Median is unaffected by clipping.
    CLIP_PCT = 200.0
    forward_stats: Dict[str, dict] = {}
    for w in fwd_windows:
        key = f"{w}d"
        rets = [o["fwd"][key] for o in occurrences if o["fwd"].get(key) is not None]
        if rets:
            rets_arr = np.array(rets)
            rets_clipped = np.clip(rets_arr, -CLIP_PCT, CLIP_PCT)
            forward_stats[key] = {
                "median":   _safe_float(float(np.median(rets_arr))),   # robust, no clip needed
                "mean":     _safe_float(float(np.mean(rets_clipped))),  # clipped mean
                "win_rate": _safe_float(float(np.mean(rets_arr > 0) * 100)),
                "best":     _safe_float(float(np.max(rets_clipped))),
                "worst":    _safe_float(float(np.min(rets_clipped))),
                "count":    len(rets),
            }

    # Return most recent instances for display (most recent first)
    recent = list(reversed(occurrences))[:max_display]

    # Signal edge: find the most ACTIONABLE window (capped at 63d).
    # Beyond 63d, leveraged ETF decay dominates the signal — not a tradeable edge.
    # Score = |median| × |win_rate − 50|² (squaring win_rate deviation rewards consistency).
    best_edge_window = None
    best_edge_score = 0.0
    for key, stats in forward_stats.items():
        w_days = int(key.rstrip("d"))
        if w_days > 63 or stats["count"] < 10:
            continue
        wr_dev = abs((stats["win_rate"] or 50) - 50)
        score = abs(stats["median"] or 0) * (wr_dev ** 2)
        if score > best_edge_score:
            best_edge_score = score
            best_edge_window = key

    return {
        "count": len(occurrences),
        "threshold_vcvi": vcvi_threshold,
        "threshold_vol_regime": vol_regime_max,
        "forward_returns": forward_stats,
        "signal_edge_window": best_edge_window,
        "occurrences": recent,
    }


# ---------------------------------------------------------------------------
# Conviction Events — strict multi-gate anomaly filter
# ---------------------------------------------------------------------------
def _detect_conviction_events(
    close: pd.Series,
    pct_change: pd.Series,
    vcvi_21_series: pd.Series,
    vol_regime_series: pd.Series,
    vol_pct_series_dict: Dict[int, pd.Series],
    atr14_series: pd.Series,
    windows: list,
    min_gap_days: int = CONVICTION_MIN_GAP_DAYS,
    max_display: int = 10,
) -> dict:
    """
    Scan full history for Conviction Events — dates where ALL 4 gates fire:
      Gate 1: VCVI-21 >= 72  (critical vol-adjusted capitulation)
      Gate 2: >= 3 of 5 vol-pct windows >= 85th percentile  (broad breadth)
      Gate 3: |daily move| > 1.5 × ATR-14  (price dislocation)
      Gate 4: vol regime <= 70th percentile  (non-turbulent context)

    Designed to flag only ~1-2 genuine anomalies per ETF per year.
    """
    # Build aligned dataframe
    df_work = pd.DataFrame({
        "close": close,
        "pct_change": pct_change,
        "vcvi_21": vcvi_21_series,
        "vol_regime": vol_regime_series,
        "atr14": atr14_series,
    })

    # Add vol percentile windows
    for w in windows:
        col = f"vol_pct_{w}d"
        if w in vol_pct_series_dict:
            df_work[col] = vol_pct_series_dict[w]

    df_work = df_work.dropna(subset=["close", "vcvi_21", "vol_regime", "atr14", "pct_change"])
    if df_work.empty:
        return {"count": 0, "events": [], "annual_rate": None, "gates": _conviction_gate_spec()}

    # Gate 1: VCVI-21 >= critical
    g1 = df_work["vcvi_21"] >= CONVICTION_VCVI_MIN

    # Gate 2: breadth — count windows above threshold
    breadth_cols = [f"vol_pct_{w}d" for w in windows if f"vol_pct_{w}d" in df_work.columns]
    if breadth_cols:
        breadth_count = (df_work[breadth_cols] >= CONVICTION_BREADTH_PCT).sum(axis=1)
        g2 = breadth_count >= CONVICTION_BREADTH_MIN
    else:
        g2 = pd.Series(False, index=df_work.index)

    # Gate 3: price dislocation — |daily move %| > N × ATR-14 as % of price
    atr_pct = df_work["atr14"] / df_work["close"] * 100
    daily_move_pct = df_work["pct_change"].abs()
    g3 = daily_move_pct > (CONVICTION_ATR_MULT * atr_pct)

    # Gate 4: vol regime context — must be non-turbulent
    g4 = df_work["vol_regime"] <= CONVICTION_VOL_REGIME_MAX

    # ALL gates must fire
    all_pass = g1 & g2 & g3 & g4
    signal_dates = df_work.index[all_pass].tolist()

    # Deduplicate with min gap
    deduplicated: list = []
    last_date = None
    for dt in signal_dates:
        if last_date is None or (dt - last_date).days >= min_gap_days:
            deduplicated.append(dt)
            last_date = dt

    if not deduplicated:
        return {"count": 0, "events": [], "annual_rate": None, "gates": _conviction_gate_spec()}

    # Forward return windows
    fwd_windows = [5, 10, 21, 42, 63]
    close_arr = df_work["close"]

    # Build event records with forward returns
    events = []
    for dt in deduplicated:
        row = df_work.loc[dt]
        bc = int((pd.Series({c: row[c] for c in breadth_cols}) >= CONVICTION_BREADTH_PCT).sum()) if breadth_cols else 0
        entry_pos = df_work.index.get_loc(dt)
        entry_price = close_arr.iloc[entry_pos]

        fwd_rets: Dict[str, Optional[float]] = {}
        for w in fwd_windows:
            exit_pos = entry_pos + w
            if exit_pos < len(close_arr) and entry_price > 0:
                fwd_rets[f"{w}d"] = _safe_float((close_arr.iloc[exit_pos] / entry_price - 1) * 100)
            else:
                fwd_rets[f"{w}d"] = None

        events.append({
            "date": dt.strftime("%Y-%m-%d"),
            "vcvi": _safe_float(row["vcvi_21"]),
            "vol_regime_pct": _safe_float(row["vol_regime"]),
            "daily_move_pct": _safe_float(row["pct_change"]),
            "atr_ratio": _safe_float(abs(row["pct_change"]) / (row["atr14"] / row["close"] * 100)) if row["atr14"] > 0 else None,
            "breadth_count": bc,
            "price": _safe_float(row["close"]),
            "fwd": fwd_rets,
        })

    # Aggregate forward return statistics
    CLIP_PCT = 200.0
    forward_stats: Dict[str, dict] = {}
    for w in fwd_windows:
        key = f"{w}d"
        rets = [e["fwd"][key] for e in events if e["fwd"].get(key) is not None]
        if rets:
            rets_arr = np.array(rets)
            rets_clipped = np.clip(rets_arr, -CLIP_PCT, CLIP_PCT)
            forward_stats[key] = {
                "median":   _safe_float(float(np.median(rets_arr))),
                "mean":     _safe_float(float(np.mean(rets_clipped))),
                "win_rate": _safe_float(float(np.mean(rets_arr > 0) * 100)),
                "best":     _safe_float(float(np.max(rets_clipped))),
                "worst":    _safe_float(float(np.min(rets_clipped))),
                "count":    len(rets),
            }

    # Annual rate
    total_days = (df_work.index[-1] - df_work.index[0]).days
    annual_rate = _safe_float(len(events) / (total_days / 365.25)) if total_days > 90 else None

    # Return most recent first
    events_display = list(reversed(events))[:max_display]

    return {
        "count": len(events),
        "events": events_display,
        "annual_rate": annual_rate,
        "gates": _conviction_gate_spec(),
        "forward_returns": forward_stats,
    }


def _conviction_gate_spec() -> dict:
    """Return the gate thresholds used, for frontend display."""
    return {
        "vcvi_min": CONVICTION_VCVI_MIN,
        "breadth_min": CONVICTION_BREADTH_MIN,
        "breadth_pct": CONVICTION_BREADTH_PCT,
        "atr_mult": CONVICTION_ATR_MULT,
        "vol_regime_max": CONVICTION_VOL_REGIME_MAX,
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
# Side-Wide Volume Convergence (SWVC)
# ---------------------------------------------------------------------------
def _compute_side_convergence(
    frames: Dict[str, pd.DataFrame],
    lookback_days: int = SWVC_LOOKBACK_DAYS,
    window_days: int = SWVC_WINDOW_DAYS,
    rvol_threshold: float = SWVC_RVOL_THRESHOLD,
    rvol_period: int = 21,
) -> dict:
    """
    For each side (long / short), scan the last `lookback_days` trading days
    of each of the 3 ETFs' RVOL-21d series and find the most recent session
    where RVOL >= rvol_threshold.

    If all 3 ETFs on a side had a qualifying spike within `window_days` of each
    other, the side is considered "converged" — a rare, cross-market signal
    indicating that independent investor bases in the US, Canada and UK are all
    acting simultaneously.

    Returns a dict with 'long' and 'short' keys.
    """
    sides: Dict[str, list] = {"long": [], "short": []}
    for ticker, cfg in ETF_CONFIG.items():
        sides[cfg["side"]].append(ticker)

    out: Dict[str, dict] = {}

    for side_name, tickers in sides.items():
        etf_results: Dict[str, dict] = {}

        for ticker in tickers:
            df = frames.get(ticker)
            if df is None or len(df) < rvol_period + 1:
                etf_results[ticker] = {
                    "spiked": False, "date": None,
                    "days_ago": None, "peak_rvol": None,
                }
                continue

            vol = df["volume"].astype(float)
            # Compute rolling 21d RVOL for the tail (lookback + period for warm-up)
            tail_len = lookback_days + rvol_period + 5
            vol_tail = vol.iloc[-tail_len:]
            avg21 = vol_tail.rolling(rvol_period, min_periods=max(2, rvol_period // 2)).mean()
            rvol_tail = (vol_tail / avg21).iloc[-lookback_days:]

            # Find days that exceeded threshold
            spike_mask = rvol_tail >= rvol_threshold
            if not spike_mask.any():
                etf_results[ticker] = {
                    "spiked": False, "date": None,
                    "days_ago": None, "peak_rvol": None,
                }
                continue

            # Most recent spike date + its RVOL value
            last_spike_dt = rvol_tail[spike_mask].index[-1]
            last_spike_rvol = _safe_float(rvol_tail[spike_mask].iloc[-1])
            trading_days_ago = int(spike_mask[::-1].values.argmax())  # reverse argmax gives offset from end

            etf_results[ticker] = {
                "spiked": True,
                "date": last_spike_dt.strftime("%Y-%m-%d"),
                "days_ago": trading_days_ago,
                "peak_rvol": last_spike_rvol,
            }

        # Determine convergence across this side's 3 ETFs
        spiked = {t: r for t, r in etf_results.items() if r["spiked"]}
        score = len(spiked)

        # Calculate calendar-day spread between the earliest and latest spike
        window_spread = None
        all_3_within_window = False
        if score >= 2:
            # Map ticker -> spike date
            spike_dates_map = {}
            for t, r in spiked.items():
                if r["date"]:
                    spike_dates_map[t] = pd.Timestamp(r["date"])
            if len(spike_dates_map) >= 2:
                dates_list = sorted(spike_dates_map.values())
                span = (dates_list[-1] - dates_list[0]).days
                window_spread = span
                if score == 3 and span <= window_days:
                    all_3_within_window = True

        if all_3_within_window:
            status = "converged"
        elif score == 3:
            status = "partial"   # all 3 spiked but outside the window
        elif score == 2:
            status = "partial"
        elif score == 1:
            status = "single"
        else:
            status = "quiet"

        out[side_name] = {
            "status": status,
            "score": score,
            "total": len(tickers),
            "window_days": window_days,
            "window_spread_days": window_spread,
            "threshold_rvol": rvol_threshold,
            "lookback_days": lookback_days,
            "etfs": etf_results,
        }

    return out


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

    # ---- 3b. Side-Wide Volume Convergence ----
    side_convergence = _compute_side_convergence(frames)

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
            "vcvi": m["vcvi"],
            "volatility": m["volatility"],
            "historical_echoes": m["historical_echoes"],
            "conviction_events": m["conviction_events"],
            "vps": m["vps"],
            "mwca": m["mwca"],
            "rolling_correlation": m["rolling_correlation"],
            "moving_averages": m["moving_averages"],
            "history": m["history"],
            "alerts": m["alerts"],
        }
        etfs_out[ticker] = _safe_dict(entry)

    # Add SWVC-level alerts to signals
    for side_name, sc in side_convergence.items():
        if sc.get("status") == "converged":
            tickers_str = ", ".join(sc.get("etfs", {}).keys())
            span = sc.get("window_spread_days")
            all_signals.append({
                "type": "swvc_converged",
                "ticker": f"{side_name}_side",
                "message": (
                    f"All 3 {side_name} ETFs ({tickers_str}) spiked within "
                    f"{span} calendar days — cross-market side-wide convergence"
                ),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    dashboard = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "market_status": _market_status(),
        "etfs": etfs_out,
        "pairs": _safe_dict(pairs_data),
        "side_convergence": _safe_dict(side_convergence),
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
                "vol_regime_pct": (etfs_out[ticker].get("volatility") or {}).get("vol_regime_pct"),
                "hv_term_structure": (etfs_out[ticker].get("volatility") or {}).get("hv_term_structure"),
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
