import type { EvidencePhotoDraft, SavedLocation, AssessmentEvidence } from "../types";

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
): Promise<PersistAssessmentResult> {
  const response = await fetch("/api/assessments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      assessment: {
        ...assessment,
        evidence: undefined,
      },
      evidence: evidenceMetadata(assessment.evidence || []),
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    return { ok: false, error: message || "Cloud SQL persistence failed: " + response.status };
  }

  const record = await response.json() as SavedLocation;
  const draftsById = new Map(evidenceDrafts.map((draft) => [draft.id, draft]));

  try {
    for (const item of record.evidence || []) {
      if (item.type !== "photo") continue;
      const draft = draftsById.get(item.id);
      if (!draft) throw new Error("Missing photo draft for evidence " + item.id);

      const upload = await fetch(
        "/api/assessments/" + encodeURIComponent(record.id)
          + "/evidence/" + encodeURIComponent(item.id)
          + "/photo?workspaceId=" + encodeURIComponent(workspaceId),
        {
          method: "PUT",
          headers: { "Content-Type": draft.mimeType || "application/octet-stream" },
          body: draft.blob,
        },
      );
      if (!upload.ok) {
        throw new Error("Photo upload failed: " + upload.status);
      }
    }
  } catch (error) {
    await fetch(
      "/api/assessments/" + encodeURIComponent(record.id)
        + "?workspaceId=" + encodeURIComponent(workspaceId),
      { method: "DELETE" },
    ).catch(() => {});
    return { ok: false, error: error instanceof Error ? error.message : "Photo upload failed" };
  }

  return { ok: true, record };
}

export async function listPersistedAssessments(workspaceId: string): Promise<SavedLocation[]> {
  const response = await fetch("/api/assessments?workspaceId=" + encodeURIComponent(workspaceId));
  if (!response.ok) return [];
  return await response.json() as SavedLocation[];
}

export async function deletePersistedAssessment(workspaceId: string, id: string): Promise<boolean> {
  const response = await fetch(
    "/api/assessments/" + encodeURIComponent(id)
      + "?workspaceId=" + encodeURIComponent(workspaceId),
    { method: "DELETE" },
  );
  return response.ok || response.status === 404;
}

export function getRemoteEvidencePhotoUrl(workspaceId: string, assessmentId: string, evidenceId: string): string {
  return "/api/assessments/" + encodeURIComponent(assessmentId)
    + "/evidence/" + encodeURIComponent(evidenceId)
    + "/photo?workspaceId=" + encodeURIComponent(workspaceId);
}
