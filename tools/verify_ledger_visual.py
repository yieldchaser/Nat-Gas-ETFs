import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

PORT = 8089
DOCS_DIR = os.path.abspath('docs')
ARTIFACT_DIR = r'C:\Users\Dell\.gemini\antigravity\brain\daf2837d-7a62-4ad3-adb9-68091ad4bd3a'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS_DIR, **kwargs)
    def log_message(self, format, *args):
        pass

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        httpd.serve_forever()

server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()
time.sleep(0.5)

print("Starting Playwright verification...")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1800})
    page = context.new_page()

    # Pre-seed auth token
    page.add_init_script("""
        localStorage.setItem('bm_session_token', 'afb7e506684308d8a03f01396765b6222b3b417438ad7e5f923302f92bde7b8b');
        sessionStorage.setItem('bm_session_token', 'afb7e506684308d8a03f01396765b6222b3b417438ad7e5f923302f92bde7b8b');
    """)

    # Route external fetches to empty JSON to avoid network waiting
    page.route("**/*query1.finance.yahoo.com/**", lambda route: route.fulfill(status=200, body='{}'))
    page.route("**/*query2.finance.yahoo.com/**", lambda route: route.fulfill(status=200, body='{}'))

    page.goto(f'http://localhost:{PORT}/trough-peak.html', wait_until='domcontentloaded')
    page.wait_for_selector('#contract-ledger-root', timeout=5000)

    # 1. Verify ledger panel presence
    panel = page.locator('.contract-ledger-panel')
    assert panel.count() > 0, "Contract ledger panel not found!"
    print("Contract ledger panel rendered successfully.")

    # Hide sticky top bar for clean element screenshot
    page.evaluate("if(document.getElementById('top-bar')) document.getElementById('top-bar').style.display = 'none';")

    # 2. Scroll into view and screenshot initial view (Schedule table)
    panel.scroll_into_view_if_needed()
    time.sleep(0.3)
    shot_panel = os.path.join(ARTIFACT_DIR, 'contract_ledger_initial.png')
    panel.screenshot(path=shot_panel)
    print(f"Saved initial view screenshot: {shot_panel}")

    # 3. Test Month switch to February 2025 (Active roll month for US & UK & CA)
    page.select_option('#cl-year-select', '2025')
    page.select_option('#cl-month-select', '2')
    # Scrub slider to Day 11 (Business day 7)
    page.fill('#cl-day-slider', '11')
    page.dispatch_event('#cl-day-slider', 'input')
    time.sleep(0.3)
    
    # Assert smooth slider scrub invariants
    slider_val = page.eval_on_selector('#cl-day-slider', 'el => el.value')
    date_text = page.eval_on_selector('#cl-scrubber-date', 'el => el.textContent')
    selected_row = page.eval_on_selector('.cl-table tr.is-selected-day', 'el => el.getAttribute("data-day")')
    assert slider_val == '11', f"Expected slider value 11, got {slider_val}"
    assert date_text == '2025-02-11', f"Expected date text 2025-02-11, got {date_text}"
    assert selected_row == '11', f"Expected table row 11 to be selected, got {selected_row}"
    print(f"Slider scrub verification passed: day={slider_val}, date={date_text}, row={selected_row}")

    panel.scroll_into_view_if_needed()
    shot_feb = os.path.join(ARTIFACT_DIR, 'contract_ledger_feb2025_roll.png')
    panel.screenshot(path=shot_feb)
    print(f"Saved Feb 2025 roll view screenshot: {shot_feb}")

    # 4. Click Roadmap tab
    page.click('.cl-tab-btn[data-tab="roadmap"]')
    time.sleep(0.3)
    shot_roadmap = os.path.join(ARTIFACT_DIR, 'contract_ledger_roadmap.png')
    panel.screenshot(path=shot_roadmap)
    print(f"Saved 12-month roadmap screenshot: {shot_roadmap}")

    # 5. Click Specs tab
    page.click('.cl-tab-btn[data-tab="specs"]')
    time.sleep(0.3)
    shot_specs = os.path.join(ARTIFACT_DIR, 'contract_ledger_specs.png')
    panel.screenshot(path=shot_specs)
    print(f"Saved prospectus specs screenshot: {shot_specs}")

    # 6. Mobile viewport test (390x844)
    mobile_page = context.new_page()
    mobile_page.set_viewport_size({'width': 390, 'height': 844})
    mobile_page.goto(f'http://localhost:{PORT}/trough-peak.html', wait_until='domcontentloaded')
    mobile_page.wait_for_selector('#contract-ledger-root', timeout=5000)
    mobile_page.evaluate("if(document.getElementById('top-bar')) document.getElementById('top-bar').style.display = 'none';")
    m_panel = mobile_page.locator('.contract-ledger-panel')
    m_panel.scroll_into_view_if_needed()
    time.sleep(0.3)
    shot_mobile = os.path.join(ARTIFACT_DIR, 'contract_ledger_mobile_390.png')
    m_panel.screenshot(path=shot_mobile)
    print(f"Saved mobile screenshot: {shot_mobile}")
    mobile_page.close()

    browser.close()

print("Playwright visual verification complete!")
sys.exit(0)
