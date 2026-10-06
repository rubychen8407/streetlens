import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';

export async function testLanguageUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
  await prepare(context);
  const record = { id: 'language-fixture', name: 'My saved street', streetName: '永康街', district: '大安區', city: '臺北市',
    coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 73, grade: 'B', scores: {}, timestamp: 1700000000000,
    syncStatus: 'synced', fieldNotes: '我自己的筆記 / my own notes', observationRatings: { c1_lighting: 3 }, evidence: [] };
  await context.addInitScript(record => {
    if (!localStorage.getItem('cls_saved_locations')) localStorage.setItem('cls_saved_locations', JSON.stringify([record]));
  }, record);
  const requested: string[] = [];
  let release: (() => void) | undefined;
  let delay = false;
  await context.route('**/api/assessments/*/explanation?**', async route => {
    const language = new URL(route.request().url()).searchParams.get('language')!;
    requested.push(language);
    if (delay) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ language, source: 'gemini_ai',
      generatedAt: new Date().toISOString(), summary: language === 'en' ? 'English explanation fixture.' : '繁體中文解說測試。',
      strengths: [], limitations: [], fieldObservations: [], followUpChecks: [] }) }).catch(() => {});
  });
  const page = await context.newPage();
  async function chooseLanguage(language: 'en' | 'zh-TW') {
    await page.getByRole('button', { name: /^(個人設定|Profile settings)$/ }).click();
    await page.getByRole('dialog').getByRole('radio', { name: language === 'en' ? 'English' : '繁體中文', exact: true }).check();
    await page.getByRole('dialog').getByRole('button', { name: /^(關閉|Close)$/ }).click();
  }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL);
  await chooseLanguage('en');
  assert.equal(await page.getByRole('button', { name: /Switch to Chinese|切換至英文/ }).count(), 0, 'profile is the only language control');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: 'Field walk', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '實勘', exact: true }).count(), 0);
  const input = await page.getByLabel('Search locations', { exact: true }).boundingBox();
  assert.ok(input && input.width >= 100, 'language button leaves room for search on a 320px screen');
  await page.reload();
  await page.getByRole('button', { name: 'Field walk', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('streetlens-language')), 'en');
  await page.getByRole('button', { name: 'Environment observations', exact: true }).click();
  await page.getByText('Adequate night lighting', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Great', exact: true }).first().waitFor();
  const fieldText = await page.locator('aside').innerText();
  assert.ok(!/[\u4e00-\u9fff]/.test(fieldText.replace(/永康街|大安區|臺北市|中文/g, '')), 'English field UI has no Chinese labels');
  await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
  await page.getByRole('button', { name: 'Field walk', exact: true }).click();
  await page.getByRole('button', { name: 'Capture frame', exact: true }).waitFor();
  await page.getByRole('button', { name: 'End walk', exact: true }).click();
  await chooseLanguage('zh-TW');
  await page.getByRole('button', { name: '實勘', exact: true }).click();
  await page.getByRole('button', { name: '拍下畫面', exact: true }).waitFor();
  await page.getByRole('button', { name: '結束步行', exact: true }).click();
  await page.getByRole('button', { name: '街道資料庫', exact: true }).click();
  await page.getByRole('button', { name: /My saved street/ }).click();
  let report = page.getByRole('complementary', { name: '街道結果報告' });
  await report.getByRole('button', { name: '產生 AI 解說' }).click();
  await report.getByText('繁體中文解說測試。', { exact: true }).waitFor();
  await chooseLanguage('en');
  report = page.getByRole('complementary', { name: 'Street report' });
  assert.equal(await report.getByText('繁體中文解說測試。').count(), 0, 'switch clears the old-language explanation');
  await report.getByText('我自己的筆記 / my own notes', { exact: true }).waitFor();
  await report.getByRole('button', { name: 'Generate AI explanation' }).click();
  await report.getByText('English explanation fixture.').waitFor();
  assert.deepEqual(requested, ['zh-TW', 'en'], 'API requests use the selected language');
  delay = true;
  await report.getByRole('button', { name: 'Regenerate' }).click();
  await page.waitForFunction(() => !!document.querySelector('aside button:disabled'));
  // The response may arrive after switching; it must never appear in the new locale.
  for (let attempt = 0; !release && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(release, 'delayed explanation request reached the route');
  await chooseLanguage('zh-TW');
  release();
  await page.getByRole('button', { name: '產生 AI 解說' }).waitFor();
  assert.equal(await page.getByText('English explanation fixture.').count(), 0);
  delay = false;
  await page.getByRole('button', { name: '產生 AI 解說' }).click();
  await page.getByText('繁體中文解說測試。').waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('cls_saved_locations')!)), [record], 'language changes do not rewrite saved records or notes');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Bilingual UI passed: persisted language, 320px layout, field labels, camera controls, AI request language and stale-response rejection, unchanged history.');
}
