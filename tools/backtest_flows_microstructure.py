import json
import math
import numpy as np
import pandas as pd
from scipy import stats

def load_data():
    # Load NG futures history
    with open('docs/data/ng_history.json', 'r') as f:
        ng_data = json.load(f)
    df_ng = pd.DataFrame(ng_data)[['date', 'open', 'high', 'low', 'close', 'volume']]
    df_ng.columns = ['date', 'ng_open', 'ng_high', 'ng_low', 'ng_close', 'ng_vol']
    df_ng['date'] = pd.to_datetime(df_ng['date'])
    df_ng = df_ng.drop_duplicates(subset=['date']).sort_values('date').reset_index(drop=True)

    # Load ETF flow data
    etf_dfs = {}
    for ticker in ['BOIL', 'KOLD', 'HNU', 'HND', '3NGL', '3NGS']:
        fname = f'docs/data/flows/{ticker}_flows.json'
        with open(fname, 'r') as f:
            raw = json.load(f)['data']
        df = pd.DataFrame(raw)
        df['date'] = pd.to_datetime(df['date'])
        df = df.drop_duplicates(subset=['date']).sort_values('date').reset_index(drop=True)
        # Split-adjusted clean price series compounded from perf_pct
        df['clean_price'] = (1.0 + df['perf_pct']).cumprod() * 100.0
        etf_dfs[ticker] = df

    # Merge BOIL and NG as primary spine
    m = pd.merge(etf_dfs['BOIL'], df_ng, on='date', how='left')
    m['ng_close'] = m['ng_close'].ffill()
    m['ng_open'] = m['ng_open'].ffill()
    m['ng_high'] = m['ng_high'].ffill()
    m['ng_low'] = m['ng_low'].ffill()
    
    # Merge KOLD fields
    kold_cols = ['date', 'clean_price', 'usd_flow', 'flow_zscore', 'perf_pct']
    df_kold_sub = etf_dfs['KOLD'][kold_cols].rename(columns={
        'clean_price': 'kold_price',
        'usd_flow': 'kold_usd_flow',
        'flow_zscore': 'kold_flow_zscore',
        'perf_pct': 'kold_perf_pct'
    })
    m = pd.merge(m, df_kold_sub, on='date', how='left')
    m['kold_price'] = m['kold_price'].ffill()

    return m, etf_dfs

def calc_stats(returns, horizon, intra_drawdowns=None, intra_runups=None):
    returns = np.array(returns, dtype=np.float64)
    returns = returns[~np.isnan(returns)]
    n = len(returns)
    if n == 0:
        return {
            'N': 0, 'Mean': 0.0, 'Median': 0.0, 'Std': 0.0,
            'Skew': 0.0, 'Kurt': 0.0, 'WinRate': 0.0,
            'ProfitFactor': 0.0, 'Sharpe': 0.0, 'Sortino': 0.0,
            'MaxGain': 0.0, 'MaxLoss': 0.0,
            'AvgDrawdown': 0.0, 'WorstDrawdown': 0.0,
            'AvgRunup': 0.0, 'MaxRunup': 0.0
        }
    
    mean_val = float(np.mean(returns))
    median_val = float(np.median(returns))
    std_val = float(np.std(returns, ddof=1)) if n > 1 else 0.0
    skew_val = float(stats.skew(returns)) if n > 2 else 0.0
    kurt_val = float(stats.kurtosis(returns)) if n > 3 else 0.0
    win_rate = float(np.mean(returns > 0.0) * 100.0)
    
    pos_sum = float(np.sum(returns[returns > 0]))
    neg_sum = float(abs(np.sum(returns[returns < 0])))
    profit_factor = (pos_sum / neg_sum) if neg_sum > 1e-9 else (99.0 if pos_sum > 0 else 0.0)
    
    ann_factor = math.sqrt(252.0 / horizon)
    sharpe = (mean_val / std_val * ann_factor) if std_val > 1e-9 else 0.0
    
    downside_diff = np.minimum(returns, 0.0)
    downside_std = math.sqrt(float(np.mean(downside_diff**2)))
    sortino = (mean_val / downside_std * ann_factor) if downside_std > 1e-9 else 0.0
    
    max_gain = float(np.max(returns) * 100.0)
    max_loss = float(np.min(returns) * 100.0)
    
    res = {
        'N': n,
        'Mean': mean_val * 100.0,
        'Median': median_val * 100.0,
        'Std': std_val * 100.0,
        'Skew': skew_val,
        'Kurt': kurt_val,
        'WinRate': win_rate,
        'ProfitFactor': profit_factor,
        'Sharpe': sharpe,
        'Sortino': sortino,
        'MaxGain': max_gain,
        'MaxLoss': max_loss
    }
    
    if intra_drawdowns is not None and len(intra_drawdowns) > 0:
        id_arr = np.array(intra_drawdowns, dtype=np.float64)
        id_arr = id_arr[~np.isnan(id_arr)]
        res['AvgDrawdown'] = float(np.mean(id_arr) * 100.0)
        res['WorstDrawdown'] = float(np.min(id_arr) * 100.0)
    else:
        res['AvgDrawdown'] = 0.0
        res['WorstDrawdown'] = 0.0
        
    if intra_runups is not None and len(intra_runups) > 0:
        ir_arr = np.array(intra_runups, dtype=np.float64)
        ir_arr = ir_arr[~np.isnan(ir_arr)]
        res['AvgRunup'] = float(np.mean(ir_arr) * 100.0)
        res['MaxRunup'] = float(np.max(ir_arr) * 100.0)
    else:
        res['AvgRunup'] = 0.0
        res['MaxRunup'] = 0.0

    return res

