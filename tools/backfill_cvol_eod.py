"""
Authoritative CME CVOL History Backfill.
Extracts the official settled End-of-Day (EOD) series for NGVL and its components
from 2013-10-01 to 2026-11-13 as rendered by CME QuikStrike.
Replaces all mid-session snapshots from April to November 2026 with official settled values.
"""
import json
import os
import pandas as pd
from pathlib import Path

SOURCE_HTML = Path("tools/all_history_response.html")
TARGET_CSV_DATA = Path("data/cvol/ngvl_cvol_history.csv")
TARGET_CSV_DOCS = Path("docs/data/cvol/ngvl_cvol_history.csv")

col_map = {
    "CVOL Index (NGVL)": "CVOL_INDEX_(NGVL)",
    "Down Var (NGDN)": "DOWN_VAR_(NGDN)",
    "Up Var (NGUP)": "UP_VAR_(NGUP)",
    "Skew (NGSK)": "SKEW_(NGSK)",
    "Skew Ratio (NGSK)": "SKEW_RATIO_(NGSK)",
    "ATM (NGAT)": "ATM_(NGAT)",
    "Convexity (NGCO)": "CONVEXITY_(NGCO)",
    "Underlying": "UNDERLYING",
}

with open(SOURCE_HTML, "r", encoding="utf-8") as f:
    html = f.read()

key = '"JSONSettings"'
idx = html.find(key)
if idx == -1:
    raise ValueError("JSONSettings not found in source HTML.")

colon_idx = html.find(":", idx + len(key))
quote_start = html.find('"', colon_idx)
i = quote_start + 1
while i < len(html):
    if html[i] == "\\":
        i += 2
        continue
    if html[i] == '"':
        quote_end = i
        break
    i += 1

raw_str = json.loads(html[quote_start:quote_end + 1])
settings = json.loads(raw_str)

series_dict = {}
for s in settings.get("Series", []):
    name = s.get("name")
    col_name = col_map.get(name)
    if not col_name:
        continue
    data = s.get("data", [])
    timestamps = [int(p["x"]) for p in data]
    values = [float(p["y"]) for p in data]
    ts = pd.to_datetime(timestamps, unit="ms", utc=True).tz_localize(None).normalize()
    s_obj = pd.Series(values, index=ts, name=col_name)
    # Deduplicate keeping last
    s_obj = s_obj[~s_obj.index.duplicated(keep="last")]
    series_dict[col_name] = s_obj

df = pd.DataFrame(series_dict)

# Filter out any weekend rows if present
df = df[df.index.day_of_week < 5]
df = df.sort_index()

# Verify column ordering
ordered_cols = [
    "CVOL_INDEX_(NGVL)",
    "DOWN_VAR_(NGDN)",
    "UP_VAR_(NGUP)",
    "SKEW_(NGSK)",
    "SKEW_RATIO_(NGSK)",
    "ATM_(NGAT)",
    "CONVEXITY_(NGCO)",
    "UNDERLYING",
]
df = df[ordered_cols]

# Format Timestamp as DD-MM-YYYY
df_out = df.copy()
df_out["Timestamp"] = df_out.index.strftime("%d-%m-%Y")
df_out = df_out.reset_index(drop=True)
df_out = df_out[["Timestamp"] + ordered_cols]

print(f"Total rows to write: {len(df_out)}")
print(f"Date range: {df.index.min().strftime('%Y-%m-%d')} to {df.index.max().strftime('%Y-%m-%d')}")
print("First 3 rows:\n", df_out.head(3))
print("Last 3 rows:\n", df_out.tail(3))

# Write to data/ and docs/
TARGET_CSV_DATA.parent.mkdir(parents=True, exist_ok=True)
TARGET_CSV_DOCS.parent.mkdir(parents=True, exist_ok=True)

df_out.to_csv(TARGET_CSV_DATA, index=False)
df_out.to_csv(TARGET_CSV_DOCS, index=False)
print(f"Successfully updated {TARGET_CSV_DATA} and {TARGET_CSV_DOCS}")
