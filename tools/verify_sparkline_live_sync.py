"""
Verification Script for Sparkline Live Sync and Header State Machine
Tests covered:
- TEST A: Live Overlay Bar Injection on Active Market Day
- TEST B: Sparkline Hover Tooltip Verification (Date and Price)
- TEST C: Warm Cache Hydration on F5
- TEST D: Proxy Failure State Machine Transitions
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

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

ARTIFACT_DIR = Path(r"C:\Users\Dell\.gemini\antigravity\brain\bd72ed4c-2d93-42f5-a8c7-1df14f4be1f7")
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def create_mock_yahoo_chart(ticker, price, prev_close, volume=3500000):
    now_ts = 1793296800  # 2026-10-29 14:00:00 EDT
    return {
        "chart": {
            "result": [{
                "meta": {
                    "currency": "USD",
                    "symbol": ticker,
                    "exchangeName": "PCX",
                    "regularMarketPrice": price,
                    "regularMarketVolume": volume,
                    "previousClose": prev_close,
                    "regularMarketTime": now_ts,
                    "marketState": "REGULAR",
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
                        "volume": [2000000, 2200000, 2400000, 2506200, volume]
                    }]
                }
            }],
            "error": None
        }
    }

TICKER_SPECS = {
    "KOLD": {"price": 33.02, "prev_close": 31.73, "volume": 3500000},
    "BOIL": {"price": 9.85, "prev_close": 10.20, "volume": 12000000},
    "HNU.TO": {"price": 14.50, "prev_close": 14.10, "volume": 450000},
    "HND.TO": {"price": 22.10, "prev_close": 22.80, "volume": 320000},
    "3NGL.L": {"price": 28.40, "prev_close": 27.50, "volume": 150000},
    "3NGS.L": {"price": 19.30, "prev_close": 20.00, "volume": 210000}
}

def get_ticker_from_url(url):
    for t in ["KOLD", "BOIL", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L"]:
        if t in url:
            return t
    return "KOLD"

def main():
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

        # =============================================================
        # TEST A: Live Overlay Bar Injection on Active Market Day
        # =============================================================
        print("\n=== TEST A: Live Overlay Bar Injection ===")
        ctx_a = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx_a.add_init_script("""
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
            window.__mockTime = '2026-10-29T14:00:00-04:00';
        """)

        page_a = ctx_a.new_page()

        def handle_mock_proxy(route):
            url = route.request.url
            ticker = get_ticker_from_url(url)
            spec = TICKER_SPECS.get(ticker, {"price": 30.00, "prev_close": 29.00, "volume": 1000000})
            payload = create_mock_yahoo_chart(ticker, spec["price"], spec["prev_close"], spec["volume"])
            route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

        page_a.route("**/api.allorigins.win/**", handle_mock_proxy)
        page_a.route("**/api.codetabs.com/**", handle_mock_proxy)
        page_a.route("**/corsproxy.io/**", handle_mock_proxy)

        page_a.goto(base_url)
        page_a.wait_for_selector(".etf-card", timeout=8000)
        page_a.wait_for_function("document.getElementById('last-updated') && document.getElementById('last-updated').textContent.includes('LIVE')", timeout=8000)

        metrics = page_a.evaluate("window.App.allMetrics")
        assert_true(metrics is not None, "window.App.allMetrics is populated")

        for ticker, spec in TICKER_SPECS.items():
            t_data = metrics.get(ticker)
            assert_true(t_data is not None, f"Metrics present for {ticker}")
            spark = t_data.get("sparkData", [])
            assert_true(len(spark) > 0, f"SparkData non empty for {ticker}")
            last_bar = spark[-1]
            assert_true(last_bar["date"] == "2026-10-29", f"{ticker} sparkData rightmost bar date is 2026-10-29 (got {last_bar['date']})")
            assert_true(abs(last_bar["close"] - spec["price"]) < 0.001, f"{ticker} sparkData rightmost close is {spec['price']} (got {last_bar['close']})")
            assert_true(last_bar["volume"] == spec["volume"], f"{ticker} sparkData rightmost volume is {spec['volume']} (got {last_bar['volume']})")

        test_results.append("TEST A: Live Overlay Bar Injection passed")

        # =============================================================
        # TEST B: Sparkline Hover Tooltip Verification
        # =============================================================
        print("\n=== TEST B: Sparkline Hover Tooltip Verification ===")
        # Using page_a where live data is already active and rendered
        kold_card = page_a.locator('.etf-card[data-ticker="KOLD"]')
        assert_true(kold_card.count() > 0, "KOLD card element located")

        chart_wrap = page_a.locator('#chart-wrap-KOLD')
        assert_true(chart_wrap.count() > 0, "KOLD interactive chart wrap located")

        box = chart_wrap.bounding_box()
        assert_true(box is not None, "KOLD chart wrap has valid bounding box")

        # Hover directly on the rightmost edge of the interactive chart wrap
        hover_x = box["x"] + box["width"] - 3
        hover_y = box["y"] + box["height"] / 2
        page_a.mouse.move(hover_x, hover_y)
        page_a.wait_for_timeout(400)

        tooltip = page_a.locator("#card-chart-tooltip")
        assert_true(tooltip.count() > 0, "#card-chart-tooltip element exists in DOM")
        tooltip_html = tooltip.inner_html()
        tooltip_text = tooltip.text_content()

        # Date assertions
        assert_true("29th Oct, 2026" in tooltip_text, "Tooltip reflects today's date '29th Oct, 2026'")
        assert_true("28th Oct, 2026" not in tooltip_text, "Tooltip does NOT show yesterday's date '28th Oct, 2026'")

        # Price assertions
        assert_true("$33.02" in tooltip_text, "Tooltip reflects live price '$33.02'")
        assert_true("$31.73" not in tooltip_text, "Tooltip does NOT show yesterday's close '$31.73'")

        # Activity and Volume assertions
        assert_true("3,500,000" in tooltip_text or "3.5M" in tooltip_text, "Tooltip reflects live volume in formatted text")

        # Capture screenshot of hover tooltip in action
        screenshot_hover_path = ARTIFACT_DIR / "kold_sparkline_live_hover.png"
        page_a.screenshot(path=str(screenshot_hover_path))
        print(f"  [SCREENSHOT] Saved hover tooltip screenshot to: {screenshot_hover_path}")
        assert_true(screenshot_hover_path.exists(), "Hover screenshot file exists on disk")

        test_results.append("TEST B: Sparkline Hover Tooltip Verification passed")
        ctx_a.close()

        # =============================================================
        # TEST C: Warm Cache Hydration on F5
        # =============================================================
        print("\n=== TEST C: Warm Cache Hydration on F5 ===")
        ctx_c = browser.new_context(viewport={"width": 1440, "height": 900})

        warm_cache_payload = {
            "dateStr": "2026-10-29",
            "sessionStatus": "open",
            "etTimeStr": "02:00:00 PM ET",
            "timestamp": int(time.time() * 1000) - 20000,
            "quotes": {
                "KOLD": {
                    "ticker": "KOLD",
                    "price": 33.02,
                    "volume": 3500000,
                    "dollarVolume": 115570000,
                    "changePct": 4.07,
                    "regularMarketTime": int(time.time()),
                    "marketState": "open",
                    "etTimeStr": "02:00:00 PM ET",
                    "timestamp": int(time.time() * 1000) - 20000
                },
                "BOIL": {
                    "ticker": "BOIL",
                    "price": 9.85,
                    "volume": 12000000,
                    "dollarVolume": 118200000,
                    "changePct": -3.43,
                    "regularMarketTime": int(time.time()),
                    "marketState": "open",
                    "etTimeStr": "02:00:00 PM ET",
                    "timestamp": int(time.time() * 1000) - 20000
                }
            }
        }

        # Inject warm cache and artificial network delay of 5000ms
        init_script_c = f"""
            localStorage.setItem('bm_live_quotes_cache', JSON.stringify({json.dumps(warm_cache_payload)}));
            const RealDate = Date;
            class MockDate extends RealDate {{
                constructor(...args) {{
                    if (args.length === 0 && window.__mockTime) {{
                        super(window.__mockTime);
                    }} else {{
                        super(...args);
                    }}
                }}
                static now() {{
                    return window.__mockTime ? new RealDate(window.__mockTime).getTime() : RealDate.now();
                }}
            }}
            window.Date = MockDate;
            window.__mockTime = '2026-10-29T14:00:00-04:00';
            window.__delayFetch = 5000;

            const origFetch = window.fetch;
            window.fetch = async function(url, options) {{
                if (typeof url === 'string' && (url.includes('allorigins') || url.includes('codetabs') || url.includes('corsproxy'))) {{
                    if (window.__delayFetch) {{
                        await new Promise(r => setTimeout(r, window.__delayFetch));
                    }}
                }}
                return origFetch.apply(this, arguments);
            }};
        """
        ctx_c.add_init_script(init_script_c)
        page_c = ctx_c.new_page()

        page_c.route("**/api.allorigins.win/**", handle_mock_proxy)
        page_c.route("**/api.codetabs.com/**", handle_mock_proxy)
        page_c.route("**/corsproxy.io/**", handle_mock_proxy)

        page_c.goto(base_url)
        # Wait only for initial DOM render, before the 5000ms live fetch finishes
        page_c.wait_for_selector(".etf-card", timeout=8000)

        # Verify immediate warm cache state on boot
        boot_updated = page_c.locator("#last-updated").text_content()
        assert_true("Cached" in boot_updated, f"Header indicates warm cached quotes on initial boot (got '{boot_updated}')")
        assert_true("Updating..." in boot_updated, f"Header indicates background update is underway (got '{boot_updated}')")

        # Verify KOLD sparkData is already hydrated with today's live bar on boot
        kold_metrics = page_c.evaluate("window.App.allMetrics['KOLD']")
        assert_true(kold_metrics is not None, "KOLD metrics initialized from warm cache")
        spark_c = kold_metrics.get("sparkData", [])
        assert_true(len(spark_c) > 0, "KOLD sparkData non empty on warm boot")
        last_c = spark_c[-1]
        assert_true(last_c["date"] == "2026-10-29", f"KOLD sparkData immediately hydrated with today's date '2026-10-29' (got '{last_c['date']}')")
        assert_true(abs(last_c["close"] - 33.02) < 0.001, f"KOLD sparkData immediately hydrated with cached price 33.02 (got {last_c['close']})")

        test_results.append("TEST C: Warm Cache Hydration on F5 passed")
        ctx_c.close()

        # =============================================================
        # TEST D: Proxy Failure State Machine
        # =============================================================
        print("\n=== TEST D: Proxy Failure State Machine ===")
        ctx_d = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx_d.add_init_script("""
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
            window.__mockTime = '2026-10-29T14:00:00-04:00';
        """)
        page_d = ctx_d.new_page()

        # Route all proxy requests to immediately fail (HTTP 500)
        def handle_failing_proxy(route):
            route.fulfill(status=500, content_type="text/plain", body="Internal Proxy Error")

        page_d.route("**/api.allorigins.win/**", handle_failing_proxy)
        page_d.route("**/api.codetabs.com/**", handle_failing_proxy)
        page_d.route("**/corsproxy.io/**", handle_failing_proxy)

        page_d.goto(base_url)
        page_d.wait_for_selector(".etf-card", timeout=8000)

        # Initial state before proxy failures conclude
        initial_status = page_d.locator("#last-updated").text_content()
        print(f"  [STATE] Initial status before failures conclude: '{initial_status}'")

        # Wait for failure state machine transition
        page_d.wait_for_function(
            "document.getElementById('last-updated') && document.getElementById('last-updated').textContent.includes('Live feed paused')",
            timeout=12000
        )

        failed_text = page_d.locator("#last-updated").text_content()
        failed_classes = page_d.locator("#last-updated").get_attribute("class") or ""

        assert_true("Data: Prior Close" in failed_text, f"Header displays 'Data: Prior Close' (got '{failed_text}')")
        assert_true("Live feed paused" in failed_text, f"Header displays 'Live feed paused' (got '{failed_text}')")
        assert_true("Prices: Updating live feed..." not in failed_text, "Header is NOT trapped in 'Prices: Updating live feed...'")
        assert_true("stale" in failed_classes, f"Header element has 'stale' CSS class (classes: '{failed_classes}')")

        screenshot_fail_path = ARTIFACT_DIR / "proxy_failure_header.png"
        page_d.screenshot(path=str(screenshot_fail_path))
        print(f"  [SCREENSHOT] Saved proxy failure state screenshot to: {screenshot_fail_path}")
        assert_true(screenshot_fail_path.exists(), "Proxy failure screenshot exists on disk")

        test_results.append("TEST D: Proxy Failure State Machine passed")
        ctx_d.close()

        browser.close()

    server.shutdown()

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED SUCCESSFULLY!")
    print(f"Total assertions passed: {passed_assertions}")
    for res in test_results:
        print(f"  * {res}")
    print("=" * 60)

if __name__ == "__main__":
    main()
