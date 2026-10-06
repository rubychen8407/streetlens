import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';
import { t } from '../src/i18n';
import { calculateAssessment } from '../scoring';

export async function testHistoryUI(browser: Browser, prepare: (context: BrowserContext) => Promise<void>, baseURL: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(context);
  const fixture = (id: string, name: string, lat: number) => ({ id, name, streetName:name, district:'',city:'',
    coords:{lat,lng:121},timestamp:1000,clsScore:80,baselineClsScore:80,grade:'A',syncStatus:'synced',
    scores:{c1:80,c2:80,c3:80,c4:80,c5:80},fieldNotes:'historical note',evidence:[],
    assessmentSnapshot:{ location:{lat,lng:121,streetName:name,district:'',city:''},
      scores:{...calculateAssessment({}, {}, undefined, undefined, undefined, undefined, undefined, Array.from({length:19},(_,i)=>i+1)),overall:80},
      factors:[],poiCount:0,dataSources:['History test fixture only'],generatedAt:'2026-10-01T00:00:00Z' } });
  const local = { ...fixture('history-local','History Local',25), evidence:[{id:'photo-local',type:'photo',capturedAt:1000,
    location:{lat:25,lng:121},storageKey:'keep-local-photo'}] };
  const remote = fixture('history-remote','History Remote',25.1);
  const older = fixture('history-older','History Older',25.2);
  const summary = (record: any) => ({...record,assessmentSnapshot:undefined,historySummary:true,
    evidence:record.evidence.map((item:any)=>({...item,storageKey:undefined}))});
  await context.addInitScript(value => { localStorage.setItem('cls_saved_locations', JSON.stringify([value])); },local);
  let pageReads = 0, detailReads = 0, releaseDetail!: () => void;
  const detailWait = new Promise<void>(resolve => { releaseDetail = resolve; });
  let detailFailure = true;
  await context.route(url => url.pathname.startsWith('/api/assessments'), async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/evidence/')) return route.fulfill({status:404,body:''});
    assert.equal(route.request().method(),'GET','completed summary records must never be re-uploaded');
    let status=200, body: unknown;
    if (url.pathname === '/api/assessments') {
      pageReads++;
      assert.equal(url.searchParams.get('view'),'summary');
      assert.equal(url.searchParams.get('limit'),'20');
      body = url.searchParams.has('cursor') ? {records:[summary(older)],nextCursor:null}
        : {records:[summary(local),summary(remote)],nextCursor:'test-next-page'};
    } else {
      detailReads++;
      if (url.pathname.endsWith('history-remote')) { await detailWait; body=remote; }
      else if (url.pathname.endsWith('history-older')) {
        status=detailFailure ? 503 : 200; body=detailFailure ? {error:'offline test'} : older; detailFailure=false;
      } else return route.fulfill({status:404,body:''}); // optional legacy photo preview
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]').length===2);
  assert.equal(pageReads,1,'startup reads only the first page');
  assert.equal(detailReads,0,'startup does not download complete reports');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]'));
  assert.equal(stored.find((record:any)=>record.id===local.id).assessmentSnapshot.scores.overall,80);
  assert.equal(stored.find((record:any)=>record.id===local.id).evidence[0].storageKey,'keep-local-photo');
  await page.getByRole('button',{name:t('Street Library'),exact:true}).click();
  await page.getByRole('button',{name:'載入更多歷史紀錄',exact:true}).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]').length===3);
  assert.equal(pageReads,2);
  assert.equal(await page.getByRole('button',{name:'載入更多歷史紀錄',exact:true}).count(),0);
  await page.getByRole('button',{name:/History Remote.*CLS/}).click();
  await page.getByRole('button',{name:'重試載入完整報告',exact:true}).waitFor();
  await page.getByRole('button',{name:t('返回 Street Library'),exact:true}).click();
  await page.getByRole('button',{name:/History Local.*CLS/}).click();
  releaseDetail();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]')
    .find((record:any)=>record.id==='history-remote')?.historySummary===false);
  const report = page.getByRole('complementary',{name:t('街道結果報告')});
  await report.getByText('History Local',{exact:true}).first().waitFor();
  assert.equal(detailReads,1,'cached full local reports do not issue a detail query');
  assert.equal(await report.getByText('History Remote',{exact:true}).count(),0,'a late detail cannot replace the newly selected report');
  await page.getByRole('button',{name:t('返回 Street Library'),exact:true}).click();
  const failedResponse = page.waitForResponse(response => response.url().includes('/api/assessments/history-older') && response.status()===503);
  await page.getByRole('button',{name:/History Older.*CLS/}).click();
  await failedResponse;
  await page.getByRole('button',{name:'重試載入完整報告',exact:true}).click();
  await page.getByRole('button',{name:'重試載入完整報告',exact:true}).waitFor({state:'hidden'});
  assert.equal(detailReads,3,'failed details can be retried without refetching the history list');
  assert.equal(pageReads,2);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('cls_saved_locations') || '[]'))).length,3,
    'pagination/detail loads never delete locally saved visits');
  await context.close();
}
