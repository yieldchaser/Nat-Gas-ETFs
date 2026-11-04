import json
import pandas as pd
import numpy as np
from scipy import stats

def run_edge_search():
    with open('docs/data/flows/BOIL_flows.json') as f:
        boil = json.load(f)['data']
    with open('docs/data/flows/KOLD_flows.json') as f:
        kold = json.load(f)['data']
    with open('docs/data/ng_history.json') as f:
        ng = json.load(f)

    df_boil = pd.DataFrame(boil)
    df_boil['date'] = pd.to_datetime(df_boil['date'])
    df_boil['boil_price'] = (1.0 + df_boil['perf_pct']).cumprod() * 100.0

    df_kold = pd.DataFrame(kold)
    df_kold['date'] = pd.to_datetime(df_kold['date'])
    df_kold['kold_price'] = (1.0 + df_kold['perf_pct']).cumprod() * 100.0
    df_kold = df_kold[['date', 'kold_price', 'flow_zscore', 'usd_flow', 'vel_z_1d', 'vel_z_3d']].rename(columns={
        'flow_zscore': 'kold_z',
        'usd_flow': 'kold_flow',
        'vel_z_1d': 'kold_vel_z_1d',
        'vel_z_3d': 'kold_vel_z_3d'
    })

    df_ng = pd.DataFrame(ng)[['date', 'close', 'high', 'low']].rename(columns={'close': 'ng_close'})
    df_ng['date'] = pd.to_datetime(df_ng['date'])

    df = pd.merge(df_boil, df_kold, on='date', how='left')
    df = pd.merge(df, df_ng, on='date', how='left')
    df['ng_close'] = df['ng_close'].ffill()
    df['kold_price'] = df['kold_price'].ffill()

    # Technical indicators
    for h in [1, 3, 5, 10, 20]:
        df[f'boil_ret_{h}d'] = df['boil_price'].pct_change(h)
        df[f'ng_ret_{h}d'] = df['ng_close'].pct_change(h)
        df[f'kold_ret_{h}d'] = df['kold_price'].pct_change(h)

    # 20D highs and lows
    df['boil_high_20d'] = df['boil_price'].rolling(20).max()
    df['boil_low_20d'] = df['boil_price'].rolling(20).min()
    df['ng_high_20d'] = df['ng_close'].rolling(20).max()
    df['ng_low_20d'] = df['ng_close'].rolling(20).min()
    df['kold_high_20d'] = df['kold_price'].rolling(20).max()
    df['kold_low_20d'] = df['kold_price'].rolling(20).min()

    # RSI 14
    delta = df['boil_price'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / (loss + 1e-9)
    df['boil_rsi'] = 100 - (100 / (1 + rs))

    # Test candidate strategies
    strategies = {}

    # Strategy 1: Fading Extreme Climax Inflows (Overbought Reversal)
    # Price had a strong 5D rally (> +10%) and BOIL Z-score surges (Z >= +1.5)
    # Trade: SHORT BOIL or BUY KOLD
    s1_mask = (df['boil_ret_5d'] > 0.10) & (df['flow_zscore'] >= 1.5)
    strategies['Climax_Fade_5D_gt_10_Z_ge_1.5'] = (s1_mask, 'boil_price', True) # True means short

    # Strategy 2: Fading Parabolic Surge with Extreme Inflow (Z >= +2.0)
    s2_mask = (df['boil_ret_5d'] > 0.15) & (df['flow_zscore'] >= 2.0)
    strategies['Parabolic_Fade_5D_gt_15_Z_ge_2.0'] = (s2_mask, 'boil_price', True)

    # Strategy 3: Capitulation Reversal Bounce (Z <= -1.5 & oversold)
    # Trade: LONG BOIL
    s3_mask = (df['flow_zscore'] <= -1.5) & (df['boil_ret_5d'] < -0.05) & (df['boil_price'] <= 1.05 * df['boil_low_20d'])
    strategies['Capitulation_Bounce_Z_le_neg1.5_Ret5D_neg_Low20D'] = (s3_mask, 'boil_price', False)

    # Strategy 4: Severe Capitulation Bounce on NG Futures
    # Trade: LONG NG futures on BOIL Capitulation
    strategies['Capitulation_NG_Futures_Bounce'] = (s3_mask, 'ng_close', False)

    # Strategy 5: KOLD (Inverse) Capitulation -> Long BOIL
    # When KOLD dumps with extreme outflow Z <= -1.5 at KOLD 20D low
    s5_mask = (df['kold_z'] <= -1.5) & (df['kold_price'] <= 1.05 * df['kold_low_20d'])
    strategies['KOLD_Capitulation_Long_BOIL'] = (s5_mask, 'boil_price', False)

    # Strategy 6: KOLD Extreme Inflow (Bear Herd Chasing Dip) -> Long BOIL
    # Retail frantically buys KOLD (Z_kold >= +1.5) near 20D low of KOLD
    s6_mask = (df['kold_z'] >= 1.5) & (df['kold_price'] <= 1.05 * df['kold_low_20d'])
    strategies['KOLD_DipBuy_Fade_Long_BOIL'] = (s6_mask, 'boil_price', False)

    # Strategy 7: Flow Velocity Acceleration Breakout
    # When flow velocity accelerates vel_z_3d >= +1.5 with positive trend
    s7_mask = (df['vel_z_3d'] >= 1.5) & (df['boil_price'] > df['boil_high_20d'].shift(1))
    strategies['Flow_Velocity_Breakout_Long_BOIL'] = (s7_mask, 'boil_price', False)

    # Strategy 8: Outflow Exhaustion Bounce (Z <= -1.0 after 10D drop > 15%)
    s8_mask = (df['flow_zscore'] <= -1.0) & (df['boil_ret_10d'] < -0.15)
    strategies['Outflow_Exhaustion_Bounce_10D_drop'] = (s8_mask, 'boil_price', False)
    strategies['Outflow_Exhaustion_NG_Bounce_10D_drop'] = (s8_mask, 'ng_close', False)

    # Strategy 9: Dual Pair Asymmetry Confirmation:
    # BOIL has inflow (Z >= 1.0) while KOLD has outflow (Z <= -0.5)
    s9_mask = (df['flow_zscore'] >= 1.0) & (df['kold_z'] <= -0.5) & (df['boil_price'] > df['boil_high_20d'].shift(1))
    strategies['Dual_Pair_Asymmetry_Breakout'] = (s9_mask, 'boil_price', False)

    # Strategy 10: Weekly Consolidation Breakout with Flow Confirmation
    # Price breaks above 20D high, 20D return was tight (|ret_20d| < 10%), flow Z >= +0.5
    consolidation_break = (df['boil_price'] > df['boil_high_20d'].shift(1)) & (df['boil_ret_20d'].shift(1).abs() < 0.12) & (df['flow_zscore'] >= 0.5)
    strategies['Consolidation_Breakout_with_Flow'] = (consolidation_break, 'boil_price', False)

    print(f"{'Strategy Name':<42} {'Horizon':<8} {'N':<5} {'Mean%':<8} {'WinRate%':<10} {'PF':<6} {'Sharpe':<7} {'AvgDD%':<8} {'AvgRU%':<8}")
    print('-'*110)

    results_table = []
    for s_name, (mask, col, is_short) in strategies.items():
        n_sigs = int(mask.sum())
        for h in [5, 10, 21]:
            rets = []
            dds = []
            rus = []
            for t in df[mask].index:
                if t + h >= len(df):
                    continue
                p0 = df.loc[t, col]
                p1 = df.loc[t+h, col]
                if is_short:
                    r = (p0 - p1) / p0
                else:
                    r = (p1 - p0) / p0
                rets.append(r)
                
                path = df.loc[t+1:t+h, col].values
                if is_short:
                    dds.append(np.min((p0 - path) / p0))
                    rus.append(np.max((p0 - path) / p0))
                else:
                    dds.append(np.min((path - p0) / p0))
                    rus.append(np.max((path - p0) / p0))

            if len(rets) == 0:
                continue
            rets = np.array(rets)
            win = np.mean(rets > 0) * 100
            mean_r = np.mean(rets) * 100
            pos = np.sum(rets[rets > 0])
            neg = abs(np.sum(rets[rets < 0]))
            pf = pos / neg if neg > 0 else 99.0
            std_r = np.std(rets, ddof=1) if len(rets) > 1 else 1.0
            sharpe = (mean_r / (std_r * 100)) * np.sqrt(252 / h) if std_r > 0 else 0.0
            avg_dd = np.mean(dds) * 100
            avg_ru = np.mean(rus) * 100

            results_table.append({
                'strategy': s_name, 'horizon': f'{h}D', 'N': len(rets),
                'mean': mean_r, 'win_rate': win, 'pf': pf, 'sharpe': sharpe,
                'avg_dd': avg_dd, 'avg_ru': avg_ru
            })
            print(f"{s_name:<42} {h:2d}D      {len(rets):<5} {mean_r:+6.2f}% {win:6.2f}%    {pf:5.2f} {sharpe:6.2f}  {avg_dd:+6.2f}%  {avg_ru:+6.2f}%")

    with open('tools/edge_search_results.json', 'w') as f:
        json.dump(results_table, f, indent=2)

if __name__ == '__main__':
    run_edge_search()
