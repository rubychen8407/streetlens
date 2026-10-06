import { t } from '../src/i18n';
import { testLanguageUI } from './test-language-ui';
import { testProfileUI } from './test-profile-ui';
import { testNavigationUI } from './test-navigation-ui';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { applyFieldObservationAdjustment, calculateAssessment } from '../scoring';
import { streetIdentity } from '../src/utils/streetBaseline';

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
      if (!readyScore) { status = 202; body = { dataStatus: t("pending_refresh"), missingSources: [], scores: null }; }
      else body = {
        location: { lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lng')), streetName: url.searchParams.get('streetName'), district: '大安區', city: '臺北市' },
        scores: { ...calculateAssessment({}, {}, undefined, undefined, undefined, undefined, undefined, Array.from({ length: 19 }, (_, i) => i + 1)), overall: 80 },
        factors: [], poiCount: 0, dataSources: ['UI test fixture only'], generatedAt: new Date().toISOString(),
      };
    } else if (url.pathname === '/api/assessments') {
      status = route.request().method() === 'GET' ? 200 : 507; body = route.request().method() === 'GET' ? [] : { error: 'STORAGE_WRITE_LIMIT' };
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
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  await mkdir('artifacts/walk-ui', { recursive: true });
  // Removed quick recording must not be reachable through old shortcut URLs.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(context);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  let cameraOpens = 0; page.on('filechooser', () => cameraOpens++);
  await page.goto(baseURL + '/?mode=walk&feeling=good');
  await page.getByRole('button', { name: t("環境觀察"), exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: t("步行感受") }).count(), 0);
  for (const key of ['1', '2', 'c']) await page.keyboard.press(key);
  assert.equal((await saved(page)).length, 0);
  assert.equal(cameraOpens, 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cls_favorite_locations') || '[]').length), 0);
  const status = page.getByRole('region', { name: t("CLS 載入狀態") });
  await status.waitFor();
  const statusBox = await status.boundingBox();
  const searchBox = await page.getByLabel(t("搜尋地點"), { exact: true }).boundingBox();
  assert.ok(statusBox && searchBox && Math.abs(statusBox.x - searchBox.x) <= 1 && statusBox.y >= searchBox.y + searchBox.height);
  await page.getByRole('button', { name: t("關閉 CLS 提示") }).click();
  assert.equal(await status.count(), 0);
  await page.reload();
  await status.waitFor();
  await status.waitFor({ state: 'hidden', timeout: 7500 });
  await context.close();
  const walkContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(walkContext);
  const walkPage = await walkContext.newPage();
  await walkPage.goto(baseURL);
  await walkPage.getByRole('button', { name: t("實勘"), exact: true }).click();
  assert.equal(await walkPage.getByRole('button', { name: '位置正確，開始', exact: true }).count(), 0);
  const livePanel = walkPage.getByRole('region', { name: t("步行感受") });
  const liveBox = await livePanel.boundingBox();
  assert.ok(liveBox && liveBox.x === 0 && liveBox.y === 0 && liveBox.width === 390 && liveBox.height === 844);
  await walkPage.getByRole('button', { name: t("拍下畫面"), exact: true }).click();
  await walkPage.getByText(t("目前畫面與位置已儲存。"), { exact: true }).waitFor();
  const frameRecord = (await saved(walkPage))[0];
  assert.equal(frameRecord.walkMoment.feeling, 'photo');
  assert.ok(frameRecord.evidence[0].width > 0 && frameRecord.evidence[0].height > 0);
  assert.equal(frameRecord.coords.lat, 25.0326);
  const storedBytes = await walkPage.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('streetlens-evidence');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const blob = await new Promise<Blob>((resolve, reject) => {
      const request = db.transaction('photos').objectStore('photos').get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close(); return { bytes: blob.size, type: blob.type };
  }, frameRecord.evidence[0].storageKey);
  assert.ok(storedBytes.bytes > 0 && storedBytes.bytes <= 2 * 1024 * 1024);
  assert.equal(storedBytes.type, 'image/jpeg');
  await walkPage.getByRole('button', { name: t("喜歡這裡"), exact: true }).click();
  assert.equal((await saved(walkPage)).length, 1, 'photo followed by like updates the same record');
  assert.equal((await saved(walkPage))[0].id, frameRecord.id);
  assert.equal((await saved(walkPage))[0].walkMoment.feeling, 'good');
  assert.equal((await saved(walkPage))[0].evidence[0].storageKey, frameRecord.evidence[0].storageKey);
  assert.equal((await saved(walkPage))[0].baselineClsScore, null);
  await walkPage.evaluate(() => { (window as any).__failStorage = true; });
  await walkPage.getByRole('button', { name: t("拍下畫面"), exact: true }).click();
  await walkPage.getByText(t("儲存空間不足，尚未儲存；請釋出空間後重試。"), { exact: true }).waitFor();
  assert.equal((await saved(walkPage)).length, 1, 'failed capture cannot overwrite the existing record');
  await walkPage.evaluate(() => { (window as any).__failStorage = false; });
  await walkPage.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await walkPage.evaluate(() => (window as any).__cameraTracks.every((track: MediaStreamTrack) => track.readyState === 'ended')), true);
  await walkPage.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await walkPage.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && !video.paused && video.readyState >= 2;
  });
  assert.equal(await walkPage.locator('input[type=file]:visible').count(), 0);
  await walkPage.evaluate(() => (window as any).__emitFix(25.0326, 121.5298, 30000, 12));
  assert.equal(await walkPage.getByRole('button', { name: t("喜歡這裡"), exact: true }).isDisabled(), true);
  assert.equal(await walkPage.getByRole('button', { name: t("拍下畫面"), exact: true }).isDisabled(), true);
  await walkPage.getByRole('button', { name: t("結束步行") }).click();
  assert.equal(await walkPage.evaluate(() => (window as any).__cameraTracks.every((track: MediaStreamTrack) => track.readyState === 'ended')), true);
  await walkPage.reload();
  await walkPage.getByRole('button', { name: t("實勘"), exact: true }).waitFor();
  assert.equal((await saved(walkPage))[0].walkMoment.feeling, 'good');
  await walkContext.close();
  const deniedCameraContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(deniedCameraContext);
  await deniedCameraContext.addInitScript(() => { (window as any).__denyCamera = true; });
  const deniedCameraPage = await deniedCameraContext.newPage();
  await deniedCameraPage.goto(baseURL);
  await deniedCameraPage.getByRole('button', { name: t("實勘"), exact: true }).click();
  await deniedCameraPage.getByText(t("請允許相機存取，才能顯示實勘畫面。"), { exact: true }).waitFor();
  assert.equal(await deniedCameraPage.getByRole('button', { name: t("拍下畫面"), exact: true }).isDisabled(), true);
  assert.equal((await saved(deniedCameraPage)).length, 0);
  await deniedCameraContext.close();
  readyScore = true;

  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [844, 390], [1024, 768], [1440, 900]]) {
    const layout = await browser.newContext({ viewport: { width, height } }); await prepare(layout);
    const view = await layout.newPage(); view.on('pageerror', error => errors.push(error.message));
    await view.goto(baseURL);
    await view.getByRole('button', { name: t("環境觀察"), exact: true }).waitFor();
    assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const input = await view.getByLabel(t('搜尋地點'), { exact: true }).boundingBox(); assert.ok(input && input.width >= 100, 'mobile search must remain usable');
    await view.screenshot({ path: `artifacts/walk-ui/map-${width}.png` });
    // Toolbar alignment, touch targets and keyboard-accessible popovers at every breakpoint.
    const search = await view.getByLabel(t("搜尋地點"), { exact: true }).boundingBox();
    const tools = await view.getByRole('button', { name: t("定位到目前位置") }).boundingBox();
    const entry = await view.getByRole('button', { name: t("CLS 結果報告"), exact: true }).boundingBox();
    const dockLocator = view.getByRole('navigation', { name: t("地點功能") });
    const dock = await dockLocator.boundingBox();
    const dockBackground = await dockLocator.evaluate(element => getComputedStyle(element).backgroundImage);
    assert.ok(dockBackground.startsWith('linear-gradient') && /rgba\([^)]*, 0\.\d+\)/.test(dockBackground), 'dock uses a translucent glass surface');
    assert.ok(search && tools && entry && dock && Math.abs(search.y - tools.y) <= 1 && search.height === tools.height);
    if (width < 1024) {
      assert.ok(dock.width > dock.height && height - (dock.y + dock.height) <= 20, 'mobile dock is a bottom horizontal bar');
    } else {
      assert.ok(dock.x < search.x && entry.x < search.x, 'desktop dock remains on the left');
    }
    assert.ok(Math.abs(search.y - tools.y) <= 1 && search.height === tools.height, 'search and location action align');
    const observationButton = view.getByRole('button', { name: t("環境觀察"), exact: true });
    const locationButton = view.getByRole('button', { name: t("定位到目前位置"), exact: true });
    const observationBox = await observationButton.boundingBox();
    assert.ok(observationBox && tools && (observationBox.x + observationBox.width <= tools.x || tools.x + tools.width <= observationBox.x || observationBox.y + observationBox.height <= tools.y || tools.y + tools.height <= observationBox.y), 'observation and location touch areas do not overlap');
    await locationButton.click();
    assert.equal(await view.getByRole('complementary', { name: t("街道評估面板") }).count(), 0, 'GPS does not open the observation panel');
    for (const label of [t("CLS 結果報告"), t("環境觀察"), t("Street Library"), t("實勘"), t("資料狀態")]) {
      const box = await view.getByRole('button', { name: t(label), exact: true }).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, label + ' needs a touch target');
    }
    assert.equal(await dockLocator.getByRole('button', { name: t("Street Library"), exact: true }).count(), 0);
    const library = view.getByRole('button', { name: t("Street Library"), exact: true });
    const libraryBox = await library.boundingBox();
    assert.ok(libraryBox && Math.abs(libraryBox.y - tools.y) <= 1 && libraryBox.height === tools.height);
    await view.getByRole('button', { name: t("資料狀態"), exact: true }).click();
    const dataStatus = view.getByRole('complementary', { name: t("資料狀態") });
    await dataStatus.getByRole('heading', { name: t("目前地點資料"), exact: true }).waitFor();
    assert.equal(await dataStatus.getByText('Settings', { exact: true }).count(), 0);
    await view.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
    assert.equal(await view.getByRole('complementary').count(), 0, 'direct data status returns to map');
    assert.equal(await view.getByRole('button', { name: '圖層', exact: true }).count(), 0);
    await view.getByRole('button', { name: t("實勘"), exact: true }).click();
    await view.getByRole('region', { name: t("步行感受") }).waitFor();
    const immersive = await view.getByRole('region', { name: t("步行感受") }).boundingBox();
    assert.ok(immersive && immersive.x === 0 && immersive.y === 0 && immersive.width === width && immersive.height === height);
    for (const label of [t("喜歡這裡"), t("不喜歡"), t("拍下畫面")]) {
      const action = await view.getByRole('button', { name: t(label), exact: true }).boundingBox();
      assert.ok(action && action.width >= 44 && action.height >= 44 && action.y + action.height <= height);
    }
    await view.getByRole('button', { name: t("結束步行") }).click();
    await view.getByRole('button', { name: t("CLS 結果報告"), exact: true }).click();
    const panel = view.getByRole('complementary', { name: t("街道評估面板") });
    assert.equal(await panel.getByText(t("Your observation"), { exact: true }).count(), 0, 'CLS does not contain field-rating workflow');
    assert.equal(await panel.getByRole('button', { name: t("Continue"), exact: true }).count(), 0);
    assert.equal(await panel.getByText(t('Safety') + ' · C1', { exact: true }).count(), 1);
    const bounds = await panel.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);

    await view.screenshot({ path: `artifacts/walk-ui/assessment-${width}.png` });
    await panel.focus();
    await view.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal(await view.getByRole('button', { name: t("CLS 結果報告"), exact: true }).evaluate(element => element === document.activeElement), true, 'dismiss restores focus');
    await view.getByRole('button', { name: t("環境觀察"), exact: true }).click();
    await view.getByText(t("Your observation"), { exact: true }).waitFor();
    assert.equal(await view.getByRole('complementary').getByText(t("環境觀察"), { exact: true }).count(), 1);
    assert.equal(await view.getByRole('region', { name: t("步行感受") }).count(), 0);
    assert.equal(await view.getByRole('button', { name: t("喜歡這裡"), exact: true }).count(), 0);
    assert.equal(await view.getByRole('button', { name: t("不喜歡"), exact: true }).count(), 0);
    assert.equal(await view.getByRole('button', { name: t("拍照留存"), exact: true }).count(), 0);
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
  await deniedPage.getByRole('button', { name: t("實勘"), exact: true }).click();
  await deniedPage.getByText(t("請允許位置存取，再重試定位。"), { exact: true }).waitFor();
  assert.equal(await deniedPage.getByRole('button', { name: t("喜歡這裡"), exact: true }).isDisabled(), true);
  assert.equal(await deniedPage.getByRole('button', { name: t("拍下畫面"), exact: true }).isDisabled(), true);
  await deniedPage.getByRole('button', { name: t("結束步行") }).click();
  await deniedPage.getByRole('button', { name: t("環境觀察"), exact: true }).click();
  await deniedPage.getByText(t("Your observation"), { exact: true }).waitFor();
  assert.equal((await saved(deniedPage)).length, 0);
  await denied.close();

  // The existing star action must also save a row before CLS is available.
  readyScore = false;
  const favoriteContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(favoriteContext);
  const favoritePage = await favoriteContext.newPage();
  await favoritePage.goto(baseURL);
  await favoritePage.getByRole('button', { name: t("CLS 結果報告"), exact: true }).click();
  await favoritePage.getByRole('button', { name: t("加入最愛"), exact: true }).click();
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
  await pendingPage.getByText(t("CLS 尚未就緒"), { exact: true }).waitFor();
  assert.equal(await pendingPage.getByRole('button', { name: t("重試 CLS") }).isEnabled(), true);
  readyScore = true;
  await pendingPage.getByRole('button', { name: t("重試 CLS") }).click();
  await pendingPage.getByRole('button', { name: t("CLS 結果報告"), exact: true }).click();
  const pendingReport = pendingPage.getByRole('complementary', { name: t("街道評估面板") });
  await pendingReport.getByText('80', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await pendingPage.getByRole('region', { name: t("CLS 載入狀態") }).count(), 0);
  await pendingPage.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
  await pendingPage.getByRole('button', { name: t("環境觀察"), exact: true }).click();
  await pendingPage.getByText(t("Your observation"), { exact: true }).waitFor();
  assert.equal(await pendingPage.getByRole('complementary').getByText(t("環境觀察"), { exact: true }).count(), 1, 'field view replaces CLS read view');
  assert.equal((await saved(pendingPage)).length, 0);
  await pendingPage.getByRole('button', { name: t("Continue"), exact: true }).click();
  await pendingPage.getByRole('button', { name: t("Take photo"), exact: true }).waitFor();
  let pendingCameraOpens = 0; pendingPage.on('filechooser', () => pendingCameraOpens++);
  await pendingPage.getByRole('button', { name: t("Take photo"), exact: true }).focus();
  for (const key of ['1', '2', 'c']) await pendingPage.keyboard.press(key);
  assert.equal(pendingCameraOpens, 0);
  assert.equal((await saved(pendingPage)).length, 0, 'review requires an explicit save');
  await pendingPage.getByPlaceholder(t("Assessment name")).fill(t("現場觀察"));
  await pendingPage.locator('footer').getByRole('button', { name: t("Save"), exact: true }).click();
  await pendingPage.getByText(t("Assessment saved."), { exact: true }).waitFor();
  assert.equal((await saved(pendingPage)).length, 1);
  assert.equal((await saved(pendingPage))[0].walkMoment, undefined);
  assert.equal((await saved(pendingPage))[0].name, t("現場觀察"));
  await pendingContext.close();

  // Removing quick capture must preserve historical feelings and photo evidence.
  const historyContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(historyContext);
  await historyContext.addInitScript(() => {
    if (localStorage.getItem('cls_saved_locations')) return;
    const timestamp = Date.now();
    const history = ['good', 'bad', 'photo'].map((feeling, i) => ({
      id: 'old-visit-' + i, name: 'Old visit ' + feeling, streetName: '永康街', district: '大安區', city: '臺北市',
      coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 73, grade: 'B', scores: {}, timestamp, syncStatus: 'synced',
      walkMoment: { feeling, accuracyMeters: 12, positionTimestamp: timestamp, confirmedAt: timestamp, source: 'walk' },
      fieldNotes: feeling === 'photo' || feeling === 'bad' ? 'Street was shaded.' : '',
      evidence: feeling === 'photo' || feeling === 'bad' ? [{ id: 'old-photo-' + feeling, type: 'photo', note: 'Tree shade along sidewalk', storageKey: 'kept-photo-' + feeling, capturedAt: timestamp, location: { lat: 25.0326, lng: 121.5298 } }] : [],
    }));
    localStorage.setItem('cls_saved_locations', JSON.stringify(history));
    localStorage.setItem('cls_favorite_locations', JSON.stringify(['25.03260:121.52980:永康街']));
  });
  const historyPage = await historyContext.newPage(); await historyPage.goto(baseURL + '/?mode=walk');
  await historyPage.getByRole('button', { name: t("環境觀察"), exact: true }).waitFor();
  const before = await saved(historyPage); assert.equal(before.length, 3);
  await historyPage.reload(); await historyPage.getByRole('button', { name: t("環境觀察"), exact: true }).waitFor();
  assert.deepEqual(await saved(historyPage), before, 'historical records and evidence survive reload unchanged');
  await historyPage.getByRole('button', { name: t("Street Library"), exact: true }).click();
  await historyPage.getByRole('complementary', { name: t("Street Library") }).getByRole('button', { name: t("Favorites"), exact: true }).click();
  assert.equal(await historyPage.getByTitle(t("Delete assessment")).count(), 1, 'one library card per location');
  await historyPage.getByText(t("查看此地全部紀錄（照片、筆記與感受保留）"), { exact: true }).click();
  await historyPage.getByRole('button', { name: /CLS 73 · 不喜歡/ }).click();
  const report = historyPage.getByRole('complementary', { name: t("街道結果報告") });
  await report.getByText(t("不喜歡"), { exact: true }).waitFor();
  await report.getByText('Tree shade along sidewalk').waitFor();
  await report.getByText('Street was shaded.', { exact: true }).waitFor();
  await historyPage.getByRole('navigation').getByRole('button', { name: t('資料狀態'), exact: true }).click();
  await historyPage.getByRole('button', { name: t('返回評估'), exact: true }).click();
  await report.waitFor();
  await historyPage.getByRole('button', { name: t("返回 Street Library") }).click();
  await historyPage.getByRole('complementary', { name: t("Street Library") }).waitFor();
  await historyPage.locator('.leaflet-container').click({ position: { x: 4, y: 4 } });
  assert.equal(await historyPage.getByRole('complementary').count(), 0, 'library report data-status chain unwinds to map');
  await historyContext.close();

  // Legacy totals are no longer authoritative: use current external baseline.
  const legacyContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(legacyContext);
  await legacyContext.addInitScript(() => localStorage.setItem('cls_saved_locations', JSON.stringify([{
    id: 'legacy-score', name: '舊紀錄', streetName: '舊街道', district: '大安區', city: '臺北市',
    coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 73, grade: 'B', scores: {}, timestamp: Date.now(), syncStatus: 'synced',
  }])));
  const legacyPage = await legacyContext.newPage(); await legacyPage.goto(baseURL);
  await legacyPage.getByRole('button', { name: t("Street Library"), exact: true }).click();
  await legacyPage.getByText('舊紀錄', { exact: true }).click();
  await legacyPage.getByRole('complementary', { name: t("街道結果報告") }).getByText('80', { exact: true }).first().waitFor();
  await legacyContext.close();

  // One shared external baseline updates all visits; opening does not re-run
  // questionnaires and must retain different recorded observation points.
  const deltaContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(deltaContext);
  let adjustmentRequests = 0;
  await deltaContext.route('**/api/assessment**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/assessment') {
      if (url.pathname === '/api/assessment/field-adjustment') adjustmentRequests++;
      return route.fallback();
    }
    const location = { lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lng')),
      streetName: url.searchParams.get('streetName') || '', district: '大安區', city: '臺北市' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ location,
      scores: { ...calculateAssessment({}, {}), overall: 80 }, factors: [], poiCount: 0, dataSources: ['test-only'], generatedAt: '2026-10-06T00:00:00Z',
      baseline: { streetIdentity: streetIdentity(location.city, location.district, location.streetName), segmentId: 'test-segment',
        anchor: { lat: 25.0326, lng: 121.5298 }, version: 'test-v1', scoringVersion: 'test-only' } }) });
  });
  await deltaContext.addInitScript(() => {
    if (localStorage.getItem('cls_saved_locations')) return;
    localStorage.setItem('cls_saved_locations', JSON.stringify([3, 5].map((points, i) => ({
      id: 'delta-' + i, name: 'Delta visit ' + points, streetName: '舊街道', district: '大安區', city: '臺北市',
      coords: { lat: 25.0326 + i * 0.0001, lng: 121.5298 }, clsScore: 70 + points, baselineClsScore: 70,
      fieldAdjustment: points, grade: 'B', scores: {}, timestamp: Date.now() - i, syncStatus: 'synced',
      observationRatings: { c3_sidewalk_quality: 4 }, fieldNotes: '保留原始筆記', evidence: [],
    }))));
  });
  const deltaPage = await deltaContext.newPage(); await deltaPage.goto(baseURL);
  await deltaPage.getByRole('button', { name: t('Street Library'), exact: true }).click();
  await deltaPage.getByText('Delta visit 3', { exact: true }).waitFor();
  const beforeOpenAdjustments = adjustmentRequests;
  await deltaPage.getByText('Delta visit 3', { exact: true }).click();
  await deltaPage.getByRole('complementary', { name: t('街道結果報告') }).getByText('83', { exact: true }).first().waitFor();
  const currentVisits = await saved(deltaPage);
  assert.deepEqual(currentVisits.map((item: any) => item.baselineClsScore), [80, 80]);
  assert.deepEqual(currentVisits.map((item: any) => item.clsScore), [83, 85]);
  assert.deepEqual(currentVisits.map((item: any) => item.fieldAdjustment), [3, 5]);
  assert.ok(currentVisits.every((item: any) => item.fieldNotes === '保留原始筆記' && item.observationRatings.c3_sidewalk_quality === 4));
  assert.equal(adjustmentRequests, beforeOpenAdjustments, 'opening a saved visit keeps recorded points, no questionnaire request');
  await deltaContext.close();

  const deletionContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prepare(deletionContext);
  const remoteVisit = { id: 'offline-delete', name: 'Remote visit', streetName: '永康街', district: '大安區', city: '臺北市', coords: { lat: 25.0326, lng: 121.5298 }, clsScore: 80, grade: 'A', scores: {}, timestamp: Date.now(), syncStatus: 'synced' };
  await deletionContext.route(url => url.pathname.startsWith('/api/assessments'), route => route.fulfill({ status: route.request().method() === 'DELETE' ? 503 : 200,
    contentType: 'application/json', body: JSON.stringify(route.request().method() === 'DELETE' ? { error: 'Offline' } : [remoteVisit]) }));
  const deletionPage = await deletionContext.newPage(); await deletionPage.goto(baseURL);
  await deletionPage.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]').length === 1);
  await deletionPage.getByRole('button', { name: t("Street Library"), exact: true }).click();
  await deletionPage.getByTitle(t("Delete assessment")).click();
  assert.equal((await saved(deletionPage)).length, 0);
  await deletionPage.reload();
  await deletionPage.getByRole('button', { name: t("Street Library"), exact: true }).waitFor();
  assert.equal((await saved(deletionPage)).length, 0, 'offline deletion must survive stale remote history and reload');
  assert.deepEqual(await deletionPage.evaluate(() => JSON.parse(localStorage.getItem('cls_pending_deletions') || '[]')), ['offline-delete']);
  await deletionContext.close();
  await testLanguageUI(browser, prepare, baseURL);
  await testNavigationUI(browser, prepare, baseURL);
  await testProfileUI(browser, prepare, baseURL);
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  console.log('Field UI checks passed: restored explicit field recording, inert background shortcuts, structured observations and explicit save, preserved historical visits/evidence, mobile/desktop layout, favorites, delayed CLS, legacy scores and offline deletion.');
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
