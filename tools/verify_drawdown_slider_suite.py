"""
Playwright E2E Verification Suite for ETF Drawdown Analysis with Range Slider
Verifies:
1. Mode Switch and Absence of Ancient ATH Flatline (BOIL, KOLD, 3NGS)
2. Dual Handle Range Slider DOM Hierarchy and Elements
3. Bidirectional Horizon Synchronization (1Y, ALL)
4. Range Slider Scrubbing and Dynamic KPI Cards Updates
5. Interactive Canvas Hover Tooltip
"""

import http.server
import socketserver
import threading
import os
import sys
import time
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ARTIFACT_DIR = Path(r"C:\Users\Dell\.gemini\antigravity\brain\45b73ffa-a486-48c1-b114-5d50e383e010")
PARENT_DIR = Path(r"C:\Users\Dell\.gemini\antigravity\brain\daf2837d-7a62-4ad3-adb9-68091ad4bd3a")

ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
if PARENT_DIR.exists():
    PARENT_DIR.mkdir(parents=True, exist_ok=True)

class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        repo_root = Path(__file__).resolve().parent.parent
        super().__init__(*args, directory=str(repo_root), **kwargs)

    def log_message(self, format, *args):
        pass

def run_suite():
    assertion_count = 0
    server = socketserver.TCPServer(("127.0.0.1", 0), QuietHTTPHandler)
    port = server.server_address[1]
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"[SERVER] Local HTTP server active on http://127.0.0.1:{port}")

    url = f"http://127.0.0.1:{port}/docs/trough-peak.html"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
        page = context.new_page()

        console_errors = []
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        print(f"[NAVIGATE] Loading target URL: {url}")
        page.goto(url, wait_until="domcontentloaded")

        page.wait_for_function("""() => {
            const el = document.querySelector('#dd-kpi-cur .dd-kpi-val');
            return el && el.textContent.includes('%') && !el.textContent.includes('NaN');
        }""", timeout=15000)

        time.sleep(1.0)
        dd_panel = page.locator("#dd-panel")
        dd_panel.scroll_into_view_if_needed()
        time.sleep(0.5)

        # TEST 1: Mode Switch & Absence of Ancient ATH Flatline
        print("\n============================================================")
        print("TEST 1: Mode Switch and Absence of Ancient ATH Flatline")
        print("============================================================")

        mode_tabs = page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('#dd-mode-tabs .tab-btn'));
            return btns.map(b => ({
                text: b.textContent.trim(),
                mode: b.getAttribute('data-mode'),
                isActive: b.classList.contains('active')
            }));
        }""")
        print(f"Discovered mode tabs: {mode_tabs}")

        tab_modes = [t["mode"] for t in mode_tabs]
        assert "rolling_52w" in tab_modes, "Missing rolling_52w tab"
        assertion_count += 1
        assert "rolling_2y" in tab_modes, "Missing rolling_2y tab"
        assertion_count += 1
        assert "ath" not in tab_modes, "ALL-TIME HIGH mode tab must be absent"
        assertion_count += 1

        active_tab = next(t for t in mode_tabs if t["mode"] == "rolling_52w")
        assert active_tab["isActive"], "ROLLING 52W should be active by default"
        assertion_count += 1

        # Check absence of ancient ATH flatline on BOIL, KOLD, 3NGS
        test_tickers = ["BOIL", "KOLD", "3NGS.L"]
        for ticker in test_tickers:
            # Click ETF chip or activate tab
            page.evaluate(f"""(tk) => {{
                const chips = Array.from(document.querySelectorAll('#dd-etf-chips .etf-chip'));
                const chip = chips.find(c => c.textContent.trim().startsWith(tk.split('.')[0]));
                if (chip) chip.click();
            }}""", ticker)
            time.sleep(0.4)

            kpi_values = page.evaluate("""() => {
                const cur = document.querySelector('#dd-kpi-cur .dd-kpi-val')?.textContent.trim();
                const mdd = document.querySelector('#dd-kpi-mdd .dd-kpi-val')?.textContent.trim();
                const uw = document.querySelector('#dd-kpi-underwater .dd-kpi-val')?.textContent.trim();
                return { cur, mdd, uw };
            }""")
            print(f"Ticker {ticker} Rolling 52W KPIs: {kpi_values}")

            uw_match = re.search(r"(\d+)d", kpi_values["uw"])
            assert uw_match is not None, f"Underwater days pattern missing for {ticker}: {kpi_values['uw']}"
            assertion_count += 1
            days = int(uw_match.group(1))
            assert days <= 370, f"Underwater days for {ticker} ({days}) exceeds 52W ceiling"
            assertion_count += 1
            assert days < 4000, f"Ancient ATH flatline detected for {ticker}: {days} days underwater"
            assertion_count += 1
            assert kpi_values["cur"] != "-100.0%", f"{ticker} has flat -100.0% current drawdown"
            assertion_count += 1

        # Reset back to BOIL
        page.evaluate("""() => {
            const chips = Array.from(document.querySelectorAll('#dd-etf-chips .etf-chip'));
            const boilChip = chips.find(c => c.textContent.trim().startsWith('BOIL'));
            if (boilChip) boilChip.click();
        }""")
        time.sleep(0.4)

        # Switch to ROLLING 2Y
        print("Clicking ROLLING 2Y mode tab...")
        page.locator('#dd-mode-tabs button[data-mode="rolling_2y"]').click()
        time.sleep(0.5)

        badge_2y = page.locator("#dd-badge").text_content().strip()
        print(f"Badge after ROLLING 2Y switch: {badge_2y}")
        assert badge_2y == "ROLLING 2Y · ALL", f"Unexpected badge text: {badge_2y}"
        assertion_count += 1

        pk_label = page.locator("#dd-kpi-peak .dd-kpi-lbl").text_content().strip()
        assert "2Y PEAK REFERENCE" in pk_label, f"Peak label unexpected: {pk_label}"
        assertion_count += 1

        kpis_2y = page.evaluate("""() => {
            const cur = document.querySelector('#dd-kpi-cur .dd-kpi-val')?.textContent.trim();
            const mdd = document.querySelector('#dd-kpi-mdd .dd-kpi-val')?.textContent.trim();
            const pk = document.querySelector('#dd-kpi-peak .dd-kpi-val')?.textContent.trim();
            const uw = document.querySelector('#dd-kpi-underwater .dd-kpi-val')?.textContent.trim();
            return { cur, mdd, pk, uw };
        }""")
        print(f"ROLLING 2Y KPI metrics: {kpis_2y}")
        assert "%" in kpis_2y["cur"] and "NaN" not in kpis_2y["cur"], "Invalid cur KPI in 2Y mode"
        assertion_count += 1
        assert "%" in kpis_2y["mdd"] and "NaN" not in kpis_2y["mdd"], "Invalid mdd KPI in 2Y mode"
        assertion_count += 1
        assert "$" in kpis_2y["pk"] and "NaN" not in kpis_2y["pk"], "Invalid pk KPI in 2Y mode"
        assertion_count += 1
        assert "d" in kpis_2y["uw"] and "NaN" not in kpis_2y["uw"], "Invalid uw KPI in 2Y mode"
        assertion_count += 1

        # Capture screenshot for ROLLING 2Y
        shot_path_2y = ARTIFACT_DIR / "drawdown_rolling_2y.png"
        dd_panel.screenshot(path=str(shot_path_2y))
        if PARENT_DIR.exists():
            dd_panel.screenshot(path=str(PARENT_DIR / "drawdown_rolling_2y.png"))
        print(f"Saved screenshot: {shot_path_2y}")

        # Switch back to ROLLING 52W
        page.locator('#dd-mode-tabs button[data-mode="rolling_52w"]').click()
        time.sleep(0.4)
        badge_52w = page.locator("#dd-badge").text_content().strip()
        assert badge_52w == "ROLLING 52W · ALL", f"Unexpected badge text: {badge_52w}"
        assertion_count += 1

        shot_path_52w = ARTIFACT_DIR / "drawdown_panel_rolling_52w.png"
        dd_panel.screenshot(path=str(shot_path_52w))
        if PARENT_DIR.exists():
            dd_panel.screenshot(path=str(PARENT_DIR / "drawdown_panel_rolling_52w.png"))
        print(f"Saved screenshot: {shot_path_52w}")
        print("PASS: TEST 1 Mode switch and ATH flatline absence verified.")

        # TEST 2: Dual Handle Range Slider Existence and Styling
        print("\n============================================================")
        print("TEST 2: Dual Handle Range Slider Existence and Layout")
        print("============================================================")

        slider_elements = page.evaluate("""() => {
            const container = document.getElementById('dd-range-slider-container');
            const wrap = document.getElementById('dd-range-wrap');
            const start = document.getElementById('dd-range-start');
            const end = document.getElementById('dd-range-end');
            const highlight = document.getElementById('dd-range-highlight');
            const label = document.getElementById('dd-range-active-label');

            if (!container || !wrap || !start || !end || !highlight || !label) {
                return { ok: false, error: 'One or more slider elements missing' };
            }

            const prevElem = container.previousElementSibling;
            const nextElem = container.nextElementSibling;

            const isDirectlyBelowChips = prevElem && prevElem.id === 'dd-etf-chips';
            const isDirectlyAboveFooter = nextElem && nextElem.classList.contains('chart-footer');

            return {
                ok: isDirectlyBelowChips && isDirectlyAboveFooter,
                hasContainer: !!container,
                hasWrap: !!wrap,
                hasStart: !!start,
                hasEnd: !!end,
                hasHighlight: !!highlight,
                hasLabel: !!label,
                isDirectlyBelowChips,
                isDirectlyAboveFooter,
                prevTag: prevElem?.id || prevElem?.className,
                nextTag: nextElem?.className
            };
        }""")
        print(f"Slider DOM checks: {slider_elements}")
        assert slider_elements["hasContainer"], "Missing #dd-range-slider-container"
        assertion_count += 1
        assert slider_elements["hasWrap"], "Missing #dd-range-wrap"
        assertion_count += 1
        assert slider_elements["hasStart"], "Missing #dd-range-start"
        assertion_count += 1
        assert slider_elements["hasEnd"], "Missing #dd-range-end"
        assertion_count += 1
        assert slider_elements["hasHighlight"], "Missing #dd-range-highlight"
        assertion_count += 1
        assert slider_elements["hasLabel"], "Missing #dd-range-active-label"
        assertion_count += 1
        assert slider_elements["isDirectlyBelowChips"], "Slider is not directly below #dd-etf-chips"
        assertion_count += 1
        assert slider_elements["isDirectlyAboveFooter"], "Slider is not directly above .chart-footer"
        assertion_count += 1
        print("PASS: TEST 2 Dual handle range slider existence and layout verified.")

        # TEST 3: Bidirectional Horizon Synchronization
        print("\n============================================================")
        print("TEST 3: Bidirectional Horizon Synchronization")
        print("============================================================")

        print("Clicking 1Y horizon button...")
        page.locator('#dd-horizon-group button[data-horizon="1y"]').click()
        time.sleep(0.4)

        sync_1y = page.evaluate("""() => {
            const start = document.getElementById('dd-range-start');
            const end = document.getElementById('dd-range-end');
            const label = document.getElementById('dd-range-active-label');
            const highlight = document.getElementById('dd-range-highlight');

            const sVal = parseInt(start.value);
            const eVal = parseInt(end.value);
            const maxVal = parseInt(start.max);

            return {
                sVal,
                eVal,
                maxVal,
                labelText: label.textContent.trim(),
                highlightLeft: highlight.style.left,
                highlightWidth: highlight.style.width
            };
        }""")
        print(f"1Y sync state: {sync_1y}")
        assert sync_1y["labelText"] == "PRESET: 1Y", f"Unexpected label: {sync_1y['labelText']}"
        assertion_count += 1
        assert sync_1y["eVal"] == sync_1y["maxVal"], "End value does not match max in 1Y preset"
        assertion_count += 1
        assert sync_1y["sVal"] > 0, "Start value should be greater than 0 for 1Y preset"
        assertion_count += 1
        assert sync_1y["sVal"] < sync_1y["maxVal"], "Start value should be less than max for 1Y preset"
        assertion_count += 1
        assert sync_1y["highlightLeft"] != "", "Highlight left style must be set"
        assertion_count += 1
        assert sync_1y["highlightWidth"] != "", "Highlight width style must be set"
        assertion_count += 1

        print("Clicking ALL horizon button...")
        page.locator('#dd-horizon-group button[data-horizon="all"]').click()
        time.sleep(0.4)

        sync_all = page.evaluate("""() => {
            const start = document.getElementById('dd-range-start');
            const end = document.getElementById('dd-range-end');
            const label = document.getElementById('dd-range-active-label');

            return {
                sVal: parseInt(start.value),
                eVal: parseInt(end.value),
                maxVal: parseInt(start.max),
                labelText: label.textContent.trim()
            };
        }""")
        print(f"ALL sync state: {sync_all}")
        assert sync_all["labelText"] == "ALL DATA", f"Unexpected label: {sync_all['labelText']}"
        assertion_count += 1
        assert sync_all["sVal"] == 0, "Start value not reset to 0 in ALL preset"
        assertion_count += 1
        assert sync_all["eVal"] == sync_all["maxVal"], "End value not set to max in ALL preset"
        assertion_count += 1
        print("PASS: TEST 3 Bidirectional horizon synchronization verified.")

        # TEST 4: Range Slider Scrubbing and Dynamic KPI Updates
        print("\n============================================================")
        print("TEST 4: Range Slider Scrubbing and Dynamic KPI Updates")
        print("============================================================")

        # Scrub the range slider: simulate user input setting a custom historical window
        scrub_result = page.evaluate("""() => {
            const sStart = document.getElementById('dd-range-start');
            const sEnd = document.getElementById('dd-range-end');
            const maxVal = parseInt(sStart.max) || 100;

            const targetStart = Math.floor(maxVal * 0.25);
            const targetEnd = Math.floor(maxVal * 0.75);

            sStart.value = targetStart;
            sStart.dispatchEvent(new Event('input', { bubbles: true }));

            sEnd.value = targetEnd;
            sEnd.dispatchEvent(new Event('input', { bubbles: true }));

            return { targetStart, targetEnd, maxVal };
        }""")
        print(f"Slider scrubbed to: {scrub_result}")
        time.sleep(0.6)

        horizon_active_count = page.evaluate("""() => {
            return document.querySelectorAll('#dd-horizon-group .dd-horizon-btn.active').length;
        }""")
        assert horizon_active_count == 0, f"Expected 0 active horizon buttons, got {horizon_active_count}"
        assertion_count += 1

        active_label = page.locator("#dd-range-active-label").text_content().strip()
        assert active_label == "CUSTOM SELECTION", f"Unexpected slider label: {active_label}"
        assertion_count += 1

        badge_custom = page.locator("#dd-badge").text_content().strip()
        assert "CUSTOM" in badge_custom, f"Badge does not contain CUSTOM: {badge_custom}"
        assertion_count += 1

        custom_kpis = page.evaluate("""() => {
            const curLbl = document.querySelector('#dd-kpi-cur .dd-kpi-lbl')?.textContent.trim();
            const curVal = document.querySelector('#dd-kpi-cur .dd-kpi-val')?.textContent.trim();
            const curSub = document.querySelector('#dd-kpi-cur .dd-kpi-sub')?.textContent.trim();

            const mddLbl = document.querySelector('#dd-kpi-mdd .dd-kpi-lbl')?.textContent.trim();
            const mddVal = document.querySelector('#dd-kpi-mdd .dd-kpi-val')?.textContent.trim();
            const mddSub = document.querySelector('#dd-kpi-mdd .dd-kpi-sub')?.textContent.trim();

            const pkLbl = document.querySelector('#dd-kpi-peak .dd-kpi-lbl')?.textContent.trim();
            const pkVal = document.querySelector('#dd-kpi-peak .dd-kpi-val')?.textContent.trim();
            const pkSub = document.querySelector('#dd-kpi-peak .dd-kpi-sub')?.textContent.trim();

            const uwLbl = document.querySelector('#dd-kpi-underwater .dd-kpi-lbl')?.textContent.trim();
            const uwVal = document.querySelector('#dd-kpi-underwater .dd-kpi-val')?.textContent.trim();
            const uwSub = document.querySelector('#dd-kpi-underwater .dd-kpi-sub')?.textContent.trim();

            return {
                curLbl, curVal, curSub,
                mddLbl, mddVal, mddSub,
                pkLbl, pkVal, pkSub,
                uwLbl, uwVal, uwSub
            };
        }""")
        print(f"Custom window KPIs: {custom_kpis}")

        assert "WINDOW END DRAWDOWN" in custom_kpis["curLbl"], f"Unexpected curLbl: {custom_kpis['curLbl']}"
        assertion_count += 1
        assert "%" in custom_kpis["curVal"] and "NaN" not in custom_kpis["curVal"], "Invalid curVal in custom window"
        assertion_count += 1

        assert "MAX DRAWDOWN (WINDOW)" in custom_kpis["mddLbl"], f"Unexpected mddLbl: {custom_kpis['mddLbl']}"
        assertion_count += 1
        assert "%" in custom_kpis["mddVal"] and "NaN" not in custom_kpis["mddVal"], "Invalid mddVal in custom window"
        assertion_count += 1

        assert "$" in custom_kpis["pkVal"] and "NaN" not in custom_kpis["pkVal"], "Invalid pkVal in custom window"
        assertion_count += 1

        assert "d" in custom_kpis["uwVal"] and "NaN" not in custom_kpis["uwVal"], "Invalid uwVal in custom window"
        assertion_count += 1

        # Capture screenshot for custom scrub
        shot_path_scrub = ARTIFACT_DIR / "drawdown_slider_custom_scrub.png"
        dd_panel.screenshot(path=str(shot_path_scrub))
        if PARENT_DIR.exists():
            dd_panel.screenshot(path=str(PARENT_DIR / "drawdown_slider_custom_scrub.png"))
        print(f"Saved screenshot: {shot_path_scrub}")
        print("PASS: TEST 4 Range slider scrubbing and dynamic KPI updates verified.")

        # TEST 5: Interactive Canvas Hover Tooltip
        print("\n============================================================")
        print("TEST 5: Interactive Canvas Hover Tooltip")
        print("============================================================")

        canvas = page.locator("#drawdown-canvas")
        c_box = canvas.bounding_box()
        assert c_box is not None, "Canvas bounding box is null"
        assertion_count += 1

        # Move mouse over canvas center
        target_x = c_box["x"] + c_box["width"] * 0.5
        target_y = c_box["y"] + c_box["height"] * 0.5
        page.mouse.move(target_x, target_y)
        time.sleep(0.4)

        tooltip_info = page.evaluate("""() => {
            const tip = document.getElementById('dd-tooltip');
            if (!tip) return { ok: false, error: 'no tooltip element' };
            const isVisible = tip.style.display !== 'none';
            const dateText = tip.querySelector('.tooltip-date')?.textContent.trim() || '';
            const rows = Array.from(tip.querySelectorAll('.tooltip-row')).map(r => ({
                lbl: r.querySelector('.tooltip-lbl')?.textContent.trim() || '',
                val: r.querySelector('.tooltip-val')?.textContent.trim() || ''
            }));
            return {
                ok: true,
                isVisible,
                dateText,
                rowCount: rows.length,
                rows
            };
        }""")
        print(f"Tooltip info: {tooltip_info}")

        assert tooltip_info["isVisible"], "Tooltip is not visible on hover"
        assertion_count += 1
        assert len(tooltip_info["dateText"]) > 0, "Tooltip date is empty"
        assertion_count += 1
        assert tooltip_info["rowCount"] > 0, "Tooltip has no data rows"
        assertion_count += 1

        date_has_year = re.search(r"\d{4}", tooltip_info["dateText"])
        assert date_has_year is not None, f"Tooltip date missing 4-digit year: {tooltip_info['dateText']}"
        assertion_count += 1

        row_percentages = [r["val"] for r in tooltip_info["rows"] if "%" in r["val"]]
        assert len(row_percentages) > 0, f"No row percentages found in tooltip: {tooltip_info['rows']}"
        assertion_count += 1
        print("PASS: TEST 5 Interactive canvas hover tooltip verified.")

        browser.close()

    print("\n============================================================")
    print(f"ALL 5 PLAYWRIGHT SUITE TESTS PASSED ({assertion_count} assertions)")
    print("============================================================")
    return assertion_count

if __name__ == "__main__":
    count = run_suite()
    sys.exit(0)
