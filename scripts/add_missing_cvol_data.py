#!/usr/bin/env python3
"""
One-time script to add missing CVOL data for Sept 18-28, 2026
Data extracted from CME web interface tooltips
"""

import pandas as pd
from pathlib import Path

# Missing data from CME web interface tooltips (Sept 18-28, 2026)
missing_data = [
    # Date, CVOL_INDEX, DOWN_VAR, UP_VAR, SKEW, SKEW_RATIO, ATM, CONVEXITY, UNDERLYING
    ("18-09-2026", 50.77, 44.15, 56.62, 12.46, 1.28, 45.02, 1.13, 3.043),
    ("21-09-2026", 51.54, 45.15, 57.22, 12.07, 1.27, 45.81, 1.13, 2.993),
    ("22-09-2026", 54.85, 46.21, 62.29, 16.08, 1.35, 47.96, 1.14, 3.117),
    ("23-09-2026", 57.80, 48.57, 65.75, 17.18, 1.35, 50.73, 1.14, 3.153),
    ("24-09-2026", 76.40, 55.68, 92.60, 36.92, 1.66, 62.37, 1.23, 3.225),
    ("25-09-2026", 71.81, 57.50, 83.71, 26.21, 1.46, 62.33, 1.15, 3.37),
    ("28-09-2026", 66.49, 52.44, 78.06, 25.62, 1.49, 58.38, 1.18, 3.106),
]

# File paths
csv_path = Path("data/cvol/ngvl_cvol_history.csv")
docs_csv_path = Path("docs/data/cvol/ngvl_cvol_history.csv")

def add_missing_data():
    # Read existing CSV
    df = pd.read_csv(csv_path, index_col="Timestamp")
    df.index = pd.to_datetime(df.index, dayfirst=True)
    
    if df.index.tzinfo is None:
        df.index = df.index.tz_localize("UTC")
    
    print(f"Existing data: {len(df)} rows")
    print(f"Date range: {df.index.min().date()} to {df.index.max().date()}")
    
    # Create DataFrame from missing data
    missing_df = pd.DataFrame(missing_data, columns=[
        "Timestamp", "CVOL_INDEX_(NGVL)", "DOWN_VAR_(NGDN)", "UP_VAR_(NGUP)",
        "SKEW_(NGSK)", "SKEW_RATIO_(NGSK)", "ATM_(NGAT)", "CONVEXITY_(NGCO)", "UNDERLYING"
    ])
    
    missing_df["Timestamp"] = pd.to_datetime(missing_df["Timestamp"], dayfirst=True)
    missing_df["Timestamp"] = missing_df["Timestamp"].dt.tz_localize("UTC")
    missing_df.set_index("Timestamp", inplace=True)
    
    print(f"\nAdding {len(missing_df)} missing rows:")
    for date in missing_df.index:
        print(f"  - {date.date()}")
    
    # Combine and sort
    df_combined = pd.concat([df, missing_df]).sort_index()
    df_combined = df_combined[~df_combined.index.duplicated(keep="last")]
    
    # Save with DD-MM-YYYY format
    df_combined.to_csv(csv_path, date_format='%d-%m-%Y')
    df_combined.to_csv(docs_csv_path, date_format='%d-%m-%Y')
    
    print(f"\n✅ Updated!")
    print(f"Total rows: {len(df_combined)}")
    print(f"Date range: {df_combined.index.min().date()} to {df_combined.index.max().date()}")
    print(f"Saved to: {csv_path} and {docs_csv_path}")

if __name__ == "__main__":
    add_missing_data()
