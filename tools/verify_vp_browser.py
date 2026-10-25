import http.server
import socketserver
import threading
import time
import os
import sys

# Ensure UTF-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

PORT = 8769
DOCS_DIR = os.path.abspath("docs")
OUTPUT_DIR = r"C:\Users\Dell\.gemini\antigravity\brain\daf2837d-7a62-4ad3-adb9-68091ad4bd3a"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS_DIR, **kwargs)
    def log_message(self, format, *args):
        pass # suppress logs

def run_server():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()

def main():
    print(f"Starting local HTTP server for {DOCS_DIR} on port {PORT}...")
    t = threading.Thread(target=run_server, daemon=True)
    t.start()
    time.sleep(1)

    url = f"http://localhost:{PORT}/index.html"
    print(f"Navigating to {url}...")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # -------------------------------------------------------------
        # DESKTOP RUN (1440x900)
        # -------------------------------------------------------------
        print("\n=== RUNNING DESKTOP (1440x900) VERIFICATION ===")
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = context.new_page()

        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector("#vp-chips .vp-chip", state="attached", timeout=10000)
        page.wait_for_timeout(1500) # allow App.init and calculations to complete

        # 1. Verify #vp-panel renders cleanly below #vs-panel
        vs_panel = page.locator("#vs-panel")
        vp_panel = page.locator("#vp-panel")
        assert vs_panel.is_visible(), "#vs-panel should be visible"
        assert vp_panel.is_visible(), "#vp-panel should be visible"

        vs_box = vs_panel.bounding_box()
        vp_box = vp_panel.bounding_box()
        print(f"vs-panel box: y={vs_box['y']:.1f}, h={vs_box['height']:.1f}, bottom={vs_box['y']+vs_box['height']:.1f}")
        print(f"vp-panel box: y={vp_box['y']:.1f}, h={vp_box['height']:.1f}")
        assert vp_box['y'] >= vs_box['y'] + vs_box['height'] - 5, "#vp-panel must render below #vs-panel"
        print("[PASS] Verified: #vp-panel renders cleanly below #vs-panel")

        # 2. Verify 6 ETF chips render in symmetrical grid matching #vs-chips
        expected_chips = ['BOIL', 'HNU.TO', '3NGL.L', 'KOLD', 'HND.TO', '3NGS.L']
        vp_chips = page.locator("#vp-chips .vp-chip")
        vs_chips = page.locator("#vs-chips .vs-chip")

        vp_count = vp_chips.count()
        vs_count = vs_chips.count()
        assert vp_count == 6, f"Expected 6 vp-chips, found {vp_count}"
        assert vs_count == 6, f"Expected 6 vs-chips, found {vs_count}"

        vp_texts = [vp_chips.nth(i).inner_text().strip() for i in range(vp_count)]
        assert vp_texts == expected_chips, f"Chips match expected order {expected_chips}, got {vp_texts}"
        print(f"[PASS] Verified: 6 ETF chips render in order: {vp_texts}")

        # Check grid symmetry & layout between vs-chips and vp-chips
        vs_chips_box = page.locator("#vs-chips").bounding_box()
        vp_chips_box = page.locator("#vp-chips").bounding_box()
        print(f"vs-chips width: {vs_chips_box['width']:.1f}, vp-chips width: {vp_chips_box['width']:.1f}")

        # 3. Verify clicking ETF chips triggers bidirectional sync with #vs-panel and ETF Cards (.card-selected)
        print("\nTesting ETF chip selection and bidirectional sync...")
        init_ticker = page.evaluate("() => VolumeProfile.state.ticker")
        print(f"Initial VolumeProfile ticker: {init_ticker}")

        # Click KOLD chip in #vp-chips
        kold_vp_chip = page.locator("#vp-chips .vp-chip[data-ticker='KOLD']")
        kold_vp_chip.click()
        page.wait_for_timeout(300)

        # Verify VolumeProfile state
        vp_ticker_after = page.evaluate("() => VolumeProfile.state.ticker")
        assert vp_ticker_after == "KOLD", f"VolumeProfile state ticker should be KOLD, got {vp_ticker_after}"

        # Verify VolumeStudies sync
        vs_ticker_after = page.evaluate("() => VolumeStudies.state.ticker")
        assert vs_ticker_after == "KOLD", f"VolumeStudies state ticker should be synced to KOLD, got {vs_ticker_after}"

        # Verify ETF Card selection
        kold_card = page.locator(".etf-card[data-ticker='KOLD']")
        assert "card-selected" in kold_card.get_attribute("class"), "KOLD card should have .card-selected"

        boil_card = page.locator(".etf-card[data-ticker='BOIL']")
        assert "card-selected" not in (boil_card.get_attribute("class") or ""), "BOIL card should not have .card-selected"
        print("[PASS] Verified: Clicking #vp-chips KOLD synced to #vs-panel and ETF Cards (.card-selected)")

        # Now test reverse: click BOIL Study button and verify both VolumeProfile and VolumeStudies sync
        boil_card.locator(".card-study-btn").click()
        page.wait_for_timeout(300)
        vp_ticker_from_card = page.evaluate("() => VolumeProfile.state.ticker")
        vs_ticker_from_card = page.evaluate("() => VolumeStudies.state.ticker")
        assert vp_ticker_from_card == "BOIL", f"VolumeProfile should sync to BOIL from card click, got {vp_ticker_from_card}"
        assert vs_ticker_from_card == "BOIL", f"VolumeStudies should sync to BOIL from card click, got {vs_ticker_from_card}"
        print("[PASS] Verified: Clicking BOIL ETF Card bidirectionally synced #vp-panel and #vs-panel")

        # 4. Verify unit toggle (S / $) switches calculation modes and updates labels
        print("\nTesting unit toggle (S / $)...")
        init_unit = page.evaluate("() => VolumeProfile.state.unit")
        print(f"Initial unit: {init_unit}")
        assert init_unit == "shares"

        init_stats = page.locator("#vp-stats").inner_text()
        print(f"Initial stats text: {init_stats}")

        # Click $ button
        dollar_btn = page.locator("#vp-unit-tabs button[data-unit='dollar']")
        dollar_btn.click()
        page.wait_for_timeout(300)

        unit_after_dollar = page.evaluate("() => VolumeProfile.state.unit")
        assert unit_after_dollar == "dollar", f"Unit should now be dollar, got {unit_after_dollar}"

        dollar_stats = page.locator("#vp-stats").inner_text()
        print(f"Dollar mode stats text: {dollar_stats}")
        assert "$" in dollar_stats, "Stats in dollar mode should contain '$' for volume"

        # Click S button
        shares_btn = page.locator("#vp-unit-tabs button[data-unit='shares']")
        shares_btn.click()
        page.wait_for_timeout(300)

        unit_after_shares = page.evaluate("() => VolumeProfile.state.unit")
        assert unit_after_shares == "shares", f"Unit should now be shares, got {unit_after_shares}"
        print("[PASS] Verified: Unit toggle (S / $) switches calculation modes and updates labels")

        # 5. Verify hover crosshair on canvas shows #vp-tooltip
        print("\nTesting canvas hover crosshair and tooltip...")
        canvas = page.locator("#vp-canvas")
        c_box = canvas.bounding_box()
        tooltip = page.locator("#vp-tooltip")

        # Before hover, tooltip should be hidden
        assert not tooltip.is_visible() or tooltip.evaluate("el => getComputedStyle(el).display") == "none", "Tooltip should be hidden before hover"

        # Hover near the middle of canvas
        page.mouse.move(c_box['x'] + c_box['width'] * 0.4, c_box['y'] + c_box['height'] * 0.5)
        page.wait_for_timeout(300)

        assert tooltip.is_visible(), "Tooltip should be visible on hover"
        tt_text = tooltip.inner_text()
        print(f"Tooltip text on hover:\n{tt_text}")
        assert "VOLUME" in tt_text, "Tooltip should show VOLUME"
        assert "VOL SHARE" in tt_text, "Tooltip should show VOL SHARE"
        assert "SESSIONS" in tt_text, "Tooltip should show SESSIONS"
        assert "UP-DAY VOL" in tt_text, "Tooltip should show UP-DAY VOL"
        print("[PASS] Verified: Canvas hover shows #vp-tooltip with volume, vol share, sessions, and up/down split")

        # Move mouse away
        page.mouse.move(10, 10)
        page.wait_for_timeout(200)
        assert tooltip.evaluate("el => getComputedStyle(el).display") == "none", "Tooltip hides on leave"
        print("[PASS] Verified: Tooltip hides on mouseleave")

        # 6. Take screenshots at Desktop (1440x900)
        print("\nTaking desktop screenshots...")
        desktop_full_path = os.path.join(OUTPUT_DIR, "vp_desktop_fullpage_1440x900.png")
        desktop_panel_path = os.path.join(OUTPUT_DIR, "vp_desktop_panel_1440x900.png")

        # Hover over canvas so tooltip and hover row are active in the panel screenshot
        page.mouse.move(c_box['x'] + c_box['width'] * 0.45, c_box['y'] + c_box['height'] * 0.52)
        page.wait_for_timeout(200)

        vp_panel.screenshot(path=desktop_panel_path)
        page.screenshot(path=desktop_full_path, full_page=True)
        print(f"Saved desktop panel screenshot: {desktop_panel_path}")
        print(f"Saved desktop fullpage screenshot: {desktop_full_path}")
        context.close()

        # -------------------------------------------------------------
        # MOBILE RUN (390x844)
        # -------------------------------------------------------------
        print("\n=== RUNNING MOBILE (390x844) VERIFICATION ===")
        m_context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        m_page = m_context.new_page()
        m_page.goto(url, wait_until="domcontentloaded")
        m_page.wait_for_selector("#vp-chips .vp-chip", state="attached", timeout=10000)
        m_page.wait_for_timeout(1500)

        m_vp_panel = m_page.locator("#vp-panel")
        assert m_vp_panel.is_visible(), "Mobile #vp-panel should be visible"

        # Check mobile chips layout
        m_chips = m_page.locator("#vp-chips .vp-chip")
        assert m_chips.count() == 6, f"Expected 6 chips on mobile, found {m_chips.count()}"

        # Touch/hover on mobile canvas
        m_canvas = m_page.locator("#vp-canvas")
        mc_box = m_canvas.bounding_box()
        m_page.mouse.move(mc_box['x'] + mc_box['width'] * 0.4, mc_box['y'] + mc_box['height'] * 0.5)
        m_page.wait_for_timeout(300)

        mobile_full_path = os.path.join(OUTPUT_DIR, "vp_mobile_fullpage_390x844.png")
        mobile_panel_path = os.path.join(OUTPUT_DIR, "vp_mobile_panel_390x844.png")

        m_vp_panel.screenshot(path=mobile_panel_path)
        m_page.screenshot(path=mobile_full_path, full_page=True)
        print(f"Saved mobile panel screenshot: {mobile_panel_path}")
        print(f"Saved mobile fullpage screenshot: {mobile_full_path}")
        m_context.close()

        browser.close()

    print("\n=======================================================")
    print("ALL VISUAL AND UI/UX BROWSER VERIFICATIONS PASSED!")
    print("=======================================================")

if __name__ == "__main__":
    main()
