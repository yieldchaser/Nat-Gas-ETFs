/* ============================================
   Configuration
   ============================================ */

const CONFIG = {
    // ETF definitions
    etfs: {
        BOIL: {
            ticker: 'BOIL',
            yahoo: 'BOIL',
            name: 'ProShares Ultra Bloomberg NG',
            side: 'long',
            pair: 'KOLD',
            leverage: '2x',
            exchange: 'NYSE'
        },
        'HNU.TO': {
            ticker: 'HNU.TO',
            yahoo: 'HNU.TO',
            name: 'BetaPro Natural Gas 2x Bull',
            side: 'long',
            pair: 'HND.TO',
            leverage: '2x',
            exchange: 'TSX'
        },
        '3NGL.L': {
            ticker: '3NGL.L',
            yahoo: '3NGL.L',
            name: 'WisdomTree NG 3x Daily Long',
            side: 'long',
            pair: '3NGS.L',
            leverage: '3x',
            exchange: 'LSE'
        },
        KOLD: {
            ticker: 'KOLD',
            yahoo: 'KOLD',
            name: 'ProShares UltraShort Bloomberg NG',
            side: 'short',
            pair: 'BOIL',
            leverage: '2x',
            exchange: 'NYSE'
        },
        'HND.TO': {
            ticker: 'HND.TO',
            yahoo: 'HND.TO',
            name: 'BetaPro Natural Gas 2x Bear',
            side: 'short',
            pair: 'HNU.TO',
            leverage: '2x',
            exchange: 'TSX'
        },
        '3NGS.L': {
            ticker: '3NGS.L',
            yahoo: '3NGS.L',
            name: 'WisdomTree NG 3x Daily Short',
            side: 'short',
            pair: '3NGL.L',
            leverage: '3x',
            exchange: 'LSE'
        }
    },

    // Pairs for IPSI calculation
    pairs: [
        { long: 'BOIL', short: 'KOLD', label: 'BOIL / KOLD' },
        { long: 'HNU.TO', short: 'HND.TO', label: 'HNU / HND' },
        { long: '3NGL.L', short: '3NGS.L', label: '3NGL / 3NGS' }
    ],

    // Lookback windows (trading days)
    windows: {
        percentile: [10, 21, 63, 126, 252],
        rvol: [10, 21, 63, 126, 252],
        zScore: [10, 21, 63, 126, 252],
        vroc: [5, 10, 21],
        ma: [10, 21, 50, 200],
        correlation: 30
    },

    // Alert thresholds
    thresholds: {
        cvi:  { elevated: 60, high: 75, critical: 90, extreme: 95 },
        vcvi: { elevated: 55, high: 72, critical: 88, extreme: 95 },  // vol-adjusted CVI
        vps:  { elevated: 50, high: 70, critical: 85, extreme: 95 },
        rvol: { elevated: 1.5, high: 2.5, critical: 3.5, extreme: 5.0 },
        zScore: { elevated: 1.5, high: 2.0, critical: 2.5, extreme: 3.0 },
        percentile: { elevated: 50, high: 75, critical: 90, extreme: 95 },
        ipsi: { elevated: 1.5, high: 2.0, stress: 2.5, critical: 3.5 },
        mwca_threshold: 90,  // Percentile threshold for each window to trigger MWCA
        // Volatility modelling thresholds
        volRegime: { low: 30, normal: 60, high: 80, extreme: 92 },
        // HV term structure: HV10 / HV63
        // < 0.65 = calming strongly  |  > 1.35 = accelerating strongly
        hvTermStructure: { calming: 0.65, stable_low: 0.85, stable_high: 1.15, accelerating: 1.35 },
        vov: { elevated: 40, high: 60, critical: 80, extreme: 100 },   // vol-of-vol (%)
        atrBreakout: { elevated: 1.2, high: 1.5, critical: 2.0, extreme: 3.0 },  // × ATR

        // Conviction Event gates — strict multi-gate filter (~1-2 events/ETF/year)
        conviction: {
            vcviMin: 72,          // Gate 1: VCVI-21 ≥ critical
            breadthMin: 3,        // Gate 2: ≥ N of 5 vol-pct windows above threshold
            breadthPct: 85,       // Gate 2: percentile threshold per window
            atrMult: 1.5,         // Gate 3: |daily move| > N × ATR-14
            volRegimeMax: 70      // Gate 4: vol regime ≤ this (non-turbulent)
        }
    },

    // VPS weights — 5-component including inverse vol regime
    vpsWeights: { rvol: 0.25, zScore: 0.20, percentile: 0.25, vroc: 0.10, volRegime: 0.20 },

    // Data source
    dataUrl: 'data/dashboard_data.json',
    proxyUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/',

    // Refresh interval (milliseconds)
    refreshInterval: 60000, // 1 minute when market open
    refreshIntervalClosed: 300000, // 5 minutes when closed

    // History length for charts
    sparklineDays: 30,
    volumeBarDays: 30,
    heatmapDays: 90,

    // Yahoo Finance chart API period
    fetchPeriod: '2y',
    fetchInterval: '1d'
};
