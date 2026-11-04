import json

def print_all():
    with open('tools/microstructure_quant_definitive.json') as f:
        d = json.load(f)

    print('=== 1. BASELINE DISTRIBUTIONS ===')
    for inst in ['NG', 'BOIL']:
        print(f'-- {inst} --')
        for h in ['1D', '5D', '10D', '21D']:
            s = d['baseline'][inst][h]
            print(f"{h}: N={s['N']}, Mean={s['Mean']:+.2f}%, Med={s['Median']:+.2f}%, Std={s['Std']:.2f}%, Skew={s['Skew']:.2f}, Kurt={s['Kurt']:.2f}, WinRate={s['WinRate']:.2f}%, PF={s['ProfitFactor']:.2f}, Sharpe={s['Sharpe']:+.2f}, Sortino={s['Sortino']:+.2f}, MaxLoss={s['MaxLoss']:.2f}%")

    print('\n=== 2. CORRELATIONS ===')
    for t in ['BOIL', 'KOLD', 'HNU', 'HND', '3NGL', '3NGS']:
        c = d['cross_etf_correlations'][t]
        p20 = c['flow_20d_vs_ret_20d']['pearson_r']
        s20 = c['flow_20d_vs_ret_20d']['spearman_rho']
        p5 = c['flow_5d_vs_ret_5d']['pearson_r']
        s5 = c['flow_5d_vs_ret_5d']['spearman_rho']
        print(f"{t:5s} | 20D Flow vs Ret: Pearson={p20:+.4f}, Spearman={s20:+.4f} | 5D Flow vs Ret: Pearson={p5:+.4f}, Spearman={s5:+.4f}")

    print('\n=== 3. BUY TOP TRAP ===')
    for name, val in d['buy_top_trap'].items():
        print(f"Scenario {name} (N={val['N']}):")
        for h in ['5D', '10D', '21D']:
            sb = val['BOIL_long'][h]
            sng = val['NG_long'][h]
            sf = val['BOIL_short_fade'][h]
            print(f"  {h}: BOIL Long Mean={sb['Mean']:+.2f}%, WinRate={sb['WinRate']:.1f}%, PF={sb['ProfitFactor']:.2f}, AvgDD={sb['AvgDrawdown']:.2f}%, WorstDD={sb['WorstDrawdown']:.2f}% | NG Long Mean={sng['Mean']:+.2f}%, WinRate={sng['WinRate']:.1f}% | Short Fade Mean={sf['Mean']:+.2f}%, WinRate={sf['WinRate']:.1f}%, PF={sf['ProfitFactor']:.2f}")

    print('\n=== 4. SELL BOTTOM / CAPITULATION TRAP ===')
    for name, val in d['sell_bottom_trap'].items():
        print(f"Scenario {name} (N={val['N']}):")
        for h in ['5D', '10D', '21D']:
            sb = val['BOIL_long_bounce'][h]
            sng = val['NG_long_bounce'][h]
            print(f"  {h}: BOIL Bounce Mean={sb['Mean']:+.2f}%, Med={sb['Median']:+.2f}%, WinRate={sb['WinRate']:.1f}%, PF={sb['ProfitFactor']:.2f}, AvgBounce={sb['AvgRunup']:.2f}%, AvgDD={sb['AvgDrawdown']:.2f}%, WorstDD={sb['WorstDrawdown']:.2f}% | NG Bounce Mean={sng['Mean']:+.2f}%, WinRate={sng['WinRate']:.1f}%, AvgBounce={sng['AvgRunup']:.2f}%")

    print('\n=== 5. EDGES ===')
    for name, val in d['edges'].items():
        print(f"Edge {name} (N={val['N']}, target={val['target']}, short={val['is_short']}):")
        for h in ['5D', '10D', '21D']:
            s = val['results'][h]
            print(f"  {h}: Mean={s['Mean']:+.2f}%, Med={s['Median']:+.2f}%, WinRate={s['WinRate']:.1f}%, PF={s['ProfitFactor']:.2f}, Sharpe={s['Sharpe']:+.2f}, Sortino={s['Sortino']:+.2f}, AvgDD={s['AvgDrawdown']:.2f}%, AvgRU={s['AvgRunup']:.2f}%")

if __name__ == '__main__':
    print_all()
