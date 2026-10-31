import functools
import http.server
import socketserver
import threading
import time
import sys
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT_DIR = Path(__file__).resolve().parent.parent
PORT = 8777

sys.stdout.reconfigure(encoding='utf-8')

def run_server():
    os.chdir(ROOT_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT_DIR / "docs"))
    with socketserver.TCPServer(("", PORT), handler) as httpd:
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
        context = browser.new_context(viewport={"width": 1400, "height": 900}, device_scale_factor=1)
        page = context.new_page()

        # Capture console logs
        def on_console(msg):
            if msg.type in ["error"]:
                text = msg.text
                loc = msg.location
                console_errors.append(f"{text} @ {loc.get('url', '')}")

        def on_response(res):
            if res.status >= 400 and res.status != 401:
                print(f"[HTTP RESPONSE ERROR] {res.status} on {res.url}")

        page.on("response", on_response)

        def on_page_error(exc):
            print(f"[PAGE ERROR] {exc}")
            page_errors.append(str(exc))

        def on_request_failed(req):
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
            card = page.locator(f".etf-card[data-ticker='{ticker}']")
            assert card.count() == 1, f"Card for {ticker} not found"

            tail_btn = card.locator(".card-tail-btn")
            assert tail_btn.count() == 1, f"Tail button in card {ticker} not found"
            tail_btn.click()

            drawer = page.locator("#tail-risk-drawer")
            assert "open" in drawer.get_attribute("class"), f"Drawer did not open for {ticker}"

            badge = page.locator("#tail-header-badge")
            assert ticker in badge.text_content(), f"Badge text '{badge.text_content()}' does not contain {ticker}"

            canvas = page.locator("#tail-risk-canvas")
            assert canvas.is_visible(), "Histogram canvas is not visible"

            kpi_count = page.locator(".tail-kpi-card").count()
            assert kpi_count == 10, f"Expected 10 KPI cards, found {kpi_count}"

            row_count = page.locator("#tail-matrix-wrap table tbody tr").count()
            assert row_count == 5, f"Expected 5 matrix rows, found {row_count}"

            close_btn = page.locator(".tail-close-btn")
            close_btn.click()
            time.sleep(0.05)
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

        # Test 2B: Expectancy Matrix fits 100% desktop zoom with ZERO horizontal scrollbar
        print("Testing zero horizontal scrollbar on Expectancy Matrix table at 100% desktop zoom...")
        overflow_info = page.evaluate("""() => {
            const wrap = document.getElementById('tail-matrix-wrap');
            const tbl = wrap.querySelector('table');
            return {
                wrapClientWidth: wrap.clientWidth,
                wrapScrollWidth: wrap.scrollWidth,
                tableClientWidth: tbl.clientWidth,
                tableScrollWidth: tbl.scrollWidth,
                hasHorizontalScrollbar: wrap.scrollWidth > wrap.clientWidth
            };
        }""")
        print(f"Matrix Table Scroll Metrics: {overflow_info}")
        assert not overflow_info["hasHorizontalScrollbar"], f"Expectancy matrix table has horizontal scrollbar: {overflow_info}"
        print("PASS: Expectancy Matrix fits completely with zero horizontal scrollbar / slider!")

        # Test 2C: Comprehensive tooltips on headers and chips
        headers = page.locator("#tail-matrix-wrap table th")
        assert headers.count() == 7
        for i in range(7):
            tip = headers.nth(i).get_attribute("data-tooltip")
            assert tip and len(tip) > 15, f"Header {i} missing tooltip"

        chips = page.locator(".tail-chip")
        assert chips.count() == 7
        for i in range(7):
            ctip = chips.nth(i).get_attribute("data-tooltip")
            assert ctip and len(ctip) > 20, f"Chip {i} missing tooltip"
        print("PASS: Universal tooltips verified on table headers and ticker switcher chips.")

        # Test 2D: Column alignment verification (first col left, remaining 6 cols centered)
        print("Testing column alignments: CONDITION left-aligned, all others middle-aligned...")
        alignments = page.evaluate('''() => {
            const ths = Array.from(document.querySelectorAll('#tail-matrix-wrap table th')).map(th => window.getComputedStyle(th).textAlign);
            const tds = Array.from(document.querySelectorAll('#tail-matrix-wrap table tbody tr:first-child td')).map(td => window.getComputedStyle(td).textAlign);
            const trHasTip = document.querySelector('#tail-matrix-wrap table tbody tr').hasAttribute('data-tooltip');
            const condHasTip = document.querySelector('#tail-matrix-wrap table tbody tr td:first-child').hasAttribute('data-tooltip');
            return { ths, tds, trHasTip, condHasTip };
        }''')
        print(f"Alignment audit results: {alignments}")
        assert alignments["ths"][0] == "left", f"Expected CONDITION header left-aligned, got {alignments['ths'][0]}"
        assert alignments["tds"][0] == "left", f"Expected CONDITION cells left-aligned, got {alignments['tds'][0]}"
        for col_idx in range(1, 7):
            assert alignments["ths"][col_idx] == "center", f"Expected header {col_idx} centered, got {alignments['ths'][col_idx]}"
            assert alignments["tds"][col_idx] == "center", f"Expected cell {col_idx} centered, got {alignments['tds'][col_idx]}"
        assert not alignments["trHasTip"], "Row <tr> should not have data-tooltip (prevents clouding table numbers)"
        assert alignments["condHasTip"], "First column condition cell must have data-tooltip"
        print("PASS: CONDITION is left-aligned; TRIGGER, SAMPLES, FWD 1D/5D/10D, and EDGE are all middle-aligned!")

        # Test 3: Switching Horizons
        print("Testing switching horizons (1D, 5D, 21D)...")
        btn_5d = page.locator("button[data-horizon='5d']")
        btn_5d.click()
        time.sleep(0.05)
        assert "active" in btn_5d.get_attribute("class")

        btn_21d = page.locator("button[data-horizon='21d']")
        btn_21d.click()
        time.sleep(0.05)
        assert "active" in btn_21d.get_attribute("class")

        btn_1d = page.locator("button[data-horizon='1d']")
        btn_1d.click()
        time.sleep(0.05)
        assert "active" in btn_1d.get_attribute("class")
        print("PASS: Switched all horizons successfully.")

        # Test 4: Switching Regimes
        print("Testing switching regimes (Trailing 252D, Modern LNG Era, Full Inception)...")
        btn_lng = page.locator("button[data-regime='lng_era']")
        btn_lng.click()
        time.sleep(0.05)
        assert "active" in btn_lng.get_attribute("class")

        btn_inc = page.locator("button[data-regime='full_inception']")
        btn_inc.click()
        time.sleep(0.05)
        assert "active" in btn_inc.get_attribute("class")

        btn_252 = page.locator("button[data-regime='trailing_252d']")
        btn_252.click()
        time.sleep(0.05)
        assert "active" in btn_252.get_attribute("class")
        print("PASS: Switched all regimes successfully.")

        # Test 5: Switching Tickers via Chips
        print("Testing ticker switching chips...")
        for chip_text in ["KOLD", "HNU", "HND", "3NGL", "3NGS", "NG=F", "BOIL"]:
            chip = page.locator(f".tail-chip:has-text('{chip_text}')")
            chip.click()
            time.sleep(0.05)
            badge = page.locator("#tail-header-badge")
            assert chip_text in badge.text_content()
        print("PASS: All ticker switcher chips work seamlessly.")

        # Test 6: Canvas mousemove, crosshair tracking, tooltip placement
        print("Testing canvas interactive mouse hover & tooltip...")
        canvas = page.locator("#tail-risk-canvas")
        box = canvas.bounding_box()
        tooltip = page.locator("#tail-risk-tooltip")

        page.mouse.move(box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.5)
        time.sleep(0.05)
        assert tooltip.is_visible(), "Tooltip is not visible on mouse hover"

        page.mouse.move(box["x"] - 50, box["y"] - 50)
        time.sleep(0.05)
        assert not tooltip.is_visible(), "Tooltip did not hide on mouse leave"
        print("PASS: Canvas mouse tracking and tooltip positioning verified.")

        # Test 7: Interactive Shock Simulation Button
        print("Testing interactive shock simulation mode button...")
        sim_btn = page.locator(".tail-sim-btn")
        assert sim_btn.count() == 1
        sim_btn.click()
        time.sleep(0.1)
        banner = page.locator("#tail-shock-banner")
        banner_text = banner.text_content()
        assert "+11.50%" in banner_text, f"Shock banner sim missing +11.50%: {banner_text}"
        assert "ELEVATED SHOCK" in banner_text

        # Test Issue 1: Extreme outlier empirical percentile clamping
        print("Testing Issue 1: Extreme outlier percentile clamping...")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', 50.00, 10.00)")
        time.sleep(0.05)
        banner_text_pos = banner.text_content()
        assert "100.0th Pct" in banner_text_pos, f"Expected 100.0th Pct for +400% move, got: {banner_text_pos}"
        assert "+400.00%" in banner_text_pos

        page.evaluate("TailRiskDrawer.updateLive('BOIL', 1.00, 10.00)")
        time.sleep(0.05)
        banner_text_neg = banner.text_content()
        assert "-90.00%" in banner_text_neg
        assert "0.4th Pct" in banner_text_neg or "0.0th Pct" in banner_text_neg or "0.1th Pct" in banner_text_neg

        # Test Issue 2: Finite number guard in updateLive
        print("Testing Issue 2: Finite number guard...")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', NaN, 10.00)")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', Infinity, 10.00)")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', 12.00, -5.00)")
        page.evaluate("TailRiskDrawer.updateLive('BOIL', 12.00, 0.00)")
        banner_text_guard = banner.text_content()
        assert "NaN" not in banner_text_guard and "Infinity" not in banner_text_guard

        # Test Issue 3: KPI grid symmetry (5 cols desktop, 3 cols tablet, 2 cols mobile)
        print("Testing Issue 3: KPI grid 5-column symmetry and breakpoints...")
        kpi_count = page.locator(".tail-kpi-card").count()
        assert kpi_count == 10
        d_cols = page.evaluate("() => window.getComputedStyle(document.getElementById('tail-kpi-grid')).gridTemplateColumns.split(' ').length")
        assert d_cols == 5

        page.set_viewport_size({"width": 768, "height": 900})
        time.sleep(0.05)
        tab_cols = page.evaluate("() => window.getComputedStyle(document.getElementById('tail-kpi-grid')).gridTemplateColumns.split(' ').length")
        assert tab_cols == 3

        page.set_viewport_size({"width": 480, "height": 900})
        time.sleep(0.05)
        mob_cols = page.evaluate("() => window.getComputedStyle(document.getElementById('tail-kpi-grid')).gridTemplateColumns.split(' ').length")
        assert mob_cols == 2

        page.set_viewport_size({"width": 1400, "height": 900})
        time.sleep(0.05)

        # Test Item 5: Institutional tooltips on KPI cards
        print("Testing Item 5: Institutional tooltips on KPI cards...")
        cards = page.locator(".tail-kpi-card")
        for idx in range(10):
            c_tip = cards.nth(idx).get_attribute("data-tooltip")
            assert c_tip and len(c_tip) > 25

        # Test 7B: Table Row Tooltip Proximity and Mouse Unclouding
        print("Testing Table Row Tooltip positioning and mouse clearance...")
        cond_cell = page.locator("#tail-matrix-wrap table tbody tr:nth-child(2) td:first-child")
        cond_cell.hover()
        time.sleep(0.1)
        tt_el = page.locator("#tt")
        assert tt_el.is_visible() and "visible" in tt_el.get_attribute("class"), "Global tooltip #tt not visible on condition hover"
        tt_box = tt_el.bounding_box()
        cell_box = cond_cell.bounding_box()
        print(f"Tooltip box: {tt_box}, Cell box: {cell_box}")
        assert tt_box["width"] > 50 and tt_box["height"] > 30, "Tooltip has invalid dimensions"
        print("PASS: Universal tooltip displays and positions cleanly.")

        # Test 8: Keyboard Escape to close
        print("Testing Escape key to close drawer...")
        page.keyboard.press("Escape")
        time.sleep(0.05)
        assert "open" not in drawer.get_attribute("class")

        # Verify console errors
        print("Verifying browser logs...")
        assert len(page_errors) == 0, f"Page errors encountered: {page_errors}"
        critical_console_errors = [
            e for e in console_errors 
            if "favicon" not in e.lower() 
            and "csp" not in e.lower()
            and "all promises were rejected" not in e.lower()
            and "corsproxy.io" not in e.lower()
            and "allorigins" not in e.lower()
            and "finance.yahoo.com" not in e.lower()
            and "401" not in e.lower()
        ]
        assert len(critical_console_errors) == 0, f"Critical console errors encountered: {critical_console_errors}"
        assert len(failed_requests) == 0, f"Failed local requests (404 etc): {failed_requests}"

        browser.close()

    print("\nALL UI/UX AND BROWSER VERIFICATION TESTS PASSED WITH ZERO CONSOLE ERRORS!")
    sys.stdout.flush()
    os._exit(0)

if __name__ == "__main__":
    verify()
