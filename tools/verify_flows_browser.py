# tools/verify_flows_browser.py
# Automated Playwright headless browser verification for Upgraded Hybrid Flow Suite (flows.html & flow-composite.js)

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

def run_server(port=8131):
    server = socketserver.TCPServer(("127.0.0.1", port), QuietHTTPHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return server

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    server = run_server(8131)
    print("[SERVER] Serving docs at http://127.0.0.1:8131")

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

        print("[TEST] Navigating to http://127.0.0.1:8131/flows.html...")
        page.goto("http://127.0.0.1:8131/flows.html")

        # Wait for data to load and render
        page.wait_for_selector(".summary-grid", timeout=12000)
        page.wait_for_timeout(1500)

        # -------------------------------------------------------------
        # TEST 1: Section 1 Sentiment Banner & Color Inversion
        # -------------------------------------------------------------
        print("\n[TEST 1] Verifying Section 1 Sentiment Banner...")
        sent_short = page.locator("#sent-short")
        sent_short_class = sent_short.get_attribute("class") or ""
        sent_short_text = sent_short.text_content().strip()
        print(f"  Short flow text: '{sent_short_text}', class: '{sent_short_class}'")
        if "-" in sent_short_text:
            assert "val-green" in sent_short_class, f"Expected val-green on negative short flow, got {sent_short_class}"
            print("  [PASS] Short-side color correctly inverted: short outflow is GREEN (bullish)")

        # -------------------------------------------------------------
        # TEST 2: Suite Mode Switcher (Classic vs Institutional vs Full Desk)
        # -------------------------------------------------------------
        print("\n[TEST 2] Verifying Flow Suite Mode Switcher...")
        suite_tabs = page.locator(".flow-suite-btn")
        assert suite_tabs.count() == 3, f"Expected 3 suite tabs, found {suite_tabs.count()}"

        classic_container = page.locator("#suite-container-classic")
        inst_container = page.locator("#suite-container-institutional")

        # Default mode should be CLASSIC
        active_btn = page.locator(".flow-suite-btn.active").text_content().strip()
        print(f"  Initial active suite button: '{active_btn}'")
        assert "CLASSIC" in active_btn, f"Expected CLASSIC mode by default, got '{active_btn}'"
        assert "suite-hidden" not in (classic_container.get_attribute("class") or ""), "Classic container must be visible"
        assert "suite-hidden" in (inst_container.get_attribute("class") or ""), "Institutional container must be hidden"

        # Check Chart A and B heights in Classic Suite
        canvas_a = page.locator("#chartA")
        box_a = canvas_a.bounding_box()
        canvas_b = page.locator("#chartB")
        box_b = canvas_b.bounding_box()
        print(f"  Chart A size: {box_a['width']}x{box_a['height']} (target ~350px height)")
        print(f"  Chart B size: {box_b['width']}x{box_b['height']} (target ~180px height)")
        assert box_a and box_a["height"] >= 300, f"Chart A height should be >= 300px, got {box_a['height']}"
        assert box_b and box_b["height"] >= 160, f"Chart B height should be >= 160px, got {box_b['height']}"

        # Capture Classic Suite screenshot
        classic_shot = os.path.join(ARTIFACT_DIR, "flows_suite_classic.png")
        page.screenshot(path=classic_shot, full_page=False)
        print(f"  [SCREENSHOT] Saved Classic Suite screenshot: {classic_shot}")

        # Switch to Institutional Suite
        print("  Switching to INSTITUTIONAL COMPOSITE SUITE...")
        page.click(".flow-suite-btn[data-suite='institutional']")
        page.wait_for_timeout(600)
        assert "suite-hidden" in (classic_container.get_attribute("class") or ""), "Classic container must now be hidden"
        assert "suite-hidden" not in (inst_container.get_attribute("class") or ""), "Institutional container must now be visible"

        # Check Institutional charts
        comp_z = page.locator("#chartCompZ")
        box_comp = comp_z.bounding_box()
        assert box_comp and box_comp["width"] > 0 and box_comp["height"] > 0, "chartCompZ rendered cleanly"
        flow_vel = page.locator("#chartFlowVelocity")
        box_vel = flow_vel.bounding_box()
        assert box_vel and box_vel["width"] > 0 and box_vel["height"] > 0, "chartFlowVelocity rendered cleanly"

        inst_shot = os.path.join(ARTIFACT_DIR, "flows_suite_institutional.png")
        page.screenshot(path=inst_shot, full_page=False)
        print(f"  [SCREENSHOT] Saved Institutional Suite screenshot: {inst_shot}")

        # Switch to FULL DESK
        print("  Switching to FULL DESK...")
        page.click(".flow-suite-btn[data-suite='all']")
        page.wait_for_timeout(600)
        assert "suite-hidden" not in (classic_container.get_attribute("class") or ""), "Classic container visible in full desk"
        assert "suite-hidden" not in (inst_container.get_attribute("class") or ""), "Institutional container visible in full desk"

        fulldesk_shot = os.path.join(ARTIFACT_DIR, "flows_suite_fulldesk.png")
        page.screenshot(path=fulldesk_shot, full_page=False)
        print(f"  [SCREENSHOT] Saved Full Desk screenshot: {fulldesk_shot}")

        # -------------------------------------------------------------
        # TEST 3: Master Slider Synchronization
        # -------------------------------------------------------------
        print("\n[TEST 3] Verifying Master Slider Synchronization...")
        sync_checkbox = page.locator("#sync-all-sliders")
        assert sync_checkbox.is_checked(), "Sync all sliders checkbox should be checked by default"

        # Move range-start slider and check that other sliders reflect zoom
        range_start = page.locator("#range-start")
        range_start.fill("25")
        page.wait_for_timeout(500)

        z_start = page.locator("#z-range-start")
        z_val = z_start.input_value()
        comp_start = page.locator("#compz-range-start")
        comp_val = comp_start.input_value()
        print(f"  range-start: 25 -> z-range-start: {z_val}, compz-range-start: {comp_val}")
        assert z_val == "25", f"Expected z-range-start 25, got {z_val}"
        assert comp_val in ["250", "249", "251"], f"Expected compz-range-start ~250, got {comp_val}"
        print("  [PASS] Master slider synchronization confirmed across suites!")

        # Reset range-start back to 0
        range_start.fill("0")
        page.wait_for_timeout(400)

        # Return to Classic Suite for standard view
        page.click(".flow-suite-btn[data-suite='classic']")
        page.wait_for_timeout(500)

        # -------------------------------------------------------------
        # TEST 4: Desktop standard screenshot
        # -------------------------------------------------------------
        desktop_shot = os.path.join(ARTIFACT_DIR, "flows_dashboard_desktop.png")
        page.screenshot(path=desktop_shot, full_page=False)
        print(f"  Saved default desktop screenshot: {desktop_shot}")

        # -------------------------------------------------------------
        # TEST 5: Mobile viewport test
        # -------------------------------------------------------------
        print("\n[TEST 5] Testing Mobile Viewport (390x844)...")
        mobile_ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2
        )
        mobile_page = mobile_ctx.new_page()
        mobile_page.goto("http://127.0.0.1:8131/flows.html")
        mobile_page.wait_for_selector(".summary-grid", timeout=12000)
        mobile_page.wait_for_timeout(1000)

        mobile_nav = mobile_page.locator(".flow-suite-nav")
        assert mobile_nav.count() > 0, "Suite switcher renders on mobile"

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
    print("ALL HYBRID FLOW SUITE BROWSER CHECKS PASSED WITH ZERO REGRESSIONS!")

if __name__ == "__main__":
    main()
