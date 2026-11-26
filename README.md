# Hello Fresh Trash

A web app for cataloguing your HelloFresh recipe cards. Upload a PDF recipe card, search by ingredient, and build a shopping list from the recipes you want to cook.

Installable on your phone home screen like a native app.

**Live app:** https://hello-fresh-trash-app.vercel.app/

---

## Contents

- [Architecture](#architecture)
  - [Where Things Live](#where-things-live)
  - [Presentation Layer](#presentation-layer)
  - [Routing Layer](#routing-layer)
  - [Build & Deployment Layer](#build--deployment-layer)
  - [Backend & Data Layer](#backend--data-layer)
  - [Security](#security)
- [Database Schema](#database-schema)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)
- [Backlog](#backlog)
- [Development](#development)

---

## Architecture

### Where Things Live

The app uses three platforms, each with a different job:

| Platform | Job | What lives here |
|---|---|---|
| **GitHub** | Source control and CI/CD | The code, git history, pull requests, and GitHub Actions workflows that trigger deploys |
| **Vercel** | Frontend hosting | The compiled app that users visit. Every PR gets a preview URL. Merging to `main` updates the live site. |
| **Supabase (prod)** | Production backend | Real user accounts, real data. Connected only to production Vercel deploys. Region: West EU (Ireland). |
| **Supabase (preview)** | Preview backend | Isolated environment for PR previews and local dev. No real data — safe to wipe. Region: West EU (Ireland). |

GitHub is where you *build* the app, Vercel is where users *visit* the app, and Supabase is where the app *stores its data*.

These platforms are independent — GitHub Actions is the glue that connects them: it calls the Vercel CLI to deploy the frontend, and the Supabase CLI to deploy edge functions and run database migrations.

---

The app itself is split into four layers. Each layer has one job and can be updated independently.

```
┌─────────────────────────────────────────┐
│              Presentation               │  What the user sees and interacts with
├─────────────────────────────────────────┤
│               Routing                   │  Which page to show
├─────────────────────────────────────────┤
│           Build & Deployment            │  How code gets built and shipped
├─────────────────────────────────────────┤
│           Backend & Data                │  Where data lives
└─────────────────────────────────────────┘
```

---

### Presentation Layer

| Technology | Responsible for |
|---|---|
| **React** | Structure, logic, state |
| **Tailwind CSS** | Visual styling — utility classes applied directly in JSX. Colours come from CSS variables in `src/index.css`: the Espresso & saffron design, light mode (default) in `:root` and dark mode in `.dark`, switched with the Light/Dark button in the header (or in Settings). Use the semantic classes, not fixed colours like `text-green-500`, so both modes work: `primary` (saffron) is a fill for actions such as Upload and Link, always with `primary-foreground` text on it; where saffron is the text colour (links, icons) use `text-primary-text`, which is darkened in light mode; `secondary` (sage) for chosen or good states such as recipes in this week's list, ingredient filter chips and "Linked"; `badge` (sage) for counts; `header` / `header-foreground` / `header-title` for the app bar |
| **shadcn/ui** | Pre-built components (`src/components/ui/`) — Button, Card, Input, Sheet, and more |
| **lucide-react** | Icons |
| **Fontsource** | Fonts bundled with the app (no Google Fonts requests): Inter for text (`font-sans`), Bricolage Grotesque for headings (`font-display`, applied to h1–h3) — imported in `src/main.jsx` |

---

### Routing Layer

**React Router v7** handles navigation between pages entirely in the browser — no page reloads. Uses `BrowserRouter` mode (`/recipes`) because Vercel redirects unknown paths to `index.html`, allowing clean URLs.

---

### Build & Deployment Layer

| Technology | Role |
|---|---|
| **npm** | Package manager. Installs and manages all third-party libraries. |
| **Vite** | Build tool and local dev server. Compiles JSX and serves the app locally. `npm run build` compiles everything into `dist/` for deployment. |
| **GitHub Actions** | CI/CD pipeline. Ten workflows cover frontend, database migration, and edge function deploys (each split into preview/production), preview migration cleanup, dependency bump checks, unit tests on every PR, and secret scanning. |
| **Vercel CLI** | The tool GitHub Actions uses to build and deploy to Vercel. All output is logged in GitHub Actions — no Vercel dashboard needed to debug failures. |
| **Vercel** | Frontend hosting. Supports private repositories, provides a preview URL for every PR, and serves clean `/recipes` style URLs. |
| **Dependabot** | Automated dependency updates. Once a month, opens one grouped PR each for npm and GitHub Actions minor/patch bumps. Every major bump gets its own PR so breaking changes stand out. Security fixes arrive immediately, outside this schedule (requires **Dependabot security updates** enabled in repo settings). |

#### GitHub Actions workflows

| Workflow | Triggers on | What it does |
|---|---|---|
| `deploy-frontend-preview.yml` | Human PRs to `main` | Vercel preview build and deploy. Preview URL posted as PR comment. |
| `deploy-frontend-prod.yml` | Pushes to `main` | Vercel production build and deploy. |
| `dependabot-build.yml` | Dependabot PRs only | Build check with no secrets. Confirms the bump doesn't break the build. |
| `test.yml` | All PRs to `main`, including Dependabot | Runs `npm test` (Vitest) with no secrets. A required status check on `main`, so a failing test blocks the merge. |
| `secret-scan.yml` | All PRs to `main`, pushes to `main`, and manual runs | Scans commits for API keys and tokens with gitleaks (read-only, no secrets). A manual run (Actions → Secret Scan → Run workflow) scans the whole history. |
| `deploy-migrations-preview.yml` | PRs touching `supabase/migrations/**` | `supabase db push` to the preview Supabase project. |
| `deploy-migrations-prod.yml` | Pushes to `main` touching `supabase/migrations/**` | `supabase db push` to the production Supabase project. |
| `cleanup-migrations-preview.yml` | PRs touching `supabase/migrations/**` closed **without** merging | Removes that PR's migrations from the preview project's history table so they don't block later PRs. See [Preview drift](#preview-drift). |
| `deploy-functions-preview.yml` | PRs touching `supabase/functions/**` | Deploys edge functions to the preview Supabase project. |
| `deploy-functions-prod.yml` | Pushes to `main` touching `supabase/functions/**` | Deploys edge functions to the production Supabase project. |

> **Migration CI:** `deploy-migrations-preview.yml` / `deploy-migrations-prod.yml` track applied migrations by filename and never re-run the same file twice. Any migrations applied manually before CI was set up must be registered in the tracking table via the Supabase dashboard SQL editor. After that, CI owns migrations — do not apply migration files manually.

> **Supabase CLI version:** the Supabase workflows install the newest **2.x** CLI on every run, so minor and patch releases are picked up automatically. A 3.0 is never picked up until someone changes `supabase@2` in the workflows.

#### Preview drift

There is one shared preview database, and PRs push their migrations to it **before** they merge. So preview can end up holding changes that never reach production.

The failure that matters: `supabase db push` refuses to run if the database has a migration in its history that the branch doesn't have. One abandoned PR's migration therefore blocks the migrations of **every later PR**, with the error *"Remote migration versions not found in local migrations directory."*

`cleanup-migrations-preview.yml` handles the common case. When a PR that added migration files is closed without merging, it marks those versions as reverted on preview (`supabase migration repair --status reverted`), which removes the blocking history rows.

**What it does not do:**

- **Undo schema changes.** Columns, tables and policies the abandoned migration created stay in preview as unused leftovers. They don't block anything. A later migration that creates something with the **same name** will fail on preview until the leftover is dropped by hand.
- **Catch renamed or deleted migrations inside an open PR.** It only sees the PR's final files. If a migration was pushed to preview and then renamed or removed before the PR closed, the old version stays on preview. **Rule: once a migration has run on preview, never rename or edit it — add a new migration instead.**
- **Let two PRs with migrations coexist.** While one open PR's migration is on preview, other PRs' `db push` is blocked until it merges or closes.
- **Clean up edge functions.** PRs also deploy their edge functions to preview, and nothing redeploys `main`'s version when a PR is abandoned.

For manual recovery, see [CONTRIBUTING.md → Recovery: preview migrations blocked](CONTRIBUTING.md#recovery-preview-migrations-blocked).

The standard fix for all of this is a throwaway database per PR (Supabase Branching, Pro plan). This workaround is fine while there's roughly one migration PR open at a time.

---

### Backend & Data Layer

| Technology | Role |
|---|---|
| **Supabase Auth** | User authentication. Google OAuth with email allowlist enforced at the database level. Sessions managed by the Supabase JS client and stored in localStorage. |
| **Supabase Database** | Postgres database hosted by Supabase. Stores recipes, ingredients, and shopping lists. Schema defined in `supabase/migrations/` and deployed automatically by CI. Row Level Security enabled on all tables. |
| **Supabase Storage** | File storage for uploaded recipe PDFs. |
| **Supabase Edge Functions** | Serverless functions running on Deno. Three functions handle the parsing pipeline: `parse-recipe` sends uploaded PDFs to Gemini and writes results to the database; `retry-parse` resets failed recipes for re-processing; `cleanup-recipes` runs hourly to remove stale records. |
| **Gemini 3.5 Flash-Lite** | Google AI model used inside `parse-recipe` (switched from Gemini 2.5 Flash, which Google no longer serves to newly created API projects) to extract recipe name, ingredients, steps, and metadata from uploaded PDFs. The PDF is sent as a base64-encoded inline attachment. Handles dual-quantity HelloFresh ingredient formats (e.g. "4 oz \| 8 oz") by always extracting the first/base quantity and setting `servings` from the corresponding column header. The source PDF can be in any language — Gemini translates every extracted field into English as part of parsing (except `source_name`, kept as written), so recipe name, ingredients, and steps always end up stored and displayed in English regardless of the original language. Count-only kit items get a shoppable unit ("Cannellini Beans 1" → 1 can; stock concentrate → stock cube; sauces → jar), and steps are rewritten concisely in the model's own words, prioritising cut size, heat level, cooking time and what "done" looks like, without merging or splitting steps (step photos are matched by position). Changes to these rules only apply to recipes parsed afterwards; use admin re-parse for existing ones. |

---

### Security

**This is a public GitHub repository.** Every PR generates a Vercel preview URL that is publicly accessible. The security model is designed around this constraint.

#### Two Supabase projects — preview isolation

| Environment | Supabase project | Connected to |
|---|---|---|
| Production | `hello-fresh-trash` | Vercel Production deploys only (`main` branch) |
| Preview | `hello-fresh-trash-preview` | Vercel Preview deploys (PRs) and local dev |

Vercel scopes `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON` separately per environment — same variable names, different values injected at build time. If a preview URL is shared or indexed publicly, it connects to the preview Supabase project which holds no real user data.

Local development always points at the preview project via `.env`. Production credentials exist only in Vercel and are never in code or `.env`.

#### Deny-by-default database access

Row Level Security (RLS) is enabled on every table the moment it is created. With no policy, access is denied to everyone — including authenticated users. Policies only open access for the operations a feature explicitly needs.

The email allowlist is enforced at two layers:
1. **Database trigger** — a `BEFORE INSERT` trigger on `auth.users` rejects the signup entirely if the email is not in `allowed_emails`. No account is created.
2. **Client-side check** — `AuthContext` signs out any authenticated session where the email is not on the list.

The Supabase anon key is the only credential the browser ever sees. The service role key (which bypasses RLS) exists only as a Supabase-managed secret inside Edge Functions and never touches the frontend.

#### Keeping secrets out of the repo

- **Push protection** (GitHub repo Settings → Code security) blocks a push that contains a recognised API key or token, before it reaches GitHub.
- **`secret-scan.yml`** runs gitleaks on every PR and on `main` as a second line of defence, including generic-looking keys GitHub's list may miss.
- If a key is ever pushed, **rotate it at the provider first** (create a new key, delete the old one); removing the commit is not enough, because a public repo may already have been copied.

#### Edge Function secrets for the AH link

Set per Supabase project with `npx supabase secrets set NAME=value --project-ref <ref>` (never in GitHub secrets, `.env` or code):

| Secret | Preview | Production |
|---|---|---|
| `RETAILER_TOKEN_KEY_V1` | Its own random key (`openssl rand -base64 32`) | A **different** random key. Backup copy in the shared password manager — losing it means every household re-links AH |
| `APP_ENVIRONMENT` | Not set (preview uses the fake AH adapter) | `production` |
| `RETAILER_AH_MODE` | Not set (fake AH). `real` only during a short test window; unlink and unset straight after ([ADR 0004](docs/adr/0004-retailer-adapter.md) has the guardrails) | Not needed (production always uses the real AH) |
| `RETAILER_AH_ENABLED` | `true` during a real-AH test window; otherwise not needed | `true` lets the app call AH; anything else is the kill switch |

Rotation: add `RETAILER_TOKEN_KEY_V2`, re-wrap the data keys, then remove V1 ([ADR 0003](docs/adr/0003-retailer-token-handling.md)).

#### Data location

Both Supabase projects (production and preview) run in **West EU (Ireland)**, so the database, storage and Edge Functions stay in the EU. Vercel and Gemini are processors outside Supabase — see `docs/privacy/record-of-processing.md`.

---

## Database Schema

All tables have RLS enabled. Migrations live in `supabase/migrations/` and are deployed automatically by `deploy-migrations-preview.yml` / `deploy-migrations-prod.yml`.

| Table | Purpose |
|---|---|
| `allowed_emails` | Email allowlist — signups rejected at DB level if email not present |
| `profiles` | Display name and avatar URL per user, synced from Google OAuth on first login; also stores each user's display-unit preferences (`temperature_unit`, `volume_unit`, `mass_unit`). Signed-in users can read every column except `email` (column privileges, 20261121000003) and change only their own unit preferences; a new column must be added to those grants |
| `user_roles` | `is_admin` flag per user — grants delete-any-recipe in the UI |
| `recipes` | One row per uploaded PDF; status machine: `pending` → `processing` → `ready` / `failed` / `rejected`; includes parsed fields like `cook_time_minutes`, `difficulty`, `cuisine`, `protein_source` (Chicken/Beef/Pork/Turkey/Seafood/Vegetarian/Other/null), and per-serving nutrition (`calories_kcal`, `fat_g`, `saturated_fat_g`, `carbs_g`, `sugar_g`, `fibre_g`, `protein_g`, `salt_g` — all nullable; copied from the card when printed, otherwise estimated by Gemini from the ingredient list, with the estimated field names listed in `nutrition_estimated`) `source_url` (added 22 Nov, docs/adr/0009): the https page a link recipe came from; a link recipe has no `storage_path` (every recipe has one or the other); `page_images` (added 25 Nov): storage paths of up to 6 "Photos from the page" for a link recipe |
| `ingredients` | One row per ingredient per recipe; written by `parse-recipe` edge function only; CASCADE deleted when recipe is deleted |
| `recipe_step_images` | One row per matched step photo (`step_index` + `storage_path`); extracted client-side from the PDF's steps page at upload time, independently of parsing; CASCADE deleted when recipe is deleted; for link recipes written by parse-recipe (HelloFresh.com step photos or schema.org HowToStep images), steps may have no row |
| `household_recipe_picks` | One row per recipe a household has picked (`servings`, `added_by`). Members read and write through `private.is_household_member()`. This is the shopping list the app reads and writes, one row at a time, so two members can't overwrite each other. See [ADR 0001](docs/adr/0001-household-ownership.md) |
| `household_list_adjustments` | One row per quantity tweak or checked-off item on a household's merged list (`item_key` from `ingredientMerge.js`, `buy_qty`; 0 = checked off). Same access rules as `household_recipe_picks` |
| `app_config` | Key/value config for environment-specific settings; service role only |
| `households` | A shared home that owns shopping data (staples, mappings, AH link, weekly runs). Settings: `time_zone`, `run_weekday`, `run_hour`, `automation_enabled`, `ah_enabled` (admin-only feature switch that hides all AH features when off) and `send_enabled` (admin-only, off by default: lets the retailer-send function write to the household's AH list, after the dry run). Created via `create_household()`; every existing user got one from `private.ensure_households()`, which can be re-run safely. See [ADR 0001](docs/adr/0001-household-ownership.md) |
| `household_staples` | Things a household buys regularly (rollout phase 4): `name`, a pinned product (`retailer` + `product_external_id`) or a `search_term` the planner resolves each week, `quantity`, `cadence_weeks`, `perishable` / `max_weeks_stock` (stock up on bonus, non-perishables only), `skip_next`, `active`, and the planner's `last_added_on` / `covered_until`. Columns match the planner in `src/lib/staples.js` / `stockup.js`. Members read and write through `private.is_household_member()`; deleted with the household |
| `household_ingredient_mappings` | What a household buys for a recipe ingredient (rollout phase 4): one row per household and `ingredient_key` (the shopping list's merged name, from `ingredientKey()` in `src/lib/ingredientMerge.js`), holding either a product from the product cache (`retailer` + `product_external_id`) or `pantry` = always at home, never both. `label` keeps the name as shown. The week preview turns mapped ingredients into product lines in whole packs and leaves pantry ones off. Members read and write through `private.is_household_member()`; deleted with the household | `amount_rule` (added 21 Nov): how many packs a mapped product gets — `auto` (compare the amount with the pack, the default), `per_recipe` (one per recipe using it) or `per_week` (one for the week).
| _retention_ | `private.run_retention()` runs nightly at 03:17 UTC via pg_cron (job `hft-retention`, migration 20261121000004): deletes weekly runs and their lines after 12 weeks, audit events after 12 months, data requests 3 years after completion, and unused (expired or revoked) invites; logs a `retention.purged` audit event with counts only |
| `recipe_swaps` | Protein swap options Gemini suggested for a recipe (docs/adr/0010): per recipe and direction (`to_vegetarian` / `to_meat`), in batches of 3–4 (`batch`, `position`); `title`, `summary`, `changes` (portion or shared, replaces, add), `steps_all`, `steps_half`. Written only by suggest-swaps; signed-in users read. `household_recipe_picks.swap_id` / `swap_mode` ('all' or 'half') hold the swap chosen for this week's pick (FK includes the recipe; deleting the swap returns the pick to the original) |
| `invites` | Social (docs/adr/0008): someone invited by email. `create_invite()` (5 per inviter per 24 h, not for existing users), `revoke_invite()`. A valid invite (30 days) passes the allowlist check; on first sign-in it is used, the email joins `allowed_emails` and inviter and invitee become friends (`private.use_invites_on_signup` trigger). Unused invites are deleted once expired or revoked. Inviters and admins read |
| `friend_requests` / `friendships` | Social: `request_friend(email)` (asking back accepts), `answer_friend_request()`, `remove_friend()`. Friendships are one row each way; people read their own rows |
| `recipe_shares` | Social: `share_recipe(recipe, friends[], note)` recommends a ready recipe to friends (note up to 280 characters; re-sharing replaces it), `mark_shares_seen()`. Sender and recipient read and can delete |
| `household_weekly_runs` | One row per send to AH (rollout phase 6; `mode` manual now, scheduled in phase 7): `week_start`, `started_by`, `status` (running / done / partial / failed), counts, `error_code`. Only one running send per household (partial unique index); a run left running for 10 minutes is closed as stale by the next send. Members read; only retailer-send writes. Kept 12 weeks (deleted nightly by private.run_retention, pg_cron); deleted with the household |
| `household_run_lines` | What each send did per line: product or free text, action (add / increase / untick, or none when the list already had enough), quantities, sources, outcome and error code (never AH's own text). Members read through the run's household; only retailer-send writes |
| `retailer_products` | Product cache: AH products seen in a search (`title`, `sales_unit_size`, last `price`, `orderable`, `image_url` (the 200 px AH photo; only `https://static.ah.nl/` URLs, kept when a later search has none), `last_seen_at`), keyed by (`retailer`, `external_id`). No owner and no personal data: signed-in users read, only the `retailer-products` function writes |
| `household_members` | Links users to a household with `role` = `owner` / `member`; a user belongs to at most one household |

### Private schema

The `private` schema is not exposed through the Supabase API, so the browser cannot query it even with a valid session. Edge Functions reach it through a direct Postgres connection. RLS is enabled on every table with no policies. See [ADR 0002](docs/adr/0002-private-schema.md).

| Table / function | Purpose |
|---|---|
| `private.audit_events` | Append-only log of security-relevant actions (e.g. `household.created`). No shopping contents, no tokens. Identifiers are cleared, not the event, when a user or household is deleted. Rows cannot be edited, and can only be deleted once older than 12 months (retention purge) |
| `private.retailer_accounts` | One row per (household, retailer) linked account (`UNIQUE (household_id, retailer)`, [ADR 0006](docs/adr/0006-one-account-per-retailer.md)). Holds only the envelope-encrypted refresh token (`token_ciphertext`/`token_iv`, `wrapped_key`/`wrapped_key_iv`, `key_version`; see `supabase/functions/_shared/tokenCrypto.ts` and [ADR 0003](docs/adr/0003-retailer-token-handling.md)) plus `status` (`linked` / `relink_needed`), `token_version`, `linked_by`, `last_refresh_at`. Access tokens are never stored ([ADR 0007](docs/adr/0007-access-tokens-never-stored.md)). No browser access; deleted with its household |
| `private.data_requests` | Log of GDPR requests: type, dates, outcome, handled by. No request contents. See [data-requests.md](docs/privacy/data-requests.md) |
| `private.is_household_member()` / `is_household_owner()` | Membership checks called by every household-owned table's RLS policies |

### recipes status machine

| Status | Meaning |
|---|---|
| `pending` | Uploaded, waiting for parse-recipe to claim it |
| `processing` | Claimed by parse-recipe; Gemini call in progress |
| `ready` | Parsed successfully; visible in the shared gallery |
| `failed` | Parsing failed; uploader can retry up to 3 times |
| `rejected` | Duplicate detected (matching content hash, ingredient fingerprint, or name) |

### Key relationships

- `profiles.temperature_unit` / `volume_unit` / `mass_unit` — per-user display preferences only (`F`/`C`, `us`/`metric` each independently); stored ingredient quantities/units and step text are never rewritten, conversion happens client-side at render time — see `src/lib/units.js`. Covered by the existing profile RLS policies (same row, no new policy needed).
- `recipes.cover_path` — storage path of the recipe's cover thumbnail (`covers/<user-id>/<uuid>.jpg` in the `recipe-pdfs` bucket), or `null` if none was generated. Rendered client-side from PDF page 1 — see `src/lib/pdfCover.js`.
- `recipe_step_images.recipe_id` → `recipes.id` (CASCADE DELETE) — per-step photos, one row per matched step, stored under `steps/<user-id>/<uuid>/<index>.jpg` in the `recipe-pdfs` bucket. Rendered client-side from the PDF's steps page — see `src/lib/pdfStepImages.js`. Only shown in the UI when the row count exactly matches the recipe's parsed step count (extraction and parsing run independently — see `src/hooks/useRecipeStepImages.js`).
- `recipes.uploaded_by` → `auth.users.id`
- `ingredients.recipe_id` → `recipes.id` (CASCADE DELETE)
- `household_recipe_picks.household_id` / `household_list_adjustments.household_id` → `households.id` (CASCADE DELETE); `household_recipe_picks.recipe_id` → `recipes.id` (CASCADE DELETE). Read and written directly by household members (RLS), one row per change. `public.ensure_my_household()` returns the caller's household id and creates a household for users who don't have one yet; the app calls it before reading the list. The old per-user `shopping_lists` table and `sync_household_shopping_list()` were dropped in step 3 (migration 20261121000005).
- `household_members.household_id` → `households.id` (CASCADE DELETE); `household_members.user_id` → `auth.users.id` (CASCADE DELETE, UNIQUE — one household per user). When the last member is removed, a trigger deletes the household.
- `private.audit_events.household_id` / `actor_id` → SET NULL on delete, so the event survives erasure without identifying anyone.

---

## Project Structure

```text
src/
├── components/
│   ├── ui/                  # shadcn/ui base components (Button, Card, Input, Sheet, Tabs, Tooltip, …)
│   ├── ProtectedRoute       # redirects unauthenticated users to login
│   ├── AppShell             # layout for signed-in pages: header (logo and title, the Recipes / Shopping / Automated ordering / Social tabs as pills from 1024 px wide, Light/Dark button, upload, round cart with count, account menu) and a bottom tab bar below 1024 px; the Social tab shows a count of unseen shares; holds the shared shopping list and passes it to pages through the router outlet
│   ├── StaplesCard          # Staples on the Automated ordering tab: list grouped by aisle like the Shopping tab (by staple name), with a one-line summary (describeStaple), add / edit form with AH product search on submit (pin a product, or keep a search term), quantity, every N weeks, stock up on bonus up to N weeks; skip next, pause / resume, remove with a confirm. Shown only when the household's ah_enabled switch is on
│   ├── SharePanel           # "Share" on the recipe page: pick friends, optional note (280 characters, checkShareNote), share; only the recipe and its PDF are shared
│   ├── SwapProteinSection   # "Swap protein" on the recipe page (ADR 0010): Original / All vegetarian (or All with meat) / Half & half, Gemini's saved options for the recipe as choices (the first is picked straight away) and Suggest other options; the parent applies the swap to the ingredients and steps and saves it on this week's pick
│   ├── SuggestMappingsPanel # "Suggest AH products" in the week preview: looks up every recipe ingredient still free text (retailer-products, one at a time, at most 15), suggests a product per ingredient (src/lib/mappingSuggestions.js), then Accept / Pick another / At home / Skip and "Accept N good matches"; only accepted ones are saved, as normal ingredient mappings; "Look up the next N" moves on to ingredients no batch has looked at; searches use mode: 'suggest', where retailer-products asks Gemini with Google Search grounding for AH's own Dutch name (findAhNameWithSearch in _shared/translateSearch.ts), falling back to the plain translation
│   ├── WeekPreviewCard      # "This week's preview" on the Automated ordering tab (rollout phase 5): a Preview / Refresh button, then what would change on the AH list, grouped by aisle like the Shopping tab (add / increase / untick, with pack size, bonus and where it comes from), what is already on it (each line with its photo; recipe lines still free text on the AH list get a Map button too), ingredients left off because they are always at home, staples not included and why, and what needs a look (a staple without a product, a mapped ingredient whose pack count couldn't be worked out). Recipe lines that are still free text have a Map action (IngredientMapForm); mapped product lines and always-at-home entries name their ingredient and have Undo mapping. Mapping and undoing update the preview at once, without asking AH again. Sends nothing by itself; SendToAhPanel at the bottom sends it after a confirmation. Shown only when the household's ah_enabled switch is on; each line shows the recipes it is for and its price ("2 × €1.29 · €2.58"), and an Estimated cost box gives Adding, Already on your AH list and the estimated total for this order
│   ├── SendToAhPanel        # "Send to AH list" under the preview (rollout phase 6): only for the household owner once send_enabled is on (others see why not); confirmation step, then per line what was changed on AH, what was already there and what failed; lines above 20 packs are left out and named
│   ├── IngredientMapForm    # maps one recipe ingredient from a preview line: AH product search (pre-filled with the ingredient name, on submit), pick a product or "Always have at home"; saves on the pick, and the confirmation toast offers Undo
│   ├── MappedIngredientsCard # "Mapped ingredients" on the Automated ordering tab: the household's mappings (describeMapping), each product mapping with a "how much to buy" picker (AMOUNT_RULE_OPTIONS), with remove behind a confirm. Shown only when the household's ah_enabled switch is on
│   ├── ProductThumb         # small AH product photo (the product cache's image_url) or a placeholder; lazy, no referrer, falls back on load errors. Shown at 80 px while choosing a product (AH search results when mapping an ingredient or pinning a staple, open suggested products) and 40 px once chosen. Used in AH search results, staple rows, mapped ingredients and preview lines
│   ├── AlbertHeijnCard      # link / unlink an Albert Heijn account: status, step-by-step desktop link flow with a paste box (shown only when the household's ah_enabled switch is on; unlink always available)
│   ├── RecipeCatalogue      # gallery of all ready recipes, filtered by All / My / Friends' recipes (src/lib/recipeFilter.js; Friends' uses useFriendIds() from the Social tab's friendships; remembered per device); filter pills, Gallery / List switch and a heading such as "7 recipes with garlic"; cards show the cover, name, uploader, time · servings · calories (src/lib/recipeCard.js) and a WeekListButton; queued, failed and duplicate uploads get dashed tiles; clicking a card opens the preview panel; uploaders can delete their own through RecipeDeleteMenu; Equipment chips (only tags in use) narrow the ready recipes to those using every chosen tag
│   ├── RecipeDeleteMenu     # "⋯" menu → Delete recipe… → confirmation (covers the card, or inline in a list row), so one stray click can't delete a recipe
│   ├── RecipeTable          # sortable list-view alternative to the gallery (name, cook/prep time, difficulty, cuisine, protein, equipment, and nutrition columns); AI-estimated nutrition values show as ~value with a sparkle icon, tooltip, and a legend under the table; sort config and comparison logic live in src/lib/recipeSort.js
│   ├── ShoppingListPanel    # the Shopping tab: "This week" page, two columns on desktop (stacked on phones) — recipe cards with cover, the chosen protein swap, servings stepper (reset to the card's servings) and Scale by ingredient, and the list as one card per aisle (src/lib/aisles.js) with a tick box, the recipe(s) each item is for, the amount and a pencil to change it; ticked items in a dashed "Already have" card with Clear ticked; Copy for Reminders and Send to AH (links to the Automated ordering tab) beside the heading; recipe servings steppers (or scale by a target amount of one ingredient instead), merged ingredient list with per-item quantity controls, persists to the household tables via useShoppingList
│   ├── PDFUploader          # "Add recipe" in the header: a menu with PDF files (useUploadQueue, as before) or Paste a link (checkRecipeUrl from supabase/functions/_shared/recipeLink.ts, then a recipes row with source_url and no PDF; parse-recipe reads the page, ADR 0009)
│   ├── UploadQueue          # per-file progress list shown during batch upload; closes itself 4 s after a fully successful batch, stays open (with Clear) when anything failed
│   ├── RecipePreviewPanel   # full-page recipe view in the Recipes tab (the gallery stays mounted behind it; "All recipes" or Esc goes back; other tabs open a recipe with navigate('/recipes', { state: { openRecipeId } })): cover, cuisine · protein, uploader, prep/cook/serves/difficulty, Add to this week and Share (SharePanel) buttons Swap protein (SwapProteinSection; saved on the household's pick when the recipe is in this week's list, otherwise added with the recipe), and nutrition per serving (~ for estimates; noted as for the original recipe when swapped); Instructions tab (scale by servings with −/+ or by an amount of one ingredient, ingredients in two columns (swap and half labels on swapped rows), numbered steps with per-step photos when available; amounts in the step text scale and follow the unit preference) and Original PDF tab (signed URL in an iframe) for PDF recipes, or "From <site>" and an Original page link for link recipes; link recipes get step photos when the site gives one per step (steps without one show none) and a "Photos from the page" strip under the steps otherwise (recipes.page_images, each opens full size)
│   ├── UserMenu             # avatar dropdown with sign-out, admin toggle, independent display-unit toggles (temperature, volume, mass), and a link to Settings
│   ├── WeekListButton       # round basket button that adds a recipe to (or removes it from) this week's list; used by gallery cards and list rows
│   └── IngredientSearch     # ingredient typeahead with the chosen ingredients as chips inside the field; remove with the chip's × or Backspace
├── context/
│   └── AuthContext          # session state, allowlist check, signOut, adminMode, unitPrefs (fetched from profiles, updated via updateUnitPref)
├── hooks/
│   ├── useUploadQueue.js      # upload orchestration: validation, deduplication, concurrent uploads, rate limiting
│   ├── useShoppingList.js     # the household's shared shopping list: useReducer state for recipe selections (with any protein swap; setSwap(), addRecipeWithSwap()) + adjusted quantities, read from household_recipe_picks / household_list_adjustments; debounced save sends only the rows that changed (src/lib/householdList.js); fetches again when the tab gets focus so one member sees the other's changes
│   ├── useSocial.js         # useSocial(): friends, friend requests both ways and sent invites (with names and pictures), actions through the Social database functions with readable errors (socialErrorMessage); useFriendIds() for the Friends' recipes filter
│   ├── useShares.js         # useSharedWithMe() (shares to me with recipe, cover and sender; markSeen, remove), shareRecipe() (share_recipe RPC, readable errors), useUnseenShareCount() for the Social tab's badge (re-checked on page change, focus and after marking seen)
│   ├── useIngredientSearch.js # useIngredientSuggestions() — debounced typeahead over stored canonical_name/name values;
│   ├── useNewVersionNotice.jsx # checks /index.html every 5 min and when the tab comes back; shows a "new version · Reload" toast; lazyPage() shows it instead of crashing when a page file is gone (off in dev)
│   │                           # useIngredientFilter() — given selected chips, returns recipes matching ALL of them (AND)
│   ├── useRecipeIngredients.js # ingredient list for a single recipe, in display order
│   ├── useRecipeSwaps.js      # protein swaps (ADR 0010): useSwapsById() loads recipe_swaps rows for the list's picks; useRecipeSwapOptions() gets a recipe's options from suggest-swaps (load / more)
│   ├── useTheme.js            # light/dark choice for this device: keeps <html class="dark">, the theme-color meta tag and localStorage (hft-theme) in step, and every user of the hook (header button, Settings) in sync; public/theme-init.js applies the saved choice before React loads
│   ├── useStaples.js          # household staples (household_staples, with the pinned product's cached title / pack size / price / photo) — add / update / remove — and searchProducts(query) through the retailer-products function
│   ├── useWeekPreview.js      # run(): loads the household's staples and the shared list's recipes and ingredients, calls the read-only retailer-week function for the AH list and this week's staple products, and plans in the browser with buildWeekPreview(), applying the ingredient mappings passed in to the last run's inputs; only on request (each run refreshes the AH login once). send() posts toSendRequest(preview) to retailer-send; canSend needs the owner role and both switches Picks with a protein swap use the swapped ingredients.
│   ├── useIngredientMappings.js # household ingredient mappings (household_ingredient_mappings, with the mapped product's cached title / pack size / price / photo) — save (replaces an ingredient's mapping) / remove — and searchProducts(query) through the retailer-products function; loaded once on the Automated ordering tab and shared by the preview and the list
│   ├── useAhLink.js           # household ah_enabled + AH link status through the link-account function; link(pasted) / unlink(); never sees tokens
│   └── useRecipeStepImages.js  # per-step photo URLs for a single recipe, gated on an exact count match with parsed steps
├── pages/
│   ├── Login                # login screen with Google OAuth
│   ├── Recipes              # /recipes (Recipes tab): "What are you cooking tonight?" heading, ingredient search, gallery or list, preview panel, and a banner linking to Shopping and Automated ordering; /home redirects here
│   ├── Shopping             # /shopping (Shopping tab): ShoppingListPanel
│   ├── Ordering             # /ordering (Automated ordering tab): two columns on desktop — WeekPreviewCard (with SendToAhPanel) on the left; AlbertHeijnCard, StaplesCard, MappedIngredientsCard and Coming next on the right (stacked on phones)
│   ├── Social               # /social (Social tab, docs/adr/0008): Shared with you (recipes friends recommended, with their note, New labels, Open / Add to this week / remove; opening the page marks them seen), friend requests to accept or decline, friends list (remove behind a confirm), Invite a friend (email, 5 a day; the app sends no email, so after inviting and on each open invite there are Email invite (mailto) and Copy invite buttons, plus Take back) and Add a friend (email of an existing user); data and actions from useSocial() and useSharedWithMe()
│   ├── Settings             # /settings: Appearance card (Light / Dark, saved per device); AH linking moved to the Automated ordering tab
│   └── PrivacyPolicy        # GDPR privacy policy (/privacy), incl. recipe parsing (Gemini), households and the optional AH link
└── lib/
    ├── supabase.js           # Supabase client
    ├── pdfUtils.js           # computeContentHash — SHA-256 hash of PDF bytes for duplicate detection
    ├── ingredientMerge.js    # mergeIngredients() — scales by servings and merges the same ingredient across recipes even when written differently (case, spaces, plural last word, veggie/vegetable, TBSP/tsp/T); adds compatible units and shows them in the viewer's volume / mass preference like the recipe view does, never combines volume with weight, and does not use canonical_name (too broad for shopping); ingredientKey() gives the name part of a line's key, which ingredient mappings are stored under
    ├── planWeek.js            # planWeek() chains the planner: staples (stock-up, else due rules) + recipe ingredients (mapped, summed in base units, whole packs, or by the mapping's amount_rule: one per recipe / one for the week; unmapped → free text) → merged target lines, staple updates, decisions and review flags. Pure, no I/O
    ├── recipeStatus.js        # ownInProgressIds() / mergeStatusUpdates() — the catalogue's safety net for missed Realtime events: re-checks your pending/processing recipes (plus any recipe you re-parsed as admin, whoever uploaded it) every 10 s and on returning to the tab, merging only what changed; recipeCardState() decides which card each recipe gets (admins also see other users' in-progress and failed recipes, retried via admin-reparse)
    ├── scaling.js             # computeScaleFactorFromServings() / computeScaleFactorFromIngredient() — work out a scale factor from a target servings count or a target amount of one ingredient (reusing units.js's conversion table); scaleIngredients() applies it to a list for display; scaleStepText() scales the volume and weight amounts written inside an instruction step (home-supplied ingredients such as water and butter only appear there) and shows them in the viewer's units, leaving times, temperatures, sizes and counts alone
    ├── pdfCover.js            # renderPdfCoverBlob() — renders PDF page 1 to a cropped JPEG via pdf.js (its built-in JPEG 2000 decoder handles HelloFresh's cover photos)
    ├── pdfStepImages.js       # extractStepImageBlobs() — locates each step photo on the PDF's steps page by walking pdf.js's operator list (tracking the CTM through image-paint ops), crops them from one page render
    ├── listDiff.js            # mergeTargetLines() combines planner lines for the same product / free text; diffList() compares the target with the current retailer list and returns add / increase / untick changes — never removes, safe to re-run
    ├── packs.js               # parsePackSize() reads AH pack strings ("1,5 l", "2 x 125 g", "6 stuks"); ingredientToBase() converts recipe amounts to g / mL / pieces; packsNeeded() rounds up to whole packs with a 5% tolerance
    ├── staples.js             # weekStartOf(), checkStaple(), planDueStaples() — which staples are due this week (cadence in whole Mon–Sun weeks, skip_next, bonus stock cover via covered_until); dates are plain YYYY-MM-DD strings
    ├── stockup.js             # parseBonusMechanism() reads AH deal labels ("2e GRATIS", "2+1 GRATIS", "3 VOOR 5,00") into a pack group size; planStockUp() buys non-perishable staples on bonus up to max_weeks_stock, rounded to whole deals, and returns the new covered_until
    ├── units.js               # formatTemperatureText() — replaces {{temp:VALUEU}} markers in step text with the viewer's preferred unit; convertIngredientUnit() — converts an ingredient's quantity/unit to the viewer's preferred volume/mass system for display; normalizeUnit() reads a recipe unit as a measurement (capital T = tbsp, lowercase t = tsp); bestUnitInSystem() picks the display unit for an amount within one system; unitOptionsFor() lists the units an amount can be entered in and unitOptionValueFor() gives the option that stands for the recipe's own unit ("Cup" → cup), so the scale-by-ingredient dropdowns start on the right unit
    ├── aisles.js              # AISLES (incl. Household for non-food staples), aisleFor() (keyword rules for recipe ingredients and staple names, first match wins: 'garlic powder' → Herbs & spices, 'mushroom stock concentrate' → Pantry, 'green beans' → Produce), groupByAisle() for the Shopping tab and the Staples list
    ├── appVersion.js          # "a new version is available": buildIdFromHtml() (the hashed entry script in index.html), isNewVersion(), isChunkLoadError() (a lazy page file gone after a deploy)
    ├── recipeFilter.js        # RECIPE_FILTERS (all, mine, friends — friends needs the Social tab), normalizeRecipeFilter() for saved values, filterRecipes() by uploader
    ├── stapleForm.js          # STAPLE_LIMITS (match the household_staples checks), toStapleRow() turns the form into a row or per-field messages (stock up on bonus = non-perishable with a weeks limit), describeStaple() for the list
    ├── theme.js               # THEME_STORAGE_KEY, normalizeTheme() (only 'dark' means dark; anything else is light), toggleTheme(), themeColorFor() (browser bar colour per theme), themeToggleLabel() (what the header button says: the theme it switches to)
    ├── ahLink.js              # AH_LOGIN_URL, linkStatusView() (what the Settings card shows per status), checkPastedLink() (stops a paste that can't work before AH's one-time code is used), formatLinkDate()
    ├── equipment.js           # equipment tags read from a recipe's name and steps (no stored column): EQUIPMENT (Air fryer, Instant Pot, Slow cooker, Blender, Food processor, Stand mixer, Wok, Dutch oven, Cast-iron pan), detectEquipment() (whole phrases and other names: pressure cooker, Crock-Pot, stick blender…), equipmentInUse() for the gallery chips, filterByEquipment() (every chosen tag)
    ├── householdList.js       # the shared household list: toListState() turns table rows into list state (picks ordered by added_at); diffListState() gives the row writes between the saved list and the current one (add / set servings / set swap / remove pick, set / remove adjustment), dropping entries the database would reject; mergeRemote() combines a fresh fetch with changes not saved yet
    ├── weekPreview.js         # this week's preview (dry run, rollout phase 5): recipeTextLines() turns the Shopping tab's merged list into free-text lines by ingredient name (no "Already have" items; amount shown, not sent); buildWeekPreview() runs planWeek() over the household's staples (cached product, or this week's AH answer for bonus and search-term staples) and its recipe ingredients (mapped → product line in whole packs, amounts added when several ingredients share a product, with mappedFrom naming the mappings behind the line; or one pack plus a "check quantity" flag when the amount can't be compared with the pack; always at home → left off and listed in atHome; unmapped → free-text line), diffs against the current AH list and returns stapleUpdates (the planner's staple dates, tied to their product) and changes (each with its photo and its aisle: recipe lines by ingredient name, staple lines by staple name), what is already on the list, a verdict per staple (stapleReasonText()) and staples to check. Pure, never writes. toSendRequest() turns a preview into the retailer-send request: every planned line (also those already on the AH list, so their staples are marked as bought), each source once, lines above 20 packs left out with their staple dates and reported in notSent; each line carries the recipes it is for and its price per pack (staple: this week's AH price, else cached; mapped: cached), and totals estimates what the send adds, what the AH list already has and the whole order
    ├── ingredientMappings.js  # MAPPING_LIMITS (match the household_ingredient_mappings checks), toMappingRow() turns a choice on the mapping screen (a picked product, or always at home) into a row or a message, describeMapping() for the list
    ├── mappingSuggestions.js  # unmappedLines() (recipe ingredients still free text on the preview, each once, at most SUGGEST_LIMIT) and pickSuggestion() (the search result whose name has every whole word of the Dutch term, then AH's own brand, then AH's order; sure: false when no name has every word)
    ├── social.js              # Social rules checked before calling the database functions: checkInviteEmail(), inviteStatus() (pending / accepted / revoked / expired), invitesLeftToday() (5 per 24 h), checkShareNote() (280 characters), inviteMessage() (subject, body, copy text and mailto link for the invite the user sends themselves); socialErrorMessage() turns the database functions' error codes into readable text
    ├── proteinSwap.js         # protein swaps (ADR 0010): SWAP_MODES, swapModesFor() (to_vegetarian or to_meat from protein_source), applySwap() (portion changes split in Half & half; shared changes such as stock go vegetarian as soon as any serving is, but stay vegetarian when adding meat half and half; added rows marked, halved rows marked); swapIngredientsMap() applies each pick's swap to its ingredients for the Shopping tab and the AH preview
    ├── recipeCard.js          # recipeCardMeta() (total time, servings, calories with ~ for estimates), catalogueHeading() ("7 recipes with garlic and onion") and weekListNote() for the Recipes tab
    ├── recipeSort.js          # RECIPE_TABLE_COLUMNS config (name, times, difficulty, cuisine, protein, and four nutrition columns) + sortRecipes() / compareRecipesByColumn() for RecipeTable.jsx's list view — nulls always sort last in both directions; isEstimated() / formatRecipeCell() mark AI-estimated nutrition values with ~; the Equipment column is worked out from the steps (a column value(recipe), cellValue())
    └── utils.js              # cn() helper for combining Tailwind classes
└── tests/                    # Vitest unit tests for src/lib/ (run with `npm test`)
    ├── ingredientMerge.test.js # shopping-list merging: real duplicate examples, plural/synonym names, mixed units, what must stay separate; ingredientKey() for mappings
    ├── listDiff.test.js       # merging target lines, add / increase / untick rules, hand-added items left alone, re-run gives no changes
    ├── packs.test.js          # AH pack-size parsing, recipe amounts to base units, whole-pack rounding
    ├── staples.test.js        # due-staple rules: cadence, skip next, stock cover, re-run safety, week boundaries
    ├── stockup.test.js        # deal-label parsing, stock-up pack counts, existing stock, covered_until dates
    ├── planWeek.test.js       # one realistic week end to end: staples, stock-up, skipped, recipe merging, pantry, unmatched, review flags
    ├── units.test.js          # unit reading, including T vs t; the dropdown option for a recipe's own unit (0.75 cups of rice must not show as tsp)
    ├── recipeStatus.test.js   # which recipes to re-check, merging fresh statuses without needless re-renders
    ├── scaling.test.js        # scale factors from servings / a target ingredient amount, scaleIngredients(), and scaleStepText() (amounts in steps: scaling, plural units, fractions, ranges, unit preference, what is left alone)
    ├── aisles.test.js         # aisle for ~90 real ingredient names incl. the tricky ones, staple names (fruit by variety, cheeses, snacks, household items; food that only sounds like a household item stays put), case and preparation words, unknown → Other, grouping order
    ├── appVersion.test.js     # build id from index.html, new version or not, chunk load errors in each browser
    ├── recipeFilter.test.js   # filter list, saved-value fallback, all / mine / friends, no friends yet, list not changed
    ├── stapleForm.test.js     # form → row: pinned product or search term, numbers typed as text, stock-up rules, all errors at once, ranges; one-line summaries incl. paused / skipping
    ├── theme.test.js          # theme key, light fallback for unknown values, toggling, browser bar colours, header button label
    ├── ahLink.test.js         # Settings card per status (switch off, not linked, linked, relink needed; unlink always possible), paste checks, dates
    ├── equipment.test.js      # tags from steps and name, other names, whole words only, order, chips in use, AND filter
    ├── householdList.test.js  # shared list: rows to state and ordering, only changed rows are written, servings change never re-adds a removed recipe, invalid entries dropped, refetch keeps unsaved changes; picks with a protein swap
    ├── weekPreview.test.js    # week preview: recipe lines (ticked items left out, adjusted amounts, one line per name), an aisle per line (staples by their own name), product photos per line (this week's AH answer, else the product cache), the send request (toSendRequest, staple dates per product, 20-pack limit), ingredient mappings (product in whole packs, always at home, check quantity, combined with a staple for the same product, two ingredients sharing one product, which mapping a line came from, no mappings = as before), staples from cache or live lookup, bonus stock-up, missing product flagged, add / increase / untick against the AH list, hand-added items untouched, re-run gives no changes; recipes and prices per line, estimated totals
    ├── ingredientMappings.test.js # mapping rows: product or always at home (which wins), the shopping list's key with the name as shown, refusals (no choice, bad product id, no name, name too long); one-line summaries
    ├── accountLinking.test.js # login-code reading, code exchange, link (newest key, re-link replaces), refusals before the code is used, unlink always allowed, status without token data
    ├── productSearch.test.js  # staple product search: query rules, cache rows, refuses users without AH before touching the token, de-duplicates, caches everything seen, returns orderable only, survives a cache failure
    ├── mappingSuggestions.test.js # which preview lines get a suggestion (recipe text lines, once, at most 15) and which search result is suggested (whole words, AH brand, AH order, not sure)
    ├── social.test.js         # invite email checks, invite status and expiry, daily invite limit, share note length, invite message and mailto link
    ├── weekSnapshot.test.js   # week snapshot: which staples get a live lookup, list returned as it is, refusals before touching the token, bonus matched by product id, photo-only lookups last and cache-only, first orderable product for a search term, one token, repeated queries once, lookup cap, caches everything seen, survives a cache failure, no half snapshots
    ├── sendPlan.test.js       # send checks: request limits and refusals, staple-update rules, writes only where they add something (untick, raise, never lower, hand-added items untouched, re-send writes nothing), staple dates only for lines on the list afterwards
    ├── sendWeek.test.js       # one send: refusals before the token (no household, switches off, not the owner, busy), order of steps, already-on-list lines not written, partial and failed sends, staple dates only for lines on the list, AH error text kept out, run closed as failed when AH can't be read, one login
    ├── accountTokens.test.js  # single-flight refresh: rotated token saved before use and kept if the action fails, two runs at once, relink_needed on auth, other failures change nothing, no tokens in audit events
    ├── ahAdapter.test.js      # AH response checks, product photo choice and host check, list lines (never removes), kill switch, retries/backoff/timeouts, request spacing, per-line outcomes, fake adapter, adapter choice per environment
    ├── tokenCrypto.test.js    # AH token envelope encryption: round trip, wrong key / account / swapped key / tampering all fail, fresh IVs, reseal after rotation, V1 → V2 key rotation
    ├── proteinSwap.test.js    # swap modes per recipe; applySwap all / half both directions, shared-ingredient rule, ordering, matching, add-only and remove-only changes, unknown amounts; swapIngredientsMap
    ├── swapOptions.test.js    # the swap prompt (shared-ingredient rules per direction, options to avoid) and the check of Gemini's reply
    ├── recipeLink.test.js     # link checks and tidying, private addresses, ISO durations, Recipe data extraction (graph, lists, step shapes, images, HTML), page text, recipe text for Gemini, link filename; step images, HelloFresh step photos, photos from the page
    └── recipeSort.test.js     # sortRecipes() / compareRecipesByColumn() — ascending/descending, nulls last, 0 treated as a real value; estimate marking per field

supabase/
├── migrations/              # database schema changes (SQL) — deployed automatically via deploy-migrations-preview/prod CI; never run manually after bootstrap
├── seed.sql                 # template for seeding initial data (no real emails — swap in locally)
└── functions/
    ├── parse-recipe/        # claims pending recipe, sends the PDF — or for a link recipe the page's schema.org Recipe or text, fetched with safeFetch (else the link via url_context), and the page photo stored as the cover, plus its step photos (HelloFresh.com page data or HowToStep images, only when Gemini keeps the same steps) or up to 6 photos from the post as page_images — to Gemini 3.5 Flash-Lite, extracts structured data (handles dual-quantity HelloFresh format), tags oven temperatures inline as {{temp:VALUEU}} for unit conversion at render time, classifies protein_source into a fixed category set, gets per-serving nutrition from Gemini as two separate sets (values printed on the card, and its own estimate from the ingredients), keeps the printed value where there is one, and records every field that fell back to the estimate in nutrition_estimated (decided in code, not by Gemini; values are coerced to numbers and rounded before saving), writes ingredients + status=ready; Gemini call runs with minimal thinking, up to 75 s per attempt; when Gemini reports it is overloaded (500 / 503) it retries up to 3 more times, alternating between 3.5 Flash-Lite and 3.8 Flash with 1 s / 5 s / 15 s waits, after a timeout or 429 it retries once on the same model, and if Gemini withholds a reply for RECITATION (output too close to published text) it retries once on the other model; steps are written in Gemini's own words (same quantities, times, temperatures and order) to avoid that filter — all within a 120 s budget that keeps the function under its wall-clock limit
    ├── retry-parse/         # resets a failed recipe to pending (max 3 retries)
    ├── admin-reparse/       # admin-only; clears a ready or failed recipe (any uploader) and sets it back to pending so parse-recipe runs again
    ├── admin-set-cover/     # admin-only; sets cover_path on an existing recipe (recipes has no client UPDATE policy — see security rules)
    ├── retailer-products/   # searches the household's AH through its link (POST { query }; English works: Gemini turns it into AH's Dutch words first, see _shared/translateSearch.ts, and both are searched), caches the products in retailer_products (with their photo), returns the orderable ones with imageUrl; needs ah_enabled and a linked account; fake AH on preview
    ├── retailer-week/       # this week's AH snapshot for the preview, read-only (POST {}): the household's current AH list plus this week's product info for the staples that need a live answer (search-term staples; pinned staples that can stock up on bonus); staples are read on the server, never taken from the request; caches every product seen; needs ah_enabled and a linked account; fake AH on preview. The browser plans with it (src/lib/weekPreview.js)
    ├── retailer-send/       # sends this week's preview to the household's AH list (POST { weekStart, lines, stapleUpdates }): checks the request (sendPlan.ts), allows only the owner of a household with ah_enabled and send_enabled, one send at a time, re-reads the AH list and writes only what adds something (never removes or lowers), saves staple dates for lines on the list afterwards, records the run in household_weekly_runs / household_run_lines; fake AH on preview
    ├── link-account/        # signed-in user links / unlinks / checks their household's AH account (POST { action: 'status' | 'link' | 'unlink', pasted }); linking needs households.ah_enabled; never returns tokens
    ├── suggest-swaps/       # protein swap options (POST { recipeId, direction, more? }): saved batch, or Gemini (3.8 Flash, then Flash-Lite) for 3–4 new options checked by _shared/swapOptions.ts; limits 20 batches per recipe/direction, 40 options per user per day
    ├── cleanup-recipes/     # hourly cron; deletes failed recipes after 48 h, resets stuck processing
    └── _shared/             # code shared by functions (not deployed as a function itself)
        ├── retailer/        # retailer adapter (ADR 0004): one interface (getAccessToken, searchProducts, getPromotions, readList, writeListLines) for every retailer
        │   ├── productSearch.ts # searchRetailerProducts: query check (2–60 chars), household + ah_enabled check, search through withAccessToken, product-cache rows, orderable results only
        │   ├── weekSnapshot.ts  # getWeekSnapshot: household + ah_enabled check, then with one token refresh reads the list and looks up staples (stapleLookup: by search term, or by product title matched by id for bonus; pinned staples whose cached product has no photo get one photo-only lookup, run after the plan's lookups, that only fills the product cache), at most MAX_LOOKUPS searches, identical queries once; product-cache rows; a retailer failure fails the whole snapshot
        │   ├── sendPlan.ts    # Send to AH (phase 6) server checks: checkSendRequest (Monday week, 1–60 lines, quantity 1–20, valid ids and descriptions, no duplicates, staple updates limited to the planner's date fields and tied to a line), planWrites (against the AH list as it is now: add / increase / untick only, never lower or remove, re-send writes nothing), applicableStapleUpdates (dates only for staples whose line is on the list afterwards)
        │   ├── sendWeek.ts    # sendWeek: one send in order — request check, who may send (owner, both switches), start run (busy if one is running), read list + planWrites + write with one AH login, staple dates for lines on the list, close the run with each line's outcome (error codes only); an AH failure closes the run as failed
        │   ├── accountLinking.ts # linkAccount / unlinkAccount / getLinkStatus: checks everything before using AH's one-time login code, seals the refresh token with a new data key, replaces any old link, audits
        │   ├── pgStores.ts    # Postgres TokenStore + LinkStore over SUPABASE_DB_URL (postgres.js); the only code that touches private.retailer_accounts
        │   ├── accountTokens.ts # withAccessToken(): single-flight refresh (ADR 0003/0007) — lock the row, refresh, re-encrypt the rotated token, audit and commit before the access token is used; AH refusing the token marks the account relink_needed
        │   ├── types.ts       # retailer-neutral types + RetailerError codes (disabled, auth, http, timeout, schema, invalid, unsupported, not_linked)
        │   ├── ahSchema.ts    # checks AH responses and maps them to our types (schema error instead of wrong data); picks each product's 200 px photo, accepting only https URLs on static.ah.nl; builds list PATCH items, refusing quantity < 1 (never removes)
        │   ├── ahAdapter.ts   # real AH mobile API: timeouts, retry with backoff on 429/5xx, spaced requests, one PATCH per line, kill switch
        │   ├── fakeAdapter.ts # made-up products and an in-memory list for preview/local — never touches AH
        │   └── index.ts       # retailerAdapterFor(): real AH on production, or on preview with RETAILER_AH_MODE=real (test window, test account only); fake otherwise. With the real adapter, RETAILER_AH_ENABLED=true is the kill switch
        ├── recipeLink.ts    # link recipes (ADR 0009), pure: checkRecipeUrl, isPrivateAddress, parseIsoDuration, extractRecipeData (schema.org Recipe JSON-LD), pageText, pageImage, recipeSourceText, linkFilename; helloFreshStepImages(), pagePhotos(), step images in extractRecipeData()
        ├── swapOptions.ts   # protein swaps (ADR 0010), pure: swapPrompt() and checkSwapOptions() (valid kinds, replaced names matched to the recipe, at most 4 options)
        ├── safeFetch.ts     # fetches a pasted link or its photo without SSRF: checkRecipeUrl, every resolved address public (Deno.resolveDns or DNS-over-HTTPS), ≤3 redirects re-checked, content type and size limits, timeout
        └── tokenCrypto.ts   # envelope encryption for retailer refresh tokens (ADR 0003): sealNewToken / openToken / resealToken / rewrapDataKey, AES-256-GCM with the account id bound in; master keys from RETAILER_TOKEN_KEY_V<n>

docs/
├── adr/                     # architecture decision records — one file per decision that is expensive to reverse (see adr/README.md)
└── privacy/
    ├── record-of-processing.md # what personal data the app processes, why, where it goes, how long it is kept
    └── data-requests.md        # procedure for GDPR access, export and erasure requests

spike/
└── ah-api/                  # Albert Heijn API spike — standalone Node script, not part of the app or CI; FINDINGS.md has the results

.github/workflows/
├── deploy-frontend-preview.yml   # PR → Vercel preview deploy, posts URL as PR comment
├── deploy-frontend-prod.yml      # merge to main → Vercel production deploy
├── dependabot-build.yml          # dependabot PRs → build check only, no secrets, no deploy
├── test.yml                      # every PR to main → npm test; required check, blocks merge on failure
├── deploy-migrations-preview.yml # PR touching supabase/migrations/ → push to preview
├── deploy-migrations-prod.yml    # merge to main touching supabase/migrations/ → push to production
├── cleanup-migrations-preview.yml # PR with migrations closed unmerged → clear its history rows on preview
├── deploy-functions-preview.yml  # PR touching supabase/functions/ → deploy to preview
└── deploy-functions-prod.yml     # merge to main touching supabase/functions/ → deploy to production
```

---

## Known Limitations

- **Shared preview database** — PRs apply migrations to one shared preview project before merging, so it can drift from production and one PR's migrations can block another's. Partially automated. See [Preview drift](#preview-drift).
- **Semantic ingredient search** — current search is chip-based: typing shows a typeahead of real stored ingredient values (`ilike` over `canonical_name`/`name`), and selecting chips filters to recipes containing all of them (AND). Vector/embedding-based search (finding recipes by meaning rather than exact token match) is deferred.

---

## Backlog

- Form validation (React Hook Form + Zod)
- Error tracking (Sentry)
- Analytics (PostHog or Plausible)
- Onboarding empty states
- Lighthouse performance audit
- Avatar storage — evaluate copying Google profile photo to Supabase Storage on signup for reliable recipe attribution (assess storage cost against free tier limit before implementing)

---

## Development

For local setup, environment configuration, branch naming, PR workflow, and recovery from common mistakes, see [CONTRIBUTING.md](CONTRIBUTING.md).
