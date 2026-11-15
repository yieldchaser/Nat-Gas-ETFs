/**
 * Automated Test Suite for Natural Gas ETF Contract Holding & Roll Schedule Ledger
 * Tests mathematical rigor, holiday calendars, roll phases, and contract tenors.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ContractLedger = require('../docs/js/contract-ledger.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`[PASS] ${testName}`);
    } else {
        failedTests++;
        console.error(`[FAIL] ${testName} - ${details}`);
    }
}

console.log('================================================================');
console.log('TEST SUITE: NAT GAS ETF CONTRACT LEDGER MATHEMATICAL INTEGRITY');
console.log('================================================================\n');

// Test 1: Holiday engine & business day counting
{
    const bDays2025Jan = ContractLedger.getMonthBusinessDays(2025, 1);
    // Jan 2025 has 31 days. Weekends: Jan 4-5, 11-12, 18-19, 25-26 (8 days).
    // Holidays: Jan 1 (New Year), Jan 20 (MLK Day).
    // Total business days = 31 - 8 - 2 = 21.
    assert(bDays2025Jan.length === 21, '2025-01 Business Day Count', `Expected 21, got ${bDays2025Jan.length}`);
    assert(!ContractLedger.isUsBusinessDay(2025, 1, 1), '2025-01-01 is Holiday (New Year)');
    assert(!ContractLedger.isUsBusinessDay(2025, 1, 20), '2025-01-20 is Holiday (MLK Day)');
    assert(ContractLedger.isUsBusinessDay(2025, 1, 2), '2025-01-02 is Business Day');
}

// Test 2: NYMEX Natural Gas Contract Expiration (CME Rule 220)
// Trading terminates 3 business days prior to the 1st calendar day of delivery month.
{
    // March 2025 contract (NGH25): Expiry in Feb 2025
    // Feb 2025 has 28 days. Weekends: Feb 1-2, 8-9, 15-16, 22-23 (8 days).
    // Holiday: Feb 17 (Presidents Day).
    // Business days in Feb 2025 = 28 - 8 - 1 = 19.
    // 3rd business day from end: Feb 28 (1st), Feb 27 (2nd), Feb 26 (3rd from end).
    const expH25 = ContractLedger.getNymexContractExpiry(2025, 3);
    assert(expH25 === '2025-02-26', 'NGH25 Expiry adheres to CME Rule 220', `Expected 2025-02-26, got ${expH25}`);

    // April 2025 contract (NGJ25): Expiry in Mar 2025
    // Mar 2025 has 31 days. No federal holidays in March.
    // Mar 31 is Monday. Mar 30, 29 weekend. Mar 28 is Friday (2nd from end). Mar 27 is Thursday (3rd from end).
    const expJ25 = ContractLedger.getNymexContractExpiry(2025, 4);
    assert(expJ25 === '2025-03-27', 'NGJ25 Expiry adheres to CME Rule 220', `Expected 2025-03-27, got ${expJ25}`);
}

// Test 3: Weight summation invariance across all days in 2024, 2025, 2026, 2027
{
    let weightSumErrors = 0;
    const testYears = [2024, 2025, 2026, 2027];
    for (const yr of testYears) {
        for (let m = 1; m <= 12; m++) {
            const daysInMonth = new Date(Date.UTC(yr, m, 0)).getUTCDate();
            for (let d = 1; d <= daysInMonth; d++) {
                const holding = ContractLedger.getHoldingForDate(yr, m, d);
                const sumUS = holding.US.holdings.reduce((acc, h) => acc + h.pct, 0);
                const sumCA = holding.CA.holdings.reduce((acc, h) => acc + h.pct, 0);
                const sumUK = holding.UK.holdings.reduce((acc, h) => acc + h.pct, 0);
                if (sumUS !== 100 || sumCA !== 100 || sumUK !== 100) {
                    weightSumErrors++;
                }
            }
        }
    }
    assert(weightSumErrors === 0, 'Weight Sum Invariance (All days 2024-2027 = exactly 100%)', `Found ${weightSumErrors} violations`);
}

// Test 4: Roll schedule and weights for Canada (CMDYNGER: Days 4 to 7, 25%/day)
{
    // January 2025:
    // bDays: [2, 3, 6, 7, 8, 9, 10, ...]
    // Day 1 (Jan 2): 100% NGG25 (Feb)
    // Day 2 (Jan 3): 100% NGG25 (Feb)
    // Day 3 (Jan 6): 100% NGG25 (Feb)
    // Day 4 (Jan 7): 75% NGG25 / 25% NGH25
    // Day 5 (Jan 8): 50% NGG25 / 50% NGH25
    // Day 6 (Jan 9): 25% NGG25 / 75% NGH25
    // Day 7 (Jan 10): 100% NGH25 (Mar)
    const hJan2 = ContractLedger.getHoldingForDate(2025, 1, 2);
    assert(hJan2.CA.holdings[0].sym === 'NGG25' && hJan2.CA.holdings[0].pct === 100, 'CA Jan 2: 100% NGG25');

    const hJan7 = ContractLedger.getHoldingForDate(2025, 1, 7);
    assert(hJan7.CA.holdings.length === 2 && hJan7.CA.holdings[0].pct === 75 && hJan7.CA.holdings[1].pct === 25, 'CA Jan 7 (Day 4): 75% NGG25 / 25% NGH25');

    const hJan8 = ContractLedger.getHoldingForDate(2025, 1, 8);
    assert(hJan8.CA.holdings.length === 2 && hJan8.CA.holdings[0].pct === 50 && hJan8.CA.holdings[1].pct === 50, 'CA Jan 8 (Day 5): 50% NGG25 / 50% NGH25');

    const hJan9 = ContractLedger.getHoldingForDate(2025, 1, 9);
    assert(hJan9.CA.holdings.length === 2 && hJan9.CA.holdings[0].pct === 25 && hJan9.CA.holdings[1].pct === 75, 'CA Jan 9 (Day 6): 25% NGG25 / 75% NGH25');

    const hJan10 = ContractLedger.getHoldingForDate(2025, 1, 10);
    assert(hJan10.CA.holdings.length === 1 && hJan10.CA.holdings[0].sym === 'NGH25' && hJan10.CA.holdings[0].pct === 100, 'CA Jan 10 (Day 7): 100% NGH25');
}

// Test 5: Roll schedule and weights for London (SOLWSNG2: Days 5 to 9, 20%/day)
{
    // January 2025:
    // Day 4 (Jan 7): 100% NGH25 (SFMC=2, 2nd front-month is Mar)
    // Day 5 (Jan 8): 80% NGH25 / 20% NGJ25
    // Day 6 (Jan 9): 60% NGH25 / 40% NGJ25
    // Day 7 (Jan 10): 40% NGH25 / 60% NGJ25
    // Day 8 (Jan 13): 20% NGH25 / 80% NGJ25
    // Day 9 (Jan 14): 100% NGJ25
    const ukJan7 = ContractLedger.getHoldingForDate(2025, 1, 7);
    assert(ukJan7.UK.holdings[0].sym === 'NGH25' && ukJan7.UK.holdings[0].pct === 100, 'UK Jan 7 (Day 4): 100% NGH25');

    const ukJan8 = ContractLedger.getHoldingForDate(2025, 1, 8);
    assert(ukJan8.UK.holdings.length === 2 && ukJan8.UK.holdings[0].pct === 80 && ukJan8.UK.holdings[1].pct === 20, 'UK Jan 8 (Day 5): 80% NGH25 / 20% NGJ25');

    const ukJan9 = ContractLedger.getHoldingForDate(2025, 1, 9);
    assert(ukJan9.UK.holdings.length === 2 && ukJan9.UK.holdings[0].pct === 60 && ukJan9.UK.holdings[1].pct === 40, 'UK Jan 9 (Day 6): 60% NGH25 / 40% NGJ25');

    const ukJan10 = ContractLedger.getHoldingForDate(2025, 1, 10);
    assert(ukJan10.UK.holdings.length === 2 && ukJan10.UK.holdings[0].pct === 40 && ukJan10.UK.holdings[1].pct === 60, 'UK Jan 10 (Day 7): 40% NGH25 / 60% NGJ25');

    const ukJan13 = ContractLedger.getHoldingForDate(2025, 1, 13);
    assert(ukJan13.UK.holdings.length === 2 && ukJan13.UK.holdings[0].pct === 20 && ukJan13.UK.holdings[1].pct === 80, 'UK Jan 13 (Day 8): 20% NGH25 / 80% NGJ25');

    const ukJan14 = ContractLedger.getHoldingForDate(2025, 1, 14);
    assert(ukJan14.UK.holdings.length === 1 && ukJan14.UK.holdings[0].sym === 'NGJ25' && ukJan14.UK.holdings[0].pct === 100, 'UK Jan 14 (Day 9): 100% NGJ25');
}

// Test 6: Roll schedule and weights for US (BCOMNG: Even months only, Days 6 to 10, 20%/day)
{
    // January 2025 (Odd month): No roll! Steady holding NGH25 (Mar)
    const usJan5 = ContractLedger.getHoldingForDate(2025, 1, 8);
    assert(usJan5.US.holdings.length === 1 && usJan5.US.holdings[0].sym === 'NGH25' && usJan5.US.phase === 'HELD (Odd Month · No Roll)', 'US Jan: Steady holding NGH25 (no roll in odd month)');

    // February 2025 (Even month): Rolls NGH25 into NGK25 (May) across Business Days 6 to 10
    // Feb business days: Feb 3 (D1), 4 (D2), 5 (D3), 6 (D4), 7 (D5), 10 (D6), 11 (D7), 12 (D8), 13 (D9), 14 (D10)
    const usFeb10 = ContractLedger.getHoldingForDate(2025, 2, 10);
    assert(usFeb10.US.holdings.length === 2 && usFeb10.US.holdings[0].pct === 80 && usFeb10.US.holdings[1].pct === 20, 'US Feb 10 (Day 6): 80% NGH25 / 20% NGK25');

    const usFeb11 = ContractLedger.getHoldingForDate(2025, 2, 11);
    assert(usFeb11.US.holdings.length === 2 && usFeb11.US.holdings[0].pct === 60 && usFeb11.US.holdings[1].pct === 40, 'US Feb 11 (Day 7): 60% NGH25 / 40% NGK25');

    const usFeb12 = ContractLedger.getHoldingForDate(2025, 2, 12);
    assert(usFeb12.US.holdings.length === 2 && usFeb12.US.holdings[0].pct === 40 && usFeb12.US.holdings[1].pct === 60, 'US Feb 12 (Day 8): 40% NGH25 / 60% NGK25');

    const usFeb13 = ContractLedger.getHoldingForDate(2025, 2, 13);
    assert(usFeb13.US.holdings.length === 2 && usFeb13.US.holdings[0].pct === 20 && usFeb13.US.holdings[1].pct === 80, 'US Feb 13 (Day 9): 20% NGH25 / 80% NGK25');

    const usFeb14 = ContractLedger.getHoldingForDate(2025, 2, 14);
    assert(usFeb14.US.holdings.length === 1 && usFeb14.US.holdings[0].sym === 'NGK25' && usFeb14.US.holdings[0].pct === 100, 'US Feb 14 (Day 10): 100% NGK25');
}

// Test 7: Intra-month divergence confirmation (The exact phenomenon requested by the user)
{
    // On Jan 15, 2025:
    // CA has rolled to NGH25 (Mar)
    // US is holding NGH25 (Mar)
    // UK has rolled to NGJ25 (Apr)
    const midJan = ContractLedger.getHoldingForDate(2025, 1, 15);
    assert(midJan.CA.holdings[0].sym === 'NGH25', 'Jan 15 CA holds NGH25');
    assert(midJan.US.holdings[0].sym === 'NGH25', 'Jan 15 US holds NGH25');
    assert(midJan.UK.holdings[0].sym === 'NGJ25', 'Jan 15 UK holds NGJ25');

    // On Feb 20, 2025:
    // CA has rolled to NGJ25 (Apr)
    // US has rolled to NGK25 (May)
    // UK has rolled to NGK25 (May)
    const lateFeb = ContractLedger.getHoldingForDate(2025, 2, 20);
    assert(lateFeb.CA.holdings[0].sym === 'NGJ25', 'Feb 20 CA holds NGJ25');
    assert(lateFeb.US.holdings[0].sym === 'NGK25', 'Feb 20 US holds NGK25');
    assert(lateFeb.UK.holdings[0].sym === 'NGK25', 'Feb 20 UK holds NGK25');
}

// Test 8: Future lookahead into 2026 and 2027
{
    const nov2026 = ContractLedger.getHoldingForDate(2026, 11, 20);
    assert(nov2026.US.holdings[0].sym === 'NGF27', 'Nov 20 2026 US holds NGF27 (Jan 2027)');
    assert(nov2026.CA.holdings[0].sym === 'NGF27', 'Nov 20 2026 CA holds NGF27 (Jan 2027)');
    assert(nov2026.UK.holdings[0].sym === 'NGG27', 'Nov 20 2026 UK holds NGG27 (Feb 2027)');
}

// Test 9: Historical KOLD Trough Verification (Jan 9, 2024 and Feb 9, 2024)
{
    const jan9 = ContractLedger.getHoldingForDate(2024, 1, 9);
    assert(jan9.US.holdings[0].sym === 'NGH24' && jan9.US.holdings[0].pct === 100, 'Jan 9 2024: US held 100% NGH24');
    assert(jan9.CA.holdings[0].sym === 'NGG24' && jan9.CA.holdings[0].pct === 25, 'Jan 9 2024: CA active roll 25% NGG24');
    assert(jan9.CA.holdings[1].sym === 'NGH24' && jan9.CA.holdings[1].pct === 75, 'Jan 9 2024: CA active roll 75% NGH24');
    assert(jan9.UK.holdings[0].sym === 'NGH24' && jan9.UK.holdings[0].pct === 60, 'Jan 9 2024: UK active roll 60% NGH24');
    assert(jan9.UK.holdings[1].sym === 'NGJ24' && jan9.UK.holdings[1].pct === 40, 'Jan 9 2024: UK active roll 40% NGJ24');

    const feb9 = ContractLedger.getHoldingForDate(2024, 2, 9);
    assert(feb9.US.holdings[0].sym === 'NGH24' && feb9.US.holdings[0].pct === 60, 'Feb 9 2024: US active roll 60% NGH24');
    assert(feb9.US.holdings[1].sym === 'NGK24' && feb9.US.holdings[1].pct === 40, 'Feb 9 2024: US active roll 40% NGK24');
    assert(feb9.CA.holdings[0].sym === 'NGJ24' && feb9.CA.holdings[0].pct === 100, 'Feb 9 2024: CA post-roll 100% NGJ24');
    assert(feb9.UK.holdings[0].sym === 'NGJ24' && feb9.UK.holdings[0].pct === 40, 'Feb 9 2024: UK active roll 40% NGJ24');
    assert(feb9.UK.holdings[1].sym === 'NGK24' && feb9.UK.holdings[1].pct === 60, 'Feb 9 2024: UK active roll 60% NGK24');
}

// Test 10: Dynamic Calendar & Juneteenth Historical Law Transition
{
    // 2020-06-19 was a Friday before federal law enactment: MUST be a trading business day
    assert(ContractLedger.isUsBusinessDay(2020, 6, 19), '2020-06-19 is a business day (Pre-Juneteenth holiday)');
    // 2024-06-19 was a Wednesday after enactment: MUST be a holiday
    assert(!ContractLedger.isUsBusinessDay(2024, 6, 19), '2024-06-19 is an observed holiday (Juneteenth)');
}

// Test 11: Annual Roadmap Contract Flows across 2020, 2025, 2030
{
    const rm2025 = ContractLedger.getAnnualRoadmap(2025);
    assert(rm2025.length === 12, '2025 roadmap returns 12 months');
    // Jan 2025: US Held, CA rolled G->H, UK rolled H->J
    assert(rm2025[0].flows.US === 'NGH25 (Held)', '2025 Jan US Flow: NGH25 (Held)');
    assert(rm2025[0].flows.CA === 'NGG25 \u2192 NGH25', '2025 Jan CA Flow: NGG25 -> NGH25');
    assert(rm2025[0].flows.UK === 'NGH25 \u2192 NGJ25', '2025 Jan UK Flow: NGH25 -> NGJ25');
    // Feb 2025: US rolled H->K, CA rolled H->J, UK rolled J->K
    assert(rm2025[1].flows.US === 'NGH25 \u2192 NGK25', '2025 Feb US Flow: NGH25 -> NGK25');
    assert(rm2025[1].flows.CA === 'NGH25 \u2192 NGJ25', '2025 Feb CA Flow: NGH25 -> NGJ25');
    assert(rm2025[1].flows.UK === 'NGJ25 \u2192 NGK25', '2025 Feb UK Flow: NGJ25 -> NGK25');
}

// Test 12: Target Contract & Expiry Verification for KPI Cards
{
    // US in Jan (no-roll odd month): holds NGH25, next target is NGK25
    const usJan = ContractLedger.getHoldingForDate(2025, 1, 15);
    assert(usJan.US.targetContract.sym === 'NGK25', 'US Jan next roll target is NGK25', `Got ${usJan.US.targetContract.sym}`);
    assert(usJan.US.targetContract.expiry === '2025-04-28', 'US Jan next target expiry is 2025-04-28', `Got ${usJan.US.targetContract.expiry}`);

    // US in Feb post-roll (Day 11, Feb 18): holds NGK25, next target is NGN25
    const usFebPost = ContractLedger.getHoldingForDate(2025, 2, 18);
    assert(usFebPost.US.targetContract.sym === 'NGN25', 'US Feb post-roll next target is NGN25', `Got ${usFebPost.US.targetContract.sym}`);
    assert(usFebPost.US.targetContract.expiry === '2025-06-26', 'US Feb post-roll next target expiry is 2025-06-26', `Got ${usFebPost.US.targetContract.expiry}`);

    // Canada in Feb post-roll (Day 7, Feb 11): holds NGJ25, next target is NGK25
    const caFebPost = ContractLedger.getHoldingForDate(2025, 2, 11);
    assert(caFebPost.CA.targetContract.sym === 'NGK25', 'CA Feb post-roll next target is NGK25', `Got ${caFebPost.CA.targetContract.sym}`);
    assert(caFebPost.CA.targetContract.expiry === '2025-04-28', 'CA Feb post-roll next target expiry is 2025-04-28', `Got ${caFebPost.CA.targetContract.expiry}`);

    // London in Feb post-roll (Day 10, Feb 14): holds NGK25, next target is NGM25
    const ukFebPost = ContractLedger.getHoldingForDate(2025, 2, 14);
    assert(ukFebPost.UK.targetContract.sym === 'NGM25', 'UK Feb post-roll next target is NGM25', `Got ${ukFebPost.UK.targetContract.sym}`);
    assert(ukFebPost.UK.targetContract.expiry === '2025-05-28', 'UK Feb post-roll next target expiry is 2025-05-28', `Got ${ukFebPost.UK.targetContract.expiry}`);
}

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
console.log('================================================================');

if (failedTests > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
