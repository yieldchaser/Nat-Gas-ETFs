#!/usr/bin/env python3
import argparse
import json
import logging
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("fetch_flows")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
FLOWS_DIR = DATA_DIR / "flows"

ENDPOINT = "https://www.trackinsight.com/search-api/snapshot/get_snapshots"
TICKERS = ["BOIL", "KOLD", "3NGL", "HNU", "HND", "3NGS"]

def parse_snapshots(data: list | dict, ticker: str) -> pd.DataFrame:
    if isinstance(data, list):
        if not data: return pd.DataFrame()
        item = data[0]
    elif isinstance(data, dict):
        item = data
    else: return pd.DataFrame()

    def unpack(field_data: dict) -> list[float]:
        if not isinstance(field_data, dict): return []
        scale = field_data.get("scale", 1)
        raw = field_data.get("data", [])
        return [v / scale if v is not None else None for v in raw]

    stamp_field = item.get("stamp", {})
    day_numbers = stamp_field.get("data", [])
    dates = []
    for d in day_numbers:
        try:
            dates.append(datetime.fromtimestamp(int(d) * 86400, tz=timezone.utc).strftime("%Y-%m-%d"))
        except Exception:
            dates.append(None)

    flow_vals = unpack(item.get("USD:flow", {}))
    nav_vals = unpack(item.get("nav", {}))
    perf_vals = unpack(item.get("perf", {}))

    n = len(dates)
    pad = lambda lst: lst + [None] * (n - len(lst))
    
    df = pd.DataFrame({
        "date": dates,
        "usd_flow": pad(flow_vals),
        "nav": pad(nav_vals),
        "perf_pct": pad(perf_vals)
    })
    df = df.dropna(subset=["date"])
    df = df.drop_duplicates("date").sort_values("date").reset_index(drop=True)

    df["cumulative_flow"] = df["usd_flow"].cumsum()
    df["daily_inflow"] = df["usd_flow"].clip(lower=0)
    df["daily_outflow"] = df["usd_flow"].clip(upper=0)

    if not df.empty and pd.notna(df["nav"].iloc[-1]):
        latest_nav = df["nav"].iloc[-1]
        if not (0.01 <= latest_nav <= 50000.0):
            raise ValueError(f"Latest NAV {latest_nav} out of reasonable bounds for {ticker}")

    return df

def fetch_live_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    payload = {
        "enterpriseId": None,
        "requests": [{
            "fund": ticker,
            "startDate": start_date,
            "endDate": end_date,
            "columns": ["stamp", "USD:flow", "nav", "perf"]
        }]
    }
    
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Content-Type": "application/json",
            "Accept": "application/json, */*",
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status == 200:
                raw_data = json.loads(response.read().decode())
                return parse_snapshots(raw_data, ticker)
    except Exception as e:
        logger.warning(f"Failed to request data for {ticker} with endDate. Trying without. Error: {e}")
        
    # Retry without endDate
    payload["requests"][0].pop("endDate", None)
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Content-Type": "application/json",
            "Accept": "application/json, */*",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status == 200:
                raw_data = json.loads(response.read().decode())
                return parse_snapshots(raw_data, ticker)
    except Exception as e:
        logger.error(f"Failed to fetch {ticker}: {e}")
    
    return pd.DataFrame()

