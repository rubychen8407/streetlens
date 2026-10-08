import assert from 'node:assert/strict';
import { calculateAssessment } from '../scoring';
import type { Browser, BrowserContext } from 'playwright';

export async function testPanelInformationUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  const record = { id: 'panel-information-fixture', name: '永康街', streetName: '永康街', district: '大安區', city: '臺北市',
    coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 73.25, baselineClsScore: 70.25, fieldAdjustment: 3, grade: 'B', scores: {}, timestamp: 1700000000000,
    syncStatus: 'synced', fieldNotes: '保留筆記', observationRatings: {}, evidence: [],
    walkMoment: { feeling: 'good', accuracyMeters: 12, positionTimestamp: 1700000000000, confirmedAt: 1700000000000, source: 'walk' } };
  for (const width of [320, 390, 1440]) {
    for (const language of ['zh-TW', 'en']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await prepare(context);
      // Keep the layout fixture score stable while exercising the current
      // saved-report baseline read; score rebasing has its own integration test.
      await context.route(url => url.pathname === '/api/assessment', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          location: { ...record.coords, streetName: record.streetName, district: record.district, city: record.city },
          scores: { ...calculateAssessment({}, {}), overall: record.baselineClsScore },
          factors: [], poiCount: 0, dataSources: ['layout-test-only'], generatedAt: '2026-10-06T00:00:00Z',
        }),
      }));
      await context.addInitScript(({ record, language }) => {
        localStorage.setItem('cls_saved_locations', JSON.stringify([record]));
        localStorage.setItem('streetlens-language', language);
      }, { record, language });
      const page = await context.newPage();
      const english = language === 'en';
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(baseURL);
      await page.getByRole('button', { name: english ? 'Street Library' : '街道資料庫', exact: true }).click();
      const library = page.getByRole('complementary');
      assert.equal(await library.getByRole('heading').count(), 1, 'library has a single heading');
      const header = await library.locator('header').boundingBox();
      assert.ok(header && header.height <= 56, 'library header does not reserve space for removed descriptions');
      const panelBounds = await library.boundingBox();
      assert.ok(panelBounds && panelBounds.height <= 280, 'few records do not leave a screen-sized empty panel');
      const card = library.getByTestId('saved-library-card');
      const cardBounds = await card.boundingBox(), actions = await card.getByTestId('saved-library-actions').boundingBox();
      const heading = await card.getByTestId('saved-record-heading').locator('div').first().boundingBox();
      assert.ok(cardBounds && cardBounds.height <= 128, 'a completed record with feeling fits in a compact card');
      assert.ok(actions && heading && Math.abs(actions.y - heading.y) < 2 && heading.x + heading.width <= actions.x, 'actions share the title row without covering text');
      for (const button of await card.getByTestId('saved-library-actions').getByRole('button').all()) {
        const box = await button.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44, 'compact actions retain 44px touch targets');
      }
      const compare = card.getByRole('button', { name: english ? 'Compare' : '比較', exact: true });
      await compare.click();
      assert.equal(await compare.getAttribute('aria-pressed'), 'true', 'compare selects the record without opening its report');
      await library.getByText(english ? 'Compare assessments' : '比較評估', { exact: true }).waitFor();
      await compare.focus();
      await page.keyboard.press('Space');
      assert.equal(await compare.getAttribute('aria-pressed'), 'false', 'keyboard can deselect compare');
      const meta = library.getByTestId('saved-record-meta');
      const score = await meta.locator('span').boundingBox(), time = await meta.locator('time').boundingBox();
      assert.ok(score && time && Math.abs(score.y + score.height / 2 - time.y - time.height / 2) < 2, 'CLS and timestamp share a line');
      assert.equal(await meta.locator('time').getAttribute('datetime'), new Date(record.timestamp).toISOString(), 'compact date preserves the exact timestamp');
      await page.screenshot({ path: `artifacts/walk-ui/library-information-${width}-${language}.png` });
      await library.getByRole('button', { name: /永康街/ }).click();
      const report = page.getByRole('complementary');
      assert.equal(await report.locator('header').getByText('永康街', { exact: true }).count(), 0, 'report header does not repeat the road');
      assert.equal(await report.locator('header').getByText('73.25', { exact: true }).count(), 0, 'report header does not repeat CLS');
      const body = report.getByTestId('street-result-report');
      assert.equal(await body.getByText('永康街', { exact: true }).count(), 1, 'body retains the road');
      assert.equal(await body.getByText('73.25', { exact: true }).count(), 1, 'body retains CLS');
      assert.equal(await report.getByRole('button', { name: english ? 'Add to favorites' : '加入最愛', exact: true }).count(), 1, 'report has a single favorite action');
      assert.equal(await body.getByText(new Date(record.timestamp).toLocaleString(english ? 'en-US' : 'zh-TW'), { exact: true }).count(), 1, 'report timestamp appears once');
      await body.getByText('保留筆記', { exact: true }).waitFor();
      await body.getByText(/12 m/).waitFor();
      const method = body.getByTestId('cls-method');
      await method.getByText(english ? 'Data completeness' : '資料完整度', { exact: false }).waitFor();
      const formula = body.getByTestId('cls-formula');
      assert.equal(await formula.getAttribute('open'), null, 'formula starts collapsed to keep the report compact');
      await formula.locator('summary').click();
      await formula.getByText(english ? /Thresholds are provisional product settings/ : /門檻是待校準的產品設定/).waitFor();
      assert.equal(await formula.locator('div.font-medium').count(), 23, 'all fixed indicator weights and curves are inspectable');
      assert.ok(await body.evaluate(el => el.scrollWidth <= el.clientWidth), 'formula fits the report at mobile widths');
      await formula.locator('summary').click();
      await page.screenshot({ path: `artifacts/walk-ui/report-information-${width}-${language}.png` });
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('cls_saved_locations')!)), [record], 'layout changes preserve the full saved record');
      await page.getByRole('button', { name: english ? 'Data status' : '資料狀態', exact: true }).click();
      const settings = page.getByRole('complementary');
      assert.equal(await settings.getByRole('heading').count(), 1, 'data status has a single page heading');
      await settings.getByText(english ? 'Assessment basis' : '評估依據', { exact: true }).waitFor();
      await page.screenshot({ path: `artifacts/walk-ui/panel-information-${width}-${language}.png` });
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  const longContext = await browser.newContext({ viewport: { width: 320, height: 900 } });
  await prepare(longContext);
  await longContext.addInitScript(record => {
    localStorage.setItem('cls_saved_locations', JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ ...record,
      id: `layout-scroll-${i}`, name: `Layout street ${i}`, streetName: `Layout street ${i}`,
      coords: { lat: record.coords.lat + i * .002, lng: record.coords.lng } }))));
  }, record);
  const longPage = await longContext.newPage();
  await longPage.goto(baseURL);
  await longPage.getByRole('button', { name: '街道資料庫', exact: true }).click();
  const longLibrary = longPage.getByRole('complementary');
  assert.equal(await longLibrary.getByTestId('saved-library-card').count(), 20);
  const headerBefore = await longLibrary.locator('header').boundingBox();
  const overflow = await longLibrary.locator(':scope > div').evaluate(body => body.scrollHeight > body.clientHeight);
  assert.ok(overflow, 'many records use the bounded scroll area');
  await longLibrary.getByTestId('saved-library-card').last().scrollIntoViewIfNeeded();
  const headerAfter = await longLibrary.locator('header').boundingBox();
  assert.equal(headerAfter?.y, headerBefore?.y, 'scrolling records keeps the header in place');
  const longBounds = await longLibrary.boundingBox(), dock = await longPage.getByRole('navigation').boundingBox();
  assert.ok(longBounds && dock && longBounds.height <= 702 && longBounds.y + longBounds.height <= dock.y, 'long lists stay above the mobile dock');
  await longPage.screenshot({ path: 'artifacts/walk-ui/library-information-long-list.png' });
  await longContext.close();
  console.log('Panel information passed: compact headers/cards, fit-content and bounded scrolling, 44px actions and keyboard compare, inline date/CLS at 320/390/1440px in both languages, preserved notes, accuracy and saved records.');
}
