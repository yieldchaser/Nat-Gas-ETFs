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

def detect_rolling_divs(bars, pvt, lookback=22):
    n = len(bars)
    closes = np.array([b['close'] for b in bars])
    bull_flags = np.zeros(n, dtype=bool)
    bear_flags = np.zeros(n, dtype=bool)
    for t in range(lookback, n):
        past_c = closes[t-lookback:t]
        past_p = pvt[t-lookback:t]
        if closes[t] < np.min(past_c) and pvt[t] > past_p[np.argmin(past_c)]:
            bull_flags[t] = True
        if closes[t] > np.max(past_c) and pvt[t] < past_p[np.argmax(past_c)]:
            bear_flags[t] = True
    return bull_flags, bear_flags

def get_fwd_stats(bars, signal_indices, horizons=[5, 10, 21]):
    closes = np.array([b['close'] for b in bars])
    n = len(closes)
    out = {}
    for h in horizons:
        rets = []
        for idx in signal_indices:
            if idx + h < n:
                rets.append((closes[idx + h] - closes[idx]) / closes[idx])
        if len(rets) > 0:
            arr = np.array(rets)
            out[h] = {
                'mean': np.mean(arr) * 100.0,
                'median': np.median(arr) * 100.0,
                'win_rate': np.mean(arr > 0) * 100.0,
                'n': len(arr)
            }
        else:
            out[h] = {'mean': 0.0, 'median': 0.0, 'win_rate': 0.0, 'n': 0}
    return out

print("Master table generator loaded.")

