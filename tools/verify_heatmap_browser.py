import os
import sys
import time
import threading
import http.server
import socketserver
from playwright.sync_api import sync_playwright

DIRECTORY = os.path.abspath("docs")
SESSION_TOKEN = "afb7e506684308d8a03f01396765b6222b3b417438ad7e5f923302f92bde7b8b"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    def log_message(self, format, *args):
        pass # Silence logging

socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
t = threading.Thread(target=httpd.serve_forever, daemon=True)
t.start()

BASE_URL = f"http://127.0.0.1:{PORT}/index.html"
ARTIFACT_DIR = "C:/Users/Dell/.gemini/antigravity/brain/daf2837d-7a62-4ad3-adb9-68091ad4bd3a"
os.makedirs(ARTIFACT_DIR, exist_ok=True)

console_errors = []

def is_app_error(msg):
    txt = str(msg)
    # Ignore live network fetch / proxy failures when running local offline server
    if "401" in txt or "proxy" in txt.lower() or "aggregateerror" in txt.lower() or "failed to load resource" in txt.lower():
        return False
    return True

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1600, "height": 1100}, device_scale_factor=2)
    context.add_init_script(
        f"sessionStorage.setItem('bm_session_token', '{SESSION_TOKEN}');"
        f"localStorage.setItem('bm_session_token', '{SESSION_TOKEN}');"
    )
    page = context.new_page()

    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" and is_app_error(msg.text) else None)
    page.on("pageerror", lambda err: console_errors.append(str(err)) if is_app_error(err) else None)

    print(f"Loading {BASE_URL}...")
    page.goto(BASE_URL, wait_until="load", timeout=30000)
    page.wait_for_selector("#heat-calendar .heat-cell", timeout=15000)
    page.wait_for_timeout(1200)

    # 1. Baseline view screenshot
    heat_card = page.locator("#heat-calendar-panel")
    heat_card.screenshot(path=os.path.join(ARTIFACT_DIR, "heatmap_baseline.png"))
    print("Baseline screenshot captured.")

    # 2. Click PEAKS toggle
    peaks_btn = page.locator("#heat-peaks-toggle")
    peaks_btn.click()
    page.wait_for_timeout(400)

    # 3. Click SHORT side filter
    short_btn = page.locator("#heat-side-group button[data-side='short']")
    short_btn.click()
    page.wait_for_timeout(400)

    badge = page.locator("#heat-peak-count")
    # Default threshold is 95
    p95_count_text = badge.inner_text().strip()
    print(f"Short 90D at P95: {p95_count_text}")
    assert p95_count_text == "5 PEAKS", f"Expected '5 PEAKS' at P95, got '{p95_count_text}'"

    # Verify Macro vs Local count on 90D SHORT P95 (5 PEAKS, 4 Macro)
    p95_macro_count = page.locator("#heat-calendar .heat-cell:not(.heat-dim):not(.local-max)").count()
    assert p95_macro_count == 4, f"Expected 4 Macro cells in Short 90D P95, got {p95_macro_count}"

    # Snapshot cell signatures & hover tooltip on Short 90D P95 for horizon invariance check vs 252D
    cells_90d = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('#heat-calendar .heat-cell')).map(el => ({
            cls: el.className,
            rank: el._heatMeta ? el._heatMeta.rank : null,
            nEff: el._heatMeta ? el._heatMeta.nEff : null,
            pctTop: el._heatMeta ? el._heatMeta.pctTop : null,
            date: el._heatMeta ? el._heatMeta.dateFormatted : null
        }));
    }""")
    assert len(cells_90d) == 90, f"Expected 90 cells in 90D view, got {len(cells_90d)}"

    # Hover first highlighted peak cell and verify tooltip rank & tag
    first_hl = page.locator("#heat-calendar .heat-cell:not(.heat-dim)").first
    first_hl.hover()
    page.wait_for_timeout(200)
    tt = page.locator("#heat-tooltip")
    assert tt.is_visible(), "Tooltip must be visible on hover"
    tt_rank = tt.locator(".hm-tt-rank").inner_text().strip()
    tt_tag = tt.locator(".hm-tt-tag").inner_text().strip()
    print(f"Hovered Short 90D P95 tooltip: rank='{tt_rank}', tag='{tt_tag}'")
    assert tt_rank.startswith("252D Rank #") and "/ 252" in tt_rank and "Top " in tt_rank, f"Unexpected rank tooltip: {tt_rank}"
    assert "MACRO CLIMAX" in tt_tag or "LOCAL PEAK" in tt_tag, f"Unexpected tag tooltip: {tt_tag}"

    # Capture P95 screenshot
    heat_card.screenshot(path=os.path.join(ARTIFACT_DIR, "heatmap_short_p95.png"))

    # 4. Click P99 threshold (0 PEAKS allowed on quiet quarter vs 252D causal baseline)
    p99_btn = page.locator("#heat-peaks-threshold-group button[data-threshold='99']")
    p99_btn.click()
    page.wait_for_timeout(400)

    p99_count_text = badge.inner_text().strip()
    print(f"Short 90D at P99: {p99_count_text}")
    assert p99_count_text == "0 PEAKS", f"Expected '0 PEAKS' at P99, got '{p99_count_text}'"

    # Hover a dimmed cell at P99 and check DIMMED tooltip
    page.locator("#heat-calendar .heat-cell.heat-dim").first.hover()
    page.wait_for_timeout(200)
    dim_rank = tt.locator(".hm-tt-rank").inner_text().strip()
    dim_tag = tt.locator(".hm-tt-tag").inner_text().strip()
    assert dim_rank.startswith("252D Rank #"), f"Expected 252D Rank on dimmed cell, got {dim_rank}"
    assert "DIMMED" in dim_tag, f"Expected DIMMED tag, got {dim_tag}"

    heat_card.screenshot(path=os.path.join(ARTIFACT_DIR, "heatmap_short_p99.png"))

    # 5. Click P90 threshold
    p90_btn = page.locator("#heat-peaks-threshold-group button[data-threshold='90']")
    p90_btn.click()
    page.wait_for_timeout(400)

    p90_count_text = badge.inner_text().strip()
    print(f"Short 90D at P90: {p90_count_text}")
    assert p90_count_text == "12 PEAKS", f"Expected '12 PEAKS' at P90, got '{p90_count_text}'"

    heat_card.screenshot(path=os.path.join(ARTIFACT_DIR, "heatmap_short_p90.png"))

    # 6. Click VALLEYS toggle
    valleys_btn = page.locator("#heat-valleys-toggle")
    valleys_btn.click()
    page.wait_for_timeout(400)

    valleys_count_text = badge.inner_text().strip()
    print(f"Short 90D Valleys at P90: {valleys_count_text}")
    assert "VALLEYS" in valleys_count_text or "VALLEY" in valleys_count_text

    heat_card.screenshot(path=os.path.join(ARTIFACT_DIR, "heatmap_short_valleys.png"))

    # 7. Check 252 days view
    days252_btn = page.locator("#heat-days-group button[data-days='252']")
    days252_btn.click()
    page.wait_for_timeout(400)

    # Click Peaks on 252D
    peaks_btn.click()
    page.wait_for_timeout(400)

    # Test P99 on 252D (3 PEAKS, 3 Macro)
    p99_btn.click()
    page.wait_for_timeout(400)
    p99_252 = badge.inner_text().strip()
    p99_252_macro = page.locator("#heat-calendar .heat-cell:not(.heat-dim):not(.local-max)").count()
    print(f"Short 252D at P99: {p99_252} ({p99_252_macro} Macro)")
    assert p99_252 == "3 PEAKS", f"Expected '3 PEAKS' at P99 (252D), got '{p99_252}'"
    assert p99_252_macro == 3, f"Expected 3 Macro at P99 (252D), got {p99_252_macro}"

    # Test P95 on 252D (16 PEAKS, 12 Macro)
    p95_btn = page.locator("#heat-peaks-threshold-group button[data-threshold='95']")
    p95_btn.click()
    page.wait_for_timeout(400)
    p95_252 = badge.inner_text().strip()
    p95_252_macro = page.locator("#heat-calendar .heat-cell:not(.heat-dim):not(.local-max)").count()
    print(f"Short 252D at P95: {p95_252} ({p95_252_macro} Macro)")
    assert p95_252 == "16 PEAKS", f"Expected '16 PEAKS' at P95 (252D), got '{p95_252}'"
    assert p95_252_macro == 12, f"Expected 12 Macro at P95 (252D), got {p95_252_macro}"

    # Verify exact invariance of all 90 overlapping cells between 90D and 252D on Short P95
    cells_252d = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('#heat-calendar .heat-cell')).map(el => ({
            cls: el.className,
            rank: el._heatMeta ? el._heatMeta.rank : null,
            nEff: el._heatMeta ? el._heatMeta.nEff : null,
            pctTop: el._heatMeta ? el._heatMeta.pctTop : null,
            date: el._heatMeta ? el._heatMeta.dateFormatted : null
        }));
    }""")
    overlap_252 = cells_252d[-90:]
    assert overlap_252 == cells_90d, "Overlapping 90 cells changed between 90D and 252D!"
    print("Verified 90/90 overlapping cells invariant across 90D vs 252D!")

    # Test P90 on 252D (29 PEAKS)
    p90_btn.click()
    page.wait_for_timeout(400)
    p90_252 = badge.inner_text().strip()
    print(f"Short 252D at P90: {p90_252}")
    assert p90_252 == "29 PEAKS", f"Expected '29 PEAKS' at P90 (252D), got '{p90_252}'"

    heat_card.screenshot(path=os.path.join(ARTIFACT_DIR, "heatmap_short_252d_p90.png"))

    browser.close()

httpd.shutdown()

if console_errors:
    print(f"Console errors encountered: {console_errors}")
    sys.exit(1)

print("\nSUCCESS! All browser tests and screenshot captures passed perfectly!")
