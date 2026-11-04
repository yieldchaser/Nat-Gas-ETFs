import http.server
import socketserver
import threading
import os
import sys
from playwright.sync_api import sync_playwright

DOCS_DIR = os.path.abspath("docs")
ARTIFACT_DIR = "C:/Users/Dell/.gemini/antigravity/brain/daf2837d-7a62-4ad3-adb9-68091ad4bd3a"
os.makedirs(ARTIFACT_DIR, exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS_DIR, **kwargs)
    def log_message(self, *args):
        pass

server = socketserver.TCPServer(("127.0.0.1", 0), QuietHandler)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
print(f"Test server running on port {port}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # -----------------------------------------------------------------
    # TEST 1: Unauthenticated Visit & Zero Network Exposure
    # -----------------------------------------------------------------
    print("\n[TEST 1] Verifying Unauthenticated Access & Network Lockdown on index.html...", flush=True)
    ctx1 = browser.new_context(viewport={"width": 1280, "height": 800})
    page1 = ctx1.new_page()

    network_requests = []
    page1.on("request", lambda req: network_requests.append(req.url))

    page1.goto(f"http://127.0.0.1:{port}/index.html")
    page1.wait_for_selector("#bm-auth-overlay", timeout=6000)
    page1.wait_for_timeout(1000)

    # Verify Terminal UI is visible
    assert page1.locator("#bm-auth-overlay").is_visible(), "Auth overlay must be visible"
    assert page1.locator("#bm-user-input").is_visible(), "Username input must be visible"
    assert page1.locator("#bm-pass-input").is_visible(), "Password input must be visible"
    assert page1.locator("#bm-submit-btn").is_visible(), "Submit button must be visible"

    # Verify Dashboard is NOT in DOM / visible
    dash_visible = page1.locator("#dashboard").is_visible()
    assert not dash_visible, "Dashboard must NOT be visible before auth"

    # Verify Network Requests
    print("  Captured network requests before login:")
    for url in network_requests:
        print("   ->", url, flush=True)

    forbidden_data_terms = ["dashboard_data.json", "latest_signals.json", "known_splits.json", "all_flows_summary.json", "yahoo", "query1.finance"]
    for req in network_requests:
        for term in forbidden_data_terms:
            assert term not in req, f"CRITICAL SECURITY LEAK: Found forbidden network request for '{term}' before login! URL: {req}"

    print("  [PASS] Zero sensitive data requested in network inspect before login!")

    # Screenshot of locked terminal
    shot_locked = os.path.join(ARTIFACT_DIR, "auth_terminal_locked.png")
    page1.screenshot(path=shot_locked)
    print("  [SCREENSHOT] Saved locked terminal:", shot_locked, flush=True)

    # -----------------------------------------------------------------
    # TEST 2: Invalid Login Attempt
    # -----------------------------------------------------------------
    print("\n[TEST 2] Verifying Access Rejection on Invalid Credentials...", flush=True)
    page1.fill("#bm-user-input", "intruder")
    page1.fill("#bm-pass-input", "wrong_pass_123")
    page1.click("#bm-submit-btn")
    page1.wait_for_timeout(400)

    err_el = page1.locator("#bm-auth-error")
    assert err_el.is_visible(), "Error message must appear on invalid credentials"
    assert "Access Denied" in err_el.inner_text(), "Expected 'Access Denied' message"
    assert page1.locator("#bm-auth-overlay").is_visible(), "Terminal must remain locked"
    print("  [PASS] Invalid login rejected cleanly with security feedback.")

    # -----------------------------------------------------------------
    # TEST 3: Successful Login with Valid Credentials
    # -----------------------------------------------------------------
    auth_user = os.environ.get("BM_AUTH_USER", "")
    auth_pass = os.environ.get("BM_AUTH_PASS", "")
    if not auth_user or not auth_pass:
        raise ValueError("BM_AUTH_USER and BM_AUTH_PASS environment variables must be provided for Test 3")
    print("\n[TEST 3] Verifying Successful Authentication via Environment Credentials...", flush=True)
    page1.fill("#bm-user-input", auth_user)
    page1.fill("#bm-pass-input", auth_pass)
    page1.click("#bm-submit-btn")

    # Wait for dashboard to mount and boot
    page1.wait_for_selector("#dashboard", timeout=8000)
    page1.wait_for_selector(".etf-card", timeout=8000)
    page1.wait_for_timeout(2000)

    assert not page1.locator("#bm-auth-overlay").is_visible(), "Auth overlay must be removed after login"
    assert page1.locator("#dashboard").is_visible(), "Dashboard must be visible after login"
    
    # Check that logout button was injected
    logout_btn = page1.locator("#bm-logout-btn")
    assert logout_btn.is_visible(), "Logout button must be visible in navigation"
    print("  [PASS] Dashboard successfully booted and [LOGOUT] button mounted.")

    shot_unlocked = os.path.join(ARTIFACT_DIR, "auth_terminal_unlocked.png")
    page1.screenshot(path=shot_unlocked)
    print("  [SCREENSHOT] Saved unlocked dashboard:", shot_unlocked, flush=True)

    # -----------------------------------------------------------------
    # TEST 4: Direct Unauthenticated Access to flows.html
    # -----------------------------------------------------------------
    print("\n[TEST 4] Verifying Direct Unauthenticated Access to flows.html...", flush=True)
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
    page2 = ctx2.new_page()

    flows_requests = []
    page2.on("request", lambda req: flows_requests.append(req.url))

    page2.goto(f"http://127.0.0.1:{port}/flows.html")
    page2.wait_for_selector("#bm-auth-overlay", timeout=6000)
    page2.wait_for_timeout(1000)

    # Verify it redirected to index.html with returnUrl
    assert "index.html" in page2.url, f"Expected redirect to index.html, got {page2.url}"
    assert "returnUrl=flows.html" in page2.url, f"Expected returnUrl=flows.html in {page2.url}"
    assert page2.locator("#bm-auth-overlay").is_visible(), "Auth terminal must be visible on redirect"

    # Verify NO flow data was downloaded
    for req in flows_requests:
        assert "all_flows_summary.json" not in req, f"Forbidden flow data downloaded: {req}"
        assert "_flows.json" not in req, f"Forbidden flow data downloaded: {req}"
    print("  [PASS] Unauthenticated access to flows.html redirected with zero data exposure!")

    # -----------------------------------------------------------------
    # TEST 5: Authenticated Navigation to flows.html
    # -----------------------------------------------------------------
    print("\n[TEST 5] Verifying Authenticated Cross-Page Session on flows.html...", flush=True)
    # page1 is already authenticated from Test 3
    page1.goto(f"http://127.0.0.1:{port}/flows.html")
    page1.wait_for_selector(".sentiment-banner", timeout=10000)
    page1.wait_for_timeout(1500)

    assert not page1.locator("#bm-auth-overlay").is_visible(), "Overlay must NOT appear for authenticated user"
    assert page1.locator(".sentiment-banner").is_visible(), "Flow monitor must render directly"
    assert page1.locator("#bm-logout-btn").is_visible(), "Logout button must exist on flows.html"
    print("  [PASS] Authenticated user seamlessly accessed flows.html with active session.")

    # -----------------------------------------------------------------
    # TEST 6: Logout Functionality
    # -----------------------------------------------------------------
    print("\n[TEST 6] Verifying Logout Functionality...", flush=True)
    page1.click("#bm-logout-btn")
    page1.wait_for_selector("#bm-auth-overlay", timeout=6000)
    page1.wait_for_timeout(1000)

    assert "index.html" in page1.url, "Should redirect to index.html on logout"
    assert page1.locator("#bm-auth-overlay").is_visible(), "Terminal must be locked after logout"
    print("  [PASS] Session successfully terminated and terminal re-locked.")

    browser.close()

try:
    server.shutdown()
except:
    pass

print("\n=== ALL AUTHENTICATION & SECURITY TESTS PASSED PERFECTLY WITH ZERO REGRESSIONS ===", flush=True)
