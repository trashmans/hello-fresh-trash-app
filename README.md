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
- [Roadmap](#roadmap)
- [Project Structure](#project-structure)
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

These platforms are independent — GitHub Actions is the glue that connects them: it calls the Vercel CLI to deploy the frontend, and in Phase 2 will call the Supabase CLI to run database migrations.

**Why Vercel instead of GitHub Pages:** GitHub Pages only works with public repositories on the free tier, doesn't support per-PR preview URLs, and requires a base path workaround (`/repo-name/`) that complicates routing. Vercel supports private repos, generates a unique preview URL for every pull request, and serves clean `/home` style URLs with no config hacks.

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
│           Backend & Data                │  Where data lives (Phase 2)
└─────────────────────────────────────────┘
```

---

### Presentation Layer

React, Tailwind, and shadcn/ui are often confused because they all affect what appears on screen. They do different jobs:

- **React** is responsible for *logic and structure* — what components exist, what data they hold, and how they respond to user actions. React has no opinion on what anything looks like. A React button with no styling is an unstyled grey browser button.

- **Tailwind CSS** is responsible for *visual appearance* — colours, spacing, typography, layout. It works by applying short utility classes directly to HTML elements (`bg-green-500`, `rounded-xl`, `text-sm`). Tailwind has no opinion on structure or behaviour — it only handles how things look.

- **shadcn/ui** sits on top of both. It's a library of pre-built, good-looking components — Button, Card, Input, Modal, Dropdown and more. Instead of spending an hour building and styling a button from scratch, we use the shadcn Button and it already looks polished. shadcn components live in `src/components/ui/` and can be customised when needed.

A useful way to think about it: React builds the rooms, Tailwind paints them, shadcn/ui is the furniture you move in.

| Technology | Responsible for | Without it |
|---|---|---|
| **React** | Structure, logic, state | No interactivity — just a static HTML file |
| **Tailwind CSS** | Visual styling | Unstyled, browser-default grey everything |
| **shadcn/ui** | Pre-built components | Build every button, card, and input from scratch |
| **lucide-react** | Icons | No icons, or manually managing SVG files |

---

### Routing Layer

| Technology | Role |
|---|---|
| **React Router v7** | Handles navigation between pages entirely in the browser — no page reloads. Uses `BrowserRouter` mode (`/home`) because Vercel can redirect unknown paths to `index.html`, allowing clean URLs. |

---

### Build & Deployment Layer

| Technology | Role |
|---|---|
| **npm** | Package manager. Installs and manages all third-party libraries (React, Tailwind, shadcn/ui etc). `npm install` downloads them into `node_modules/`. `npm run dev` starts the local server. npm is the launcher — Vite is the engine it starts. |
| **Vite** | Build tool and local dev server. Compiles JSX and serves the app locally for development. `npm run build` compiles everything into `dist/` for deployment. |
| **GitHub Actions** | CI/CD pipeline. Two independent workflows handle different cases: `deploy-frontend.yml` for human PRs (full Vercel build and deploy), `dependabot-build.yml` for automated dependency bumps (build-only, no secrets needed). |
| **Vercel CLI** | The tool GitHub Actions uses to build and deploy to Vercel. Runs `vercel build` then `vercel deploy`. All output is logged in GitHub Actions — no Vercel dashboard access needed to debug failures. |
| **Vercel** | Frontend hosting. Supports private repositories on the free tier, provides a preview URL for every PR, and serves clean `/home` style URLs. |
| **Dependabot** | Automated dependency updates. Opens weekly PRs to bump npm packages and GitHub Actions versions. |

#### GitHub Actions workflows

| Workflow | Triggers on | What it does |
|---|---|---|
| `deploy-frontend.yml` | Human PRs and pushes to `main` | Full Vercel build and deploy. Preview URL posted as PR comment. Production deploy on merge. |
| `dependabot-build.yml` | Dependabot PRs only | Build check with no secrets. Confirms the bump doesn't break the build. |
| `deploy-migrations.yml` | Changes to `supabase/migrations/` | *(Phase 2)* Runs database migrations |
| `deploy-functions.yml` | Changes to `supabase/functions/` | *(Phase 2)* Deploys edge functions |

#### GitHub Secrets

GitHub Actions needs credentials to talk to Vercel. These are stored as repository secrets (GitHub repo → Settings → Secrets and variables → Actions) and are never visible in logs or code.

| Secret | What it is | Where to find it |
|---|---|---|
| `VERCEL_TOKEN` | Authenticates GitHub Actions to your Vercel account | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Identifies your Vercel account | vercel.com → Account Settings → General → "Your ID" |
| `VERCEL_PROJECT_ID` | Identifies this Vercel project | vercel.com → Project → Settings → General → "Project ID" |

To revoke access at any time, delete the token from your Vercel account settings.

For the functions pipeline you also need:

| Secret | What it is | Where to find it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Authenticates the Supabase CLI | supabase.com → Account → Access Tokens |
| `SUPABASE_PROJECT_ID` | Production project ref | `app.supabase.com/project/`**`this-part`** |
| `SUPABASE_PREVIEW_PROJECT_ID` | Preview project ref | Same, for your preview project |

> **Local setup:** Copy `.env.example` to `.env` and fill in your Supabase credentials. See [CONTRIBUTING.md](CONTRIBUTING.md) for full setup steps.

#### Supabase Environment Setup

Some configuration lives outside git because it is environment-specific or secret. Do this once per Supabase project (both preview and production).

**1. Deploy edge functions**

For preview, deploy manually via the Supabase CLI:
```
supabase functions deploy parse-recipe
supabase functions deploy retry-parse
supabase functions deploy cleanup-recipes
```
For production, the `deploy-functions.yml` pipeline handles this automatically on merge to `main`.

**2. Set edge function secrets**

In **Supabase Dashboard → Edge Functions → Secrets**, add for each project:

| Secret | Value |
|---|---|
| `GEMINI_API_KEY` | Your Google AI Studio API key |

> **Note:** `WEBHOOK_SECRET` was removed — the Supabase Edge Function webhook type does not forward custom headers, so the secret check was abandoned. The atomic claim pattern (UPDATE WHERE status='pending') prevents duplicate processing instead.

**3. Create the DB webhook**

In **Supabase Dashboard → Database → Webhooks → Create webhook**:

| Setting       | Value                                              |
|---------------|----------------------------------------------------|
| Type          | Supabase Edge Function                             |
| Name          | `on-recipe-pending`                                |
| Table         | `public.recipes`                                   |
| Events        | `INSERT` only — not UPDATE (causes 3× firing)      |
| Edge Function | `parse-recipe`                                     |
| HTTP Headers  | none                                               |

**4. Schedule the cleanup function**

In **Supabase Dashboard → Edge Functions → cleanup-recipes → Schedule**, set cron: `0 * * * *` (hourly).

Repeat steps 2–4 for both preview and production, using the correct secrets for each environment.

---

### Backend & Data Layer

| Technology | Role |
|---|---|
| **Supabase Auth** | User authentication. Google OAuth with email allowlist enforced at the database level. Sessions managed by the Supabase JS client and stored in localStorage. |
| **Supabase Database** | Postgres database hosted by Supabase. Stores recipes, ingredients, and shopping lists. Schema defined in `supabase/migrations/`. Row Level Security enabled on all tables. |
| **Supabase Storage** | File storage for uploaded recipe PDFs. |
| **Supabase Edge Functions** | Serverless functions running on Deno. Three functions handle the parsing pipeline: `parse-recipe` sends uploaded PDFs to Gemini and writes results to the database; `retry-parse` resets failed recipes for re-processing; `cleanup-recipes` runs hourly to remove stale records. |
| **Gemini 2.5 Flash** | Google AI model used inside `parse-recipe` to extract recipe name, ingredients, steps, and metadata from uploaded PDFs. The PDF is sent as a base64-encoded inline attachment. |

---

### Database Schema

All tables have RLS enabled. Migrations live in `supabase/migrations/` and must be run in filename order on every environment.

| Table | Purpose |
|---|---|
| `allowed_emails` | Email allowlist — signups rejected at DB level if email not present |
| `profiles` | Display name and avatar URL per user, synced from Google OAuth on first login |
| `user_roles` | `is_admin` flag per user — grants delete-any-recipe in the UI |
| `recipes` | One row per uploaded PDF; status machine: `pending` → `processing` → `ready` / `failed` / `rejected` |
| `ingredients` | One row per ingredient per recipe; written by `parse-recipe` edge function only |
| `app_config` | Key/value config for environment-specific settings; service role only |

#### recipes status machine

| Status | Meaning |
|---|---|
| `pending` | Uploaded, waiting for parse-recipe to claim it |
| `processing` | Claimed by parse-recipe; Gemini call in progress |
| `ready` | Parsed successfully; visible in the shared gallery |
| `failed` | Parsing failed; uploader can retry up to 3 times |
| `rejected` | Duplicate detected (matching content hash, ingredient fingerprint, or name) |

#### Key relationships

- `recipes.uploaded_by` → `auth.users.id`
- `ingredients.recipe_id` → `recipes.id` (CASCADE DELETE)

---

### Security

**This is a public GitHub repository.** Every PR generates a Vercel preview URL that is publicly accessible. The security model is designed around this constraint.

#### Two Supabase projects — preview isolation

The core mitigation for public preview URLs is running two completely separate Supabase projects:

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
2. **Client-side check** — `AuthContext` signs out any authenticated session where the email is not on the list. A second layer of defence.

The Supabase anon key is the only credential the browser ever sees. The service role key (which bypasses RLS) exists only as a Supabase-managed secret inside Edge Functions and never touches the frontend.

---

## Roadmap

### ✅ Phase 1 — Live Shell
Get a real, installable web app deployed with a working CI/CD pipeline.

- [x] React 19 + Vite + Tailwind CSS + shadcn/ui
- [x] Login page and Home page (UI only, no real auth yet)
- [x] Dark theme, green accents, mobile-friendly layout
- [x] PWA manifest — installable on iPhone and Android home screen
- [x] Vercel hosting — private repo, clean URLs, preview deploy on every PR
- [x] GitHub Actions pipeline — PR opens → preview deploy, merge to `main` → production deploy
- [x] Dependabot — weekly automated dependency update PRs
- [x] Independent pipeline stubs for Supabase migrations and functions

---

### 🔜 Phase 2 — Supabase Integration
Wire up the backend so the app stores and retrieves real data.

#### Security & environments
- [x] Preview Supabase project — isolated from prod, used by PR previews and local dev
- [x] Vercel env vars scoped per environment — Production and Preview use different Supabase projects
- [x] Production anon key rotated after environment separation
- [x] Local `.env` points at preview project — never prod
- [x] Branch protection enabled on `main`
- [x] Server-side allowlist enforcement — `BEFORE INSERT` trigger on `auth.users` blocks unauthorised signups at the database level
- [x] RLS audit — `allowed_emails` and `profiles` tables reviewed and confirmed

#### RLS — applied per table as tables are built

- [x] `recipes` table — RLS enabled; all authenticated users can read (shared catalogue); any authenticated user can upload; only the uploader can delete their own recipes; updates reserved for the parse-recipe edge function (service role)
- [x] `ingredients` table — RLS enabled; all authenticated users can read; INSERT is service-role only (parse-recipe edge function writes via service role key, bypassing RLS — no client INSERT policy needed)
- [ ] `shopping_lists` table — RLS enabled with per-user policies
- [x] Storage bucket access policies defined — authenticated users can upload and read; only the uploader can delete their own files (enforced by joining storage objects back to the recipes table)

#### Features
- [x] Supabase project setup
- [x] User authentication (Google OAuth via Supabase Auth, email allowlist)
- [x] PDF upload to Supabase Storage — with client-side MIME/size validation, UUID storage paths, sanitized filenames, and toast notifications
- [x] Recipe catalogue — shared gallery of all uploaded recipes with side-panel PDF preview and per-uploader delete
- [x] `parse-recipe` edge function — Gemini 2.5 Flash extracts recipe name, ingredients, steps, and metadata from uploaded PDFs; promotes status from `pending` → `ready`; duplicate detection via content hash, ingredient fingerprint, and case-insensitive name match
- [x] `retry-parse` edge function — resets a failed recipe to `pending` (max 3 retries) so the webhook re-fires
- [x] `cleanup-recipes` edge function — hourly cron; deletes failed recipes after 48 h, resets ghost pending/stuck processing
- [x] `deploy-functions.yml` CI pipeline — deploys edge functions to preview on PR, production on merge to `main`
- [ ] Recipe gallery cover images — deferred to its own feature branch; JPEG 2000 format used by HelloFresh PDFs is not natively supported in browsers or available via simple WASM packages
- [ ] Ingredient search
- [ ] Shopping list generator

---

### 🔧 Follow-up fixes
- [ ] PWA manifest warnings — add `<meta name="mobile-web-app-capable">` to `index.html` and fix missing `icons/icon-192.png`
- [ ] Cleanup preview Supabase — remove `WEBHOOK_SECRET` from edge function secrets; confirm webhook is set to `INSERT` only

---

### 💡 Phase 3 — Polish
- [ ] Form validation with React Hook Form + Zod
- [ ] Error tracking with Sentry
- [ ] Analytics with PostHog or Plausible
- [ ] Onboarding empty states
- [ ] Lighthouse performance audit
- [ ] Vitest unit tests for components and utility functions
- [ ] Avatar storage — evaluate copying Google profile photo to Supabase Storage on signup for reliable recipe attribution (assess storage cost against free tier limit before implementing)

---

## Project Structure

```
src/
├── components/
│   ├── ui/                  # shadcn/ui base components (Button, Card, Input)
│   ├── ProtectedRoute       # redirects unauthenticated users to login
│   ├── RecipeCatalogue      # shared gallery of all uploaded recipes; clicking a card opens the preview panel; uploaders can delete their own
│   ├── PDFUploader          # file picker UI; delegates to useUploadQueue
│   ├── UploadQueue          # per-file progress list shown during batch upload
│   ├── RecipePreviewPanel   # side panel; generates signed URL and renders PDF in iframe
│   ├── UserMenu             # avatar dropdown with sign-out and admin toggle
│   ├── IngredientSearch     # search recipes by ingredient (stub)
│   └── ShoppingList         # shopping list generator (stub)
├── context/
│   └── AuthContext          # session state, allowlist check, signOut, adminMode
├── hooks/
│   └── useUploadQueue.js    # upload orchestration: validation, deduplication, concurrent uploads, rate limiting
├── pages/
│   ├── Login                # login screen with Google OAuth
│   ├── Home                 # main app screen
│   └── PrivacyPolicy        # GDPR privacy policy (/privacy)
└── lib/
    ├── supabase.js           # Supabase client
    ├── pdfUtils.js           # computeContentHash — SHA-256 hash of PDF bytes for duplicate detection
    └── utils.js              # cn() helper for combining Tailwind classes

supabase/
├── migrations/              # database schema changes (SQL) — run in order on every environment
├── seed.sql                 # template for seeding initial data (no real emails — swap in locally)
└── functions/
    ├── parse-recipe/        # claims pending recipe, sends PDF to Gemini, writes ingredients + status=ready
    ├── retry-parse/         # resets a failed recipe to pending (max 3 retries)
    └── cleanup-recipes/     # hourly cron; deletes failed recipes after 48 h, resets stuck processing

.github/workflows/
├── deploy-frontend.yml      # human PRs → preview deploy, merge to main → production deploy
├── dependabot-build.yml     # dependabot PRs → build check only, no secrets, no deploy
├── deploy-migrations.yml    # triggers on supabase/migrations/ changes
└── deploy-functions.yml     # PR → deploy to preview; merge to main → deploy to production
```

---

## Development

For local setup, branch naming, PR workflow, and recovery from common mistakes, see [CONTRIBUTING.md](CONTRIBUTING.md).
