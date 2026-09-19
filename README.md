# CatalogPilot

**Turn any supplier sheet into a Shopify store.**

CatalogPilot connects a merchant's supplier spreadsheet to their Shopify catalog: it understands the
columns, applies pricing and inventory rules, shows exactly what will change, and keeps the catalog in
sync on a schedule.

---

## Setup

Target deployment: **Vercel** for hosting, **Neon** for PostgreSQL.

### 1. Requirements

- Node.js 20 or newer
- A Neon project
- A Vercel project (**Pro plan** — see [Scheduled sync](#scheduled-sync-and-the-vercel-plan))
- A Shopify Partner app
- A Google Cloud project with the Sheets and Drive APIs enabled

### 2. Create the Neon database

In the Neon console, create a project and copy **both** connection strings from
**Connection Details**:

- **Pooled** — the host contains `-pooler`. This is `DATABASE_URL`, used by the app. Serverless
  functions open many short-lived connections, and the pooler is what keeps them from exhausting
  Postgres' connection slots.
- **Direct** — no `-pooler`. This is `DIRECT_URL`, used only by `prisma migrate`, which performs
  session-level operations the pooler does not support.

Add `?sslmode=require&connect_timeout=15` to the pooled URL. The timeout matters: a Neon compute that
has scaled to zero needs a moment to wake, and the default is short enough to fail the first request.

### 3. Install and configure

```bash
npm install
cp .env.example .env
```

Generate the encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

| Variable | What it is |
| --- | --- |
| `APP_URL` | Your Vercel production URL |
| `DATABASE_URL` | Neon **pooled** connection string |
| `DIRECT_URL` | Neon **direct** connection string (migrations only) |
| `ENCRYPTION_KEY` | 32 random bytes, base64 — encrypts stored OAuth tokens |
| `APP_SECRET` | Any long random string — signs OAuth state tokens |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | From your Partner dashboard |
| `SHOPIFY_SCOPES` | Must match `shopify.app.toml` |
| `SHOPIFY_API_VERSION` | `2026-07` (current stable) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `<APP_URL>/api/auth/google/callback` |
| `CRON_SECRET` | 16+ random chars. Vercel sends it automatically to the cron endpoint |
| `JOB_RUNNER_SECRET` | Optional — only to trigger the runner yourself |
| `SMTP_URL` | Optional. Without it the app works fully, minus outbound email |

In the Google Cloud console, add `<APP_URL>/api/auth/google/callback` as an authorized redirect URI.

### 4. Run the migration

Migrations run from your machine (or CI), not from a Vercel build:

```bash
npx prisma migrate deploy
```

`npm run build` runs `prisma generate` already, so the client is always regenerated on deploy. Do not
add `migrate deploy` to the build command — concurrent builds would race on the same schema.

### 5. Deploy to Vercel

```bash
vercel link
vercel env add ENCRYPTION_KEY production      # repeat for each variable above
vercel --prod
```

Or import the repo in the Vercel dashboard and paste the variables into
**Settings → Environment Variables**. `vercel.json` is already configured with the cron schedule and
function durations.

After the first deploy, set `APP_URL` and `GOOGLE_REDIRECT_URI` to the real production URL and redeploy.

### 6. Choose how merchants connect their sheet

There are three paths, because Google OAuth with the `spreadsheets` scope is a
*sensitive scope*: it needs Google app verification before it can be offered publicly, which takes
weeks and requires a domain you own (a `*.vercel.app` subdomain will not pass). The other two paths
skip the consent screen entirely and work today.

| Path | Merchant does | Sheet privacy | Scheduled sync | Google verification |
| --- | --- | --- | --- | --- |
| **Shared with service account** | Shares the sheet with one address, pastes the link | Private | Yes | **Not needed** |
| **Published CSV link** | Publishes the sheet to the web, pastes the link | **Public to anyone with the link** | Yes | **Not needed** |
| CSV / Excel upload | Uploads a file | Private | No — manual | Not needed |
| Google OAuth | Picks a sheet from their Drive | Private | Yes | Required before public launch |

**To enable the shared-sheet path** (recommended), create a service account:

1. Google Cloud Console → **IAM & Admin → Service Accounts → Create service account**
2. Name it `catalogpilot-sheets`, create it, then open it → **Keys → Add key → JSON**
3. Enable the **Google Sheets API** for the project if you have not already
4. Set the two variables:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=catalogpilot-sheets@your-project.iam.gserviceaccount.com
# The downloaded JSON, base64 encoded:
GOOGLE_SERVICE_ACCOUNT_KEY=$(base64 -w0 service-account.json)
```

The service account needs no roles and no domain-wide delegation — it only ever reads files that a
merchant has explicitly shared with its address. Leave both variables unset and the option is hidden
from the UI automatically.

### 7. Install on a store

```bash
shopify app config link     # links shopify.app.toml to your app
shopify app deploy          # registers webhooks and scopes
```

Set `application_url` in `shopify.app.toml` to your Vercel URL.

### Local development

```bash
npm run dev
```

Cron does not run locally, so trigger the job runner by hand:

```bash
curl -X POST http://localhost:3000/api/jobs/run -H "Authorization: Bearer $JOB_RUNNER_SECRET"
```

---

## How background work runs on Vercel

Vercel has no long-running processes, so there is no worker daemon. Instead:

- **Vercel Cron** hits `GET /api/jobs/run` every five minutes (`vercel.json`). Vercel authenticates it
  by sending `Authorization: Bearer $CRON_SECRET`; the endpoint accepts that or `JOB_RUNNER_SECRET`.
  That one call both queues due schedules and works the queue.
- **Interactive actions** (starting a preview, approving a sync, retrying errors) start the job
  immediately via `waitUntil`, so the merchant does not wait up to five minutes for feedback. A bare
  floating promise would not work — Vercel freezes the function the moment the response is sent.
- **Jobs run under a deadline.** A function is killed at `maxDuration` (300s), so the runner stops at
  280s, hands the job back to the queue as `QUEUED`, and the next cron tick resumes it. Both phases are
  resumable: planning tracks a row high-water mark and `planCompletedAt`, and applying leaves unfinished
  items `PENDING`. Nothing is re-applied, because applied items are marked `APPLIED`.
- **Overlap is prevented by a database lock**, not by cron timing — Vercel explicitly warns that crons
  can overlap, duplicate, or be missed. The conditional `updateMany` claim means only one invocation
  ever owns a job, and a lock left by a hard kill is released after ten minutes.

A very large catalog therefore syncs across several cron ticks rather than in one call. That is by
design; progress is visible throughout.

`npm run worker` and `npm run scheduler` still exist for self-hosted deployments (a container, Fly,
Railway). They are not used on Vercel.

### Scheduled sync and the Vercel plan

**Vercel Hobby only permits one cron invocation per day**, and a more frequent expression in
`vercel.json` *fails the deployment*. Hobby also invokes it at any point within the scheduled hour.

**This project is currently configured for Hobby:**

- `vercel.json` runs the cron once daily (`0 3 * * *`)
- `SUBDAILY_SYNC_SUPPORTED` in `lib/plans.js` is `false`, which removes the hourly and six-hourly
  options from every plan — the API refuses them and the UI does not offer them. Without this the app
  would sell a schedule the host cannot run.

**To enable sub-daily sync after upgrading to Vercel Pro**, change two lines:

1. `vercel.json` → `"schedule": "*/5 * * * *"`
2. `lib/plans.js` → `export const SUBDAILY_SYNC_SUPPORTED = true;`

Hourly and six-hourly then appear on the plans that include them.

---

## Architecture

```
app/          Next.js App Router — pages and API routes only
components/   React components (presentation; no business logic)
lib/          Infrastructure: auth, crypto, logging, Prisma, env, HTTP helpers
services/     Business logic, one module per concern
graphql/      Admin GraphQL documents
jobs/         Worker, scheduler, and the shared job runner
validators/   Zod schemas for every mutating request
prisma/       Schema and migrations
tests/        Vitest suites
```

### Services

| Module | Responsibility |
| --- | --- |
| `mapping-engine` | Matches supplier headers to Shopify fields, deterministic first |
| `rules-engine` | Evaluates price, inventory, tag and collection rules with explanations |
| `row-transformer` | Coerces and validates one sheet row into typed fields |
| `sync-planner` | Diffs a row against Shopify and decides create / update / unchanged |
| `sync-engine` | Runs the two-phase job: build a plan, then apply it |
| `shopify-catalog` | Admin API operations for products, variants, inventory, collections |
| `google-sheets` | Spreadsheet listing, header reading, row streaming |
| `file-source` | CSV and Excel parsing and staging |
| `rule-store` | Rule persistence, with a dry run before every save |
| `data-source` | Source lifecycle: connect, select worksheet, map columns |
| `job-service` | Enqueue, lock, schedule, cancel |
| `error-center` | Translates failures into merchant-facing copy; retries |
| `billing` | Shopify Billing API and plan entitlement |
| `notifications` | Event preferences and delivery |

### How a sync works

1. **Plan.** Rows stream from the source. Each row is transformed, validated, run through the rules, and
   compared against its current Shopify state. One `SyncJobItem` is written per row, carrying the exact
   field-level changes and the explanation behind each one. Nothing is written to Shopify.
2. **Review.** The preview screen pages through those items server-side.
3. **Apply.** Approved items are copied to a sync job and replayed. Each row is re-planned at apply time,
   so a store edit made since the preview is respected rather than blindly overwritten.

Jobs take a database lock (a conditional `updateMany`), so two workers cannot run the same job and a
source cannot sync twice at once. Items are keyed by `(job, row)` and marked `APPLIED`, so re-running a
partially applied job resumes rather than duplicating.

---

## Safety model

These are enforced in code, not by convention:

- **Nothing is ever deleted.** No product, variant or collection delete mutation exists anywhere in the
  codebase. `productSet` is deliberately not used, because it deletes variants omitted from its input.
- **Blank cells do not clear fields.** An empty cell means "no information". Clearing requires the
  merchant to turn on *Allow blank values to overwrite* per source.
- **Unmapped fields are untouched.** Only fields with a confirmed column mapping are ever written.
- **Variants are updated by id.** Variants that are not in the sheet are left exactly as they are.
- **Collections are additive.** Products are added to collections, never removed. Missing collections are
  reported rather than created, unless the merchant opts in.
- **High-risk mappings need confirmation.** Price, SKU, inventory and status cannot be auto-applied from a
  fuzzy match — they surface as *Needs review*.
- **Duplicate SKUs are caught.** Within a run, and against existing `ProductMapping` records, so a rename
  in the sheet updates the right product instead of creating a second one.

---

## Security

- Shop identity comes only from a verified App Bridge session token. A `shop` parameter from the browser
  is never trusted, anywhere.
- Every tenant-scoped query filters by a `shopId` derived from that session. There is no code path that
  loads a record by id alone.
- Access tokens are encrypted with AES-256-GCM before storage and redacted from logs by pattern and by
  key name.
- Webhooks are verified by HMAC over the raw body, with a replay window and duplicate suppression.
- Every mutating route parses its body through a Zod schema; unknown fields are stripped, and `shopId`
  appears in none of them.
- Shopify search values and Google Drive query values are escaped before interpolation.
- The job runner endpoint is authenticated by a shared secret, not a session, because it acts across
  shops.

Run `npm test` to exercise the auth, webhook, crypto and redaction suites.

---

## Testing

```bash
npm test
```

208 tests covering: column mapping, rule evaluation, row transformation and validation, sync planning and
safety behaviour, session-token verification, webhook HMAC and replay, encryption and state signing, log
redaction, Shopify client retry and backoff, catalog mutations, plan entitlement, job locking and
idempotency, and CSV/Excel parsing.

---

## App Store listing

**Name:** CatalogPilot

**Short description:** Sync products, pricing and inventory from your supplier spreadsheet.

**Full description:**

CatalogPilot turns the spreadsheet your supplier already sends you into an automated Shopify catalog.

Connect a Google Sheet or upload a CSV, and CatalogPilot reads your column names — whatever they happen
to be called — and matches them to Shopify fields. Set your pricing rule once (cost × 1.4, rounded to a
price ending in 99, never below ₹499) and your stock policy once (hold back three units, draft anything
that sells out). Every sync after that runs on its own.

Before anything changes, you see exactly what will happen: how many products will be created, which ones
will be updated, and for each change, the current value, the incoming value, and the rule that produced
it. Nothing reaches your store until you approve it.

CatalogPilot never deletes. It does not remove products, variants or collections, and an empty cell in
your sheet never wipes out a value in your store.

**Features:**

- Smart column mapping that recognises the names suppliers actually use
- Visual pricing rules with conditions, rounding, and price floors and ceilings
- Inventory rules with safety stock and automatic draft/active status
- Supplier category to Shopify collection mapping
- Automatic tagging from brand, category and product type
- Full sync preview with a per-change explanation
- Error center with plain-English causes and one-click retry
- Scheduled sync: hourly, every six hours, daily or weekly
- Google Sheets, CSV and Excel sources

**Keywords:** google sheets shopify, product sync, supplier catalog, bulk product update, inventory sync,
product importer, spreadsheet to shopify

**Required pages:** `/privacy`, `/terms`, `/support`

**Scopes requested:** `read_products`, `write_products`, `read_inventory`, `write_inventory`,
`read_locations` — no customer, order or content access.

---

## Deployment checklist

- [ ] `DATABASE_URL` is the Neon **pooled** URL (`-pooler` in the host)
- [ ] `DIRECT_URL` is the Neon **direct** URL
- [ ] `npx prisma migrate deploy` has run against the direct URL
- [ ] Every environment variable is set in Vercel for the **Production** environment
- [ ] `CRON_SECRET` is set — without it the cron endpoint rejects every invocation
- [ ] The Vercel project is on **Pro** if you sell sub-daily scheduled sync
- [ ] `APP_URL` matches `application_url` in `shopify.app.toml`
- [ ] Webhooks deployed with `shopify app deploy`
- [ ] The cron job appears under **Settings → Cron Jobs** after the first production deploy
- [ ] `/api/health` returns 200
