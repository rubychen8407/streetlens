# StreetLens free deployment

This MVP uses Neon PostgreSQL for durable relational storage and Render Free for the Express web service.

## 1. Create the Neon database

1. Create a Neon account and a new PostgreSQL project.
2. Choose a nearby region for the database.
3. Create or use the default database and role.
4. Copy the pooled PostgreSQL connection string from Neon.
5. Keep the connection string private.

The StreetLens server creates its required tables on startup. No manual SQL migration is required for the current prototype.

## 2. Prepare Gemini

Create a Gemini API key in Google AI Studio and keep it server-side. The application reads it from `GEMINI_API_KEY`.

Do not put the key in React client code or commit it to Git.

## 3. Deploy to Render Free

1. Sign in to Render and connect the GitHub repository `rubychen8407/streetlens`.
2. Create a new Blueprint and select the repository.
3. Render detects the root `render.yaml`.
4. Keep the web service plan set to `free`.
5. When Render asks for secret values, provide:
   - `DATABASE_URL`: the Neon PostgreSQL connection string.
   - `GEMINI_API_KEY`: the Google AI Studio key.
   - `GOOGLE_MAPS_API_KEY`: optional; leave empty when not configured.
   - `TDX_CLIENT_ID`: optional.
   - `TDX_CLIENT_SECRET`: optional.
   - `STREETLENS_REFRESH_TOKEN`: a long random token for protected refresh operations.
6. Deploy.

The service starts with `npm start` and exposes `/api/health`. The application connects to Neon through `DATABASE_URL` with PostgreSQL SSL enabled.

## 4. Verify the deployment

Open the Render service URL and confirm the map loads.

Then open `/api/health`.

A healthy service returns JSON with `status: "ok"`.

For a first database check, select a location and wait for the source-backed assessment flow to finish. Then save an assessment. Reopening the Street Library should load the persisted record from Neon.

## Free-tier behavior

Render Free web services spin down after 15 minutes without inbound traffic and may take about one minute to wake up. The local filesystem is ephemeral, so durable assessment data must stay in Neon; the browser IndexedDB photo cache is only a local fallback.

Neon and Render free tiers have usage limits. This setup is intended for a personal MVP / portfolio demo, not a production SLA workload.
