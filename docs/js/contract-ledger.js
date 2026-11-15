/* ==========================================================================
   BLUE MERIDIAN — ETF Futures Contract Holding & Roll Schedule Ledger
   Deterministic Cross-Jurisdiction Contract Mapping Engine
   US (BOIL/KOLD) · CA (HNU/HND) · UK (3NGL/3NGS)
   ========================================================================== */

const ContractLedger = {
    MONTH_CODES: {
        1: 'F', 2: 'G', 3: 'H', 4: 'J', 5: 'K', 6: 'M',
        7: 'N', 8: 'Q', 9: 'U', 10: 'V', 11: 'X', 12: 'Z'
    },

    CODE_TO_MONTH_NAME: {
        'F': 'January', 'G': 'February', 'H': 'March', 'J': 'April',
        'K': 'May', 'M': 'June', 'N': 'July', 'Q': 'August',
        'U': 'September', 'V': 'October', 'X': 'November', 'Z': 'December'
    },

    MONTH_NAMES: [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ],

    /* Bloomberg Commodity Index (BCOMNG) Contract Calendar (Table 9) */
    BCOM_SCHEDULE: {
        1: { leadCode: 'H', leadYr: 0, nextCode: 'H', nextYr: 0, rolls: false },
        2: { leadCode: 'H', leadYr: 0, nextCode: 'K', nextYr: 0, rolls: true },
        3: { leadCode: 'K', leadYr: 0, nextCode: 'K', nextYr: 0, rolls: false },
        4: { leadCode: 'K', leadYr: 0, nextCode: 'N', nextYr: 0, rolls: true },
        5: { leadCode: 'N', leadYr: 0, nextCode: 'N', nextYr: 0, rolls: false },
        6: { leadCode: 'N', leadYr: 0, nextCode: 'U', nextYr: 0, rolls: true },
        7: { leadCode: 'U', leadYr: 0, nextCode: 'U', nextYr: 0, rolls: false },
        8: { leadCode: 'U', leadYr: 0, nextCode: 'X', nextYr: 0, rolls: true },
        9: { leadCode: 'X', leadYr: 0, nextCode: 'X', nextYr: 0, rolls: false },
        10: { leadCode: 'X', leadYr: 0, nextCode: 'F', nextYr: 1, rolls: true },
        11: { leadCode: 'F', leadYr: 1, nextCode: 'F', nextYr: 1, rolls: false },
        12: { leadCode: 'F', leadYr: 1, nextCode: 'H', nextYr: 1, rolls: true }
    },

    /* Global X Canada BetaPro Natural Gas (CMDYNGER) Contract Calendar */
    CMDY_SCHEDULE: {
        1: { leadCode: 'G', leadYr: 0, nextCode: 'H', nextYr: 0 },
        2: { leadCode: 'H', leadYr: 0, nextCode: 'J', nextYr: 0 },
        3: { leadCode: 'J', leadYr: 0, nextCode: 'K', nextYr: 0 },
        4: { leadCode: 'K', leadYr: 0, nextCode: 'M', nextYr: 0 },
        5: { leadCode: 'M', leadYr: 0, nextCode: 'N', nextYr: 0 },
        6: { leadCode: 'N', leadYr: 0, nextCode: 'Q', nextYr: 0 },
        7: { leadCode: 'Q', leadYr: 0, nextCode: 'U', nextYr: 0 },
        8: { leadCode: 'U', leadYr: 0, nextCode: 'V', nextYr: 0 },
        9: { leadCode: 'V', leadYr: 0, nextCode: 'X', nextYr: 0 },
        10: { leadCode: 'X', leadYr: 0, nextCode: 'Z', nextYr: 0 },
        11: { leadCode: 'Z', leadYr: 0, nextCode: 'F', nextYr: 1 },
        12: { leadCode: 'F', leadYr: 1, nextCode: 'G', nextYr: 1 }
    },

    /* Solactive Natural Gas Commodity Futures SL Index (SOLWSNG2, SFMC=2) */
    SOL_SCHEDULE: {
        1: { leadCode: 'H', leadYr: 0, nextCode: 'J', nextYr: 0 },
        2: { leadCode: 'J', leadYr: 0, nextCode: 'K', nextYr: 0 },
        3: { leadCode: 'K', leadYr: 0, nextCode: 'M', nextYr: 0 },
        4: { leadCode: 'M', leadYr: 0, nextCode: 'N', nextYr: 0 },
        5: { leadCode: 'N', leadYr: 0, nextCode: 'Q', nextYr: 0 },
        6: { leadCode: 'Q', leadYr: 0, nextCode: 'U', nextYr: 0 },
        7: { leadCode: 'U', leadYr: 0, nextCode: 'V', nextYr: 0 },
        8: { leadCode: 'V', leadYr: 0, nextCode: 'X', nextYr: 0 },
        9: { leadCode: 'X', leadYr: 0, nextCode: 'Z', nextYr: 0 },
        10: { leadCode: 'Z', leadYr: 0, nextCode: 'F', nextYr: 1 },
        11: { leadCode: 'F', leadYr: 1, nextCode: 'G', nextYr: 1 },
        12: { leadCode: 'G', leadYr: 1, nextCode: 'H', nextYr: 1 }
    },

    _holidayCache: {},

    /* Deterministic US / CME Federal Holiday Engine */
    getUsHolidays(year) {
        if (this._holidayCache[year]) return this._holidayCache[year];

        const holidays = new Set();
        const addYmd = (y, m, d) => {
            const mm = String(m).padStart(2, '0');
            const dd = String(d).padStart(2, '0');
            holidays.add(`${y}-${mm}-${dd}`);
        };

        // New Year's Day (Jan 1)
        const ny = new Date(Date.UTC(year, 0, 1));
        if (ny.getUTCDay() === 0) addYmd(year, 1, 2);
        else addYmd(year, 1, 1);

        // MLK Day: 3rd Monday in Jan
        addYmd(year, 1, this._getNthWeekdayOfMonth(year, 0, 1, 3));

        // Washington's Birthday / Presidents Day: 3rd Monday in Feb
        addYmd(year, 2, this._getNthWeekdayOfMonth(year, 1, 1, 3));

        // Good Friday (Easter - 2 days)
        const easter = this._computeEaster(year);
        const gf = new Date(easter.getTime() - 2 * 86400000);
        addYmd(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate());

        // Memorial Day: Last Monday in May
        addYmd(year, 5, this._getLastWeekdayOfMonth(year, 4, 1));

        // Juneteenth (Observed from 2022 onwards)
        if (year >= 2022) {
            const jt = new Date(Date.UTC(year, 5, 19));
            if (jt.getUTCDay() === 6) addYmd(year, 6, 18);
            else if (jt.getUTCDay() === 0) addYmd(year, 6, 20);
            else addYmd(year, 6, 19);
        }

        // Independence Day (July 4)
        const id = new Date(Date.UTC(year, 6, 4));
        if (id.getUTCDay() === 6) addYmd(year, 7, 3);
        else if (id.getUTCDay() === 0) addYmd(year, 7, 5);
        else addYmd(year, 7, 4);

        // Labor Day: 1st Monday in Sep
        addYmd(year, 9, this._getNthWeekdayOfMonth(year, 8, 1, 1));

        // Thanksgiving: 4th Thursday in Nov
        addYmd(year, 11, this._getNthWeekdayOfMonth(year, 10, 4, 4));

        // Christmas Day (Dec 25)
        const xm = new Date(Date.UTC(year, 11, 25));
        if (xm.getUTCDay() === 6) addYmd(year, 12, 24);
        else if (xm.getUTCDay() === 0) addYmd(year, 12, 26);
        else addYmd(year, 12, 25);

        this._holidayCache[year] = holidays;
        return holidays;
    },

    _getNthWeekdayOfMonth(year, monthZero, targetWeekday, nth) {
        let count = 0;
        const daysInMonth = new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
        for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(Date.UTC(year, monthZero, d));
            if (dt.getUTCDay() === targetWeekday) {
                count++;
                if (count === nth) return d;
            }
        }
        return 1;
    },

    _getLastWeekdayOfMonth(year, monthZero, targetWeekday) {
        const daysInMonth = new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
        for (let d = daysInMonth; d >= 1; d -= 1) {
            const dt = new Date(Date.UTC(year, monthZero, d));
            if (dt.getUTCDay() === targetWeekday) return d;
        }
        return daysInMonth;
    },

    _computeEaster(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const monthZero = Math.floor((h + l - 7 * m + 114) / 31) - 1;
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(Date.UTC(year, monthZero, day));
    },

    isUsBusinessDay(year, monthOne, day) {
        const dt = new Date(Date.UTC(year, monthOne - 1, day));
        const dow = dt.getUTCDay();
        if (dow === 0 || dow === 6) return false;
        const mm = String(monthOne).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const ymd = `${year}-${mm}-${dd}`;
        const holidays = this.getUsHolidays(year);
        return !holidays.has(ymd);
    },

    getMonthBusinessDays(year, monthOne) {
        const daysInMonth = new Date(Date.UTC(year, monthOne, 0)).getUTCDate();
        const bDays = [];
        for (let d = 1; d <= daysInMonth; d++) {
            if (this.isUsBusinessDay(year, monthOne, d)) {
                bDays.push(d);
            }
        }
        return bDays;
    },

    /* CME Rule 220: Natural Gas Contract Expiration Date
       Trading terminates 3 business days prior to the first calendar day of the delivery month. */
    getNymexContractExpiry(deliveryYear, deliveryMonthOne) {
        let precYear = deliveryYear;
        let precMonth = deliveryMonthOne - 1;
        if (precMonth === 0) {
            precMonth = 12;
            precYear -= 1;
        }
        const bDays = this.getMonthBusinessDays(precYear, precMonth);
        if (bDays.length >= 3) {
            const expDay = bDays[bDays.length - 3];
            const mm = String(precMonth).padStart(2, '0');
            const dd = String(expDay).padStart(2, '0');
            return `${precYear}-${mm}-${dd}`;
        }
        return `${precYear}-${String(precMonth).padStart(2, '0')}-25`;
    },

    formatContractSymbol(code, deliveryYear) {
        const yr2 = String(deliveryYear).slice(-2);
        return `NG${code}${yr2}`;
    },

    formatContractLabel(code, deliveryYear) {
        const name = this.CODE_TO_MONTH_NAME[code] || code;
        return `${this.formatContractSymbol(code, deliveryYear)} (${name} ${deliveryYear})`;
    },

    /* Evaluates contract holdings for any calendar date */
    getHoldingForDate(year, monthOne, day) {
        const bDays = this.getMonthBusinessDays(year, monthOne);
        const isBday = this.isUsBusinessDay(year, monthOne, day);

        let bIndex = 1;
        if (isBday) {
            bIndex = bDays.indexOf(day) + 1;
        } else {
            const prior = bDays.filter(d => d < day);
            bIndex = prior.length > 0 ? bDays.indexOf(prior[prior.length - 1]) + 1 : 1;
        }

        const totalBdays = bDays.length;
        const mm = String(monthOne).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const dateStr = `${year}-${mm}-${dd}`;

        // 1. US (BOIL / KOLD) - BCOMNG Schedule
        const usCfg = this.BCOM_SCHEDULE[monthOne];
        const usLeadCode = usCfg.leadCode;
        const usLeadYr = year + usCfg.leadYr;
        const usNextCode = usCfg.nextCode;
        const usNextYr = year + usCfg.nextYr;
        const usLeadSym = this.formatContractSymbol(usLeadCode, usLeadYr);
        const usNextSym = this.formatContractSymbol(usNextCode, usNextYr);
        const usLeadExp = this.getNymexContractExpiry(usLeadYr, this._codeToMonthNum(usLeadCode));
        const usNextExp = this.getNymexContractExpiry(usNextYr, this._codeToMonthNum(usNextCode));

        let usHoldings = {};
        let usPhase = '';
        let usPhaseClass = '';

        if (!usCfg.rolls) {
            usHoldings = [{ sym: usLeadSym, code: usLeadCode, yr: usLeadYr, pct: 100, expiry: usLeadExp }];
            usPhase = 'HELD (Odd Month · No Roll)';
            usPhaseClass = 'status-held';
        } else {
            if (bIndex <= 5) {
                usHoldings = [{ sym: usLeadSym, code: usLeadCode, yr: usLeadYr, pct: 100, expiry: usLeadExp }];
                usPhase = 'PRE-ROLL (Roll starts Day 6)';
                usPhaseClass = 'status-preroll';
            } else if (bIndex === 6) {
                usHoldings = [
                    { sym: usLeadSym, code: usLeadCode, yr: usLeadYr, pct: 80, expiry: usLeadExp },
                    { sym: usNextSym, code: usNextCode, yr: usNextYr, pct: 20, expiry: usNextExp }
                ];
                usPhase = 'ACTIVE ROLL · DAY 1 OF 5 (80/20)';
                usPhaseClass = 'status-rolling';
            } else if (bIndex === 7) {
                usHoldings = [
                    { sym: usLeadSym, code: usLeadCode, yr: usLeadYr, pct: 60, expiry: usLeadExp },
                    { sym: usNextSym, code: usNextCode, yr: usNextYr, pct: 40, expiry: usNextExp }
                ];
                usPhase = 'ACTIVE ROLL · DAY 2 OF 5 (60/40)';
                usPhaseClass = 'status-rolling';
            } else if (bIndex === 8) {
                usHoldings = [
                    { sym: usLeadSym, code: usLeadCode, yr: usLeadYr, pct: 40, expiry: usLeadExp },
                    { sym: usNextSym, code: usNextCode, yr: usNextYr, pct: 60, expiry: usNextExp }
                ];
                usPhase = 'ACTIVE ROLL · DAY 3 OF 5 (40/60)';
                usPhaseClass = 'status-rolling';
            } else if (bIndex === 9) {
                usHoldings = [
                    { sym: usLeadSym, code: usLeadCode, yr: usLeadYr, pct: 20, expiry: usLeadExp },
                    { sym: usNextSym, code: usNextCode, yr: usNextYr, pct: 80, expiry: usNextExp }
                ];
                usPhase = 'ACTIVE ROLL · DAY 4 OF 5 (20/80)';
                usPhaseClass = 'status-rolling';
            } else {
                usHoldings = [{ sym: usNextSym, code: usNextCode, yr: usNextYr, pct: 100, expiry: usNextExp }];
                usPhase = 'POST-ROLL · 100% NEXT';
                usPhaseClass = 'status-postroll';
            }
        }

        let usTargetCode, usTargetYr;
        if (usCfg.rolls && bIndex <= 9) {
            usTargetCode = usCfg.nextCode;
            usTargetYr = year + usCfg.nextYr;
        } else {
            for (let step = 1; step <= 12; step++) {
                const tm = ((monthOne - 1 + step) % 12) + 1;
                const ty = year + Math.floor((monthOne - 1 + step) / 12);
                if (this.BCOM_SCHEDULE[tm].rolls) {
                    usTargetCode = this.BCOM_SCHEDULE[tm].nextCode;
                    usTargetYr = ty + this.BCOM_SCHEDULE[tm].nextYr;
                    break;
                }
            }
        }
        const usTargetSym = this.formatContractSymbol(usTargetCode, usTargetYr);
        const usTargetExp = this.getNymexContractExpiry(usTargetYr, this._codeToMonthNum(usTargetCode));

        // 2. Canada (HNU / HND) - CMDYNGER Schedule (Global X)
        const caCfg = this.CMDY_SCHEDULE[monthOne];
        const caLeadCode = caCfg.leadCode;
        const caLeadYr = year + caCfg.leadYr;
        const caNextCode = caCfg.nextCode;
        const caNextYr = year + caCfg.nextYr;
        const caLeadSym = this.formatContractSymbol(caLeadCode, caLeadYr);
        const caNextSym = this.formatContractSymbol(caNextCode, caNextYr);
        const caLeadExp = this.getNymexContractExpiry(caLeadYr, this._codeToMonthNum(caLeadCode));
        const caNextExp = this.getNymexContractExpiry(caNextYr, this._codeToMonthNum(caNextCode));

        let caHoldings = {};
        let caPhase = '';
        let caPhaseClass = '';

        if (bIndex <= 3) {
            caHoldings = [{ sym: caLeadSym, code: caLeadCode, yr: caLeadYr, pct: 100, expiry: caLeadExp }];
            caPhase = 'PRE-ROLL (Roll starts Day 4)';
            caPhaseClass = 'status-preroll';
        } else if (bIndex === 4) {
            caHoldings = [
                { sym: caLeadSym, code: caLeadCode, yr: caLeadYr, pct: 75, expiry: caLeadExp },
                { sym: caNextSym, code: caNextCode, yr: caNextYr, pct: 25, expiry: caNextExp }
            ];
            caPhase = 'ACTIVE ROLL · DAY 1 OF 4 (75/25)';
            caPhaseClass = 'status-rolling';
        } else if (bIndex === 5) {
            caHoldings = [
                { sym: caLeadSym, code: caLeadCode, yr: caLeadYr, pct: 50, expiry: caLeadExp },
                { sym: caNextSym, code: caNextCode, yr: caNextYr, pct: 50, expiry: caNextExp }
            ];
            caPhase = 'ACTIVE ROLL · DAY 2 OF 4 (50/50)';
            caPhaseClass = 'status-rolling';
        } else if (bIndex === 6) {
            caHoldings = [
                { sym: caLeadSym, code: caLeadCode, yr: caLeadYr, pct: 25, expiry: caLeadExp },
                { sym: caNextSym, code: caNextCode, yr: caNextYr, pct: 75, expiry: caNextExp }
            ];
            caPhase = 'ACTIVE ROLL · DAY 3 OF 4 (25/75)';
            caPhaseClass = 'status-rolling';
        } else {
            caHoldings = [{ sym: caNextSym, code: caNextCode, yr: caNextYr, pct: 100, expiry: caNextExp }];
            caPhase = 'POST-ROLL · 100% NEXT';
            caPhaseClass = 'status-postroll';
        }

        let caTargetCode, caTargetYr;
        if (bIndex <= 6) {
            caTargetCode = caCfg.nextCode;
            caTargetYr = year + caCfg.nextYr;
        } else {
            const nm = monthOne === 12 ? 1 : monthOne + 1;
            const ny = monthOne === 12 ? year + 1 : year;
            caTargetCode = this.CMDY_SCHEDULE[nm].nextCode;
            caTargetYr = ny + this.CMDY_SCHEDULE[nm].nextYr;
        }
        const caTargetSym = this.formatContractSymbol(caTargetCode, caTargetYr);
        const caTargetExp = this.getNymexContractExpiry(caTargetYr, this._codeToMonthNum(caTargetCode));

        // 3. London (3NGL / 3NGS) - SOLWSNG2 Schedule (Solactive SFMC=2)
        const ukCfg = this.SOL_SCHEDULE[monthOne];
        const ukLeadCode = ukCfg.leadCode;
        const ukLeadYr = year + ukCfg.leadYr;
        const ukNextCode = ukCfg.nextCode;
        const ukNextYr = year + ukCfg.nextYr;
        const ukLeadSym = this.formatContractSymbol(ukLeadCode, ukLeadYr);
        const ukNextSym = this.formatContractSymbol(ukNextCode, ukNextYr);
        const ukLeadExp = this.getNymexContractExpiry(ukLeadYr, this._codeToMonthNum(ukLeadCode));
        const ukNextExp = this.getNymexContractExpiry(ukNextYr, this._codeToMonthNum(ukNextCode));

        let ukHoldings = {};
        let ukPhase = '';
        let ukPhaseClass = '';

        if (bIndex <= 4) {
            ukHoldings = [{ sym: ukLeadSym, code: ukLeadCode, yr: ukLeadYr, pct: 100, expiry: ukLeadExp }];
            ukPhase = 'PRE-ROLL (Roll starts Day 5)';
            ukPhaseClass = 'status-preroll';
        } else if (bIndex === 5) {
            ukHoldings = [
                { sym: ukLeadSym, code: ukLeadCode, yr: ukLeadYr, pct: 80, expiry: ukLeadExp },
                { sym: ukNextSym, code: ukNextCode, yr: ukNextYr, pct: 20, expiry: ukNextExp }
            ];
            ukPhase = 'ACTIVE ROLL · DAY 1 OF 5 (80/20)';
            ukPhaseClass = 'status-rolling';
        } else if (bIndex === 6) {
            ukHoldings = [
                { sym: ukLeadSym, code: ukLeadCode, yr: ukLeadYr, pct: 60, expiry: ukLeadExp },
                { sym: ukNextSym, code: ukNextCode, yr: ukNextYr, pct: 40, expiry: ukNextExp }
            ];
            ukPhase = 'ACTIVE ROLL · DAY 2 OF 5 (60/40)';
            ukPhaseClass = 'status-rolling';
        } else if (bIndex === 7) {
            ukHoldings = [
                { sym: ukLeadSym, code: ukLeadCode, yr: ukLeadYr, pct: 40, expiry: ukLeadExp },
                { sym: ukNextSym, code: ukNextCode, yr: ukNextYr, pct: 60, expiry: ukNextExp }
            ];
            ukPhase = 'ACTIVE ROLL · DAY 3 OF 5 (40/60)';
            ukPhaseClass = 'status-rolling';
        } else if (bIndex === 8) {
            ukHoldings = [
                { sym: ukLeadSym, code: ukLeadCode, yr: ukLeadYr, pct: 20, expiry: ukLeadExp },
                { sym: ukNextSym, code: ukNextCode, yr: ukNextYr, pct: 80, expiry: ukNextExp }
            ];
            ukPhase = 'ACTIVE ROLL · DAY 4 OF 5 (20/80)';
            ukPhaseClass = 'status-rolling';
        } else {
            ukHoldings = [{ sym: ukNextSym, code: ukNextCode, yr: ukNextYr, pct: 100, expiry: ukNextExp }];
            ukPhase = 'POST-ROLL · 100% NEXT';
            ukPhaseClass = 'status-postroll';
        }

        let ukTargetCode, ukTargetYr;
        if (bIndex <= 8) {
            ukTargetCode = ukCfg.nextCode;
            ukTargetYr = year + ukCfg.nextYr;
        } else {
            const nm = monthOne === 12 ? 1 : monthOne + 1;
            const ny = monthOne === 12 ? year + 1 : year;
            ukTargetCode = this.SOL_SCHEDULE[nm].nextCode;
            ukTargetYr = ny + this.SOL_SCHEDULE[nm].nextYr;
        }
        const ukTargetSym = this.formatContractSymbol(ukTargetCode, ukTargetYr);
        const ukTargetExp = this.getNymexContractExpiry(ukTargetYr, this._codeToMonthNum(ukTargetCode));

        return {
            date: dateStr,
            year,
            month: monthOne,
            day,
            isBusinessDay: isBday,
            businessDayIndex: bIndex,
            totalBusinessDays: totalBdays,
            US: {
                name: 'United States',
                tickers: 'BOIL / KOLD',
                leverage: '2x / -2x',
                benchmark: 'Bloomberg Natural Gas Subindex (BCOMNG)',
                holdings: usHoldings,
                targetContract: { sym: usTargetSym, code: usTargetCode, yr: usTargetYr, expiry: usTargetExp },
                phase: usPhase,
                phaseClass: usPhaseClass
            },
            CA: {
                name: 'Canada (TSX)',
                tickers: 'HNU.TO / HND.TO',
                leverage: '2x / -2x',
                benchmark: 'BetaPro Natural Gas Rolling Futures Index (CMDYNGER)',
                holdings: caHoldings,
                targetContract: { sym: caTargetSym, code: caTargetCode, yr: caTargetYr, expiry: caTargetExp },
                phase: caPhase,
                phaseClass: caPhaseClass
            },
            UK: {
                name: 'London (LSE)',
                tickers: '3NGL.L / 3NGS.L',
                leverage: '3x / -3x',
                benchmark: 'Solactive Natural Gas Commodity Futures SL Index (SOLWSNG2)',
                holdings: ukHoldings,
                targetContract: { sym: ukTargetSym, code: ukTargetCode, yr: ukTargetYr, expiry: ukTargetExp },
                phase: ukPhase,
                phaseClass: ukPhaseClass
            }
        };
    },

    _codeToMonthNum(code) {
        const map = { 'F': 1, 'G': 2, 'H': 3, 'J': 4, 'K': 5, 'M': 6, 'N': 7, 'Q': 8, 'U': 9, 'V': 10, 'X': 11, 'Z': 12 };
        return map[code] || 1;
    },

    /* Generates 12-Month Annual Forward Roadmap for any year */
    getAnnualRoadmap(year) {
        const months = [];
        for (let m = 1; m <= 12; m++) {
            const bDays = this.getMonthBusinessDays(year, m);
            // Mid-month check (after roll completes)
            const postRollDay = bDays.length >= 10 ? bDays[9] : bDays[bDays.length - 1];
            const midState = this.getHoldingForDate(year, m, postRollDay);

            // Roll window date strings
            const usCfg = this.BCOM_SCHEDULE[m];
            const startDay = bDays[0];
            const startState = this.getHoldingForDate(year, m, startDay);
            const startUS = startState.US.holdings[0].sym;
            const endUS = midState.US.holdings[midState.US.holdings.length - 1].sym;
            const usFlow = usCfg.rolls ? `${startUS} \u2192 ${endUS}` : `${startUS} (Held)`;

            const startCA = startState.CA.holdings[0].sym;
            const endCA = midState.CA.holdings[midState.CA.holdings.length - 1].sym;
            const caFlow = `${startCA} \u2192 ${endCA}`;

            const startUK = startState.UK.holdings[0].sym;
            const endUK = midState.UK.holdings[midState.UK.holdings.length - 1].sym;
            const ukFlow = `${startUK} \u2192 ${endUK}`;

            const usRoll = usCfg.rolls
                ? `Days 6–10 (${year}-${String(m).padStart(2,'0')}-${String(bDays[5]).padStart(2,'0')} to ${year}-${String(m).padStart(2,'0')}-${String(bDays[9]).padStart(2,'0')})`
                : 'None (Held)';

            const caRoll = `Days 4–7 (${year}-${String(m).padStart(2,'0')}-${String(bDays[3]).padStart(2,'0')} to ${year}-${String(m).padStart(2,'0')}-${String(bDays[6]).padStart(2,'0')})`;
            const ukRoll = `Days 5–9 (${year}-${String(m).padStart(2,'0')}-${String(bDays[4]).padStart(2,'0')} to ${year}-${String(m).padStart(2,'0')}-${String(bDays[8]).padStart(2,'0')})`;

            months.push({
                monthNum: m,
                monthName: this.MONTH_NAMES[m - 1],
                totalBdays: bDays.length,
                rollWindows: { US: usRoll, CA: caRoll, UK: ukRoll },
                flows: { US: usFlow, CA: caFlow, UK: ukFlow },
                holdingsSnapshot: {
                    US: midState.US.holdings,
                    CA: midState.CA.holdings,
                    UK: midState.UK.holdings
                }
            });
        }
        return months;
    },

    /* UI Rendering and Controller */
    state: {
        selectedYear: new Date().getUTCFullYear(),
        selectedMonth: new Date().getUTCMonth() + 1,
        selectedDay: new Date().getUTCDate(),
        activeViewTab: 'schedule' // 'schedule' | 'roadmap' | 'specs'
    },

    init(containerId) {
        const root = document.getElementById(containerId);
        if (!root) return;
        this._root = root;

        // Clamp day to valid days in month
        const maxDay = new Date(Date.UTC(this.state.selectedYear, this.state.selectedMonth, 0)).getUTCDate();
        if (this.state.selectedDay > maxDay) this.state.selectedDay = maxDay;

        this.render();
    },

    setYear(year) {
        this.state.selectedYear = Number(year);
        const maxDay = new Date(Date.UTC(this.state.selectedYear, this.state.selectedMonth, 0)).getUTCDate();
        if (this.state.selectedDay > maxDay) this.state.selectedDay = maxDay;
        this.render();
    },

    setMonth(monthOne) {
        this.state.selectedMonth = Number(monthOne);
        const maxDay = new Date(Date.UTC(this.state.selectedYear, this.state.selectedMonth, 0)).getUTCDate();
        if (this.state.selectedDay > maxDay) this.state.selectedDay = maxDay;
        this.render();
    },

    setDay(day) {
        this.updateScrub(day);
    },

    updateScrub(day) {
        const { selectedYear, selectedMonth } = this.state;
        const maxDaysInMonth = new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate();
        const curDay = Math.min(day, maxDaysInMonth);
        this.state.selectedDay = curDay;

        const snapshot = this.getHoldingForDate(selectedYear, selectedMonth, curDay);
        const fillPct = Math.round(((curDay - 1) / Math.max(1, maxDaysInMonth - 1)) * 100);

        const slider = document.getElementById('cl-day-slider');
        if (slider) {
            slider.value = curDay;
            slider.style.setProperty('--cl-fill-pct', fillPct + '%');
        }

        const dateDisplay = document.getElementById('cl-scrubber-date');
        if (dateDisplay) dateDisplay.textContent = snapshot.date;

        const bdayTag = document.getElementById('cl-scrubber-bday-tag');
        if (bdayTag) {
            bdayTag.textContent = snapshot.isBusinessDay
                ? `Trading Day ${snapshot.businessDayIndex} of ${snapshot.totalBusinessDays}`
                : 'Exchange Holiday / Weekend';
        }

        const datePick = document.getElementById('cl-date-picker');
        if (datePick) datePick.value = snapshot.date;

        const cardsWrap = document.getElementById('cl-jurisdiction-cards');
        if (cardsWrap) {
            cardsWrap.innerHTML = `
                ${this._renderJurisdictionCard(snapshot.US, 'us')}
                ${this._renderJurisdictionCard(snapshot.CA, 'ca')}
                ${this._renderJurisdictionCard(snapshot.UK, 'uk')}
            `;
        }

        if (this._root) {
            const prevRow = this._root.querySelector('.cl-table tbody tr.is-selected-day');
            if (prevRow) prevRow.classList.remove('is-selected-day');
            const newRow = this._root.querySelector(`.cl-table tbody tr[data-day="${curDay}"]`);
            if (newRow) newRow.classList.add('is-selected-day');
        }
    },

    setTab(tab) {
        this.state.activeViewTab = tab;
        this.render();
    },

    jumpToToday() {
        const now = new Date();
        this.state.selectedYear = now.getUTCFullYear();
        this.state.selectedMonth = now.getUTCMonth() + 1;
        this.state.selectedDay = now.getUTCDate();
        this.render();
    },

    render() {
        if (!this._root) return;

        const { selectedYear, selectedMonth, selectedDay, activeViewTab } = this.state;
        const maxDaysInMonth = new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate();
        const curDay = Math.min(selectedDay, maxDaysInMonth);
        const snapshot = this.getHoldingForDate(selectedYear, selectedMonth, curDay);

        const fillPct = Math.round(((curDay - 1) / Math.max(1, maxDaysInMonth - 1)) * 100);

        // Dynamic Year Options from 2018 to max(current + 10, 2035)
        const curUtcYear = new Date().getUTCFullYear();
        const minYear = 2018;
        const maxYear = Math.max(curUtcYear + 10, 2035);
        let yearOpts = '';
        for (let y = minYear; y <= maxYear; y++) {
            yearOpts += `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`;
        }

        // Build Month Options
        let monthOpts = '';
        for (let m = 1; m <= 12; m++) {
            monthOpts += `<option value="${m}" ${m === selectedMonth ? 'selected' : ''}>${this.MONTH_NAMES[m - 1]}</option>`;
        }

        // Dynamic Roll Windows for the Selected Month
        const bDays = this.getMonthBusinessDays(selectedYear, selectedMonth);
        const usCfg = this.BCOM_SCHEDULE[selectedMonth];
        const mShort = this.MONTH_NAMES[selectedMonth - 1].slice(0, 3);
        const caRollRange = bDays.length >= 7 
            ? `Days 4–7 (${mShort} ${bDays[3]} – ${bDays[6]})`
            : 'Trading Days 4–7';
        const ukRollRange = bDays.length >= 9
            ? `Days 5–9 (${mShort} ${bDays[4]} – ${bDays[8]})`
            : 'Business Days 5–9';
        const usRollRange = usCfg.rolls
            ? (bDays.length >= 10 ? `Days 6–10 (${mShort} ${bDays[5]} – ${bDays[9]})` : 'Business Days 6–10')
            : 'Odd Month · No Roll (Held Steady)';

        this._root.innerHTML = `
            <div class="contract-ledger-panel" id="cl-panel">
                <div class="cl-header">
                    <div class="cl-header-left">
                        <div class="cl-title-row">
                            <h2 class="cl-title">ETF Futures Contract Holding &amp; Roll Schedule Ledger</h2>
                            <span class="cl-badge">Regulatory Benchmark Schedule</span>
                        </div>
                        <div class="cl-desc">
                            Futures contract allocations and roll schedules across <strong>US (BOIL/KOLD)</strong>, <strong>Canada (HNU/HND)</strong>, and <strong>London (3NGL/3NGS)</strong>. Details contract tenors, active roll splits, and CME NYMEX settlement delivery dates.
                        </div>
                    </div>
                    <div class="cl-header-right">
                        <div class="cl-controls">
                            <select class="cl-select" id="cl-year-select" data-tooltip="Select calendar year">
                                ${yearOpts}
                            </select>
                            <select class="cl-select" id="cl-month-select" data-tooltip="Select calendar month">
                                ${monthOpts}
                            </select>
                            <input type="date" class="cl-input-date" id="cl-date-picker" value="${snapshot.date}" data-tooltip="Jump directly to any historical or future date">
                            <button class="cl-btn" id="cl-btn-today" data-tooltip="Jump to today's date">TODAY</button>
                            <button class="cl-btn" id="cl-btn-export" data-tooltip="Download full day-by-day contract holdings as CSV">Download CSV</button>
                        </div>
                    </div>
                </div>

                <div class="cl-scrubber-card">
                    <div class="cl-scrubber-top">
                        <span class="cl-scrubber-label">Day Scrubber &middot; ${this.MONTH_NAMES[selectedMonth - 1]} ${selectedYear}</span>
                        <div class="cl-scrubber-date-display">
                            <span id="cl-scrubber-date">${snapshot.date}</span>
                            <span class="cl-scrubber-bday-tag" id="cl-scrubber-bday-tag">
                                ${snapshot.isBusinessDay ? `Trading Day ${snapshot.businessDayIndex} of ${snapshot.totalBusinessDays}` : 'Exchange Holiday / Weekend'}
                            </span>
                        </div>
                    </div>
                    <div class="cl-milestone-strip">
                        <div class="cl-milestone-item">
                            <span class="cl-milestone-label">CA Roll Window:</span>
                            <span class="cl-milestone-val">${caRollRange}</span>
                        </div>
                        <div class="cl-milestone-item">
                            <span class="cl-milestone-label">UK Roll Window:</span>
                            <span class="cl-milestone-val">${ukRollRange}</span>
                        </div>
                        <div class="cl-milestone-item">
                            <span class="cl-milestone-label">US Roll Window:</span>
                            <span class="cl-milestone-val">${usRollRange}</span>
                        </div>
                    </div>
                    <div class="cl-slider-track-wrap">
                        <input type="range" id="cl-day-slider" min="1" max="${maxDaysInMonth}" value="${curDay}" style="--cl-fill-pct: ${fillPct}%;">
                    </div>
                    <div class="cl-slider-ticks">
                        <span>Day 1</span>
                        <span>Day 5</span>
                        <span>Day 10</span>
                        <span>Day 15</span>
                        <span>Day 20</span>
                        <span>Day 25</span>
                        <span>Day ${maxDaysInMonth}</span>
                    </div>
                </div>

                <div class="cl-jurisdiction-grid" id="cl-jurisdiction-cards">
                    ${this._renderJurisdictionCard(snapshot.US, 'us')}
                    ${this._renderJurisdictionCard(snapshot.CA, 'ca')}
                    ${this._renderJurisdictionCard(snapshot.UK, 'uk')}
                </div>

                <div class="cl-nav-tabs">
                    <button class="cl-tab-btn ${activeViewTab === 'schedule' ? 'active' : ''}" data-tab="schedule">Daily Schedule Table</button>
                    <button class="cl-tab-btn ${activeViewTab === 'roadmap' ? 'active' : ''}" data-tab="roadmap">Annual Contract Calendar</button>
                    <button class="cl-tab-btn ${activeViewTab === 'specs' ? 'active' : ''}" data-tab="specs">Benchmark Specifications</button>
                </div>

                <div id="cl-tab-body">
                    ${this._renderTabBody(snapshot, activeViewTab)}
                </div>
            </div>
        `;

        this._bindEvents();
    },

    _renderJurisdictionCard(jur, type) {
        const holdings = jur.holdings || [];
        const isSplit = holdings.length > 1;

        let allocationRowsHtml = '';
        let barTrackHtml = '';

        if (isSplit) {
            allocationRowsHtml = `
                <div class="cl-contract-row">
                    <span class="cl-contract-title">${this.formatContractLabel(holdings[0].code, holdings[0].yr)}</span>
                    <span class="cl-contract-pct">${holdings[0].pct}%</span>
                </div>
                <div class="cl-contract-row">
                    <span class="cl-contract-title">${this.formatContractLabel(holdings[1].code, holdings[1].yr)}</span>
                    <span class="cl-contract-pct">${holdings[1].pct}%</span>
                </div>
            `;
            barTrackHtml = `
                <div class="cl-contract-bar-track">
                    <div class="cl-contract-bar-lead" style="width:${holdings[0].pct}%;"></div>
                    <div class="cl-contract-bar-next" style="width:${holdings[1].pct}%;"></div>
                </div>
            `;
        } else {
            const h = holdings[0] || { code: 'H', yr: 2025, pct: 100, expiry: '' };
            const target = jur.targetContract;
            const targetLabel = target ? `Roll Target: ${this.formatContractLabel(target.code, target.yr)}` : 'Secondary Allocation';
            allocationRowsHtml = `
                <div class="cl-contract-row">
                    <span class="cl-contract-title">${this.formatContractLabel(h.code, h.yr)}</span>
                    <span class="cl-contract-pct">${h.pct}%</span>
                </div>
                <div class="cl-contract-row cl-row-sub">
                    <span class="cl-contract-title cl-muted">${targetLabel}</span>
                    <span class="cl-contract-pct cl-muted">0%</span>
                </div>
            `;
            const isPost = (jur.phaseClass && jur.phaseClass.includes('status-postroll'));
            barTrackHtml = `
                <div class="cl-contract-bar-track">
                    <div class="${isPost ? 'cl-contract-bar-next' : 'cl-contract-bar-lead'}" style="width:100%;"></div>
                </div>
            `;
        }

        const primaryH = holdings[0];
        const nextH = isSplit ? holdings[1] : jur.targetContract;
        const primaryExp = primaryH ? primaryH.expiry : 'N/A';
        const nextExp = nextH ? nextH.expiry : 'N/A';

        const tickerLong = jur.tickers.split('/')[0].trim();
        const tickerShort = jur.tickers.split('/')[1].trim();

        return `
            <div class="cl-jurisdiction-card cl-card-${type}">
                <div class="cl-card-header">
                    <div class="cl-card-top-row">
                        <span class="cl-jurisdiction-name">${jur.name}</span>
                        <span class="cl-status-pill ${jur.phaseClass}">${jur.phase}</span>
                    </div>
                    <div class="cl-etf-pair">
                        <span class="cl-ticker-long">${tickerLong}</span>
                        <span class="cl-ticker-sep">/</span>
                        <span class="cl-ticker-short">${tickerShort}</span>
                        <span class="cl-lev-badge">${jur.leverage}</span>
                    </div>
                </div>

                <div class="cl-contract-allocation-wrap">
                    ${allocationRowsHtml}
                    ${barTrackHtml}
                </div>

                <div class="cl-contract-details-grid">
                    <div class="cl-detail-item">
                        <span class="cl-detail-label">Primary NYMEX Expiry</span>
                        <span class="cl-detail-val expiry">${primaryExp}</span>
                    </div>
                    <div class="cl-detail-item">
                        <span class="cl-detail-label">Next NYMEX Expiry</span>
                        <span class="cl-detail-val">${nextExp}</span>
                    </div>
                </div>

                <div class="cl-index-meta">
                    <strong>Benchmark:</strong> ${jur.benchmark}
                </div>
            </div>
        `;
    },

    _renderTabBody(snapshot, tab) {
        if (tab === 'schedule') {
            return this._renderScheduleTable(snapshot.year, snapshot.month, snapshot.day);
        } else if (tab === 'roadmap') {
            return this._renderRoadmapGrid(snapshot.year, snapshot.month);
        } else if (tab === 'specs') {
            return this._renderSpecsAccordion();
        }
        return '';
    },

    _renderScheduleTable(year, monthOne, selectedDay) {
        const bDays = this.getMonthBusinessDays(year, monthOne);
        let rowsHtml = '';

        bDays.forEach((d, idx) => {
            const bIndex = idx + 1;
            const state = this.getHoldingForDate(year, monthOne, d);
            const isSel = (d === selectedDay);

            const formatHoldingPill = (hList, chipCls) => {
                if (hList.length === 1) {
                    return `<span class="cl-badge-chip ${chipCls}">${hList[0].sym} (100%)</span>`;
                }
                return `<span class="cl-badge-chip ${chipCls}">${hList[0].sym} (${hList[0].pct}%) &middot; ${hList[1].sym} (${hList[1].pct}%)</span>`;
            };

            const usPill = formatHoldingPill(state.US.holdings, 'chip-us');
            const caPill = formatHoldingPill(state.CA.holdings, 'chip-ca');
            const ukPill = formatHoldingPill(state.UK.holdings, 'chip-uk');

            rowsHtml += `
                <tr class="${isSel ? 'is-selected-day' : ''}" data-day="${d}">
                    <td class="cl-table-date-col">${state.date}</td>
                    <td><strong>Day ${bIndex}</strong> / ${state.totalBusinessDays}</td>
                    <td>${usPill}</td>
                    <td><span class="cl-status-pill ${state.US.phaseClass}">${state.US.phase}</span></td>
                    <td>${caPill}</td>
                    <td><span class="cl-status-pill ${state.CA.phaseClass}">${state.CA.phase}</span></td>
                    <td>${ukPill}</td>
                    <td><span class="cl-status-pill ${state.UK.phaseClass}">${state.UK.phase}</span></td>
                </tr>
            `;
        });

        return `
            <div class="cl-table-wrap">
                <table class="cl-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Trading Day</th>
                            <th>US (BOIL/KOLD) Holdings</th>
                            <th>US Status</th>
                            <th>CA (HNU/HND) Holdings</th>
                            <th>CA Status</th>
                            <th>UK (3NGL/3NGS) Holdings</th>
                            <th>UK Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    },

    _renderRoadmapGrid(year, selectedMonth) {
        const roadmap = this.getAnnualRoadmap(year);
        let cardsHtml = '';

        roadmap.forEach(m => {
            const isActive = (m.monthNum === selectedMonth);
            cardsHtml += `
                <div class="cl-roadmap-month-card ${isActive ? 'active-month' : ''}" data-month="${m.monthNum}">
                    <div class="cl-rm-head">
                        <span class="cl-rm-month-name">${m.monthName}</span>
                        <span class="cl-rm-roll-window">${m.totalBdays} B-Days</span>
                    </div>
                    <div class="cl-rm-pair-row">
                        <span class="cl-rm-pair-label">US (BOIL/KOLD):</span>
                        <span class="cl-rm-contract-tag">${m.flows.US}</span>
                    </div>
                    <div class="cl-rm-pair-row">
                        <span class="cl-rm-pair-label">CA (HNU/HND):</span>
                        <span class="cl-rm-contract-tag">${m.flows.CA}</span>
                    </div>
                    <div class="cl-rm-pair-row">
                        <span class="cl-rm-pair-label">UK (3NGL/3NGS):</span>
                        <span class="cl-rm-contract-tag">${m.flows.UK}</span>
                    </div>
                </div>
            `;
        });

        return `
            <div class="cl-roadmap-grid">
                ${cardsHtml}
            </div>
        `;
    },

    _renderSpecsAccordion() {
        return `
            <div class="cl-specs-accordion">
                <div class="cl-specs-title">Regulatory Benchmarks &amp; Contract Specifications</div>
                <div class="cl-specs-grid">
                    <div class="cl-spec-box">
                        <div class="cl-spec-head">US: ProShares BOIL &amp; KOLD</div>
                        <div class="cl-spec-line"><strong>Issuer:</strong> ProShares Trust II (CIK: 0001415311)</div>
                        <div class="cl-spec-line"><strong>Benchmark:</strong> Bloomberg Natural Gas Subindex (BCOMNG)</div>
                        <div class="cl-spec-line"><strong>Leverage:</strong> 2x Daily Long (BOIL) / -2x Daily Short (KOLD)</div>
                        <div class="cl-spec-line"><strong>Roll Schedule:</strong> Bimonthly in even months (Feb, Apr, Jun, Aug, Oct, Dec) across <strong>Business Days 6 through 10</strong> at 20% per day.</div>
                        <div class="cl-spec-line"><strong>Odd Months:</strong> No roll occurs. Position held 100% in designated lead future.</div>
                        <div class="cl-spec-line"><strong>Regulatory Filing:</strong> SEC Form 10-K &amp; Form 424B3 Prospectus.</div>
                    </div>

                    <div class="cl-spec-box">
                        <div class="cl-spec-head">Canada: Global X HNU &amp; HND</div>
                        <div class="cl-spec-line"><strong>Issuer:</strong> Global X Investments Canada Inc. (TSX)</div>
                        <div class="cl-spec-line"><strong>Benchmark:</strong> BetaPro Natural Gas Rolling Futures Index (CMDYNGER)</div>
                        <div class="cl-spec-line"><strong>Leverage:</strong> 2x Daily Bull (HNU) / -2x Daily Bear (HND)</div>
                        <div class="cl-spec-line"><strong>Roll Schedule:</strong> Monthly roll across <strong>Trading Days 4 through 7</strong> at 25% per day (75/25, 50/50, 25/75, 100%).</div>
                        <div class="cl-spec-line"><strong>Curve Tenor:</strong> Tracks prompt/front-month contract, rolling into next month right before front expiry.</div>
                        <div class="cl-spec-line"><strong>Governing Document:</strong> Global X Index Methodology (Effective Aug 15, 2024).</div>
                    </div>

                    <div class="cl-spec-box">
                        <div class="cl-spec-head">London: WisdomTree 3NGL &amp; 3NGS</div>
                        <div class="cl-spec-line"><strong>Issuer:</strong> WisdomTree Commodity Securities Limited (LSE)</div>
                        <div class="cl-spec-line"><strong>Benchmark:</strong> Solactive Natural Gas Commodity Futures SL Index (SOLWSNG2)</div>
                        <div class="cl-spec-line"><strong>Leverage:</strong> 3x Daily Leveraged (3NGL) / -3x Daily Short (3NGS)</div>
                        <div class="cl-spec-line"><strong>Roll Schedule:</strong> Monthly roll across <strong>Business Days 5 through 9</strong> at 20% per day (SFMC = 2).</div>
                        <div class="cl-spec-line"><strong>Curve Tenor:</strong> Tracks the 2nd front-month NYMEX contract, maintaining longer duration along the curve.</div>
                        <div class="cl-spec-line"><strong>Governing Document:</strong> Solactive Commodity Futures Guideline (ISIN: DE000SL0BLN2).</div>
                    </div>
                </div>
            </div>
        `;
    },

    _bindEvents() {
        // Year Select
        const yrSel = document.getElementById('cl-year-select');
        if (yrSel) {
            yrSel.addEventListener('change', (e) => this.setYear(e.target.value));
        }

        // Month Select
        const mSel = document.getElementById('cl-month-select');
        if (mSel) {
            mSel.addEventListener('change', (e) => this.setMonth(e.target.value));
        }

        // Direct Date Picker
        const datePick = document.getElementById('cl-date-picker');
        if (datePick) {
            datePick.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val) {
                    const parts = val.split('-');
                    if (parts.length === 3) {
                        const y = parseInt(parts[0], 10);
                        const m = parseInt(parts[1], 10);
                        const d = parseInt(parts[2], 10);
                        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                            this.state.selectedYear = y;
                            this.state.selectedMonth = m;
                            this.state.selectedDay = d;
                            this.render();
                        }
                    }
                }
            });
        }

        // Today Button
        const todayBtn = document.getElementById('cl-btn-today');
        if (todayBtn) {
            todayBtn.addEventListener('click', () => this.jumpToToday());
        }

        // Export CSV Button
        const expBtn = document.getElementById('cl-btn-export');
        if (expBtn) {
            expBtn.addEventListener('click', () => this.exportCsv());
        }

        // Day Slider
        const slider = document.getElementById('cl-day-slider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                this.updateScrub(Number(e.target.value));
            });
        }

        // Tab Buttons
        const tabBtns = this._root.querySelectorAll('.cl-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.getAttribute('data-tab');
                if (tab) this.setTab(tab);
            });
        });

        // Roadmap Month Cards click
        const rmCards = this._root.querySelectorAll('.cl-roadmap-month-card');
        rmCards.forEach(card => {
            card.addEventListener('click', () => {
                const m = Number(card.getAttribute('data-month'));
                if (m) {
                    this.state.selectedMonth = m;
                    this.state.activeViewTab = 'schedule';
                    this.render();
                }
            });
        });

        // Table Rows click to scrub day
        const tableRows = this._root.querySelectorAll('.cl-table tbody tr');
        tableRows.forEach(row => {
            row.addEventListener('click', () => {
                const d = Number(row.getAttribute('data-day'));
                if (d) {
                    this.setDay(d);
                }
            });
        });
    },

    exportCsv() {
        const { selectedYear, selectedMonth } = this.state;
        const bDays = this.getMonthBusinessDays(selectedYear, selectedMonth);

        let csv = 'Date,TradingDay,TotalTradingDays,BOIL_KOLD_Holdings,US_Status,HNU_HND_Holdings,CA_Status,3NGL_3NGS_Holdings,UK_Status\n';

        bDays.forEach((d, idx) => {
            const state = this.getHoldingForDate(selectedYear, selectedMonth, d);
            const usHold = state.US.holdings.map(h => `${h.sym}:${h.pct}%`).join(';');
            const caHold = state.CA.holdings.map(h => `${h.sym}:${h.pct}%`).join(';');
            const ukHold = state.UK.holdings.map(h => `${h.sym}:${h.pct}%`).join(';');

            csv += `${state.date},${idx + 1},${state.totalBusinessDays},"${usHold}","${state.US.phase}","${caHold}","${state.CA.phase}","${ukHold}","${state.UK.phase}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `NATGAS_ETF_Contract_Ledger_${selectedYear}_${String(selectedMonth).padStart(2,'0')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContractLedger;
}
