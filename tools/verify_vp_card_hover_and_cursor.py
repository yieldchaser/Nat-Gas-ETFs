import sys
import time
import subprocess
from playwright.sync_api import sync_playwright

BASE_PORT = 8769
BASE_URL = f"http://127.0.0.1:{BASE_PORT}"

def run_tests():
    print("=" * 65)
    print("Starting Playwright Verification: Card Borders, Floating Hover, and Cursor")
    print("=" * 65)

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(BASE_PORT), "--directory", "docs"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    time.sleep(1.2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900})

            # Navigate to index.html
            print("\nNavigating to index.html...")
            page.goto(f"{BASE_URL}/index.html", wait_until="load", timeout=30000)
            page.wait_for_selector("#vp-canvas", timeout=15000)
            page.wait_for_timeout(2000)

            # 1. Check canvas cursors in index.html
            vp_cursor = page.eval_on_selector("#vp-canvas", "el => getComputedStyle(el).cursor")
            vs_cursor = page.eval_on_selector("#vs-canvas", "el => getComputedStyle(el).cursor")
            card_cursor = page.eval_on_selector(".card-chart-interactive", "el => getComputedStyle(el).cursor")

            print(f"  #vp-canvas cursor: '{vp_cursor}'")
            print(f"  #vs-canvas cursor: '{vs_cursor}'")
            print(f"  .card-chart-interactive cursor: '{card_cursor}'")

            assert vp_cursor == "default", f"Expected 'default' cursor on #vp-canvas, got: {vp_cursor}"
            assert vs_cursor == "default", f"Expected 'default' cursor on #vs-canvas, got: {vs_cursor}"
            assert card_cursor == "default", f"Expected 'default' cursor on .card-chart-interactive, got: {card_cursor}"
            print("  All canvas cursors confirmed 'default' (no crosshair)! PASS")

            # 2. Check absence of border-left on POC and Value Area cards
            poc_border_left_width = page.eval_on_selector(".vp-card-poc", "el => getComputedStyle(el).borderLeftWidth")
            poc_border_left_style = page.eval_on_selector(".vp-card-poc", "el => getComputedStyle(el).borderLeftStyle")
            poc_border_top_width = page.eval_on_selector(".vp-card-poc", "el => getComputedStyle(el).borderTopWidth")

            va_border_left_width = page.eval_on_selector(".vp-card-va", "el => getComputedStyle(el).borderLeftWidth")
            va_border_top_width = page.eval_on_selector(".vp-card-va", "el => getComputedStyle(el).borderTopWidth")

            print(f"  .vp-card-poc border-left: {poc_border_left_width} (top: {poc_border_top_width})")
            print(f"  .vp-card-va border-left: {va_border_left_width} (top: {va_border_top_width})")

            assert poc_border_left_width == poc_border_top_width, f"Expected uniform borders on POC card, got left {poc_border_left_width} vs top {poc_border_top_width}"
            assert va_border_left_width == va_border_top_width, f"Expected uniform borders on VA card, got left {va_border_left_width} vs top {va_border_top_width}"
            print("  POC and Value Area cards confirmed with uniform borders (no 2px left border)! PASS")

            # 3. Test floating hover effect on .vp-card
            card = page.locator(".vp-card-poc")
            box_before = card.bounding_box()
            card.hover()
            page.wait_for_timeout(350)

            hover_transform = card.evaluate("el => getComputedStyle(el).transform")
            print(f"  .vp-card-poc hover transform: '{hover_transform}'")
            assert "matrix" in hover_transform and hover_transform != "none", f"Expected transform matrix on hover, got {hover_transform}"
            print("  Floating lift effect verified on hover! PASS")

            # Capture screenshot of Volume Profile panel with floating card
            vp_panel = page.locator("#vp-panel")
            vp_panel.screenshot(path="C:/Users/Dell/.gemini/antigravity/brain/daf2837d-7a62-4ad3-adb9-68091ad4bd3a/vp_floating_cards_clean_borders.png")
            print("  Saved vp_floating_cards_clean_borders.png")

            # 4. Check trough-peak.html canvas cursors
            print("\nNavigating to trough-peak.html...")
            page.goto(f"{BASE_URL}/trough-peak.html", wait_until="load", timeout=30000)
            page.wait_for_selector("#drawdown-canvas", timeout=15000)
            page.wait_for_timeout(2000)

            tp_cursor = page.eval_on_selector("#tp-canvas", "el => getComputedStyle(el).cursor")
            dd_cursor = page.eval_on_selector("#drawdown-canvas", "el => getComputedStyle(el).cursor")

            print(f"  #tp-canvas cursor: '{tp_cursor}'")
            print(f"  #drawdown-canvas cursor: '{dd_cursor}'")

            assert tp_cursor == "default", f"Expected 'default' cursor on #tp-canvas, got: {tp_cursor}"
            assert dd_cursor == "default", f"Expected 'default' cursor on #drawdown-canvas, got: {dd_cursor}"
            print("  Trough-peak canvas cursors confirmed 'default'! PASS")

            browser.close()

        print("\n" + "=" * 65)
        print("ALL VERIFICATION CHECKS PASSED (0 ERRORS)!")
        print("=" * 65 + "\n")

    finally:
        srv.terminate()

if __name__ == "__main__":
    run_tests()
