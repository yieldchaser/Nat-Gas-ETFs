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

    # Price SMA 21
    price_sma21 = pd.Series(closes).rolling(21).mean().to_numpy()

    # 1. VOL: 21-day SMA and RVOL
    vol_series = pd.Series(volumes)
    vol_sma21 = vol_series.rolling(21).mean().to_numpy()
    rvol21 = np.where(vol_sma21 > 0, volumes / vol_sma21, 1.0)

    # 2. VOL OSC: 100 * (SMA5 - SMA21) / SMA21
    vol_sma5 = vol_series.rolling(5).mean().to_numpy()
    vol_osc = np.where(vol_sma21 > 0, 100.0 * (vol_sma5 - vol_sma21) / vol_sma21, 0.0)

    # 3. NET VOL: Daily signed vol and 21-day rolling sum
    signs = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        if closes[i] > closes[i-1]:
            signs[i] = 1.0
        elif closes[i] < closes[i-1]:
            signs[i] = -1.0
        else:
            signs[i] = 0.0
    signed_vol = signs * volumes
    net_vol21 = pd.Series(signed_vol).rolling(21).sum().to_numpy()

    # 4. CMF-21: CLV = ((C-L)-(H-C))/(H-L), MFV = CLV * V, CMF = Sum21(MFV)/Sum21(V)
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

    # 5. OBV and SMA21(OBV)
    obv = np.zeros(n, dtype=np.float64)
    acc = 0.0
    for i in range(1, n):
        acc += signed_vol[i]
        obv[i] = acc
    obv_sma21 = pd.Series(obv).rolling(21).mean().to_numpy()

    # ATR 14
    tr = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
    atr14 = pd.Series(tr).ewm(alpha=1.0/14.0, adjust=False).mean().to_numpy()

    # Forward returns
    fwd5 = np.full(n, np.nan)
    fwd10 = np.full(n, np.nan)
    fwd21 = np.full(n, np.nan)
    for i in range(n):
        if i + 5 < n: fwd5[i] = (closes[i+5] - closes[i]) / closes[i]
        if i + 10 < n: fwd10[i] = (closes[i+10] - closes[i]) / closes[i]
        if i + 21 < n: fwd21[i] = (closes[i+21] - closes[i]) / closes[i]

    date_map = {dates[i]: i for i in range(n)}

    return {
        'dates': dates,
        'date_map': date_map,
        'opens': opens,
        'highs': highs,
        'lows': lows,
        'closes': closes,
        'volumes': volumes,
        'price_sma21': price_sma21,
        'vol_sma21': vol_sma21,
        'rvol21': rvol21,
        'vol_osc': vol_osc,
        'signed_vol': signed_vol,
        'net_vol21': net_vol21,
        'cmf21': cmf21,
        'obv': obv,
        'obv_sma21': obv_sma21,
        'atr14': atr14,
        'fwd5': fwd5,
        'fwd10': fwd10,
        'fwd21': fwd21
    }

processed = {ticker: calc_indicators(etfs[ticker]['history']) for ticker in INSTRUMENTS}

# Generate standard signals
def get_signals(d):
    n = len(d['dates'])
    obv_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['obv'][i] > d['obv_sma21'][i] and d['obv'][i-1] <= d['obv_sma21'][i-1]:
            obv_cross[i] = True
    cmf_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['cmf21'][i] > 0.10 and d['cmf21'][i-1] <= 0.10:
            cmf_cross[i] = True
    netv_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['net_vol21'][i] > 0 and d['net_vol21'][i-1] <= 0:
            netv_cross[i] = True
    vosc_cross = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['vol_osc'][i] > 0 and d['vol_osc'][i-1] <= 0:
            vosc_cross[i] = True
    rvol_spike = np.zeros(n, dtype=bool)
    for i in range(22, n):
        if d['rvol21'][i] > 1.2 and d['rvol21'][i-1] <= 1.2:
            rvol_spike[i] = True

    return {
        'OBV Crossover': obv_cross,
        'CMF > 0.10': cmf_cross,
        'Net Vol > 0': netv_cross,
        'Vol Osc > 0': vosc_cross,
        'RVOL > 1.2': rvol_spike
    }