def apply_derived_metrics(df: pd.DataFrame) -> pd.DataFrame:
    # 30-day rolling Z-Score
    window = 30
    df["mean_30d"] = df["usd_flow"].rolling(window, min_periods=5).mean()
    df["std_30d"] = df["usd_flow"].rolling(window, min_periods=5).std()
    df["flow_zscore"] = np.where(df["std_30d"] > 0, (df["usd_flow"] - df["mean_30d"]) / df["std_30d"], 0.0)

    # Momentum
    df["flow_5d"] = df["usd_flow"].rolling(5, min_periods=1).sum()
    df["flow_20d"] = df["usd_flow"].rolling(20, min_periods=1).sum()

    # Flow Regime
    def get_regime(z):
        if pd.isna(z): return "BALANCED"
        if z > 1.5: return "ACCUMULATION"
        if z < -1.5: return "DISTRIBUTION"
        return "BALANCED"
    df["regime"] = df["flow_zscore"].apply(get_regime)

    # Streak (consecutive days of same direction flow)
    # 1 if positive, -1 if negative, 0 otherwise
    sign = np.sign(df["usd_flow"])
    streak = sign.groupby((sign != sign.shift()).cumsum()).cumsum()
    
    # Pressure
    # Combine z-score + momentum direction + streak
    def compute_pressure(row, s):
        if pd.isna(row["flow_zscore"]): return 0.0
        # Momentum factor: basic scale +10 if 5d>0, -10 if 5d<0
        mom_factor = 10 if row["flow_5d"] > 0 else (-10 if row["flow_5d"] < 0 else 0)
        # Add a streak bonus
        streak_bonus = min(abs(s) * 2, 20) * (1 if s > 0 else -1)
        raw = (row["flow_zscore"] * 25) + mom_factor + streak_bonus
        return max(-100.0, min(100.0, raw))

    pressures = []
    for idx, row in df.iterrows():
        pressures.append(compute_pressure(row, streak.loc[idx]))
    df["pressure"] = pressures

    # Clean up temp cols
    df = df.drop(columns=["mean_30d", "std_30d"])
    
    # Fill NAs in metrics with 0.0
    for col in ["flow_zscore", "flow_5d", "flow_20d", "pressure"]:
        df[col] = df[col].fillna(0.0)
        
    return df

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", action="store_true", help="Seed from local CSVs")
    args = parser.parse_args()

    FLOWS_DIR.mkdir(parents=True, exist_ok=True)
    today_str = datetime.today().strftime("%Y-%m-%d")

    summary_data = {
        "updated": today_str,
        "tickers": {},
        "cross_etf": {}
    }
    
    flow_30d_bull = 0.0
    flow_30d_bear = 0.0

    for ticker in TICKERS:
        logger.info(f"Processing {ticker}...")
        time.sleep(1)
        df = pd.DataFrame()
        
        if args.seed:
            # e.g., KOLD_flows_2021-01-01_2026-03-19.csv
            # We look for a file starting with ticker_flows_
            csv_files = list(DATA_DIR.glob(f"{ticker}_flows_*.csv"))
            if csv_files:
                csv_file = sorted(csv_files)[-1]
                logger.info(f"Seeding from {csv_file}")
                df = pd.read_csv(csv_file)
            else:
                logger.warning(f"No CSV found for {ticker}")
                continue
        else:
            df = fetch_live_data(ticker, "2010-01-01", today_str)
            if df.empty:
                logger.warning(f"Extended history unavailable for {ticker}, falling back to 2021-01-01")
                df = fetch_live_data(ticker, "2021-01-01", today_str)

        if df.empty:
            logger.error(f"No data for {ticker}. Skipping.")
            continue
            
        df = apply_derived_metrics(df)
        
        # Save to JSON
        # Output schema:
        # { "ticker": "...", "updated": "...", "data": [...] }
        json_out = FLOWS_DIR / f"{ticker}_flows.json"
        
        # Round numeric columns for cleaner JSON
        for col in ["usd_flow", "daily_inflow", "daily_outflow", "cumulative_flow", "nav", "perf_pct", "flow_zscore", "flow_5d", "flow_20d", "pressure"]:
            if col in df.columns:
                df[col] = df[col].round(4)
                
        # Handle Inf / NaN
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        df.fillna(0, inplace=True)

        json_dict = {
            "ticker": ticker,
            "updated": today_str,
            "data": df.to_dict(orient="records")
        }
        
        with open(json_out, "w") as f:
            json.dump(json_dict, f, indent=2)
            
        logger.info(f"Saved {len(df)} rows to {json_out}")
        
        # Populate summary
        last_row = df.iloc[-1]
        last_30d_net = df.tail(30)["usd_flow"].sum()
        
        summary_data["tickers"][ticker] = {
            "last_30d_net": round(last_30d_net, 2),
            "zscore": round(last_row["flow_zscore"], 2),
            "regime": last_row["regime"],
            "pressure": round(last_row["pressure"], 0),
            "latest_nav": round(last_row["nav"], 2),
            "flow_5d": round(last_row["flow_5d"], 2),
            "flow_20d": round(last_row["flow_20d"], 2)
        }
        
        if ticker in ["BOIL", "HNU", "3NGL"]:
            flow_30d_bull += last_30d_net
        else:
            flow_30d_bear += last_30d_net

    summary_data["cross_etf"] = {
        "bull_flow_30d": round(flow_30d_bull, 2),
        "bear_flow_30d": round(flow_30d_bear, 2)
    }
    
    # Sentiment simple logic
    net_diff = flow_30d_bull + flow_30d_bear  # if total bull > abs(bear outflow)
    sentiment = "NEUTRAL"
    if flow_30d_bull > 10000 and flow_30d_bull > abs(flow_30d_bear):
        sentiment = "BULLISH"
    elif flow_30d_bear > 10000 and flow_30d_bear > abs(flow_30d_bull):
        sentiment = "BEARISH"
    elif flow_30d_bull > 0 and flow_30d_bear < 0 and flow_30d_bull > abs(flow_30d_bear):
        sentiment = "BULLISH"
    elif flow_30d_bear > 0 and flow_30d_bull < 0 and flow_30d_bear > abs(flow_30d_bull):
        sentiment = "BEARISH"
        
    summary_data["cross_etf"]["sentiment"] = sentiment

    summary_out = FLOWS_DIR / "all_flows_summary.json"
    with open(summary_out, "w") as f:
        json.dump(summary_data, f, indent=2)
    logger.info(f"Saved summary to {summary_out}")

if __name__ == "__main__":
    main()
