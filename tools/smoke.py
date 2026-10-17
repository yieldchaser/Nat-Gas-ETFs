import sys
import re
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
errors = []

PIXEL_CHECK = """
(id) => {
  const c = document.getElementById(id);
  if (!c || !c.width || !c.height) return false;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 40) { if (d[i] > 0) n++; }
  return n > 20;
}
"""

HASH = """
(id) => {
  const c = document.getElementById(id);
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 400) h = (h * 31 + d[i] + d[i+1] + d[i+2]) >>> 0;
  return h;
}
"""


def attach(page):
    page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    attach(page)
    page.goto(BASE + "/index.html", wait_until="load", timeout=30000)
    page.wait_for_selector("#vs-panel", timeout=15000)
    page.wait_for_timeout(2500)

    assert page.evaluate(PIXEL_CHECK, "vs-canvas"), "index: vs-canvas blank"
    chips = page.locator("#vs-chips .vs-chip").count()
    assert chips == 6, f"index: expected 6 chips, got {chips}"
    reading = page.inner_text("#vs-reading")
    assert "RVOL-21" in reading, f"index: reading line missing RVOL: {reading!r}"

    hashes = {}
    for study in ["osc", "net", "obv", "pvt", "vol"]:
        page.click(f'#vs-study-tabs button[data-study="{study}"]')
        page.wait_for_timeout(250)
        assert page.evaluate(PIXEL_CHECK, "vs-canvas"), f"index: vs-canvas blank after {study}"
        hashes[study] = page.evaluate(HASH, "vs-canvas")
    assert len(set(hashes.values())) >= 3, f"index: studies render identical canvases: {hashes}"

    for rng in ["3m", "10y", "2y", "1y"]:
        page.click(f'#vs-range-tabs button[data-range="{rng}"]')
        page.wait_for_timeout(250)
        assert page.evaluate(PIXEL_CHECK, "vs-canvas"), f"index: vs-canvas blank after range {rng}"

    page.click('#vs-chips .vs-chip[data-ticker="KOLD"]')
    page.wait_for_timeout(400)
    assert page.evaluate(PIXEL_CHECK, "vs-canvas"), "index: vs-canvas blank after KOLD"

    box = page.locator("#vs-canvas").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.wait_for_timeout(200)
    tt = page.eval_on_selector("#vs-tooltip", "el => el.style.display")
    assert tt == "block", f"index: tooltip not shown on hover ({tt})"

    print("index.html: PRICE-VOLUME STUDIES OK")

    attach(page)
    page.goto(BASE + "/trough-peak.html", wait_until="load", timeout=30000)
    page.wait_for_selector("#vp-panel", timeout=15000)
    page.wait_for_timeout(3500)

    label = page.inner_text("#vp-range-label")
    assert "sessions" in label, f"trough-peak: vp-range-label not populated: {label!r}"
    stats = page.inner_text("#vp-stats")
    assert "POC" in stats and "VALUE AREA" in stats, f"trough-peak: stats missing: {stats!r}"
    assert page.evaluate(PIXEL_CHECK, "vp-canvas"), "trough-peak: vp-canvas blank"

    page.locator("#vp-panel").scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    vbox = page.locator("#vp-canvas").bounding_box()
    page.mouse.move(vbox["x"] + vbox["width"] * 0.3, vbox["y"] + vbox["height"] * 0.5)
    page.wait_for_timeout(150)
    page.mouse.move(vbox["x"] + vbox["width"] * 0.4, vbox["y"] + vbox["height"] * 0.5)
    page.wait_for_timeout(250)
    vtt = page.eval_on_selector("#vp-tooltip", "el => el.style.display")
    assert vtt == "block", f"trough-peak: vp tooltip not shown ({vtt})"
    vtt_text = page.inner_text("#vp-tooltip")
    assert "SESSIONS" in vtt_text and "VOL SHARE" in vtt_text, \
        f"trough-peak: vp tooltip missing rows: {vtt_text!r}"

    page.mouse.move(vbox["x"] + vbox["width"] * 0.4, vbox["y"] + vbox["height"] * 0.2)
    page.wait_for_timeout(250)
    top_text = page.inner_text("#vp-tooltip")
    page.mouse.move(vbox["x"] + vbox["width"] * 0.4, vbox["y"] + vbox["height"] * 0.8)
    page.wait_for_timeout(250)
    bottom_text = page.inner_text("#vp-tooltip")

    def first_price(t):
        m = re.search(r"\$([\d,]+\.?\d*)", t)
        return float(m.group(1).replace(",", "")) if m else None

    top_p, bottom_p = first_price(top_text), first_price(bottom_text)
    assert top_p is not None and bottom_p is not None and top_p > bottom_p, \
        f"trough-peak: profile flipped vs axis (top {top_text[:40]!r} vs bottom {bottom_text[:40]!r})"

    hash_1y = page.evaluate(HASH, "vp-canvas")
    sessions_1y = re.search(r"(\d+) sessions", label)
    assert sessions_1y, f"trough-peak: no session count in default window: {label!r}"

    page.click('#vp-range-tabs button[data-vp-range="all"]')
    page.wait_for_timeout(400)
    label_all = page.inner_text("#vp-range-label")
    sessions_all = re.search(r"(\d+) sessions", label_all)
    assert sessions_all, f"trough-peak: no session count in ALL window: {label_all!r}"
    assert int(sessions_all.group(1)) > int(sessions_1y.group(1)), \
        f"trough-peak: ALL window not larger than 1Y ({label_all!r} vs {label!r})"
    all_hash = page.evaluate(HASH, "vp-canvas")
    assert all_hash != hash_1y, "trough-peak: ALL vs 1Y profile identical"

    page.click('#vp-range-tabs button[data-vp-range="custom"]')
    page.wait_for_timeout(400)
    disp = page.eval_on_selector("#vp-fixed-controls", "el => getComputedStyle(el).display")
    assert disp == "flex", f"trough-peak: custom controls not shown ({disp})"
    from_val = page.input_value("#vp-from")
    assert from_val, "trough-peak: vp-from empty after switching to custom"
    assert page.evaluate(PIXEL_CHECK, "vp-canvas"), "trough-peak: vp-canvas blank in custom mode"

    page.fill("#vp-from", "2018-01-01")
    page.dispatch_event("#vp-from", "change")
    page.wait_for_timeout(400)
    label2 = page.inner_text("#vp-range-label")
    assert label2.startswith("2018"), f"trough-peak: custom range label not updated: {label2!r}"
    custom_hash = page.evaluate(HASH, "vp-canvas")
    assert custom_hash != all_hash, "trough-peak: custom vs ALL profile identical"

    page.click('#vp-range-tabs button[data-vp-range="1y"]')
    page.wait_for_timeout(400)
    disp2 = page.eval_on_selector("#vp-fixed-controls", "el => getComputedStyle(el).display")
    assert disp2 == "none", "trough-peak: custom controls should hide on preset ranges"

    hash_before_switch = page.evaluate(HASH, "vp-canvas")

    vp_chips = page.locator("#vp-etf-chips .etf-chip").count()
    assert vp_chips == 6, f"trough-peak: expected 6 vp etf chips, got {vp_chips}"

    def vp_active_chip():
        return page.evaluate(
            "() => { const c = Array.from(document.querySelectorAll('#vp-etf-chips .etf-chip')).find(x => x.style.opacity === '1'); return c ? c.textContent : null; }")

    assert vp_active_chip() == "KOLD", f"trough-peak: vp default chip not KOLD ({vp_active_chip()})"

    page.click('#chart-etf-chips button:has-text("HND")')
    page.wait_for_timeout(600)
    assert vp_active_chip() == "KOLD", "trough-peak: vp chip changed on main chart ETF switch"
    assert page.evaluate(HASH, "vp-canvas") == hash_before_switch, \
        "trough-peak: vp profile changed on main chart ETF switch (should be independent)"

    vp_hashes = {}
    for etf in ["BOIL", "HNU", "3NGL", "KOLD", "HND", "3NGS"]:
        page.click(f'#vp-etf-chips button:has-text("{etf}")')
        page.wait_for_timeout(450)
        assert vp_active_chip() == etf, f"trough-peak: vp chip {etf} not active after click"
        assert page.evaluate(PIXEL_CHECK, "vp-canvas"), f"trough-peak: vp-canvas blank for {etf}"
        etf_label = page.inner_text("#vp-range-label")
        assert re.search(r"\d+ sessions", etf_label), f"trough-peak: no sessions label for {etf}: {etf_label!r}"
        vp_hashes[etf] = page.evaluate(HASH, "vp-canvas")
    assert len(set(vp_hashes.values())) >= 5, f"trough-peak: vp profiles too similar across ETFs: {vp_hashes}"
    assert vp_hashes["BOIL"] != vp_hashes["KOLD"], "trough-peak: vp BOIL vs KOLD identical"

    page.click('#vp-etf-chips button:has-text("BOIL")')
    page.wait_for_timeout(450)
    page.click('#chart-etf-chips button:has-text("BOIL")')
    page.wait_for_timeout(800)

    tp_ok = page.evaluate(PIXEL_CHECK, "tp-canvas")
    assert tp_ok, "trough-peak: price chart blank (regression)"

    print("trough-peak.html: VOLUME PROFILE OK")

    mob = browser.new_page(viewport={"width": 390, "height": 844})
    attach(mob)
    mob.goto(BASE + "/index.html", wait_until="load", timeout=30000)
    mob.wait_for_selector("#vs-panel", timeout=15000)
    mob.wait_for_timeout(2500)
    assert mob.evaluate(PIXEL_CHECK, "vs-canvas"), "mobile: vs-canvas blank"
    mob.goto(BASE + "/trough-peak.html", wait_until="load", timeout=30000)
    mob.wait_for_selector("#vp-panel", timeout=15000)
    mob.wait_for_timeout(3500)
    assert mob.evaluate(PIXEL_CHECK, "vp-canvas"), "mobile: vp-canvas blank"
    mstats = mob.inner_text("#vp-stats")
    assert "POC" in mstats, f"mobile: vp stats missing: {mstats!r}"
    mchips = mob.locator("#vp-etf-chips .etf-chip").count()
    assert mchips == 6, f"mobile: expected 6 vp chips, got {mchips}"
    print("mobile 390px: both panels OK")

    browser.close()

expected = [e for e in errors if "net::ERR" not in e and "Failed to load resource" not in e and "allorigins" not in e and "All proxies failed" not in e]
print(f"console errors (filtered): {len(expected)}")
for e in expected[:20]:
    print("  " + e)
if errors:
    print(f"raw network/resource errors: {len(errors) - len(expected)} (external, tolerated)")
sys.exit(1 if expected else 0)
