import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedLocation } from '../types';
import { deletePersistedAssessment, listAssessmentSummaryPage, getPersistedAssessment, persistAssessment } from '../utils/assessmentApi';
import { FAVORITES_KEY, SAVED_LOCATIONS_KEY, mergeSavedRecords, migrateFavoriteKeys } from '../utils/savedLocations';
import { resolveSavedScore } from '../utils/savedScoreApi';
import { ReadRetry } from '../utils/readRetry';

type Change = SavedLocation[] | ((current: SavedLocation[]) => SavedLocation[]);
const DELETIONS_KEY = 'cls_pending_deletions';
function readDeletions(): string[] {
  try { const value = JSON.parse(localStorage.getItem(DELETIONS_KEY) || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; }
  catch { return []; }
}

function readSaved(): SavedLocation[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_LOCATIONS_KEY) || '[]');
    const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    const deleted = new Set(readDeletions());
    return migrateFavoriteKeys(Array.isArray(saved) ? saved.filter(item => !deleted.has(item.id)) : [], Array.isArray(favorites) ? favorites : []);
  } catch { return []; }
}

export function useSavedStreets(workspaceId: string) {
  const [saved, setSaved] = useState(readSaved);
  const records = useRef(saved);
  const pendingDeletions = useRef(new Set(readDeletions()));
  const deletedDuringSession = useRef(new Set(pendingDeletions.current));
  const deletionRetryAt = useRef(new Map<string, number>());
  const run = useRef<() => void>(() => {});
  const retryAt = useRef(new ReadRetry());
  const [error, setError] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historyGeneration = useRef(0);
  const historyRequest = useRef<AbortController | null>(null);
  const detailRequests = useRef(new Map<string, Promise<SavedLocation | null>>());

  // Synchronous ref + durable write prevents concurrent saves/backfills losing entries.
  const commit = useCallback((change: Change) => {
    const next = typeof change === 'function' ? change(records.current) : change;
    const ids = new Set(next.map(item => item.id));
    const removed = records.current.filter(item => !ids.has(item.id)).map(item => item.id);
    const previousDeletions = [...pendingDeletions.current];
    if (removed.length) localStorage.setItem(DELETIONS_KEY, JSON.stringify([...new Set([...previousDeletions, ...removed])]));
    try { localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(next)); }
    catch (cause) { if (removed.length) localStorage.setItem(DELETIONS_KEY, JSON.stringify(previousDeletions)); throw cause; }
    for (const id of removed) { deletedDuringSession.current.add(id); pendingDeletions.current.add(id); }
    records.current = next;
    setSaved(next);
    setError(null);
    return next;
  }, []);

  const retry = useCallback(() => { run.current(); }, []);

  const loadSavedDetails = useCallback((id: string): Promise<SavedLocation | null> => {
    const existing = records.current.find(record => record.id === id);
    if (!existing || !existing.historySummary) return Promise.resolve(existing || null);
    const key = workspaceId + ':' + id;
    const inflight = detailRequests.current.get(key);
    if (inflight) return inflight;
    const generation = historyGeneration.current;
    const request = getPersistedAssessment(workspaceId, id).then(remote => {
      if (generation !== historyGeneration.current || deletedDuringSession.current.has(id)) return null;
      const current = records.current.find(record => record.id === id);
      if (!current) return null;
      const merged = current.syncStatus === 'local' && !current.historySummary ? current
        : { ...mergeSavedRecords(current, remote), historySummary: false };
      commit(items => items.map(item => item.id === id ? merged : item));
      return merged;
    }).finally(() => { detailRequests.current.delete(key); });
    detailRequests.current.set(key, request);
    return request;
  }, [workspaceId, commit]);

  const loadMoreSaved = useCallback(async () => {
    if (historyRequest.current) return;
    const generation = historyGeneration.current;
    const controller = new AbortController(); historyRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setHistoryLoading(true); setHistoryError(false);
    try {
      const page = await listAssessmentSummaryPage(workspaceId, cursorRef.current, controller.signal);
      if (controller.signal.aborted || generation !== historyGeneration.current) return;
      commit(current => {
        const byId = new Map(current.map(item => [item.id, item]));
        for (const item of page.records) {
          if (byId.get(item.id)?.syncStatus === 'local' || deletedDuringSession.current.has(item.id)) continue;
          byId.set(item.id, byId.has(item.id) ? mergeSavedRecords(byId.get(item.id)!, item) : { ...item, syncStatus: 'synced' });
        }
        return [...byId.values()].sort((a,b) => b.timestamp - a.timestamp);
      });
      cursorRef.current = page.nextCursor; setHistoryCursor(page.nextCursor);
      run.current();
    } catch {
      if (generation === historyGeneration.current) setHistoryError(true);
    } finally {
      window.clearTimeout(timeout);
      if (generation === historyGeneration.current) { historyRequest.current = null; setHistoryLoading(false); }
    }
  }, [workspaceId, commit]);

  useEffect(() => {
    historyGeneration.current++;
    cursorRef.current = null; setHistoryCursor(null); historyRequest.current = null;
    // Persist migrated favorites once so reloads keep their identity.
    try { commit(current => current); } catch { setError('瀏覽器儲存空間不足，請釋出空間後重試。'); }
    void loadMoreSaved();
    return () => { historyGeneration.current++; historyRequest.current?.abort(); };
  }, [workspaceId, commit, loadMoreSaved]);

  useEffect(() => {
    let stopped = false, running = false;
    let active: AbortController | null = null;
    const pump = async () => {
      if (running || stopped || document.hidden || !navigator.onLine) return;
      running = true;
      const attempted = new Set<string>();
      try {
        while (!stopped && !document.hidden && navigator.onLine) {
          const deletedId = [...pendingDeletions.current].find(id => (deletionRetryAt.current.get(id) || 0) <= Date.now());
          if (deletedId) {
            deletionRetryAt.current.set(deletedId, Date.now() + 30_000);
            const controller = new AbortController(); active = controller;
            const timeout = window.setTimeout(() => controller.abort(), 15_000);
            try {
              if (await deletePersistedAssessment(workspaceId, deletedId, controller.signal)) {
                const remaining = [...pendingDeletions.current].filter(id => id !== deletedId);
                localStorage.setItem(DELETIONS_KEY, JSON.stringify(remaining));
                pendingDeletions.current.delete(deletedId);
              }
            } catch { /* Keep the tombstone for the next reconnect, including after reload. */ }
            finally { window.clearTimeout(timeout); active = null; }
            continue;
          }
          const next = records.current.find(item => (item.clsScore == null || item.scoreSyncPending || item.syncStatus === 'local')
            && !attempted.has(item.id) && retryAt.current.due(item.id));
          if (!next) break;
          attempted.add(next.id);
          retryAt.current.defer(next.id);
          const controller = new AbortController(); active = controller;
          const timeout = window.setTimeout(() => controller.abort(), 20_000);
          try {
            let updated = next;
            if (next.historySummary) {
              const full = await loadSavedDetails(next.id);
              if (!full || stopped || controller.signal.aborted) continue;
              updated = full;
            }
            if (updated.syncStatus === 'local') {
              const result = await persistAssessment(workspaceId, updated, [], controller.signal);
              if (result.ok && result.record) updated = mergeSavedRecords(updated, result.record);
            }
            if (updated.clsScore == null || updated.scoreSyncPending) updated = await resolveSavedScore(updated, workspaceId, controller.signal);
            if (updated.clsScore != null && !updated.scoreSyncPending && updated.syncStatus !== 'local') retryAt.current.reset(next.id);
            if (stopped || controller.signal.aborted) continue;
            if (!records.current.some(item => item.id === next.id)) {
              if (updated.syncStatus === 'synced') void deletePersistedAssessment(workspaceId, next.id).catch(() => {});
              continue;
            }
            if (updated !== next) commit(current => current.map(item => item.id === next.id
              ? (item.fieldRecord ? mergeSavedRecords(item, updated)
                : { ...updated, ...(item.clsScore != null && updated.clsScore == null ? item : {}) }) : item));
          } catch (cause) {
            if (!stopped && !controller.signal.aborted && cause instanceof DOMException && cause.name === 'QuotaExceededError') {
              setError('CLS 已取得，但儲存空間不足；請釋出空間後重試。');
            }
          } finally { window.clearTimeout(timeout); active = null; }
        }
      } finally { running = false; }
    };
    run.current = () => { void pump(); };
    const resume = () => { if (!document.hidden) retry(); };
    const timer = window.setInterval(() => void pump(), 30_000);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    void pump();
    return () => {
      stopped = true; active?.abort(); run.current = () => {};
      window.clearInterval(timer);
      window.removeEventListener('online', resume); window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [workspaceId, commit, retry, loadSavedDetails]);

  useEffect(() => { run.current(); }, [saved]);
  return { savedLocations: saved, setSavedLocations: commit, retrySavedScores: retry, savedStorageError: error,
    hasMoreSaved: historyCursor !== null, historyLoading, historyError, loadMoreSaved, loadSavedDetails };
}
