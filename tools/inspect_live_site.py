import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        
        logs = []
        page.on('console', lambda msg: logs.append(f'[{msg.type}] {msg.text}'))
        
        print("Navigating to https://yieldchaser.github.io/Nat-Gas-ETFs/ ...")
        try:
            await page.goto("https://yieldchaser.github.io/Nat-Gas-ETFs/", wait_until="networkidle", timeout=25000)
        except Exception as e:
            print("Navigation finished/timeout:", e)
            
        await page.wait_for_timeout(5000)
        
        lu = await page.locator("#last-updated").text_content()
        ms = await page.locator("#market-status").text_content()
        print(f"Header: {ms.strip()} | {lu.strip()}")
        
        for ticker in ["BOIL", "KOLD", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L"]:
            card = page.locator(f'.etf-card[data-ticker="{ticker}"]')
            price = await card.locator('[data-live="price"]').text_content() if await card.count() > 0 else 'N/A'
            change = await card.locator('[data-live="change"]').text_content() if await card.count() > 0 else 'N/A'
            vol = await card.locator('[data-live="vol"]').text_content() if await card.count() > 0 else 'N/A'
            print(f"  {ticker}: Price={price.strip()} Change={change.strip()} Vol={vol.strip()}")
            
        print("\nBrowser console logs:")
        for l in logs:
            print("  ", l)
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