def evaluate_signals(df, mask, price_col, horizons=[1, 5, 10, 21], invert=False):
    # Evaluates forward returns and drawdowns for given boolean mask
    n = len(df)
    prices = df[price_col].values
    results = {}
    
    for h in horizons:
        rets = []
        intra_dds = []
        intra_rus = []
        
        for t in range(n):
            if not mask[t]:
                continue
            if t + h >= n:
                continue
                
            entry_p = prices[t]
            if entry_p <= 0 or np.isnan(entry_p):
                continue
                
            exit_p = prices[t + h]
            if invert:
                # Short return: (Entry - Exit) / Entry
                raw_ret = (entry_p - exit_p) / entry_p
            else:
                raw_ret = (exit_p - entry_p) / entry_p
            rets.append(raw_ret)
            
            # Intra-horizon excursion
            future_prices = prices[t+1 : t+h+1]
            if len(future_prices) > 0:
                if invert:
                    # For short: intra drawdown is when price rises above entry
                    # return path: (entry - p) / entry
                    path_rets = (entry_p - future_prices) / entry_p
                else:
                    path_rets = (future_prices - entry_p) / entry_p
                intra_dds.append(np.min(path_rets))
                intra_rus.append(np.max(path_rets))
        
        results[f'{h}D'] = calc_stats(rets, h, intra_dds, intra_rus)
    return results

