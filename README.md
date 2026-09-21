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
| **Supabase (prod)** | Production backend | Real user accounts, real data. Connected only to production Vercel deploys. |
| **Supabase (preview)** | Preview backend | Isolated environment for PR previews and local dev. No real data — safe to wipe. |

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
| **Tailwind CSS** | Visual styling — utility classes applied directly in JSX |
| **shadcn/ui** | Pre-built components (`src/components/ui/`) — Button, Card, Input, Sheet, and more |
| **lucide-react** | Icons |

---

### Routing Layer

**React Router v7** handles navigation between pages entirely in the browser — no page reloads. Uses `BrowserRouter` mode (`/home`) because Vercel redirects unknown paths to `index.html`, allowing clean URLs.

---

### Build & Deployment Layer

| Technology | Role |
|---|---|
| **npm** | Package manager. Installs and manages all third-party libraries. |
| **Vite** | Build tool and local dev server. Compiles JSX and serves the app locally. `npm run build` compiles everything into `dist/` for deployment. |
| **GitHub Actions** | CI/CD pipeline. Seven workflows cover frontend, database migration, and edge function deploys (each split into preview/production), plus dependency bump checks — each triggered only when its relevant files change. |
| **Vercel CLI** | The tool GitHub Actions uses to build and deploy to Vercel. All output is logged in GitHub Actions — no Vercel dashboard needed to debug failures. |
| **Vercel** | Frontend hosting. Supports private repositories, provides a preview URL for every PR, and serves clean `/home` style URLs. |
| **Dependabot** | Automated dependency updates. Opens weekly PRs to bump npm packages and GitHub Actions versions. |

#### GitHub Actions workflows

| Workflow | Triggers on | What it does |
|---|---|---|
| `deploy-frontend-preview.yml` | Human PRs to `main` | Vercel preview build and deploy. Preview URL posted as PR comment. |
| `deploy-frontend-prod.yml` | Pushes to `main` | Vercel production build and deploy. |
| `dependabot-build.yml` | Dependabot PRs only | Build check with no secrets. Confirms the bump doesn't break the build. |
| `deploy-migrations-preview.yml` | PRs touching `supabase/migrations/**` | `supabase db push` to the preview Supabase project. |
| `deploy-migrations-prod.yml` | Pushes to `main` touching `supabase/migrations/**` | `supabase db push` to the production Supabase project. |
| `deploy-functions-preview.yml` | PRs touching `supabase/functions/**` | Deploys edge functions to the preview Supabase project. |
| `deploy-functions-prod.yml` | Pushes to `main` touching `supabase/functions/**` | Deploys edge functions to the production Supabase project. |

> **Migration CI:** `deploy-migrations-preview.yml` / `deploy-migrations-prod.yml` track applied migrations by filename and never re-run the same file twice. Any migrations applied manually before CI was set up must be registered in the tracking table via the Supabase dashboard SQL editor. After that, CI owns migrations — do not apply migration files manually.

---

### Backend & Data Layer

| Technology | Role |
|---|---|
| **Supabase Auth** | User authentication. Google OAuth with email allowlist enforced at the database level. Sessions managed by the Supabase JS client and stored in localStorage. |
| **Supabase Database** | Postgres database hosted by Supabase. Stores recipes, ingredients, and shopping lists. Schema defined in `supabase/migrations/` and deployed automatically by CI. Row Level Security enabled on all tables. |
| **Supabase Storage** | File storage for uploaded recipe PDFs. |
| **Supabase Edge Functions** | Serverless functions running on Deno. Three functions handle the parsing pipeline: `parse-recipe` sends uploaded PDFs to Gemini and writes results to the database; `retry-parse` resets failed recipes for re-processing; `cleanup-recipes` runs hourly to remove stale records. |
| **Gemini 2.5 Flash** | Google AI model used inside `parse-recipe` to extract recipe name, ingredients, steps, and metadata from uploaded PDFs. The PDF is sent as a base64-encoded inline attachment. Handles dual-quantity HelloFresh ingredient formats (e.g. "4 oz \| 8 oz") by always extracting the first/base quantity and setting `servings` from the corresponding column header. |

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

---

## Database Schema

All tables have RLS enabled. Migrations live in `supabase/migrations/` and are deployed automatically by `deploy-migrations-preview.yml` / `deploy-migrations-prod.yml`.

| Table | Purpose |
|---|---|
| `allowed_emails` | Email allowlist — signups rejected at DB level if email not present |
| `profiles` | Display name and avatar URL per user, synced from Google OAuth on first login |
| `user_roles` | `is_admin` flag per user — grants delete-any-recipe in the UI |
| `recipes` | One row per uploaded PDF; status machine: `pending` → `processing` → `ready` / `failed` / `rejected` |
| `ingredients` | One row per ingredient per recipe; written by `parse-recipe` edge function only; CASCADE deleted when recipe is deleted |
| `shopping_lists` | One row per user; stores recipe selections (with serving sizes) and per-item quantity adjustments as JSONB; upserted on every change |
| `app_config` | Key/value config for environment-specific settings; service role only |

