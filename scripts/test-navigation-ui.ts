import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';
import { navigationReducer, type Navigation } from '../src/hooks/useNavigation';

export async function testNavigationUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  let state: Navigation = { current: 'map', history: [] };
  for (const route of ['saved', 'report', 'settings'] as const) state = navigationReducer(state, { type: 'go', route });
  assert.equal(navigationReducer(state, { type: 'go', route: 'settings' }), state, 'repeat selections do not add history');
  for (const route of ['report', 'saved', 'map', 'map']) {
    state = navigationReducer(state, { type: 'back' });
    assert.equal(state.current, route);
  }
  assert.deepEqual(navigationReducer({ current: 'field', history: ['map', 'walk'] }, { type: 'close' }), { current: 'map', history: [] });
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await prepare(context);
    const page = await context.newPage();
    await page.goto(baseURL);
    let geocodes = 0;
    page.on('request', request => { if (request.url().includes('/api/reverse-geocode')) geocodes++; });
    await page.getByRole('button', { name: 'CLS 結果報告', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '返回地圖', exact: true }).count(), 0, 'arrow never doubles as map dismissal');
    const beforeDismiss = geocodes;
    await page.getByRole('complementary').getByText('CLS 街道報告', { exact: true }).click();
    assert.equal(await page.getByRole('complementary').count(), 1, 'panel clicks do not dismiss');
    await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    assert.equal(await page.getByRole('complementary').count(), 0, 'direct dock report returns to map, not library');
    assert.equal(geocodes, beforeDismiss, 'dismissing does not select a different street');
    assert.equal(await page.getByRole('navigation').locator('[aria-pressed="true"]').count(), 0, 'dismiss clears dock selection');
    const selection = page.waitForRequest(request => request.url().includes('/api/reverse-geocode'));
    await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    await selection;
    await page.getByRole('button', { name: '環境觀察', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: '良好', exact: true }).first().click();
    await page.mouse.move(4, 4);
    await page.mouse.down();
    await page.mouse.move(65, 8, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.getByRole('complementary').count(), 1, 'dragging the map does not dismiss');
    await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    await page.getByRole('button', { name: '環境觀察', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '返回環境觀察', exact: true }).count(), 0, 'dismiss clears previous navigation history');
    assert.ok(await page.getByRole('complementary').getByRole('button', { name: '良好', exact: true }).first().getAttribute('class').then(value => value?.includes('bg-white/10')), 'observation draft survives dismissal');
    await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    await page.getByRole('button', { name: 'CLS 結果報告', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: '資料狀態', exact: true }).click();
    await page.getByRole('button', { name: '返回評估', exact: true }).click();
    await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    await page.getByRole('button', { name: '實勘', exact: true }).click();
    await page.getByRole('button', { name: '詳細環境觀察', exact: true }).click();
    await page.getByRole('button', { name: '返回實勘', exact: true }).click();
    await page.getByRole('button', { name: '拍下畫面', exact: true }).waitFor();
    await page.getByRole('button', { name: '結束步行', exact: true }).click();
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: '個人設定', exact: true }).click();
      await page.getByRole('dialog').getByRole('radio', { name: theme === 'light' ? '淺色模式' : '深色模式', exact: true }).check();
      await page.getByRole('dialog').getByRole('button', { name: '關閉', exact: true }).click();
      for (const label of ['CLS 結果報告', '環境觀察', '資料狀態']) {
        await page.getByRole('button', { name: label, exact: true }).click();
        const panel = page.getByRole('complementary');
        if (width < 1024) {
          const bounds = await panel.boundingBox(), dock = await page.getByRole('navigation').boundingBox();
          assert.ok(bounds && dock && bounds.y + bounds.height <= dock.y, 'mobile panels leave the dock unobstructed');
        }
        const small = await panel.evaluate(root => [...root.querySelectorAll<HTMLElement>('*')].filter(el => el instanceof HTMLElement && el.getClientRects().length && [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) && parseFloat(getComputedStyle(el).fontSize) < 14).map(el => el.textContent));
        assert.deepEqual(small, [], `${label}: all visible panel text is at least 14px`);
        const contrast = await panel.evaluate(root => {
          const subtitle = root.querySelector('header .text-slate-300')!;
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          const [a, b] = [getComputedStyle(subtitle).color, getComputedStyle(root).backgroundColor].map(color => {
            ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
            const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          });
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        });
        assert.ok(contrast >= 4.5, `${label}/${theme} subtitle contrast ${contrast} meets 4.5:1`);
        await page.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
      }
    }
    await context.close();
  }
  console.log('Navigation/readability passed: actual origins, nested back, walk return, duplicate navigation, 14px minimum and dark/light contrast.');
}