signals_dict = {ticker: get_signals(processed[ticker]) for ticker in INSTRUMENTS}

# ==============================================================================
# PART 2: ASYMMETRIC STATE MACHINE BACKTEST ENGINE
# ==============================================================================
# In a realistic execution environment:
# Signal occurs at close of bar t -> entry executed at open of bar t+1 (or close t)
# We test backtesting with:
# A) Symmetric Hold (Baseline): Hold for 21 sessions, or hold until indicator exit
# B) Fast Asymmetric Exit (for Long ETPs):
#    - Time Cap: max_days in [3, 5, 7, 10, 15]
#    - Trailing Stop: highest high - k * ATR_14 (e.g. k=1.5 or 2.0)
#    - Climax Exhaustion Take-Profit: RVOL > 2.5 and return >= 10%, or return >= 15%
# C) Wide Asymmetric Trend (for Short ETPs):
#    - Time Cap: 30 sessions
#    - Trailing Stop: highest high - 3.0 * ATR_14

def run_simulation(d, entry_mask, exit_rules):
    # exit_rules: {'type': 'fixed', 'days': 21} OR
    # {'type': 'asymmetric', 'max_days': 5, 'trail_k': 1.5, 'climax_rvol': 2.5, 'climax_ret': 0.10, 'profit_target': 0.15}
    n = len(d['dates'])
    c = d['closes']
    o = d['opens']
    h = d['highs']
    l = d['lows']
    atr = d['atr14']
    rvol = d['rvol21']

    in_pos = False
    entry_idx = 0
    entry_price = 0.0
    highest_price = 0.0
    capital = 10000.0
    peak_capital = 10000.0
    max_dd = 0.0
    trades = []
    daily_equity = [capital]

    # Warmup 25 bars
    for i in range(25, n):
        # Check exit if in position
        if in_pos:
            highest_price = max(highest_price, h[i])
            holding_days = i - entry_idx
            should_exit = False
            exit_price = c[i]
            exit_reason = ''

            rule_type = exit_rules.get('type', 'fixed')

            if rule_type == 'fixed':
                if holding_days >= exit_rules.get('days', 21):
                    should_exit = True
                    exit_price = c[i]
                    exit_reason = 'TIME_CAP'
            elif rule_type == 'indicator_flip':
                # symmetric exit when signal turns negative
                flip_cond = exit_rules.get('flip_cond', lambda idx: False)(i)
                if flip_cond or holding_days >= 30:
                    should_exit = True
                    exit_price = c[i]
                    exit_reason = 'IND_FLIP'
            elif rule_type == 'asymmetric':
                max_days = exit_rules.get('max_days', 5)
                trail_k = exit_rules.get('trail_k', 1.5)
                stop_price = highest_price - trail_k * atr[i]
                pt = exit_rules.get('profit_target', 0.15)
                climax_rvol = exit_rules.get('climax_rvol', 2.5)
                climax_ret = exit_rules.get('climax_ret', 0.10)

                cur_unrealized = (c[i] - entry_price) / entry_price

                # 1. Trailing volatility stop hit
                if l[i] <= stop_price:
                    should_exit = True
                    exit_price = min(highest_price, max(o[i], stop_price))
                    exit_reason = 'TRAIL_STOP'
                # 2. Climax exhaustion take-profit
                elif (cur_unrealized >= climax_ret and rvol[i] >= climax_rvol) or (cur_unrealized >= pt):
                    should_exit = True
                    exit_price = c[i]
                    exit_reason = 'CLIMAX_TP'
                # 3. Fast Time Cap
                elif holding_days >= max_days:
                    should_exit = True
                    exit_price = c[i]
                    exit_reason = 'TIME_CAP'

            if should_exit:
                ret = (exit_price - entry_price) / entry_price
                capital *= (1.0 + ret)
                trades.append({
                    'entry_date': d['dates'][entry_idx],
                    'exit_date': d['dates'][i],
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'holding_days': holding_days,
                    'ret': ret,
                    'reason': exit_reason
                })
                in_pos = False
                if capital > peak_capital:
                    peak_capital = capital
                dd = (peak_capital - capital) / peak_capital
                if dd > max_dd:
                    max_dd = dd

        # Check entry if not in position
        if not in_pos and entry_mask[i]:
            # Enter at close of day i
            in_pos = True
            entry_idx = i
            entry_price = c[i]
            highest_price = h[i]

        # Track daily equity
        if in_pos:
            unrealized = (c[i] - entry_price) / entry_price
            cur_equity = capital * (1.0 + unrealized)
        else:
            cur_equity = capital
        if cur_equity > peak_capital:
            peak_capital = cur_equity
        cur_dd = (peak_capital - cur_equity) / peak_capital
        if cur_dd > max_dd:
            max_dd = cur_dd
        daily_equity.append(cur_equity)

    # Compile performance stats
    if len(trades) == 0:
        return {'trades': 0, 'win_rate': 0.0, 'pf': 0.0, 'cum_ret': 0.0, 'max_dd': 0.0, 'cagr': 0.0, 'sharpe': 0.0, 'avg_days': 0.0}

    rets = np.array([t['ret'] for t in trades])
    win_rate = np.mean(rets > 0) * 100.0
    gains = rets[rets > 0]
    losses = np.abs(rets[rets < 0])
    pf = (np.sum(gains) / np.sum(losses)) if np.sum(losses) > 0 else 999.0
    cum_ret = (capital - 10000.0) / 10000.0 * 100.0
    num_years = len(d['dates']) / 252.0
    cagr = ((capital / 10000.0) ** (1.0 / num_years) - 1.0) * 100.0 if capital > 0 else -100.0

    eq_series = pd.Series(daily_equity)
    daily_rets = eq_series.pct_change().dropna()
    sharpe = (daily_rets.mean() / (daily_rets.std() + 1e-8)) * np.sqrt(252) if daily_rets.std() > 0 else 0.0
    avg_days = np.mean([t['holding_days'] for t in trades])

    return {
        'trades': len(trades),
        'win_rate': win_rate,
        'pf': pf,
        'cum_ret': cum_ret,
        'cagr': cagr,
        'max_dd': max_dd * 100.0,
        'sharpe': sharpe,
        'avg_days': avg_days,
        'reasons': pd.Series([t['reason'] for t in trades]).value_counts().to_dict()
    }