### recipes status machine

| Status | Meaning |
|---|---|
| `pending` | Uploaded, waiting for parse-recipe to claim it |
| `processing` | Claimed by parse-recipe; Gemini call in progress |
| `ready` | Parsed successfully; visible in the shared gallery |
| `failed` | Parsing failed; uploader can retry up to 3 times |
| `rejected` | Duplicate detected (matching content hash, ingredient fingerprint, or name) |

### Key relationships

- `recipes.cover_path` — storage path of the recipe's cover thumbnail (`covers/<user-id>/<uuid>.jpg` in the `recipe-pdfs` bucket), or `null` if none was generated. Rendered client-side from PDF page 1 — see `src/lib/pdfCover.js`.
- `recipes.uploaded_by` → `auth.users.id`
- `ingredients.recipe_id` → `recipes.id` (CASCADE DELETE)
- `shopping_lists.user_id` → `auth.users.id` (UNIQUE — one list per user)

---

## Project Structure

```text
src/
├── components/
│   ├── ui/                  # shadcn/ui base components (Button, Card, Input, Sheet, Tooltip, …)
│   ├── ProtectedRoute       # redirects unauthenticated users to login
│   ├── RecipeCatalogue      # gallery of all ready recipes; cart button toggles recipe into shopping list; clicking a card opens the preview panel; uploaders can delete their own
│   ├── ShoppingListDrawer   # slide-in drawer: recipe servings steppers, merged ingredient list with per-item quantity controls, persists to shopping_lists via useShoppingList
│   ├── PDFUploader          # file picker UI; delegates to useUploadQueue
│   ├── UploadQueue          # per-file progress list shown during batch upload
│   ├── RecipePreviewPanel   # side panel; generates signed URL and renders PDF in iframe
│   ├── UserMenu             # avatar dropdown with sign-out and admin toggle
│   └── IngredientSearch     # chip-based ingredient typeahead; select suggestions, remove with the chip's × button
├── context/
│   └── AuthContext          # session state, allowlist check, signOut, adminMode
├── hooks/
│   ├── useUploadQueue.js      # upload orchestration: validation, deduplication, concurrent uploads, rate limiting
│   ├── useShoppingList.js     # useReducer state for recipe selections + adjusted quantities; debounced upsert to shopping_lists
│   └── useIngredientSearch.js # useIngredientSuggestions() — debounced typeahead over stored canonical_name/name values;
│                               # useIngredientFilter() — given selected chips, returns recipes matching ALL of them (AND)
├── pages/
│   ├── Login                # login screen with Google OAuth
│   ├── Home                 # main app screen; cart icon in header opens ShoppingListDrawer
│   └── PrivacyPolicy        # GDPR privacy policy (/privacy)
└── lib/
    ├── supabase.js           # Supabase client
    ├── pdfUtils.js           # computeContentHash — SHA-256 hash of PDF bytes for duplicate detection
    ├── ingredientMerge.js    # mergeIngredients() — scales by servings, merges same-name+unit items across recipes, returns sorted list with per-recipe contribution breakdown
    ├── pdfCover.js            # renderPdfCoverBlob() — renders PDF page 1 to a cropped JPEG via pdf.js (its built-in JPEG 2000 decoder handles HelloFresh's cover photos)
    └── utils.js              # cn() helper for combining Tailwind classes

supabase/
├── migrations/              # database schema changes (SQL) — deployed automatically via deploy-migrations-preview/prod CI; never run manually after bootstrap
├── seed.sql                 # template for seeding initial data (no real emails — swap in locally)
└── functions/
    ├── parse-recipe/        # claims pending recipe, sends PDF to Gemini 2.5 Flash, extracts structured data (handles dual-quantity HelloFresh format), writes ingredients + status=ready
    ├── retry-parse/         # resets a failed recipe to pending (max 3 retries)
    ├── admin-set-cover/     # admin-only; sets cover_path on an existing recipe (recipes has no client UPDATE policy — see security rules)
    └── cleanup-recipes/     # hourly cron; deletes failed recipes after 48 h, resets stuck processing

.github/workflows/
├── deploy-frontend-preview.yml   # PR → Vercel preview deploy, posts URL as PR comment
├── deploy-frontend-prod.yml      # merge to main → Vercel production deploy
├── dependabot-build.yml          # dependabot PRs → build check only, no secrets, no deploy
├── deploy-migrations-preview.yml # PR touching supabase/migrations/ → push to preview
├── deploy-migrations-prod.yml    # merge to main touching supabase/migrations/ → push to production
├── deploy-functions-preview.yml  # PR touching supabase/functions/ → deploy to preview
└── deploy-functions-prod.yml     # merge to main touching supabase/functions/ → deploy to production
```

---

## Known Limitations

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
