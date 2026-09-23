
import { dataDb } from "./db";
import { applyFieldObservationAdjustment } from "./scoring";

const MAX_EVIDENCE_PER_ASSESSMENT = 6;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface PersistedEvidenceInput {
  id: string;
  type: "photo" | "note";
  capturedAt: number;
  location: { lat: number; lng: number };
  note?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface PersistedAssessmentInput {
  workspaceId: string;
  assessment: Record<string, any>;
  evidence: PersistedEvidenceInput[];
}

export interface PersistedAssessmentRecord {
  id: string;
  name: string;
  streetName: string;
  district: string;
  city: string;
  coords: { lat: number; lng: number };
  clsScore: number | null;
  baselineClsScore: number | null;
  fieldAdjustment: number | null;
  fieldAdjustmentDetails?: {
    categoryAdjustments: Record<"C1" | "C2" | "C3" | "C4" | "C5", number>;
    itemAdjustments: Record<string, number>;
    ratedItemCount: number;
  };
  observationRatings?: Record<string, number>;
  assessmentSnapshot?: Record<string, any>;
  evidence: PersistedEvidenceInput[];
  grade: "S" | "A" | "B" | "C" | "D" | null;
  scores: {
    c1: number | null;
    c2: number | null;
    c3: number | null;
    c4: number | null;
    c5: number | null;
  };
  c1Data?: any;
  c2Data?: any;
  c3Data?: any;
  c4Data?: any;
  c5Data?: any;
  weights?: any;
  fieldNotes?: string;
  timestamp: number;
}

export async function ensureAssessmentSchema(): Promise<void> {
  if (!dataDb) return;

  await dataDb.query(`
    CREATE TABLE IF NOT EXISTS assessment_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      street_name TEXT NOT NULL,
      district TEXT NOT NULL,
      city TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      baseline_cls DOUBLE PRECISION,
      adjusted_cls DOUBLE PRECISION,
      session_timestamp BIGINT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_assessment_sessions_workspace_time
      ON assessment_sessions(workspace_id, session_timestamp DESC);

    CREATE TABLE IF NOT EXISTS assessment_evidence (
      assessment_id TEXT NOT NULL REFERENCES assessment_sessions(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('photo', 'note')),
      captured_at BIGINT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      note TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      photo_data BYTEA,
      photo_size_bytes INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, evidence_id)
    );

    CREATE INDEX IF NOT EXISTS idx_assessment_evidence_assessment
      ON assessment_evidence(assessment_id, captured_at DESC);
  `);
}

function validateWorkspaceId(value: unknown): string {
  const workspaceId = String(value ?? "").trim();
  if (!workspaceId || workspaceId.length > 200) {
    throw new Error("workspaceId is required");
  }
  return workspaceId;
}

function validateAssessmentId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!id || id.length > 200) throw new Error("assessment.id is required");
  return id;
}

function validateLocation(location: any): { lat: number; lng: number } {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error("assessment coordinates are invalid");
  }
  return { lat, lng };
}

function normalizeBaseline(value: unknown): number | null {
  if (value == null) return null;
  const baseline = Number(value);
  if (!Number.isFinite(baseline) || baseline < 0 || baseline > 100) {
    throw new Error("baselineClsScore must be null or a number from 0 to 100");
  }
  return baseline;
}

function normalizeRatings(value: unknown): Record<string, number> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("observationRatings must be an object");

  const ratings: Record<string, number> = {};
  for (const [id, rawRating] of Object.entries(value)) {
    const rating = Number(rawRating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
      throw new Error("observation rating is invalid for " + id);
    }
    ratings[id] = rating;
  }
  return ratings;
}

function normalizeEvidence(evidence: unknown): PersistedEvidenceInput[] {
  if (evidence == null) return [];
  if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE_PER_ASSESSMENT) {
    throw new Error("evidence must contain at most " + MAX_EVIDENCE_PER_ASSESSMENT + " items");
  }

  return evidence.map((item: any) => {
    const id = String(item?.id ?? "").trim();
    if (!id || id.length > 200) throw new Error("evidence.id is required");

    const type = item?.type === "photo" || item?.type === "note" ? item.type : null;
    if (!type) throw new Error("Unsupported evidence type for " + id);

    const capturedAt = Number(item?.capturedAt);
    if (!Number.isFinite(capturedAt)) throw new Error("evidence.capturedAt is invalid for " + id);

    const location = validateLocation(item?.location);
    const mimeType = item?.mimeType ? String(item.mimeType) : undefined;
    if (type === "photo" && mimeType && !mimeType.startsWith("image/")) {
      throw new Error("evidence.mimeType is not an image for " + id);
    }

    return {
      id,
      type,
      capturedAt,
      location,
      note: item?.note ? String(item.note).slice(0, 2000) : undefined,
      mimeType,
      width: Number.isInteger(Number(item?.width)) && Number(item.width) > 0 ? Number(item.width) : undefined,
      height: Number.isInteger(Number(item?.height)) && Number(item.height) > 0 ? Number(item.height) : undefined,
    };
  });
}

