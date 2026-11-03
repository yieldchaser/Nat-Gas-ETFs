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

def calc_sma(arr, window):
    s = pd.Series(arr)
    return s.rolling(window=window).mean().to_numpy()

def get_forward_returns(bars, signal_indices, horizons=[5, 10, 21]):
    closes = np.array([b['close'] for b in bars])
    n = len(closes)
    results = {h: [] for h in horizons}
    for idx in signal_indices:
        for h in horizons:
            if idx + h < n:
                ret = (closes[idx + h] - closes[idx]) / closes[idx]
                results[h].append(ret)
    return results

def format_stats(ret_list):
    if not ret_list:
        return "N/A"
    arr = np.array(ret_list)
    mean_ret = np.mean(arr) * 100.0
    median_ret = np.median(arr) * 100.0
    win_rate = np.mean(arr > 0) * 100.0
    std_ret = np.std(arr) * 100.0
    return f"Mean: {mean_ret:+6.2f}% | Med: {median_ret:+6.2f}% | Win: {win_rate:5.1f}% | N={len(arr)}"

# Let's run comparison
tickers = ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L']

print("="*80)
print("FORWARD RETURN COMPARISON: PVT CROSSOVER VS DIVERGENCE SIGNALS")
print("="*80)

for ticker in tickers:
    bars = etfs[ticker]['history']
    pvt = calc_pvt(bars)
    sma21 = calc_sma(pvt, 21)
    closes = np.array([b['close'] for b in bars])
    n = len(bars)
    
    # 1. Bullish Crossovers (PVT crosses above SMA21)
    cross_bull = []
    cross_bear = []
    for i in range(22, n):
        if pvt[i-1] <= sma21[i-1] and pvt[i] > sma21[i]:
            cross_bull.append(i)
        elif pvt[i-1] >= sma21[i-1] and pvt[i] < sma21[i]:
            cross_bear.append(i)
            
    # 2. Divergences (Onset: min 5 bars between consecutive signals)
    div_bull = []
    div_bear = []
    lookback = 22
    for t in range(lookback, n):
        past_c = closes[t-lookback:t]
        past_p = pvt[t-lookback:t]
        
        # Bullish: close < min(past_c) and pvt > past_p[argmin]
        if closes[t] < np.min(past_c) and pvt[t] > past_p[np.argmin(past_c)]:
            if len(div_bull) == 0 or (t - div_bull[-1]) >= 3: # min 3-day separation
                div_bull.append(t)
                
        # Bearish: close > max(past_c) and pvt < past_p[argmax]
        if closes[t] > np.max(past_c) and pvt[t] < past_p[np.argmax(past_c)]:
            if len(div_bear) == 0 or (t - div_bear[-1]) >= 3:
                div_bear.append(t)
                
    print(f"\n>>> {ticker} (Bars: {n}) <<<")
    
    # Crossover returns
    fwd_cross_bull = get_forward_returns(bars, cross_bull)
    fwd_cross_bear = get_forward_returns(bars, cross_bear)
    print(f"  [PVT Bullish Crossover] Signals: {len(cross_bull)}")
    print(f"    5-Day:  {format_stats(fwd_cross_bull[5])}")
    print(f"    10-Day: {format_stats(fwd_cross_bull[10])}")
    print(f"    21-Day: {format_stats(fwd_cross_bull[21])}")
    
    # Divergence returns
    fwd_div_bull = get_forward_returns(bars, div_bull)
    fwd_div_bear = get_forward_returns(bars, div_bear)
    print(f"  [PVT Bullish Divergence] Signals: {len(div_bull)}")
    print(f"    5-Day:  {format_stats(fwd_div_bull[5])}")
    print(f"    10-Day: {format_stats(fwd_div_bull[10])}")
    print(f"    21-Day: {format_stats(fwd_div_bull[21])}")
    
    print(f"  [PVT Bearish Divergence] Signals: {len(div_bear)}")
    print(f"    5-Day:  {format_stats(fwd_div_bear[5])}")
    print(f"    10-Day: {format_stats(fwd_div_bear[10])}")
    print(f"    21-Day: {format_stats(fwd_div_bear[21])}")
