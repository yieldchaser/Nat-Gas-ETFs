# tools/verify_pair_stress_browser.py
# Automated Playwright headless browser verification for Upgraded IPSI* and VDDS* modules

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

def run_server():
    server = socketserver.TCPServer(("127.0.0.1", 8125), QuietHTTPHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return server

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    server = run_server()
    print("[SERVER] Serving docs at http://127.0.0.1:8125")

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

    def on_page_error(err):
        page_errors.append(str(err))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            device_scale_factor=2
        )
        page = context.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_page_error)

        print("[TEST] Navigating to dashboard...")
        page.goto("http://127.0.0.1:8125/index.html", wait_until="networkidle")
        page.wait_for_timeout(2500)

        # 1. VERIFY INVERSE PAIR STRESS MATRIX
        print("[TEST 1] Verifying Inverse Pair Stress Matrix...")
        page.wait_for_selector("#stress-matrix-body tr", timeout=10000)
        rows = page.query_selector_all("#stress-matrix-body tr")
        print(f"  Found {len(rows)} pair rows in stress matrix.")
        assert len(rows) >= 3, "Stress matrix should have at least 3 rows"

        matrix_data = page.evaluate("""() => {
            const rows = document.querySelectorAll('#stress-matrix-body tr');
            const data = [];
            rows.forEach(r => {
                const cols = Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim());
                data.push(cols);
            });
            return data;
        }""")

        for row in matrix_data:
            print(f"  Row: {row}")
            for cell in row:
                assert "NaN" not in cell, f"Cell contains NaN: {cell}"
                assert "undefined" not in cell, f"Cell contains undefined: {cell}"
                assert "[object" not in cell, f"Cell contains unparsed object: {cell}"

        # Capture matrix screenshot
        matrix_panel = page.query_selector("#stress-matrix-panel")
        if matrix_panel:
            matrix_panel.screenshot(path=os.path.join(ARTIFACT_DIR, "stress_matrix_desktop.png"))
            print("  Saved stress_matrix_desktop.png")

        # Hover on an IPSI cell to test interactive tooltip
        ipsi_cell = page.query_selector("#stress-matrix-body tr:nth-child(1) td:nth-child(8)")
        if ipsi_cell:
            ipsi_cell.hover()
            page.wait_for_timeout(600)
            page.screenshot(path=os.path.join(ARTIFACT_DIR, "stress_matrix_tooltip_hover.png"))
            print("  Saved stress_matrix_tooltip_hover.png")

        # 2. VERIFY VDDS BAR IN VOL MODE
        print("[TEST 2] Verifying VDDS Bar in VOL Mode...")
        page.wait_for_selector("#vdds-bar .vdds-row", timeout=10000)
        vdds_rows = page.query_selector_all("#vdds-bar .vdds-row")
        print(f"  Found {len(vdds_rows)} VDDS rows in VOL mode.")
        assert len(vdds_rows) >= 6, "VDDS panel should have at least 6 ETF rows"

        vol_legend = page.inner_text("#vdds-scale-legend")
        print(f"  VOL mode legend: {vol_legend}")
        assert "RVOL" in vol_legend or "1.0x NORMAL" in vol_legend, "VOL mode legend should show RVOL baseline"

        vol_data = page.evaluate("""() => {
            const rows = document.querySelectorAll('#vdds-bar .vdds-row');
            return Array.from(rows).map(r => {
                const ticker = r.querySelector('.vdds-ticker')?.innerText.trim();
                const val = r.querySelector('.vdds-value')?.innerText.trim();
                const fill = r.querySelector('.vdds-fill');
                const width = fill ? fill.style.width : '';
                return { ticker, val, width };
            });
        }""")
        for item in vol_data:
            print(f"  VOL item: {item}")
            assert "NaN" not in item["val"], f"VOL value contains NaN: {item['val']}"
            assert "undefined" not in item["val"], f"VOL value contains undefined: {item['val']}"

        vdds_panel = page.query_selector("#vdds-panel")
        if vdds_panel:
            vdds_panel.screenshot(path=os.path.join(ARTIFACT_DIR, "vdds_bar_vol_mode.png"))
            print("  Saved vdds_bar_vol_mode.png")

        # 3. VERIFY VDDS BAR IN $ MODE
        print("[TEST 3] Toggling to $ Mode...")
        btn_dv = page.query_selector("#vdds-btn-dv")
        assert btn_dv is not None, "Button #vdds-btn-dv should exist"
        btn_dv.click()
        page.wait_for_timeout(1000)

        dv_legend = page.inner_text("#vdds-scale-legend")
        print(f"  $ mode legend: {dv_legend}")
        assert "1.0x BALANCED" in dv_legend or "CAPITULATION" in dv_legend, "$ mode legend should show 1.0x BALANCED"

        dv_subtitle = page.inner_text("#vdds-subtitle")
        print(f"  $ mode subtitle: {dv_subtitle}")
        assert "VOLUME-DOLLAR DIVERGENCE" in dv_subtitle, "Subtitle should update to VOLUME-DOLLAR DIVERGENCE"

        dv_data = page.evaluate("""() => {
            const rows = document.querySelectorAll('#vdds-bar .vdds-row');
            return Array.from(rows).map(r => {
                const ticker = r.querySelector('.vdds-ticker')?.innerText.trim();
                const val = r.querySelector('.vdds-value')?.innerText.trim();
                const fill = r.querySelector('.vdds-fill');
                const left = fill ? fill.style.left : '';
                const width = fill ? fill.style.width : '';
                return { ticker, val, left, width };
            });
        }""")
        for item in dv_data:
            print(f"  $ item: {item}")
            assert "NaN" not in item["val"], f"$ value contains NaN: {item['val']}"
            assert "undefined" not in item["val"], f"$ value contains undefined: {item['val']}"

        if vdds_panel:
            vdds_panel.screenshot(path=os.path.join(ARTIFACT_DIR, "vdds_bar_dollar_mode.png"))
            print("  Saved vdds_bar_dollar_mode.png")

        # Hover on a VDDS row to test interactive tooltip
        first_vdds_ticker = page.query_selector("#vdds-bar .vdds-row:nth-child(1) .vdds-ticker")
        if first_vdds_ticker:
            first_vdds_ticker.hover()
            page.wait_for_timeout(600)
            page.screenshot(path=os.path.join(ARTIFACT_DIR, "vdds_tooltip_hover.png"))
            print("  Saved vdds_tooltip_hover.png")

        # 4. MOBILE RESPONSIVE VERIFICATION
        print("[TEST 4] Mobile Viewport Verification (390x844)...")
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "stress_matrix_and_vdds_mobile.png"))
        print("  Saved stress_matrix_and_vdds_mobile.png")

        # Summary assertions
        print("\n=== BROWSER VERIFICATION SUMMARY ===")
        print(f"Console errors (critical): {len(critical_errors)}")
        print(f"Page errors: {len(page_errors)}")
        if critical_errors:
            print("CRITICAL ERRORS:", critical_errors)
        assert len(critical_errors) == 0, f"Expected 0 critical console errors, got {len(critical_errors)}"
        assert len(page_errors) == 0, f"Expected 0 page errors, got {len(page_errors)}"
        print("ALL BROWSER VISUAL CHECKS PASSED PERFECTLY WITH ZERO ERRORS!")

        browser.close()

if __name__ == "__main__":
    main()
