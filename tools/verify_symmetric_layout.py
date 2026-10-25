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

def run_server(port=8125):
    server = socketserver.TCPServer(("127.0.0.1", port), QuietHTTPHandler)
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
    port = 8125
    server = run_server(port)
    print(f"[SERVER] Serving docs at http://127.0.0.1:{port}")

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

    results = {
        "desktop_alignment": [],
        "mobile_alignment": [],
        "studies_tested": [],
        "etfs_tested": [],
        "range_tabs_tested": [],
        "unit_tabs_tested": [],
        "mobile_overflow": None
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Desktop verification (1440x900)
        print("\n=== DESKTOP VERIFICATION (1440x900) ===")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_page_error)

        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
        page.wait_for_selector("#vs-panel", state="visible", timeout=10000)
        page.wait_for_timeout(1000)

        # Ensure canvas renders
        px = count_canvas_pixels(page)
        print(f"[CANVAS] Initial non-zero pixel count: {px}")
        assert px > 500, f"Canvas appears blank, nonZeroPixels={px}"

        # 1a. Verify .vs-head-actions contains both #vs-range-tabs and #vs-unit-tabs
        range_tabs = page.locator("#vs-range-tabs")
        unit_tabs = page.locator("#vs-unit-tabs")
        assert range_tabs.is_visible(), "#vs-range-tabs must be visible"
        assert unit_tabs.is_visible(), "#vs-unit-tabs must be visible"

        # Check range tab buttons
        range_btns = page.locator("#vs-range-tabs .tab-btn").all()
        assert len(range_btns) == 7, f"Expected 7 range buttons, found {len(range_btns)}"
        print(f"[HEADER] Range tabs visible (7 buttons: {[b.inner_text() for b in range_btns]})")

        # Check unit tab buttons
        unit_btns = page.locator("#vs-unit-tabs .tab-btn").all()
        assert len(unit_btns) == 2, f"Expected 2 unit buttons, found {len(unit_btns)}"
        print(f"[HEADER] Unit tabs visible (2 buttons: {[b.inner_text() for b in unit_btns]})")

        # Test unit toggle
        unit_s = page.locator('#vs-unit-tabs button[data-unit="shares"]')
        unit_d = page.locator('#vs-unit-tabs button[data-unit="dollar"]')
        assert "active" in unit_s.get_attribute("class"), "Shares mode should be active by default"
        unit_d.click()
        page.wait_for_timeout(200)
        assert "active" in unit_d.get_attribute("class"), "Dollar mode should be active after click"
        assert "active" not in unit_s.get_attribute("class"), "Shares mode should be inactive after Dollar click"
        results["unit_tabs_tested"].append("dollar_toggle_ok")

        # Toggle back to Shares
        unit_s.click()
        page.wait_for_timeout(200)
        assert "active" in unit_s.get_attribute("class"), "Shares mode should be active again"
        results["unit_tabs_tested"].append("shares_toggle_ok")
        print("[HEADER] Unit toggle S / $ tested successfully")

        # 1b. Verify 6-over-6 layout symmetry
        study_btns = page.locator("#vs-study-tabs .tab-btn").all()
        etf_chips = page.locator("#vs-chips .vs-chip").all()
        assert len(study_btns) == 6, f"Expected 6 study buttons in Row 1, found {len(study_btns)}"
        assert len(etf_chips) == 6, f"Expected 6 ETF chips in Row 2, found {len(etf_chips)}"

        print("\n--- Measuring Desktop 6-over-6 Bounding Boxes ---")
        expected_pairs = [
            ("VOLUME", "BOIL"),
            ("VOL OSC", "HNU.TO"),
            ("NET VOL", "3NGL.L"),
            ("CMF", "KOLD"),
            ("OBV", "HND.TO"),
            ("PVT", "3NGS.L")
        ]

        for i, (exp_study, exp_etf) in enumerate(expected_pairs):
            s_btn = study_btns[i]
            c_btn = etf_chips[i]
            s_text = s_btn.inner_text().strip()
            c_text = c_btn.inner_text().strip()
            assert exp_study in s_text, f"Col {i+1} Study mismatch: expected {exp_study}, got {s_text}"
            assert exp_etf in c_text, f"Col {i+1} ETF mismatch: expected {exp_etf}, got {c_text}"

            s_box = s_btn.bounding_box()
            c_box = c_btn.bounding_box()

            x_diff = abs(s_box["x"] - c_box["x"])
            w_diff = abs(s_box["width"] - c_box["width"])
            h_s = s_box["height"]
            h_c = c_box["height"]

            col_data = {
                "col": i + 1,
                "study": s_text,
                "etf": c_text,
                "study_x": round(s_box["x"], 2),
                "chip_x": round(c_box["x"], 2),
                "x_diff": round(x_diff, 2),
                "study_w": round(s_box["width"], 2),
                "chip_w": round(c_box["width"], 2),
                "w_diff": round(w_diff, 2),
                "study_h": round(h_s, 2),
                "chip_h": round(h_c, 2)
            }
            results["desktop_alignment"].append(col_data)

            print(f"Col {i+1} ({s_text:7s} / {c_text:6s}): "
                  f"x: study={s_box['x']:.1f}, chip={c_box['x']:.1f} (dx={x_diff:.2f}px) | "
                  f"w: study={s_box['width']:.1f}, chip={c_box['width']:.1f} (dw={w_diff:.2f}px) | "
                  f"h: s={h_s:.1f}, c={h_c:.1f}")

            assert x_diff < 1.0, f"Col {i+1} x-alignment failed: dx={x_diff} >= 1.0px"
            assert w_diff < 1.0, f"Col {i+1} width-alignment failed: dw={w_diff} >= 1.0px"

        # 1c. Test clicking all 6 Study Tabs
        print("\n--- Testing All 6 Study Tabs ---")
        study_tests = [
            ("vol", ["RVOL-21", "VOL", "VALUE"]),
            ("osc", ["OSC", "STATE"]),
            ("net", ["DAY", "21D"]),
            ("cmf", ["CMF-21", "REGIME", "SIGNAL"]),
            ("obv", ["MA", "21D Δ", "BIAS", "SIGNAL"]),
            ("pvt", ["MA", "21D Δ", "BIAS", "SIGNAL"])
        ]
        for study_id, expected_labels in study_tests:
            btn = page.locator(f'#vs-study-tabs button[data-study="{study_id}"]')
            btn.click()
            page.wait_for_timeout(200)
            assert "active" in btn.get_attribute("class"), f"Tab {study_id} not active after click"
            px_val = count_canvas_pixels(page)
            assert px_val > 500, f"Canvas blank for study {study_id}"
            reading_text = page.locator("#vs-reading").inner_text()
            assert "NaN" not in reading_text, f"NaN in reading text: {reading_text}"
            assert "undefined" not in reading_text, f"undefined in reading text: {reading_text}"
            for lbl in expected_labels:
                assert lbl in reading_text, f"Expected label '{lbl}' missing in reading: {reading_text}"
            results["studies_tested"].append(study_id)
            print(f"[STUDY] {study_id.upper()} active, canvas px={px_val}, reading verified")

        # 1d. Test clicking all 6 ETF Chips
        print("\n--- Testing All 6 ETF Chips ---")
        etfs = ["BOIL", "HNU.TO", "3NGL.L", "KOLD", "HND.TO", "3NGS.L"]
        for etf in etfs:
            chip = page.locator(f'#vs-chips button[data-ticker="{etf}"]')
            chip.click()
            page.wait_for_timeout(200)
            assert "active" in chip.get_attribute("class"), f"Chip {etf} not active after click"
            px_val = count_canvas_pixels(page)
            assert px_val > 500, f"Canvas blank for ETF {etf}"
            results["etfs_tested"].append(etf)
            print(f"[ETF] {etf} active, canvas px={px_val}")

        # Set back to BOIL and VOL for screenshot
        page.locator('#vs-chips button[data-ticker="BOIL"]').click()
        page.wait_for_timeout(150)
        page.locator('#vs-study-tabs button[data-study="vol"]').click()
        page.wait_for_timeout(200)

        # 1e. Test Hover / Mouse Movement & Tooltip
        print("\n--- Testing Tooltip Hover & Bounds ---")
        canvas = page.locator("#vs-canvas")
        cbox = canvas.bounding_box()
        wrap_box = page.locator("#vs-canvas-wrap").bounding_box()
        tooltip = page.locator("#vs-tooltip")

        for frac in [0.25, 0.50, 0.75]:
            x = cbox["x"] + cbox["width"] * frac
            y = cbox["y"] + cbox["height"] * 0.5
            page.mouse.move(x, y)
            page.wait_for_timeout(100)
            assert tooltip.is_visible(), "Tooltip should appear on canvas hover"
            tt_text = tooltip.inner_text()
            assert "NaN" not in tt_text, f"NaN in tooltip: {tt_text}"
            assert "undefined" not in tt_text, f"undefined in tooltip: {tt_text}"
            tt_box = tooltip.bounding_box()
            assert tt_box["x"] >= wrap_box["x"] - 2
            assert tt_box["x"] + tt_box["width"] <= wrap_box["x"] + wrap_box["width"] + 10
            print(f"[TOOLTIP] Valid at fraction {frac}: {tt_text.splitlines()[0]}")

        # Mouse leave hides tooltip
        page.mouse.move(10, 10)
        page.wait_for_timeout(150)
        assert not tooltip.is_visible(), "Tooltip should hide on leave"
        print("[TOOLTIP] Successfully hides on mouse leave")

        # 1f. Capture Desktop Screenshot
        desktop_shot = os.path.join(ARTIFACT_DIR, "symmetric_desktop_boil.png")
        page.locator("#vs-panel").screenshot(path=desktop_shot)
        print(f"\n[SCREENSHOT] Desktop saved to: {desktop_shot}")
        context.close()

        # 2. Mobile verification (390x844)
        print("\n=== MOBILE VERIFICATION (390x844, iPhone) ===")
        mobile_ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
            has_touch=True
        )
        mobile_page = mobile_ctx.new_page()
        mobile_page.on("console", on_console)
        mobile_page.on("pageerror", on_page_error)

        mobile_page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
        mobile_page.wait_for_selector("#vs-panel", state="visible", timeout=10000)
        mobile_page.wait_for_timeout(1000)

        # Check horizontal overflow
        scroll_w = mobile_page.evaluate("() => document.documentElement.scrollWidth")
        client_w = mobile_page.evaluate("() => document.documentElement.clientWidth")
        results["mobile_overflow"] = {
            "scroll_width": scroll_w,
            "client_width": client_w,
            "overflow_px": scroll_w - client_w
        }
        print(f"[MOBILE OVERFLOW] scrollWidth={scroll_w}, clientWidth={client_w}")
        assert scroll_w <= client_w + 1, f"Horizontal overflow detected: scrollWidth={scroll_w} > clientWidth={client_w}"

        # Measure mobile bounding boxes
        print("\n--- Measuring Mobile 6-over-6 Bounding Boxes ---")
        m_study_btns = mobile_page.locator("#vs-study-tabs .tab-btn").all()
        m_etf_chips = mobile_page.locator("#vs-chips .vs-chip").all()
        assert len(m_study_btns) == 6, f"Expected 6 study buttons on mobile, found {len(m_study_btns)}"
        assert len(m_etf_chips) == 6, f"Expected 6 ETF chips on mobile, found {len(m_etf_chips)}"

        for i, (exp_study, exp_etf) in enumerate(expected_pairs):
            s_btn = m_study_btns[i]
            c_btn = m_etf_chips[i]
            s_text = s_btn.inner_text().strip()
            c_text = c_btn.inner_text().strip()

            s_box = s_btn.bounding_box()
            c_box = c_btn.bounding_box()

            x_diff = abs(s_box["x"] - c_box["x"])
            w_diff = abs(s_box["width"] - c_box["width"])

            col_data = {
                "col": i + 1,
                "study": s_text,
                "etf": c_text,
                "study_x": round(s_box["x"], 2),
                "chip_x": round(c_box["x"], 2),
                "x_diff": round(x_diff, 2),
                "study_w": round(s_box["width"], 2),
                "chip_w": round(c_box["width"], 2),
                "w_diff": round(w_diff, 2),
                "study_h": round(s_box["height"], 2),
                "chip_h": round(c_box["height"], 2)
            }
            results["mobile_alignment"].append(col_data)

            print(f"Mobile Col {i+1} ({s_text:7s} / {c_text:6s}): "
                  f"x: study={s_box['x']:.1f}, chip={c_box['x']:.1f} (dx={x_diff:.2f}px) | "
                  f"w: study={s_box['width']:.1f}, chip={c_box['width']:.1f} (dw={w_diff:.2f}px) | "
                  f"h: s={s_box['height']:.1f}, c={c_box['height']:.1f}")

            assert x_diff < 1.0, f"Mobile Col {i+1} x-alignment failed: dx={x_diff} >= 1.0px"
            assert w_diff < 1.0, f"Mobile Col {i+1} width-alignment failed: dw={w_diff} >= 1.0px"

        # Simulate Touch Scrubbing on mobile
        print("\n--- Testing Mobile Touch Scrubbing ---")
        m_canvas = mobile_page.locator("#vs-canvas")
        m_cbox = m_canvas.bounding_box()
        tx1 = m_cbox["x"] + m_cbox["width"] * 0.3
        ty1 = m_cbox["y"] + m_cbox["height"] * 0.5
        tx2 = m_cbox["x"] + m_cbox["width"] * 0.7
        ty2 = m_cbox["y"] + m_cbox["height"] * 0.5

        # Touchstart
        mobile_page.evaluate("""({ x, y }) => {
            const canvas = document.getElementById('vs-canvas');
            const touch = new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y });
            const event = new TouchEvent('touchstart', {
                touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true
            });
            canvas.dispatchEvent(event);
        }""", {"x": tx1, "y": ty1})
        mobile_page.wait_for_timeout(150)

        m_tooltip = mobile_page.locator("#vs-tooltip")
        assert m_tooltip.is_visible(), "Mobile tooltip should appear on touchstart"
        print(f"[TOUCH] Touchstart active: {m_tooltip.inner_text().splitlines()[0]}")

        # Touchmove
        mobile_page.evaluate("""({ x, y }) => {
            const canvas = document.getElementById('vs-canvas');
            const touch = new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y });
            const event = new TouchEvent('touchmove', {
                touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true
            });
            canvas.dispatchEvent(event);
        }""", {"x": tx2, "y": ty2})
        mobile_page.wait_for_timeout(150)
        print(f"[TOUCH] Touchmove active: {m_tooltip.inner_text().splitlines()[0]}")

        # Touchend
        mobile_page.evaluate("""() => {
            const canvas = document.getElementById('vs-canvas');
            const event = new TouchEvent('touchend', {
                touches: [], targetTouches: [], changedTouches: [], bubbles: true, cancelable: true
            });
            canvas.dispatchEvent(event);
        }""")
        mobile_page.wait_for_timeout(150)
        assert not m_tooltip.is_visible(), "Mobile tooltip should hide on touchend"
        print("[TOUCH] Touchend hidden successfully")

        # 2b. Capture Mobile Screenshot
        mobile_shot = os.path.join(ARTIFACT_DIR, "symmetric_mobile_boil.png")
        mobile_page.locator("#vs-panel").screenshot(path=mobile_shot)
        print(f"\n[SCREENSHOT] Mobile saved to: {mobile_shot}")
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
    print("ALL CHECKS PASSED WITH ZERO ERRORS!")

    # Save results json
    results_path = os.path.join(ARTIFACT_DIR, "verification_symmetry_results.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"[RESULTS] Saved {results_path}")

if __name__ == "__main__":
    main()
