#!/usr/bin/env python3
"""
alerts_research.py — the study behind the Active Alerts panel (docs/alerts_research.md).

Scores volume, fund-flow and options features against forward returns of the tradeable NG
index, (r_BOIL - r_KOLD) / 4, and evaluates candidate alert setups as non-overlapping trades
against the any-day benchmark. Needs pandas and numpy. Run from the repo root:

    python tools/alerts_research.py

Sections
  1  What the removed alert rules (VCVI / MWCA / RVOL) were worth
  2  Rank correlation of every feature with 5- and 21-session forward returns, by half
  3  Closing pressure: quintiles, 3-year blocks, vol terciles, seasons
  4  Closing pressure: window x threshold grid
  5  Equal-weight composite score (why stacking did not beat the two core signals)
  6  The six setups as trades
"""
import json, math, warnings
import numpy as np, pandas as pd
warnings.filterwarnings('ignore')
pd.set_option('display.width', 220); pd.set_option('display.max_rows', 200)

def etf(d,t):
    h=pd.DataFrame(d['etfs'][t]['history']); h['date']=pd.to_datetime(h['date']); return h.set_index('date').sort_index()
def flows(t):
    j=json.load(open(f'data/flows/{t}_flows.json'))['data']; f=pd.DataFrame(j); f['date']=pd.to_datetime(f['date']); return f.set_index('date').sort_index()
def exp_pct(s,minn=252):
    # expanding percentile rank (causal), 0-100
    v=s.values; out=np.full(len(v),np.nan); import bisect; srt=[]
    for i,x in enumerate(v):
        if np.isnan(x): continue
        if len(srt)>=minn: out[i]=100*bisect.bisect_right(srt,x)/len(srt)
        bisect.insort(srt,x)
    return pd.Series(out,index=s.index)
def roll_pct(s,w):
    return s.rolling(w).apply(lambda a:(a[:-1]<=a[-1]).mean()*100,raw=True)
