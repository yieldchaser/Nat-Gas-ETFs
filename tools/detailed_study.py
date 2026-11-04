import json
import pandas as pd
import numpy as np
from scipy import stats

def run():
    with open('docs/data/flows/BOIL_flows.json') as f:
        boil = json.load(f)['data']
    with open('docs/data/ng_history.json') as f:
        ng = json.load(f)

    df_boil = pd.DataFrame(boil)
    df_boil['date'] = pd.to_datetime(df_boil['date'])
    df_boil['boil_price'] = (1.0 + df_boil['perf_pct']).cumprod() * 100.0

    df_ng = pd.DataFrame(ng)[['date', 'close']].rename(columns={'close': 'ng_close'})
    df_ng['date'] = pd.to_datetime(df_ng['date'])

    df = pd.merge(df_boil, df_ng, on='date', how='left')
    df['ng_close'] = df['ng_close'].ffill()

    df['boil_high_20d'] = df['boil_price'].rolling(20).max()
    df['boil_high_60d'] = df['boil_price'].rolling(60).max()
    df['boil_low_20d'] = df['boil_price'].rolling(20).min()
    df['boil_low_60d'] = df['boil_price'].rolling(60).min()
    df['boil_past_ret_5d'] = df['boil_price'].pct_change(5)
    df['boil_past_ret_20d'] = df['boil_price'].pct_change(20)

    # Detailed Buy Top Signals
    print('=============================================================================')
    print('CASE STUDY 1: BUY TOP TRAP (Z >= +1.5 & Near 20D High)')
    print('=============================================================================')
    cond_2a = (df['flow_zscore'] >= 1.5) & (df['boil_price'] >= 0.95 * df['boil_high_20d'])
    top_indices = df[cond_2a].index
    
    print(f"Total signals found: {len(top_indices)}")
    for t in top_indices:
        r = df.loc[t]
        d_str = r['date'].strftime('%Y-%m-%d')
        ret5 = (df.loc[t+5, 'boil_price'] - r['boil_price']) / r['boil_price'] if t+5 < len(df) else np.nan
        ret10 = (df.loc[t+10, 'boil_price'] - r['boil_price']) / r['boil_price'] if t+10 < len(df) else np.nan
        ret21 = (df.loc[t+21, 'boil_price'] - r['boil_price']) / r['boil_price'] if t+21 < len(df) else np.nan
        
        sub_prices = df.loc[t+1:t+21, 'boil_price'].values if t+21 < len(df) else []
        max_dd = (np.min(sub_prices) - r['boil_price']) / r['boil_price'] if len(sub_prices) > 0 else np.nan
        max_ru = (np.max(sub_prices) - r['boil_price']) / r['boil_price'] if len(sub_prices) > 0 else np.nan

        ng_ret21 = (df.loc[t+21, 'ng_close'] - r['ng_close']) / r['ng_close'] if t+21 < len(df) else np.nan
        
        print(f"Date: {d_str} | Z: {r['flow_zscore']:+5.2f} | Flow: ${r['usd_flow']/1e6:6.1f}M | Past5D: {r['boil_past_ret_5d']*100:+5.1f}% | BOIL 5D: {ret5*100:+5.1f}% | 10D: {ret10*100:+5.1f}% | 21D: {ret21*100:+5.1f}% | MDD 21D: {max_dd*100:+5.1f}% | MaxUp: {max_ru*100:+5.1f}% | NG 21D: {ng_ret21*100:+5.1f}%")

    print('\n=============================================================================')
    print('CASE STUDY 2: CAPITULATION BOTTOM (Z <= -1.5 & Near 20D Low)')
    print('=============================================================================')
    cond_3a = (df['flow_zscore'] <= -1.5) & (df['boil_price'] <= 1.05 * df['boil_low_20d'])
    bot_indices = df[cond_3a].index
    print(f"Total signals found: {len(bot_indices)}")
    for t in bot_indices:
        r = df.loc[t]
        d_str = r['date'].strftime('%Y-%m-%d')
        ret5 = (df.loc[t+5, 'boil_price'] - r['boil_price']) / r['boil_price'] if t+5 < len(df) else np.nan
        ret10 = (df.loc[t+10, 'boil_price'] - r['boil_price']) / r['boil_price'] if t+10 < len(df) else np.nan
        ret21 = (df.loc[t+21, 'boil_price'] - r['boil_price']) / r['boil_price'] if t+21 < len(df) else np.nan
        
        sub_prices = df.loc[t+1:t+21, 'boil_price'].values if t+21 < len(df) else []
        max_dd = (np.min(sub_prices) - r['boil_price']) / r['boil_price'] if len(sub_prices) > 0 else np.nan
        max_ru = (np.max(sub_prices) - r['boil_price']) / r['boil_price'] if len(sub_prices) > 0 else np.nan

        ng_ret21 = (df.loc[t+21, 'ng_close'] - r['ng_close']) / r['ng_close'] if t+21 < len(df) else np.nan

        print(f"Date: {d_str} | Z: {r['flow_zscore']:+5.2f} | Flow: ${r['usd_flow']/1e6:6.1f}M | Past5D: {r['boil_past_ret_5d']*100:+5.1f}% | BOIL 5D: {ret5*100:+5.1f}% | 10D: {ret10*100:+5.1f}% | 21D: {ret21*100:+5.1f}% | MDD 21D: {max_dd*100:+5.1f}% | Bounce: {max_ru*100:+5.1f}% | NG 21D: {ng_ret21*100:+5.1f}%")

if __name__ == '__main__':
    run()
