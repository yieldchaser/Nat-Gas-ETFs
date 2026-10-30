import sys
import time
import subprocess
from playwright.sync_api import sync_playwright

BASE_PORT = 8792
BASE_URL = f"http://127.0.0.1:{BASE_PORT}"
ARTIFACT_DIR = r"C:\Users\Dell\.gemini\antigravity\brain\daf2837d-7a62-4ad3-adb9-68091ad4bd3a"

def run_tests():
    print("=" * 70)
    print("VERIFYING CARD FLOATING ELEVATION & UPPER BORDER INTEGRITY")
    print("=" * 70)

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

            # ---------------------------------------------------------
            # 1. Test index.html: Volume Profile Cards & ETF Cards
            # ---------------------------------------------------------
            print("\n[1] Navigating to index.html...")
            page.goto(f"{BASE_URL}/index.html", wait_until="load", timeout=30000)
            page.wait_for_selector(".vp-card", timeout=15000)
            page.wait_for_timeout(1500)

            # Check .vp-stats overflow and padding
            vp_stats_info = page.eval_on_selector(".vp-stats", """el => {
                const s = window.getComputedStyle(el);
                return {
                    overflow: s.overflow,
                    paddingTop: parseFloat(s.paddingTop),
                    paddingBottom: parseFloat(s.paddingBottom),
                    paddingLeft: parseFloat(s.paddingLeft),
                    paddingRight: parseFloat(s.paddingRight)
                };
            }""")
            print(f"  .vp-stats overflow: '{vp_stats_info['overflow']}', paddingTop: {vp_stats_info['paddingTop']}px")
            assert vp_stats_info["overflow"] == "visible", f"Expected overflow: visible on .vp-stats, got {vp_stats_info['overflow']}"
            assert vp_stats_info["paddingTop"] >= 3.0, f"Expected paddingTop >= 3px on .vp-stats, got {vp_stats_info['paddingTop']}"
            print("  .vp-stats has visible overflow and adequate padding headroom! PASS")

            # Check .vp-card hover bounding box and upper border
            vp_card = page.locator(".vp-card-poc")
            vp_card.scroll_into_view_if_needed()
            page.wait_for_timeout(300)

            doc_y_before = page.eval_on_selector(".vp-card-poc", "el => el.getBoundingClientRect().top + window.scrollY")
            vp_card.hover()
            page.wait_for_timeout(350)
            doc_y_after = page.eval_on_selector(".vp-card-poc", "el => el.getBoundingClientRect().top + window.scrollY")

            y_shift = doc_y_after - doc_y_before
            print(f"  .vp-card-poc document y-shift on hover: {y_shift:.2f}px (expected ~ -3px)")
            assert -3.5 <= y_shift <= -2.5, f"Expected ~ -3px translateY, got {y_shift}"

            hover_styles = page.eval_on_selector(".vp-card-poc", """el => {
                const s = window.getComputedStyle(el);
                return {
                    zIndex: s.zIndex,
                    transform: s.transform,
                    borderTopWidth: s.borderTopWidth,
                    borderTopColor: s.borderTopColor,
                    boxShadow: s.boxShadow
                };
            }""")
            print(f"  .vp-card-poc hover transform: {hover_styles['transform']}")
            print(f"  .vp-card-poc hover z-index: {hover_styles['zIndex']}")
            print(f"  .vp-card-poc hover top border: {hover_styles['borderTopWidth']} {hover_styles['borderTopColor']}")
            print(f"  .vp-card-poc hover box-shadow: {hover_styles['boxShadow']}")
            assert hover_styles["zIndex"] == "2", f"Expected zIndex '2', got {hover_styles['zIndex']}"
            assert hover_styles["borderTopWidth"] == "1px", f"Expected top border 1px, got {hover_styles['borderTopWidth']}"
            assert "matrix(1, 0, 0, 1, 0, -3)" in hover_styles["transform"], f"Expected matrix translateY(-3px), got {hover_styles['transform']}"

            # Capture screenshot of vp-stats area with floating POC card
            vp_stats_el = page.locator(".vp-stats")
            vp_stats_el.screenshot(path=f"{ARTIFACT_DIR}/vp_floating_upper_border_intact.png")
            print("  Saved vp_floating_upper_border_intact.png")

            # Check .etf-card hover
            print("\n[2] Checking .etf-card elevation on index.html...")
            etf_card = page.locator(".etf-card").first
            etf_card.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            etf_y_before = page.eval_on_selector(".etf-card", "el => el.getBoundingClientRect().top + window.scrollY")
            etf_card.hover()
            page.wait_for_timeout(350)
            etf_y_after = page.eval_on_selector(".etf-card", "el => el.getBoundingClientRect().top + window.scrollY")
            etf_y_shift = etf_y_after - etf_y_before
            print(f"  .etf-card document y-shift on hover: {etf_y_shift:.2f}px (expected ~ -3px)")
            assert -3.5 <= etf_y_shift <= -2.5, f"Expected ~ -3px translateY, got {etf_y_shift}"

            etf_hover_styles = page.eval_on_selector(".etf-card", """el => {
                const s = window.getComputedStyle(el);
                return {
                    zIndex: s.zIndex,
                    transform: s.transform,
                    boxShadow: s.boxShadow
                };
            }""")
            assert etf_hover_styles["zIndex"] == "2"
            assert "matrix(1, 0, 0, 1, 0, -3)" in etf_hover_styles["transform"]
            print("  .etf-card floating elevation verified! PASS")
            etf_card.screenshot(path=f"{ARTIFACT_DIR}/etf_card_floating_elevation.png")
            print("  Saved etf_card_floating_elevation.png")

            # ---------------------------------------------------------
            # 2. Test trough-peak.html: DD KPI Cards and KPI Cards
            # ---------------------------------------------------------
            print("\n[3] Navigating to trough-peak.html...")
            page.goto(f"{BASE_URL}/trough-peak.html", wait_until="load", timeout=30000)
            page.wait_for_selector(".dd-kpi-card", timeout=15000)
            page.wait_for_timeout(1500)

            dd_kpi = page.locator(".dd-kpi-card").first
            dd_kpi.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            dd_y_before = page.eval_on_selector(".dd-kpi-card", "el => el.getBoundingClientRect().top + window.scrollY")
            dd_kpi.hover()
            page.wait_for_timeout(350)
            dd_y_after = page.eval_on_selector(".dd-kpi-card", "el => el.getBoundingClientRect().top + window.scrollY")
            dd_y_shift = dd_y_after - dd_y_before
            print(f"  .dd-kpi-card document y-shift on hover: {dd_y_shift:.2f}px (expected ~ -3px)")
            assert -3.5 <= dd_y_shift <= -2.5, f"Expected ~ -3px translateY on .dd-kpi-card, got {dd_y_shift}"

            page.locator("#dd-kpi-grid").screenshot(path=f"{ARTIFACT_DIR}/dd_kpis_floating_elevation.png")
            print("  Saved dd_kpis_floating_elevation.png")

            # Check .kpi-card hover
            kpi_card = page.locator(".kpi-card").first
            kpi_card.scroll_into_view_if_needed()
            page.mouse.move(0, 0)
            page.wait_for_timeout(300)
            kpi_transform_before = page.eval_on_selector(".kpi-card", "el => window.getComputedStyle(el).transform")
            kpi_card.hover()
            page.wait_for_timeout(350)
            kpi_transform_after = page.eval_on_selector(".kpi-card", "el => window.getComputedStyle(el).transform")
            print(f"  .kpi-card transform before: '{kpi_transform_before}', after: '{kpi_transform_after}'")
            assert "matrix(1, 0, 0, 1, 0, -3)" in kpi_transform_after, f"Expected translateY(-3px) on .kpi-card, got {kpi_transform_after}"
            print("  .kpi-card floating elevation verified! PASS")

            # ---------------------------------------------------------
            # 3. Test flows.html: Flow Cards
            # ---------------------------------------------------------
            print("\n[4] Navigating to flows.html...")
            page.goto(f"{BASE_URL}/flows.html", wait_until="load", timeout=30000)
            page.wait_for_selector(".flow-card", timeout=15000)
            page.wait_for_timeout(1500)

            flow_card = page.locator(".flow-card").first
            flow_card.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            flow_y_before = page.eval_on_selector(".flow-card", "el => el.getBoundingClientRect().top + window.scrollY")
            flow_card.hover()
            page.wait_for_timeout(350)
            flow_y_after = page.eval_on_selector(".flow-card", "el => el.getBoundingClientRect().top + window.scrollY")
            flow_y_shift = flow_y_after - flow_y_before
            print(f"  .flow-card document y-shift on hover: {flow_y_shift:.2f}px (expected ~ -3px)")
            assert -3.5 <= flow_y_shift <= -2.5, f"Expected ~ -3px translateY on .flow-card, got {flow_y_shift}"
            print("  .flow-card floating elevation verified! PASS")

            # ---------------------------------------------------------
            # 4. Test cvol.html: CVOL KPI Cards & Composite Cards
            # ---------------------------------------------------------
            print("\n[5] Navigating to cvol.html...")
            page.goto(f"{BASE_URL}/cvol.html", wait_until="load", timeout=30000)
            page.wait_for_selector(".cvol-kpi-card", timeout=15000)
            page.wait_for_timeout(1500)

            cvol_kpi = page.locator(".cvol-kpi-card").first
            cvol_kpi.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            cvol_y_before = page.eval_on_selector(".cvol-kpi-card", "el => el.getBoundingClientRect().top + window.scrollY")
            cvol_kpi.hover()
            page.wait_for_timeout(350)
            cvol_y_after = page.eval_on_selector(".cvol-kpi-card", "el => el.getBoundingClientRect().top + window.scrollY")
            cvol_y_shift = cvol_y_after - cvol_y_before
            print(f"  .cvol-kpi-card document y-shift on hover: {cvol_y_shift:.2f}px (expected ~ -3px)")
            assert -3.5 <= cvol_y_shift <= -2.5, f"Expected ~ -3px translateY on .cvol-kpi-card, got {cvol_y_shift}"
            print("  .cvol-kpi-card floating elevation verified! PASS")

            comp_card = page.locator(".composite-card").first
            comp_card.scroll_into_view_if_needed()
            page.mouse.move(0, 0)
            page.wait_for_timeout(300)
            comp_transform_before = page.eval_on_selector(".composite-card", "el => window.getComputedStyle(el).transform")
            comp_card.hover()
            page.wait_for_timeout(350)
            comp_transform_after = page.eval_on_selector(".composite-card", "el => window.getComputedStyle(el).transform")
            print(f"  .composite-card transform before: '{comp_transform_before}', after: '{comp_transform_after}'")
            assert "matrix(1, 0, 0, 1, 0, -3)" in comp_transform_after, f"Expected translateY(-3px) on .composite-card, got {comp_transform_after}"
            print("  .composite-card floating elevation verified! PASS")

            browser.close()

        print("\n" + "=" * 70)
        print("ALL FLOATING ELEVATION & BORDER RETENTION CHECKS PASSED (100% SUCCESS)!")
        print("=" * 70)

    finally:
        srv.terminate()
        srv.wait()

if __name__ == "__main__":
    run_tests()
