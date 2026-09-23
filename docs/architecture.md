# StreetLens architecture

StreetLens uses a real-data backend with Cloud SQL persistence and Google AI Studio / Gemini as the explanation layer.

## Runtime flow

    Map / Search
        ↓
    Express API
        ├─ Google Maps / Places / Routes
        ├─ OpenStreetMap
        ├─ TDX / MOTC transit
        ├─ Taipei official green / safety / flood data
        └─ Open-Meteo air quality
        ↓
    Cloud SQL
        ├─ external_data_snapshots
        ├─ assessment_targets
        ├─ assessment_sessions
        └─ assessment_evidence
        ↓
    Source-backed baseline CLS
        ↓
    Field observation adjustment
        ↓
    Saved assessment + evidence
        ↓
    History / Compare
        ↓
    Google AI Studio / Gemini explanation

## Data responsibilities

### Cloud SQL

Cloud SQL is the durable source for:

- External-data snapshots and freshness metadata.
- Saved assessment sessions.
- Field observation ratings and adjustment details.
- Evidence metadata, including capture time and coordinates.
- Assessment photos in the current v1 implementation (`BYTEA`, max 5 MB per photo).

The browser may keep a local copy for offline-friendly UX, but Cloud SQL is the durable persistence path.

### Google AI Studio / Gemini

Gemini is an explanation layer. It can summarize and explain already-collected evidence and observations, but it must not invent external measurements or become the scoring authority.

The CLS numeric calculation remains deterministic and server-side.

## Assessment persistence API

- `GET /api/assessments?workspaceId=...` — load saved assessment history.
- `POST /api/assessments` — persist an assessment session and evidence metadata.
- `DELETE /api/assessments/:id?workspaceId=...` — delete a saved session.
- `PUT /api/assessments/:id/evidence/:evidenceId/photo` — upload one evidence photo.
- `GET /api/assessments/:id/evidence/:evidenceId/photo?workspaceId=...` — retrieve a saved photo.

The current `workspaceId` is a browser-generated anonymous owner key. It is intentionally separate from Google AI Studio / Gemini credentials. A future authenticated identity layer can replace it without changing the assessment data model.

## Integrity rules

1. External numeric indicators come from persisted real source snapshots.
2. Missing source data remains unavailable; no synthetic fallback values are created.
3. Field observation adjustments are recalculated server-side when an assessment is saved.
4. Repeated saves create independent assessment session IDs and independent photo records.
5. Deleting a session cascades to its evidence rows.
6. Assessment history is informational; compare does not calculate a winner.

## Photo storage note

Cloud SQL `BYTEA` is used for the current prototype because Cloud SQL is the selected persistence platform. At larger scale, photo blobs can be moved to object storage while retaining the same evidence metadata model in Cloud SQL.
## Gemini explanation layer

Saved assessment explanations are generated only from the persisted assessment session in Cloud SQL.

- POST /api/assessments/:id/explanation?workspaceId=... loads the saved session server-side before calling Gemini.
- The prompt receives persisted category scores, factor provenance, source status, field-observation ratings, field adjustments, notes, and evidence notes.
- Gemini is explicitly instructed not to calculate or change CLS, fill missing values, invent numeric facts, or rank streets.
- A missing Gemini configuration returns an unavailable response; the server does not synthesize a fallback explanation.
- The current UI exposes the explanation action only after the assessment has been saved to Cloud SQL.

This keeps Gemini in the explanation layer rather than the scoring layer. Gemini output is descriptive assistance, not a source of raw measurements or score calculations.