print("\n" + "="*80)
print("PART 2: ASYMMETRIC STATE MACHINE BACKTEST COMPARISON ON LONG ETFS")
print("="*80)

primary_indicators = ['OBV Crossover', 'CMF > 0.10', 'Net Vol > 0']
long_tickers = ['BOIL', 'HNU.TO', '3NGL.L']

for ind in primary_indicators:
    print(f"\n>>> Indicator Signal: {ind} <<<")
    print(f"{'Ticker':<8} | {'Strategy Variant':<28} | {'Trades':<6} {'Win%':<6} {'PF':<6} | {'Cum Ret%':<10} {'CAGR%':<8} {'MaxDD%':<8} {'Sharpe':<7} {'AvgDays':<7}")
    print("-" * 102)

    for ticker in long_tickers:
        d = processed[ticker]
        mask = signals_dict[ticker][ind]

        # 1. Baseline: Static 21-day Hold (Symmetric Lag)
        res_base21 = run_simulation(d, mask, {'type': 'fixed', 'days': 21})

        # 2. Baseline: Static 10-day Hold
        res_base10 = run_simulation(d, mask, {'type': 'fixed', 'days': 10})

        # 3. Fast Time Cap: 5-Day Fixed
        res_fast5 = run_simulation(d, mask, {'type': 'fixed', 'days': 5})

        # 4. Asymmetric State Machine: Fast Time Cap (5d) + Trailing 1.5x ATR Stop + Climax TP (15% or RVOL>2.5 & +10%)
        res_asym5 = run_simulation(d, mask, {
            'type': 'asymmetric',
            'max_days': 5,
            'trail_k': 1.5,
            'profit_target': 0.15,
            'climax_rvol': 2.5,
            'climax_ret': 0.10
        })

        # 5. Asymmetric State Machine: Ultra-Fast (3d) + Trailing 1.2x ATR Stop + Climax TP
        res_asym3 = run_simulation(d, mask, {
            'type': 'asymmetric',
            'max_days': 3,
            'trail_k': 1.2,
            'profit_target': 0.12,
            'climax_rvol': 2.2,
            'climax_ret': 0.08
        })

        print(f"{ticker:<8} | {'Baseline 21d Symmetric':<28} | {res_base21['trades']:<6} {res_base21['win_rate']:>5.1f}% {res_base21['pf']:>5.2f} | {res_base21['cum_ret']:>9.1f}% {res_base21['cagr']:>7.2f}% {res_base21['max_dd']:>7.1f}% {res_base21['sharpe']:>6.2f} {res_base21['avg_days']:>6.1f}d")
        print(f"{ticker:<8} | {'Baseline 10d Hold':<28} | {res_base10['trades']:<6} {res_base10['win_rate']:>5.1f}% {res_base10['pf']:>5.2f} | {res_base10['cum_ret']:>9.1f}% {res_base10['cagr']:>7.2f}% {res_base10['max_dd']:>7.1f}% {res_base10['sharpe']:>6.2f} {res_base10['avg_days']:>6.1f}d")
        print(f"{ticker:<8} | {'Fast 5d Time Cap':<28} | {res_fast5['trades']:<6} {res_fast5['win_rate']:>5.1f}% {res_fast5['pf']:>5.2f} | {res_fast5['cum_ret']:>9.1f}% {res_fast5['cagr']:>7.2f}% {res_fast5['max_dd']:>7.1f}% {res_fast5['sharpe']:>6.2f} {res_fast5['avg_days']:>6.1f}d")
        print(f"{ticker:<8} | {'Asym 5d + ATR Trail + Climax':<28} | {res_asym5['trades']:<6} {res_asym5['win_rate']:>5.1f}% {res_asym5['pf']:>5.2f} | {res_asym5['cum_ret']:>9.1f}% {res_asym5['cagr']:>7.2f}% {res_asym5['max_dd']:>7.1f}% {res_asym5['sharpe']:>6.2f} {res_asym5['avg_days']:>6.1f}d")
        print(f"{ticker:<8} | {'Asym 3d + ATR Trail + Climax':<28} | {res_asym3['trades']:<6} {res_asym3['win_rate']:>5.1f}% {res_asym3['pf']:>5.2f} | {res_asym3['cum_ret']:>9.1f}% {res_asym3['cagr']:>7.2f}% {res_asym3['max_dd']:>7.1f}% {res_asym3['sharpe']:>6.2f} {res_asym3['avg_days']:>6.1f}d")
        print("-" * 102)

