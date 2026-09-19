# CatalogPilot

**Turn any supplier sheet into a Shopify store.**

CatalogPilot connects a merchant's supplier spreadsheet to their Shopify catalog: it understands the
columns, applies pricing and inventory rules, shows exactly what will change, and keeps the catalog in
sync on a schedule.

---

## Setup

### 1. Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A Shopify Partner app
- A Google Cloud project with the Sheets and Drive APIs enabled

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Generate the encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Fill in `.env`:

| Variable | What it is |
| --- | --- |
| `APP_URL` | Public HTTPS URL of this app (your tunnel in development) |
| `DATABASE_URL` | PostgreSQL connection string |
| `ENCRYPTION_KEY` | 32 random bytes, base64 — encrypts stored OAuth tokens |
| `APP_SECRET` | Any long random string — signs OAuth state tokens |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | From your Partner dashboard |
| `SHOPIFY_SCOPES` | Must match `shopify.app.toml` |
| `SHOPIFY_API_VERSION` | `2026-07` (current stable) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `<APP_URL>/api/auth/google/callback` |
| `JOB_RUNNER_SECRET` | Shared secret for the cron endpoint |
| `SMTP_URL` | Optional. Without it the app works fully, minus outbound email |

In the Google Cloud console, add `<APP_URL>/api/auth/google/callback` as an authorized redirect URI.

### 4. Database

```bash
npx prisma migrate deploy
npx prisma generate
```

For development, `npx prisma migrate dev` creates and applies migrations as the schema changes.

### 5. Run

```bash
npm run dev
```

Background work needs one of these:

```bash
npm run worker      # long-running worker: claims and runs queued jobs
npm run scheduler   # queues jobs whose schedule is due
```

On a serverless host, skip both and point a one-minute cron at:

```
POST /api/jobs/run
Authorization: Bearer <JOB_RUNNER_SECRET>
```

That endpoint sweeps due schedules and drains the queue in the same call.

### 6. Install on a store

```bash
shopify app config link     # links shopify.app.toml to your app
shopify app dev
```

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

- [ ] `DATABASE_URL` points at a Postgres with connection pooling
- [ ] `npx prisma migrate deploy` has run
- [ ] `ENCRYPTION_KEY` is stored in a secret manager, not in the repo
- [ ] `APP_URL` matches `application_url` in `shopify.app.toml`
- [ ] Webhooks deployed with `shopify app deploy`
- [ ] A worker process is running, or cron hits `/api/jobs/run` every minute
- [ ] `/api/health` returns 200
