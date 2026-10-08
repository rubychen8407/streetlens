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
    localStorage.setItem('cls_street_geometry_v1',JSON.stringify({updatedAt:Date.now(),roads:[{
      id:'real-road-fixture',name:'Map saved street',coords:[[25.0315,121.5285],[25.0322,121.5295],[25.0326,121.5298],[25.0333,121.5300]],
    }]}));
  });
  const reads: string[] = [];
  context.on('request',request => { const url=new URL(request.url()); if(url.pathname.startsWith('/api/')) reads.push(url.pathname); });
  const page = await context.newPage();
  await page.goto(baseURL);
  const marker = page.locator('.saved-street-hit[data-saved-assessment-id="map-latest"]');
  await marker.waitFor();
  assert.equal(await page.locator('.saved-score-marker').count(),0,'floating score labels are removed');
  assert.equal(await page.locator('.saved-street-hit').count(),1,'nearby visits share one road');
  assert.match(await marker.getAttribute('aria-label') || '', /73\.46 B/, 'road keyboard label retains exact score and grade');
  assert.equal(await marker.getAttribute('title'),null);
  const ribbon = page.locator('.saved-street-line[data-saved-assessment-id="map-latest"]');
  await ribbon.waitFor();
  const initialWidth = Number(await ribbon.getAttribute('stroke-width'));
  assert.ok(Number(await ribbon.getAttribute('stroke-opacity')) < 0.5,'street text remains visible through the highlight');
  assert.equal(await page.locator('.leaflet-tooltip').count(),0);
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
  const beforePosition = (await marker.boundingBox())!.x;
  await marker.evaluate(element => { (window as any).savedBadgeElement = element; });
  await map.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(position => document.querySelector('.saved-street-hit[data-saved-assessment-id="map-latest"]')?.getBoundingClientRect().x !== position,beforePosition);
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
  const hit = page.locator('.saved-street-hit[data-saved-assessment-id="map-latest"]').first();
  const point = await hit.evaluate(element => {
    const path = element as SVGPathElement;
    const position = path.getPointAtLength(path.getTotalLength()*0.25);
    const point = new DOMPoint(position.x,position.y).matrixTransform(path.getScreenCTM()!);
    return {x:point.x,y:point.y};
  });
  const beforeLine = count('/api/assessment');
  await page.mouse.click(point.x,point.y);
  await report.getByText('Keep this note',{exact:true}).waitFor();
  assert.equal(count('/api/assessment'),beforeLine+1,'road tap opens saved report exactly once without bubbling');
  assert.equal(await page.evaluate(() => localStorage.getItem('cls_saved_locations')),original);
  await map.click({position:{x:4,y:4}});
  await report.waitFor({state:'hidden'});
  await marker.focus(); await page.keyboard.press('Space');
  await report.waitFor();
  await map.click({position:{x:4,y:4}});
  await report.waitFor({state:'hidden'});
  await map.focus(); await page.keyboard.press('+');
  await page.waitForFunction(width => Number(document.querySelector('.saved-street-line')?.getAttribute('stroke-width')) > width, initialWidth);
  await page.keyboard.press('-');
  await page.waitForFunction(width => Number(document.querySelector('.saved-street-line')?.getAttribute('stroke-width')) === width, initialWidth);
  const toggle = page.getByRole('button',{name:/道路色帶|Road colors/});
  await toggle.click();
  assert.equal(await page.locator('.saved-street-line').count(),0,'toggle removes the layer');
  assert.equal(await page.locator('.saved-street-hit').count(),0,'hidden roads cannot intercept taps');
  assert.equal(await page.evaluate(() => localStorage.getItem('cls_road_colors')),'off');
  await page.reload();
  await page.getByRole('button',{name:/道路色帶|Road colors/}).waitFor();
  assert.equal(await page.locator('.saved-street-line').count(),0,'off preference survives reload');
  await page.getByRole('button',{name:/道路色帶|Road colors/}).click();
  await page.locator('.saved-street-line').waitFor();
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
    localStorage.setItem('cls_street_geometry_v1',JSON.stringify({updatedAt:Date.now(),roads:[95,85,75,65,55].map((_,i)=>({
      id:`real-grade-road-${i}`,name:`Color street ${i}`,coords:[
        [25.0326+(i-2)*0.0006,121.5289],[25.0326+(i-2)*0.0006,121.5298+(i%2)*0.0008],
        [25.0328+(i-2)*0.0006,121.5311],
      ],
    }))}));
  });
  const colorsPage = await colorsContext.newPage(); await colorsPage.goto(baseURL);
  await colorsPage.locator('.saved-street-line[data-grade="S"]').waitFor();
  const backgrounds = [];
  for (const grade of ['S','A','B','C','D']) {
    backgrounds.push(await colorsPage.locator(`.saved-street-line[data-grade="${grade}"]`).getAttribute('stroke'));
  }
  assert.equal(new Set(backgrounds).size,5,'five distinct grade colors');
  assert.equal(await colorsPage.locator('.saved-street-line').count(),5);
  assert.equal(await colorsPage.locator('.saved-score-marker').count(),0,'no detached score labels');
  await colorsPage.screenshot({path:'artifacts/walk-ui/saved-map-grades.png'});
  await colorsContext.close();

  // Reproduce the production failure: old scored visits, an empty geometry
  // cache, and an unavailable current CLS must still load persisted roads.
  const legacyContext=await browser.newContext({viewport:{width:390,height:844}});
  await prepare(legacyContext);
  await legacyContext.addInitScript(()=> {
    localStorage.removeItem('cls_street_geometry_v1');
    localStorage.setItem('cls_saved_locations',JSON.stringify([{id:'legacy-road',coords:{lat:25.0326,lng:121.5298},
      streetName:'永康街',name:'Legacy saved road',city:'臺北市',district:'大安區',timestamp:100,clsScore:76,
      grade:'B',scores:{c1:76,c2:76,c3:76,c4:76,c5:76},evidence:[],fieldNotes:'Preserved legacy note',syncStatus:'synced'}]));
  });
  await legacyContext.route('**/api/assessment?**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"dataStatus":"database_required"}'}));
  let batches=0;
  // A missing/temporarily unavailable geometry response must not hide history.
  await legacyContext.route('**/api/saved-street-geometry',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  const missingPage=await legacyContext.newPage();await missingPage.goto(baseURL);
  const fallback=missingPage.locator('.saved-street-fallback');await fallback.waitFor();
  assert.equal(await missingPage.locator('.saved-street-line').count(),0,'missing geometry never invents a road');
  assert.equal((await fallback.boundingBox())?.width,44,'tiny fallback retains a usable target');
  assert.equal(await fallback.innerText(),'','fallback contains no detached score');
  const missingHistory=await missingPage.evaluate(()=>localStorage.getItem('cls_saved_locations'));
  await fallback.focus();await missingPage.keyboard.press('Enter');
  await missingPage.getByText('Preserved legacy note',{exact:true}).waitFor();
  assert.equal(await missingPage.evaluate(()=>localStorage.getItem('cls_saved_locations')),missingHistory);
  await missingPage.close();
  await legacyContext.unroute('**/api/saved-street-geometry');
  await legacyContext.route('**/api/saved-street-geometry',async route=> {
    batches++;assert.equal(route.request().method(),'POST');
    const locations=route.request().postDataJSON().locations;
    assert.equal(locations.length,1,'legacy roads load in a bounded batch');
    assert.equal(locations[0].streetName,'永康街');
    await new Promise(resolve=>setTimeout(resolve,250));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({dataStatus:'cached',roads:[{
      id:'mapped-legacy-lane',name:'',coords:[[25.0317,121.5294],[25.0326,121.5298],[25.0332,121.5301]],
      matchedIdentity:'臺北市:永康街',matchedAnchor:[25.0326,121.5298],
    }]})});
  });
  const legacyPage=await legacyContext.newPage();await legacyPage.goto(baseURL);
  const legacyLine=legacyPage.locator('.saved-street-line[data-saved-assessment-id="legacy-road"]');await legacyLine.waitFor();
  assert.equal(await legacyPage.locator('.saved-street-fallback').count(),0,'road replaces fallback once geometry arrives');
  assert.equal(batches,1,'road retrieval is independent of failed CLS loading');
  const savedHistory=await legacyPage.evaluate(()=>localStorage.getItem('cls_saved_locations'));
  await legacyPage.locator('.leaflet-container').focus();await legacyPage.keyboard.press('ArrowRight');
  await legacyPage.waitForTimeout(350);
  assert.equal(batches,1,'panning cannot trigger another batch or routing request');
  assert.equal(await legacyPage.evaluate(()=>localStorage.getItem('cls_saved_locations')),savedHistory);
  assert.ok(await legacyPage.evaluate(()=>JSON.parse(localStorage.getItem('cls_street_geometry_v1')!).roads[0].matchedIdentity),
    'coordinate associations survive local geometry caching');
  await legacyPage.screenshot({path:'artifacts/walk-ui/legacy-street-line.png'});
  await legacyContext.close();
}
