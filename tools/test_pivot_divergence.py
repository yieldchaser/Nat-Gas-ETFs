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

def find_pivot_divergences(bars, pvt, d=2, max_lookback=22):
    """
    Pivot low at bar i if Low[i] <= Low[i-k] for k in [-d..d]
    Confirmed at bar i + d.
    Compare with previous pivot low in [i - max_lookback, i - 1].
    """
    n = len(bars)
    lows = np.array([b['low'] for b in bars])
    highs = np.array([b['high'] for b in bars])
    closes = np.array([b['close'] for b in bars])
    
    pivot_lows = []
    pivot_highs = []
    
    for i in range(d, n - d):
        # Check pivot low
        is_pivot_low = True
        for k in range(1, d + 1):
            if lows[i] > lows[i - k] or lows[i] > lows[i + k]:
                is_pivot_low = False
                break
        if is_pivot_low:
            pivot_lows.append((i, lows[i], pvt[i]))
            
        # Check pivot high
        is_pivot_high = True
        for k in range(1, d + 1):
            if highs[i] < highs[i - k] or highs[i] < highs[i + k]:
                is_pivot_high = False
                break
        if is_pivot_high:
            pivot_highs.append((i, highs[i], pvt[i]))
            
    # Now find divergences
    bull_divs = []
    for idx_p in range(1, len(pivot_lows)):
        curr_i, curr_low, curr_pvt = pivot_lows[idx_p]
        prev_i, prev_low, prev_pvt = pivot_lows[idx_p - 1]
        
        if (curr_i - prev_i) <= max_lookback:
            # Bullish divergence: curr_low < prev_low, but curr_pvt > prev_pvt
            if curr_low < prev_low and curr_pvt > prev_pvt:
                # Signal confirmed at curr_i + d
                confirm_bar = curr_i + d
                if confirm_bar < n:
                    bull_divs.append(confirm_bar)
                    
    bear_divs = []
    for idx_p in range(1, len(pivot_highs)):
        curr_i, curr_high, curr_pvt = pivot_highs[idx_p]
        prev_i, prev_high, prev_pvt = pivot_highs[idx_p - 1]
        
        if (curr_i - prev_i) <= max_lookback:
            # Bearish divergence: curr_high > prev_high, but curr_pvt < prev_pvt
            if curr_high > prev_high and curr_pvt < prev_pvt:
                confirm_bar = curr_i + d
                if confirm_bar < n:
                    bear_divs.append(confirm_bar)
                    
    return bull_divs, bear_divs

def format_stats(ret_list):
    if not ret_list:
        return "N/A"
    arr = np.array(ret_list)
    mean_ret = np.mean(arr) * 100.0
    median_ret = np.median(arr) * 100.0
    win_rate = np.mean(arr > 0) * 100.0
    return f"Mean: {mean_ret:+6.2f}% | Med: {median_ret:+6.2f}% | Win: {win_rate:5.1f}% | N={len(arr)}"

def get_forward_returns(bars, signal_indices, horizons=[3, 5, 7, 10, 21]):
    closes = np.array([b['close'] for b in bars])
    n = len(closes)
    results = {h: [] for h in horizons}
    for idx in signal_indices:
        for h in horizons:
            if idx + h < n:
                ret = (closes[idx + h] - closes[idx]) / closes[idx]
                results[h].append(ret)
    return results

print("=== SWING PIVOT DIVERGENCE ANALYSIS ===")
for ticker in ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L']:
    bars = etfs[ticker]['history']
    pvt = calc_pvt(bars)
    bull_divs, bear_divs = find_pivot_divergences(bars, pvt, d=2, max_lookback=22)
    fwd_bull = get_forward_returns(bars, bull_divs)
    fwd_bear = get_forward_returns(bars, bear_divs)
    print(f"\n>>> {ticker} <<<")
    print(f"  Pivot Bullish Divs (N={len(bull_divs)}):")
    print(f"    3-Day:  {format_stats(fwd_bull[3])}")
    print(f"    5-Day:  {format_stats(fwd_bull[5])}")
    print(f"    7-Day:  {format_stats(fwd_bull[7])}")
    print(f"    10-Day: {format_stats(fwd_bull[10])}")
    print(f"    21-Day: {format_stats(fwd_bull[21])}")
    print(f"  Pivot Bearish Divs (N={len(bear_divs)}):")
    print(f"    3-Day:  {format_stats(fwd_bear[3])}")
    print(f"    5-Day:  {format_stats(fwd_bear[5])}")
    print(f"    7-Day:  {format_stats(fwd_bear[7])}")
    print(f"    10-Day: {format_stats(fwd_bear[10])}")
    print(f"    21-Day: {format_stats(fwd_bear[21])}")
