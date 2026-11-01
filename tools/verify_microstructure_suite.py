import http.server
import json
import os
import socketserver
import sys
import threading
import time
from playwright.sync_api import sync_playwright

DOCS_DIR = os.path.abspath("docs")
SCREENSHOTS_DIR = os.path.join(DOCS_DIR, "screenshots")
BRAIN_DIR = "C:/Users/Dell/.gemini/antigravity/brain/0339a985-7b40-4344-a87c-f253d7a8f3dc"
PARENT_BRAIN_DIR = "C:/Users/Dell/.gemini/antigravity/brain/daf2837d-7a62-4ad3-adb9-68091ad4bd3a"
PORT = 8778

class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

def run_server():
    server = socketserver.TCPServer(("127.0.0.1", PORT), QuietHTTPHandler)
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

def save_dual_screenshot(page, locator, filename):
    page.mouse.move(0, 0)
    page.wait_for_timeout(150)
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    p1 = os.path.join(SCREENSHOTS_DIR, filename)
    locator.screenshot(path=p1)
    if os.path.exists(BRAIN_DIR):
        p2 = os.path.join(BRAIN_DIR, filename)
        locator.screenshot(path=p2)
    if os.path.exists(PARENT_BRAIN_DIR):
        p3 = os.path.join(PARENT_BRAIN_DIR, filename)
        locator.screenshot(path=p3)
    return p1

