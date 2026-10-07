import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { importHousing, readHousing } from './housingStore';
import { parseHousingFilters } from './src/utils/housing';
export function registerHousingImport(app: Express, db: Pool | null, ready: () => Promise<void>) {
  app.post('/api/internal/import-housing', (req, res, next) => {
    if (!process.env.STREETLENS_REFRESH_TOKEN || req.headers.authorization !== 'Bearer ' + process.env.STREETLENS_REFRESH_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    next();
  }, express.json({ limit: '12mb' }), async (req, res) => {
    if (!db) { res.status(503).json({ error: 'Housing database unavailable' }); return; }
    try { await ready(); res.json(await importHousing(db, req.body)); }
    catch (error) { console.error('Housing import failed'); res.status(400).json({ error: '住宅匯入失敗；既有資料保留。' }); }
  });
}
export function registerHousingReads(app: Express, db: Pool | null, ready: Promise<void>) {
  app.get('/api/housing', async (req, res) => {
    let filters;
    try { filters = parseHousingFilters(req.query); }
    catch { res.status(400).json({ error: '請選擇縣市、行政區、街道與有效篩選條件。' }); return; }
    if (!db) { res.status(503).json({ error: '住宅資料庫暫時無法使用。' }); return; }
    try { await ready; res.json(await readHousing(db, filters)); }
    catch { res.status(503).json({ error: '住宅資料暫時無法讀取，請稍後重試。' }); }
  });
}
