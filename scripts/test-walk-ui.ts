import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { applyFieldObservationAdjustment, calculateAssessment } from '../scoring';

const baseURL = 'http://127.0.0.1:4173';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
let serverOutput = '';
server.stderr.on('data', value => { serverOutput += String(value); });
const errors: string[] = [];
let readyScore = false;

async function prepare(context: BrowserContext, permissionDenied = false) {
  context.setDefaultTimeout(8000);
  // Raw JS fixture avoids transpiler helper references in the browser realm.
  const fixture = await readFile('scripts/fixtures/walk-browser.js', 'utf8');
  await context.addInitScript({ content: `(() => { const permissionDenied = ${permissionDenied}; ${fixture} })();` });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let status = 200, body: unknown = {};
    if (url.pathname === '/api/reverse-geocode') body = { address: { road: '永康街', district: '大安區', city: '臺北市' } };
    else if (url.pathname === '/api/assessment/field-adjustment') {
      const input = route.request().postDataJSON(); body = applyFieldObservationAdjustment(input.baselineCls, input.ratings);
    } else if (url.pathname === '/api/assessment') {
      if (!readyScore) { status = 202; body = { dataStatus: 'pending_refresh', missingSources: [], scores: null }; }
      else body = {
        location: { lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lng')), streetName: url.searchParams.get('streetName'), district: '大安區', city: '臺北市' },
        scores: { ...calculateAssessment({}, {}, undefined, undefined, undefined, undefined, undefined, Array.from({ length: 19 }, (_, i) => i + 1)), overall: 80 },
        factors: [], poiCount: 0, dataSources: ['UI test fixture only'], generatedAt: new Date().toISOString(),
      };
    } else if (url.pathname === '/api/assessments') {
      status = route.request().method() === 'GET' ? 200 : 503; body = route.request().method() === 'GET' ? [] : { error: 'Offline test' };
    } else body = { pois: [], segments: [] };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function saved(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]')); }
async function confirm(page: Page) {
  await page.getByRole('button', { name: '位置正確，開始' }).click();
  await page.getByRole('button', { name: '喜歡這裡' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: '喜歡這裡' }).isEnabled(), true);
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode != null) throw new Error('Preview failed: ' + serverOutput);
    try { if ((await fetch(baseURL)).ok) break; } catch {}
    if (attempt >= 100) throw new Error('Preview timed out: ' + serverOutput);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  await mkdir('artifacts/walk-ui', { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
  await prepare(context);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/?mode=walk');
  await page.getByRole('region', { name: '步行感受' }).waitFor();
  assert.equal((await saved(page)).length, 0, 'deep link must never auto-save');
  assert.equal(await page.getByRole('button', { name: '喜歡這裡' }).isEnabled(), false);
  await confirm(page);
  await page.screenshot({ path: 'artifacts/walk-ui/walk-mobile.png' });
  await page.getByRole('button', { name: '喜歡這裡' }).dblclick();
  await page.getByRole('status').filter({ hasText: '已記下喜歡' }).waitFor();
  let records = await saved(page);
  assert.equal(records.length, 1, 'double tap creates only one visit');
  assert.equal(records[0].walkMoment.feeling, 'good'); assert.equal(records[0].clsScore, null);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cls_favorite_locations') || '[]').length), 1);

  // Fresh GPS elsewhere invalidates confirmation instead of tagging the wrong street.
  await page.evaluate(() => (window as any).__emitFix(25.0346, 121.5298));
  await page.getByRole('button', { name: '位置正確，開始' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '不喜歡', exact: true }).isEnabled(), false);
  await confirm(page);
  // Prevent accidental repeat-tap guard from affecting this independent observation.
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: '不喜歡', exact: true }).click();
  records = await saved(page); assert.equal(records.length, 2);
  assert.equal(records[0].walkMoment.feeling, 'bad');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cls_favorite_locations') || '[]').length), 1);

  await page.getByRole('button', { name: '拍照留存', exact: true }).click();
  await page.evaluate(() => (window as any).__emitFix(25.0366, 121.5298));
  const photoBytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1536;
    const context = canvas.getContext('2d')!; context.fillStyle = '#2879a4'; context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[aria-label="步行照片"]').setInputFiles({ name: 'walk.png', mimeType: 'image/png', buffer: Buffer.from(photoBytes, 'base64') });
  await page.getByRole('status').filter({ hasText: '照片與拍照起始位置已儲存' }).waitFor();
  records = await saved(page); assert.equal(records.length, 3);
  assert.equal(records[0].coords.lat, 25.0346, 'camera must retain the location at launch');
  const photoKey = records[0].evidence[0].storageKey;
  assert.ok(photoKey);
  assert.equal(records[0].evidence[0].mimeType, 'image/jpeg');
  assert.equal(records[0].evidence[0].width, 1280);

  readyScore = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]').every((item: any) => item.clsScore === 80));
  records = await saved(page); assert.equal(records[0].evidence[0].storageKey, photoKey);
  await page.reload();
  assert.equal((await saved(page)).length, 3, 'reload preserves visits and photos');
  await confirm(page);
  await page.evaluate(() => { (window as any).__failStorage = true; });
  await page.getByRole('button', { name: '喜歡這裡' }).click();
  await page.getByRole('alert').filter({ hasText: '儲存空間不足' }).waitFor();
  assert.equal((await saved(page)).length, 3, 'failed storage must not report success or add a visit');
  await page.evaluate(() => { (window as any).__failStorage = false; (window as any).__emitFix(25.0326, 121.5298, 21_000); });
  assert.equal(await page.getByRole('button', { name: '喜歡這裡' }).isEnabled(), false, 'stale GPS disables recording');
  await page.getByRole('button', { name: '結束步行' }).click();
  assert.equal(await page.evaluate(() => (window as any).__watchCount()), 1, 'walk watcher is cleaned up');
  await page.getByRole('button', { name: '帳戶', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Favorites' }).click();
  await page.getByText('CLS 80', { exact: false }).first().waitFor();
  await page.screenshot({ path: 'artifacts/walk-ui/saved-mobile.png' });
  await context.close();

  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [844, 390], [1024, 768], [1440, 900]]) {
    const layout = await browser.newContext({ viewport: { width, height } }); await prepare(layout);
    const view = await layout.newPage(); view.on('pageerror', error => errors.push(error.message));
    await view.goto(baseURL);
    await view.getByRole('button', { name: '步行感受', exact: true }).waitFor();
    assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const input = await view.locator('input').first().boundingBox(); assert.ok(input && input.width >= 100, 'mobile search must remain usable');
    await view.screenshot({ path: `artifacts/walk-ui/map-${width}.png` });
    // Toolbar alignment, touch targets and keyboard-accessible popovers at every breakpoint.
    const search = await view.getByLabel('搜尋新的實勘點', { exact: true }).boundingBox();
    const tools = await view.locator('.map-tools').boundingBox();
    const entry = await view.getByRole('button', { name: '實勘', exact: true }).boundingBox();
    assert.ok(search && tools && entry && search.x + search.width <= entry.x && entry.x + entry.width <= tools.x);
    assert.ok(Math.abs(search.y - tools.y) <= 1 && search.height === tools.height, 'search and toolbar align');
    for (const label of ['步行感受', '定位', '圖層', '帳戶']) {
      const box = await view.getByRole('button', { name: label, exact: true }).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, label + ' needs a touch target');
    }
    await view.getByRole('button', { name: '圖層', exact: true }).click();
    const layer = view.getByRole('switch', { name: '300m / 500m 步行圈' });
    const before = await layer.getAttribute('aria-checked');
    await layer.focus(); await view.keyboard.press('Space');
    assert.notEqual(await layer.getAttribute('aria-checked'), before);
    const popover = await view.locator('.layer-popover').boundingBox();
    assert.ok(popover && popover.x >= 0 && popover.y >= 0 && popover.y + popover.height <= height, 'layers fit the viewport');
    await view.keyboard.press('Escape');
    assert.equal(await layer.count(), 0);
    assert.equal(await view.getByRole('button', { name: '圖層', exact: true }).evaluate(element => element === document.activeElement), true);
    await view.getByRole('button', { name: '實勘', exact: true }).click();
    const panel = view.getByRole('complementary', { name: '街道評估面板' });
    const bounds = await panel.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
    const footer = await panel.locator('footer').boundingBox();
    assert.ok(footer && footer.y + footer.height <= height, 'primary action stays on screen');
    await view.screenshot({ path: `artifacts/walk-ui/assessment-${width}.png` });
    await view.getByRole('button', { name: '關閉評估' }).focus();
    await view.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal(await view.getByRole('button', { name: '實勘', exact: true }).evaluate(element => element === document.activeElement), true, 'dismiss restores focus');
    await view.getByRole('button', { name: '步行感受', exact: true }).click(); await confirm(view);
    const walkBounds = await view.getByRole('region', { name: '步行感受' }).boundingBox();
    assert.ok(walkBounds && walkBounds.x >= 0 && walkBounds.y >= 0 && walkBounds.x + walkBounds.width <= width && walkBounds.y + walkBounds.height <= height, 'walk panel fits tablet and landscape');
    await view.getByRole('button', { name: 'iPhone 快捷入口' }).click();
    assert.equal(await view.getByLabel('步行模式網址').inputValue(), baseURL + '/?mode=walk');
    await layout.close();
  }

  const denied = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(denied, true);
  const deniedPage = await denied.newPage(); await deniedPage.goto(baseURL + '/?mode=walk');
  await deniedPage.getByText('請在瀏覽器設定允許位置存取，再重試。').waitFor();
  assert.equal(await deniedPage.getByRole('button', { name: '喜歡這裡' }).isEnabled(), false);
  assert.equal((await saved(deniedPage)).length, 0);
  await denied.close();

  // The existing star action must also save a row before CLS is available.
  readyScore = false;
  const favoriteContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(favoriteContext);
  const favoritePage = await favoriteContext.newPage();
  await favoritePage.goto(baseURL);
  await favoritePage.getByRole('button', { name: '實勘', exact: true }).click();
  await favoritePage.getByRole('button', { name: '加入最愛', exact: true }).click();
  assert.equal((await saved(favoritePage)).length, 1);
  assert.equal((await saved(favoritePage))[0].clsScore, null);
  readyScore = true;
  await favoritePage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await favoritePage.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]')[0]?.clsScore === 80);
  await favoriteContext.close();

  const deletionContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(deletionContext);
  const remoteVisit = { id: 'offline-delete', name: 'Remote visit', streetName: '永康街', district: '大安區', city: '臺北市', coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 80, grade: 'A', scores: {}, timestamp: Date.now(), syncStatus: 'synced' };
  await deletionContext.route(url => url.pathname.startsWith('/api/assessments'), route => route.fulfill({ status: route.request().method() === 'DELETE' ? 503 : 200,
    contentType: 'application/json', body: JSON.stringify(route.request().method() === 'DELETE' ? { error: 'Offline' } : [remoteVisit]) }));
  const deletionPage = await deletionContext.newPage(); await deletionPage.goto(baseURL);
  await deletionPage.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]').length === 1);
  await deletionPage.getByRole('button', { name: '帳戶', exact: true }).click();
  await deletionPage.getByRole('button').filter({ hasText: 'Favorites' }).click();
  await deletionPage.getByTitle('Delete assessment').click();
  assert.equal((await saved(deletionPage)).length, 0);
  await deletionPage.reload();
  await deletionPage.getByRole('button', { name: '步行感受', exact: true }).waitFor();
  assert.equal((await saved(deletionPage)).length, 0, 'offline deletion must survive stale remote history and reload');
  assert.deepEqual(await deletionPage.evaluate(() => JSON.parse(localStorage.getItem('cls_pending_deletions') || '[]')), ['offline-delete']);
  await deletionContext.close();
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  console.log('Walk UI checks passed: mobile/desktop layout, GPS gates, feelings/favorites, photo location, CLS backfill, reload, quota failure, denied permission, shortcut entry and watcher cleanup.');
} catch (error) {
  console.error('Browser errors:', errors);
  for (const context of browser?.contexts() || []) {
    for (const page of context.pages()) {
      console.error((await page.locator('body').innerText()).slice(-2500));
      await page.screenshot({ path: 'artifacts/walk-ui/failure.png' }).catch(() => {});
    }
  }
  throw error;
} finally { await browser?.close(); server.kill('SIGTERM'); }