def build():
    d=json.load(open('data/dashboard_data.json'))
    B=etf(d,'BOIL'); K=etf(d,'KOLD')
    c=pd.DataFrame(index=B.index.intersection(K.index))
    for n,h in [('b',B),('k',K)]:
        for col in ['open','high','low','close','volume']: c[n+'_'+col]=h[col].reindex(c.index)
    rb=c.b_close.pct_change(); rk=c.k_close.pct_change()
    r=(rb-rk)/4; bad=(rb/2+rk/2).abs()>0.08
    r[bad]=np.where(rb[bad].abs()<rk[bad].abs(), rb[bad]/2, -rk[bad]/2)
    c['r']=r; c['lr']=np.log1p(r).fillna(0); c['li']=c.lr.cumsum()
    for h in [1,3,5,10,21,42]: c[f'f{h}']=np.exp(c.li.shift(-h)-c.li)-1
    c['fb21']=c.b_close.shift(-21)/c.b_close-1; c['fk21']=c.k_close.shift(-21)/c.k_close-1
    c['fb10']=c.b_close.shift(-10)/c.b_close-1; c['fk10']=c.k_close.shift(-10)/c.k_close-1
    c['rv21']=c.lr.rolling(21).std()
    # price context
    for w in [3,5,10,21,63]: c[f'ret{w}']=np.exp(c.li-c.li.shift(w))-1
    c['z5']=c.ret5/(c.rv21.shift(5)*np.sqrt(5)); c['z21']=c.ret21/(c.rv21.shift(21)*np.sqrt(21)); c['z1']=c.r/c.rv21.shift(1)
    c['dd63']=np.exp(c.li-c.li.rolling(63).max())-1; c['ru63']=np.exp(c.li-c.li.rolling(63).min())-1
    c['pos252']=(c.li-c.li.rolling(252).min())/(c.li.rolling(252).max()-c.li.rolling(252).min())
    # volume: dollar volume (split-invariant)
    for n in ['b','k']:
        dv=c[n+'_close']*c[n+'_volume']; c[n+'_dv']=dv
        ldv=np.log(dv.replace(0,np.nan))
        c[n+'_rvol']=dv/dv.shift(1).rolling(21).median()
        c[n+'_rvol5']=dv.rolling(5).mean()/dv.shift(5).rolling(63).median()
        c[n+'_dvz']=(ldv-ldv.shift(1).rolling(63).mean())/ldv.shift(1).rolling(63).std()
        for w in [21,63,252]: c[f'{n}_vp{w}']=roll_pct(dv,w)
        px=c[n+'_close']
        for w in [21,63,252]: c[f'{n}_pp{w}']=roll_pct(px,w)
        # CVI: high volume pct x low price pct
        for w in [21,63,252]: c[f'{n}_cvi{w}']=c[f'{n}_vp{w}']*(100-c[f'{n}_pp{w}'])/100
        # PVT on ETF: cumulative dv-weighted return, normalised
        pr=px.pct_change().fillna(0); nv=dv/dv.rolling(63).mean()
        pvt=(pr*nv).fillna(0).cumsum(); c[n+'_pvt']=pvt
        c[n+'_pvt_x']=pvt.ewm(span=8).mean()-pvt.ewm(span=21).mean()
        c[n+'_pvtz']=(pvt-pvt.rolling(21).mean())/pvt.rolling(21).std()
        # up/down volume balance 10d
        up=(dv*(pr>0)).rolling(10).sum(); dn=(dv*(pr<0)).rolling(10).sum(); c[n+'_udv10']=(up-dn)/(up+dn)
        # CMF 21
        hl=(c[n+'_high']-c[n+'_low']).replace(0,np.nan); mfm=((px-c[n+'_low'])-(c[n+'_high']-px))/hl
        c[n+'_cmf21']=(mfm*dv).rolling(21).sum()/dv.rolling(21).sum()
    c['kshare']=c.k_dv/(c.k_dv+c.b_dv); c['kshare10']=c.k_dv.rolling(10).sum()/(c.k_dv.rolling(10).sum()+c.b_dv.rolling(10).sum())
    c['kshare_z']=(c.kshare10-c.kshare10.rolling(252).mean())/c.kshare10.rolling(252).std()
    c['tot_rvol']=(c.b_dv+c.k_dv)/(c.b_dv+c.k_dv).shift(1).rolling(21).median()
    # flows
    for n,t in [('b','BOIL'),('k','KOLD')]:
        f=flows(t); uf=f.usd_flow.reindex(c.index)
        c[n+'_flow']=uf
        sc=uf.abs().rolling(252,min_periods=120).mean().shift(1)
        for w in [1,5,20]: c[f'{n}_fl{w}']=uf.rolling(w,min_periods=max(1,w//2)).sum()/(sc*np.sqrt(w))
        # flow relative to dollar volume (creation intensity)
        c[n+'_fl5dv']=uf.rolling(5).sum()/c[n+'_dv'].rolling(5).sum()
        c[n+'_nav']=f.nav.reindex(c.index)
    # cvol
    cv=pd.read_csv('data/cvol/ngvl_cvol_history.csv'); cv['date']=pd.to_datetime(cv['Timestamp'],format='%d-%m-%Y'); cv=cv.drop(columns='Timestamp').set_index('date').sort_index()
    cv.columns=['ngvl','dn','up','skew','sr','atm','conv','und']
    c=c.join(cv)
    c['sr_pe']=exp_pct(c.sr); c['ngvl_pe']=exp_pct(c.ngvl)
    c['ngvl_chg5']=np.log(c.ngvl/c.ngvl.shift(5))
    c['blow']=(c.sr_pe>=95)&(c.ngvl_pe>=90); c['stress']=(c.sr_pe>=90)&(c.sr_pe<95)&(c.ngvl_pe>=90)
    sig5=c.ngvl.shift(5)/100*np.sqrt(5/252)*0.8
    c['mv5']=np.log1p(c.ret5)/sig5; c['flush']=(c.mv5<=-1.5)&(c.ngvl_chg5>0.05)&~c.blow&~c.stress
    c['month']=c.index.month
    return c


def rp(s, w): return s.rolling(w).apply(lambda a: (a <= a[-1]).mean() * 100, raw=True)

def add_legacy(c):
    """Replicate the removed feed rules: VCVI per window, MWCA, max RVOL (share volume)."""
    W = [5, 10, 21, 63, 126, 252]
    for n in ['b', 'k']:
        v = c[n + '_volume']; p = c[n + '_close']
        hv = np.log(p / p.shift(1)).rolling(21).std(); vr = rp(hv, 253)
        vps = {w: rp(v, w) for w in W}; pps = {w: rp(p, w) for w in W}
        vc = pd.DataFrame({w: vps[w] * (1 - pps[w] / 100) * (1.5 - vr / 100) for w in W})
        c[n + '_vcvi_max'] = vc.max(axis=1); c[n + '_vcvi63'] = vc[63]
        c[n + '_mwca'] = pd.DataFrame({w: vps[w] >= 90 for w in W}).all(axis=1)
        c[n + '_rvolsh'] = pd.DataFrame({w: v / v.rolling(w).mean() for w in W}).max(axis=1)
    return c

def day_stats(c, name, mask):
    mask = mask.fillna(False) & c.f21.notna()
    out = f'{name:42s} days {int(mask.sum()):4d} ({mask.mean()*100:4.1f}% of days)'
    for h in (10, 21):
        y = c[f'f{h}']; out += f' | {h}D mean {y[mask].mean()*100:+5.1f}% up {(y[mask]>0).mean()*100:3.0f}% (base {y.mean()*100:+.1f}/{(y>0).mean()*100:.0f})'
    print(out)

def trades(c, mask, hold, start=252):
    li = c.li.values; lb = np.log(c.b_close.values); lk = np.log(c.k_close.values); m = mask.fillna(False).values
    out = []; i = start; N = len(c)
    while i < N - hold:
        if m[i]:
            seg = li[i:i + hold + 1]
            out.append(dict(i=i, d=c.index[i].date(), r=np.exp(seg[-1] - seg[0]) - 1, hi=np.exp(seg.max() - seg[0]) - 1, lo=np.exp(seg.min() - seg[0]) - 1,
                            b=np.exp(lb[i + hold] - lb[i]) - 1, k=np.exp(lk[i + hold] - lk[i]) - 1)); i += hold
        else: i += 1
    return pd.DataFrame(out)

def binom_tail(k, n, p): return sum(math.comb(n, j) * p**j * (1 - p)**(n - j) for j in range(k, n + 1))

def trade_report(c, name, mask, side, holds=(10, 21)):
    N = len(c)
    for hold in holds:
        t = trades(c, mask, hold)
        if len(t) < 5: print(f'{name:36s} hold {hold}: {len(t)} trades'); continue
        sg = -1 if side == 'short' else 1; pnl = sg * t.r; y = sg * c[f'f{hold}'].iloc[252:].dropna(); bw = (y > 0).mean()
        lev = t.k if side == 'short' else t.b; h = N // 2; w = int((pnl > 0).sum())
        print(f'{name:36s} {side:5s} hold {hold:2d}: {len(t):3d} trades, won {w} ({w/len(t)*100:3.0f}%) vs any-day {bw*100:.0f}%, avg {pnl.mean()*100:+5.1f}% (any-day {y.mean()*100:+.1f}%), '
              f'p={binom_tail(w, len(t), bw):.3f} | halves {(pnl[t.i<h]>0).mean()*100:3.0f}%({(t.i<h).sum()}) / {(pnl[t.i>=h]>0).mean()*100:3.0f}%({(t.i>=h).sum()}) | '
              f'worst {pnl.min()*100:+.0f}% | {"KOLD" if side=="short" else "BOIL"} leg avg {lev.mean()*100:+5.1f}%')

def main():
    c = add_legacy(build()).replace([np.inf, -np.inf], np.nan)
    c['cmfd'] = c.k_cmf21 - c.b_cmf21                       # closing pressure = -cmfd / 2
    for f in ['cmfd', 'rv21', 'b_fl5']: c[f + '_pe'] = exp_pct(c[f], 252)
    c['b_fl5L_pe'] = exp_pct(c.b_fl5.shift(1), 252)        # flows lagged one session (published T+1)
    F = lambda s: s.fillna(False)
    print(f'{len(c)} sessions {c.index[0].date()} -> {c.index[-1].date()} | base up-rate 10D {(c.f10>0).mean()*100:.1f}% 21D {(c.f21>0).mean()*100:.1f}%')

    print('\n=== 1. Removed alert rules ===')
    day_stats(c, 'BOIL VCVI any window >= 88 ("BOTTOM")', c.b_vcvi_max >= 88); day_stats(c, 'KOLD VCVI any window >= 88 ("TOP")', c.k_vcvi_max >= 88)
    day_stats(c, 'BOIL VCVI-63d >= 72', c.b_vcvi63 >= 72); day_stats(c, 'KOLD VCVI-63d >= 72', c.k_vcvi63 >= 72)
    day_stats(c, 'BOIL MWCA', c.b_mwca); day_stats(c, 'KOLD MWCA', c.k_mwca)
    day_stats(c, 'BOIL RVOL any window >= 3.5x', c.b_rvolsh >= 3.5); day_stats(c, 'KOLD RVOL any window >= 3.5x', c.k_rvolsh >= 3.5)

    print('\n=== 2. Feature rank correlation with forward returns ===')
    skip = ('_open', '_high', '_low', '_close', '_volume', '_dv', '_flow', '_nav', '_pvt')
    feats = [x for x in c.columns if c[x].dtype != bool and x not in ['r', 'lr', 'li', 'month', 'und'] and not x.startswith('f') and not x.endswith(skip)]
    rows = []
    for f in feats:
        s = c[f]; d = c[s.notna()]
        if len(d) < 800: continue
        m = d.index[len(d) // 2]
        rows.append(dict(feat=f, n=len(d), ic5=s.corr(c.f5, method='spearman'), ic21=s.corr(c.f21, method='spearman'),
                         ic21_h1=s[:m].corr(c.f21[:m], method='spearman'), ic21_h2=s[m:].corr(c.f21[m:], method='spearman')))
    t = pd.DataFrame(rows).set_index('feat').round(3); t['stable'] = np.sign(t.ic21_h1) == np.sign(t.ic21_h2)
    print(t.reindex(t.ic21.abs().sort_values(ascending=False).index).to_string())

    print('\n=== 3. Closing pressure (cmfd = CMF21_KOLD - CMF21_BOIL; high = NG closing weak) ===')
    for f in ['k_cmf21', 'b_cmf21', 'cmfd', 'rv21']:
        g = c.groupby(pd.qcut(c[f], 5, labels=False))
        print(f'{f:8s} quintiles: 21D mean % {(g.f21.mean()*100).round(1).tolist()}  up % {(g.f21.apply(lambda x: (x>0).mean())*100).round(0).tolist()}')
    for y, g in c.groupby((c.index.year - 2011) // 3):
        print(f'  {2011+3*y}-{2013+3*y}: IC21 cmfd {g.cmfd.corr(g.f21, method="spearman"):+.3f}  rv21 {g.rv21.corr(g.f21, method="spearman"):+.3f}  n {len(g)}')
    for rvq, g in c.groupby(pd.qcut(c.rv21, 3, labels=['low vol', 'mid vol', 'high vol'])):
        gg = g.groupby(pd.qcut(g.cmfd, 3, labels=False)); print(f'  {rvq}: cmfd terciles 21D mean % {(gg.f21.mean()*100).round(1).tolist()} up % {(gg.f21.apply(lambda x: (x>0).mean())*100).round(0).tolist()}')
    for nm, ms in [('Nov-Mar', [11, 12, 1, 2, 3]), ('Apr-Oct', [4, 5, 6, 7, 8, 9, 10])]:
        s = (c.cmfd_pe <= 10) & c.month.isin(ms); b = c.month.isin(ms)
        print(f'  {nm}: strong-close days {int(s.sum())}, 21D up {(c.f21[s]>0).mean()*100:.0f}% (season base {(c.f21[b]>0).mean()*100:.0f}%)')

    print('\n=== 4. Closing-pressure grid: short when NG closes strong ===')
    def cmf(n, w):
        px = c[n + '_close']; hl = (c[n + '_high'] - c[n + '_low']).replace(0, np.nan); mfm = (((px - c[n + '_low']) - (c[n + '_high'] - px)) / hl).fillna(0); dv = c[n + '_dv']
        return (mfm * dv).rolling(w).sum() / dv.rolling(w).sum()
    for w in [10, 21, 42]:
        pe = exp_pct(cmf('k', w) - cmf('b', w), 252)
        for th in [5, 10, 15, 20]: trade_report(c, f'CP window {w}, top {th}%', pe <= th, 'short', holds=(21,))

    print('\n=== 5. Equal-weight bearish score ===')
    comp = {'closeStrong20': F(c.cmfd_pe <= 20), 'closeStrong10': F(c.cmfd_pe <= 10), 'volHot': F(c.rv21_pe >= 70), 'optBlowOrStress': F(c.blow | c.stress),
            'boilClimax': F(c.b_mwca | (c.b_rvolsh >= 3.5)), 'stretchedUp': F(c.z5 >= 1.5), 'boilCreations': F(c.b_fl5L_pe >= 90)}
    c['bearN'] = pd.DataFrame(comp).astype(int).sum(axis=1); g = c.iloc[252:].groupby('bearN')
    print(pd.DataFrame({'days': g.size(), 'f10': g.f10.mean() * 100, 'up10': g.f10.apply(lambda x: (x > 0).mean() * 100), 'f21': g.f21.mean() * 100,
                        'up21': g.f21.apply(lambda x: (x > 0).mean() * 100), 'KOLD21': g.fk21.mean() * 100}).round(1))
    trade_report(c, 'score >= 3', c.bearN >= 3, 'short'); trade_report(c, 'score >= 4', c.bearN >= 4, 'short')

    print('\n=== 6. Setups as non-overlapping trades ===')
    climax = comp['boilClimax']
    trade_report(c, 'CLOSE EXHAUSTION (CP top 10%)', F(c.cmfd_pe <= 10), 'short')
    trade_report(c, 'OPTIONS BLOW-OFF', F(c.blow), 'short')
    trade_report(c, 'CROWDED RALLY (climax & CP top 20%)', climax & F(c.cmfd_pe <= 20), 'short')
    trade_report(c, 'CHASED RALLY (BOIL creations & hot vol)', F(c.b_fl5L_pe >= 90) & F(c.rv21_pe >= 70), 'short')
    trade_report(c, 'CAPITULATION (flush & CP bottom 20%)', F(c.flush) & F(c.cmfd_pe >= 80), 'long')
    trade_report(c, 'WASHOUT (CP bottom 10% & dd63<=-25%)', F(c.cmfd_pe >= 90) & F(c.dd63 <= -0.25), 'long')
    print('  -- controls --')
    trade_report(c, 'flush WITHOUT weak closes', F(c.flush) & ~F(c.cmfd_pe >= 80), 'long', holds=(21,))
    trade_report(c, 'weak closes alone (CP bottom 10%)', F(c.cmfd_pe >= 90), 'long', holds=(21,))
    trade_report(c, 'BOIL volume climax alone', climax, 'short', holds=(21,))

if __name__ == '__main__':
    main()