# Now test Inverse ETFs with Wide Trend-Following
print("\n" + "="*80)
print("INVERSE ETFS: SYMMETRIC VS WIDE TREND FOLLOWING STATE MACHINE")
print("="*80)
short_tickers = ['KOLD', 'HND.TO', '3NGS.L']

for ind in ['Net Vol > 0', 'OBV Crossover']:
    print(f"\n>>> Short Leg Signal: {ind} <<<")
    print(f"{'Ticker':<8} | {'Strategy Variant':<28} | {'Trades':<6} {'Win%':<6} {'PF':<6} | {'Cum Ret%':<10} {'CAGR%':<8} {'MaxDD%':<8} {'Sharpe':<7} {'AvgDays':<7}")
    print("-" * 102)
    for ticker in short_tickers:
        d = processed[ticker]
        mask = signals_dict[ticker][ind]

        # Fast 5d exit (inappropriate for short)
        res_fast5 = run_simulation(d, mask, {'type': 'fixed', 'days': 5})
        # Standard 21d hold
        res_base21 = run_simulation(d, mask, {'type': 'fixed', 'days': 21})
        # Wide Trend-Following: 35 days + 3.0x ATR trailing stop
        res_wide = run_simulation(d, mask, {
            'type': 'asymmetric',
            'max_days': 35,
            'trail_k': 3.0,
            'profit_target': 0.40,
            'climax_rvol': 3.5,
            'climax_ret': 0.30
        })

        print(f"{ticker:<8} | {'Inappropriate Fast 5d Exit':<28} | {res_fast5['trades']:<6} {res_fast5['win_rate']:>5.1f}% {res_fast5['pf']:>5.2f} | {res_fast5['cum_ret']:>9.1f}% {res_fast5['cagr']:>7.2f}% {res_fast5['max_dd']:>7.1f}% {res_fast5['sharpe']:>6.2f} {res_fast5['avg_days']:>6.1f}d")
        print(f"{ticker:<8} | {'Standard 21d Symmetric':<28} | {res_base21['trades']:<6} {res_base21['win_rate']:>5.1f}% {res_base21['pf']:>5.2f} | {res_base21['cum_ret']:>9.1f}% {res_base21['cagr']:>7.2f}% {res_base21['max_dd']:>7.1f}% {res_base21['sharpe']:>6.2f} {res_base21['avg_days']:>6.1f}d")
        print(f"{ticker:<8} | {'Wide Trend 35d + 3.0x ATR':<28} | {res_wide['trades']:<6} {res_wide['win_rate']:>5.1f}% {res_wide['pf']:>5.2f} | {res_wide['cum_ret']:>9.1f}% {res_wide['cagr']:>7.2f}% {res_wide['max_dd']:>7.1f}% {res_wide['sharpe']:>6.2f} {res_wide['avg_days']:>6.1f}d")
        print("-" * 102)

