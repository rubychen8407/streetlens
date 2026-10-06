import type { AssessmentExplanation, EvidencePhotoDraft, SavedLocation, AssessmentEvidence } from "../types";
import type { ExplanationLanguage } from './explanationLanguage';

export interface PersistAssessmentResult {
  ok: boolean;
  record?: SavedLocation;
  error?: string;
}

export function getWorkspaceId(): string {
  const key = "streetlens_workspace_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function evidenceMetadata(evidence: AssessmentEvidence[]): AssessmentEvidence[] {
  return evidence.map(({ id, type, capturedAt, location, note, mimeType, width, height }) => ({
    id,
    type,
    capturedAt,
    location,
    note,
    mimeType,
    width,
    height,
  }));
}

export async function persistAssessment(
  workspaceId: string,
  assessment: SavedLocation,
  evidenceDrafts: EvidencePhotoDraft[],
  signal?: AbortSignal,
): Promise<PersistAssessmentResult> {
  if (assessment.historySummary) throw new Error('Load the full saved assessment before persisting it');
  const response = await fetch("/api/assessments", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      assessment: {
        ...assessment,
        evidence: undefined,
        historySummary: undefined,
      },
      evidence: evidenceMetadata(assessment.evidence || []),
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    return { ok: false, error: message || "Cloud SQL persistence failed: " + response.status };
  }

  // Photo blobs stay in the browser's IndexedDB. PostgreSQL receives the
  // assessment and evidence metadata only, never the image bytes.
  void evidenceDrafts;
  const record = await response.json() as SavedLocation;
  return { ok: true, record };
}

export async function listPersistedAssessments(workspaceId: string): Promise<SavedLocation[]> {
  const response = await fetch("/api/assessments?workspaceId=" + encodeURIComponent(workspaceId));
  if (!response.ok) return [];
  return await response.json() as SavedLocation[];
}

export async function listAssessmentSummaryPage(workspaceId: string, cursor: string | null = null, signal?: AbortSignal): Promise<{ records: SavedLocation[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ workspaceId, view: 'summary', limit: '20' });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch('/api/assessments?' + params, { signal });
  if (!response.ok) throw new Error('History unavailable');
  const body = await response.json();
  // Keep compatibility with an older backend during a rolling deployment.
  return Array.isArray(body) ? { records: body, nextCursor: null } : body;
}

export async function getPersistedAssessment(workspaceId: string, id: string, signal?: AbortSignal): Promise<SavedLocation> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 20_000);
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once:true });
  try {
    const response = await fetch('/api/assessments/' + encodeURIComponent(id) + '?workspaceId=' + encodeURIComponent(workspaceId), { signal:controller.signal });
    if (!response.ok) throw new Error('Saved report unavailable');
    return { ...await response.json(), historySummary: false };
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort',abort); }
}

export async function deletePersistedAssessment(workspaceId: string, id: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(
    "/api/assessments/" + encodeURIComponent(id)
      + "?workspaceId=" + encodeURIComponent(workspaceId),
    { method: "DELETE", signal },
  );
  return response.ok || response.status === 404;
}

export async function generatePersistedAssessmentExplanation(
  workspaceId: string,
  assessmentId: string,
  language: ExplanationLanguage = 'zh-TW',
  signal?: AbortSignal,
): Promise<AssessmentExplanation> {
  const response = await fetch(
    "/api/assessments/" + encodeURIComponent(assessmentId)
      + "/explanation?workspaceId=" + encodeURIComponent(workspaceId) + "&language=" + encodeURIComponent(language),
    { method: "POST", signal },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(language === 'en' ? 'AI explanation is temporarily unavailable. Please retry.' : 'AI 解說暫時不可用，請重試。');
  }
  if (body.language !== language) throw new Error(language === 'en' ? 'Explanation language did not match. Please regenerate.' : '解說語言不符，請重新產生。');
  return body as AssessmentExplanation;
}

export function getRemoteEvidencePhotoUrl(workspaceId: string, assessmentId: string, evidenceId: string): string {
  return "/api/assessments/" + encodeURIComponent(assessmentId)
    + "/evidence/" + encodeURIComponent(evidenceId)
    + "/photo?workspaceId=" + encodeURIComponent(workspaceId);
}
