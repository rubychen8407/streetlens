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
  // Removed quick recording must not be reachable through old shortcut URLs.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(context);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  let cameraOpens = 0; page.on('filechooser', () => cameraOpens++);
  await page.goto(baseURL + '/?mode=walk&feeling=good');
  await page.getByRole('button', { name: '環境觀察', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '步行感受' }).count(), 0);
  for (const key of ['1', '2', 'c']) await page.keyboard.press(key);
  assert.equal((await saved(page)).length, 0);
  assert.equal(cameraOpens, 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cls_favorite_locations') || '[]').length), 0);
  await context.close();
  readyScore = true;

  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [844, 390], [1024, 768], [1440, 900]]) {
    const layout = await browser.newContext({ viewport: { width, height } }); await prepare(layout);
    const view = await layout.newPage(); view.on('pageerror', error => errors.push(error.message));
    await view.goto(baseURL);
    await view.getByRole('button', { name: '環境觀察', exact: true }).waitFor();
    assert.equal(await view.getByRole('button', { name: '環境觀察', exact: true }).innerText(), '環境觀察');
    assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const input = await view.locator('input').first().boundingBox(); assert.ok(input && input.width >= 100, 'mobile search must remain usable');
    await view.screenshot({ path: `artifacts/walk-ui/map-${width}.png` });
    // Toolbar alignment, touch targets and keyboard-accessible popovers at every breakpoint.
    const search = await view.getByLabel('搜尋新的實勘點', { exact: true }).boundingBox();
    const tools = await view.locator('.map-tools').boundingBox();
    const entry = await view.getByRole('button', { name: 'CLS 評估', exact: true }).boundingBox();
    assert.ok(search && tools && entry && search.x + search.width <= entry.x && entry.x + entry.width <= tools.x);
    assert.ok(Math.abs(search.y - tools.y) <= 1 && search.height === tools.height, 'search and toolbar align');
    for (const label of ['環境觀察', '定位', '圖層', '帳戶']) {
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
    await view.getByRole('button', { name: 'CLS 評估', exact: true }).click();
    const panel = view.getByRole('complementary', { name: '街道評估面板' });
    assert.equal(await panel.getByText('Your observation', { exact: true }).count(), 0, 'CLS does not contain field-rating workflow');
    assert.equal(await panel.getByRole('button', { name: 'Continue', exact: true }).count(), 0);
    const bounds = await panel.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
    const footer = await panel.locator('footer').boundingBox();
    assert.ok(footer && footer.y + footer.height <= height, 'primary action stays on screen');
    await view.screenshot({ path: `artifacts/walk-ui/assessment-${width}.png` });
    await view.getByRole('button', { name: '關閉評估' }).focus();
    await view.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal(await view.getByRole('button', { name: 'CLS 評估', exact: true }).evaluate(element => element === document.activeElement), true, 'dismiss restores focus');
    await view.getByRole('button', { name: '環境觀察', exact: true }).click();
    await panel.getByText('Your observation', { exact: true }).waitFor();
    assert.equal(await panel.getByText('詳細實勘', { exact: true }).count(), 1);
    assert.equal(await view.getByRole('region', { name: '步行感受' }).count(), 0);
    assert.equal(await view.getByRole('button', { name: '喜歡這裡', exact: true }).count(), 0);
    assert.equal(await view.getByRole('button', { name: '不喜歡', exact: true }).count(), 0);
    assert.equal(await view.getByRole('button', { name: '拍照留存', exact: true }).count(), 0);
    assert.equal(await view.getByRole('button', { name: 'iPhone 快捷入口' }).count(), 0);
    let cameraOpens = 0; view.on('filechooser', () => cameraOpens++);
    for (const key of ['1', '2', 'c']) await view.keyboard.press(key);
    assert.equal((await saved(view)).length, 0, 'removed keys cannot record a visit');
    assert.equal(cameraOpens, 0, 'removed camera shortcut cannot open a picker');
    const fieldBounds = await panel.boundingBox();
    assert.ok(fieldBounds && fieldBounds.x >= 0 && fieldBounds.y >= 0 && fieldBounds.x + fieldBounds.width <= width && fieldBounds.y + fieldBounds.height <= height);
    await view.screenshot({ path: `artifacts/walk-ui/field-${width}.png` });
    await layout.close();
  }

  // Denied GPS still allows observations for a manually selected map point.
  const denied = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(denied, true);
  const deniedPage = await denied.newPage(); await deniedPage.goto(baseURL + '/?mode=walk');
  await deniedPage.getByRole('button', { name: '環境觀察', exact: true }).click();
  await deniedPage.getByText('Your observation', { exact: true }).waitFor();
  assert.equal((await saved(deniedPage)).length, 0);
  await denied.close();

  // The existing star action must also save a row before CLS is available.
  readyScore = false;
  const favoriteContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(favoriteContext);
  const favoritePage = await favoriteContext.newPage();
  await favoritePage.goto(baseURL);
  await favoritePage.getByRole('button', { name: 'CLS 評估', exact: true }).click();
  await favoritePage.getByRole('button', { name: '加入最愛', exact: true }).click();
  assert.equal((await saved(favoritePage)).length, 1);
  assert.equal((await saved(favoritePage))[0].clsScore, null);
  readyScore = true;
  await favoritePage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await favoritePage.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]')[0]?.clsScore === 80);
  await favoriteContext.close();


  // A 202 is a waiting state, not a permanent blank score. Recheck persisted data.
  readyScore = false;
  const pendingContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(pendingContext);
  const pendingPage = await pendingContext.newPage(); await pendingPage.goto(baseURL);
  await pendingPage.getByText('CLS 尚未就緒', { exact: true }).waitFor();
  assert.equal(await pendingPage.getByRole('button', { name: '重試 CLS' }).isEnabled(), true);
  readyScore = true;
  await pendingPage.getByLabel('CLS 分數 80，等級 A', { exact: true }).waitFor({ timeout: 35000 });
  assert.equal(await pendingPage.getByRole('region', { name: 'CLS 載入狀態' }).count(), 0);
  await pendingPage.getByRole('button', { name: 'CLS 評估', exact: true }).click();
  await pendingPage.getByRole('button', { name: '開始實勘', exact: true }).click();
  await pendingPage.getByText('Your observation', { exact: true }).waitFor();
  assert.equal(await pendingPage.getByText('詳細實勘', { exact: true }).count(), 1, 'field view replaces CLS read view');
  assert.equal((await saved(pendingPage)).length, 0);
  await pendingPage.getByRole('button', { name: 'Continue', exact: true }).click();
  await pendingPage.getByRole('button', { name: 'Take photo', exact: true }).waitFor();
  let pendingCameraOpens = 0; pendingPage.on('filechooser', () => pendingCameraOpens++);
  await pendingPage.getByRole('button', { name: 'Take photo', exact: true }).focus();
  for (const key of ['1', '2', 'c']) await pendingPage.keyboard.press(key);
  assert.equal(pendingCameraOpens, 0);
  assert.equal((await saved(pendingPage)).length, 0, 'review requires an explicit save');
  await pendingPage.getByPlaceholder('Assessment name').fill('現場觀察');
  await pendingPage.getByRole('button', { name: 'Save', exact: true }).click();
  await pendingPage.getByText('Assessment saved.', { exact: true }).waitFor();
  assert.equal((await saved(pendingPage)).length, 1);
  assert.equal((await saved(pendingPage))[0].walkMoment, undefined);
  assert.equal((await saved(pendingPage))[0].name, '現場觀察');
  await pendingContext.close();

  // Removing quick capture must preserve historical feelings and photo evidence.
  const historyContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(historyContext);
  await historyContext.addInitScript(() => {
    if (localStorage.getItem('cls_saved_locations')) return;
    const timestamp = Date.now();
    localStorage.setItem('cls_saved_locations', JSON.stringify(['good', 'bad', 'photo'].map((feeling, i) => ({
      id: 'old-visit-' + i, name: 'Old visit ' + feeling, streetName: '永康街', district: '大安區', city: '臺北市',
      coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 73, grade: 'B', scores: {}, timestamp, syncStatus: 'synced',
      walkMoment: { feeling, accuracyMeters: 12, positionTimestamp: timestamp, confirmedAt: timestamp, source: 'walk' },
      evidence: feeling === 'photo' ? [{ id: 'old-photo', type: 'photo', storageKey: 'kept-photo', capturedAt: timestamp, location: { lat: 25.0326, lng: 121.5298 } }] : [],
    }))));
  });
  const historyPage = await historyContext.newPage(); await historyPage.goto(baseURL + '/?mode=walk');
  await historyPage.getByRole('button', { name: '環境觀察', exact: true }).waitFor();
  const before = await saved(historyPage); assert.equal(before.length, 3);
  await historyPage.reload(); await historyPage.getByRole('button', { name: '環境觀察', exact: true }).waitFor();
  assert.deepEqual(await saved(historyPage), before, 'historical records and evidence survive reload unchanged');
  await historyPage.getByRole('button', { name: '帳戶', exact: true }).click();
  await historyPage.getByRole('button').filter({ hasText: 'Favorites' }).click();
  await historyPage.getByText('Old visit photo', { exact: true }).waitFor();
  await historyContext.close();

  // Legacy saved history may have only a persisted total; it still renders in CLS.
  const legacyContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(legacyContext);
  await legacyContext.addInitScript(() => localStorage.setItem('cls_saved_locations', JSON.stringify([{
    id: 'legacy-score', name: '舊紀錄', streetName: '舊街道', district: '大安區', city: '臺北市',
    coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 73, grade: 'B', scores: {}, timestamp: Date.now(), syncStatus: 'synced',
  }])));
  const legacyPage = await legacyContext.newPage(); await legacyPage.goto(baseURL);
  await legacyPage.getByRole('button', { name: '帳戶', exact: true }).click();
  await legacyPage.getByRole('button').filter({ hasText: 'Favorites' }).click();
  await legacyPage.getByText('舊紀錄', { exact: true }).click();
  await legacyPage.getByLabel('CLS 分數 73，等級 B', { exact: true }).waitFor();
  await legacyContext.close();

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
  await deletionPage.getByRole('button', { name: '環境觀察', exact: true }).waitFor();
  assert.equal((await saved(deletionPage)).length, 0, 'offline deletion must survive stale remote history and reload');
  assert.deepEqual(await deletionPage.evaluate(() => JSON.parse(localStorage.getItem('cls_pending_deletions') || '[]')), ['offline-delete']);
  await deletionContext.close();
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  console.log('Field UI checks passed: removed quick recording and shortcuts, structured observations and explicit save, preserved historical visits/evidence, mobile/desktop layout, favorites, delayed CLS, legacy scores and offline deletion.');
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