function gradeForScore(score: number | null): "S" | "A" | "B" | "C" | "D" | null {
  if (score == null) return null;
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

export async function saveAssessmentSession(input: PersistedAssessmentInput): Promise<PersistedAssessmentRecord> {
  if (!dataDb) throw new Error("DATABASE_URL is required for Cloud SQL persistence");

  const workspaceId = validateWorkspaceId(input.workspaceId);
  const assessment = input.assessment || {};
  const id = validateAssessmentId(assessment.id);
  const coords = validateLocation(assessment.coords);
  const baselineClsScore = normalizeBaseline(assessment.baselineClsScore);
  const observationRatings = normalizeRatings(assessment.observationRatings);
  const evidence = normalizeEvidence(input.evidence);

  const adjustment = applyFieldObservationAdjustment(baselineClsScore, observationRatings);
  const adjustedCls = adjustment.adjustedCls;
  const grade = gradeForScore(adjustedCls);

  const snapshotPayload = assessment.assessmentSnapshot && typeof assessment.assessmentSnapshot === "object"
    ? assessment.assessmentSnapshot
    : undefined;

  const scores = {
    c1: Number.isFinite(Number(assessment?.scores?.c1)) ? Number(assessment.scores.c1) : null,
    c2: Number.isFinite(Number(assessment?.scores?.c2)) ? Number(assessment.scores.c2) : null,
    c3: Number.isFinite(Number(assessment?.scores?.c3)) ? Number(assessment.scores.c3) : null,
    c4: Number.isFinite(Number(assessment?.scores?.c4)) ? Number(assessment.scores.c4) : null,
    c5: Number.isFinite(Number(assessment?.scores?.c5)) ? Number(assessment.scores.c5) : null,
  };

  const payload: PersistedAssessmentRecord = {
    id,
    name: String(assessment.name || assessment.streetName || "Street assessment").slice(0, 300),
    streetName: String(assessment.streetName || "Selected street").slice(0, 300),
    district: String(assessment.district || "").slice(0, 100),
    city: String(assessment.city || "").slice(0, 100),
    coords,
    clsScore: adjustedCls,
    baselineClsScore,
    fieldAdjustment: adjustment.adjustment,
    fieldAdjustmentDetails: {
      categoryAdjustments: adjustment.categoryAdjustments,
      itemAdjustments: adjustment.itemAdjustments,
      ratedItemCount: adjustment.ratedItemCount,
    },
    observationRatings,
    assessmentSnapshot: snapshotPayload,
    evidence,
    grade,
    scores,
    c1Data: assessment.c1Data,
    c2Data: assessment.c2Data,
    c3Data: assessment.c3Data,
    c4Data: assessment.c4Data,
    c5Data: assessment.c5Data,
    weights: assessment.weights,
    fieldNotes: String(assessment.fieldNotes || "").slice(0, 10000),
    timestamp: Number.isFinite(Number(assessment.timestamp)) ? Number(assessment.timestamp) : Date.now(),
  };

  await dataDb.query(
    `INSERT INTO assessment_sessions
      (id, workspace_id, street_name, district, city, latitude, longitude,
       baseline_cls, adjusted_cls, session_timestamp, payload, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW())
     ON CONFLICT (id)
     DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
                   street_name = EXCLUDED.street_name,
                   district = EXCLUDED.district,
                   city = EXCLUDED.city,
                   latitude = EXCLUDED.latitude,
                   longitude = EXCLUDED.longitude,
                   baseline_cls = EXCLUDED.baseline_cls,
                   adjusted_cls = EXCLUDED.adjusted_cls,
                   session_timestamp = EXCLUDED.session_timestamp,
                   payload = EXCLUDED.payload,
                   updated_at = NOW()`,
    [
      payload.id,
      workspaceId,
      payload.streetName,
      payload.district,
      payload.city,
      payload.coords.lat,
      payload.coords.lng,
      payload.baselineClsScore,
      payload.clsScore,
      payload.timestamp,
      JSON.stringify(payload),
    ],
  );

  await dataDb.query("DELETE FROM assessment_evidence WHERE assessment_id = $1", [id]);

  for (const item of evidence) {
    await dataDb.query(
      `INSERT INTO assessment_evidence
        (assessment_id, evidence_id, type, captured_at, latitude, longitude, note,
         mime_type, width, height, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        id,
        item.id,
        item.type,
        item.capturedAt,
        item.location.lat,
        item.location.lng,
        item.note ?? null,
        item.mimeType ?? null,
        item.width ?? null,
        item.height ?? null,
      ],
    );
  }

  return payload;
}

export async function listAssessmentSessions(workspaceIdInput: unknown, limitInput: unknown = 100): Promise<PersistedAssessmentRecord[]> {
  if (!dataDb) throw new Error("DATABASE_URL is required for Cloud SQL persistence");
  const workspaceId = validateWorkspaceId(workspaceIdInput);
  const limit = Math.min(100, Math.max(1, Number.isFinite(Number(limitInput)) ? Math.floor(Number(limitInput)) : 100));

  const sessions = await dataDb.query(
    `SELECT id, payload
     FROM assessment_sessions
     WHERE workspace_id = $1
     ORDER BY session_timestamp DESC
     LIMIT $2`,
    [workspaceId, limit],
  );

  if (sessions.rows.length === 0) return [];

  const ids = sessions.rows.map((row: any) => row.id);
  const evidenceResult = await dataDb.query(
    `SELECT assessment_id AS "assessmentId", evidence_id AS "evidenceId", type,
            captured_at AS "capturedAt", latitude, longitude, note,
            mime_type AS "mimeType", width, height, photo_data IS NOT NULL AS "hasPhoto"
     FROM assessment_evidence
     WHERE assessment_id = ANY($1::text[])
     ORDER BY captured_at DESC`,
    [ids],
  );

  const evidenceByAssessment = new Map<string, PersistedEvidenceInput[]>();
  for (const row of evidenceResult.rows) {
    const list = evidenceByAssessment.get(row.assessmentId) || [];
    list.push({
      id: row.evidenceId,
      type: row.type,
      capturedAt: Number(row.capturedAt),
      location: { lat: Number(row.latitude), lng: Number(row.longitude) },
      note: row.note || undefined,
      mimeType: row.mimeType || undefined,
      width: row.width || undefined,
      height: row.height || undefined,
    });
    evidenceByAssessment.set(row.assessmentId, list);
  }

  return sessions.rows.map((row: any) => {
    const payload = row.payload as PersistedAssessmentRecord;
    return {
      ...payload,
      evidence: evidenceByAssessment.get(row.id) || [],
    };
  });
}

export async function deleteAssessmentSession(workspaceIdInput: unknown, idInput: unknown): Promise<boolean> {
  if (!dataDb) throw new Error("DATABASE_URL is required for Cloud SQL persistence");
  const workspaceId = validateWorkspaceId(workspaceIdInput);
  const id = validateAssessmentId(idInput);
  const result = await dataDb.query(
    "DELETE FROM assessment_sessions WHERE id = $1 AND workspace_id = $2",
    [id, workspaceId],
  );
  return result.rowCount > 0;
}

export async function saveAssessmentPhoto(
  workspaceIdInput: unknown,
  idInput: unknown,
  evidenceIdInput: unknown,
  body: Buffer,
  mimeTypeInput: unknown,
): Promise<void> {
  if (!dataDb) throw new Error("DATABASE_URL is required for Cloud SQL persistence");
  const workspaceId = validateWorkspaceId(workspaceIdInput);
  const assessmentId = validateAssessmentId(idInput);
  const evidenceId = String(evidenceIdInput ?? "").trim();
  if (!evidenceId || evidenceId.length > 200) throw new Error("evidenceId is required");
  if (!Buffer.isBuffer(body) || body.length === 0) throw new Error("photo body is required");
  if (body.length > MAX_PHOTO_BYTES) throw new Error("photo exceeds the 5 MB limit");

  const mimeType = String(mimeTypeInput ?? "").toLowerCase();
  if (!mimeType.startsWith("image/")) throw new Error("photo content type must be an image");

  const result = await dataDb.query(
    `UPDATE assessment_evidence
     SET photo_data = $1, mime_type = $2, photo_size_bytes = $3, updated_at = NOW()
     WHERE assessment_id = $4
       AND evidence_id = $5
       AND type = 'photo'
       AND EXISTS (
         SELECT 1 FROM assessment_sessions
         WHERE assessment_sessions.id = assessment_evidence.assessment_id
           AND assessment_sessions.workspace_id = $6
       )`,
    [body, mimeType, body.length, assessmentId, evidenceId, workspaceId],
  );

  if (result.rowCount === 0) {
    throw new Error("Assessment or photo evidence was not found");
  }
}

export async function getAssessmentPhoto(
  workspaceIdInput: unknown,
  idInput: unknown,
  evidenceIdInput: unknown,
): Promise<{ body: Buffer; mimeType: string } | null> {
  if (!dataDb) return null;
  const workspaceId = validateWorkspaceId(workspaceIdInput);
  const assessmentId = validateAssessmentId(idInput);
  const evidenceId = String(evidenceIdInput ?? "").trim();

  const result = await dataDb.query(
    `SELECT photo_data AS "photoData", mime_type AS "mimeType"
     FROM assessment_evidence
     WHERE assessment_id = $1
       AND evidence_id = $2
       AND type = 'photo'
       AND photo_data IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM assessment_sessions
         WHERE assessment_sessions.id = assessment_evidence.assessment_id
           AND assessment_sessions.workspace_id = $3
       )`,
    [assessmentId, evidenceId, workspaceId],
  );

  const row = result.rows[0];
  if (!row?.photoData) return null;
  return {
    body: row.photoData as Buffer,
    mimeType: row.mimeType || "application/octet-stream",
  };
}
