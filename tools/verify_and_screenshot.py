import sys
import os
import json
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8765/index.html"
OUT_IMG = "C:/Users/Dell/.gemini/antigravity/brain/daf2837d-7a62-4ad3-adb9-68091ad4bd3a/ng_bar_and_cards_refined.png"

console_errors = []
console_warnings = []

def on_console(msg):
    if msg.type == "error":
        # Ignore external asset fails if any
        console_errors.append(msg.text)
    elif msg.type == "warning":
        console_warnings.append(msg.text)

with sync_playwright() as p:
    browser = p.chromium.launch()
    # High-resolution viewport
    context = browser.new_context(
        viewport={"width": 1600, "height": 1100},
        device_scale_factor=2
    )
    page = context.new_page()
    page.on("console", on_console)
    page.on("pageerror", lambda err: console_errors.append(str(err)))

    print(f"Navigating to {BASE_URL}...")
    page.goto(BASE_URL, wait_until="load", timeout=30000)
    page.wait_for_selector("#ng-price-bar", timeout=10000)
    page.wait_for_selector("#long-cards .etf-card", timeout=10000)
    page.wait_for_selector("#short-cards .etf-card", timeout=10000)
    page.wait_for_timeout(2000)

    # 1. Verify NG=F strip DOM
    ng_bar = page.locator("#ng-price-bar")
    ng_html = ng_bar.inner_html()

    assert "NG=F" in ng_html, "NG=F label present"
    assert "GATES: NEUTRAL" in ng_html, "GATES: NEUTRAL present"
    assert "FALL (Injection Phase)" in ng_html, "FALL (Injection Phase) present"
    assert "NORMAL" in ng_html, "NORMAL regime badge present"
    assert "ng-gate-neutral" in ng_html, "ng-gate-neutral class present"
    assert "ng-season-phase" in ng_html, "ng-season-phase class present"
    assert "LONG \u2717" not in ng_html, "No LONG ✗ in NG strip"
    assert "SHORT \u2717" not in ng_html, "No SHORT ✗ in NG strip"

    # Verify tooltips
    ticker_tt = page.locator("#ng-price-bar .ng-bar-label").get_attribute("data-tooltip")
    assert "NYMEX Henry Hub Natural Gas Front-Month Prompt Futures" in (ticker_tt or ""), f"Ticker tooltip: {ticker_tt}"
    price_tt = page.locator("#ng-price-bar .ng-bar-price").get_attribute("data-tooltip")
    assert "Current NYMEX prompt month settlement price" in (price_tt or ""), f"Price tooltip: {price_tt}"
    gate_tt = page.locator("#ng-price-bar .ng-gate-neutral").get_attribute("data-tooltip")
    assert "Macro Gate: NEUTRAL" in (gate_tt or ""), f"Gate tooltip: {gate_tt}"
    phase_tt = page.locator("#ng-price-bar .ng-season-phase").get_attribute("data-tooltip")
    assert "Physical Seasonal Phase" in (phase_tt or ""), f"Phase tooltip: {phase_tt}"
    regime_tt = page.locator("#ng-price-bar .ng-regime-badge").get_attribute("data-tooltip")
    assert "Physical Gas Volatility Regime" in (regime_tt or ""), f"Regime tooltip: {regime_tt}"

    print("PASS: Refined NG=F Physical Context Strip verified in live browser!")

    # 2. Verify ETF Cards
    cards = page.locator(".etf-card").all()
    assert len(cards) >= 6, f"Expected at least 6 ETF cards, found {len(cards)}"
    
    expected_decays = {
        "BOIL": "~35%/yr",
        "KOLD": "~35%/yr",
        "HNU.TO": "~40%/yr",
        "HND.TO": "~40%/yr",
        "3NGL.L": "~55%/yr",
        "3NGS.L": "~55%/yr"
    }

    for card in cards:
        ticker = card.get_attribute("data-ticker")
        card_text = card.inner_text()
        card_html = card.inner_html()

        assert "FALL \u00d7" not in card_text and "FALL \u00d7" not in card_html, f"{ticker}: FALL multiplier removed"
        assert "season-badge" not in card_html, f"{ticker}: season-badge removed"

        if ticker in expected_decays:
            meta_pill = card.locator(".card-pill-meta")
            assert meta_pill.count() == 1, f"{ticker}: has .card-pill-meta"
            pill_tt = meta_pill.get_attribute("data-tooltip")
            expected_rate = expected_decays[ticker]
            assert expected_rate in (pill_tt or ""), f"{ticker}: tooltip has {expected_rate}, got {pill_tt}"

    print("PASS: Cleaned-up ETF Cards verified in live browser!")

    # 3. Verify Console Errors
    print(f"Console errors: {len(console_errors)}")
    for err in console_errors:
        print(f"  [ERROR] {err}")
    assert len(console_errors) == 0, f"Expected 0 console errors, got {len(console_errors)}"

    # 4. Capture screenshot
    os.makedirs(os.path.dirname(OUT_IMG), exist_ok=True)
    # Scroll slightly if needed so both the NG bar and the cards are prominently visible
    page.screenshot(path=OUT_IMG, full_page=False)
    print(f"High-resolution screenshot saved to: {OUT_IMG}")
    assert os.path.exists(OUT_IMG) and os.path.getsize(OUT_IMG) > 50000, "Screenshot file valid"

    browser.close()

print("\nALL LIVE BROWSER VERIFICATION TASKS COMPLETED SUCCESSFULLY!")
