import json
import numpy as np
import pandas as pd

with open('docs/data/dashboard_data.json', 'r') as f:
    raw_data = json.load(f)

etfs = raw_data['etfs']

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

def find_divergences_rolling(bars, pvt, lookback=22):
    n = len(bars)
    bull_divs = []
    bear_divs = []
    
    closes = np.array([b['close'] for b in bars])
    
    for t in range(lookback, n):
        # Rolling window [t-lookback : t] (past 22 bars prior to t)
        past_closes = closes[t-lookback:t]
        past_pvt = pvt[t-lookback:t]
        
        # Bullish divergence check:
        # Price hits new 22-day low (close < min of past 22 bars)
        min_past_c = np.min(past_closes)
        min_past_idx = t - lookback + np.argmin(past_closes)
        
        if closes[t] < min_past_c:
            # Price forms a 22-day lower low
            # Check PVT: is PVT[t] higher than PVT at the previous price low?
            # Or is PVT[t] higher than the min PVT of past 22 bars?
            if pvt[t] > past_pvt[np.argmin(past_closes)]: # higher than PVT at prev price low
                bull_divs.append((t, bars[t]['date'], closes[t], pvt[t]))
                
        # Bearish divergence check:
        max_past_c = np.max(past_closes)
        max_past_idx = t - lookback + np.argmax(past_closes)
        if closes[t] > max_past_c:
            if pvt[t] < past_pvt[np.argmax(past_closes)]:
                bear_divs.append((t, bars[t]['date'], closes[t], pvt[t]))
                
    return bull_divs, bear_divs

for ticker in ['BOIL', 'KOLD', 'HNU.TO', 'HND.TO', '3NGL.L', '3NGS.L']:
    bars = etfs[ticker]['history']
    pvt = calc_pvt(bars)
    bull, bear = find_divergences_rolling(bars, pvt, 22)
    print(f"{ticker}: Bullish Divs = {len(bull)}, Bearish Divs = {len(bear)}")