# ==============================================================================
# PART 3: CROSS-PAIR COHERENCE MATRIX
# ==============================================================================
print("\n" + "="*80)
print("PART 3: CROSS-PAIR COHERENCE MATRIX & SISTER LEG CONFIRMATION")
print("="*80)

# Evaluate each pair:
# Primary leg signal confirmed by Sister leg exhibiting inverse condition
# For Long primary leg (BOIL, HNU, 3NGL):
# Sister leg (KOLD, HND, 3NGS) bearish filters:
# 1. Sister CMF < 0
# 2. Sister OBV < SMA21(OBV)
# 3. Sister Net Vol 21 < 0
# 4. Sister Close < SMA21(Close)
# Sister Composite Bearish: >= 2 of the 4 conditions

for pair_name, long_t, short_t in PAIRS:
    dl = processed[long_t]
    ds = processed[short_t]
    nl = len(dl['dates'])

    # Build aligned sister date lookup
    s_idx_map = ds['date_map']

    print(f"\n================ PAIR: {pair_name} ({long_t} Long vs {short_t} Short) ================")

    for ind in ['OBV Crossover', 'CMF > 0.10', 'Net Vol > 0']:
        raw_mask = signals_dict[long_t][ind]

        confirmed_cmf = np.zeros(nl, dtype=bool)
        confirmed_obv = np.zeros(nl, dtype=bool)
        confirmed_netv = np.zeros(nl, dtype=bool)
        confirmed_sma = np.zeros(nl, dtype=bool)
        confirmed_composite = np.zeros(nl, dtype=bool)

        for i in range(nl):
            if not raw_mask[i]:
                continue
            dt = dl['dates'][i]
            if dt not in s_idx_map:
                continue
            si = s_idx_map[dt]

            cond_cmf = ds['cmf21'][si] < 0.0
            cond_obv = ds['obv'][si] < ds['obv_sma21'][si]
            cond_netv = ds['net_vol21'][si] < 0.0
            cond_sma = ds['closes'][si] < ds['price_sma21'][si]

            confirmed_cmf[i] = cond_cmf
            confirmed_obv[i] = cond_obv
            confirmed_netv[i] = cond_netv
            confirmed_sma[i] = cond_sma
            score = sum([cond_cmf, cond_obv, cond_netv, cond_sma])
            confirmed_composite[i] = (score >= 2)

        def eval_filter(name, f_mask):
            f5 = dl['fwd5'][f_mask]
            f5 = f5[~np.isnan(f5)]
            f10 = dl['fwd10'][f_mask]
            f10 = f10[~np.isnan(f10)]
            f21 = dl['fwd21'][f_mask]
            f21 = f21[~np.isnan(f21)]

            if len(f5) == 0:
                return f"{name:<26} | N=0"

            w5 = np.mean(f5 > 0) * 100.0
            m5 = np.mean(f5) * 100.0
            w10 = np.mean(f10 > 0) * 100.0
            m10 = np.mean(f10) * 100.0
            w21 = np.mean(f21 > 0) * 100.0
            m21 = np.mean(f21) * 100.0
            g5 = f5[f5 > 0]; l5 = np.abs(f5[f5 < 0])
            pf5 = np.sum(g5)/np.sum(l5) if np.sum(l5) > 0 else 0.0

            return {
                'name': name,
                'count': len(f5),
                'm5': m5, 'w5': w5, 'pf5': pf5,
                'm10': m10, 'w10': w10,
                'm21': m21, 'w21': w21
            }

        raw_res = eval_filter('Raw Unfiltered Signal', raw_mask)
        cmf_res = eval_filter('Sister CMF < 0', confirmed_cmf)
        obv_res = eval_filter('Sister OBV < SMA', confirmed_obv)
        netv_res = eval_filter('Sister NetVol < 0', confirmed_netv)
        comp_res = eval_filter('Sister Composite (>=2/4)', confirmed_composite)

        print(f"\n--- Indicator: {long_t} {ind} ---")
        print(f"{'Confirmation Filter':<26} | {'Count':<6} {'Suppr%':<7} | {'5d Mean':<8} {'5d Win%':<8} {'5d PF':<6} | {'10d Mean':<9} {'10d Win%':<9} | {'21d Mean':<9}")
        print("-" * 105)

        for res in [raw_res, cmf_res, obv_res, netv_res, comp_res]:
            if isinstance(res, str):
                print(res)
                continue
            suppr = (1.0 - res['count'] / raw_res['count']) * 100.0 if raw_res['count'] > 0 else 0.0
            print(f"{res['name']:<26} | {res['count']:<6} {suppr:>5.1f}% | {res['m5']:>6.2f}% {res['w5']:>6.1f}% {res['pf5']:>6.2f} | {res['m10']:>7.2f}% {res['w10']:>7.1f}% | {res['m21']:>7.2f}%")

        # Backtest simulation: Unfiltered vs Sister Confirmed with Asymmetric State Machine
        sim_unfiltered = run_simulation(dl, raw_mask, {
            'type': 'asymmetric', 'max_days': 5, 'trail_k': 1.5, 'profit_target': 0.15, 'climax_rvol': 2.5, 'climax_ret': 0.10
        })
        sim_confirmed = run_simulation(dl, confirmed_composite, {
            'type': 'asymmetric', 'max_days': 5, 'trail_k': 1.5, 'profit_target': 0.15, 'climax_rvol': 2.5, 'climax_ret': 0.10
        })

        print(f"\n  [State Machine Backtest: Asym 5d + ATR 1.5x + Climax]")
        print(f"  Unfiltered -> Trades: {sim_unfiltered['trades']}, Win%: {sim_unfiltered['win_rate']:.1f}%, PF: {sim_unfiltered['pf']:.2f}, CumRet: {sim_unfiltered['cum_ret']:.1f}%, MaxDD: {sim_unfiltered['max_dd']:.1f}%, Sharpe: {sim_unfiltered['sharpe']:.2f}")
        print(f"  Confirmed  -> Trades: {sim_confirmed['trades']}, Win%: {sim_confirmed['win_rate']:.1f}%, PF: {sim_confirmed['pf']:.2f}, CumRet: {sim_confirmed['cum_ret']:.1f}%, MaxDD: {sim_confirmed['max_dd']:.1f}%, Sharpe: {sim_confirmed['sharpe']:.2f}")
