import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';
import { t } from '../src/i18n';

export async function testSavedMapUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  await prepare(context);
  // Isolated browser fixtures only. They are not runtime/default app data.
  await context.addInitScript(() => {
    const base = {coords:{lat:25.0326,lng:121.5298},streetName:'Map saved street',district:'',city:'',
      grade:'B',scores:{c1:73,c2:73,c3:73,c4:73,c5:73},syncStatus:'synced',evidence:[],fieldNotes:'Keep this note'};
    localStorage.setItem('cls_saved_locations',JSON.stringify([
      {...base,id:'map-old',name:'Old saved visit',timestamp:100,clsScore:72},
      {...base,id:'map-latest',name:'Latest <img src=x onerror="window.mapXss=true">',timestamp:200,clsScore:73.456},
      {...base,id:'map-far',name:'Offscreen visit',coords:{lat:24,lng:120},timestamp:300,clsScore:80},
    ]));
  });
  const reads: string[] = [];
  context.on('request',request => { const url=new URL(request.url()); if(url.pathname.startsWith('/api/')) reads.push(url.pathname); });
  const page = await context.newPage();
  await page.goto(baseURL);
  const marker = page.locator('.saved-score-marker[data-saved-assessment-id="map-latest"]');
  await marker.waitFor();
  assert.equal(await page.locator('.saved-score-marker').count(),1,'one visible badge per saved location');
  assert.equal(await marker.locator('strong').innerText(),'73.46','labels use at most two decimals without rewriting saved values');
  assert.equal(await page.locator('.saved-score-marker img').count(),0,'saved names cannot inject HTML/images');
  const original = await page.evaluate(() => localStorage.getItem('cls_saved_locations'));
  const count = (path:string) => reads.filter(value=>value===path).length;
  const before = {history:count('/api/assessments'),assessment:count('/api/assessment'),address:count('/api/reverse-geocode')};
  // Keyboard panning uses Leaflet's own view handling, not selecting a location.
  const map = page.locator('.leaflet-container');
  const beforePosition = await marker.getAttribute('style');
  await marker.evaluate(element => { (window as any).savedBadgeElement = element; });
  await map.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(position => document.querySelector('.saved-score-marker[data-saved-assessment-id="map-latest"]')?.getAttribute('style') !== position,beforePosition);
  assert.equal(await marker.evaluate(element => element === (window as any).savedBadgeElement),true,
    'panning keeps visible badge DOM stable so keyboard focus is not destroyed');
  assert.deepEqual({history:count('/api/assessments'),assessment:count('/api/assessment'),address:count('/api/reverse-geocode')},before,
    'rendering and moving the saved-score overlay add no data reads');
  await marker.focus(); await page.keyboard.press('Enter');
  const report = page.getByRole('complementary',{name:t('街道結果報告')});
  await report.waitFor();
  await report.getByText('Keep this note',{exact:true}).waitFor();
  assert.equal(count('/api/assessment'),before.assessment + 1,'explicit report opening reads the shared baseline once, as library selection does');
  assert.equal(count('/api/reverse-geocode'),before.address,'saved badge selection must not reverse-geocode');
  assert.equal(await page.evaluate(() => localStorage.getItem('cls_saved_locations')),original,'opening the report preserves exact history');
  assert.equal(await page.evaluate(() => Boolean((window as any).mapXss)),false);
  await map.click({position:{x:4,y:4}});
  await report.waitFor({state:'hidden'});
  await marker.focus(); await page.keyboard.press('Space');
  await report.waitFor();
  await map.click({position:{x:4,y:4}});
  await report.waitFor({state:'hidden'});
  await page.screenshot({path:'artifacts/walk-ui/saved-map.png'});
  await context.close();
}
