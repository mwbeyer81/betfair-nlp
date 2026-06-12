const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const networkErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('requestfailed', req => {
    networkErrors.push(`${req.url()} - ${req.failure()?.errorText}`);
  });
  page.on('response', resp => {
    if (resp.url().includes(':3000') && resp.status() >= 400) {
      console.log('API error:', resp.url(), resp.status());
    }
  });
  await page.goto('http://localhost:8081/runners');
  console.log('Waiting 90 seconds for loading to complete...');
  const start = Date.now();
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="all-runners-loading"]');
      return !el || !el.offsetParent;
    }, { timeout: 90000 });
    console.log('Loading completed in', (Date.now() - start) / 1000, 'seconds');
  } catch(e) {
    console.log('Still loading after', (Date.now() - start) / 1000, 'seconds');
    // Check what requests were made
    const url = page.url();
    console.log('Current URL:', url);
  }
  if (errors.length) console.log('Console errors:', errors.slice(0, 10));
  if (networkErrors.length) console.log('Network errors:', networkErrors.slice(0, 10));
  await browser.close();
})();
