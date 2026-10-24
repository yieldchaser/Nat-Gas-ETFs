import sys
import time
import subprocess
import os
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

BASE_PORT = 8765
BASE_URL = f"http://127.0.0.1:{BASE_PORT}"

def run_tests():
    print("=" * 65)
    print("Starting Playwright Live Browser Verification")
    print("=" * 65)

    # Start local HTTP server
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(BASE_PORT), "--directory", "docs"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    time.sleep(1.2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            # Test 1: Real Wall-Clock Load (as of today right now)
            print("\nTest 1: Real Wall-Clock Browser Load...")
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            console_errors = []
            page.on("console", lambda m: console_errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append(f"[pageerror] {e}"))

            page.goto(f"{BASE_URL}/index.html", wait_until="load", timeout=30000)
            page.wait_for_selector("#market-status", timeout=15000)
            page.wait_for_timeout(2500)

            # Check DOM elements
            status_el = page.locator("#market-status")
            status_text_el = page.locator("#market-status .status-text")
            last_updated_el = page.locator("#last-updated")

            st_class = status_el.get_attribute("class") or ""
            st_text = status_text_el.inner_text().strip()
            lu_text = last_updated_el.inner_text().strip()

            print(f"  Live #market-status classes: '{st_class}'")
            print(f"  Live #market-status text:    '{st_text}'")
            print(f"  Live #last-updated text:     '{lu_text}'")

            # Filter console errors (tolerate network cors proxy errors if offline)
            real_errors = [e for e in console_errors if "allorigins" not in e and "net::ERR" not in e and "Failed to load resource" not in e]
            assert len(real_errors) == 0, f"JS console errors detected: {real_errors}"
            print("  Console Errors: 0 JS errors! PASS")

            # Test 2: Manual Refresh button click on current live page
            print("\nTest 2: Manual Refresh Button Click...")
            refresh_btn = page.locator("#refresh-btn")
            refresh_btn.click()
            page.wait_for_timeout(1500)

            lu_after_refresh = last_updated_el.inner_text().strip()
            print(f"  #last-updated after manual refresh: '{lu_after_refresh}'")
            # If current day is Saturday or Sunday, MUST NOT display "Prices: LIVE"
            if "WEEKEND" in st_text or "closed" in st_class:
                assert "Prices: LIVE" not in lu_after_refresh, f"CRITICAL BUG: Live prices displayed on closed/weekend: {lu_after_refresh}"
                assert "Refreshed" in lu_after_refresh, f"Expected 'Refreshed' in last-updated: {lu_after_refresh}"
                print("  Refreshed text validated properly for closed session. PASS")
            page.close()

            # Test 3: Override Clock to Saturday 2026-10-24 15:10:01 IST (09:40:01 UTC)
            print("\nTest 3: Browser Session at Saturday 2026-10-24 15:10:01 IST (Bug Report Time)...")
            sat_page = browser.new_page(viewport={"width": 1440, "height": 900})
            sat_errors = []
            sat_page.on("console", lambda m: sat_errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" else None)
            sat_page.on("pageerror", lambda e: sat_errors.append(f"[pageerror] {e}"))

            # Inject mocked Date at navigation time
            sat_page.add_init_script("""
                const fixedEpoch = new Date('2026-10-24T09:40:01Z').getTime();
                const OrigDate = Date;
                window.Date = class extends OrigDate {
                    constructor(...args) {
                        if (args.length === 0) super(fixedEpoch);
                        else super(...args);
                    }
                    static now() { return fixedEpoch; }
                };
            """)

            sat_page.goto(f"{BASE_URL}/index.html", wait_until="load", timeout=30000)
            sat_page.wait_for_selector("#market-status", timeout=15000)
            sat_page.wait_for_timeout(2500)

            sat_st_class = sat_page.locator("#market-status").get_attribute("class") or ""
            sat_st_text = sat_page.locator("#market-status .status-text").inner_text().strip()
            sat_lu_text = sat_page.locator("#last-updated").inner_text().strip()

            print(f"  #market-status classes: '{sat_st_class}'")
            print(f"  #market-status text:    '{sat_st_text}'")
            print(f"  #last-updated text:     '{sat_lu_text}'")

            assert "closed" in sat_st_class, f"Expected class 'closed' on Saturday, got: {sat_st_class}"
            assert sat_st_text == "WEEKEND", f"Expected 'WEEKEND' on Saturday, got: {sat_st_text}"
            assert "Settled Close: Fri Oct 23, 16:00 ET" in sat_lu_text, f"Expected settled close Fri Oct 23, got: {sat_lu_text}"
            assert "Prices: LIVE" not in sat_lu_text, f"CRITICAL: Live prices shown on Saturday: {sat_lu_text}"

            # Click manual refresh
            sat_page.locator("#refresh-btn").click()
            sat_page.wait_for_timeout(1500)
            sat_lu_refresh = sat_page.locator("#last-updated").inner_text().strip()
            print(f"  After manual refresh:   '{sat_lu_refresh}'")
            assert "Settled Close: Fri Oct 23, 16:00 ET" in sat_lu_refresh
            assert "(Refreshed 05:40:01 AM ET)" in sat_lu_refresh
            assert "Prices: LIVE" not in sat_lu_refresh
            print("  Saturday bug report scenario: 100% VERIFIED & PASSED!")
            sat_page.close()

            # Test 4: Override Clock to Active Regular Session (Wednesday 2026-10-21 10:30:00 ET = 14:30:00 UTC)
            print("\nTest 4: Browser Session during US Regular Market (Wednesday 10:30 ET)...")
            open_page = browser.new_page(viewport={"width": 1440, "height": 900})
            open_page.add_init_script("""
                const fixedEpoch = new Date('2026-10-21T14:30:00Z').getTime();
                const OrigDate = Date;
                window.Date = class extends OrigDate {
                    constructor(...args) {
                        if (args.length === 0) super(fixedEpoch);
                        else super(...args);
                    }
                    static now() { return fixedEpoch; }
                };
            """)
            open_page.goto(f"{BASE_URL}/index.html", wait_until="load", timeout=30000)
            open_page.wait_for_selector("#market-status", timeout=15000)
            open_page.wait_for_timeout(2500)

            open_st_class = open_page.locator("#market-status").get_attribute("class") or ""
            open_st_text = open_page.locator("#market-status .status-text").inner_text().strip()
            open_lu_text = open_page.locator("#last-updated").inner_text().strip()

            print(f"  #market-status classes: '{open_st_class}'")
            print(f"  #market-status text:    '{open_st_text}'")
            print(f"  #last-updated text:     '{open_lu_text}'")

            assert "open" in open_st_class, f"Expected class 'open' during session, got: {open_st_class}"
            assert open_st_text == "MARKET OPEN", f"Expected 'MARKET OPEN', got: {open_st_text}"
            assert "Prices: LIVE" in open_lu_text or "Updated:" in open_lu_text, f"Expected LIVE/Updated during open session, got: {open_lu_text}"
            print("  Regular session scenario: 100% VERIFIED & PASSED!")
            open_page.close()

            # Test 5: Override Clock to Good Friday Holiday (2026-04-03 11:00:00 ET = 15:00:00 UTC)
            print("\nTest 5: Browser Session during Good Friday Holiday (11:00 ET)...")
            hol_page = browser.new_page(viewport={"width": 1440, "height": 900})
            hol_page.add_init_script("""
                const fixedEpoch = new Date('2026-04-03T15:00:00Z').getTime();
                const OrigDate = Date;
                window.Date = class extends OrigDate {
                    constructor(...args) {
                        if (args.length === 0) super(fixedEpoch);
                        else super(...args);
                    }
                    static now() { return fixedEpoch; }
                };
            """)
            hol_page.goto(f"{BASE_URL}/index.html", wait_until="load", timeout=30000)
            hol_page.wait_for_selector("#market-status", timeout=15000)
            hol_page.wait_for_timeout(2500)

            hol_st_class = hol_page.locator("#market-status").get_attribute("class") or ""
            hol_st_text = hol_page.locator("#market-status .status-text").inner_text().strip()
            hol_lu_text = hol_page.locator("#last-updated").inner_text().strip()

            print(f"  #market-status classes: '{hol_st_class}'")
            print(f"  #market-status text:    '{hol_st_text}'")
            print(f"  #last-updated text:     '{hol_lu_text}'")

            assert "closed" in hol_st_class, f"Expected class 'closed' on holiday, got: {hol_st_class}"
            assert hol_st_text == "HOLIDAY CLOSED", f"Expected 'HOLIDAY CLOSED', got: {hol_st_text}"
            assert "Settled Close: Apr 2, 16:00 ET" in hol_lu_text, f"Expected Settled Close Apr 2, got: {hol_lu_text}"
            assert "Prices: LIVE" not in hol_lu_text

            print("  Holiday scenario: 100% VERIFIED & PASSED!")
            hol_page.close()

            browser.close()

        print("\n" + "=" * 65)
        print("ALL PLAYWRIGHT LIVE BROWSER TESTS PASSED (0 ERRORS)!")
        print("=" * 65 + "\n")

    finally:
        srv.terminate()

if __name__ == "__main__":
    run_tests()
