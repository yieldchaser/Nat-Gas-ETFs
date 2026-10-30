"""
Verification script for Volume Profile 6-Card KPI Grid and Terminal Title Typography.
Tests docs/index.html and docs/trough-peak.html across desktop, tablet, and mobile viewports.
"""

import http.server
import os
import re
import socketserver
import sys
import threading
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"

ARTIFACT_DIRS = [
    Path(r"C:\Users\Dell\.gemini\antigravity\brain\75e03767-7d33-493c-9790-1920e48e9876"),
    Path(r"C:\Users\Dell\.gemini\antigravity\brain\daf2837d-7a62-4ad3-adb9-68091ad4bd3a"),
]

for adir in ARTIFACT_DIRS:
    adir.mkdir(parents=True, exist_ok=True)


class QuietDocsHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS_DIR), **kwargs)

    def log_message(self, fmt, *args):
        pass


def run_verification():
    passed_assertions = 0

    port = 8769
    try:
        server = socketserver.TCPServer(("127.0.0.1", port), QuietDocsHandler)
    except OSError:
        server = socketserver.TCPServer(("127.0.0.1", 0), QuietDocsHandler)
        port = server.server_address[1]

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"[SERVER] Docs server running at http://127.0.0.1:{port}")

    base_url = f"http://127.0.0.1:{port}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        print("\n=======================================================")
        print("TEST 1: VOLUME PROFILE 6-CARD KPI GRID (DESKTOP)")
        print("=======================================================")

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        page.goto(f"{base_url}/index.html", wait_until="domcontentloaded")
        page.wait_for_selector("#vp-stats .vp-stats-grid", state="attached", timeout=15000)
        page.wait_for_timeout(1000)

        grid = page.locator("#vp-stats .vp-stats-grid")
        assert grid.is_visible(), "VP stats grid must be visible"
        passed_assertions += 1
        print("[PASS] .vp-stats-grid is visible")

        cards = page.locator("#vp-stats .vp-stats-grid .vp-card")
        card_count = cards.count()
        assert card_count == 6, f"Expected 6 cards, found {card_count}"
        passed_assertions += 1
        print(f"[PASS] 6 modular KPI cards rendered in grid (count={card_count})")

        card_selectors = [
            ".vp-card-poc",
            ".vp-card-va",
            ".vp-card-close",
            ".vp-card-tot",
            ".vp-card-up",
            ".vp-card-down",
        ]
        for sel in card_selectors:
            loc = page.locator(f"#vp-stats .vp-stats-grid {sel}")
            assert loc.count() == 1, f"Expected 1 element for {sel}"
            passed_assertions += 1
            print(f"[PASS] Card selector present: {sel}")

        # Card 1: POC
        poc_card = page.locator("#vp-stats .vp-card-poc")
        poc_label = poc_card.locator(".vp-card-label").inner_text().strip()
        assert "POINT OF CONTROL (POC)" in poc_label, f"Card 1 label mismatch: {poc_label}"
        passed_assertions += 1
        print(f"[PASS] Card 1 (POC) label verified: {poc_label}")

        poc_tag = poc_card.locator(".tag-poc").inner_text().strip()
        assert poc_tag == "POC", f"Card 1 tag mismatch: {poc_tag}"
        passed_assertions += 1
        print(f"[PASS] Card 1 (POC) tag verified: {poc_tag}")

        poc_val = poc_card.locator(".vp-card-value").inner_text().strip()
        assert poc_val.startswith("$"), f"Card 1 value must start with $, got: {poc_val}"
        passed_assertions += 1
        print(f"[PASS] Card 1 (POC) value starts with $: {poc_val}")

        poc_color = poc_card.locator(".vp-card-value").evaluate(
            "el => window.getComputedStyle(el).color"
        )
        assert poc_color in ["rgb(245, 213, 101)", "#f5d565"], f"Card 1 gold color mismatch: {poc_color}"
        passed_assertions += 1
        print(f"[PASS] Card 1 (POC) value color styling is gold: {poc_color}")

        # Card 2: Value Area
        va_card = page.locator("#vp-stats .vp-card-va")
        va_label = va_card.locator(".vp-card-label").inner_text().strip()
        assert "VALUE AREA (VA 70%)" in va_label, f"Card 2 label mismatch: {va_label}"
        passed_assertions += 1
        print(f"[PASS] Card 2 (VA) label verified: {va_label}")

        va_tag = va_card.locator(".tag-va").inner_text().strip()
        assert va_tag == "70%", f"Card 2 tag mismatch: {va_tag}"
        passed_assertions += 1
        print(f"[PASS] Card 2 (VA) tag verified: {va_tag}")

        va_val = va_card.locator(".vp-card-value").inner_text().strip()
        assert "$" in va_val and any(sep in va_val for sep in ["\u2013", "-", "\u2014"]), (
            f"Card 2 value range mismatch: {va_val}"
        )
        passed_assertions += 1
        print(f"[PASS] Card 2 (VA) formatted price range verified: {va_val}")

        # Card 3: Range Close
        close_card = page.locator("#vp-stats .vp-card-close")
        close_label = close_card.locator(".vp-card-label").inner_text().strip()
        assert "RANGE CLOSE" in close_label, f"Card 3 label mismatch: {close_label}"
        passed_assertions += 1
        print(f"[PASS] Card 3 (Range Close) label verified: {close_label}")

        pill = close_card.locator(".vp-pill")
        assert pill.is_visible(), "Status pill should be visible"
        passed_assertions += 1
        pill_text = pill.inner_text().strip()
        assert pill_text in ["ABOVE VA", "BELOW VA", "INSIDE VA"], f"Unexpected pill text: {pill_text}"
        passed_assertions += 1
        print(f"[PASS] Card 3 (Range Close) status pill verified: {pill_text}")

        # Card 4: Total Volume
        tot_card = page.locator("#vp-stats .vp-card-tot")
        tot_label = tot_card.locator(".vp-card-label").inner_text().strip()
        assert "TOTAL VOLUME" in tot_label, f"Card 4 label mismatch: {tot_label}"
        passed_assertions += 1
        print(f"[PASS] Card 4 (Total Volume) label verified: {tot_label}")

        tot_val = tot_card.locator(".vp-card-value").inner_text().strip()
        assert any(tok in tot_val for tok in ["M", "K", "B", "$"]), f"Card 4 formatted volume mismatch: {tot_val}"
        passed_assertions += 1
        print(f"[PASS] Card 4 (Total Volume) value verified: {tot_val}")

        # Card 5: Up-Day Volume
        up_card = page.locator("#vp-stats .vp-card-up")
        up_label = up_card.locator(".vp-card-label").inner_text().strip()
        assert "UP-DAY VOLUME" in up_label, f"Card 5 label mismatch: {up_label}"
        passed_assertions += 1
        print(f"[PASS] Card 5 (Up-Day Volume) label verified: {up_label}")

        up_bar = up_card.locator(".vp-delta-fill-up")
        assert up_bar.is_visible(), "Up visual delta fill bar must be visible"
        passed_assertions += 1
        up_width = up_bar.evaluate("el => el.style.width")
        assert "%" in up_width, f"Up delta fill width must have percentage, got: {up_width}"
        passed_assertions += 1
        print(f"[PASS] Card 5 (Up-Day Volume) visual bar width verified: {up_width}")

        # Card 6: Down-Day Volume
        down_card = page.locator("#vp-stats .vp-card-down")
        down_label = down_card.locator(".vp-card-label").inner_text().strip()
        assert "DOWN-DAY VOLUME" in down_label, f"Card 6 label mismatch: {down_label}"
        passed_assertions += 1
        print(f"[PASS] Card 6 (Down-Day Volume) label verified: {down_label}")

        down_bar = down_card.locator(".vp-delta-fill-down")
        assert down_bar.is_visible(), "Down visual delta fill bar must be visible"
        passed_assertions += 1
        down_width = down_bar.evaluate("el => el.style.width")
        assert "%" in down_width, f"Down delta fill width must have percentage, got: {down_width}"
        passed_assertions += 1
        print(f"[PASS] Card 6 (Down-Day Volume) visual bar width verified: {down_width}")

        print("\n=======================================================")
        print("TEST 2: TERMINAL TITLE TYPOGRAPHY AND SUBTITLE REFINEMENT")
        print("=======================================================")

        # VP Title and Subtitle
        vp_h3 = page.locator("#vp-panel .vp-head-top h3").first
        vp_h3_text = vp_h3.inner_text().strip()
        assert "VOLUME PROFILE" in vp_h3_text, f"VP header text mismatch: {vp_h3_text}"
        passed_assertions += 1
        vp_sub = page.locator("#vp-panel .panel-subtitle").first.inner_text().strip()
        assert "PRICE DISTRIBUTION" in vp_sub, f"VP subtitle text mismatch: {vp_sub}"
        passed_assertions += 1
        assert "\u00B7" in vp_sub or "." in vp_sub, f"Middle dot missing in VP subtitle: {vp_sub}"
        passed_assertions += 1
        assert "VOLUME" not in vp_sub, f"Double volume repetition detected in subtitle: {vp_sub}"
        passed_assertions += 1
        assert vp_sub == vp_sub.upper(), f"VP subtitle should be fully uppercase: {vp_sub}"
        passed_assertions += 1
        print(f"[PASS] Volume Profile title typography: '{vp_h3_text}', subtitle: '{vp_sub}'")

        # Price-Volume Studies Subtitle
        vs_h3 = page.locator("#vs-panel .vs-head h3").first
        vs_h3_text = vs_h3.inner_text().strip()
        assert "PRICE-VOLUME STUDIES" in vs_h3_text, f"VS header mismatch: {vs_h3_text}"
        passed_assertions += 1
        vs_sub = page.locator("#vs-panel .panel-subtitle").first.inner_text().strip()
        assert "TECHNICAL INDICATORS" in vs_sub, f"VS subtitle mismatch: {vs_sub}"
        passed_assertions += 1
        assert "\u00B7" in vs_sub, f"Middle dot missing in VS subtitle: {vs_sub}"
        passed_assertions += 1
        assert vs_sub == vs_sub.upper(), f"VS subtitle should be uppercase: {vs_sub}"
        passed_assertions += 1
        print(f"[PASS] Price-Volume Studies title typography: '{vs_h3_text}', subtitle: '{vs_sub}'")

        # VDDS Subtitle and Toggle Verification
        vdds_sub = page.locator("#vdds-subtitle")
        initial_vdds_text = vdds_sub.inner_text().strip()
        assert "SHARE VOLUME RELATIVE (RVOL-21D)" in initial_vdds_text, f"VDDS initial subtitle mismatch: {initial_vdds_text}"
        passed_assertions += 1
        assert "\u00B7" in initial_vdds_text, f"Middle dot missing in VDDS subtitle: {initial_vdds_text}"
        passed_assertions += 1
        assert initial_vdds_text == initial_vdds_text.upper(), f"VDDS subtitle should be uppercase: {initial_vdds_text}"
        passed_assertions += 1
        print(f"[PASS] VDDS initial subtitle verified: '{initial_vdds_text}'")

        # Click dollar/dv mode button
        dollar_btn = page.locator("#vdds-btn-dv")
        dollar_btn.click()
        page.wait_for_timeout(300)
        updated_vdds_text = vdds_sub.inner_text().strip()
        assert "VOLUME-DOLLAR DIVERGENCE" in updated_vdds_text, f"VDDS dollar mode subtitle mismatch: {updated_vdds_text}"
        passed_assertions += 1
        assert "\u00B7" in updated_vdds_text, f"Middle dot missing in updated VDDS subtitle: {updated_vdds_text}"
        passed_assertions += 1
        assert updated_vdds_text == updated_vdds_text.upper(), f"Updated VDDS subtitle should be uppercase: {updated_vdds_text}"
        passed_assertions += 1
        print(f"[PASS] VDDS dynamic toggle to dollar mode verified: '{updated_vdds_text}'")

        # Click back to volume mode button
        vol_btn = page.locator("#vdds-btn-vol")
        vol_btn.click()
        page.wait_for_timeout(300)
        restored_vdds_text = vdds_sub.inner_text().strip()
        assert "SHARE VOLUME RELATIVE (RVOL-21D)" in restored_vdds_text, f"VDDS restored subtitle mismatch: {restored_vdds_text}"
        passed_assertions += 1
        assert "\u00B7" in restored_vdds_text, f"Middle dot missing in restored VDDS subtitle: {restored_vdds_text}"
        passed_assertions += 1
        print(f"[PASS] VDDS dynamic toggle back to vol mode verified: '{restored_vdds_text}'")

        # Side-Wide Convergence Subtitle
        swvc_sub = page.locator("#swvc-panel .panel-subtitle").first.inner_text().strip()
        assert "TRI-ETF ROLLING WINDOW" in swvc_sub, f"SWVC subtitle mismatch: {swvc_sub}"
        passed_assertions += 1
        assert "\u00B7" in swvc_sub, f"Middle dot missing in SWVC subtitle: {swvc_sub}"
        passed_assertions += 1
        assert swvc_sub == swvc_sub.upper(), f"SWVC subtitle should be uppercase: {swvc_sub}"
        passed_assertions += 1
        print(f"[PASS] Side-Wide Convergence subtitle verified: '{swvc_sub}'")

        # Multi-Window Convergence Subtitle
        conv_sub = page.locator("#convergence-panel .panel-subtitle").first.inner_text().strip()
        assert "6-WINDOW PERCENTILE ALARM" in conv_sub, f"MWCA subtitle mismatch: {conv_sub}"
        passed_assertions += 1
        assert "\u00B7" in conv_sub, f"Middle dot missing in MWCA subtitle: {conv_sub}"
        passed_assertions += 1
        assert conv_sub == conv_sub.upper(), f"MWCA subtitle should be uppercase: {conv_sub}"
        passed_assertions += 1
        print(f"[PASS] Multi-Window Convergence subtitle verified: '{conv_sub}'")

        # Check trough-peak.html Subtitle
        tp_page = ctx.new_page()
        tp_page.goto(f"{base_url}/trough-peak.html", wait_until="domcontentloaded")
        tp_page.wait_for_selector("#dd-panel .tp-title", state="attached", timeout=15000)
        tp_title = tp_page.locator("#dd-panel .tp-title").first.inner_text().strip()
        assert "ETF DRAWDOWN ANALYSIS" in tp_title.upper(), f"Drawdown analysis title mismatch: {tp_title}"
        passed_assertions += 1
        tp_sub = tp_page.locator("#dd-panel .panel-subtitle").first.inner_text().strip()
        assert "PEAK-TO-TROUGH DECLINE & DURATION" in tp_sub, f"Drawdown analysis subtitle mismatch: {tp_sub}"
        passed_assertions += 1
        assert "\u00B7" in tp_sub, f"Middle dot missing in Drawdown subtitle: {tp_sub}"
        passed_assertions += 1
        assert tp_sub == tp_sub.upper(), f"Drawdown subtitle should be uppercase: {tp_sub}"
        passed_assertions += 1
        print(f"[PASS] ETF Drawdown Analysis subtitle verified: '{tp_sub}'")
        tp_page.close()

        print("\n=======================================================")
        print("TEST 3: RESPONSIVE LAYOUT VERIFICATION")
        print("=======================================================")

        # Desktop 1440x900 -> 3 columns
        cols_desktop = grid.evaluate("el => window.getComputedStyle(el).gridTemplateColumns.trim()")
        desktop_tracks = cols_desktop.split()
        assert len(desktop_tracks) == 3, f"Expected 3 columns at 1440px, got {len(desktop_tracks)}: {cols_desktop}"
        passed_assertions += 1
        print(f"[PASS] Viewport 1440x900 Desktop: exactly 3 columns verified ({cols_desktop})")

        # Capture Desktop Screenshot
        vp_panel = page.locator("#vp-panel")
        for adir in ARTIFACT_DIRS:
            out_img = adir / "vp_stats_kpi_grid_desktop.png"
            vp_panel.screenshot(path=str(out_img))
            print(f"[CAPTURE] Desktop screenshot saved to: {out_img}")

        # Tablet 768x1024 -> 2 columns
        page.set_viewport_size({"width": 768, "height": 1024})
        page.wait_for_timeout(400)
        cols_tablet = grid.evaluate("el => window.getComputedStyle(el).gridTemplateColumns.trim()")
        tablet_tracks = cols_tablet.split()
        assert len(tablet_tracks) == 2, f"Expected 2 columns at 768px, got {len(tablet_tracks)}: {cols_tablet}"
        passed_assertions += 1
        print(f"[PASS] Viewport 768x1024 Tablet: exactly 2 columns verified ({cols_tablet})")

        # Mobile 390x844 -> 1 column
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(400)
        cols_mobile = grid.evaluate("el => window.getComputedStyle(el).gridTemplateColumns.trim()")
        mobile_tracks = cols_mobile.split()
        assert len(mobile_tracks) == 1, f"Expected 1 column at 390px, got {len(mobile_tracks)}: {cols_mobile}"
        passed_assertions += 1
        print(f"[PASS] Viewport 390x844 Mobile: exactly 1 column verified ({cols_mobile})")

        # Verify no horizontal overflow in Mobile
        no_grid_overflow = grid.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        assert no_grid_overflow, "Horizontal overflow detected in .vp-stats-grid on mobile"
        passed_assertions += 1
        no_doc_overflow = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
        assert no_doc_overflow, "Horizontal overflow detected in document on mobile"
        passed_assertions += 1
        print("[PASS] Viewport 390x844 Mobile: zero horizontal overflow verified")

        # Capture Mobile Screenshot
        for adir in ARTIFACT_DIRS:
            out_img = adir / "vp_stats_kpi_grid_mobile.png"
            vp_panel.screenshot(path=str(out_img))
            print(f"[CAPTURE] Mobile screenshot saved to: {out_img}")

        ctx.close()
        browser.close()

    server.shutdown()
    print("\n=======================================================")
    print(f"ALL E2E PLAYWRIGHT TESTS PASSED! ({passed_assertions} assertions verified)")
    print("=======================================================")
    return passed_assertions


if __name__ == "__main__":
    count = run_verification()
    sys.exit(0 if count > 0 else 1)
