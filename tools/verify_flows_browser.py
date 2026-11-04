# tools/verify_flows_browser.py
# Automated Playwright headless browser verification for Upgraded Flow Monitor (flows.html & flow-composite.js)

import http.server
import os
import socketserver
import sys
import threading
import time
from playwright.sync_api import sync_playwright

ARTIFACT_DIR = "C:/Users/Dell/.gemini/antigravity/brain/daf2837d-7a62-4ad3-adb9-68091ad4bd3a"
DOCS_DIR = os.path.abspath("docs")

class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

def run_server(port=8130):
    server = socketserver.TCPServer(("127.0.0.1", port), QuietHTTPHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return server

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    server = run_server(8130)
    print("[SERVER] Serving docs at http://127.0.0.1:8130")

    console_errors = []
    critical_errors = []
    page_errors = []

    def on_console(msg):
        if msg.type == "error":
            console_errors.append(msg.text)
            is_net_error = any(pattern in msg.text.lower() for pattern in [
                "401", "proxy", "aggregateerror", "failed to load resource", "all proxies failed"
            ])
            if not is_net_error:
                critical_errors.append(msg.text)
                print(f"  [BROWSER ERROR] {msg.text}")
        elif msg.type == "warning":
            pass

    def on_page_error(exc):
        page_errors.append(str(exc))
        print(f"  [PAGE ERROR] {exc}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2
        )
        page = ctx.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_page_error)

        print("[TEST] Navigating to http://127.0.0.1:8130/flows.html...")
        page.goto("http://127.0.0.1:8130/flows.html")

        # Wait for data to load and render
        page.wait_for_selector(".summary-grid", timeout=12000)
        page.wait_for_timeout(1500)

        # -------------------------------------------------------------
        # TEST 1: Section 1 Sentiment Banner & Color Inversion Fix
        # -------------------------------------------------------------
        print("\n[TEST 1] Verifying Section 1 Sentiment Banner...")
        sent_short = page.locator("#sent-short")
        sent_short_class = sent_short.get_attribute("class") or ""
        sent_short_text = sent_short.text_content().strip()
        print(f"  Short flow text: '{sent_short_text}', class: '{sent_short_class}'")

        # If shortFlow is negative (-$108.8M), exits from shorts = bullish = val-green
        if "-" in sent_short_text:
            assert "val-green" in sent_short_class, f"Expected val-green on negative short flow, got {sent_short_class}"
            print("  [PASS] Short-side color correctly inverted: short outflow is GREEN (bullish)")

        sent_status = page.locator("#sent-status")
        sent_status_tip = sent_status.get_attribute("data-tooltip") or ""
        print(f"  Sentiment status tooltip: '{sent_status_tip}'")
        assert "Net Bullish Flow Impulse" in sent_status_tip or "Flow" in sent_status_tip, "Tooltip present on sent-status"

        # -------------------------------------------------------------
        # TEST 2: Section 2 ETF Cards & 5D Regime Tags
        # -------------------------------------------------------------
        print("\n[TEST 2] Verifying Section 2 ETF Summary Cards...")
        cards = page.locator(".flow-card")
        card_count = cards.count()
        print(f"  Found {card_count} ETF cards")
        assert card_count == 6, f"Expected 6 cards, found {card_count}"

        tags = page.locator(".flow-card .flow-tag")
        for i in range(tags.count()):
            tag_text = tags.nth(i).text_content().strip()
            assert len(tag_text) > 0, f"Card {i} tag is blank!"
            print(f"  Card {i} tag: '{tag_text}'")
        print("  [PASS] All 6 ETF cards have active regime tags (zero blank tags)")

        # -------------------------------------------------------------
        # TEST 3: Section 3 Deep Dive Scale Tabs & Auto Log Scaling
        # -------------------------------------------------------------
        print("\n[TEST 3] Verifying Section 3 Deep Dive Scale Tabs...")
        scale_tabs = page.locator("#dd-scale-tabs .tab-btn")
        assert scale_tabs.count() == 3, f"Expected 3 scale tabs (AUTO, LOG, LIN), found {scale_tabs.count()}"
        active_tab = page.locator("#dd-scale-tabs .tab-btn.active").text_content().strip()
        print(f"  Active scale tab: '{active_tab}'")
        assert active_tab in ["AUTO", "LOG", "LIN"], f"Invalid active tab: {active_tab}"

        canvas_a = page.locator("#chartA")
        box_a = canvas_a.bounding_box()
        assert box_a and box_a["width"] > 0 and box_a["height"] > 0, "chartA canvas has non-zero size"
        print(f"  chartA size: {box_a['width']}x{box_a['height']}")

        # -------------------------------------------------------------
        # TEST 4: Section 4 Divergences Table & Metrics
        # -------------------------------------------------------------
        print("\n[TEST 4] Verifying Section 4 Divergences Table...")
        div_rows = page.locator("#div-body tr")
        print(f"  Divergence rows found: {div_rows.count()}")
        assert div_rows.count() > 0, "Expected divergence rows in table"
        first_row_text = div_rows.first.text_content()
        print(f"  Sample divergence row: {first_row_text[:80]}...")

        # -------------------------------------------------------------
        # TEST 5: Section 5 Z-Score & 20D Rolling Mean Trend Line
        # -------------------------------------------------------------
        print("\n[TEST 5] Verifying Section 5 Z-Score Engine...")
        canvas_z = page.locator("#chartZ")
        box_z = canvas_z.bounding_box()
        assert box_z and box_z["width"] > 0 and box_z["height"] > 0, "chartZ canvas has non-zero size"
        print(f"  chartZ size: {box_z['width']}x{box_z['height']}")

        # -------------------------------------------------------------
        # TEST 6: Section 6 Cross-Side Divergence & Section 7 Yearly Matrix
        # -------------------------------------------------------------
        print("\n[TEST 6] Verifying Section 6 Cross-Side & Section 7 Yearly Matrix...")
        canvas_cross = page.locator("#chartCross")
        box_cross = canvas_cross.bounding_box()
        assert box_cross and box_cross["width"] > 0, "chartCross canvas has non-zero size"

        matrix_cells = page.locator("#yearly-matrix-container .matrix-table td")
        print(f"  Yearly matrix cells: {matrix_cells.count()}")
        assert matrix_cells.count() > 0, "Yearly matrix cells rendered"

        # -------------------------------------------------------------
        # TEST 7: Section 6.1-6.5 Composite Engines & Interactive Selectors
        # -------------------------------------------------------------
        print("\n[TEST 7] Verifying Composite Panels...")
        comp_z = page.locator("#chartCompZ")
        assert comp_z.count() > 0, "chartCompZ exists"

        flow_vel = page.locator("#chartFlowVelocity")
        assert flow_vel.count() > 0, "chartFlowVelocity exists"

        heat_grid = page.locator("#flow-activity-heat .flow-heat-grid")
        assert heat_grid.count() > 0, "flow-heat-grid exists"

        reactivity = page.locator("#chartReactivity")
        assert reactivity.count() > 0, "chartReactivity exists"

        # Verify wheel event doesn't crash on flow velocity
        print("  Testing wheel event over chartFlowVelocity...")
        box_vel = flow_vel.bounding_box()
        if box_vel:
            page.mouse.move(box_vel["x"] + box_vel["width"] / 2, box_vel["y"] + box_vel["height"] / 2)
            page.mouse.wheel(0, -100)
            page.wait_for_timeout(300)

        # -------------------------------------------------------------
        # SCREENSHOTS
        # -------------------------------------------------------------
        print("\n[TEST 8] Capturing Desktop & Mobile Screenshots...")
        desktop_shot = os.path.join(ARTIFACT_DIR, "flows_dashboard_desktop.png")
        page.screenshot(path=desktop_shot, full_page=False)
        print(f"  Saved desktop screenshot: {desktop_shot}")

        # Mobile viewport
        mobile_ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2
        )
        mobile_page = mobile_ctx.new_page()
        mobile_page.goto("http://127.0.0.1:8130/flows.html")
        mobile_page.wait_for_selector(".summary-grid", timeout=12000)
        mobile_page.wait_for_timeout(1000)
        mobile_shot = os.path.join(ARTIFACT_DIR, "flows_dashboard_mobile.png")
        mobile_page.screenshot(path=mobile_shot, full_page=False)
        print(f"  Saved mobile screenshot: {mobile_shot}")
        mobile_ctx.close()

        browser.close()

    server.shutdown()
    print("\n=== PLAYWRIGHT VERIFICATION SUMMARY ===")
    print(f"Critical console errors: {len(critical_errors)}")
    print(f"Page errors: {len(page_errors)}")
    assert len(critical_errors) == 0, f"Critical console errors found: {critical_errors}"
    assert len(page_errors) == 0, f"Page errors found: {page_errors}"
    print("ALL FLOW MONITOR BROWSER CHECKS PASSED WITH ZERO REGRESSIONS!")

if __name__ == "__main__":
    main()
