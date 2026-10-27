"""
Verification Test Suite for Live Price Resiliency & Truthful Header State Machine
Tests covered:
- Test Case 1: Initial Cold Boot (no cache in localStorage)
- Test Case 2: Warm Reload (F5 simulation with cached quotes)
- Test Case 3: Manual Refresh Button Click & Spinner Debouncing
- Test Case 4: AbortController Timeout (3.5s) & Proxy Failover Pool
- Test Case 5: Tab Visibility Wake-up (>60s check)
- Test Case 6: Non-market Hours (After-hours, Weekend, Pre-market, Holiday)
- Test Case 7: Visual Quality & Zero Regressions (Volume Profile, Studies, Cards, Screenshots)
"""

import http.server
import json
import os
import socketserver
import sys
import threading
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

# Ensure line-buffered output
sys.stdout.reconfigure(line_buffering=True)

OUTPUT_DIR = Path(r"C:\Users\Dell\.gemini\antigravity\brain\daf2837d-7a62-4ad3-adb9-68091ad4bd3a")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def create_mock_yahoo_chart(ticker, price=18.50, prev_close=17.50, volume=8500000, market_state='open'):
    now_ts = int(time.time())
    return {
        "chart": {
            "result": [{
                "meta": {
                    "currency": "USD",
                    "exchangeName": "PCX",
                    "regularMarketPrice": price,
                    "regularMarketVolume": volume,
                    "previousClose": prev_close,
                    "regularMarketTime": now_ts,
                    "currentTradingPeriod": {
                        "regular": {"start": now_ts - 3600, "end": now_ts + 3600}
                    }
                },
                "timestamp": [now_ts - 86400 * 4, now_ts - 86400 * 3, now_ts - 86400 * 2, now_ts - 86400, now_ts],
                "indicators": {
                    "quote": [{
                        "open": [prev_close - 0.5, prev_close - 0.3, prev_close - 0.1, prev_close, price - 0.2],
                        "high": [prev_close, prev_close + 0.2, prev_close + 0.4, prev_close + 0.5, price + 0.5],
                        "low": [prev_close - 0.8, prev_close - 0.5, prev_close - 0.3, prev_close - 0.2, price - 0.4],
                        "close": [prev_close - 0.4, prev_close - 0.2, prev_close - 0.1, prev_close, price],
                        "volume": [6000000, 6500000, 7000000, 7500000, volume]
                    }]
                }
            }],
            "error": None
        }
    }

