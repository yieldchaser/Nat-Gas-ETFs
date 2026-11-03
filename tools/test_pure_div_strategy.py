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

def calc_atr(bars, window=14):
    n = len(bars)
    tr = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        h = bars[i]['high']
        l = bars[i]['low']
        pc = bars[i-1]['close']
        tr[i] = max(h - l, abs(h - pc), abs(l - pc))
    tr_s = pd.Series(tr)
    atr = tr_s.ewm(alpha=1.0/window, adjust=False).mean().to_numpy()
    return atr

def detect_rolling_divs(bars, pvt, lookback=22):
    n = len(bars)
    closes = np.array([b['close'] for b in bars])
    bull_flags = np.zeros(n, dtype=bool)
    bear_flags = np.zeros(n, dtype=bool)
    for t in range(lookback, n):
        past_c = closes[t-lookback:t]
        past_p = pvt[t-lookback:t]
        # Bullish: new low in price, higher pvt than pvt at min price
        if closes[t] < np.min(past_c) and pvt[t] > past_p[np.argmin(past_c)]:
            bull_flags[t] = True
        if closes[t] > np.max(past_c) and pvt[t] < past_p[np.argmax(past_c)]:
            bear_flags[t] = True
    return bull_flags, bear_flags

def backtest_div_strategy(bars, bull_flags, trail_k=2.0, max_days=21):
    n = len(bars)
    atr = calc_atr(bars, 14)
    in_pos = False
    entry_idx = 0
    entry_price = 0.0
    highest_price = 0.0
    capital = 10000.0
    peak_capital = 10000.0
    max_dd = 0.0
    trades = []
    daily_capital = [capital]
    
    for i in range(22, n):
        c = bars[i]['close']
        h = bars[i]['high']
        l = bars[i]['low']
        
        if in_pos:
            highest_price = max(highest_price, h)
            stop_price = highest_price - trail_k * atr[i]
            
            should_exit = False
            exit_price = c
            
            if l <= stop_price:
                should_exit = True
                exit_price = min(highest_price, max(bars[i]['open'], stop_price))
            elif (i - entry_idx) >= max_days:
                should_exit = True
                exit_price = c
                
            if should_exit:
                ret = (exit_price - entry_price) / entry_price
                capital *= (1.0 + ret)
                trades.append({
                    'entry_idx': entry_idx,
                    'exit_idx': i,
                    'ret': ret
                })
                in_pos = False
                if capital > peak_capital:
                    peak_capital = capital
                dd = (peak_capital - capital) / peak_capital
                if dd > max_dd:
                    max_dd = dd
            else:
                cur_ret = (c - entry_price) / entry_price
                cur_cap = capital * (1.0 + cur_ret)
                if cur_cap > peak_capital:
                    peak_capital = cur_cap
                dd = (peak_capital - cur_cap) / peak_capital
                if dd > max_dd:
                    max_dd = dd
                    
        if not in_pos and bull_flags[i]:
            in_pos = True
            entry_idx = i
            entry_price = c
            highest_price = c
            
        daily_capital.append(capital if not in_pos else capital * (1.0 + (c - entry_price)/entry_price))
        
    num_trades = len(trades)
    if num_trades == 0:
        return {'trades': 0, 'win_rate': 0, 'return': 0, 'max_dd': 0, 'profit_factor': 0, 'sharpe': 0}
        
    rets = np.array([t['ret'] for t in trades])
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    win_rate = len(wins) / num_trades * 100.0
    pf = (np.sum(wins) / np.sum(np.abs(losses))) if len(losses) > 0 and np.sum(np.abs(losses)) > 0 else 99.0
    total_ret = (capital - 10000.0) / 10000.0 * 100.0
    daily_rets = pd.Series(daily_capital).pct_change().dropna()
    sharpe = (daily_rets.mean() / daily_rets.std() * np.sqrt(252)) if daily_rets.std() > 0 else 0.0
    
    return {
        'trades': num_trades,
        'win_rate': win_rate,
        'return': total_ret,
        'max_dd': max_dd * 100.0,
        'profit_factor': pf,
        'sharpe': sharpe
    }

print("=== PURE DIVERGENCE ENTRY STRATEGY BACKTEST ===")
for ticker in ['KOLD', 'HND.TO', '3NGS.L', 'BOIL', 'HNU.TO', '3NGL.L']:
    bars = etfs[ticker]['history']
    pvt = calc_pvt(bars)
    bull_flags, bear_flags = detect_rolling_divs(bars, pvt, 22)
    # For Short ETFs: hold up to 30 days, trail 2.5 ATR
    # For Long ETFs: hold up to 7 days, trail 1.5 ATR
    if ticker in ['KOLD', 'HND.TO', '3NGS.L']:
        res = backtest_div_strategy(bars, bull_flags, trail_k=2.5, max_days=42)
    else:
        res = backtest_div_strategy(bars, bull_flags, trail_k=1.5, max_days=7)
        
    print(f"{ticker}: Trades={res['trades']} | WinRate={res['win_rate']:4.1f}% | Ret={res['return']:+7.1f}% | PF={res['profit_factor']:4.2f} | MaxDD={res['max_dd']:4.1f}% | Sharpe={res['sharpe']:+4.2f}")
