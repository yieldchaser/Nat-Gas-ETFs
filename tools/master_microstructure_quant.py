import json
import math
import numpy as np
import pandas as pd
from scipy import stats

def compute_metrics(returns, horizon, dds=None, rus=None):
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

    avg_dd = float(np.mean(dds) * 100.0) if dds is not None and len(dds) > 0 else 0.0
    worst_dd = float(np.min(dds) * 100.0) if dds is not None and len(dds) > 0 else 0.0
    avg_ru = float(np.mean(rus) * 100.0) if rus is not None and len(rus) > 0 else 0.0
    max_ru = float(np.max(rus) * 100.0) if rus is not None and len(rus) > 0 else 0.0

    return {
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
        'MaxLoss': max_loss,
        'AvgDrawdown': avg_dd,
        'WorstDrawdown': worst_dd,
        'AvgRunup': avg_ru,
        'MaxRunup': max_ru
    }

def eval_mask(df, mask, col, horizon, is_short=False):
    prices = df[col].values
    n = len(df)
    rets = []
    dds = []
    rus = []
    for t in range(n):
        if not mask[t]:
            continue
        if t + horizon >= n:
            continue
        p0 = prices[t]
        p1 = prices[t + horizon]
        if p0 <= 0 or np.isnan(p0) or p1 <= 0 or np.isnan(p1):
            continue
        
        r = (p0 - p1) / p0 if is_short else (p1 - p0) / p0
        rets.append(r)
        
        path = prices[t+1 : t+horizon+1]
        if len(path) > 0:
            if is_short:
                path_ret = (p0 - path) / p0
            else:
                path_ret = (path - p0) / p0
            dds.append(np.min(path_ret))
            rus.append(np.max(path_ret))
            
    return compute_metrics(rets, horizon, dds, rus)

