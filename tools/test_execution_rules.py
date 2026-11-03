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
    atr = tr_s.ewm(alpha=1.0/window, adjust=False).mean().to_numpy()
    return atr

def backtest_strategy(bars, entries, exit_rule_func):
    """
    entries: boolean array where True indicates enter at close of bar i (if not already in position)
    exit_rule_func: function(bar_idx, entry_idx, entry_price, highest_price, current_bar, current_atr, ...) -> bool (True if exit)
    """
    n = len(bars)
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
            # Check exit
            should_exit, exit_price_val = exit_rule_func(i, entry_idx, entry_price, highest_price, bars[i])
            if should_exit:
                ret = (exit_price_val - entry_price) / entry_price
                capital *= (1.0 + ret)
                trades.append({
                    'entry_idx': entry_idx,
                    'exit_idx': i,
                    'holding_days': i - entry_idx,
                    'entry_price': entry_price,
                    'exit_price': exit_price_val,
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
        
        # Check entry if not in position
        if not in_pos and entries[i]:
            in_pos = True
            entry_idx = i
            entry_price = c
            highest_price = c
            
        daily_capital.append(capital if not in_pos else capital * (1.0 + (c - entry_price)/entry_price))
        
    # Close open position at end
    if in_pos:
        ret = (bars[-1]['close'] - entry_price) / entry_price
        capital *= (1.0 + ret)
        trades.append({
            'entry_idx': entry_idx,
            'exit_idx': n-1,
            'holding_days': n - 1 - entry_idx,
            'entry_price': entry_price,
            'exit_price': bars[-1]['close'],
            'ret': ret
        })
        
    num_trades = len(trades)
    if num_trades == 0:
        return {'trades': 0, 'win_rate': 0, 'return': 0, 'max_dd': 0, 'profit_factor': 0, 'sharpe': 0, 'cagr': 0, 'avg_days': 0}
        
    rets = np.array([t['ret'] for t in trades])
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    win_rate = len(wins) / num_trades * 100.0
    gross_profit = np.sum(wins) if len(wins) > 0 else 0.0
    gross_loss = np.sum(np.abs(losses)) if len(losses) > 0 else 0.0
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (99.0 if gross_profit > 0 else 0.0)
    total_ret = (capital - 10000.0) / 10000.0 * 100.0
    
    # CAGR
    years = (pd.to_datetime(bars[-1]['date']) - pd.to_datetime(bars[22]['date'])).days / 365.25
    cagr = ((capital / 10000.0) ** (1.0 / years) - 1.0) * 100.0 if capital > 0 and years > 0 else -100.0
    
    # Sharpe
    daily_rets = pd.Series(daily_capital).pct_change().dropna()
    sharpe = (daily_rets.mean() / daily_rets.std() * np.sqrt(252)) if daily_rets.std() > 0 else 0.0
    
    avg_days = np.mean([t['holding_days'] for t in trades])
    
    return {
        'trades': num_trades,
        'win_rate': win_rate,
        'return': total_ret,
        'cagr': cagr,
        'max_dd': max_dd * 100.0,
        'profit_factor': pf,
        'sharpe': sharpe,
        'avg_days': avg_days
    }

print("Backtest engine defined.")

# Run Backtest Experiments
long_etfs = ['BOIL', 'HNU.TO', '3NGL.L']
short_etfs = ['KOLD', 'HND.TO', '3NGS.L']

print("\n" + "="*90)
print("EXPERIMENT 1A: LONG ETFS SWING EXECUTION (SOLVING THE -99.7% COLLAPSE)")
print("="*90)

for ticker in long_etfs:
    bars = etfs[ticker]['history']
    n = len(bars)
    pvt = calc_pvt(bars)
    sma21 = calc_sma(pvt, 21)
    atr = calc_atr(bars, 14)
    
    # Entries: Bullish Crossover PVT > SMA(21)
    entries = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if pvt[i-1] <= sma21[i-1] and pvt[i] > sma21[i]:
            entries[i] = True
            
    print(f"\n--- Instrument: {ticker} ({n} bars) ---")
    
    # 1. Baseline: exit on PVT < SMA(21)
    def exit_baseline(i, entry_idx, entry_price, highest_price, bar):
        if pvt[i] < sma21[i]:
            return True, bar['close']
        return False, bar['close']
    res_base = backtest_strategy(bars, entries, exit_baseline)
    print(f"  [Baseline] PVT < SMA(21):     Ret: {res_base['return']:+7.1f}% | Win: {res_base['win_rate']:4.1f}% | PF: {res_base['profit_factor']:4.2f} | MaxDD: {res_base['max_dd']:4.1f}% | Sharpe: {res_base['sharpe']:+4.2f} | AvgDays: {res_base['avg_days']:4.1f} | N={res_base['trades']}")
    
    # 2. Fixed Time Stops: 3, 5, 7, 10 days
    for days in [3, 5, 7, 10]:
        def make_exit_time(d):
            def exit_time(i, entry_idx, entry_price, highest_price, bar):
                if (i - entry_idx) >= d:
                    return True, bar['close']
                return False, bar['close']
            return exit_time
        res_t = backtest_strategy(bars, entries, make_exit_time(days))
        print(f"  [Time Stop] Fixed {days:2d}-Day Exit: Ret: {res_t['return']:+7.1f}% | Win: {res_t['win_rate']:4.1f}% | PF: {res_t['profit_factor']:4.2f} | MaxDD: {res_t['max_dd']:4.1f}% | Sharpe: {res_t['sharpe']:+4.2f} | AvgDays: {res_t['avg_days']:4.1f} | N={res_t['trades']}")
        
    # 3. Profit Target ATR Exits: +1.5 ATR, +2.5 ATR (with max 10-day time stop or stop loss)
    for mult in [1.5, 2.0, 2.5]:
        def make_exit_atr_target(m):
            def exit_target(i, entry_idx, entry_price, highest_price, bar):
                entry_atr = atr[entry_idx]
                target = entry_price + m * entry_atr
                stop = entry_price - 1.5 * entry_atr
                # If high reached target
                if bar['high'] >= target:
                    return True, target
                # If low hit stop
                if bar['low'] <= stop:
                    return True, stop
                # Time stop at 10 days
                if (i - entry_idx) >= 10:
                    return True, bar['close']
                return False, bar['close']
            return exit_target
        res_atr = backtest_strategy(bars, entries, make_exit_atr_target(mult))
        print(f"  [ATR Target] +{mult:.1f} ATR / -1.5 ATR: Ret: {res_atr['return']:+7.1f}% | Win: {res_atr['win_rate']:4.1f}% | PF: {res_atr['profit_factor']:4.2f} | MaxDD: {res_atr['max_dd']:4.1f}% | Sharpe: {res_atr['sharpe']:+4.2f} | AvgDays: {res_atr['avg_days']:4.1f} | N={res_atr['trades']}")

    # 4. Trailing Volatility Exit: Trailing stop = Highest - k * ATR
    for k in [1.5, 2.0, 2.5]:
        def make_exit_trailing(trail_k):
            def exit_trail(i, entry_idx, entry_price, highest_price, bar):
                trail_stop = highest_price - trail_k * atr[i]
                if bar['low'] <= trail_stop:
                    # exited at stop or close if opened below
                    exit_p = max(bar['open'], trail_stop) if bar['open'] > trail_stop else bar['open']
                    return True, min(exit_p, highest_price)
                if (i - entry_idx) >= 15: # safety cap
                    return True, bar['close']
                return False, bar['close']
            return exit_trail
        res_trail = backtest_strategy(bars, entries, make_exit_trailing(k))
        print(f"  [Trailing ATR] {k:.1f}x ATR Trail:  Ret: {res_trail['return']:+7.1f}% | Win: {res_trail['win_rate']:4.1f}% | PF: {res_trail['profit_factor']:4.2f} | MaxDD: {res_trail['max_dd']:4.1f}% | Sharpe: {res_trail['sharpe']:+4.2f} | AvgDays: {res_trail['avg_days']:4.1f} | N={res_trail['trades']}")


print("\n" + "="*90)
print("EXPERIMENT 1B: SHORT ETFS TREND EXECUTION & VOLATILITY TRAILING STOPS")
print("="*90)

for ticker in short_etfs:
    bars = etfs[ticker]['history']
    n = len(bars)
    pvt = calc_pvt(bars)
    sma21 = calc_sma(pvt, 21)
    ema21 = calc_ema(pvt, 21)
    atr = calc_atr(bars, 14)
    
    entries = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if pvt[i-1] <= sma21[i-1] and pvt[i] > sma21[i]:
            entries[i] = True
            
    print(f"\n--- Instrument: {ticker} ({n} bars) ---")
    
    # 1. Baseline: exit on PVT < SMA(21)
    def exit_base(i, entry_idx, entry_price, highest_price, bar):
        if pvt[i] < sma21[i]:
            return True, bar['close']
        return False, bar['close']
    res_b = backtest_strategy(bars, entries, exit_base)
    print(f"  [Baseline] PVT < SMA(21):         Ret: {res_b['return']:+7.1f}% | Win: {res_b['win_rate']:4.1f}% | PF: {res_b['profit_factor']:4.2f} | MaxDD: {res_b['max_dd']:4.1f}% | Sharpe: {res_b['sharpe']:+4.2f} | AvgDays: {res_b['avg_days']:4.1f} | N={res_b['trades']}")

    # 2. EMA(21) Exit
    def exit_ema(i, entry_idx, entry_price, highest_price, bar):
        if pvt[i] < ema21[i]:
            return True, bar['close']
        return False, bar['close']
    res_ema = backtest_strategy(bars, entries, exit_ema)
    print(f"  [EMA-21] Exit on PVT < EMA(21):   Ret: {res_ema['return']:+7.1f}% | Win: {res_ema['win_rate']:4.1f}% | PF: {res_ema['profit_factor']:4.2f} | MaxDD: {res_ema['max_dd']:4.1f}% | Sharpe: {res_ema['sharpe']:+4.2f} | AvgDays: {res_ema['avg_days']:4.1f} | N={res_ema['trades']}")

    # 3. Volatility Trailing Stops (Chandelier: Highest - k * ATR) OR PVT < SMA(21)
    for k in [2.0, 2.5, 3.0, 4.0]:
        def make_exit_short_trail(trail_k):
            def exit_st(i, entry_idx, entry_price, highest_price, bar):
                stop_val = highest_price - trail_k * atr[i]
                if bar['low'] <= stop_val:
                    return True, min(highest_price, max(bar['open'], stop_val))
                if pvt[i] < sma21[i]:
                    return True, bar['close']
                return False, bar['close']
            return exit_st
        res_st = backtest_strategy(bars, entries, make_exit_short_trail(k))
        print(f"  [Trail + SMA] {k:.1f}x ATR or SMA21:  Ret: {res_st['return']:+7.1f}% | Win: {res_st['win_rate']:4.1f}% | PF: {res_st['profit_factor']:4.2f} | MaxDD: {res_st['max_dd']:4.1f}% | Sharpe: {res_st['sharpe']:+4.2f} | AvgDays: {res_st['avg_days']:4.1f} | N={res_st['trades']}")

    # 4. Pure Volatility Trail (let trend run without premature SMA whipsaw)
    for k in [2.5, 3.0, 4.0, 5.0]:
        def make_pure_trail(trail_k):
            def exit_pt(i, entry_idx, entry_price, highest_price, bar):
                stop_val = highest_price - trail_k * atr[i]
                if bar['low'] <= stop_val:
                    return True, min(highest_price, max(bar['open'], stop_val))
                return False, bar['close']
            return exit_pt
        res_pt = backtest_strategy(bars, entries, make_pure_trail(k))
        print(f"  [Pure Vol Trail] {k:.1f}x ATR Trail: Ret: {res_pt['return']:+7.1f}% | Win: {res_pt['win_rate']:4.1f}% | PF: {res_pt['profit_factor']:4.2f} | MaxDD: {res_pt['max_dd']:4.1f}% | Sharpe: {res_pt['sharpe']:+4.2f} | AvgDays: {res_pt['avg_days']:4.1f} | N={res_pt['trades']}")

