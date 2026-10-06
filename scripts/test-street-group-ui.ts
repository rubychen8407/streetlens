import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright';
import { t } from '../src/i18n';

export async function testStreetGroupUI(browser:Browser,prepare:(context:BrowserContext)=>Promise<void>,baseURL:string) {
  const context=await browser.newContext({viewport:{width:390,height:844}}); await prepare(context);
  await context.addInitScript(()=>{
    const records=['永康街','大安區永康街','台北市 大安區 永康街'].map((streetName,i)=>({
      id:'alias-'+i,name:streetName,streetName,city:'臺北市',district:'大安區',coords:{lat:25.0326+i*0.0001,lng:121.5298},
      timestamp:100+i,clsScore:70+i,grade:'B',scores:{},syncStatus:'synced',fieldNotes:'Original note '+i,
      evidence:[{id:'photo-'+i,type:'photo',capturedAt:100+i,location:{lat:25.0326+i*0.0001,lng:121.5298},storageKey:'preserved-'+i}],
    }));
    localStorage.setItem('cls_saved_locations',JSON.stringify(records));
    localStorage.setItem('cls_favorite_locations',JSON.stringify(['25.03260:121.52980:永康街','25.03260:121.52980:大安區永康街']));
  });
  let writes=0;
  context.on('request',request=>{if(new URL(request.url()).pathname==='/api/assessments' && request.method()==='POST') writes++;});
  const page=await context.newPage(); await page.goto(baseURL);
  await page.getByRole('button',{name:t('Street Library'),exact:true}).click();
  const original=await page.evaluate(()=>localStorage.getItem('cls_saved_locations'));
  assert.equal(JSON.parse(original!).length,3,'administrative aliases must not create extra migrated visits');
  const library=page.getByRole('complementary',{name:t('Street Library')});
  await library.getByRole('button',{name:t('Favorites'),exact:true}).click();
  assert.equal(await library.getByTitle(t('Delete assessment')).count(),1,'aliases display as one favourite card');
  await library.getByText(t('查看此地全部紀錄（照片、筆記與感受保留）'),{exact:true}).click();
  const visit=library.getByRole('button',{name:/CLS 71/}); await visit.click();
  const report=page.getByRole('complementary',{name:t('街道結果報告')}); await report.waitFor();
  await report.getByText('Original note 1',{exact:true}).waitFor();
  await report.locator('header').getByRole('button',{name:t('取消最愛'),exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('cls_favorite_locations')||'[]')),[],
    'unfavouriting through an alias removes both legacy favourite keys');
  assert.equal(await page.evaluate(()=>localStorage.getItem('cls_saved_locations')),original,'unfavouriting preserves all exact history and photos');
  await page.reload();
  await page.getByRole('button',{name:t('Street Library'),exact:true}).click();
  assert.equal(await page.getByTitle(t('Delete assessment')).count(),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('cls_saved_locations')),original,'reload preserves historical records');
  assert.equal(writes,0,'alias grouping and favourite migration add no persistence writes');
  await context.close();
}
