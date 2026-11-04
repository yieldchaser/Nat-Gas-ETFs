import json
import pandas as pd
import numpy as np

def test_falling_knife():
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

    df['boil_low_20d'] = df['boil_price'].rolling(20).min()
    df['boil_high_20d'] = df['boil_price'].rolling(20).max()
    df['boil_past_ret_5d'] = df['boil_price'].pct_change(5)
    df['boil_past_ret_20d'] = df['boil_price'].pct_change(20)

    # Condition: The "Falling Knife Trap" (Retail Averaging Down)
    # Price is near 20D low (within 5%) AND retail pours massive money in (Z >= +1.5)
    falling_knife = (df['flow_zscore'] >= 1.5) & (df['boil_price'] <= 1.05 * df['boil_low_20d'])
    n_fk = falling_knife.sum()
    print(f"=== THE FALLING KNIFE TRAP (Retail Averaging Down: Z >= +1.5 & Near 20D Low) ===")
    print(f"Total occurrences: N = {n_fk}")

    for h in [1, 5, 10, 21]:
        rets_boil = []
        rets_ng = []
        mdds = []
        for t in df[falling_knife].index:
            if t + h >= len(df):
                continue
            r_boil = (df.loc[t+h, 'boil_price'] - df.loc[t, 'boil_price']) / df.loc[t, 'boil_price']
            r_ng = (df.loc[t+h, 'ng_close'] - df.loc[t, 'ng_close']) / df.loc[t, 'ng_close']
            rets_boil.append(r_boil)
            rets_ng.append(r_ng)
            
            sub_p = df.loc[t+1:t+h, 'boil_price'].values
            mdds.append((np.min(sub_p) - df.loc[t, 'boil_price']) / df.loc[t, 'boil_price'])

        rets_boil = np.array(rets_boil)
        rets_ng = np.array(rets_ng)
        mdds = np.array(mdds)

        win_rate = np.mean(rets_boil > 0) * 100
        mean_ret = np.mean(rets_boil) * 100
        med_ret = np.median(rets_boil) * 100
        pos_s = np.sum(rets_boil[rets_boil > 0])
        neg_s = abs(np.sum(rets_boil[rets_boil < 0]))
        pf = pos_s / neg_s if neg_s > 0 else 0
        mean_mdd = np.mean(mdds) * 100
        worst_mdd = np.min(mdds) * 100

        ng_win = np.mean(rets_ng > 0) * 100
        ng_mean = np.mean(rets_ng) * 100

        print(f"{h:2d}D: BOIL Mean={mean_ret:+6.2f}%, Median={med_ret:+6.2f}%, WinRate={win_rate:5.1f}%, PF={pf:4.2f}, AvgMDD={mean_mdd:+6.1f}%, WorstMDD={worst_mdd:+6.1f}% | NG Mean={ng_mean:+5.2f}%, NG WinRate={ng_win:5.1f}%")

    # Also test the opposite: What if you FADE / SHORT BOIL when retail averages down?
    print("\nFADE STRATEGY (Short BOIL when retail buys falling knives):")
    for h in [5, 10, 21]:
        rets_short = []
        for t in df[falling_knife].index:
            if t + h >= len(df):
                continue
            r_short = (df.loc[t, 'boil_price'] - df.loc[t+h, 'boil_price']) / df.loc[t, 'boil_price']
            rets_short.append(r_short)
        rets_short = np.array(rets_short)
        win = np.mean(rets_short > 0) * 100
        mean_r = np.mean(rets_short) * 100
        pos = np.sum(rets_short[rets_short > 0])
        neg = abs(np.sum(rets_short[rets_short < 0]))
        pf = pos / neg if neg > 0 else 0
        print(f"Short BOIL {h:2d}D: Mean={mean_r:+6.2f}%, WinRate={win:5.1f}%, PF={pf:4.2f}")

if __name__ == '__main__':
    test_falling_knife()
