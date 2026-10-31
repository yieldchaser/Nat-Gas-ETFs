import http.server
import socketserver
import threading
import time
import sys
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"
PORT = 8777

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS_DIR), **kwargs)

    def log_message(self, format, *args):
        # Silence normal server logs
        pass

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()

def verify():
    # Start server in thread
    t = threading.Thread(target=run_server, daemon=True)
    t.start()
    time.sleep(0.5)

    console_errors = []
    page_errors = []
    failed_requests = []

    print(f"Serving docs at http://localhost:{PORT}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900}, device_scale_factor=2)
        page = context.new_page()

        # Capture console logs
        def on_console(msg):
            if msg.type in ["error"]:
                text = msg.text
                loc = msg.location
                print(f"[BROWSER CONSOLE ERROR] {text} (location: {loc})")
                console_errors.append(f"{text} @ {loc.get('url', '')}")

        def on_response(res):
            if res.status >= 400:
                print(f"[HTTP RESPONSE ERROR] {res.status} on {res.url}")

        page.on("response", on_response)

        def on_page_error(exc):
            print(f"[PAGE ERROR] {exc}")
            page_errors.append(str(exc))

        def on_request_failed(req):
            # If our local assets fail (404), report it
            if f"localhost:{PORT}" in req.url:
                print(f"[REQUEST FAILED] {req.url} - {req.failure}")
                failed_requests.append(f"{req.url}: {req.failure}")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("requestfailed", on_request_failed)

        # Navigate
        url = f"http://localhost:{PORT}/index.html"
        print(f"Navigating to {url}...")
        resp = page.goto(url, wait_until="networkidle")
        assert resp.status == 200, f"Failed to load index.html, status={resp.status}"

        # Wait for cards to render
        page.wait_for_selector(".etf-card", timeout=10000)
        card_count = page.locator(".etf-card").count()
        print(f"Rendered {card_count} ETF cards.")
        assert card_count == 6, f"Expected 6 ETF cards, found {card_count}"

        # Test 1: Open drawer on all 6 ETF cards via .card-tail-btn
        tickers = ["BOIL", "KOLD", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L"]
        for ticker in tickers:
            print(f"Testing TAIL button for {ticker}...")
            # Find the card with this ticker
            card = page.locator(f".etf-card[data-ticker='{ticker}']")
            assert card.count() == 1, f"Card for {ticker} not found"

            tail_btn = card.locator(".card-tail-btn")
            assert tail_btn.count() == 1, f"Tail button in card {ticker} not found"
            tail_btn.click()

            # Verify drawer is open
            drawer = page.locator("#tail-risk-drawer")
            assert "open" in drawer.get_attribute("class"), f"Drawer did not open for {ticker}"

            # Verify header badge has ticker
            badge = page.locator("#tail-header-badge")
            assert ticker in badge.text_content(), f"Badge text '{badge.text_content()}' does not contain {ticker}"

            # Verify canvas exists and is visible
            canvas = page.locator("#tail-risk-canvas")
            assert canvas.is_visible(), "Histogram canvas is not visible"
            box = canvas.bounding_box()
            assert box["width"] > 200 and box["height"] > 100, f"Canvas bounding box too small: {box}"

            # Verify KPI grid has cards
            kpi_count = page.locator(".tail-kpi-card").count()
            assert kpi_count == 10, f"Expected 10 KPI cards, found {kpi_count}"

            # Verify expectancy table has rows
            row_count = page.locator("#tail-matrix-wrap table tbody tr").count()
            assert row_count == 5, f"Expected 5 matrix rows, found {row_count}"

            # Close drawer
            close_btn = page.locator(".tail-close-btn")
            close_btn.click()
            time.sleep(0.1)
            assert "open" not in drawer.get_attribute("class"), f"Drawer failed to close for {ticker}"

        print("PASS: Tested opening & closing drawer via .card-tail-btn on all 6 ETF cards.")

        # Test 2: Open drawer via clicking .card-change (% badge)
        print("Testing open drawer via clicking .card-change badge...")
        boil_card = page.locator(".etf-card[data-ticker='BOIL']")
        chg_badge = boil_card.locator(".card-change")
        assert chg_badge.count() == 1, "BOIL card-change badge not found"
        chg_badge.click()

        drawer = page.locator("#tail-risk-drawer")
        assert "open" in drawer.get_attribute("class"), "Drawer did not open when clicking .card-change"
        print("PASS: Opened drawer via .card-change badge click.")

        # Test 3: Switching Horizons
        print("Testing switching horizons (1D, 5D, 21D)...")
        # 5D Swing
        btn_5d = page.locator("button[data-horizon='5d']")
        btn_5d.click()
        time.sleep(0.1)
        assert "active" in btn_5d.get_attribute("class"), "5D button not active"
        kpi_first = page.locator(".tail-kpi-card .tail-kpi-sub").first.text_content()
        assert "5" in kpi_first or "obs" in kpi_first, f"KPI text didn't update as expected: {kpi_first}"

        # 21D Monthly
        btn_21d = page.locator("button[data-horizon='21d']")
        btn_21d.click()
        time.sleep(0.1)
        assert "active" in btn_21d.get_attribute("class"), "21D button not active"

        # 1D Daily
        btn_1d = page.locator("button[data-horizon='1d']")
        btn_1d.click()
        time.sleep(0.1)
        assert "active" in btn_1d.get_attribute("class"), "1D button not active"
        print("PASS: Switched all horizons successfully.")

        # Test 4: Switching Regimes
        print("Testing switching regimes (Trailing 252D, Modern LNG Era, Full Inception)...")
        # Modern LNG Era
        btn_lng = page.locator("button[data-regime='lng_era']")
        btn_lng.click()
        time.sleep(0.1)
        assert "active" in btn_lng.get_attribute("class"), "LNG Era button not active"

        # Full Inception
        btn_inc = page.locator("button[data-regime='full_inception']")
        btn_inc.click()
        time.sleep(0.1)
        assert "active" in btn_inc.get_attribute("class"), "Full Inception button not active"

        # Trailing 252D
        btn_252 = page.locator("button[data-regime='trailing_252d']")
        btn_252.click()
        time.sleep(0.1)
        assert "active" in btn_252.get_attribute("class"), "Trailing 252D button not active"
        print("PASS: Switched all regimes successfully.")

        # Test 5: Switching Tickers via Chips
        print("Testing ticker switching chips...")
        for chip_text in ["KOLD", "HNU", "HND", "3NGL", "3NGS", "NG=F", "BOIL"]:
            chip = page.locator(f".tail-chip:has-text('{chip_text}')")
            assert chip.count() >= 1, f"Chip for {chip_text} not found"
            chip.click()
            time.sleep(0.1)
            badge = page.locator("#tail-header-badge")
            assert chip_text in badge.text_content(), f"Badge {badge.text_content()} missing {chip_text}"
        print("PASS: All ticker switcher chips work seamlessly.")

        # Test 6: Canvas mousemove, crosshair tracking, tooltip placement
        print("Testing canvas interactive mouse hover & tooltip...")
        canvas = page.locator("#tail-risk-canvas")
        box = canvas.bounding_box()
        tooltip = page.locator("#tail-risk-tooltip")

        # Move mouse across middle of canvas
        page.mouse.move(box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.5)
        time.sleep(0.1)
        assert tooltip.is_visible(), "Tooltip is not visible on mouse hover"
        tt_text = tooltip.text_content()
        assert "Sessions:" in tt_text and "Frequency:" in tt_text and "Cumulative:" in tt_text, f"Unexpected tooltip text: {tt_text}"

        # Move mouse out of canvas
        page.mouse.move(box["x"] - 50, box["y"] - 50)
        time.sleep(0.1)
        assert not tooltip.is_visible(), "Tooltip did not hide on mouse leave"
        print("PASS: Canvas mouse tracking and tooltip positioning verified.")

        # Test 7: Live Intraday Hook Injection & Enhancements
        print("Testing live needle and shock banner injection...")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', 12.00, 10.00)")
        time.sleep(0.1)
        banner = page.locator("#tail-shock-banner")
        banner_text = banner.text_content()
        assert "+20.00%" in banner_text, f"Shock banner missing +20.00%: {banner_text}"
        assert "CRITICAL OUTLIER" in banner_text or "ELEVATED SHOCK" in banner_text, f"Shock banner badge unexpected: {banner_text}"
        print("PASS: Live shock banner and needle update successfully.")

        # Test Issue 1: Extreme outlier empirical percentile clamping
        print("Testing Issue 1: Extreme outlier percentile clamping...")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', 50.00, 10.00)")
        time.sleep(0.1)
        banner_text_pos = banner.text_content()
        assert "100.0th Pct" in banner_text_pos, f"Expected 100.0th Pct for +400% move, got: {banner_text_pos}"
        assert "+400.00%" in banner_text_pos

        page.evaluate("TailRiskDrawer.updateLive('BOIL', 1.00, 10.00)")
        time.sleep(0.1)
        banner_text_neg = banner.text_content()
        assert "-90.00%" in banner_text_neg
        assert "0.4th Pct" in banner_text_neg or "0.0th Pct" in banner_text_neg or "0.1th Pct" in banner_text_neg, f"Expected min bin percentile for -90% move, got: {banner_text_neg}"
        print("PASS: Outlier empirical percentiles clamped correctly to bounds.")

        # Test Issue 2: Finite number guard in updateLive
        print("Testing Issue 2: Finite number guard...")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', NaN, 10.00)")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', Infinity, 10.00)")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', 12.00, -5.00)")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', 12.00, 0.00)")
        banner_text_guard = banner.text_content()
        assert "NaN" not in banner_text_guard and "Infinity" not in banner_text_guard
        print("PASS: Non-finite inputs safely rejected.")

        # Test Issue 3: KPI grid symmetry (5 cols desktop, 3 cols tablet, 2 cols mobile)
        print("Testing Issue 3: KPI grid 5-column symmetry and breakpoints...")
        kpi_count = page.locator(".tail-kpi-card").count()
        assert kpi_count == 10, f"Expected 10 KPI cards, found {kpi_count}"
        d_cols = page.evaluate("() => window.getComputedStyle(document.getElementById('tail-kpi-grid')).gridTemplateColumns.split(' ').length")
        assert d_cols == 5, f"Expected 5 columns on desktop, got {d_cols}"

        page.set_viewport_size({"width": 768, "height": 900})
        time.sleep(0.1)
        tab_cols = page.evaluate("() => window.getComputedStyle(document.getElementById('tail-kpi-grid')).gridTemplateColumns.split(' ').length")
        assert tab_cols == 3, f"Expected 3 columns on tablet (768px), got {tab_cols}"

        page.set_viewport_size({"width": 480, "height": 900})
        time.sleep(0.1)
        mob_cols = page.evaluate("() => window.getComputedStyle(document.getElementById('tail-kpi-grid')).gridTemplateColumns.split(' ').length")
        assert mob_cols == 2, f"Expected 2 columns on mobile (480px), got {mob_cols}"

        page.set_viewport_size({"width": 1400, "height": 900})
        time.sleep(0.1)
        print("PASS: KPI grid forms 5 columns on desktop, 3 on tablet, 2 on mobile.")

        # Test Item 5: Institutional tooltips on KPI cards
        print("Testing Item 5: Institutional tooltips on KPI cards...")
        cards = page.locator(".tail-kpi-card")
        for idx in range(10):
            c_tip = cards.nth(idx).get_attribute("data-tooltip")
            assert c_tip and len(c_tip) > 25, f"KPI card {idx} missing detailed tooltip: {c_tip}"

        skew_card = page.locator(".tail-kpi-card:has-text('Skewness')")
        sbox = skew_card.bounding_box()
        page.mouse.move(sbox["x"] + sbox["width"] / 2, sbox["y"] + sbox["height"] / 2)
        time.sleep(0.15)
        u_tt = page.locator("#tt")
        assert "visible" in u_tt.get_attribute("class"), "Universal tooltip #tt not visible on KPI card hover"
        assert "Fisher-Pearson" in u_tt.text_content(), f"Tooltip missing Fisher-Pearson: {u_tt.text_content()}"
        print("PASS: All 10 KPI cards have rich institutional tooltips active.")

        # Test Item 7: Mobile Viewport Drawer Scaling & Table Min-Width
        print("Testing Item 7: Mobile viewport drawer scaling (<= 600px)...")
        page.set_viewport_size({"width": 390, "height": 844})
        time.sleep(0.15)
        d_styles = page.evaluate("""() => {
            const d = document.getElementById('tail-risk-drawer');
            const s = window.getComputedStyle(d);
            return {
                width: d.offsetWidth,
                winWidth: window.innerWidth,
                borderLeftWidth: s.borderLeftWidth
            };
        }""")
        assert d_styles["width"] == d_styles["winWidth"], f"Drawer does not scale to 100vw on mobile: {d_styles}"
        assert d_styles["borderLeftWidth"] == "0px", f"Expected border-left to be 0px on mobile: {d_styles}"

        tbl_width = page.evaluate("() => document.querySelector('#tail-matrix-wrap table').offsetWidth")
        assert tbl_width >= 580, f"Matrix table min-width should be >= 580px, got {tbl_width}"
        print("PASS: Mobile drawer 100vw scaling and horizontal scroll wrapper verified.")

        # Reset viewport
        page.set_viewport_size({"width": 1400, "height": 900})
        time.sleep(0.1)

        # Test 8: Keyboard Escape to close
        print("Testing Escape key to close drawer...")
        page.keyboard.press("Escape")
        time.sleep(0.1)
        assert "open" not in drawer.get_attribute("class"), "Drawer did not close on Escape key"
        print("PASS: Escape key closes drawer.")

        # Verify console errors
        print("Verifying browser logs...")
        assert len(page_errors) == 0, f"Page errors encountered: {page_errors}"
        # Filter benign warnings/errors: third-party proxy network errors from live background polling
        critical_console_errors = [
            e for e in console_errors 
            if "favicon" not in e.lower() 
            and "csp" not in e.lower()
            and "all proxies failed" not in e.lower()
            and "corsproxy.io" not in e.lower()
            and "allorigins" not in e.lower()
            and "finance.yahoo.com" not in e.lower()
        ]
        assert len(critical_console_errors) == 0, f"Critical console errors encountered: {critical_console_errors}"
        assert len(failed_requests) == 0, f"Failed local requests (404 etc): {failed_requests}"

        browser.close()

    print("\nALL UI/UX AND BROWSER VERIFICATION TESTS PASSED WITH ZERO CONSOLE ERRORS!")
    os._exit(0)

if __name__ == "__main__":
    verify()
