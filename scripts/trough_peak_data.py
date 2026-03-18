#!/usr/bin/env python3
"""
Trough-to-Peak Historical Data Builder
=======================================
Fetches full daily close prices from 2020-01-01 for all 6 NAT GAS ETFs
and writes docs/data/trough_peak_data.json for the client-side analyzer.
Reuses the same Yahoo Finance v8 fetch pattern as data_pipeline.py.
"""

import json
import logging
import math
import ssl
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("trough_peak_data")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUT_FILE     = PROJECT_ROOT / "docs" / "data" / "trough_peak_data.json"

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
START_TS   = int(datetime(2008, 1, 1).timestamp())
TICKERS    = ["KOLD", "BOIL", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L"]
MAX_TRIES  = 3

# Manual split/consolidation history for tickers that Yahoo Finance may not
# correctly reflect.  ratio > 1 = reverse split (N:1), ratio < 1 = forward split (1:M).
# Each entry multiplies pre-split prices by ratio so the full series is consistent.
MANUAL_SPLITS: Dict[str, List[Tuple[str, float]]] = {
    "3NGL.L": [
        ("2016-03-18", 10.0),    # 10:1 consolidation
        ("2019-02-25", 10.0),    # 10:1 consolidation
        ("2020-04-17", 10.0),    # 10:1 consolidation
        ("2023-03-27", 10.0),    # 10:1 consolidation
        ("2024-01-12", 10.0),    # 10:1 consolidation
        ("2024-07-22", 420.0),   # 420:1 consolidation
        ("2024-09-09", 10.0),    # 10:1 consolidation
        ("2026-03-03", 10.0),    # 10:1 consolidation
    ],
    "3NGS.L": [
        ("2019-06-04", 10.0),    # 10:1 consolidation
        ("2021-09-15", 10.0),    # 10:1 consolidation
        ("2022-05-30", 10.0),    # 10:1 consolidation
        ("2022-09-12", 10.0),    # 10:1 consolidation
        ("2022-12-19", 17000.0), # 17000:1 consolidation
        ("2024-07-22", 1.0/17),  # 1:17 forward split
    ],
}


def _apply_split_adjustments(
    dates: List[str],
    closes: List[float],
    volumes: List[int],
    ticker: str,
) -> tuple:
    """Apply manual split adjustments to price/volume lists.

    For each split we inspect the price ratio at the split boundary in log-space
    to detect whether Yahoo has already reflected the event.  Only missing
    adjustments are applied, preventing double-counting.
    """
    splits = MANUAL_SPLITS.get(ticker)
    if not splits:
        return dates, closes, volumes

    closes  = list(closes)
    volumes = list(volumes)

    for date_str, ratio in splits:
        # Find index boundary: last index where date < split_date
        boundary = None
        for i, d in enumerate(dates):
            if d < date_str:
                boundary = i
            else:
                break
        if boundary is None or boundary < 0:
            continue  # No data before this split
        post_idx = boundary + 1
        if post_idx >= len(dates):
            continue

        price_before = closes[boundary]
        price_after  = closes[post_idx]
        if not price_before or price_before <= 0:
            continue

        observed_ratio = price_after / price_before

        # Log-space detection: closer to 1.0 → already applied; closer to ratio → not applied
        log_observed = abs(math.log(observed_ratio))
        log_expected = abs(math.log(ratio))
        already_applied = abs(log_observed) < abs(log_observed - log_expected)

        if not already_applied:
            log.info(
                "Applying split adjustment for %s: ×%.4g on %s "
                "(observed jump ×%.4g vs expected ×%.4g)",
                ticker, ratio, date_str, observed_ratio, ratio,
            )
            for i in range(boundary + 1):
                closes[i]  = round(closes[i] * ratio, 4)
                volumes[i] = int(volumes[i] / ratio) if volumes[i] else 0
        else:
            log.debug(
                "Split %s ×%.4g on %s already reflected in Yahoo data — skipping",
                ticker, ratio, date_str,
            )

    return dates, closes, volumes

def fetch_ticker_data(ticker: str):
    period2 = int(datetime.now().timestamp())
    url = (
        f"{YAHOO_URL}{urllib.request.quote(ticker)}"
        f"?period1={START_TS}&period2={period2}&interval=1d&includePrePost=false"
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    for attempt in range(1, MAX_TRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            resp = urllib.request.urlopen(req, context=ctx, timeout=30)
            raw = json.loads(resp.read())
            
            if not raw.get("chart", {}).get("result"):
                log.warning("No result found for %s", ticker)
                return None
                
            result = raw["chart"]["result"][0]
            timestamps = result.get("timestamp", [])
            indicators = result.get("indicators", {})
            quote = indicators.get("quote", [{}])[0]
            
            # Prefer adjclose (adjusted for splits/dividends)
            adj_indicators = indicators.get("adjclose", [{}])[0]
            adj_closes = adj_indicators.get("adjclose", [])
            
            # Fallback to standard close if adjclose is empty or missing
            closes = adj_closes if adj_closes else quote.get("close", [])
            volumes = quote.get("volume", [])

            dates, prices, vols = [], [], []
            for i in range(len(timestamps)):
                c = closes[i] if i < len(closes) else None
                v = volumes[i] if i < len(volumes) else None
                ts = timestamps[i]
                
                # Cleaning/Forward-fill logic: if c is None, skip row
                if c is None or c <= 0:
                    continue
                
                # Volume can be None or 0, we treat it as 0
                vol_val = int(v) if v is not None else 0
                
                date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                # Deduplicate: Yahoo sometimes returns two records for the same date
                # (intraday estimate + official close). Keep the last (most up-to-date).
                if dates and dates[-1] == date_str:
                    prices[-1] = round(float(c), 4)
                    vols[-1] = vol_val
                else:
                    dates.append(date_str)
                    prices.append(round(float(c), 4))
                    vols.append(vol_val)

            log.info("%s: %d rows fetched (adjusted prices)", ticker, len(dates))

            # Apply manual split adjustments for tickers Yahoo may not cover
            dates, prices, vols = _apply_split_adjustments(dates, prices, vols, ticker)

            return {
                "dates": dates,
                "closes": prices,
                "volumes": vols
            }

        except Exception as e:
            log.warning("Attempt %d/%d for %s failed: %s", attempt, MAX_TRIES, ticker, e)
            if attempt < MAX_TRIES:
                time.sleep(2 * attempt)

    log.error("All attempts failed for %s", ticker)
    return None


def main():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    # The generated timestamp is removed from top-level as per user's strict schema request
    # but I'll keep it as a comment or meta field if desired. 
    # User requested: {"tickers": {"TICKER": {...}}}
    output = {"tickers": {}}

    for ticker in TICKERS:
        data = fetch_ticker_data(ticker)
        if data:
            output["tickers"][ticker] = data
        time.sleep(1)  # polite delay between requests

    with open(OUT_FILE, "w") as f:
        json.dump(output, f, separators=(",", ":"))
    log.info("Written to %s", OUT_FILE)


if __name__ == "__main__":
    main()
