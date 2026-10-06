import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';
import { t } from '../src/i18n';
import { openMapAssessment } from './mapAssessmentEntry';

export async function testMapAssessmentEntryUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await prepare(context);
    const page = await context.newPage();
    let reads = 0, reverseGeocodes = 0, writes = 0;
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/assessment') reads++;
      if (path === '/api/reverse-geocode') reverseGeocodes++;
      if (path === '/api/assessments' && request.method() !== 'GET') writes++;
    });
    await page.goto(baseURL);
    assert.equal(await page.getByRole('button', { name: t('CLS 結果報告'), exact: true }).count(), 0);
    await openMapAssessment(page);
    const panel = page.getByRole('complementary', { name: t('街道評估面板') });
    await panel.getByText('80', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#leaflet-apple-map').evaluate(node => node === document.activeElement), true);

    const beforePointer = reads, beforeGeocode = reverseGeocodes;
    await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    await panel.getByText('80', { exact: true }).waitFor();
    assert.equal(reads, beforePointer + 1, 'pointer selection reads baseline once');
    assert.equal(reverseGeocodes, beforeGeocode + 1);
    const beforeDismiss = reads, geocodesBeforeDismiss = reverseGeocodes;
    await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    await panel.waitFor({ state: 'hidden' });
    assert.equal(reads, beforeDismiss, 'background dismissal does not select or refetch');
    assert.equal(reverseGeocodes, geocodesBeforeDismiss);

    const beforePin = reads;
    await page.locator('.ios-target-marker').click();
    await panel.getByText('80', { exact: true }).waitFor();
    assert.equal(reads, beforePin + 1, 'pin click does not also bubble into a second selection');
    await page.keyboard.press('Escape');

    const beforeSearch = reads;
    await page.getByLabel(t('搜尋地點'), { exact: true }).fill('25.0339,121.5645');
    await page.getByRole('button', { name: /25\.03390, 121\.56450/ }).click();
    await panel.getByText('80', { exact: true }).waitFor();
    assert.equal(reads, beforeSearch + 1, 'search selection opens assessment with one persisted read');
    assert.equal(writes, 0, 'viewing an assessment never creates a visit');
    assert.equal(await page.getByRole('navigation').locator('[aria-pressed="true"]').count(), 0, 'map assessment does not highlight an unrelated dock action');
    await context.close();
  }
  console.log('Map entry passed: no CLS dock, mouse/pin/search/keyboard entry, one read per selection, dismissal without reads and no auto-save.');
}
