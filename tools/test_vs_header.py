import os
from playwright.sync_api import sync_playwright

def test_header():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        html_path = os.path.abspath('docs/index.html').replace('\\', '/')
        page.goto('file:///' + html_path)
        page.wait_for_timeout(2000)
        
        # Check classic suite
        head_box = page.locator('.vs-head').bounding_box()
        h3_box = page.locator('.vs-head h3').bounding_box()
        tabs_box = page.locator('#vs-range-tabs').bounding_box()
        
        print('Classic Suite:')
        print('  vs-head:', head_box)
        print('  h3:', h3_box)
        print('  tabs:', tabs_box)
        diff_y = abs(h3_box['y'] - tabs_box['y'])
        print(f'  Y difference: {diff_y:.2f}px')
        assert diff_y < 8, f"Selectors should be beside title on desktop, but diff_y is {diff_y}px"
        
        # Test switching to Microstructure suite
        micro_btn = page.locator('#vs-suite-tabs button[data-suite="micro"]')
        micro_btn.click()
        page.wait_for_timeout(500)
        
        h3_box_micro = page.locator('.vs-head h3').bounding_box()
        tabs_box_micro = page.locator('#vs-range-tabs').bounding_box()
        print('Microstructure Suite:')
        print('  h3:', h3_box_micro)
        print('  tabs:', tabs_box_micro)
        diff_y_micro = abs(h3_box_micro['y'] - tabs_box_micro['y'])
        print(f'  Y difference: {diff_y_micro:.2f}px')
        assert diff_y_micro < 8, f"Microstructure suite selectors should be beside title, but diff_y is {diff_y_micro}px"
        
        # Take screenshot of vs-panel
        page.locator('#vs-panel').screenshot(path='test_vs_panel_desktop.png')
        print('Captured test_vs_panel_desktop.png')
        
        # Test multiple viewport widths
        for width in [1920, 1600, 1440, 1366, 1280, 1024]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.wait_for_timeout(400)
            h = page.locator('.vs-head h3').bounding_box()
            t = page.locator('#vs-range-tabs').bounding_box()
            d = abs(h['y'] - t['y'])
            print(f'Viewport {width}px -> h3 Y: {h["y"]:.1f}, tabs Y: {t["y"]:.1f}, diff: {d:.1f}px (Single row: {d < 8})')
            assert d < 8, f"Width {width}px failed single-row layout"

        browser.close()
        print('ALL TESTS PASSED!')

if __name__ == '__main__':
    test_header()