def backtest_engine(bars, entries, exit_rule_func):
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
            should_exit, exit_p = exit_rule_func(i, entry_idx, entry_price, highest_price, bars[i])
            if should_exit:
                ret = (exit_p - entry_price) / entry_price
                capital *= (1.0 + ret)
                trades.append({
                    'entry_idx': entry_idx,
                    'exit_idx': i,
                    'days': i - entry_idx,
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
                    
        if not in_pos and entries[i]:
            in_pos = True
            entry_idx = i
            entry_price = c
            highest_price = c
            
        daily_capital.append(capital if not in_pos else capital * (1.0 + (c - entry_price)/entry_price))
        
    num_trades = len(trades)
    if num_trades == 0:
        return {'trades': 0, 'win_rate': 0.0, 'return': 0.0, 'cagr': 0.0, 'max_dd': 0.0, 'profit_factor': 0.0, 'sharpe': 0.0, 'avg_days': 0.0}
        
    rets = np.array([t['ret'] for t in trades])
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    win_rate = len(wins) / num_trades * 100.0
    gross_profit = np.sum(wins) if len(wins) > 0 else 0.0
    gross_loss = np.sum(np.abs(losses)) if len(losses) > 0 else 0.0
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (99.0 if gross_profit > 0 else 0.0)
    total_ret = (capital - 10000.0) / 10000.0 * 100.0
    
    years = (pd.to_datetime(bars[-1]['date']) - pd.to_datetime(bars[22]['date'])).days / 365.25
    cagr = ((capital / 10000.0) ** (1.0 / years) - 1.0) * 100.0 if capital > 0 and years > 0 else -100.0
    daily_rets = pd.Series(daily_capital).pct_change().dropna()
    sharpe = (daily_rets.mean() / daily_rets.std() * np.sqrt(252)) if daily_rets.std() > 0 else 0.0
    avg_days = np.mean([t['days'] for t in trades])
    
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

print("Running all audits and compiling master tables...")

# 1. FORWARD RETURNS
print("\n### TABLE 1: FORWARD RETURN DISTRIBUTIONS ACROSS 6 LEVERAGED ETFS")
fwd_results = {}
for ticker in ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L']:
    bars = etfs[ticker]['history']
    n = len(bars)
    pvt = calc_pvt(bars)
    sma21 = calc_sma(pvt, 21)
    
    cross_bull = [i for i in range(22, n) if pvt[i-1] <= sma21[i-1] and pvt[i] > sma21[i]]
    bull_flags, bear_flags = detect_rolling_divs(bars, pvt, 22)
    
    # filter to onset (min 3 bars separation)
    div_bull = []
    div_bear = []
    for i in range(n):
        if bull_flags[i] and (len(div_bull) == 0 or (i - div_bull[-1]) >= 3):
            div_bull.append(i)
        if bear_flags[i] and (len(div_bear) == 0 or (i - div_bear[-1]) >= 3):
            div_bear.append(i)
            
    fwd_cross = get_fwd_stats(bars, cross_bull)
    fwd_div_bull = get_fwd_stats(bars, div_bull)
    fwd_div_bear = get_fwd_stats(bars, div_bear)
    
    fwd_results[ticker] = {
        'cross': fwd_cross,
        'div_bull': fwd_div_bull,
        'div_bear': fwd_div_bear
    }
    
for ticker, d in fwd_results.items():
    print(f"\n#### {ticker}")
    print("| Signal Type | 5-Day Forward Return (Win%) | 10-Day Forward Return (Win%) | 21-Day Forward Return (Win%) | N |")
    print("| :--- | :---: | :---: | :---: | :---: |")
    for stype, sname in [('cross', 'PVT Bullish Crossover'), ('div_bull', 'PVT Bullish Divergence'), ('div_bear', 'PVT Bearish Divergence')]:
        r = d[stype]
        print(f"| **{sname}** | {r[5]['mean']:+5.2f}% ({r[5]['win_rate']:4.1f}%) | {r[10]['mean']:+5.2f}% ({r[10]['win_rate']:4.1f}%) | {r[21]['mean']:+5.2f}% ({r[21]['win_rate']:4.1f}%) | {r[5]['n']} |")

# 2. LONG ETFS ASYMMETRIC EXECUTION
print("\n### TABLE 2: LONG ETFS SWING EXECUTION COMPARISON")
for ticker in ['BOIL', 'HNU.TO', '3NGL.L']:
    bars = etfs[ticker]['history']
    n = len(bars)
    pvt = calc_pvt(bars)
    sma21 = calc_sma(pvt, 21)
    atr = calc_atr(bars, 14)
    entries = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if pvt[i-1] <= sma21[i-1] and pvt[i] > sma21[i]:
            entries[i] = True
            
    # Baseline
    res_base = backtest_engine(bars, entries, lambda i, e_idx, ep, hp, bar: (pvt[i] < sma21[i], bar['close']))
    # Time stops
    res_t3 = backtest_engine(bars, entries, lambda i, e_idx, ep, hp, bar: (i - e_idx >= 3, bar['close']))
    res_t5 = backtest_engine(bars, entries, lambda i, e_idx, ep, hp, bar: (i - e_idx >= 5, bar['close']))
    res_t7 = backtest_engine(bars, entries, lambda i, e_idx, ep, hp, bar: (i - e_idx >= 7, bar['close']))
    res_t10 = backtest_engine(bars, entries, lambda i, e_idx, ep, hp, bar: (i - e_idx >= 10, bar['close']))
    # ATR target
    def atr_target(m):
        def rule(i, e_idx, ep, hp, bar):
            tgt = ep + m * atr[e_idx]
            stp = ep - 1.5 * atr[e_idx]
            if bar['high'] >= tgt: return True, tgt
            if bar['low'] <= stp: return True, stp
            if i - e_idx >= 10: return True, bar['close']
            return False, bar['close']
        return rule
    res_atr15 = backtest_engine(bars, entries, atr_target(1.5))
    res_atr20 = backtest_engine(bars, entries, atr_target(2.0))
    res_atr25 = backtest_engine(bars, entries, atr_target(2.5))
    # Trailing ATR
    def atr_trail(k):
        def rule(i, e_idx, ep, hp, bar):
            st = hp - k * atr[i]
            if bar['low'] <= st: return True, min(hp, max(bar['open'], st))
            if i - e_idx >= 15: return True, bar['close']
            return False, bar['close']
        return rule
    res_tr15 = backtest_engine(bars, entries, atr_trail(1.5))
    res_tr20 = backtest_engine(bars, entries, atr_trail(2.0))
    res_tr25 = backtest_engine(bars, entries, atr_trail(2.5))
    
    print(f"\n#### {ticker} Execution Rules Comparison")
    print("| Execution Mechanism | Return % | CAGR % | Win Rate % | Profit Factor | Max Drawdown % | Sharpe Ratio | Avg Days | Trades |")
    print("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
    for name, r in [
        ('Baseline (PVT < SMA-21 Exit)', res_base),
        ('Fixed 3-Day Time Stop', res_t3),
        ('Fixed 5-Day Time Stop', res_t5),
        ('Fixed 7-Day Time Stop', res_t7),
        ('Fixed 10-Day Time Stop', res_t10),
        ('ATR Target (+1.5 ATR / -1.5 ATR)', res_atr15),
        ('ATR Target (+2.0 ATR / -1.5 ATR)', res_atr20),
        ('ATR Target (+2.5 ATR / -1.5 ATR)', res_atr25),
        ('Trailing Volatility (1.5x ATR Trail)', res_tr15),
        ('Trailing Volatility (2.0x ATR Trail)', res_tr20),
        ('Trailing Volatility (2.5x ATR Trail)', res_tr25)
    ]:
        print(f"| {name} | {r['return']:+7.1f}% | {r['cagr']:+5.1f}% | {r['win_rate']:4.1f}% | {r['profit_factor']:4.2f} | {r['max_dd']:4.1f}% | {r['sharpe']:+4.2f} | {r['avg_days']:4.1f} | {r['trades']} |")

# 3. SHORT ETFS TREND & VOLATILITY TRAILING
print("\n### TABLE 3: SHORT ETFS TREND & VOLATILITY TRAIL COMPARISON")
for ticker in ['KOLD', 'HND.TO', '3NGS.L']:
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
            
    res_base = backtest_engine(bars, entries, lambda i, e_idx, ep, hp, bar: (pvt[i] < sma21[i], bar['close']))
    res_ema = backtest_engine(bars, entries, lambda i, e_idx, ep, hp, bar: (pvt[i] < ema21[i], bar['close']))
    
    def hybrid_trail(k):
        def rule(i, e_idx, ep, hp, bar):
            st = hp - k * atr[i]
            if bar['low'] <= st: return True, min(hp, max(bar['open'], st))
            if pvt[i] < sma21[i]: return True, bar['close']
            return False, bar['close']
        return rule
    res_hyb20 = backtest_engine(bars, entries, hybrid_trail(2.0))
    res_hyb25 = backtest_engine(bars, entries, hybrid_trail(2.5))
    res_hyb30 = backtest_engine(bars, entries, hybrid_trail(3.0))
    res_hyb40 = backtest_engine(bars, entries, hybrid_trail(4.0))
    
    def pure_trail(k):
        def rule(i, e_idx, ep, hp, bar):
            st = hp - k * atr[i]
            if bar['low'] <= st: return True, min(hp, max(bar['open'], st))
            return False, bar['close']
        return rule
    res_pur25 = backtest_engine(bars, entries, pure_trail(2.5))
    res_pur30 = backtest_engine(bars, entries, pure_trail(3.0))
    res_pur40 = backtest_engine(bars, entries, pure_trail(4.0))
    res_pur50 = backtest_engine(bars, entries, pure_trail(5.0))
    
    print(f"\n#### {ticker} Execution Rules Comparison")
    print("| Execution Mechanism | Return % | CAGR % | Win Rate % | Profit Factor | Max Drawdown % | Sharpe Ratio | Avg Days | Trades |")
    print("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
    for name, r in [
        ('Baseline (PVT < SMA-21 Exit)', res_base),
        ('Fast EMA Baseline (PVT < EMA-21)', res_ema),
        ('Hybrid (2.0x ATR Trail or SMA-21)', res_hyb20),
        ('Hybrid (2.5x ATR Trail or SMA-21)', res_hyb25),
        ('Hybrid (3.0x ATR Trail or SMA-21)', res_hyb30),
        ('Hybrid (4.0x ATR Trail or SMA-21)', res_hyb40),
        ('Pure Volatility Trail (2.5x ATR)', res_pur25),
        ('Pure Volatility Trail (3.0x ATR)', res_pur30),
        ('Pure Volatility Trail (4.0x ATR)', res_pur40),
        ('Pure Volatility Trail (5.0x ATR)', res_pur50)
    ]:
        print(f"| {name} | {r['return']:+7.1f}% | {r['cagr']:+5.1f}% | {r['win_rate']:4.1f}% | {r['profit_factor']:4.2f} | {r['max_dd']:4.1f}% | {r['sharpe']:+4.2f} | {r['avg_days']:4.1f} | {r['trades']} |")