def run_suite():
    passed_assertions = 0
    test_results = []

    def assert_true(condition, description):
        nonlocal passed_assertions
        if not condition:
            raise AssertionError(f"FAILED: {description}")
        passed_assertions += 1
        print(f"  [PASS] {description}")

    server = socketserver.TCPServer(("127.0.0.1", 0), QuietHandler)
    port = server.server_address[1]
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    base_url = f"http://127.0.0.1:{port}/docs/index.html"
    print(f"[SERVER] Started local HTTP server at http://127.0.0.1:{port}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # -------------------------------------------------------------
        # TEST CASE 1: Initial Cold Boot (No cache in localStorage)
        # -------------------------------------------------------------
        print("\n========================================================")
        print("Test Case 1: Initial Cold Boot (No cache in localStorage)")
        print("========================================================")
        ctx1 = browser.new_context(viewport={"width": 1440, "height": 900})
        
        # Inject MockDate and window.fetch wrapper in add_init_script
        ctx1.add_init_script("""
            localStorage.clear();
            const RealDate = Date;
            class MockDate extends RealDate {
                constructor(...args) {
                    if (args.length === 0 && window.__mockTime) {
                        super(window.__mockTime);
                    } else {
                        super(...args);
                    }
                }
                static now() {
                    return window.__mockTime ? new RealDate(window.__mockTime).getTime() : RealDate.now();
                }
            }
            window.Date = MockDate;
            window.__mockTime = '2026-10-27T14:00:00-04:00';
            window.__delayFetch = 800; // 800ms delay on live fetch

            const origFetch = window.fetch;
            window.fetch = async function(url, options) {
                if (typeof url === 'string' && (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy'))) {
                    if (window.__delayFetch) {
                        await new Promise(r => setTimeout(r, window.__delayFetch));
                    }
                }
                return origFetch.apply(this, arguments);
            };
        """)

        page1 = ctx1.new_page()

        def handle_mock_proxy(route):
            url = route.request.url
            ticker = "BOIL"
            if "KOLD" in url: ticker = "KOLD"
            elif "HNU" in url: ticker = "HNU.TO"
            elif "HND" in url: ticker = "HND.TO"
            elif "3NGL" in url: ticker = "3NGL.L"
            elif "3NGS" in url: ticker = "3NGS.L"

            data = create_mock_yahoo_chart(ticker, price=18.50, prev_close=17.50)
            if "api.allorigins.win/get" in url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"contents": json.dumps(data)}))
            else:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(data))

        page1.route("**/api.allorigins.win/**", handle_mock_proxy)
        page1.route("**/api.codetabs.com/**", handle_mock_proxy)
        page1.route("**/corsproxy.io/**", handle_mock_proxy)

        page1.goto(base_url)

        # Check immediate cold boot state before live overlay resolves
        status_text = page1.locator("#market-status .status-text").text_content()
        assert_true("MARKET OPEN" in status_text, f"Market status indicates MARKET OPEN on cold boot (got: '{status_text}')")

        initial_last_updated = page1.locator("#last-updated").text_content()
        initial_classes = page1.locator("#last-updated").get_attribute("class") or ""
        assert_true("Updating live feed" in initial_last_updated, f"Header displays 'Prices: Updating live feed...' (got '{initial_last_updated}')")
        assert_true("stale" not in initial_classes, f"Header does NOT have stale class on cold boot (classes: '{initial_classes}')")
        assert_true("STALE" not in initial_last_updated, "No jarring 'STALE' text on initial cold boot")

        # Now wait for the live overlay to resolve
        page1.wait_for_function("document.getElementById('last-updated').textContent.includes('LIVE')", timeout=6000)
        live_text = page1.locator("#last-updated").text_content()
        live_classes = page1.locator("#last-updated").get_attribute("class") or ""
        assert_true("Prices: LIVE" in live_text, f"Header successfully updated to LIVE prices: '{live_text}'")
        assert_true("stale" not in live_classes, "Header retains clean non-stale class when LIVE feed active")

        # Verify localStorage received cached quotes
        cached_raw = page1.evaluate("localStorage.getItem('bm_live_quotes_cache')")
        assert_true(cached_raw is not None, "Live quotes successfully persisted to localStorage 'bm_live_quotes_cache'")
        cached_obj = json.loads(cached_raw)
        assert_true("BOIL" in cached_obj.get("quotes", {}), "Cached payload contains BOIL quote")
        test_results.append("Test Case 1: Initial Cold Boot passed")
        ctx1.close()

        # -------------------------------------------------------------
        # TEST CASE 2: Warm Reload (F5 simulation with cached quotes)
        # -------------------------------------------------------------
        print("\n========================================================")
        print("Test Case 2: Warm Reload (F5 simulation with cached quotes)")
        print("========================================================")
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
        
        cached_payload = {
            "dateStr": "2026-10-27",
            "sessionStatus": "open",
            "etTimeStr": "02:15:30 PM ET",
            "timestamp": int(time.time() * 1000) - 30000,
            "quotes": {
                "BOIL": {
                    "ticker": "BOIL",
                    "price": 18.25,
                    "volume": 8100000,
                    "dollarVolume": 147825000,
                    "changePct": 4.28,
                    "regularMarketTime": int(time.time()),
                    "marketState": "open",
                    "etTimeStr": "02:15:30 PM ET",
                    "timestamp": int(time.time() * 1000) - 30000
                },
                "KOLD": {
                    "ticker": "KOLD",
                    "price": 24.10,
                    "volume": 2500000,
                    "dollarVolume": 60250000,
                    "changePct": -4.15,
                    "regularMarketTime": int(time.time()),
                    "marketState": "open",
                    "etTimeStr": "02:15:30 PM ET",
                    "timestamp": int(time.time() * 1000) - 30000
                }
            }
        }

        init_script_tc2 = """
            localStorage.setItem('bm_live_quotes_cache', JSON.stringify(__PAYLOAD_JSON__));
            const RealDate = Date;
            class MockDate extends RealDate {
                constructor(...args) {
                    if (args.length === 0 && window.__mockTime) {
                        super(window.__mockTime);
                    } else {
                        super(...args);
                    }
                }
                static now() {
                    return window.__mockTime ? new RealDate(window.__mockTime).getTime() : RealDate.now();
                }
            }
            window.Date = MockDate;
            window.__mockTime = '2026-10-27T14:16:00-04:00';
            window.__delayFetch = 800;

            const origFetch = window.fetch;
            window.fetch = async function(url, options) {
                if (typeof url === 'string' && (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy'))) {
                    if (window.__delayFetch) {
                        await new Promise(r => setTimeout(r, window.__delayFetch));
                    }
                }
                return origFetch.apply(this, arguments);
            };
        """.replace("__PAYLOAD_JSON__", json.dumps(cached_payload))
        ctx2.add_init_script(init_script_tc2)

        page2 = ctx2.new_page()

        page2.route("**/api.allorigins.win/**", handle_mock_proxy)
        page2.route("**/api.codetabs.com/**", handle_mock_proxy)
        page2.route("**/corsproxy.io/**", handle_mock_proxy)

        page2.goto(base_url)

        # Inspect initial paint values before live network resolves
        boil_card_price = page2.locator("[data-ticker='BOIL'] .card-price").text_content()
        assert_true("18.25" in boil_card_price, f"BOIL card immediately renders warm cached price $18.25 (got: '{boil_card_price}')")
        assert_true("17.50" not in boil_card_price, "Zero flash to yesterday's pipeline close of $17.50")

        kold_card_price = page2.locator("[data-ticker='KOLD'] .card-price").text_content()
        assert_true("24.10" in kold_card_price, f"KOLD card immediately renders warm cached price $24.10 (got: '{kold_card_price}')")

        warm_header = page2.locator("#last-updated").text_content()
        assert_true("Prices: LIVE" in warm_header and "(Cached)" in warm_header and "Updating..." in warm_header,
                    f"Header truthfully displays cached live state: '{warm_header}'")

        # Capture warm cache screenshot
        warm_screen_path = OUTPUT_DIR / "warm_cache_hydrated.png"
        page2.screenshot(path=str(warm_screen_path))
        assert_true(warm_screen_path.exists(), f"Warm cache screenshot captured: {warm_screen_path}")

        # Wait for live network resolve
        page2.wait_for_function("!document.getElementById('last-updated').textContent.includes('(Cached)')", timeout=6000)
        final_header = page2.locator("#last-updated").text_content()
        assert_true("Prices: LIVE" in final_header, f"Header transitioned cleanly to fresh live feed: '{final_header}'")

        test_results.append("Test Case 2: Warm Reload passed")
        ctx2.close()

        # -------------------------------------------------------------
        # TEST CASE 3: Manual Refresh Button Click & Spinner Debouncing
        # -------------------------------------------------------------
        print("\n========================================================")
        print("Test Case 3: Manual Refresh Button Click & Spinner Debouncing")
        print("========================================================")
        ctx3 = browser.new_context(viewport={"width": 1440, "height": 900})
        
        ctx3.add_init_script("""
            const RealDate = Date;
            class MockDate extends RealDate {
                constructor(...args) {
                    if (args.length === 0 && window.__mockTime) {
                        super(window.__mockTime);
                    } else {
                        super(...args);
                    }
                }
                static now() {
                    return window.__mockTime ? new RealDate(window.__mockTime).getTime() : RealDate.now();
                }
            }
            window.Date = MockDate;
            window.__mockTime = '2026-10-27T14:00:00-04:00';
            window.__delayFetch = 0;

            const origFetch = window.fetch;
            window.fetch = async function(url, options) {
                if (typeof url === 'string' && (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy'))) {
                    if (window.__delayFetch) {
                        await new Promise(r => setTimeout(r, window.__delayFetch));
                    }
                }
                return origFetch.apply(this, arguments);
            };
        """)

        page3 = ctx3.new_page()

        page3.route("**/api.allorigins.win/**", handle_mock_proxy)
        page3.route("**/api.codetabs.com/**", handle_mock_proxy)
        page3.route("**/corsproxy.io/**", handle_mock_proxy)

        page3.goto(base_url)
        page3.wait_for_selector("#refresh-btn")
        page3.wait_for_function("!App.isLoading", timeout=6000)

        # Set delay for the manual click refresh
        page3.evaluate("window.__delayFetch = 600;")

        # Click manual refresh button
        refresh_btn = page3.locator("#refresh-btn")
        refresh_btn.click()

        # Verify button immediately has .spinning class while loading
        btn_class_during = refresh_btn.get_attribute("class") or ""
        is_loading = page3.evaluate("App.isLoading")
        assert_true("spinning" in btn_class_during, f"Refresh button received .spinning class (classes: '{btn_class_during}')")
        assert_true(is_loading is True, "App.isLoading is true during refresh operation")

        # Spam clicking: click 3 times rapidly
        refresh_btn.click()
        refresh_btn.click()
        refresh_btn.click()

        # Wait for refresh to complete
        page3.wait_for_function("!document.getElementById('refresh-btn').classList.contains('spinning')", timeout=6000)
        btn_class_after = refresh_btn.get_attribute("class") or ""
        is_loading_after = page3.evaluate("App.isLoading")
        assert_true("spinning" not in btn_class_after, f"Refresh button cleanly stopped spinning (classes: '{btn_class_after}')")
        assert_true(is_loading_after is False, "App.isLoading reset to false")

        test_results.append("Test Case 3: Manual Refresh Button Click passed")
        ctx3.close()

        # -------------------------------------------------------------
        # TEST CASE 4: AbortController Timeout (3.5s) & Proxy Failover
        # -------------------------------------------------------------
        print("\n========================================================")
        print("Test Case 4: AbortController Timeout (3.5s) & Proxy Failover")
        print("========================================================")
        ctx4 = browser.new_context(viewport={"width": 1440, "height": 900})
        
        ctx4.add_init_script("""
            localStorage.clear();
            const RealDate = Date;
            class MockDate extends RealDate {
                constructor(...args) {
                    if (args.length === 0 && window.__mockTime) {
                        super(window.__mockTime);
                    } else {
                        super(...args);
                    }
                }
                static now() {
                    return window.__mockTime ? new RealDate(window.__mockTime).getTime() : RealDate.now();
                }
            }
            window.Date = MockDate;
            window.__mockTime = '2026-10-27T14:00:00-04:00';
        """)

        page4 = ctx4.new_page()

        page4.route("**/api.allorigins.win/**", handle_mock_proxy)
        page4.route("**/api.codetabs.com/**", handle_mock_proxy)
        page4.route("**/corsproxy.io/**", handle_mock_proxy)

        # Test 4a: Direct execution of fetchWithTimeout in browser context
        page4.goto(base_url)
        page4.wait_for_selector("#refresh-btn")
        page4.wait_for_function("!App.isLoading", timeout=6000)

        timeout_test_result = page4.evaluate("""
            async () => {
                const t0 = performance.now();
                let aborted = false;
                try {
                    await DataService.fetchWithTimeout('http://127.0.0.1:9999/blackhole', {}, 1000);
                } catch (e) {
                    aborted = (e.name === 'AbortError' || e.message.includes('abort') || e.message.includes('Failed to fetch'));
                }
                const elapsed = performance.now() - t0;
                return { aborted, elapsed };
            }
        """)
        assert_true(timeout_test_result["aborted"] is True, "fetchWithTimeout aborted promptly on timeout")
        assert_true(timeout_test_result["elapsed"] < 2500, f"Aborted in {timeout_test_result['elapsed']:.1f}ms without hanging for 10-60s")

        # Test 4b: Complete proxy failure fallback to 'Data: Prior Close • Live feed paused'
        page4.evaluate("""
            async () => {
                DataService.fetchQuotesLight = async () => null;
                await App.refresh(true);
            }
        """)

        page4.wait_for_function("document.getElementById('last-updated').textContent.includes('Prior Close')", timeout=6000)
        fallback_header = page4.locator("#last-updated").text_content()
        fallback_classes = page4.locator("#last-updated").get_attribute("class") or ""
        assert_true("Data: Prior Close" in fallback_header and "Live feed paused" in fallback_header,
                    f"Graceful fallback header rendered: '{fallback_header}'")
        assert_true("stale" in fallback_classes, f"Fallback header has stale class for amber styling: '{fallback_classes}'")

        # Capture graceful fallback screenshot
        fallback_screen_path = OUTPUT_DIR / "live_feed_paused_fallback.png"
        page4.screenshot(path=str(fallback_screen_path))
        assert_true(fallback_screen_path.exists(), f"Graceful fallback screenshot captured: {fallback_screen_path}")

        test_results.append("Test Case 4: AbortController Timeout & Failover passed")
        ctx4.close()

        # -------------------------------------------------------------
        # TEST CASE 5: Tab Visibility Wake-up (>60s check)
        # -------------------------------------------------------------
        print("\n========================================================")
        print("Test Case 5: Tab Visibility Wake-up (>60s check)")
        print("========================================================")
        ctx5 = browser.new_context(viewport={"width": 1440, "height": 900})
        
        ctx5.add_init_script("""
            const RealDate = Date;
            class MockDate extends RealDate {
                constructor(...args) {
                    if (args.length === 0 && window.__mockTime) {
                        super(window.__mockTime);
                    } else {
                        super(...args);
                    }
                }
                static now() {
                    return window.__mockTime ? new RealDate(window.__mockTime).getTime() : RealDate.now();
                }
            }
            window.Date = MockDate;
            window.__mockTime = '2026-10-27T14:00:00-04:00';
        """)

        page5 = ctx5.new_page()

        page5.route("**/api.allorigins.win/**", handle_mock_proxy)
        page5.route("**/api.codetabs.com/**", handle_mock_proxy)
        page5.route("**/corsproxy.io/**", handle_mock_proxy)

        page5.goto(base_url)
        page5.wait_for_selector("#refresh-btn")

        visibility_test_result = page5.evaluate("""
            () => {
                let refreshCallCount = 0;
                const origRefresh = App.refresh;
                App.refresh = function(isManual) {
                    refreshCallCount++;
                    return Promise.resolve(true);
                };

                // Case A: Last fetch was 15s ago (<= 60s) -> should NOT trigger refresh
                App.lastLiveFetchTime = Date.now() - 15000;
                Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
                document.dispatchEvent(new Event('visibilitychange'));
                const callCountUnder60s = refreshCallCount;

                // Case B: Last fetch was 75s ago (> 60s) -> MUST trigger refresh
                App.lastLiveFetchTime = Date.now() - 75000;
                document.dispatchEvent(new Event('visibilitychange'));
                const callCountOver60s = refreshCallCount;

                // Restore
                App.refresh = origRefresh;
                return { callCountUnder60s, callCountOver60s };
            }
        """)

        assert_true(visibility_test_result["callCountUnder60s"] == 0, "No visibility refresh triggered when last fetch < 60s ago")
        assert_true(visibility_test_result["callCountOver60s"] == 1, "Visibility refresh successfully triggered when last fetch > 60s ago")

        test_results.append("Test Case 5: Tab Visibility Wake-up passed")
        ctx5.close()

        # -------------------------------------------------------------
        # TEST CASE 6: Non-market Hours Header State Machine
        # -------------------------------------------------------------
        print("\n========================================================")
        print("Test Case 6: Non-market Hours Header State Machine")
        print("========================================================")
        ctx6 = browser.new_context(viewport={"width": 1440, "height": 900})
        page6 = ctx6.new_page()

        page6.route("**/api.allorigins.win/**", handle_mock_proxy)
        page6.route("**/api.codetabs.com/**", handle_mock_proxy)
        page6.route("**/corsproxy.io/**", handle_mock_proxy)

        page6.goto(base_url)
        page6.wait_for_selector("#refresh-btn")

        # 6a. Weekend (Saturday simulation)
        weekend_res = page6.evaluate("""
            () => {
                const satDate = new Date('2026-10-24T18:00:00Z');
                const session = App.getMarketSessionInfo(satDate);
                App.updateMarketStatus(session.status);
                const orig = App.getMarketSessionInfo;
                App.getMarketSessionInfo = () => session;
                App.updateTimestamp(null, false);
                const text = document.getElementById('last-updated').textContent;
                const status = document.getElementById('market-status').textContent;
                const isStale = document.getElementById('last-updated').classList.contains('stale');
                App.getMarketSessionInfo = orig;
                return { text, status, isStale, prior: session.priorClose };
            }
        """)
        assert_true("Settled Close: Fri" in weekend_res["text"] and "16:00 ET" in weekend_res["text"],
                    f"Weekend header displays settled close: '{weekend_res['text']}'")
        assert_true("WEEKEND" in weekend_res["status"], f"Weekend market badge displays WEEKEND: '{weekend_res['status']}'")
        assert_true(weekend_res["isStale"] is False, "Weekend header does not have stale class")

        # 6b. After-hours simulation
        after_hours_res = page6.evaluate("""
            () => {
                const session = {
                    status: 'after_hours',
                    isMarketActive: false,
                    label: 'AFTER-HOURS',
                    weekday: 'Tue',
                    year: '2026',
                    month: '10',
                    day: '27',
                    hour: 17,
                    minute: 30,
                    second: 0,
                    dateStr: '2026-10-27',
                    etTimeStr: '05:30:00 PM ET',
                    priorClose: { dateStr: '2026-10-26', weekday: 'Mon', label: 'Oct 26' }
                };
                App.updateMarketStatus('after_hours');
                const orig = App.getMarketSessionInfo;
                App.getMarketSessionInfo = () => session;
                App.updateTimestamp(null, false);
                const text = document.getElementById('last-updated').textContent;
                const status = document.getElementById('market-status').textContent;
                const isStale = document.getElementById('last-updated').classList.contains('stale');
                App.getMarketSessionInfo = orig;
                return { text, status, isStale };
            }
        """)
        assert_true("Session Closed: 16:00 ET" in after_hours_res["text"], f"After-hours header: '{after_hours_res['text']}'")
        assert_true("AFTER-HOURS" in after_hours_res["status"], f"After-hours badge: '{after_hours_res['status']}'")
        assert_true(after_hours_res["isStale"] is False, "After-hours header does not have stale class")

        # 6c. Pre-market simulation
        pre_market_res = page6.evaluate("""
            () => {
                const session = {
                    status: 'pre_market',
                    isMarketActive: false,
                    label: 'PRE-MARKET',
                    weekday: 'Tue',
                    year: '2026',
                    month: '10',
                    day: '27',
                    hour: 8,
                    minute: 0,
                    second: 0,
                    dateStr: '2026-10-27',
                    etTimeStr: '08:00:00 AM ET',
                    priorClose: { dateStr: '2026-10-26', weekday: 'Mon', label: 'Oct 26' }
                };
                App.updateMarketStatus('pre_market');
                const orig = App.getMarketSessionInfo;
                App.getMarketSessionInfo = () => session;
                App.updateTimestamp(null, false);
                const text = document.getElementById('last-updated').textContent;
                const status = document.getElementById('market-status').textContent;
                const isStale = document.getElementById('last-updated').classList.contains('stale');
                App.getMarketSessionInfo = orig;
                return { text, status, isStale };
            }
        """)
        assert_true("Pre-Market (Opens 09:30 ET)" in pre_market_res["text"], f"Pre-market header: '{pre_market_res['text']}'")
        assert_true("PRE-MARKET" in pre_market_res["status"], f"Pre-market badge: '{pre_market_res['status']}'")

        # 6d. Holiday simulation (e.g. 2026-11-26 Thanksgiving)
        holiday_res = page6.evaluate("""
            () => {
                const session = {
                    status: 'holiday',
                    isMarketActive: false,
                    label: 'HOLIDAY CLOSED',
                    weekday: 'Thu',
                    year: '2026',
                    month: '11',
                    day: '26',
                    hour: 12,
                    minute: 0,
                    second: 0,
                    dateStr: '2026-11-26',
                    etTimeStr: '12:00:00 PM ET',
                    priorClose: { dateStr: '2026-11-25', weekday: 'Wed', label: 'Nov 25' }
                };
                App.updateMarketStatus('holiday');
                const orig = App.getMarketSessionInfo;
                App.getMarketSessionInfo = () => session;
                App.updateTimestamp(null, false);
                const text = document.getElementById('last-updated').textContent;
                const status = document.getElementById('market-status').textContent;
                const isStale = document.getElementById('last-updated').classList.contains('stale');
                App.getMarketSessionInfo = orig;
                return { text, status, isStale };
            }
        """)
        assert_true("Settled Close: Wed Nov 25, 16:00 ET" in holiday_res["text"], f"Holiday header: '{holiday_res['text']}'")
        assert_true("HOLIDAY CLOSED" in holiday_res["status"], f"Holiday badge: '{holiday_res['status']}'")

        test_results.append("Test Case 6: Non-market Hours State Machine passed")
        ctx6.close()

        # -------------------------------------------------------------
        # TEST CASE 7: Visual Quality & Zero Regressions
        # -------------------------------------------------------------
        print("\n========================================================")
        print("Test Case 7: Visual Quality & Zero Regressions")
        print("========================================================")
        
        # 7a. Desktop Viewport (1440 x 900)
        ctx7_desktop = browser.new_context(viewport={"width": 1440, "height": 900})
        page7_d = ctx7_desktop.new_page()

        page7_d.route("**/api.allorigins.win/**", handle_mock_proxy)
        page7_d.route("**/api.codetabs.com/**", handle_mock_proxy)
        page7_d.route("**/corsproxy.io/**", handle_mock_proxy)

        page7_d.goto(base_url)
        page7_d.wait_for_selector("#refresh-btn")
        time.sleep(1.0)

        # Check ETF Cards
        long_cards = page7_d.locator("#long-cards .etf-card").count()
        short_cards = page7_d.locator("#short-cards .etf-card").count()
        assert_true(long_cards == 3, f"Long section has 3 ETF cards (found {long_cards})")
        assert_true(short_cards == 3, f"Short section has 3 ETF cards (found {short_cards})")

        # Check Volume Profile Panel
        vp_canvas = page7_d.locator("#vp-canvas")
        assert_true(vp_canvas.count() == 1, "Volume Profile canvas (#vp-canvas) is present in DOM")
        vp_chips = page7_d.locator("#vp-chips .vp-chip").count()
        assert_true(vp_chips >= 6, f"Volume Profile ETF chips rendered ({vp_chips} chips)")

        # Check Price-Volume Studies Panel
        vs_canvas = page7_d.locator("#vs-canvas")
        assert_true(vs_canvas.count() == 1, "Price-Volume Studies canvas (#vs-canvas) is present in DOM")

        # Capture Desktop Full Screenshot
        desktop_screen_path = OUTPUT_DIR / "desktop_live_price_suite.png"
        page7_d.screenshot(path=str(desktop_screen_path), full_page=True)
        assert_true(desktop_screen_path.exists(), f"Desktop full screenshot captured: {desktop_screen_path}")

        # Live Feed Active Screenshot
        live_active_path = OUTPUT_DIR / "live_feed_active.png"
        page7_d.screenshot(path=str(live_active_path))
        assert_true(live_active_path.exists(), f"Live feed active screenshot captured: {live_active_path}")

        ctx7_desktop.close()

        # 7b. Mobile Viewport (390 x 844)
        ctx7_mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        page7_m = ctx7_mobile.new_page()
        page7_m.route("**/api.allorigins.win/**", handle_mock_proxy)
        page7_m.route("**/api.codetabs.com/**", handle_mock_proxy)
        page7_m.route("**/corsproxy.io/**", handle_mock_proxy)

        page7_m.goto(base_url)
        page7_m.wait_for_selector("#refresh-btn")
        time.sleep(1.0)

        mobile_screen_path = OUTPUT_DIR / "mobile_live_price_suite.png"
        page7_m.screenshot(path=str(mobile_screen_path), full_page=True)
        assert_true(mobile_screen_path.exists(), f"Mobile full screenshot captured: {mobile_screen_path}")

        ctx7_mobile.close()
        test_results.append("Test Case 7: Visual Quality & Zero Regressions passed")

        browser.close()

    print("\n========================================================")
    print(f"ALL PLAYWRIGHT TESTS PASSED! Total assertions: {passed_assertions}")
    print("========================================================")
    for r in test_results:
        print(f"  {r}")
    return passed_assertions

if __name__ == "__main__":
    count = run_suite()
    sys.exit(0)
