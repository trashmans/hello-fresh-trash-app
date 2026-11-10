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
| **Tailwind CSS** | Visual styling — utility classes applied directly in JSX. Colours come from CSS variables in `src/index.css`: light mode (default) uses the Tuscan Garden & Herb palette in `:root`, dark mode uses Crisp Orchard in `.dark`, switched in Settings. Use the semantic classes, not fixed colours like `text-green-500`, so both modes work: `primary` (terracotta / apple) for actions such as Upload and Link; `secondary` (rosemary / leaf green) for chosen or good states such as recipes in this week's list, ingredient filter chips and "Linked"; `badge` (tomato / honey) for counts; `header` / `header-foreground` / `header-title` for the app bar |
| **shadcn/ui** | Pre-built components (`src/components/ui/`) — Button, Card, Input, Sheet, and more |
| **lucide-react** | Icons |

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
| `APP_ENVIRONMENT` | Not set (preview always uses the fake AH adapter) | `production` |
| `RETAILER_AH_ENABLED` | Not needed | `true` lets the app call AH; anything else is the kill switch |

Rotation: add `RETAILER_TOKEN_KEY_V2`, re-wrap the data keys, then remove V1 ([ADR 0003](docs/adr/0003-retailer-token-handling.md)).

#### Data location

Both Supabase projects (production and preview) run in **West EU (Ireland)**, so the database, storage and Edge Functions stay in the EU. Vercel and Gemini are processors outside Supabase — see `docs/privacy/record-of-processing.md`.

---

## Database Schema

All tables have RLS enabled. Migrations live in `supabase/migrations/` and are deployed automatically by `deploy-migrations-preview.yml` / `deploy-migrations-prod.yml`.

| Table | Purpose |
|---|---|
| `allowed_emails` | Email allowlist — signups rejected at DB level if email not present |
| `profiles` | Display name and avatar URL per user, synced from Google OAuth on first login; also stores each user's display-unit preferences (`temperature_unit`, `volume_unit`, `mass_unit`) |
| `user_roles` | `is_admin` flag per user — grants delete-any-recipe in the UI |
| `recipes` | One row per uploaded PDF; status machine: `pending` → `processing` → `ready` / `failed` / `rejected`; includes parsed fields like `cook_time_minutes`, `difficulty`, `cuisine`, `protein_source` (Chicken/Beef/Pork/Turkey/Seafood/Vegetarian/Other/null), and per-serving nutrition (`calories_kcal`, `fat_g`, `saturated_fat_g`, `carbs_g`, `sugar_g`, `fibre_g`, `protein_g`, `salt_g` — all nullable; copied from the card when printed, otherwise estimated by Gemini from the ingredient list, with the estimated field names listed in `nutrition_estimated`) |
| `ingredients` | One row per ingredient per recipe; written by `parse-recipe` edge function only; CASCADE deleted when recipe is deleted |
| `recipe_step_images` | One row per matched step photo (`step_index` + `storage_path`); extracted client-side from the PDF's steps page at upload time, independently of parsing; CASCADE deleted when recipe is deleted |
| `shopping_lists` | One row per user; stores recipe selections (with serving sizes) and per-item quantity adjustments as JSONB; upserted on every change. Still what the app reads; being replaced by the household tables below (rollout phase 2) |
| `household_recipe_picks` | One row per recipe a household has picked (`servings`, `added_by`). Members read and write through `private.is_household_member()`. Mirrored from `shopping_lists` on every save during rollout phase 2; reads switch over in the next step. See [ADR 0001](docs/adr/0001-household-ownership.md) |
| `household_list_adjustments` | One row per quantity tweak or checked-off item on a household's merged list (`item_key` from `ingredientMerge.js`, `buy_qty`; 0 = checked off). Same access rules as `household_recipe_picks` |
| `app_config` | Key/value config for environment-specific settings; service role only |
| `households` | A shared home that owns shopping data (staples, mappings, AH link, weekly runs). Settings: `time_zone`, `run_weekday`, `run_hour`, `automation_enabled`, and `ah_enabled` (admin-only feature switch that hides all AH features when off). Created via `create_household()`; every existing user got one from `private.ensure_households()`, which can be re-run safely. See [ADR 0001](docs/adr/0001-household-ownership.md) |
| `household_staples` | Things a household buys regularly (rollout phase 4): `name`, a pinned product (`retailer` + `product_external_id`) or a `search_term` the planner resolves each week, `quantity`, `cadence_weeks`, `perishable` / `max_weeks_stock` (stock up on bonus, non-perishables only), `skip_next`, `active`, and the planner's `last_added_on` / `covered_until`. Columns match the planner in `src/lib/staples.js` / `stockup.js`. Members read and write through `private.is_household_member()`; deleted with the household |
| `retailer_products` | Product cache: AH products seen in a search (`title`, `sales_unit_size`, last `price`, `orderable`, `last_seen_at`), keyed by (`retailer`, `external_id`). No owner and no personal data: signed-in users read, only the `retailer-products` function writes |
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
- `shopping_lists.user_id` → `auth.users.id` (UNIQUE — one list per user)
- `household_recipe_picks.household_id` / `household_list_adjustments.household_id` → `households.id` (CASCADE DELETE); `household_recipe_picks.recipe_id` → `recipes.id` (CASCADE DELETE). Written through `public.sync_household_shopping_list(picks, adjustments)`, which runs as the caller (RLS applies), replaces the household's rows with the given list in one transaction, and creates a household for users who don't have one yet.
- `household_members.household_id` → `households.id` (CASCADE DELETE); `household_members.user_id` → `auth.users.id` (CASCADE DELETE, UNIQUE — one household per user). When the last member is removed, a trigger deletes the household.
- `private.audit_events.household_id` / `actor_id` → SET NULL on delete, so the event survives erasure without identifying anyone.

