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
    critical_errors = []
    console_warnings = []
    page_errors = []

    def on_console(msg):
        if msg.type == "error":
            console_errors.append(msg.text)
            is_net_error = any(pattern in msg.text for pattern in [
                "401",
                "proxy",
                "aggregateerror",
                "Failed to load resource",
                "All proxies failed",
                "CORS policy",
                "ERR_FAILED",
                "favicon.ico"
            ])
            if not is_net_error:
                critical_errors.append(msg.text)
                print(f"[CRITICAL CONSOLE ERROR] {msg.text}")
        elif msg.type == "warning":
            console_warnings.append(msg.text)

    def on_page_error(err):
        msg = f"{err.message if hasattr(err, 'message') else str(err)}\n{getattr(err, 'stack', '')}"
        page_errors.append(msg)
        print(f"[PAGE ERROR CAUGHT] {msg}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Desktop verification (1440x900, device_scale_factor=2)
        print("[TEST] Launching Desktop context (1440x900, 2x DPR)...")
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = context.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_page_error)

        page.goto("http://127.0.0.1:8124/index.html", wait_until="networkidle")
        page.wait_for_selector("#vs-panel", state="visible", timeout=10000)

        # Ensure canvas renders initially
        page.wait_for_timeout(1000)
        px_init = count_canvas_pixels(page)
        print(f"[CANVAS] Initial non-zero pixel count: {px_init}")
        assert px_init > 500, f"Canvas appears blank, nonZeroPixels={px_init}"

        # Test ETF Chips
        print("\n[TEST] Verifying ETF Chips...")
        etfs = ["BOIL", "HNU.TO", "3NGL.L", "KOLD", "HND.TO", "3NGS.L"]
        for etf in etfs:
            btn = page.locator(f'#vs-chips button[data-ticker="{etf}"]')
            assert btn.is_visible(), f"Chip {etf} not visible"
            btn.click()
            page.wait_for_timeout(200)
            assert "active" in btn.get_attribute("class"), f"Chip {etf} should be active"
            px_etf = count_canvas_pixels(page)
            assert px_etf > 500, f"Canvas blank after selecting ETF {etf}"
            print(f"  [ETF CHIP] {etf} verified (pixels={px_etf})")

        # Select BOIL back for study tabs test
        print("\n[TEST] Selecting BOIL for Classic Studies verification...")
        page.locator('#vs-chips button[data-ticker="BOIL"]').click()
        page.wait_for_timeout(200)

        # Ensure classic suite is active
        page.locator('#vs-suite-tabs button[data-suite="classic"]').click()
        page.wait_for_timeout(200)

        # Test Modernized Study Tabs on BOIL
        study_tests_boil = [
            ("vol", ["RVOL-ROB", "PRESSURE", "VALUE"], "rvol_flow_desktop_boil.png"),
            ("osc", ["DV-OSC", "STATE"], "dv_osc_desktop_boil.png"),
            ("net", ["DAY IMPULSE", "EW-21 Z"], "ew_netflow_desktop_boil.png"),
            ("cmf", ["ACMF-14", "SIGNAL"], "acmf_desktop_boil.png"),
            ("obv", ["Z-OBV", "ACTION"], "iobv_desktop_boil.png"),
            ("pvt", ["REGIME", "Z-SCORE", "DUAL ZLEMA", "ACTION"], "pvt_desktop_boil.png")
        ]

        print("\n[TEST] Verifying Modernized Reading Labels & Capturing Screenshots on BOIL...")
        for study, expected_labels, filename in study_tests_boil:
            btn = page.locator(f'#vs-study-tabs button[data-study="{study}"]')
            assert btn.is_visible(), f"Study tab {study} not visible"
            btn.click()
            page.wait_for_timeout(300)
            assert "active" in btn.get_attribute("class"), f"Tab {study} should be active"
            px_study = count_canvas_pixels(page)
            assert px_study > 500, f"Canvas blank for study {study} on BOIL (pixels={px_study})"

            reading_text = page.locator("#vs-reading").inner_text()
            assert "NaN" not in reading_text, f"NaN in reading text for {study}: {reading_text}"
            assert "undefined" not in reading_text, f"undefined in reading text for {study}: {reading_text}"
            for lbl in expected_labels:
                assert lbl in reading_text, f"Expected label '{lbl}' missing in {study} reading: {reading_text}"

            shot_path = os.path.join(ARTIFACT_DIR, filename)
            page.locator("#vs-panel").screenshot(path=shot_path)
            print(f"  [STUDY BOIL] {study.upper()} verified (labels={expected_labels}, pixels={px_study}) -> Saved {filename}")

        # Test Modernized Study Tabs on KOLD (Inverse ETP)
        print("\n[TEST] Selecting KOLD for Inverse ETP verification...")
        page.locator('#vs-chips button[data-ticker="KOLD"]').click()
        page.wait_for_timeout(250)

        study_tests_kold = [
            ("vol", ["RVOL-ROB", "PRESSURE", "VALUE"], "rvol_flow_desktop_kold.png"),
            ("osc", ["DV-OSC", "STATE"], None),
            ("net", ["DAY IMPULSE", "EW-21 Z"], None),
            ("cmf", ["ACMF-14", "SIGNAL"], None),
            ("obv", ["Z-OBV", "ACTION"], "iobv_desktop_kold.png"),
            ("pvt", ["REGIME", "Z-SCORE", "DUAL ZLEMA", "ACTION"], "pvt_desktop_kold.png")
        ]

        for study, expected_labels, filename in study_tests_kold:
            btn = page.locator(f'#vs-study-tabs button[data-study="{study}"]')
            assert btn.is_visible(), f"Study tab {study} not visible"
            btn.click()
            page.wait_for_timeout(300)
            assert "active" in btn.get_attribute("class"), f"Tab {study} should be active"
            px_kold = count_canvas_pixels(page)
            assert px_kold > 500, f"Canvas blank for study {study} on KOLD (pixels={px_kold})"

            reading_text = page.locator("#vs-reading").inner_text()
            assert "NaN" not in reading_text, f"NaN in reading text for {study} on KOLD: {reading_text}"
            assert "undefined" not in reading_text, f"undefined in reading text for {study} on KOLD: {reading_text}"
            for lbl in expected_labels:
                assert lbl in reading_text, f"Expected label '{lbl}' missing in {study} reading on KOLD: {reading_text}"

            if filename:
                shot_path = os.path.join(ARTIFACT_DIR, filename)
                page.locator("#vs-panel").screenshot(path=shot_path)
                print(f"  [STUDY KOLD] {study.upper()} verified (labels={expected_labels}, pixels={px_kold}) -> Saved {filename}")
            else:
                print(f"  [STUDY KOLD] {study.upper()} verified (labels={expected_labels}, pixels={px_kold})")

        # Switch back to BOIL
        page.locator('#vs-chips button[data-ticker="BOIL"]').click()
        page.wait_for_timeout(200)

        # Unit Toggle (Shares vs Dollar) on vol
        print("\n[TEST] Testing Unit Toggle (Shares vs Dollar) on vol...")
        page.locator('#vs-study-tabs button[data-study="vol"]').click()
        page.wait_for_timeout(200)

        unit_dollar = page.locator('#vs-unit-tabs button[data-unit="dollar"]')
        unit_shares = page.locator('#vs-unit-tabs button[data-unit="shares"]')
        assert unit_dollar.is_visible() and unit_shares.is_visible()

        # Switch to Dollar mode on vol
        unit_dollar.click()
        page.wait_for_timeout(250)
        assert "active" in unit_dollar.get_attribute("class")
        assert "active" not in unit_shares.get_attribute("class")
        px_dollar = count_canvas_pixels(page)
        assert px_dollar > 500, f"Canvas blank in dollar mode on vol: {px_dollar}"
        vol_dollar_shot = os.path.join(ARTIFACT_DIR, "rvol_flow_desktop_dollar_boil.png")
        page.locator("#vs-panel").screenshot(path=vol_dollar_shot)
        print(f"  [UNIT TOGGLE] Dollar mode verified (pixels={px_dollar}) -> Saved {vol_dollar_shot}")

        # Switch back to Shares mode on vol
        unit_shares.click()
        page.wait_for_timeout(250)
        assert "active" in unit_shares.get_attribute("class")
        assert "active" not in unit_dollar.get_attribute("class")
        px_shares = count_canvas_pixels(page)
        assert px_shares > 500, f"Canvas blank in shares mode on vol: {px_shares}"
        print(f"  [UNIT TOGGLE] Shares mode verified (pixels={px_shares})")

        # Range Selection ('1m', '3m', '6m', '1y', 'all')
        print("\n[TEST] Testing Range Selection ('1m', '3m', '6m', '1y', 'all')...")
        for rng in ['1m', '3m', '6m', '1y', 'all']:
            btn = page.locator(f'#vs-range-tabs button[data-range="{rng}"]')
            if btn.count() > 0 and btn.is_visible():
                btn.click()
                page.wait_for_timeout(250)
                assert "active" in btn.get_attribute("class"), f"Range button {rng} not active"
                active_lbl = page.locator("#vs-range-active-label").inner_text().strip()
                assert rng.upper() in active_lbl, f"Active label mismatch for {rng}: {active_lbl}"
                px_rng = count_canvas_pixels(page)
                assert px_rng > 500, f"Canvas blank after selecting range {rng}"
                print(f"  [RANGE BUTTON] {rng.upper()} button clicked and verified (label={active_lbl}, pixels={px_rng})")
            else:
                # Test programmatic range selection on VolumeStudies
                page.evaluate(f"""() => {{
                    VolumeStudies.state.range = '{rng}';
                    VolumeStudies.state.customRange = null;
                    VolumeStudies._cache = null;
                    VolumeStudies.render();
                }}""")
                page.wait_for_timeout(250)
                px_rng = count_canvas_pixels(page)
                assert px_rng > 500, f"Canvas blank after programmatic range selection {rng}"
                print(f"  [RANGE PROGRAMMATIC] {rng.upper()} evaluated and verified (pixels={px_rng})")

        # Also test VP panel range button 1M if available
        vp_1m = page.locator('#vp-range-tabs button[data-range="1m"]')
        if vp_1m.count() > 0 and vp_1m.is_visible():
            vp_1m.click()
            page.wait_for_timeout(200)
            print("  [RANGE VP] 1M button in Volume Profile verified")

        # Reset range to 1Y for tooltip and final checks
        btn_1y = page.locator('#vs-range-tabs button[data-range="1y"]')
        if btn_1y.count() > 0:
            btn_1y.click()
            page.wait_for_timeout(250)

        # Hover Tooltip Test on vol and obv
        print("\n[TEST] Testing Canvas Hover and Tooltip on vol and obv...")
        # 1. vol tooltip test
        page.locator('#vs-study-tabs button[data-study="vol"]').click()
        page.wait_for_timeout(250)
        canvas = page.locator("#vs-canvas")
        box = canvas.bounding_box()
        assert box is not None, "Canvas bounding box is None"
        wrap_box = page.locator("#vs-canvas-wrap").bounding_box()

        # Hover at fraction 0.6
        hx = box["x"] + box["width"] * 0.6
        hy = box["y"] + box["height"] * 0.5
        page.mouse.move(hx, hy)
        page.wait_for_timeout(200)

        tooltip = page.locator("#vs-tooltip")
        assert tooltip.is_visible(), "Tooltip should be visible on vol hover"
        tt_vol = tooltip.inner_text()
        assert "NaN" not in tt_vol, f"NaN in vol tooltip: {tt_vol}"
        assert "undefined" not in tt_vol, f"undefined in vol tooltip: {tt_vol}"
        assert "CLOSE" in tt_vol, f"CLOSE missing in vol tooltip: {tt_vol}"
        assert "SHARES" in tt_vol, f"SHARES missing in vol tooltip: {tt_vol}"
        assert "DOLLAR VOL" in tt_vol, f"DOLLAR VOL missing in vol tooltip: {tt_vol}"
        assert "FLOW PRESSURE" in tt_vol or "RVOL" in tt_vol or "VOLUME" in tt_vol, f"Study metrics missing in vol tooltip: {tt_vol}"

        tt_box = tooltip.bounding_box()
        wrap_box = page.locator("#vs-canvas-wrap").bounding_box()
        assert tt_box["x"] >= wrap_box["x"] - 5, f"Tooltip x {tt_box['x']} out of bounds left"
        assert tt_box["y"] >= wrap_box["y"] - 5, f"Tooltip y {tt_box['y']} out of bounds top"
        assert tt_box["x"] + tt_box["width"] <= wrap_box["x"] + wrap_box["width"] + 15, "Tooltip out of bounds right"

        vol_tt_shot = os.path.join(ARTIFACT_DIR, "vol_tooltip_hover_boil.png")
        page.locator("#vs-panel").screenshot(path=vol_tt_shot)
        print(f"  [TOOLTIP VOL] Verified and saved {vol_tt_shot}")

        # 2. obv tooltip test
        page.mouse.move(10, 10)
        page.wait_for_timeout(150)
        assert not tooltip.is_visible(), "Tooltip should hide when mouse leaves"

        page.locator('#vs-study-tabs button[data-study="obv"]').click()
        page.wait_for_timeout(250)
        box = canvas.bounding_box()
        wrap_box = page.locator("#vs-canvas-wrap").bounding_box()
        hx = box["x"] + box["width"] * 0.7
        hy = box["y"] + box["height"] * 0.5
        page.mouse.move(hx, hy)
        page.wait_for_timeout(200)

        assert tooltip.is_visible(), "Tooltip should be visible on obv hover"
        tt_obv = tooltip.inner_text()
        assert "NaN" not in tt_obv, f"NaN in obv tooltip: {tt_obv}"
        assert "undefined" not in tt_obv, f"undefined in obv tooltip: {tt_obv}"
        assert "CLOSE" in tt_obv, f"CLOSE missing in obv tooltip: {tt_obv}"
        assert "SHARES" in tt_obv, f"SHARES missing in obv tooltip: {tt_obv}"
        assert "DOLLAR VOL" in tt_obv, f"DOLLAR VOL missing in obv tooltip: {tt_obv}"
        assert "IOBV" in tt_obv or "OBV" in tt_obv or "Z-OBV" in tt_obv, f"OBV metrics missing in obv tooltip: {tt_obv}"

        tt_box = tooltip.bounding_box()
        wrap_box = page.locator("#vs-canvas-wrap").bounding_box()
        assert tt_box["x"] >= wrap_box["x"] - 5, f"Tooltip x {tt_box['x']} out of bounds left"
        assert tt_box["y"] >= wrap_box["y"] - 5, f"Tooltip y {tt_box['y']} out of bounds top ({wrap_box['y']})"
        assert tt_box["x"] + tt_box["width"] <= wrap_box["x"] + wrap_box["width"] + 15, "Tooltip out of bounds right"
        assert tt_box["y"] + tt_box["height"] <= wrap_box["y"] + wrap_box["height"] + 15, "Tooltip out of bounds bottom"

        obv_tt_shot = os.path.join(ARTIFACT_DIR, "obv_tooltip_hover_boil.png")
        page.locator("#vs-panel").screenshot(path=obv_tt_shot)
        print(f"  [TOOLTIP OBV] Verified and saved {obv_tt_shot}")

        # Move mouse away
        page.mouse.move(10, 10)
        page.wait_for_timeout(150)
        assert not tooltip.is_visible(), "Tooltip should hide on leave"
        context.close()

        # 2. Mobile verification (390x844, iPhone size)
        print("\n[TEST] Launching Mobile context (390x844, iPhone viewport, 2x DPR)...")
        mobile_ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
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
        mobile_page.wait_for_timeout(350)

        px_mobile = count_canvas_pixels(mobile_page)
        assert px_mobile > 200, f"Mobile canvas blank, pixels={px_mobile}"
        print(f"  [MOBILE] CMF canvas verified (pixels={px_mobile})")

        # Simulate Touch Scrubbing
        print("  [MOBILE] Simulating Touch Scrubbing...")
        mobile_canvas = mobile_page.locator("#vs-canvas")
        m_box = mobile_canvas.bounding_box()
        touch_x1 = m_box["x"] + m_box["width"] * 0.35
        touch_y1 = m_box["y"] + m_box["height"] * 0.5
        touch_x2 = m_box["x"] + m_box["width"] * 0.65
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
        print(f"  [MOBILE TOUCH] First touchpoint: {tt1.splitlines()[0]}")

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
        print(f"  [MOBILE TOUCH] Scrobble move touchpoint: {tt2.splitlines()[0]}")

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

        # Capture Mobile Screenshot of CMF on BOIL
        cmf_mobile_shot = os.path.join(ARTIFACT_DIR, "acmf_mobile_boil.png")
        mobile_page.locator("#vs-panel").screenshot(path=cmf_mobile_shot)
        print(f"  [SCREENSHOT] Saved mobile view -> {cmf_mobile_shot}")

        mobile_ctx.close()
        browser.close()

    server.shutdown()

    # Log summary
    print("\n================ VERIFICATION SUMMARY ================")
    print(f"Page errors: {len(page_errors)}")
    for e in page_errors:
        print(f"  [PAGE ERROR] {e}")

    print(f"Critical console errors: {len(critical_errors)}")
    for e in critical_errors:
        print(f"  [CRITICAL CONSOLE ERROR] {e}")

    print(f"Total console errors (including remote proxy fallbacks): {len(console_errors)}")
    print(f"Total console warnings: {len(console_warnings)}")

    assert len(page_errors) == 0, f"Uncaught page errors detected: {page_errors}"
    assert len(critical_errors) == 0, f"Critical browser console errors detected: {critical_errors}"
    print("ALL BROWSER AUTOMATION AND VISUAL CHECKS PASSED PERFECTLY!")

if __name__ == "__main__":
    main()