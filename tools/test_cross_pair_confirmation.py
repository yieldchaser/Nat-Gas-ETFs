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

def build_date_map(bars):
    return {b['date']: idx for idx, b in enumerate(bars)}

pairs = [
    ('US Pair (2x)', 'BOIL', 'KOLD'),
    ('CA Pair (2x)', 'HNU.TO', 'HND.TO'),
    ('UK Pair (3x)', '3NGL.L', '3NGS.L')
]

def backtest_sim(bars, entry_flags, trail_k=1.5, max_days=15):
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
                    'holding_days': i - entry_idx,
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
                    
        if not in_pos and entry_flags[i]:
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

print("Cross-pair testing engine initialized.")

print("\n" + "="*95)
print("EXPERIMENT 3: CROSS-PAIR CONFIRMATION AUDIT (LONG + INVERSE SYNERGY)")
print("="*95)

for pair_name, long_ticker, short_ticker in pairs:
    bars_l = etfs[long_ticker]['history']
    bars_s = etfs[short_ticker]['history']
    
    # Map dates
    dates_l = {b['date']: i for i, b in enumerate(bars_l)}
    dates_s = {b['date']: i for i, b in enumerate(bars_s)}
    common_dates = sorted(list(set(dates_l.keys()) & set(dates_s.keys())))
    
    # Build aligned bars
    aligned_l = [bars_l[dates_l[d]] for d in common_dates]
    aligned_s = [bars_s[dates_s[d]] for d in common_dates]
    n = len(aligned_l)
    
    pvt_l = calc_pvt(aligned_l)
    sma_l = calc_sma(pvt_l, 21)
    
    pvt_s = calc_pvt(aligned_s)
    sma_s = calc_sma(pvt_s, 21)
    
    closes_s = np.array([b['close'] for b in aligned_s])
    closes_l = np.array([b['close'] for b in aligned_l])
    
    # Detect 22-day rolling divergences on both
    lookback = 22
    div_bear_s = np.zeros(n, dtype=bool)
    div_bull_s = np.zeros(n, dtype=bool)
    div_bear_l = np.zeros(n, dtype=bool)
    div_bull_l = np.zeros(n, dtype=bool)
    
    for t in range(lookback, n):
        # Short ETF divs
        past_cs = closes_s[t-lookback:t]
        past_ps = pvt_s[t-lookback:t]
        if closes_s[t] > np.max(past_cs) and pvt_s[t] < past_ps[np.argmax(past_cs)]:
            div_bear_s[t] = True
        if closes_s[t] < np.min(past_cs) and pvt_s[t] > past_ps[np.argmin(past_cs)]:
            div_bull_s[t] = True
            
        # Long ETF divs
        past_cl = closes_l[t-lookback:t]
        past_pl = pvt_l[t-lookback:t]
        if closes_l[t] > np.max(past_cl) and pvt_l[t] < past_pl[np.argmax(past_cl)]:
            div_bear_l[t] = True
        if closes_l[t] < np.min(past_cl) and pvt_l[t] > past_pl[np.argmin(past_cl)]:
            div_bull_l[t] = True

    # Recent divergence helper (True if div occurred in last W bars)
    def recent_flag(arr, w=5):
        res = np.zeros(len(arr), dtype=bool)
        for i in range(len(arr)):
            start = max(0, i - w + 1)
            res[i] = np.any(arr[start:i+1])
        return res
        
    recent_bear_s = recent_flag(div_bear_s, 5)
    recent_bull_s = recent_flag(div_bull_s, 5)
    recent_bear_l = recent_flag(div_bear_l, 5)
    recent_bull_l = recent_flag(div_bull_l, 5)
    
    # Crossover flags
    cross_bull_l = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if pvt_l[i-1] <= sma_l[i-1] and pvt_l[i] > sma_l[i]:
            cross_bull_l[i] = True
            
    cross_bull_s = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if pvt_s[i-1] <= sma_s[i-1] and pvt_s[i] > sma_s[i]:
            cross_bull_s[i] = True
            
    print(f"\n====================== {pair_name}: {long_ticker} / {short_ticker} ({n} sessions) ======================")
    
    # TEST A: LONG ETF ENTRY (with 1.5x ATR trailing stop)
    print(f"\n--- [A] LONG ETF ({long_ticker}) ASYMMETRIC SWING EXECUTION ---")
    
    # 1. Unconfirmed Long Crossover
    res_l_unconf = backtest_sim(aligned_l, cross_bull_l, trail_k=1.5, max_days=15)
    print(f"  1. Unconfirmed {long_ticker} PVT > SMA(21):")
    print(f"     Trades: {res_l_unconf['trades']} | WinRate: {res_l_unconf['win_rate']:4.1f}% | Ret: {res_l_unconf['return']:+7.1f}% | PF: {res_l_unconf['profit_factor']:4.2f} | MaxDD: {res_l_unconf['max_dd']:4.1f}% | Sharpe: {res_l_unconf['sharpe']:+4.2f}")
    
    # 2. Confirmed by Short ETF below SMA(21)
    entry_l_conf1 = cross_bull_l & (pvt_s < sma_s)
    res_l_conf1 = backtest_sim(aligned_l, entry_l_conf1, trail_k=1.5, max_days=15)
    print(f"  2. Confirmed by {short_ticker} PVT < SMA(21):")
    print(f"     Trades: {res_l_conf1['trades']} | WinRate: {res_l_conf1['win_rate']:4.1f}% | Ret: {res_l_conf1['return']:+7.1f}% | PF: {res_l_conf1['profit_factor']:4.2f} | MaxDD: {res_l_conf1['max_dd']:4.1f}% | Sharpe: {res_l_conf1['sharpe']:+4.2f}")
    
    # 3. Confirmed by Short ETF Bearish Exhaustion (Bearish Div within 5 days)
    entry_l_conf2 = cross_bull_l & recent_bear_s
    res_l_conf2 = backtest_sim(aligned_l, entry_l_conf2, trail_k=1.5, max_days=15)
    print(f"  3. Confirmed by {short_ticker} Bearish Exhaustion (Bear Div in 5d):")
    print(f"     Trades: {res_l_conf2['trades']} | WinRate: {res_l_conf2['win_rate']:4.1f}% | Ret: {res_l_conf2['return']:+7.1f}% | PF: {res_l_conf2['profit_factor']:4.2f} | MaxDD: {res_l_conf2['max_dd']:4.1f}% | Sharpe: {res_l_conf2['sharpe']:+4.2f}")
    
    # 4. Strict Dual Confirmation: Long Cross + Short below SMA + Short Bearish Div in 5d
    entry_l_conf3 = cross_bull_l & (pvt_s < sma_s) & recent_bear_s
    res_l_conf3 = backtest_sim(aligned_l, entry_l_conf3, trail_k=1.5, max_days=15)
    print(f"  4. Dual Confirmation ({short_ticker} < SMA & Bear Div):")
    print(f"     Trades: {res_l_conf3['trades']} | WinRate: {res_l_conf3['win_rate']:4.1f}% | Ret: {res_l_conf3['return']:+7.1f}% | PF: {res_l_conf3['profit_factor']:4.2f} | MaxDD: {res_l_conf3['max_dd']:4.1f}% | Sharpe: {res_l_conf3['sharpe']:+4.2f}")

    # TEST B: SHORT ETF ENTRY (with 2.5x ATR trailing stop)
    print(f"\n--- [B] SHORT ETF ({short_ticker}) TREND EXECUTION ---")
    
    # 1. Unconfirmed Short Crossover
    res_s_unconf = backtest_sim(aligned_s, cross_bull_s, trail_k=2.5, max_days=63)
    print(f"  1. Unconfirmed {short_ticker} PVT > SMA(21):")
    print(f"     Trades: {res_s_unconf['trades']} | WinRate: {res_s_unconf['win_rate']:4.1f}% | Ret: {res_s_unconf['return']:+7.1f}% | PF: {res_s_unconf['profit_factor']:4.2f} | MaxDD: {res_s_unconf['max_dd']:4.1f}% | Sharpe: {res_s_unconf['sharpe']:+4.2f}")

    # 2. Confirmed by Long ETF below SMA(21)
    entry_s_conf1 = cross_bull_s & (pvt_l < sma_l)
    res_s_conf1 = backtest_sim(aligned_s, entry_s_conf1, trail_k=2.5, max_days=63)
    print(f"  2. Confirmed by {long_ticker} PVT < SMA(21):")
    print(f"     Trades: {res_s_conf1['trades']} | WinRate: {res_s_conf1['win_rate']:4.1f}% | Ret: {res_s_conf1['return']:+7.1f}% | PF: {res_s_conf1['profit_factor']:4.2f} | MaxDD: {res_s_conf1['max_dd']:4.1f}% | Sharpe: {res_s_conf1['sharpe']:+4.2f}")

    # 3. Confirmed by Long ETF Capitulation (Bullish Div or breakdown)
    entry_s_conf2 = cross_bull_s & (pvt_l < sma_l) & ~recent_bull_l
    res_s_conf2 = backtest_sim(aligned_s, entry_s_conf2, trail_k=2.5, max_days=63)
    print(f"  3. Confirmed Filter ({long_ticker} < SMA & NO Long Bullish Div):")
    print(f"     Trades: {res_s_conf2['trades']} | WinRate: {res_s_conf2['win_rate']:4.1f}% | Ret: {res_s_conf2['return']:+7.1f}% | PF: {res_s_conf2['profit_factor']:4.2f} | MaxDD: {res_s_conf2['max_dd']:4.1f}% | Sharpe: {res_s_conf2['sharpe']:+4.2f}")