---

## Project Structure

```text
src/
├── components/
│   ├── ui/                  # shadcn/ui base components (Button, Card, Input, Sheet, Tabs, Tooltip, …)
│   ├── ProtectedRoute       # redirects unauthenticated users to login
│   ├── AppShell             # layout for signed-in pages: header (title, upload, cart with count, account menu), side menu on desktop and bottom tab bar on phones (Recipes, Shopping, Automated ordering, Social); holds the shared shopping list and passes it to pages through the router outlet
│   ├── AlbertHeijnCard      # link / unlink an Albert Heijn account: status, step-by-step desktop link flow with a paste box (shown only when the household's ah_enabled switch is on; unlink always available)
│   ├── RecipeCatalogue      # gallery of all ready recipes, filtered by All / My / Friends' recipes (src/lib/recipeFilter.js; Friends' is disabled until the Social tab exists; remembered per device); cart button toggles recipe into shopping list; clicking a card opens the preview panel; uploaders can delete their own through RecipeDeleteMenu
│   ├── RecipeDeleteMenu     # "⋯" menu → Delete recipe… → confirmation (covers the card, or inline in a list row), so one stray click can't delete a recipe
│   ├── RecipeTable          # sortable list-view alternative to the gallery (name, cook/prep time, difficulty, cuisine, protein, and nutrition columns); AI-estimated nutrition values show as ~value with a sparkle icon, tooltip, and a legend under the table; sort config and comparison logic live in src/lib/recipeSort.js
│   ├── ShoppingListPanel    # the Shopping tab: two columns on desktop (stacked on phones) — this week's recipes with cover thumbnails and servings steppers, and the list grouped by aisle (src/lib/aisles.js) with the recipe(s) each item is for, ticked items under "Already have", Copy for Reminders and Send to AH (links to the Automated ordering tab); recipe servings steppers (or scale by a target amount of one ingredient instead), merged ingredient list with per-item quantity controls, persists to shopping_lists via useShoppingList
│   ├── PDFUploader          # file picker UI; delegates to useUploadQueue
│   ├── UploadQueue          # per-file progress list shown during batch upload; closes itself 4 s after a fully successful batch, stays open (with Clear) when anything failed
│   ├── RecipePreviewPanel   # side panel; Instructions tab (ingredients + steps, with per-step photos when available, scalable by servings or by a target amount of one ingredient) and Original PDF tab (signed URL in an iframe)
│   ├── UserMenu             # avatar dropdown with sign-out, admin toggle, independent display-unit toggles (temperature, volume, mass), and a link to Settings
│   └── IngredientSearch     # chip-based ingredient typeahead; select suggestions, remove with the chip's × button
├── context/
│   └── AuthContext          # session state, allowlist check, signOut, adminMode, unitPrefs (fetched from profiles, updated via updateUnitPref)
├── hooks/
│   ├── useUploadQueue.js      # upload orchestration: validation, deduplication, concurrent uploads, rate limiting
│   ├── useShoppingList.js     # useReducer state for recipe selections + adjusted quantities; debounced upsert to shopping_lists, then mirrors the list into the household tables via sync_household_shopping_list() (rollout phase 2; failures only logged)
│   ├── useIngredientSearch.js # useIngredientSuggestions() — debounced typeahead over stored canonical_name/name values;
│   │                           # useIngredientFilter() — given selected chips, returns recipes matching ALL of them (AND)
│   ├── useRecipeIngredients.js # ingredient list for a single recipe, in display order
│   ├── useTheme.js            # light/dark choice for this device: keeps <html class="dark">, the theme-color meta tag and localStorage (hft-theme) in step; public/theme-init.js applies the saved choice before React loads
│   ├── useAhLink.js           # household ah_enabled + AH link status through the link-account function; link(pasted) / unlink(); never sees tokens
│   └── useRecipeStepImages.js  # per-step photo URLs for a single recipe, gated on an exact count match with parsed steps
├── pages/
│   ├── Login                # login screen with Google OAuth
│   ├── Recipes              # /recipes (Recipes tab): ingredient search, gallery or list, preview panel; /home redirects here
│   ├── Shopping             # /shopping (Shopping tab): ShoppingListPanel
│   ├── Ordering             # /ordering (Automated ordering tab): AlbertHeijnCard plus what's coming in rollout phases 4–6
│   ├── Social               # /social (Social tab): placeholder for sharing, friends and groups
│   ├── Settings             # /settings: Appearance card (Light / Dark, saved per device); AH linking moved to the Automated ordering tab
│   └── PrivacyPolicy        # GDPR privacy policy (/privacy), incl. recipe parsing (Gemini), households and the optional AH link
└── lib/
    ├── supabase.js           # Supabase client
    ├── pdfUtils.js           # computeContentHash — SHA-256 hash of PDF bytes for duplicate detection
    ├── ingredientMerge.js    # mergeIngredients() — scales by servings and merges the same ingredient across recipes even when written differently (case, spaces, plural last word, veggie/vegetable, TBSP/tsp/T); adds compatible units and shows them in the viewer's volume / mass preference like the recipe view does, never combines volume with weight, and does not use canonical_name (too broad for shopping)
    ├── planWeek.js            # planWeek() chains the planner: staples (stock-up, else due rules) + recipe ingredients (mapped, summed in base units, whole packs; unmapped → free text) → merged target lines, staple updates, decisions and review flags. Pure, no I/O
    ├── recipeStatus.js        # ownInProgressIds() / mergeStatusUpdates() — the catalogue's safety net for missed Realtime events: re-checks your pending/processing recipes (plus any recipe you re-parsed as admin, whoever uploaded it) every 10 s and on returning to the tab, merging only what changed; recipeCardState() decides which card each recipe gets (admins also see other users' in-progress and failed recipes, retried via admin-reparse)
    ├── scaling.js             # computeScaleFactorFromServings() / computeScaleFactorFromIngredient() — work out a scale factor from a target servings count or a target amount of one ingredient (reusing units.js's conversion table); scaleIngredients() applies it to a list for display
    ├── pdfCover.js            # renderPdfCoverBlob() — renders PDF page 1 to a cropped JPEG via pdf.js (its built-in JPEG 2000 decoder handles HelloFresh's cover photos)
    ├── pdfStepImages.js       # extractStepImageBlobs() — locates each step photo on the PDF's steps page by walking pdf.js's operator list (tracking the CTM through image-paint ops), crops them from one page render
    ├── listDiff.js            # mergeTargetLines() combines planner lines for the same product / free text; diffList() compares the target with the current retailer list and returns add / increase / untick changes — never removes, safe to re-run
    ├── packs.js               # parsePackSize() reads AH pack strings ("1,5 l", "2 x 125 g", "6 stuks"); ingredientToBase() converts recipe amounts to g / mL / pieces; packsNeeded() rounds up to whole packs with a 5% tolerance
    ├── staples.js             # weekStartOf(), checkStaple(), planDueStaples() — which staples are due this week (cadence in whole Mon–Sun weeks, skip_next, bonus stock cover via covered_until); dates are plain YYYY-MM-DD strings
    ├── stockup.js             # parseBonusMechanism() reads AH deal labels ("2e GRATIS", "2+1 GRATIS", "3 VOOR 5,00") into a pack group size; planStockUp() buys non-perishable staples on bonus up to max_weeks_stock, rounded to whole deals, and returns the new covered_until
    ├── units.js               # formatTemperatureText() — replaces {{temp:VALUEU}} markers in step text with the viewer's preferred unit; convertIngredientUnit() — converts an ingredient's quantity/unit to the viewer's preferred volume/mass system for display; normalizeUnit() reads a recipe unit as a measurement (capital T = tbsp, lowercase t = tsp); bestUnitInSystem() picks the display unit for an amount within one system
    ├── aisles.js              # AISLES, aisleFor() (keyword rules, first match wins: 'garlic powder' → Herbs & spices, 'mushroom stock concentrate' → Pantry, 'green beans' → Produce), groupByAisle() for the Shopping tab
    ├── recipeFilter.js        # RECIPE_FILTERS (all, mine, friends — friends needs the Social tab), normalizeRecipeFilter() for saved values, filterRecipes() by uploader
    ├── theme.js               # THEME_STORAGE_KEY, normalizeTheme() (only 'dark' means dark; anything else is light), toggleTheme(), themeColorFor() (browser bar colour per theme)
    ├── ahLink.js              # AH_LOGIN_URL, linkStatusView() (what the Settings card shows per status), checkPastedLink() (stops a paste that can't work before AH's one-time code is used), formatLinkDate()
    ├── householdSync.js       # toHouseholdSyncPayload() — reshapes the shopping list state into the picks / adjustments payload for sync_household_shopping_list(), dropping entries the database would reject (last duplicate wins)
    ├── recipeSort.js          # RECIPE_TABLE_COLUMNS config (name, times, difficulty, cuisine, protein, and four nutrition columns) + sortRecipes() / compareRecipesByColumn() for RecipeTable.jsx's list view — nulls always sort last in both directions; isEstimated() / formatRecipeCell() mark AI-estimated nutrition values with ~
    └── utils.js              # cn() helper for combining Tailwind classes
└── tests/                    # Vitest unit tests for src/lib/ (run with `npm test`)
    ├── ingredientMerge.test.js # shopping-list merging: real duplicate examples, plural/synonym names, mixed units, what must stay separate
    ├── listDiff.test.js       # merging target lines, add / increase / untick rules, hand-added items left alone, re-run gives no changes
    ├── packs.test.js          # AH pack-size parsing, recipe amounts to base units, whole-pack rounding
    ├── staples.test.js        # due-staple rules: cadence, skip next, stock cover, re-run safety, week boundaries
    ├── stockup.test.js        # deal-label parsing, stock-up pack counts, existing stock, covered_until dates
    ├── planWeek.test.js       # one realistic week end to end: staples, stock-up, skipped, recipe merging, pantry, unmatched, review flags
    ├── units.test.js          # unit reading, including T vs t
    ├── recipeStatus.test.js   # which recipes to re-check, merging fresh statuses without needless re-renders
    ├── scaling.test.js        # scale factors from servings / a target ingredient amount, and scaleIngredients()
    ├── aisles.test.js         # aisle for ~90 real ingredient names incl. the tricky ones, case and preparation words, unknown → Other, grouping order
    ├── recipeFilter.test.js   # filter list, saved-value fallback, all / mine / friends, no friends yet, list not changed
    ├── theme.test.js          # theme key, light fallback for unknown values, toggling, browser bar colours
    ├── ahLink.test.js         # Settings card per status (switch off, not linked, linked, relink needed; unlink always possible), paste checks, dates
    ├── householdSync.test.js  # sync payload: mapping, 0 kept as checked-off, last duplicate wins, default servings, invalid entries dropped
    ├── accountLinking.test.js # login-code reading, code exchange, link (newest key, re-link replaces), refusals before the code is used, unlink always allowed, status without token data
    ├── productSearch.test.js  # staple product search: query rules, cache rows, refuses users without AH before touching the token, de-duplicates, caches everything seen, returns orderable only, survives a cache failure
    ├── accountTokens.test.js  # single-flight refresh: rotated token saved before use and kept if the action fails, two runs at once, relink_needed on auth, other failures change nothing, no tokens in audit events
    ├── ahAdapter.test.js      # AH response checks, list lines (never removes), kill switch, retries/backoff/timeouts, request spacing, per-line outcomes, fake adapter, adapter choice per environment
    ├── tokenCrypto.test.js    # AH token envelope encryption: round trip, wrong key / account / swapped key / tampering all fail, fresh IVs, reseal after rotation, V1 → V2 key rotation
    └── recipeSort.test.js     # sortRecipes() / compareRecipesByColumn() — ascending/descending, nulls last, 0 treated as a real value; estimate marking per field

supabase/
├── migrations/              # database schema changes (SQL) — deployed automatically via deploy-migrations-preview/prod CI; never run manually after bootstrap
├── seed.sql                 # template for seeding initial data (no real emails — swap in locally)
└── functions/
    ├── parse-recipe/        # claims pending recipe, sends PDF to Gemini 3.5 Flash-Lite, extracts structured data (handles dual-quantity HelloFresh format), tags oven temperatures inline as {{temp:VALUEU}} for unit conversion at render time, classifies protein_source into a fixed category set, gets per-serving nutrition from Gemini as two separate sets (values printed on the card, and its own estimate from the ingredients), keeps the printed value where there is one, and records every field that fell back to the estimate in nutrition_estimated (decided in code, not by Gemini; values are coerced to numbers and rounded before saving), writes ingredients + status=ready; Gemini call runs with minimal thinking, up to 75 s per attempt; when Gemini reports it is overloaded (500 / 503) it retries up to 3 more times, alternating between 3.5 Flash-Lite and 3.8 Flash with 1 s / 5 s / 15 s waits, after a timeout or 429 it retries once on the same model, and if Gemini withholds a reply for RECITATION (output too close to published text) it retries once on the other model; steps are written in Gemini's own words (same quantities, times, temperatures and order) to avoid that filter — all within a 120 s budget that keeps the function under its wall-clock limit
    ├── retry-parse/         # resets a failed recipe to pending (max 3 retries)
    ├── admin-reparse/       # admin-only; clears a ready or failed recipe (any uploader) and sets it back to pending so parse-recipe runs again
    ├── admin-set-cover/     # admin-only; sets cover_path on an existing recipe (recipes has no client UPDATE policy — see security rules)
    ├── retailer-products/   # searches the household's AH through its link (POST { query }), caches the products in retailer_products, returns the orderable ones; needs ah_enabled and a linked account; fake AH on preview
    ├── link-account/        # signed-in user links / unlinks / checks their household's AH account (POST { action: 'status' | 'link' | 'unlink', pasted }); linking needs households.ah_enabled; never returns tokens
    ├── cleanup-recipes/     # hourly cron; deletes failed recipes after 48 h, resets stuck processing
    └── _shared/             # code shared by functions (not deployed as a function itself)
        ├── retailer/        # retailer adapter (ADR 0004): one interface (getAccessToken, searchProducts, getPromotions, readList, writeListLines) for every retailer
        │   ├── productSearch.ts # searchRetailerProducts: query check (2–60 chars), household + ah_enabled check, search through withAccessToken, product-cache rows, orderable results only
        │   ├── accountLinking.ts # linkAccount / unlinkAccount / getLinkStatus: checks everything before using AH's one-time login code, seals the refresh token with a new data key, replaces any old link, audits
        │   ├── pgStores.ts    # Postgres TokenStore + LinkStore over SUPABASE_DB_URL (postgres.js); the only code that touches private.retailer_accounts
        │   ├── accountTokens.ts # withAccessToken(): single-flight refresh (ADR 0003/0007) — lock the row, refresh, re-encrypt the rotated token, audit and commit before the access token is used; AH refusing the token marks the account relink_needed
        │   ├── types.ts       # retailer-neutral types + RetailerError codes (disabled, auth, http, timeout, schema, invalid, unsupported, not_linked)
        │   ├── ahSchema.ts    # checks AH responses and maps them to our types (schema error instead of wrong data); builds list PATCH items, refusing quantity < 1 (never removes)
        │   ├── ahAdapter.ts   # real AH mobile API: timeouts, retry with backoff on 429/5xx, spaced requests, one PATCH per line, kill switch
        │   ├── fakeAdapter.ts # made-up products and an in-memory list for preview/local — never touches AH
        │   └── index.ts       # retailerAdapterFor(): fake unless APP_ENVIRONMENT=production; there RETAILER_AH_ENABLED=true is the kill switch
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