def main():
    m, etf_dfs = load_data()
    n = len(m)
    print(f'Total trading days loaded: {n}')

    # Add technical indicators
    # 1. Past price returns
    for h in [1, 3, 5, 10, 20, 60]:
        m[f'boil_past_ret_{h}d'] = m['clean_price'].pct_change(h)
        m[f'ng_past_ret_{h}d'] = m['ng_close'].pct_change(h)

    # 2. Rolling highs and lows
    for w in [20, 60]:
        m[f'boil_high_{w}d'] = m['clean_price'].rolling(w).max()
        m[f'boil_low_{w}d'] = m['clean_price'].rolling(w).min()
        m[f'ng_high_{w}d'] = m['ng_close'].rolling(w).max()
        m[f'ng_low_{w}d'] = m['ng_close'].rolling(w).min()

    # 3. Consecutive up days
    up_days = np.zeros(n, dtype=int)
    for i in range(1, n):
        if m['clean_price'].iloc[i] > m['clean_price'].iloc[i-1]:
            up_days[i] = up_days[i-1] + 1
        else:
            up_days[i] = 0
    m['boil_consec_up'] = up_days

    # 4. RSI (14)
    delta = m['clean_price'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / (loss + 1e-9)
    m['boil_rsi14'] = 100 - (100 / (1 + rs))

    # 5. Velocity changes Delta Z
    m['delta_z_1d'] = m['flow_zscore'].diff(1)
    m['delta_z_3d'] = m['flow_zscore'].diff(3)

    out_data = {}

    # -------------------------------------------------------------
    # SECTION 1: UNCONDITIONAL FORWARD RETURN BASELINE
    # -------------------------------------------------------------
    print('\n=============================================================')
    print('SECTION 1: UNCONDITIONAL BASELINE DISTRIBUTIONS (2016-2026)')
    print('=============================================================')
    all_true_mask = np.ones(n, dtype=bool)
    
    baseline_boil = evaluate_signals(m, all_true_mask, 'clean_price', [1, 5, 10, 21])
    baseline_ng = evaluate_signals(m, all_true_mask, 'ng_close', [1, 5, 10, 21])
    
    out_data['baseline_boil'] = baseline_boil
    out_data['baseline_ng'] = baseline_ng

    print('\n--- BOIL Unconditional Forward Return ---')
    print(f"{'Horizon':<8} {'N':<6} {'Mean%':<9} {'Median%':<9} {'Std%':<9} {'WinRate%':<10} {'PF':<7} {'Sharpe':<8} {'Sortino':<8} {'MaxLoss%':<9}")
    for h in ['1D', '5D', '10D', '21D']:
        s = baseline_boil[h]
        print(f"{h:<8} {s['N']:<6} {s['Mean']:<9.2f} {s['Median']:<9.2f} {s['Std']:<9.2f} {s['WinRate']:<10.2f} {s['ProfitFactor']:<7.2f} {s['Sharpe']:<8.2f} {s['Sortino']:<8.2f} {s['MaxLoss']:<9.2f}")

    print('\n--- NG=F Unconditional Forward Return ---')
    print(f"{'Horizon':<8} {'N':<6} {'Mean%':<9} {'Median%':<9} {'Std%':<9} {'WinRate%':<10} {'PF':<7} {'Sharpe':<8} {'Sortino':<8} {'MaxLoss%':<9}")
    for h in ['1D', '5D', '10D', '21D']:
        s = baseline_ng[h]
        print(f"{h:<8} {s['N']:<6} {s['Mean']:<9.2f} {s['Median']:<9.2f} {s['Std']:<9.2f} {s['WinRate']:<10.2f} {s['ProfitFactor']:<7.2f} {s['Sharpe']:<8.2f} {s['Sortino']:<8.2f} {s['MaxLoss']:<9.2f}")

    # Correlations
    print('\n--- FLOW vs CONCURRENT RETURN CORRELATIONS ---')
    correlations = {}
    corr_tests = [
        ('usd_flow', 'boil_past_ret_1d'),
        ('usd_flow', 'boil_past_ret_5d'),
        ('usd_flow', 'boil_past_ret_20d'),
        ('usd_flow', 'ng_past_ret_1d'),
        ('usd_flow', 'ng_past_ret_5d'),
        ('usd_flow', 'ng_past_ret_20d'),
        ('flow_zscore', 'boil_past_ret_1d'),
        ('flow_zscore', 'boil_past_ret_5d'),
        ('flow_zscore', 'boil_past_ret_20d'),
        ('flow_zscore', 'ng_past_ret_1d'),
        ('flow_zscore', 'ng_past_ret_5d'),
        ('flow_zscore', 'ng_past_ret_20d'),
        ('flow_5d', 'boil_past_ret_5d'),
        ('flow_5d', 'ng_past_ret_5d'),
        ('flow_20d', 'boil_past_ret_20d'),
        ('flow_20d', 'ng_past_ret_20d'),
    ]
    for col_flow, col_ret in corr_tests:
        sub = m[[col_flow, col_ret]].dropna()
        p_r, p_p = stats.pearsonr(sub[col_flow], sub[col_ret])
        s_r, s_p = stats.spearmanr(sub[col_flow], sub[col_ret])
        correlations[f'{col_flow}_vs_{col_ret}'] = {
            'pearson_r': float(p_r), 'pearson_p': float(p_p),
            'spearman_rho': float(s_r), 'spearman_p': float(s_p)
        }
        print(f"{col_flow:<12} vs {col_ret:<18}: Pearson r = {p_r:+.4f} (p={p_p:.1e}), Spearman rho = {s_r:+.4f} (p={s_p:.1e})")
    out_data['correlations'] = correlations

    # -------------------------------------------------------------
    # SECTION 2: THE "BUY TOP" TRAP ANALYSIS
    # -------------------------------------------------------------
    print('\n=============================================================')
    print('SECTION 2: THE "BUY TOP" TRAP ANALYSIS')
    print('=============================================================')
    # Condition A: Z >= +1.5 and price within 5% of 20D high
    cond_2a = (m['flow_zscore'] >= 1.5) & (m['clean_price'] >= 0.95 * m['boil_high_20d'])
    # Condition B: Z >= +1.5 and price within 5% of 60D high
    cond_2b = (m['flow_zscore'] >= 1.5) & (m['clean_price'] >= 0.95 * m['boil_high_60d'])
    # Condition C: Z >= +1.5 and 5D return > +10%
    cond_2c = (m['flow_zscore'] >= 1.5) & (m['boil_past_ret_5d'] > 0.10)
    # Condition D: Extreme Inflow Z >= +2.0 and within 5% of 20D high
    cond_2d = (m['flow_zscore'] >= 2.0) & (m['clean_price'] >= 0.95 * m['boil_high_20d'])
    # Condition E: Extreme Inflow Z >= +2.0 and 5D return > +15%
    cond_2e = (m['flow_zscore'] >= 2.0) & (m['boil_past_ret_5d'] > 0.15)

    buy_top_scenarios = {
        '2A_Z1.5_Near20DHigh': cond_2a,
        '2B_Z1.5_Near60DHigh': cond_2b,
        '2C_Z1.5_Ret5D_gt_10pct': cond_2c,
        '2D_Z2.0_Near20DHigh': cond_2d,
        '2E_Z2.0_Ret5D_gt_15pct': cond_2e,
    }
    out_data['buy_top_trap'] = {}

    for name, mask in buy_top_scenarios.items():
        count = int(mask.sum())
        print(f'\n--- Scenario: {name} (N = {count} signals) ---')
        boil_res = evaluate_signals(m, mask, 'clean_price', [5, 10, 21])
        ng_res = evaluate_signals(m, mask, 'ng_close', [5, 10, 21])
        # Also fade return (short BOIL)
        boil_short = evaluate_signals(m, mask, 'clean_price', [5, 10, 21], invert=True)
        
        out_data['buy_top_trap'][name] = {
            'N': count,
            'BOIL_long': boil_res,
            'NG_long': ng_res,
            'BOIL_short': boil_short
        }
        
        print('  BOIL Long (What happens if you buy the inflow at highs):')
        print(f"    {'Horizon':<6} {'Mean%':<8} {'Median%':<8} {'WinRate%':<10} {'PF':<6} {'Sharpe':<7} {'AvgDD%':<8} {'WorstDD%':<9}")
        for h in ['5D', '10D', '21D']:
            s = boil_res[h]
            print(f"    {h:<6} {s['Mean']:<8.2f} {s['Median']:<8.2f} {s['WinRate']:<10.2f} {s['ProfitFactor']:<6.2f} {s['Sharpe']:<7.2f} {s['AvgDrawdown']:<8.2f} {s['WorstDrawdown']:<9.2f}")
            
        print('  NG=F Futures Forward Return:')
        print(f"    {'Horizon':<6} {'Mean%':<8} {'Median%':<8} {'WinRate%':<10} {'PF':<6} {'Sharpe':<7}")
        for h in ['5D', '10D', '21D']:
            s = ng_res[h]
            print(f"    {h:<6} {s['Mean']:<8.2f} {s['Median']:<8.2f} {s['WinRate']:<10.2f} {s['ProfitFactor']:<6.2f} {s['Sharpe']:<7.2f}")

        print('  FADE EDGE (Short BOIL when trap triggers):')
        print(f"    {'Horizon':<6} {'Mean%':<8} {'Median%':<8} {'WinRate%':<10} {'PF':<6} {'Sharpe':<7}")
        for h in ['5D', '10D', '21D']:
            s = boil_short[h]
            print(f"    {h:<6} {s['Mean']:<8.2f} {s['Median']:<8.2f} {s['WinRate']:<10.2f} {s['ProfitFactor']:<6.2f} {s['Sharpe']:<7.2f}")

    # -------------------------------------------------------------
    # SECTION 3: THE "SELL BOTTOM / CAPITULATION" TRAP ANALYSIS
    # -------------------------------------------------------------
    print('\n=============================================================')
    print('SECTION 3: THE "SELL BOTTOM / CAPITULATION" TRAP ANALYSIS')
    print('=============================================================')
    # Condition A: Z <= -1.5 and price within 5% of 20D low
    cond_3a = (m['flow_zscore'] <= -1.5) & (m['clean_price'] <= 1.05 * m['boil_low_20d'])
    # Condition B: Z <= -1.5 and price within 5% of 60D low
    cond_3b = (m['flow_zscore'] <= -1.5) & (m['clean_price'] <= 1.05 * m['boil_low_60d'])
    # Condition C: Z <= -1.5 and 5D return < -10%
    cond_3c = (m['flow_zscore'] <= -1.5) & (m['boil_past_ret_5d'] < -0.10)
    # Condition D: Extreme Outflow Z <= -2.0 and within 5% of 20D low
    cond_3d = (m['flow_zscore'] <= -2.0) & (m['clean_price'] <= 1.05 * m['boil_low_20d'])
    # Condition E: Extreme Outflow Z <= -2.0 and 5D return < -15%
    cond_3e = (m['flow_zscore'] <= -2.0) & (m['boil_past_ret_5d'] < -0.15)

    sell_bottom_scenarios = {
        '3A_Zneg1.5_Near20DLow': cond_3a,
        '3B_Zneg1.5_Near60DLow': cond_3b,
        '3C_Zneg1.5_Ret5D_lt_neg10pct': cond_3c,
        '3D_Zneg2.0_Near20DLow': cond_3d,
        '3E_Zneg2.0_Ret5D_lt_neg15pct': cond_3e,
    }
    out_data['sell_bottom_trap'] = {}

    for name, mask in sell_bottom_scenarios.items():
        count = int(mask.sum())
        print(f'\n--- Scenario: {name} (N = {count} signals) ---')
        boil_long = evaluate_signals(m, mask, 'clean_price', [5, 10, 21])
        ng_long = evaluate_signals(m, mask, 'ng_close', [5, 10, 21])
        
        out_data['sell_bottom_trap'][name] = {
            'N': count,
            'BOIL_long': boil_long,
            'NG_long': ng_long
        }
        
        print('  BOIL Mean-Reverting Bounce (Buying the capitulation outflow):')
        print(f"    {'Horizon':<6} {'Mean%':<8} {'Median%':<8} {'WinRate%':<10} {'PF':<6} {'Sharpe':<7} {'AvgBounce%':<10} {'AvgDD%':<8} {'WorstDD%':<9}")
        for h in ['5D', '10D', '21D']:
            s = boil_long[h]
            print(f"    {h:<6} {s['Mean']:<8.2f} {s['Median']:<8.2f} {s['WinRate']:<10.2f} {s['ProfitFactor']:<6.2f} {s['Sharpe']:<7.2f} {s['AvgRunup']:<10.2f} {s['AvgDrawdown']:<8.2f} {s['WorstDrawdown']:<9.2f}")

        print('  NG=F Futures Forward Bounce:')
        print(f"    {'Horizon':<6} {'Mean%':<8} {'Median%':<8} {'WinRate%':<10} {'PF':<6} {'Sharpe':<7} {'AvgBounce%':<10}")
        for h in ['5D', '10D', '21D']:
            s = ng_long[h]
            print(f"    {h:<6} {s['Mean']:<8.2f} {s['Median']:<8.2f} {s['WinRate']:<10.2f} {s['ProfitFactor']:<6.2f} {s['Sharpe']:<7.2f} {s['AvgRunup']:<10.2f}")

    # -------------------------------------------------------------
    # SECTION 4: TRUE PROFITABLE EDGES (>60% WIN RATE SEARCH)
    # -------------------------------------------------------------
    print('\n=============================================================')
    print('SECTION 4: TRUE PROFITABLE EDGES (SYSTEMATIC EXPLORATION)')
    print('=============================================================')
    edges = {}

    # Edge 4A: Trend-Aligned Momentum Breakout
    # Price breaks above 20D high of yesterday, with positive flow confirmation Z > +0.5
    breakout_20d = m['clean_price'] > m['clean_price'].shift(1).rolling(20).max()
    breakout_with_flow = breakout_20d & (m['flow_zscore'] > 0.5)
    breakout_without_flow = breakout_20d & (m['flow_zscore'] <= 0.0)
    
    print(f'\n--- 4A: Trend-Aligned Momentum Breakout ---')
    print(f'Breakout with Flow Z > +0.5 (N={int(breakout_with_flow.sum())}) vs Without Flow Z <= 0 (N={int(breakout_without_flow.sum())})')
    edges['4A_Breakout_With_Flow'] = {
        'N': int(breakout_with_flow.sum()),
        'BOIL': evaluate_signals(m, breakout_with_flow, 'clean_price', [5, 10, 21]),
        'NG': evaluate_signals(m, breakout_with_flow, 'ng_close', [5, 10, 21])
    }
    edges['4A_Breakout_Without_Flow'] = {
        'N': int(breakout_without_flow.sum()),
        'BOIL': evaluate_signals(m, breakout_without_flow, 'clean_price', [5, 10, 21]),
        'NG': evaluate_signals(m, breakout_without_flow, 'ng_close', [5, 10, 21])
    }
    print('  Breakout WITH Flow (BOIL):')
    for h in ['5D', '10D', '21D']:
        s = edges['4A_Breakout_With_Flow']['BOIL'][h]
        print(f"    {h:<6} Mean={s['Mean']:<7.2f}% WinRate={s['WinRate']:<6.2f}% PF={s['ProfitFactor']:<5.2f} Sharpe={s['Sharpe']:<6.2f}")
    print('  Breakout WITHOUT Flow (BOIL):')
    for h in ['5D', '10D', '21D']:
        s = edges['4A_Breakout_Without_Flow']['BOIL'][h]
        print(f"    {h:<6} Mean={s['Mean']:<7.2f}% WinRate={s['WinRate']:<6.2f}% PF={s['ProfitFactor']:<5.2f} Sharpe={s['Sharpe']:<6.2f}")

    # Edge 4B: Climax Exhaustion Reversal (Fading the Herd)
    # Extreme inflow Z >= +2.0 after >= 3 consecutive up-days AND RSI14 >= 65
    climax_fade_mask = (m['flow_zscore'] >= 2.0) & (m['boil_consec_up'] >= 3) & (m['boil_rsi14'] >= 65)
    print(f'\n--- 4B: Climax Exhaustion Reversal (Fade / Short BOIL) (N={int(climax_fade_mask.sum())}) ---')
    edges['4B_Climax_Fade_Short'] = {
        'N': int(climax_fade_mask.sum()),
        'BOIL_short': evaluate_signals(m, climax_fade_mask, 'clean_price', [5, 10, 21], invert=True),
        'NG_short': evaluate_signals(m, climax_fade_mask, 'ng_close', [5, 10, 21], invert=True)
    }
    for h in ['5D', '10D', '21D']:
        s = edges['4B_Climax_Fade_Short']['BOIL_short'][h]
        print(f"    Short BOIL {h:<4} Mean={s['Mean']:<7.2f}% Median={s['Median']:<7.2f}% WinRate={s['WinRate']:<6.2f}% PF={s['ProfitFactor']:<5.2f} Sharpe={s['Sharpe']:<6.2f}")

    # Edge 4C: Capitulation Reversal (Buying Panic Washout)
    # Outflow Z <= -1.5 after severe downtrend (20D return < -20% or 5D return < -12%)
    capitulation_buy_mask = (m['flow_zscore'] <= -1.5) & (m['boil_past_ret_20d'] < -0.20) & (m['boil_past_ret_5d'] < -0.08)
    print(f'\n--- 4C: Capitulation Panic Reversal (Long BOIL) (N={int(capitulation_buy_mask.sum())}) ---')
    edges['4C_Capitulation_Buy'] = {
        'N': int(capitulation_buy_mask.sum()),
        'BOIL_long': evaluate_signals(m, capitulation_buy_mask, 'clean_price', [5, 10, 21]),
        'NG_long': evaluate_signals(m, capitulation_buy_mask, 'ng_close', [5, 10, 21])
    }
    for h in ['5D', '10D', '21D']:
        s = edges['4C_Capitulation_Buy']['BOIL_long'][h]
        print(f"    Long BOIL  {h:<4} Mean={s['Mean']:<7.2f}% Median={s['Median']:<7.2f}% WinRate={s['WinRate']:<6.2f}% PF={s['ProfitFactor']:<5.2f} Sharpe={s['Sharpe']:<6.2f} AvgBounce={s['AvgRunup']:<6.2f}%")

    # Edge 4D: Flow Velocity / Acceleration Spike (delta Z)
    # Velocity spike Delta Z_3d >= +2.0 or vel_z_3d >= +2.0
    vel_spike_mask = (m['vel_z_3d'] >= 2.0) & (m['boil_past_ret_5d'] > 0.05)
    print(f'\n--- 4D: Flow Velocity Climax Fade (Short BOIL) (N={int(vel_spike_mask.sum())}) ---')
    edges['4D_Velocity_Climax_Fade'] = {
        'N': int(vel_spike_mask.sum()),
        'BOIL_short': evaluate_signals(m, vel_spike_mask, 'clean_price', [5, 10, 21], invert=True)
    }
    for h in ['5D', '10D', '21D']:
        s = edges['4D_Velocity_Climax_Fade']['BOIL_short'][h]
        print(f"    Short BOIL {h:<4} Mean={s['Mean']:<7.2f}% WinRate={s['WinRate']:<6.2f}% PF={s['ProfitFactor']:<5.2f} Sharpe={s['Sharpe']:<6.2f}")

    # Edge 4E: Cross-Pair Inversion Edge
    # When KOLD (bear ETF) has massive capitulation outflow (Z_kold <= -1.5) at 20D low of KOLD (which means NG is soaring)
    # OR when KOLD has extreme inflow (retail hedging NG rally)
    kold_capitulation = (m['kold_flow_zscore'] <= -1.5) & (m['kold_price'] <= 1.05 * m['kold_price'].rolling(20).min())
    print(f'\n--- 4E: Cross-Pair KOLD Capitulation -> Long NG / BOIL (N={int(kold_capitulation.sum())}) ---')
    edges['4E_KOLD_Capitulation_Long_BOIL'] = {
        'N': int(kold_capitulation.sum()),
        'BOIL_long': evaluate_signals(m, kold_capitulation, 'clean_price', [5, 10, 21]),
        'NG_long': evaluate_signals(m, kold_capitulation, 'ng_close', [5, 10, 21])
    }
    for h in ['5D', '10D', '21D']:
        s = edges['4E_KOLD_Capitulation_Long_BOIL']['BOIL_long'][h]
        print(f"    Long BOIL  {h:<4} Mean={s['Mean']:<7.2f}% WinRate={s['WinRate']:<6.2f}% PF={s['ProfitFactor']:<5.2f} Sharpe={s['Sharpe']:<6.2f}")

    out_data['edges'] = edges

    # Save to JSON
    with open('tools/microstructure_empirical_results.json', 'w') as f:
        json.dump(out_data, f, indent=2)
    print('\nSuccessfully wrote results to tools/microstructure_empirical_results.json')

if __name__ == '__main__':
    main()
