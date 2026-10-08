import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';
import type { HousingRecord, HousingResult } from '../src/utils/housing';

export async function testHousingUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  const record: HousingRecord = { id: 'test-only', city: '臺北市', district: '大安區', street: '永康街', address: '住宅測試地址',
    tradedOn: '2026-01-02', totalTwd: 12000000, areaPing: 30, unitTwdPing: 333333.33, rooms: 3,
    ageYears: 20, floor: 3, floors: 9, buildingType: '華廈', elevator: true, parking: true, parkingSeparated: true, special: false, notes: '' };
  const response: HousingResult = { status: 'available', scope: { city: '臺北市', district: '大安區', street: '永康街', years: 3 },
    coverage: { importedAt: '2026-10-01T00:00:00Z', oldestTransaction: '2023-10-01', newestTransaction: '2026-09-01' },
    stats: { count: 1, averageTotalTwd: 12000000, medianTotalTwd: 12000000, averageUnitTwdPing: 333333.33, unitSampleCount: 1 },
    latest: record, records: [record], hasMore: false };
  for (const [width, language] of [[320, 'zh-TW'], [390, 'zh-TW'], [1440, 'zh-TW'], [320, 'en']] as const) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); await prepare(context);
    await context.addInitScript(language => localStorage.setItem('streetlens-language', language), language);
    const english = language === 'en';
    const reads: URL[] = [];
    await context.route(url => url.pathname === '/api/private/access', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ enabled: true, authorized: true, expiresAt: Date.now() + 3600000 }) }));
    await context.route(url => url.pathname === '/api/housing', route => {
      reads.push(new URL(route.request().url()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    const page = await context.newPage(); await page.goto(baseURL);
    await page.locator('.leaflet-container').click({ position: { x: 150, y: 100 } });
    const panel = page.getByTestId('housing-panel'); await panel.waitFor();
    assert.equal(reads.length, 0, 'closed housing never fetches');
    const savedBefore = await page.evaluate(() => localStorage.getItem('cls_saved_locations'));
    await panel.getByRole('button', { name: english ? 'Residential market' : '住宅行情', exact: true }).click();
    await panel.getByTestId('housing-stats').waitFor(); assert.equal(reads.length, 1);
    await panel.locator('[name="minPrice"]').fill('1000'); await panel.locator('[name="maxPrice"]').fill('1500');
    assert.equal(reads.length, 1, 'editing filters does not fetch');
    await panel.getByRole('button', { name: english ? 'Apply housing filters' : '套用住宅篩選', exact: true }).click();
    await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="housing-stats"]')));
    assert.equal(reads.length, 2); assert.equal(reads.at(-1)?.searchParams.get('maxPrice'), '1500');
    await panel.getByRole('button', { name: english ? 'Residential market' : '住宅行情', exact: true }).click();
    await panel.getByRole('button', { name: english ? 'Residential market' : '住宅行情', exact: true }).click();
    await panel.getByTestId('housing-stats').waitFor(); assert.equal(reads.length, 2, 'reopening reuses cache');
    assert.equal(await panel.locator('[name="minPrice"]').inputValue(), '1000', 'reopened filters match cached results');
    assert.equal(await panel.locator('[name="maxPrice"]').inputValue(), '1500');
    const bounds = await panel.boundingBox(); assert.ok(bounds && bounds.width <= width && bounds.x >= 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, 'housing does not overflow narrow screens');
    assert.equal(await page.evaluate(() => localStorage.getItem('cls_saved_locations')), savedBefore, 'housing never changes saved scores or evidence');
    await panel.getByTestId('housing-stats').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/walk-ui/housing-${width}-${language}.png` });
    // Real sign-out UI must unmount the panel and discard cached results.
    await context.route(url => url.pathname === '/api/private/logout', route => route.fulfill({ status: 204 }));
    await page.getByRole('button', { name: english ? 'Profile settings' : '個人設定', exact: true }).click();
    await page.getByRole('button', { name: english ? 'Sign out of private features' : '登出私人功能', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="housing-panel"]'));
    assert.equal(reads.length, 2); await context.close();
  }
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 900 } }); await prepare(publicContext);
  let publicReads = 0, accessReads = 0;
  await publicContext.route(url => url.pathname === '/api/private/access', route => { ++accessReads; return route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ enabled: true, authorized: false, expiresAt: null }) }); });
  await publicContext.route(url => url.pathname === '/api/housing', route => { ++publicReads; return route.abort(); });
  const publicPage = await publicContext.newPage(); await publicPage.goto(baseURL);
  await publicPage.locator('.leaflet-container').click({ position: { x: 150, y: 100 } });
  await publicPage.getByText('Start environment observations', { exact: true }).or(publicPage.getByText('開始環境觀察', { exact: true })).waitFor();
  assert.equal(await publicPage.getByTestId('housing-panel').count(), 0); assert.equal(publicReads, 0);
  assert.equal(accessReads, 1, 'permission read is deduplicated and never queries DB');
  await publicContext.close();
  for (const failure of ['http', 'network', 'invalid-json']) {
    const recovery = await browser.newContext({ viewport: { width: 390, height: 900 } }); await prepare(recovery);
    await recovery.addInitScript(() => localStorage.setItem('streetlens-language', 'en'));
    let attempts = 0, housingReads = 0;
    await recovery.route(url => url.pathname === '/api/private/access', route => {
      if (++attempts === 1) {
        if (failure === 'network') return route.abort();
        return route.fulfill({ status: failure === 'http' ? 503 : 200, contentType: 'text/html', body: '<html>Unavailable</html>' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, authorized: false, expiresAt: null }) });
    });
    await recovery.route(url => url.pathname === '/api/housing', route => { ++housingReads; return route.abort(); });
    const recoveredPage = await recovery.newPage(); await recoveredPage.goto(baseURL);
    await recoveredPage.locator('.leaflet-container').click({ position: { x: 150, y: 100 } });
    await recoveredPage.getByRole('button', { name: 'Start environment observations', exact: true }).waitFor();
    await recoveredPage.getByRole('button', { name: 'Profile settings', exact: true }).click();
    // Browser reconnect may race the failed fetch; retry explicitly when opening settings again.
    await recoveredPage.getByRole('button', { name: 'Close', exact: true }).click();
    await recoveredPage.getByRole('button', { name: 'Profile settings', exact: true }).click();
    await recoveredPage.getByRole('link', { name: 'Sign in with Google', exact: true }).waitFor();
    assert.equal(attempts, 2, 'failed discovery can recover without reload and successful discovery stays deduplicated');
    assert.equal(housingReads, 0); assert.equal(await recoveredPage.getByTestId('housing-panel').count(), 0);
    await recovery.close();
  }
  console.log('Housing UI passed: on-demand cached reads, explicit filters, no saved-data mutation and 320/390/1440px layouts.');
}
