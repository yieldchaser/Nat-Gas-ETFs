import json
import math
import numpy as np
import pandas as pd

# Load dataset
with open('docs/data/dashboard_data.json', 'r') as f:
    raw_data = json.load(f)

etfs = raw_data['etfs']

INSTRUMENTS = {
    'BOIL': {'side': 'long', 'leverage': 2.0, 'pair': 'KOLD', 'region': 'US'},
    'KOLD': {'side': 'short', 'leverage': -2.0, 'pair': 'BOIL', 'region': 'US'},
    'HNU.TO': {'side': 'long', 'leverage': 2.0, 'pair': 'HND.TO', 'region': 'CA'},
    'HND.TO': {'side': 'short', 'leverage': -2.0, 'pair': 'HNU.TO', 'region': 'CA'},
    '3NGL.L': {'side': 'long', 'leverage': 3.0, 'pair': '3NGS.L', 'region': 'UK'},
    '3NGS.L': {'side': 'short', 'leverage': -3.0, 'pair': '3NGL.L', 'region': 'UK'}
}

PAIRS = [
    ('US Pair (2x)', 'BOIL', 'KOLD'),
    ('CA Pair (2x)', 'HNU.TO', 'HND.TO'),
    ('UK Pair (3x)', '3NGL.L', '3NGS.L')
]

def calc_indicators(history):
    n = len(history)
    dates = [b['date'] for b in history]
    opens = np.array([b['open'] if b['open'] is not None else b['close'] for b in history], dtype=np.float64)
    highs = np.array([b['high'] if b['high'] is not None else b['close'] for b in history], dtype=np.float64)
    lows = np.array([b['low'] if b['low'] is not None else b['close'] for b in history], dtype=np.float64)
    closes = np.array([b['close'] for b in history], dtype=np.float64)
    volumes = np.array([b['volume'] if b['volume'] is not None else 0.0 for b in history], dtype=np.float64)

    price_sma21 = pd.Series(closes).rolling(21).mean().to_numpy()

    vol_series = pd.Series(volumes)
    vol_sma21 = vol_series.rolling(21).mean().to_numpy()
    rvol21 = np.where(vol_sma21 > 0, volumes / vol_sma21, 1.0)

    vol_sma5 = vol_series.rolling(5).mean().to_numpy()
    vol_osc = np.where(vol_sma21 > 0, 100.0 * (vol_sma5 - vol_sma21) / vol_sma21, 0.0)

    signs = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        if closes[i] > closes[i-1]: signs[i] = 1.0
        elif closes[i] < closes[i-1]: signs[i] = -1.0
        else: signs[i] = 0.0
    signed_vol = signs * volumes
    net_vol21 = pd.Series(signed_vol).rolling(21).sum().to_numpy()

    hl_range = highs - lows
    clv = np.zeros(n, dtype=np.float64)
    valid_hl = hl_range > 1e-8
    clv[valid_hl] = ((closes[valid_hl] - lows[valid_hl]) - (highs[valid_hl] - closes[valid_hl])) / hl_range[valid_hl]
    mfv = clv * volumes
    sum_mfv21 = pd.Series(mfv).rolling(21).sum().to_numpy()
    sum_vol21 = pd.Series(volumes).rolling(21).sum().to_numpy()
    cmf21 = np.zeros(n, dtype=np.float64)
    valid_v = sum_vol21 > 0
    cmf21[valid_v] = np.clip(sum_mfv21[valid_v] / sum_vol21[valid_v], -1.0, 1.0)

    obv = np.zeros(n, dtype=np.float64)
    acc = 0.0
    for i in range(1, n):
        acc += signed_vol[i]
        obv[i] = acc
    obv_sma21 = pd.Series(obv).rolling(21).mean().to_numpy()

    tr = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
    atr14 = pd.Series(tr).ewm(alpha=1.0/14.0, adjust=False).mean().to_numpy()

    fwd5 = np.full(n, np.nan)
    fwd10 = np.full(n, np.nan)
    fwd21 = np.full(n, np.nan)
    for i in range(n):
        if i + 5 < n: fwd5[i] = (closes[i+5] - closes[i]) / closes[i]
        if i + 10 < n: fwd10[i] = (closes[i+10] - closes[i]) / closes[i]
        if i + 21 < n: fwd21[i] = (closes[i+21] - closes[i]) / closes[i]

    # Calculate Maximum Adverse Excursion (MAE) over 5 and 10 days
    mae5 = np.full(n, np.nan)
    mae10 = np.full(n, np.nan)
    for i in range(n):
        if i + 5 < n:
            min_l = np.min(lows[i+1:i+6])
            mae5[i] = (min_l - closes[i]) / closes[i]
        if i + 10 < n:
            min_l = np.min(lows[i+1:i+11])
            mae10[i] = (min_l - closes[i]) / closes[i]

    date_map = {dates[i]: i for i in range(n)}

    return {
        'dates': dates, 'date_map': date_map,
        'opens': opens, 'highs': highs, 'lows': lows, 'closes': closes, 'volumes': volumes,
        'price_sma21': price_sma21, 'vol_sma21': vol_sma21, 'rvol21': rvol21,
        'vol_osc': vol_osc, 'signed_vol': signed_vol, 'net_vol21': net_vol21,
        'cmf21': cmf21, 'obv': obv, 'obv_sma21': obv_sma21, 'atr14': atr14,
        'fwd5': fwd5, 'fwd10': fwd10, 'fwd21': fwd21,
        'mae5': mae5, 'mae10': mae10
    }

