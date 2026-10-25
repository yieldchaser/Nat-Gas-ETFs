import functools
import http.server
import json
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

def run_server():
    server = socketserver.TCPServer(("127.0.0.1", 8124), QuietHTTPHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return server

def count_canvas_pixels(page):
    return page.evaluate("""() => {
        const canvas = document.getElementById('vs-canvas');
        if (!canvas) return 0;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let nonZero = 0;
        for (let i = 0; i < imgData.data.length; i += 4) {
            if (imgData.data[i + 3] > 0) nonZero++;
        }
        return nonZero;
    }""")

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    server = run_server()
    print("[SERVER] Serving docs at http://127.0.0.1:8124")

    console_errors = []
    console_warnings = []
    page_errors = []

    def on_console(msg):
        if msg.type == "error":
            console_errors.append(msg.text)
        elif msg.type == "warning":
            console_warnings.append(msg.text)

    def on_page_error(err):
        page_errors.append(str(err))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Desktop verification (1440x900)
        print("[TEST] Launching Desktop context (1440x900)...")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_page_error)

        page.goto("http://127.0.0.1:8124/index.html", wait_until="networkidle")
        page.wait_for_selector("#vs-panel", state="visible", timeout=10000)

        # Ensure canvas renders
        page.wait_for_timeout(1000)
        px = count_canvas_pixels(page)
        print(f"[CANVAS] Initial non-zero pixel count: {px}")
        assert px > 500, f"Canvas appears blank, nonZeroPixels={px}"

        # Test ETF Chips
        etfs = ["BOIL", "HNU.TO", "3NGL.L", "KOLD", "HND.TO", "3NGS.L"]
        for etf in etfs:
            btn = page.locator(f'#vs-chips button[data-ticker="{etf}"]')
            assert btn.is_visible(), f"Chip {etf} not visible"
            btn.click()
            page.wait_for_timeout(200)
            assert "active" in btn.get_attribute("class"), f"Chip {etf} should be active"
            px_etf = count_canvas_pixels(page)
            assert px_etf > 500, f"Canvas blank after selecting ETF {etf}"
            print(f"[ETF CHIP] {etf} verified (pixels={px_etf})")

        # Select BOIL back for study tabs test
        page.locator('#vs-chips button[data-ticker="BOIL"]').click()
        page.wait_for_timeout(200)

        # Test Study Tabs
        study_tests = [
            ("vol", ["RVOL-21", "VOL", "VALUE"]),
            ("osc", ["OSC", "STATE"]),
            ("net", ["DAY", "21D"]),
            ("cmf", ["CMF-21", "REGIME", "SIGNAL"]),
            ("obv", ["MA", "21D Δ", "BIAS", "SIGNAL"]),
            ("pvt", ["MA", "21D Δ", "BIAS", "SIGNAL"])
        ]

        for study, expected_labels in study_tests:
            btn = page.locator(f'#vs-study-tabs button[data-study="{study}"]')
            assert btn.is_visible(), f"Study tab {study} not visible"
            btn.click()
            page.wait_for_timeout(250)
            assert "active" in btn.get_attribute("class"), f"Tab {study} should be active"
            px_study = count_canvas_pixels(page)
            assert px_study > 500, f"Canvas blank for study {study}"

            reading_text = page.locator("#vs-reading").inner_text()
            assert "NaN" not in reading_text, f"NaN in reading text for {study}: {reading_text}"
            assert "undefined" not in reading_text, f"undefined in reading text for {study}: {reading_text}"
            for lbl in expected_labels:
                assert lbl in reading_text, f"Expected label '{lbl}' missing in {study} reading: {reading_text}"
            print(f"[STUDY] {study.upper()} verified (labels={expected_labels}, pixels={px_study})")

        # Test Unit Toggle (S vs $)
        print("[TEST] Testing Unit Toggle (Shares vs Dollar)...")
        unit_dollar = page.locator('#vs-unit-tabs button[data-unit="dollar"]')
        unit_shares = page.locator('#vs-unit-tabs button[data-unit="shares"]')
        assert unit_dollar.is_visible() and unit_shares.is_visible()

        # Switch to Dollar mode on CMF
        page.locator('#vs-study-tabs button[data-study="cmf"]').click()
        page.wait_for_timeout(200)
        unit_dollar.click()
        page.wait_for_timeout(250)
        assert "active" in unit_dollar.get_attribute("class")
        assert "active" not in unit_shares.get_attribute("class")
        px_dollar = count_canvas_pixels(page)
        assert px_dollar > 500
        cmf_dollar_shot = os.path.join(ARTIFACT_DIR, "cmf_desktop_dollar_boil.png")
        page.locator("#vs-panel").screenshot(path=cmf_dollar_shot)
        print(f"[SCREENSHOT] Saved {cmf_dollar_shot}")

        # Switch back to Shares mode
        unit_shares.click()
        page.wait_for_timeout(250)
        assert "active" in unit_shares.get_attribute("class")
        assert "active" not in unit_dollar.get_attribute("class")

        # Capture CMF Desktop Shares screenshot
        cmf_desktop_shot = os.path.join(ARTIFACT_DIR, "cmf_desktop_boil.png")
        page.locator("#vs-panel").screenshot(path=cmf_desktop_shot)
        print(f"[SCREENSHOT] Saved {cmf_desktop_shot}")

        # Capture OBV Desktop screenshot
        page.locator('#vs-study-tabs button[data-study="obv"]').click()
        page.wait_for_timeout(250)
        obv_desktop_shot = os.path.join(ARTIFACT_DIR, "obv_desktop_boil.png")
        page.locator("#vs-panel").screenshot(path=obv_desktop_shot)
        print(f"[SCREENSHOT] Saved {obv_desktop_shot}")

        # Test Hover / Mouse Movement & Tooltip
        print("[TEST] Testing Canvas Hover and Tooltip...")
        page.locator('#vs-study-tabs button[data-study="cmf"]').click()
        page.wait_for_timeout(200)
        canvas = page.locator("#vs-canvas")
        box = canvas.bounding_box()
        assert box is not None, "Canvas bounding box is None"

        for frac in [0.25, 0.50, 0.75]:
            x = box["x"] + box["width"] * frac
            y = box["y"] + box["height"] * 0.5
            page.mouse.move(x, y)
            page.wait_for_timeout(100)
            tooltip = page.locator("#vs-tooltip")
            assert tooltip.is_visible(), "Tooltip should be visible on mouse move"
            tt_text = tooltip.inner_text()
            assert "NaN" not in tt_text, f"NaN in tooltip: {tt_text}"
            assert "undefined" not in tt_text, f"undefined in tooltip: {tt_text}"
            assert "CLOSE" in tt_text, "CLOSE row missing in tooltip"
            assert "CMF-21" in tt_text, "CMF-21 row missing in tooltip"
            assert "SHARES" in tt_text, "SHARES row missing in tooltip"
            assert "DOLLAR VOL" in tt_text, "DOLLAR VOL row missing in tooltip"

            # Check bounds
            tt_box = tooltip.bounding_box()
            wrap_box = page.locator("#vs-canvas-wrap").bounding_box()
            assert tt_box["x"] >= wrap_box["x"] - 2
            assert tt_box["y"] >= wrap_box["y"] - 2
            assert tt_box["x"] + tt_box["width"] <= wrap_box["x"] + wrap_box["width"] + 10
            print(f"[TOOLTIP] Verified at fraction {frac}: {tt_text.splitlines()[0]}")

        # Move mouse away to ensure tooltip hides
        page.mouse.move(10, 10)
        page.wait_for_timeout(150)
        assert not page.locator("#vs-tooltip").is_visible(), "Tooltip should hide on leave"
        context.close()

        # 2. Mobile verification (390x844)
        print("[TEST] Launching Mobile context (390x844, iPhone size)...")
        mobile_ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
            has_touch=True
        )
        mobile_page = mobile_ctx.new_page()
        mobile_page.on("console", on_console)
        mobile_page.on("pageerror", on_page_error)

        mobile_page.goto("http://127.0.0.1:8124/index.html", wait_until="networkidle")
        mobile_page.wait_for_selector("#vs-panel", state="visible", timeout=10000)
        mobile_page.wait_for_timeout(1000)

        # Switch to CMF on mobile
        mobile_page.locator('#vs-study-tabs button[data-study="cmf"]').click()
        mobile_page.wait_for_timeout(300)

        px_mobile = count_canvas_pixels(mobile_page)
        assert px_mobile > 200, f"Mobile canvas blank, pixels={px_mobile}"
        print(f"[MOBILE] Canvas verified (pixels={px_mobile})")

        # Simulate Touch Scrubbing
        print("[MOBILE] Simulating Touch Scrubbing...")
        mobile_canvas = mobile_page.locator("#vs-canvas")
        m_box = mobile_canvas.bounding_box()
        touch_x1 = m_box["x"] + m_box["width"] * 0.3
        touch_y1 = m_box["y"] + m_box["height"] * 0.5
        touch_x2 = m_box["x"] + m_box["width"] * 0.7
        touch_y2 = m_box["y"] + m_box["height"] * 0.5

        # Dispatch touchstart
        mobile_page.evaluate("""({ x, y }) => {
            const canvas = document.getElementById('vs-canvas');
            const touch = new Touch({
                identifier: 1,
                target: canvas,
                clientX: x,
                clientY: y
            });
            const event = new TouchEvent('touchstart', {
                touches: [touch],
                targetTouches: [touch],
                changedTouches: [touch],
                bubbles: true,
                cancelable: true
            });
            canvas.dispatchEvent(event);
        }""", {"x": touch_x1, "y": touch_y1})
        mobile_page.wait_for_timeout(150)

        mobile_tt = mobile_page.locator("#vs-tooltip")
        assert mobile_tt.is_visible(), "Mobile tooltip should appear on touchstart"
        tt1 = mobile_tt.inner_text()
        print(f"[MOBILE TOUCH] First touchpoint: {tt1.splitlines()[0]}")

        # Dispatch touchmove
        mobile_page.evaluate("""({ x, y }) => {
            const canvas = document.getElementById('vs-canvas');
            const touch = new Touch({
                identifier: 1,
                target: canvas,
                clientX: x,
                clientY: y
            });
            const event = new TouchEvent('touchmove', {
                touches: [touch],
                targetTouches: [touch],
                changedTouches: [touch],
                bubbles: true,
                cancelable: true
            });
            canvas.dispatchEvent(event);
        }""", {"x": touch_x2, "y": touch_y2})
        mobile_page.wait_for_timeout(150)
        tt2 = mobile_tt.inner_text()
        print(f"[MOBILE TOUCH] Scrobble move touchpoint: {tt2.splitlines()[0]}")

        # Dispatch touchend
        mobile_page.evaluate("""() => {
            const canvas = document.getElementById('vs-canvas');
            const event = new TouchEvent('touchend', {
                touches: [],
                targetTouches: [],
                changedTouches: [],
                bubbles: true,
                cancelable: true
            });
            canvas.dispatchEvent(event);
        }""")
        mobile_page.wait_for_timeout(150)
        assert not mobile_tt.is_visible(), "Mobile tooltip should hide on touchend"

        # Capture Mobile Screenshot
        cmf_mobile_shot = os.path.join(ARTIFACT_DIR, "cmf_mobile_boil.png")
        mobile_page.locator("#vs-panel").screenshot(path=cmf_mobile_shot)
        print(f"[SCREENSHOT] Saved {cmf_mobile_shot}")
        mobile_ctx.close()

        browser.close()

    server.shutdown()

    # Log summary
    print("\n================ VERIFICATION SUMMARY ================")
    print(f"Page errors: {len(page_errors)}")
    for e in page_errors:
        print(f"  [PAGE ERROR] {e}")

    print(f"Console errors: {len(console_errors)}")
    for e in console_errors:
        print(f"  [CONSOLE ERROR] {e}")

    print(f"Console warnings: {len(console_warnings)}")
    for w in console_warnings:
        print(f"  [CONSOLE WARNING] {w}")

    assert len(page_errors) == 0, f"Uncaught page errors detected: {page_errors}"
    assert len(console_errors) == 0, f"Browser console errors detected: {console_errors}"
    print("ALL BROWSER AUTOMATION AND VISUAL CHECKS PASSED PERFECTLY!")

if __name__ == "__main__":
    main()
