import os
import sys
import time
import subprocess
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

PORT = 8765
BASE_URL = f"http://127.0.0.1:{PORT}"

def main():
    print("=" * 70)
    print("Starting Comprehensive Browser Verification & High-Res Screenshot Capture")
    print("=" * 70)

    # 1. Start local web server
    print(f"Starting http.server on port {PORT} for 'docs' directory...")
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--directory", "docs"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    time.sleep(1.5)

    try:
        # Run smoke.py first
        print("\n--- Running tools/smoke.py against local server ---")
        smoke_res = subprocess.run(
            [sys.executable, "tools/smoke.py", BASE_URL],
            capture_output=True,
            text=True
        )
        if smoke_res.returncode != 0:
            print(f"smoke.py failed with code {smoke_res.returncode}:")
            print(smoke_res.stdout)
            print(smoke_res.stderr)
            raise RuntimeError("smoke.py regression test failed!")
        print("tools/smoke.py PASSED perfectly!")

        # Now launch browser for in-depth card checks & visual capture
        with sync_playwright() as p:
            browser = p.chromium.launch()
            # High-DPI viewport (device_scale_factor=2 for crisp retina rendering)
            context = browser.new_context(
                viewport={"width": 1440, "height": 1050},
                device_scale_factor=2
            )
            page = context.new_page()

            console_errors = []
            page.on("console", lambda m: console_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append(f"[pageerror] {e}"))

            print(f"\nNavigating to {BASE_URL}/index.html...")
            page.goto(f"{BASE_URL}/index.html", wait_until="load", timeout=30000)
            page.wait_for_selector(".etf-card[data-ticker='KOLD']", timeout=15000)
            page.wait_for_timeout(2500)

            print("Page loaded successfully. Checking console errors...")
            real_errors = [e for e in console_errors if "allorigins" not in e and "net::ERR" not in e and "Failed to load resource" not in e]
            assert len(real_errors) == 0, f"JS console errors detected: {real_errors}"
            print("Console check passed: 0 JS errors.")

            # Verification of KOLD Card
            kold_card = page.locator(".etf-card[data-ticker='KOLD']").first
            assert kold_card.is_visible(), "KOLD card is not visible!"

            # 1. Header elements
            ticker_text = kold_card.locator(".card-ticker").inner_text().strip()
            assert ticker_text == "KOLD", f"Expected ticker KOLD, got {ticker_text}"
            
            meta_pill = kold_card.locator(".card-pill-meta").inner_text().strip()
            print(f"  KOLD meta badge text: '{meta_pill}'")
            assert "NYSE" in meta_pill and "2x" in meta_pill and "Short" in meta_pill, f"Unexpected meta pill: {meta_pill}"

            session_badge = kold_card.locator(".session-badge").inner_text().strip()
            print(f"  KOLD session badge text: '{session_badge}'")
            assert session_badge in ["LIVE", "SETTLED"], f"Unexpected session badge: {session_badge}"

            card_name = kold_card.locator(".card-name").inner_text().strip()
            print(f"  KOLD full name: '{card_name}'")
            assert "UltraShort" in card_name or "Natural Gas" in card_name, f"Unexpected card name: {card_name}"

            # 2. Check 6 Lookback Percentile Bars
            pct_rows = kold_card.locator(".share-section .percentile-row")
            pct_count = pct_rows.count()
            print(f"  KOLD share percentile bars count: {pct_count}")
            assert pct_count == 6, f"Expected 6 percentile bars, got {pct_count}"

            # Check ordinals on percentile rows
            for i in range(pct_count):
                row = pct_rows.nth(i)
                w = row.get_attribute("data-window")
                val_text = row.locator(".percentile-value").inner_text().strip()
                print(f"    Window {w}: {val_text}")
                assert val_text == "—" or any(val_text.endswith(sfx) for sfx in ["st", "nd", "rd", "th"]), f"Invalid ordinal: {val_text}"
                assert not any(val_text.endswith(err) for err in ["33th", "21th", "22th", "23th"]), f"Malformed ordinal detected: {val_text}"

            # 3. Canvas rendering checks
            spark_canvas = kold_card.locator(".card-sparkline canvas")
            vol_canvas = kold_card.locator(".card-volume-bar canvas")
            assert spark_canvas.is_visible(), "Sparkline canvas visible"
            assert vol_canvas.is_visible(), "Volume bar canvas visible"

            # 4. Dollar Mode Toggle Test
            print("\nTesting Dollar Mode toggle ($)...")
            dollar_pill = kold_card.locator(".dollar-pill")
            dollar_pill.click()
            page.wait_for_timeout(300)

            assert kold_card.get_attribute("data-mode") == "dollar", "Card mode did not switch to dollar"
            dollar_section = kold_card.locator(".dollar-section").first
            share_section = kold_card.locator(".share-section").first
            assert dollar_section.is_visible(), "Dollar section should be visible"
            assert not share_section.is_visible(), "Share section should be hidden"
            
            dv_footer = kold_card.locator(".card-dollar-volume")
            assert not dv_footer.is_visible(), "Redundant dollar volume footer should be hidden in dollar mode"
            print("  Dollar mode switch and footer suppression verified!")

            # Toggle back to share mode for standard screenshot
            share_pill = kold_card.locator(".share-pill")
            share_pill.click()
            page.wait_for_timeout(300)
            assert kold_card.get_attribute("data-mode") == "share", "Switched back to share mode"

            # 5. Study button click test
            print("\nTesting [Study ↗] button interaction...")
            study_btn = kold_card.locator(".card-study-btn")
            study_btn.click()
            page.wait_for_timeout(500)

            has_selected_cls = "card-selected" in (kold_card.get_attribute("class") or "")
            print(f"  KOLD card has .card-selected: {has_selected_cls}")
            assert has_selected_cls, "KOLD card must have .card-selected after clicking Study button"

            # 6. Capture Screenshots
            print("\nCapturing high-resolution screenshots...")
            artifact_dirs = [
                Path("C:/Users/Dell/.gemini/antigravity/brain/daf2837d-7a62-4ad3-adb9-68091ad4bd3a"),
                Path("C:/Users/Dell/.gemini/antigravity/brain/3fffb5ae-9397-41fd-9d43-1f2f273845c9")
            ]

            for ad in artifact_dirs:
                ad.mkdir(parents=True, exist_ok=True)
                # Element screenshot of KOLD card
                kold_shot_path = ad / "card_enhanced_kold.png"
                kold_card.screenshot(path=str(kold_shot_path))
                print(f"  Saved KOLD card screenshot to: {kold_shot_path}")

                # Context screenshot of the cards grid (BOIL + KOLD + UNG)
                grid_shot_path = ad / "cards_grid_overview.png"
                cards_grid = page.locator(".cards-grid").first
                if cards_grid.is_visible():
                    cards_grid.screenshot(path=str(grid_shot_path))
                    print(f"  Saved Cards Grid screenshot to: {grid_shot_path}")

            print("\n" + "=" * 70)
            print("ALL PLAYWRIGHT TESTS & SCREENSHOTS COMPLETED SUCCESSFULLY!")
            print("=" * 70)

    finally:
        srv.terminate()
        srv.wait()
        print("HTTP server stopped.")

if __name__ == "__main__":
    main()
