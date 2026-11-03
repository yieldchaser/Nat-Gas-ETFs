import json
import math
import numpy as np
import pandas as pd
from datetime import datetime

# Load data
with open('docs/data/dashboard_data.json', 'r') as f:
    raw_data = json.load(f)

etfs_data = raw_data['etfs']

def calc_pvt(bars):
    n = len(bars)
    pvt = np.zeros(n, dtype=np.float64)
    acc = 0.0
    for i in range(1, n):
        pc = bars[i-1]['close']
        c = bars[i]['close']
        v = bars[i]['volume'] if bars[i]['volume'] is not None else 0.0
        if pc > 0 and c is not None:
            acc += v * (c - pc) / pc
        pvt[i] = acc
    return pvt

def calc_sma(arr, window):
    s = pd.Series(arr)
    return s.rolling(window=window).mean().to_numpy()

def calc_ema(arr, window):
    s = pd.Series(arr)
    return s.ewm(span=window, adjust=False).mean().to_numpy()

def calc_atr(bars, window=14):
    n = len(bars)
    tr = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        h = bars[i]['high']
        l = bars[i]['low']
        pc = bars[i-1]['close']
        tr[i] = max(h - l, abs(h - pc), abs(l - pc))
    tr_s = pd.Series(tr)
    # Wilder's smoothing or ewm
    atr = tr_s.ewm(alpha=1.0/window, adjust=False).mean().to_numpy()
    return atr

print("Data processing setup verified.")
