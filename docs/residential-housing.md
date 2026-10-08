# Residential street market

## Private owner access

Private access supports multiple accounts. Prefer `STREETLENS_PRIVATE_EMAILS`
(comma-separated emails; whitespace trimmed, case-insensitive, duplicates collapsed,
maximum 100 entries). Setting this variable replaces, rather than extends, the
legacy `STREETLENS_OWNER_EMAIL` and `STREETLENS_OWNER_GOOGLE_SUB` settings. An explicitly
empty or malformed list fails closed. Actual emails belong only in server environment
configuration, not Git. For non-Gmail accounts, supply per-account subject pins as
JSON in `STREETLENS_PRIVATE_GOOGLE_SUBS`, e.g. `{"person@example.com":"google-sub"}`;
Gmail accounts may also be pinned. Invalid pin JSON or an external email without a
pin disables access. The old single-owner configuration remains compatible when
the plural variable is absent. Every read rechecks current membership; removing
an account revokes its session without revoking other accounts. Each session/logout
is independent; no whitelist details are returned to the client and no DB lookup
is added. Render environment changes require a service restart/redeploy, which
also clears all in-memory sessions.

Housing is not public. With missing OAuth configuration it is completely hidden
and `/api/housing` rejects before database access. Profile settings offers Google
sign-in only when the server is configured. The backend uses an authorization-code
flow with PKCE, a random single-use state bound to an HttpOnly browser cookie,
and Google UserInfo from the server-obtained access token. Only verified allowlisted
accounts are allowed. Gmail accounts can use email alone; non-Gmail accounts must
also pin their Google subject because Google may not remain authoritative
for an external email's ownership. No email/sub is sent to unauthenticated clients.

Configure server-only Render environment variables (never `VITE_*`):
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `STREETLENS_PRIVATE_EMAILS`,
`STREETLENS_PUBLIC_ORIGIN=https://streetlens-fokj.onrender.com`, and optional/required
`STREETLENS_PRIVATE_GOOGLE_SUBS` as above. Create a Google OAuth **Web application**
client with exact authorized redirect URI:
`https://streetlens-fokj.onrender.com/api/private/google/callback`.
For an External app in Testing, add the owner as a test user; only `openid email`
scopes are requested. Do not paste Client Secret into chat or commit it.

Private access uses random opaque, Secure/HttpOnly/SameSite=Lax host-only cookies.
Sessions last one hour in bounded server memory (32 sessions), not PostgreSQL;
server restart requires sign-in again. This MVP assumes one server instance;
multiple instances require an appropriately secured shared session store.
Logout validates the exact configured Origin, revokes the server session and
immediately clears client housing results. Auth/session and housing responses
are `private, no-store` so shared HTTP caches cannot expose them. Frontend in-memory
housing caching remains bounded and is cleared on lock/expiry. No OAuth provider
tokens are persisted, exposed to the browser, or logged. Google calls have timeouts
and reject redirects. Login starts are rate-limited and flows bounded; the
rate limit intentionally uses the socket IP, without trusting forwarded headers.

Private deployment is **not** permission to crawl or reuse another website's
content. No live-listing crawler has been enabled. OAuth itself and deployment
still require real credentials and a real-browser acceptance check; deterministic
tests use isolated mock Google responses, never actual owner credentials.

The collapsible housing section in assessments and saved reports is separate
from CLS. Opening it reads stored housing data; map movement and editing filters
do not acquire housing data. Applying filters sends one bounded read. Server
results cache for ten minutes (128 keys); browser results for five minutes (32).
The source import invalidates the server cache. Paging returns five records.
The UI uses a fixed five-year window. Aggregate totals include every matching
transaction, not just the five displayed records. Transaction details are
collapsed until requested; expanding them adds no network or database read.
Stats are computed in SQL, not by transferring entire city payloads.

## Official transaction source

Source: Ministry of the Interior, dataset 25119:
https://data.gov.tw/dataset/25119
https://plvr.land.moi.gov.tw/DownloadOpenData

Government Open Data License 1.0. Current releases are published on the 1st,
11th and 21st. Historical quarterly CSV ZIPs use DownloadSeason. Taipei (A) and
New Taipei (F) are the enabled import scope; this is not nationwide coverage.
Buy/sell CSVs only (`*_lvr_land_a.csv`), not rental or presale feeds.