processed = {ticker: calc_indicators(etfs[ticker]['history']) for ticker in INSTRUMENTS}

def get_signals(d):
    n = len(d['dates'])
    obv_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['obv'][i] > d['obv_sma21'][i] and d['obv'][i-1] <= d['obv_sma21'][i-1]: obv_cross[i] = True
    cmf_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['cmf21'][i] > 0.10 and d['cmf21'][i-1] <= 0.10: cmf_cross[i] = True
    netv_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['net_vol21'][i] > 0 and d['net_vol21'][i-1] <= 0: netv_cross[i] = True
    vosc_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['vol_osc'][i] > 0 and d['vol_osc'][i-1] <= 0: vosc_cross[i] = True
    rvol_spike = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['rvol21'][i] > 1.2 and d['rvol21'][i-1] <= 1.2: rvol_spike[i] = True
    return {
        'OBV Crossover': obv_cross,
        'CMF > 0.10': cmf_cross,
        'Net Vol > 0': netv_cross,
        'Vol Osc > 0': vosc_cross,
        'RVOL > 1.2': rvol_spike
    }

signals_dict = {ticker: get_signals(processed[ticker]) for ticker in INSTRUMENTS}

# Run deep test on Inverse Legs confirmed by Long Leg Breakdown
print("\n" + "="*80)
print("INVERSE LEG CONFIRMATION: SHORT LEG SIGNALS CONFIRMED BY LONG LEG BREAKDOWN")
print("="*80)

for pair_name, long_t, short_t in PAIRS:
    dl = processed[long_t]
    ds = processed[short_t]
    ns = len(ds['dates'])
    l_idx_map = dl['date_map']

    print(f"\n>>> PAIR: {pair_name} ({short_t} Short confirmed by {long_t} Long breakdown) <<<")

    for ind in ['OBV Crossover', 'Net Vol > 0', 'CMF > 0.10']:
        raw_mask = signals_dict[short_t][ind]

        confirmed_composite = np.zeros(ns, dtype=bool)

        for i in range(ns):
            if not raw_mask[i]: continue
            dt = ds['dates'][i]
            if dt not in l_idx_map: continue
            li = l_idx_map[dt]

            # Long leg bearish breakdown conditions:
            cond_cmf = dl['cmf21'][li] < 0.0
            cond_obv = dl['obv'][li] < dl['obv_sma21'][li]
            cond_netv = dl['net_vol21'][li] < 0.0
            cond_sma = dl['closes'][li] < dl['price_sma21'][li]
            score = sum([cond_cmf, cond_obv, cond_netv, cond_sma])
            confirmed_composite[i] = (score >= 2)

        def eval_stats(f_mask):
            f5 = ds['fwd5'][f_mask]; f5 = f5[~np.isnan(f5)]
            f10 = ds['fwd10'][f_mask]; f10 = f10[~np.isnan(f10)]
            f21 = ds['fwd21'][f_mask]; f21 = f21[~np.isnan(f21)]
            mae5 = ds['mae5'][f_mask]; mae5 = mae5[~np.isnan(mae5)]
            if len(f5) == 0: return None
            return {
                'n': len(f5),
                'm5': np.mean(f5)*100, 'w5': np.mean(f5>0)*100, 'pf5': np.sum(f5[f5>0])/np.abs(np.sum(f5[f5<0])),
                'm10': np.mean(f10)*100, 'w10': np.mean(f10>0)*100,
                'm21': np.mean(f21)*100, 'w21': np.mean(f21>0)*100, 'pf21': np.sum(f21[f21>0])/np.abs(np.sum(f21[f21<0])),
                'avg_mae5': np.mean(mae5)*100
            }

        s_raw = eval_stats(raw_mask)
        s_conf = eval_stats(confirmed_composite)

        if s_raw and s_conf:
            suppr = (1.0 - s_conf['n'] / s_raw['n']) * 100.0
            print(f"Signal: {short_t} {ind}")
            print(f"  Raw Signal       (N={s_raw['n']})  -> 5d: {s_raw['m5']:>+5.2f}% (W: {s_raw['w5']:>4.1f}%, PF: {s_raw['pf5']:>4.2f}) | 21d: {s_raw['m21']:>+5.2f}% (W: {s_raw['w21']:>4.1f}%, PF: {s_raw['pf21']:>4.2f}) | MAE5: {s_raw['avg_mae5']:>5.2f}%")
            print(f"  Confirmed Sister (N={s_conf['n']}, Suppr: {suppr:>4.1f}%) -> 5d: {s_conf['m5']:>+5.2f}% (W: {s_conf['w5']:>4.1f}%, PF: {s_conf['pf5']:>4.2f}) | 21d: {s_conf['m21']:>+5.2f}% (W: {s_conf['w21']:>4.1f}%, PF: {s_conf['pf21']:>4.2f}) | MAE5: {s_conf['avg_mae5']:>5.2f}%")
