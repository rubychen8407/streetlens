import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';
import { t } from '../src/i18n';

export async function testSavedMapUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  await prepare(context);
  // Isolated browser fixtures only. They are not runtime/default app data.
  await context.addInitScript(() => {
    const base = {coords:{lat:25.0326,lng:121.5298},streetName:'Map saved street',district:'',city:'',
      grade:'D',scores:{c1:73,c2:73,c3:73,c4:73,c5:73},syncStatus:'synced',evidence:[],fieldNotes:'Keep this note'};
    localStorage.setItem('cls_saved_locations',JSON.stringify([
      {...base,id:'map-old',name:'Old saved visit',timestamp:100,clsScore:72},
      {...base,id:'map-jitter',coords:{lat:25.0327,lng:121.5299},name:'GPS drift visit',timestamp:150,clsScore:74},
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
  assert.equal(await marker.locator('strong').innerText(),'73','compact labels round only the display');
  assert.match(await marker.getAttribute('aria-label') || '', /73\.46 B/, 'accessible label retains score and grade');
  assert.equal(await marker.getAttribute('title'),null,'no native tooltip');
  assert.equal(await marker.locator('.saved-score-badge').getAttribute('data-grade'),'B');
  assert.equal((await marker.boundingBox())?.width,44,'tap target remains usable');
  assert.equal((await marker.locator('.saved-score-badge').boundingBox())?.width,32,'visual marker is compact');
  await marker.hover();
  assert.equal(await page.locator('.leaflet-tooltip').count(),0,'no map hover tooltip');
  await page.getByRole('button',{name:t('Street Library'),exact:true}).click();
  assert.equal(await page.getByTestId('saved-library-card').count(),2,'one library card for nearby visits, plus offscreen street');
  await page.getByText(`${t('歷次紀錄')} · 3`,{exact:true}).click();
  assert.equal(await page.locator('details[open]').getByRole('button').count(),3,'group retains individual history');
  await page.locator('details[open]').getByRole('button',{name:/CLS 74/}).waitFor();
  await page.locator('.leaflet-container').click({position:{x:4,y:4}});
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

  const colorsContext = await browser.newContext({viewport:{width:390,height:844}});
  await prepare(colorsContext);
  await colorsContext.addInitScript(() => {
    localStorage.setItem('cls_saved_locations',JSON.stringify([95,85,75,65,55].map((score,i) => ({
      id:`grade-${i}`,coords:{lat:25.0326 + (i-2)*0.0006,lng:121.5298 + (i%2)*0.0008},
      streetName:`Color street ${i}`,name:`Color street ${i}`,district:'',city:'',timestamp:i+1,
      clsScore:score,grade:'D',scores:{c1:score,c2:score,c3:score,c4:score,c5:score},evidence:[],syncStatus:'synced',
    }))));
  });
  const colorsPage = await colorsContext.newPage(); await colorsPage.goto(baseURL);
  await colorsPage.locator('.saved-score-badge[data-grade="S"]').waitFor();
  const backgrounds = [];
  for (const grade of ['S','A','B','C','D']) {
    const badge = colorsPage.locator(`.saved-score-badge[data-grade="${grade}"]`);
    await badge.waitFor();
    backgrounds.push(await badge.evaluate(element => getComputedStyle(element).backgroundColor));
  }
  assert.equal(new Set(backgrounds).size,5,'each score grade has a distinct color, derived from score');
  assert.equal(await colorsPage.locator('.saved-score-marker[data-saved-assessment-id="grade-2"]').evaluate(element => {
    const badge = element.querySelector('.saved-score-badge')!.getBoundingClientRect();
    return document.elementFromPoint(badge.x + badge.width/2, badge.y + badge.height/2)?.closest('.saved-score-marker') === element;
  }),true,'GPS and selected-point markers cannot obscure a saved score at the same location');
  await colorsPage.screenshot({path:'artifacts/walk-ui/saved-map-grades.png'});
  await colorsContext.close();
}
