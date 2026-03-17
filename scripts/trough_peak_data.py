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
START_TS   = int(datetime(2020, 1, 1).timestamp())
TICKERS    = ["KOLD", "BOIL", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L"]
MAX_TRIES  = 3

def fetch_closes(ticker: str):
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
            result = raw["chart"]["result"][0]
            timestamps = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]

            dates, prices = [], []
            for ts, c in zip(timestamps, closes):
                if c is None or c <= 0:
                    continue
                dates.append(datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d"))
                prices.append(round(c, 4))

            log.info("%s: %d rows fetched", ticker, len(dates))
            return {"dates": dates, "closes": prices}

        except Exception as e:
            log.warning("Attempt %d/%d for %s failed: %s", attempt, MAX_TRIES, ticker, e)
            if attempt < MAX_TRIES:
                time.sleep(2 * attempt)

    log.error("All attempts failed for %s", ticker)
    return None


def main():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    output = {"generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "tickers": {}}

    for ticker in TICKERS:
        data = fetch_closes(ticker)
        if data:
            output["tickers"][ticker] = data
        time.sleep(1)  # polite delay between requests

    with open(OUT_FILE, "w") as f:
        json.dump(output, f, separators=(",", ":"))
    log.info("Written to %s", OUT_FILE)


if __name__ == "__main__":
    main()
