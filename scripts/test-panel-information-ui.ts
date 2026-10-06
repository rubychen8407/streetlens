import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';

export async function testPanelInformationUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  const record = { id: 'panel-information-fixture', name: '永康街', streetName: '永康街', district: '大安區', city: '臺北市',
    coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 73.25, grade: 'B', scores: {}, timestamp: 1700000000000,
    syncStatus: 'synced', fieldNotes: '保留筆記', observationRatings: {}, evidence: [],
    walkMoment: { feeling: 'good', accuracyMeters: 12, positionTimestamp: 1700000000000, confirmedAt: 1700000000000, source: 'walk' } };
  for (const width of [320, 390, 1440]) {
    for (const language of ['zh-TW', 'en']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await prepare(context);
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
  console.log('Panel information passed: single headings and report summary, inline date/CLS at 320/390/1440px in both languages, preserved notes, accuracy and saved records.');
}
