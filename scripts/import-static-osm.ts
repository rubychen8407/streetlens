import { readFile } from 'node:fs/promises';
import { validateStaticImport } from '../staticOsm';
const base = process.env.STREETLENS_BASE_URL || process.env.STREETLENS_REFRESH_URL;
const token = process.env.STREETLENS_REFRESH_TOKEN;
if (!base || !token) throw new Error('Refresh URL and token are required');
const body = await readFile(process.argv[2], 'utf8');
if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Extract exceeds upload budget');
validateStaticImport(JSON.parse(body));
const origin = base.replace(/\/api\/internal\/refresh-data\/?$/, '').replace(/\/$/, '');
// A main push can start extraction before Render finishes deploying. Never
// silently send roads to an older server which only understands POI imports.
if (JSON.parse(body).roads) {
  let ready=false;
  for(let attempt=0;attempt<30;attempt++) {
    try {const response=await fetch(origin+'/api/street-geometry/status',{signal:AbortSignal.timeout(15000)});
      if(response.ok && (await response.json()).geometryPipeline===1) {ready=true;break;}
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
  if(!ready) throw Error('Road geometry deployment is not ready; previous inventory preserved');
}
const url = origin + '/api/internal/import-static-osm';
const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error('Static import HTTP ' + response.status);
console.log(await response.json());
