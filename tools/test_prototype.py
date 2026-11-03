import json
import numpy as np
import pandas as pd

# Load dashboard data
with open('docs/data/dashboard_data.json', 'r') as f:
    dashboard_data = json.load(f)

print("ETFs in dataset:", list(dashboard_data['etfs'].keys()))
for ticker, etf in dashboard_data['etfs'].items():
    history = etf['history']
    print(f"{ticker}: {len(history)} bars, {history[0]['date']} to {history[-1]['date']}")
