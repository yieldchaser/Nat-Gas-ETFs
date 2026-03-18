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
import ssl
import time
import urllib.request
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("trough_peak_data")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUT_FILE     = PROJECT_ROOT / "docs" / "data" / "trough_peak_data.json"

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
START_TS   = int(datetime(2008, 1, 1).timestamp())
TICKERS    = ["KOLD", "BOIL", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L"]
MAX_TRIES  = 3

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