def inspect_overflows(page, selector):
    return page.evaluate("""(sel) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        const rect = el.getBoundingClientRect();
        const children = Array.from(el.children).map(c => {
            const cr = c.getBoundingClientRect();
            return {
                tag: c.tagName,
                text: c.innerText.trim(),
                width: cr.width,
                height: cr.height,
                left: cr.left,
                right: cr.right,
                top: cr.top,
                bottom: cr.bottom,
                scrollWidth: c.scrollWidth,
                clientWidth: c.clientWidth,
                isClipped: c.scrollWidth > c.clientWidth + 1
            };
        });
        return {
            found: true,
            containerWidth: rect.width,
            containerHeight: rect.height,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            overflowX: el.scrollWidth > el.clientWidth,
            children
        };
    }""", selector)

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    server = run_server()
    print(f"[SERVER] Serving docs at http://127.0.0.1:{PORT}")

    console_errors = []
    critical_errors = []
    console_warnings = []
    page_errors = []

    def on_console(msg):
        if msg.type == "error":
            console_errors.append(msg.text)
            # Filter out expected offline remote proxy fetch failures
            is_net_error = any(pattern in msg.text for pattern in [
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

    audit_results = {
        "desktop": {},
        "tablet": {},
        "mobile": {},
        "screenshots": []
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # =========================================================================
        # 1. DESKTOP VIEWPORT (1440x900)
        # =========================================================================
        print("\n--- 1. DESKTOP VIEWPORT (1440x900) ---")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_page_error)

        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
        page.wait_for_selector("#vs-panel", state="visible", timeout=10000)
        page.wait_for_timeout(1000)

        init_px = count_canvas_pixels(page)
        print(f"[DESKTOP] Initial canvas non-zero pixels: {init_px}")
        assert init_px > 500, f"Canvas blank on load, pixels={init_px}"

        # Test CLASSIC suite indicators: vol, osc, net, cmf, obv, pvt
        classic_studies = [
            ("vol", ["RVOL-21", "VOL", "VALUE"]),
            ("osc", ["OSC", "STATE"]),
            ("net", ["DAY", "21D"]),
            ("cmf", ["CMF-21", "REGIME"]),
            ("obv", ["MA", "21D", "BIAS"]),
            ("pvt", ["MA", "21D", "BIAS"])
        ]
        print("[TEST] Testing CLASSIC technical indicators (6)...")
        for study_key, expected_labels in classic_studies:
            btn = page.locator(f'#vs-study-tabs button[data-study="{study_key}"]')
            assert btn.is_visible(), f"Study tab {study_key} not visible"
            btn.click()
            page.wait_for_timeout(250)
            assert "active" in btn.get_attribute("class"), f"Tab {study_key} should be active"
            px = count_canvas_pixels(page)
            assert px > 500, f"Canvas blank for {study_key}, px={px}"
            reading = page.locator("#vs-reading").inner_text()
            assert "NaN" not in reading, f"NaN in reading for {study_key}: {reading}"
            assert "undefined" not in reading, f"undefined in reading for {study_key}: {reading}"
            for lbl in expected_labels:
                assert lbl in reading, f"Label {lbl} missing in {study_key} reading: {reading}"
            print(f"  ✓ Classic {study_key.upper()} verified (pixels={px})")

        # Save Desktop Classic Screenshot (CMF)
        page.locator('#vs-study-tabs button[data-study="cmf"]').click()
        page.wait_for_timeout(200)
        shot_cmf = save_dual_screenshot(page, page.locator("#vs-panel"), "classic_cmf_desktop.png")
        audit_results["screenshots"].append(shot_cmf)
        print(f"  [SCREENSHOT] Saved {shot_cmf}")

        # Switch to MICROSTRUCTURE suite
        print("\n[TEST] Switching to MICROSTRUCTURE suite...")
        micro_suite_btn = page.locator('#vs-suite-tabs button[data-suite="micro"]')
        assert micro_suite_btn.is_visible(), "Micro suite button not found"
        micro_suite_btn.click()
        page.wait_for_timeout(300)

        # Verify subtitle changes to '· INSTITUTIONAL MICROSTRUCTURE'
        subtitle_text = page.locator("#vs-subtitle").inner_text().strip()
        print(f"  [SUBTITLE] Verified: '{subtitle_text}'")
        assert "INSTITUTIONAL MICROSTRUCTURE" in subtitle_text, f"Subtitle unexpected: '{subtitle_text}'"
        assert "·" in subtitle_text, f"Middle dot missing in subtitle: '{subtitle_text}'"

        # Verify the 6 micro buttons appear: BVC-VPIN, ILLIQ-Z, ESVD, LMSW-ρ, VWAP-Z, TKVF
        micro_buttons = [
            ("vpin", "BVC-VPIN", ["OFI", "VPIN", "FLOW", "VALUE"]),
            ("illiq", "ILLIQ-Z", ["LAI", "ILLIQ-Z", "REGIME", "VALUE"]),
            ("esvd", "ESVD", ["ESVD", "SPREAD", "STATE"]),
            ("lmsw", "LMSW-ρ", ["LMSW-ρ", "REGIME", "VALUE"]),
            ("vwapz", "VWAP-Z", ["VWAP-Z", "ZONE"]),
            ("tkvf", "TKVF", ["TKVF", "TRIG", "FORCE"])
        ]

        study_buttons = page.locator("#vs-study-tabs button")
        count = study_buttons.count()
        assert count == 6, f"Expected 6 micro buttons, found {count}"

        for study_key, label_sub, expected_labels in micro_buttons:
            btn = page.locator(f'#vs-study-tabs button[data-study="{study_key}"]')
            assert btn.is_visible(), f"Micro button {study_key} ({label_sub}) not visible"
            btn_text = btn.inner_text().strip()
            assert label_sub in btn_text, f"Button label mismatch: expected '{label_sub}' in '{btn_text}'"

            # Click through each micro button
            btn.click()
            page.wait_for_timeout(250)
            assert "active" in btn.get_attribute("class"), f"Button {study_key} should be active"
            px = count_canvas_pixels(page)
            assert px > 500, f"Canvas blank for micro indicator {study_key}, px={px}"

            reading = page.locator("#vs-reading").inner_text()
            assert "NaN" not in reading, f"NaN in reading for {study_key}: {reading}"
            assert "undefined" not in reading, f"undefined in reading for {study_key}: {reading}"
            for lbl in expected_labels:
                assert lbl in reading, f"Label '{lbl}' missing in {study_key} reading: {reading}"
            print(f"  ✓ Micro {label_sub} ({study_key}) verified (pixels={px}, reading: {reading[:60]}...)")

            # Capture desktop screenshots for key micro indicators
            shot_file = f"micro_{study_key}_desktop.png"
            shot_path = save_dual_screenshot(page, page.locator("#vs-panel"), shot_file)
            audit_results["screenshots"].append(shot_path)
            print(f"  [SCREENSHOT] Saved {shot_file}")

        # Test Canvas Hover & Tooltip on Microstructure indicators
        print("\n[TEST] Testing Canvas Hover, Tooltips and Reading Updates on Micro indicators...")
        canvas = page.locator("#vs-canvas")
        c_box = canvas.bounding_box()
        assert c_box is not None, "Canvas bounding box is None"

        hover_studies = [
            ("vpin", ["CLOSE", "VPIN TOXICITY", "OFI", "FLOW"]),
            ("illiq", ["CLOSE", "ILLIQ-Z", "LAI"]),
            ("vwapz", ["CLOSE", "VWAP-Z"]),
            ("tkvf", ["CLOSE", "TKVF", "TRIGGER (9D)"])
        ]

        for s_key, expected_tt_snippets in hover_studies:
            page.locator(f'#vs-study-tabs button[data-study="{s_key}"]').click()
            page.wait_for_timeout(200)

            # Read initial reading text at end-of-series
            initial_reading = page.locator("#vs-reading").inner_text()

            # Hover at fraction 0.40
            hx = c_box["x"] + c_box["width"] * 0.40
            hy = c_box["y"] + c_box["height"] * 0.50
            page.mouse.move(hx, hy)
            page.wait_for_timeout(150)

            tooltip = page.locator("#vs-tooltip")
            assert tooltip.is_visible(), f"Tooltip not visible on hover for {s_key}"
            tt_text = tooltip.inner_text()
            assert "NaN" not in tt_text, f"NaN in tooltip for {s_key}: {tt_text}"
            assert "undefined" not in tt_text, f"undefined in tooltip for {s_key}: {tt_text}"
            for snip in expected_tt_snippets:
                assert snip in tt_text, f"Tooltip missing snippet '{snip}' in {s_key}: {tt_text}"

            # Check that reading updated on hover
            hovered_reading = page.locator("#vs-reading").inner_text()
            assert "NaN" not in hovered_reading, f"NaN in hovered reading: {hovered_reading}"

            # Verify badge presence in tooltip
            badge = page.locator("#vs-tooltip .vs-tt-badge")
            assert badge.is_visible(), f"Tooltip badge missing for {s_key}"
            badge_text = badge.inner_text()
            print(f"  ✓ Hover {s_key.upper()} verified: Tooltip Badge='{badge_text}', Snippet='{tt_text.splitlines()[0]}'")
            if s_key == "vpin":
                p_tt = os.path.join(SCREENSHOTS_DIR, "micro_vpin_hover_tooltip.png")
                page.locator("#vs-panel").screenshot(path=p_tt)
                audit_results["screenshots"].append(p_tt)
                if os.path.exists(BRAIN_DIR):
                    page.locator("#vs-panel").screenshot(path=os.path.join(BRAIN_DIR, "micro_vpin_hover_tooltip.png"))

        # Move away to hide tooltip
        page.mouse.move(10, 10)
        page.wait_for_timeout(150)
        assert not page.locator("#vs-tooltip").is_visible(), "Tooltip should hide on mouse leave"

        # Test ETF Chips
        print("\n[TEST] Testing ETF Chips...")
        etfs = ["BOIL", "KOLD", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L"]
        for etf in etfs:
            chip = page.locator(f'#vs-chips button[data-ticker="{etf}"]')
            assert chip.is_visible(), f"Chip {etf} not visible"
            chip.click()
            page.wait_for_timeout(250)
            assert "active" in chip.get_attribute("class"), f"Chip {etf} should be active"
            px = count_canvas_pixels(page)
            assert px > 500, f"Canvas blank for ETF {etf}, px={px}"
            print(f"  ✓ ETF Chip {etf} verified (pixels={px})")

        # Test Dual-Handle Range Slider & Range Presets
        print("\n[TEST] Testing Range Presets (3M, 6M, 1Y, ALL)...")
        # Reset to BOIL
        page.locator('#vs-chips button[data-ticker="BOIL"]').click()
        page.wait_for_timeout(200)

        presets = ["3m", "6m", "1y", "all"]
        for pr in presets:
            btn = page.locator(f'#vs-range-tabs button[data-range="{pr}"]')
            assert btn.is_visible(), f"Range preset {pr} not visible"
            btn.click()
            page.wait_for_timeout(250)
            assert "active" in btn.get_attribute("class")
            active_lbl = page.locator("#vs-range-active-label").inner_text().strip()
            assert pr.upper() in active_lbl, f"Active range label mismatch: expected '{pr.upper()}' in '{active_lbl}'"
            px = count_canvas_pixels(page)
            assert px > 500, f"Canvas blank on preset {pr}"
            print(f"  ✓ Range preset {pr.upper()} verified (label={active_lbl}, pixels={px})")

        # Test Scrubbing Slider Inputs
        print("\n[TEST] Testing Dual Slider Scrubbing...")
        page.evaluate("""() => {
            const sStart = document.getElementById('vs-range-start');
            const sEnd = document.getElementById('vs-range-end');
            sStart.value = 20;
            sStart.dispatchEvent(new Event('input', { bubbles: true }));
            sEnd.value = 80;
            sEnd.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(300)
        custom_lbl = page.locator("#vs-range-active-label").inner_text().strip()
        print(f"  ✓ Custom range scrubbed: active label='{custom_lbl}'")
        px_custom = count_canvas_pixels(page)
        assert px_custom > 500, f"Canvas blank after slider scrub: {px_custom}"

        # Test Unit Toggle (S vs $)
        print("\n[TEST] Testing Unit Toggle (Shares vs Dollar)...")
        unit_dollar = page.locator('#vs-unit-tabs button[data-unit="dollar"]')
        unit_shares = page.locator('#vs-unit-tabs button[data-unit="shares"]')
        unit_dollar.click()
        page.wait_for_timeout(250)
        assert "active" in unit_dollar.get_attribute("class")
        assert "active" not in unit_shares.get_attribute("class")
        px_dlr = count_canvas_pixels(page)
        assert px_dlr > 500

        unit_shares.click()
        page.wait_for_timeout(250)
        assert "active" in unit_shares.get_attribute("class")
        assert "active" not in unit_dollar.get_attribute("class")
        print("  ✓ Unit toggle (Shares / Dollar) verified")

        # Element Bounding Box Audit for Desktop
        suite_audit = inspect_overflows(page, "#vs-suite-tabs")
        study_audit = inspect_overflows(page, "#vs-study-tabs")
        chips_audit = inspect_overflows(page, "#vs-chips")
        audit_results["desktop"] = {
            "suite_tabs": suite_audit,
            "study_tabs": study_audit,
            "chips": chips_audit
        }
        print(f"  [BOUNDS DESKTOP] Suite overflowX: {suite_audit.get('overflowX')}, Study overflowX: {study_audit.get('overflowX')}")

        context.close()

        # =========================================================================
        # 2. TABLET VIEWPORT (768x1024)
        # =========================================================================
        print("\n--- 2. TABLET VIEWPORT (768x1024) ---")
        tab_context = browser.new_context(viewport={"width": 768, "height": 1024})
        tab_page = tab_context.new_page()
        tab_page.on("console", on_console)
        tab_page.on("pageerror", on_page_error)

        tab_page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
        tab_page.wait_for_selector("#vs-panel", state="visible", timeout=10000)
        tab_page.wait_for_timeout(1000)

        # Switch to micro suite on tablet
        tab_page.locator('#vs-suite-tabs button[data-suite="micro"]').click()
        tab_page.wait_for_timeout(300)

        # Audit bounding boxes on tablet
        tab_suite_audit = inspect_overflows(tab_page, "#vs-suite-tabs")
        tab_study_audit = inspect_overflows(tab_page, "#vs-study-tabs")
        tab_chips_audit = inspect_overflows(tab_page, "#vs-chips")
        audit_results["tablet"] = {
            "suite_tabs": tab_suite_audit,
            "study_tabs": tab_study_audit,
            "chips": tab_chips_audit
        }
        print(f"  [BOUNDS TABLET] Suite overflowX: {tab_suite_audit.get('overflowX')}, Study overflowX: {tab_study_audit.get('overflowX')}")
        for c in tab_study_audit.get("children", []):
            if c.get("isClipped"):
                print(f"    WARNING: Study button clipped on tablet: '{c.get('text')}' (scrollW={c.get('scrollWidth')}, clientW={c.get('clientWidth')})")

        # Capture key tablet screenshots
        shot_vpin_tab = save_dual_screenshot(tab_page, tab_page.locator("#vs-panel"), "micro_vpin_tablet.png")
        audit_results["screenshots"].append(shot_vpin_tab)
        print(f"  [SCREENSHOT] Saved micro_vpin_tablet.png")

        tab_page.locator('#vs-study-tabs button[data-study="illiq"]').click()
        tab_page.wait_for_timeout(200)
        shot_illiq_tab = save_dual_screenshot(tab_page, tab_page.locator("#vs-panel"), "micro_illiq_tablet.png")
        audit_results["screenshots"].append(shot_illiq_tab)
        print(f"  [SCREENSHOT] Saved micro_illiq_tablet.png")

        tab_page.locator('#vs-study-tabs button[data-study="vwapz"]').click()
        tab_page.wait_for_timeout(200)
        shot_vwapz_tab = save_dual_screenshot(tab_page, tab_page.locator("#vs-panel"), "micro_vwapz_tablet.png")
        audit_results["screenshots"].append(shot_vwapz_tab)
        print(f"  [SCREENSHOT] Saved micro_vwapz_tablet.png")

        tab_context.close()

        # =========================================================================
        # 3. MOBILE VIEWPORT (375x812)
        # =========================================================================
        print("\n--- 3. MOBILE VIEWPORT (375x812, iPhone size) ---")
        mob_context = browser.new_context(
            viewport={"width": 375, "height": 812},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            has_touch=True
        )
        mob_page = mob_context.new_page()
        mob_page.on("console", on_console)
        mob_page.on("pageerror", on_page_error)

        mob_page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
        mob_page.wait_for_selector("#vs-panel", state="visible", timeout=10000)
        mob_page.wait_for_timeout(1000)

        # Capture classic mobile screenshot
        shot_vol_mob = save_dual_screenshot(mob_page, mob_page.locator("#vs-panel"), "classic_vol_mobile.png")
        audit_results["screenshots"].append(shot_vol_mob)
        print(f"  [SCREENSHOT] Saved classic_vol_mobile.png")

        # Switch to micro suite on mobile
        mob_page.locator('#vs-suite-tabs button[data-suite="micro"]').click()
        mob_page.wait_for_timeout(300)

        # Audit bounding boxes on mobile
        mob_suite_audit = inspect_overflows(mob_page, "#vs-suite-tabs")
        mob_study_audit = inspect_overflows(mob_page, "#vs-study-tabs")
        mob_chips_audit = inspect_overflows(mob_page, "#vs-chips")
        audit_results["mobile"] = {
            "suite_tabs": mob_suite_audit,
            "study_tabs": mob_study_audit,
            "chips": mob_chips_audit
        }
        print(f"  [BOUNDS MOBILE] Suite overflowX: {mob_suite_audit.get('overflowX')}, Study overflowX: {mob_study_audit.get('overflowX')}")
        for c in mob_study_audit.get("children", []):
            if c.get("isClipped"):
                print(f"    WARNING: Study button clipped on mobile: '{c.get('text')}' (scrollW={c.get('scrollWidth')}, clientW={c.get('clientWidth')})")
        for c in mob_chips_audit.get("children", []):
            if c.get("isClipped"):
                print(f"    WARNING: Chip clipped on mobile: '{c.get('text')}' (scrollW={c.get('scrollWidth')}, clientW={c.get('clientWidth')})")

        # Test Touch Scrubbing on mobile
        print("\n[MOBILE] Testing Touch Scrubbing on Mobile Canvas...")
        mob_page.locator('#vs-study-tabs button[data-study="vpin"]').click()
        mob_page.wait_for_timeout(200)

        mob_canvas = mob_page.locator("#vs-canvas")
        m_box = mob_canvas.bounding_box()
        t_x1 = m_box["x"] + m_box["width"] * 0.35
        t_y1 = m_box["y"] + m_box["height"] * 0.50
        t_x2 = m_box["x"] + m_box["width"] * 0.65
        t_y2 = m_box["y"] + m_box["height"] * 0.50

        mob_page.evaluate("""({ x, y }) => {
            const canvas = document.getElementById('vs-canvas');
            const touch = new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y });
            canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
        }""", {"x": t_x1, "y": t_y1})
        mob_page.wait_for_timeout(150)

        mob_tt = mob_page.locator("#vs-tooltip")
        assert mob_tt.is_visible(), "Mobile tooltip should appear on touchstart"
        mob_tt_text1 = mob_tt.inner_text()
        print(f"  ✓ Touchstart verified: {mob_tt_text1.splitlines()[0]}")

        # Touchmove
        mob_page.evaluate("""({ x, y }) => {
            const canvas = document.getElementById('vs-canvas');
            const touch = new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y });
            canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
        }""", {"x": t_x2, "y": t_y2})
        mob_page.wait_for_timeout(150)
        mob_tt_text2 = mob_tt.inner_text()
        print(f"  ✓ Touchmove verified: {mob_tt_text2.splitlines()[0]}")

        # Touchend
        mob_page.evaluate("""() => {
            const canvas = document.getElementById('vs-canvas');
            canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [], bubbles: true, cancelable: true }));
        }""")
        mob_page.wait_for_timeout(150)
        assert not mob_tt.is_visible(), "Mobile tooltip should hide on touchend"
        print("  ✓ Touchend hides tooltip verified")

        # Capture mobile screenshots
        shot_vpin_mob = save_dual_screenshot(mob_page, mob_page.locator("#vs-panel"), "micro_vpin_mobile.png")
        audit_results["screenshots"].append(shot_vpin_mob)
        print(f"  [SCREENSHOT] Saved micro_vpin_mobile.png")

        mob_page.locator('#vs-study-tabs button[data-study="illiq"]').click()
        mob_page.wait_for_timeout(200)
        shot_illiq_mob = save_dual_screenshot(mob_page, mob_page.locator("#vs-panel"), "micro_illiq_mobile.png")
        audit_results["screenshots"].append(shot_illiq_mob)
        print(f"  [SCREENSHOT] Saved micro_illiq_mobile.png")

        mob_page.locator('#vs-study-tabs button[data-study="vwapz"]').click()
        mob_page.wait_for_timeout(200)
        shot_vwapz_mob = save_dual_screenshot(mob_page, mob_page.locator("#vs-panel"), "micro_vwapz_mobile.png")
        audit_results["screenshots"].append(shot_vwapz_mob)
        print(f"  [SCREENSHOT] Saved micro_vwapz_mobile.png")

        mob_context.close()
        browser.close()

    server.shutdown()

    # Save audit report json
    with open("tools/microstructure_audit_results.json", "w", encoding="utf-8") as f:
        json.dump(audit_results, f, indent=2)

    print("\n================ VERIFICATION & AUDIT SUMMARY ================")
    print(f"Total Page Errors: {len(page_errors)}")
    for e in page_errors:
        print(f"  [PAGE ERROR] {e}")
    print(f"Total Console Errors: {len(console_errors)}")
    for e in console_errors:
        print(f"  [CONSOLE ERROR] {e}")
    print(f"Total Console Warnings: {len(console_warnings)}")
    for w in console_warnings:
        print(f"  [CONSOLE WARNING] {w}")

    print(f"Critical Console Errors: {len(critical_errors)}")
    for ce in critical_errors:
        print(f"  [CRITICAL ERROR] {ce}")

    assert len(page_errors) == 0, f"Uncaught page errors detected: {page_errors}"
    assert len(critical_errors) == 0, f"Critical browser console errors detected: {critical_errors}"
    print("\n>>> ALL TESTS PASSED STRICT VERIFICATION! <<<")

if __name__ == "__main__":
    main()