def run_master():
    # Load NG history
    with open('docs/data/ng_history.json') as f:
        ng_data = json.load(f)
    df_ng = pd.DataFrame(ng_data)[['date', 'open', 'high', 'low', 'close', 'volume']].rename(columns={'close': 'ng_close'})
    df_ng['date'] = pd.to_datetime(df_ng['date'])
    df_ng = df_ng.drop_duplicates('date').sort_values('date').reset_index(drop=True)

    # Load ETF flows
    tickers = ['BOIL', 'KOLD', 'HNU', 'HND', '3NGL', '3NGS']
    etfs = {}
    for t in tickers:
        with open(f'docs/data/flows/{t}_flows.json') as f:
            d = json.load(f)['data']
        df = pd.DataFrame(d)
        df['date'] = pd.to_datetime(df['date'])
        df = df.drop_duplicates('date').sort_values('date').reset_index(drop=True)
        df['clean_price'] = (1.0 + df['perf_pct']).cumprod() * 100.0
        etfs[t] = df

    # Primary df anchored on BOIL
    df = etfs['BOIL'].copy()
    df = pd.merge(df, df_ng[['date', 'ng_close']], on='date', how='left')
    df['ng_close'] = df['ng_close'].ffill()

    # Merge KOLD
    df_kold_sub = etfs['KOLD'][['date', 'clean_price', 'usd_flow', 'flow_zscore', 'perf_pct']].rename(columns={
        'clean_price': 'kold_price',
        'usd_flow': 'kold_usd_flow',
        'flow_zscore': 'kold_z',
        'perf_pct': 'kold_perf_pct'
    })
    df = pd.merge(df, df_kold_sub, on='date', how='left')
    df['kold_price'] = df['kold_price'].ffill()

    n = len(df)

    # Past returns
    for h in [1, 3, 5, 10, 20]:
        df[f'boil_past_ret_{h}d'] = df['clean_price'].pct_change(h)
        df[f'ng_past_ret_{h}d'] = df['ng_close'].pct_change(h)
        df[f'kold_past_ret_{h}d'] = df['kold_price'].pct_change(h)

    # Highs and lows
    for w in [20, 60]:
        df[f'boil_high_{w}d'] = df['clean_price'].rolling(w).max()
        df[f'boil_low_{w}d'] = df['clean_price'].rolling(w).min()
        df[f'ng_high_{w}d'] = df['ng_close'].rolling(w).max()
        df[f'ng_low_{w}d'] = df['ng_close'].rolling(w).min()
        df[f'kold_high_{w}d'] = df['kold_price'].rolling(w).max()
        df[f'kold_low_{w}d'] = df['kold_price'].rolling(w).min()

    # Consecutive up days
    up_days = np.zeros(n, dtype=int)
    for i in range(1, n):
        if df['clean_price'].iloc[i] > df['clean_price'].iloc[i-1]:
            up_days[i] = up_days[i-1] + 1
        else:
            up_days[i] = 0
    df['boil_consec_up'] = up_days

    # RSI 14
    delta = df['clean_price'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / (loss + 1e-9)
    df['boil_rsi14'] = 100 - (100 / (1 + rs))

    # Delta Z
    df['delta_z_1d'] = df['flow_zscore'].diff(1)
    df['delta_z_3d'] = df['flow_zscore'].diff(3)

    final_results = {}

    # 1. Baseline
    all_mask = np.ones(n, dtype=bool)
    final_results['baseline'] = {
        'BOIL': {f'{h}D': eval_mask(df, all_mask, 'clean_price', h) for h in [1, 5, 10, 21]},
        'NG': {f'{h}D': eval_mask(df, all_mask, 'ng_close', h) for h in [1, 5, 10, 21]}
    }

    # 2. Correlations across all 6 ETFs
    corr_results = {}
    for t_name, t_df in etfs.items():
        t_df['ret_1d'] = t_df['clean_price'].pct_change(1)
        t_df['ret_5d'] = t_df['clean_price'].pct_change(5)
        t_df['ret_20d'] = t_df['clean_price'].pct_change(20)

        # Merge with NG
        t_merged = pd.merge(t_df, df_ng[['date', 'ng_close']], on='date', how='left')
        t_merged['ng_close'] = t_merged['ng_close'].ffill()
        t_merged['ng_ret_5d'] = t_merged['ng_close'].pct_change(5)
        t_merged['ng_ret_20d'] = t_merged['ng_close'].pct_change(20)

        pairs = [
            ('usd_flow', 'ret_5d'),
            ('usd_flow', 'ret_20d'),
            ('flow_zscore', 'ret_5d'),
            ('flow_zscore', 'ret_20d'),
            ('flow_5d', 'ret_5d'),
            ('flow_20d', 'ret_20d'),
            ('flow_20d', 'ng_ret_20d'),
        ]
        t_corr = {}
        for fcol, rcol in pairs:
            sub = t_merged[[fcol, rcol]].dropna()
            pr, pp = stats.pearsonr(sub[fcol], sub[rcol])
            sr, sp = stats.spearmanr(sub[fcol], sub[rcol])
            t_corr[f'{fcol}_vs_{rcol}'] = {
                'pearson_r': float(pr), 'pearson_p': float(pp),
                'spearman_rho': float(sr), 'spearman_p': float(sp)
            }
        corr_results[t_name] = t_corr
    final_results['cross_etf_correlations'] = corr_results

    # 3. Buy Top Trap Analysis
    buy_top_masks = {
        '2A_Z1.5_Near20DHigh': (df['flow_zscore'] >= 1.5) & (df['clean_price'] >= 0.95 * df['boil_high_20d']),
        '2B_Z1.5_Near60DHigh': (df['flow_zscore'] >= 1.5) & (df['clean_price'] >= 0.95 * df['boil_high_60d']),
        '2C_Z1.5_Past5D_gt_10pct': (df['flow_zscore'] >= 1.5) & (df['boil_past_ret_5d'] > 0.10),
        '2D_Z2.0_Near20DHigh': (df['flow_zscore'] >= 2.0) & (df['clean_price'] >= 0.95 * df['boil_high_20d']),
        '2E_Z2.0_Past5D_gt_15pct': (df['flow_zscore'] >= 2.0) & (df['boil_past_ret_5d'] > 0.15),
    }
    buy_top_res = {}
    for name, msk in buy_top_masks.items():
        buy_top_res[name] = {
            'N': int(msk.sum()),
            'BOIL_long': {f'{h}D': eval_mask(df, msk, 'clean_price', h) for h in [5, 10, 21]},
            'NG_long': {f'{h}D': eval_mask(df, msk, 'ng_close', h) for h in [5, 10, 21]},
            'BOIL_short_fade': {f'{h}D': eval_mask(df, msk, 'clean_price', h, is_short=True) for h in [5, 10, 21]}
        }
    final_results['buy_top_trap'] = buy_top_res

    # 4. Sell Bottom / Capitulation Trap Analysis
    sell_bot_masks = {
        '3A_Zneg1.5_Near20DLow': (df['flow_zscore'] <= -1.5) & (df['clean_price'] <= 1.05 * df['boil_low_20d']),
        '3B_Zneg1.5_Near60DLow': (df['flow_zscore'] <= -1.5) & (df['clean_price'] <= 1.05 * df['boil_low_60d']),
        '3C_Zneg1.5_Past5D_lt_neg10pct': (df['flow_zscore'] <= -1.5) & (df['boil_past_ret_5d'] < -0.10),
        '3D_Zneg2.0_Near20DLow': (df['flow_zscore'] <= -2.0) & (df['clean_price'] <= 1.05 * df['boil_low_20d']),
        '3E_Zneg2.0_Past5D_lt_neg15pct': (df['flow_zscore'] <= -2.0) & (df['boil_past_ret_5d'] < -0.15),
    }
    sell_bot_res = {}
    for name, msk in sell_bot_masks.items():
        sell_bot_res[name] = {
            'N': int(msk.sum()),
            'BOIL_long_bounce': {f'{h}D': eval_mask(df, msk, 'clean_price', h) for h in [5, 10, 21]},
            'NG_long_bounce': {f'{h}D': eval_mask(df, msk, 'ng_close', h) for h in [5, 10, 21]},
        }
    final_results['sell_bottom_trap'] = sell_bot_res

    # 5. True Profitable Edges
    edge_masks = {
        '4A_Momentum_Breakout_With_Flow': (df['clean_price'] > df['clean_price'].shift(1).rolling(20).max()) & (df['flow_zscore'] > 0.5),
        '4A_Momentum_Breakout_No_Flow': (df['clean_price'] > df['clean_price'].shift(1).rolling(20).max()) & (df['flow_zscore'] <= 0.0),
        '4B_Climax_Exhaustion_Fade_Short': (df['flow_zscore'] >= 2.0) & (df['boil_consec_up'] >= 3) & (df['boil_rsi14'] >= 65),
        '4B2_Parabolic_Fade_Short': (df['flow_zscore'] >= 2.0) & (df['boil_past_ret_5d'] > 0.15),
        '4C_Capitulation_Reversal_Long': (df['flow_zscore'] <= -1.5) & (df['boil_past_ret_20d'] < -0.20) & (df['boil_past_ret_5d'] < -0.08),
        '4C2_Capitulation_NG_Futures_Long': (df['flow_zscore'] <= -1.5) & (df['boil_past_ret_20d'] < -0.20) & (df['boil_past_ret_5d'] < -0.08),
        '4D_Flow_Velocity_Spike_Fade_Short': (df['vel_z_3d'] >= 2.0) & (df['boil_past_ret_5d'] > 0.05),
        '4D2_Delta_Z_Decel_Long': (df['delta_z_1d'] <= -2.0),
        '4E_KOLD_Capitulation_Long_BOIL': (df['kold_z'] <= -1.5) & (df['kold_price'] <= 1.05 * df['kold_low_20d']),
        '4E2_KOLD_Capitulation_Long_NG': (df['kold_z'] <= -1.5) & (df['kold_price'] <= 1.05 * df['kold_low_20d']),
        '4F_Outflow_Exhaustion_NG_Long': (df['flow_zscore'] <= -1.0) & (df['boil_past_ret_10d'] < -0.15)
    }

    edges_res = {}
    for name, msk in edge_masks.items():
        is_short = 'Short' in name or 'Fade' in name
        target_col = 'ng_close' if 'NG' in name else 'clean_price'
        edges_res[name] = {
            'N': int(msk.sum()),
            'target': target_col,
            'is_short': is_short,
            'results': {f'{h}D': eval_mask(df, msk, target_col, h, is_short=is_short) for h in [5, 10, 21]}
        }
    final_results['edges'] = edges_res

    # Output to master json
    with open('tools/microstructure_quant_definitive.json', 'w') as f:
        json.dump(final_results, f, indent=2)

    print("Master microstructure quant study successfully executed and exported to tools/microstructure_quant_definitive.json")

if __name__ == '__main__':
    run_master()