Residential inclusion requires a registered purpose of 住家用 / 住宅 / 住宅用,
a land-and-building sale and a residential building type. Commercial/mixed,
land-only and standalone parking records are excluded. Missing purpose does
not become residential merely from a title. This is registered purpose, not
verification of actual occupancy. Special remarks matching the documented
parser keywords are excluded by default; that heuristic is not an exhaustive
identification of every unusual transaction.

Scope is exact city + district + road + section. Lanes on that road are included;
road sections stay separate. No address is geocoded, and no coordinates are
fabricated. This whole-road market is distinct from the CLS 250 m street portion.
Queries require district and a recognizable named road.

The UI time window is transaction date over the last five calendar years
(the API retains 1/3/5-year compatibility). Latest
means latest matching transaction **within the chosen filters and time window**.
Average and median totals include parking. Unit price and area exclude parking
only when both parking price and area are valid. If parking cannot be separated,
unit price is null, its sample is excluded from averages and displayed area is
marked as including parking. Area includes shared spaces, not usable interior
area. Age is age **at transaction**, not present-day age. Missing facts remain
null and cannot satisfy a filter. Basement/multiple/whole-building floors are
not guessed as a single floor. Counts, dates and observed source coverage are
displayed; city date extents do not certify complete street history.

## Import and operations

Deploy matching server code before importing. The initial import is explicit:
run the `Refresh residential transactions` workflow with `history_years=5`.
Existing STREETLENS_REFRESH_URL / STREETLENS_REFRESH_TOKEN secrets are reused.
On the 1st, 11th and 21st of each month at 10:30 Asia/Taipei, scheduled runs
download only the current release. On January/April/July/October 15 at 10:30,
an additional scheduled run reconciles the five-year quarterly history and
current release. GitHub may delay scheduled jobs. Identical hashes skip DB
writes, but historical ZIPs still require download/validation, so the full
five-year reconciliation is quarterly, not every regular update. The manual
workflow defaults to five years for initial setup or an earlier backfill.
An unavailable historical ZIP is reported as an incomplete/failed action while
other releases, including the current one, are still attempted.
No production import or database migration was executed during development.

Importer validates ZIP/schema/member/size, ignores the English second header,
sends only required fields, and never persists raw ZIPs or geocodes. The endpoint
authenticates before parsing its 12 MB body; each city/release writes atomically
under a lock. Source IDs deduplicate exact repeats and reject conflicting ones.
Source hashes skip unchanged imports. Publication ordering prevents older
quarters overwriting newer releases. Here publishedOn is the quarter's end or
the current download date used for precedence, not proof of a publisher's exact
release timestamp; the UI reports retrieval date separately. Corrected
non-residential IDs become ineligible without deleting stored rows. Both new
tables participate in the existing 700 MB write guard. No automatic retention
deletion is introduced, and no personal history/evidence is changed.

This is an incremental source cache, not an authoritative full replacement:
records withdrawn from official releases are not automatically detected by
absence alone. Later published corrections present in imported files update
known IDs. Snapshot coverage and withdrawal handling need production observation.

## Live listings limitation

Active sale inventory is not connected or represented as zero. Links open Leju,
591 and Rakuya; users must set housing/price filters on those sites. These are
external entry points, not proof of listing matches or synchronized inventory.
The transaction filter does not apply to these external sites.

Leju policies disallow systematic access/reproduction, and 591 and Rakuya
explicitly restrict unauthorised crawlers. No public reusable listing feed was
verified. No scraping, account probing, CAPTCHA bypass, broker contact-data
collection or listing photo copying is implemented. An agreed/authorised
listing feed is still needed to deliver in-app active-sale filters, duplicate
listing reconciliation, last-seen/withdrawal dates and asking-price statistics.
This first version does not claim to complete that requested portion.

## Validation

PGlite executes the actual PostgreSQL import, aggregation, filter and correction
queries. Unit tests cover usage/type exclusion, date validation, exact sections,
parking and unknown-field behavior, conflict/auth handling and cache hits.
Python tests cover actual CSV quoting/header/schema/history-window handling.
Browser tests check on-demand reads, no requests per keystroke, cache reuse,
320/390/1440 px layouts, collapsed details, fixed five-year queries, and
preservation of saved records. SQL tests verify five-row pagination with
untruncated statistics and no overlapping records. Source network
availability, real official download/schema variants, Neon migration/import
and operating footprint require deployment verification, separate from CI.
