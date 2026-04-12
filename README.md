# Hell Fresh Trash

A web app for cataloguing your HelloFresh recipe cards. Upload a PDF recipe card, search by ingredient, and build a shopping list from the recipes you want to cook.

Installable on your phone home screen like a native app.

**Live app:** https://trashmans.github.io/hello-fresh-trash-app/

---

## Contents

- [Architecture](#architecture)
  - [Presentation Layer](#presentation-layer)
  - [Routing Layer](#routing-layer)
  - [Build & Deployment Layer](#build--deployment-layer)
  - [Backend & Data Layer](#backend--data-layer-phase-2)
- [Roadmap](#roadmap)
- [Project Structure](#project-structure)
- [Local Development](#local-development)

---

## Architecture

The app is split into four layers. Each layer has one job and can be updated independently.

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

- **shadcn/ui** sits on top of both. It's a library of pre-built, good-looking components — Button, Card, Input, Modal, Dropdown and more. This is the big time-saver for moving fast: instead of spending an hour building and styling a button from scratch, we just use the shadcn Button and it already looks polished. We never have to think about what a card looks like — it's already done. That's the whole point. We focus on the actual product features, not reinventing basic UI pieces. shadcn components live in `src/components/ui/` and can be customised when needed.

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
| **React Router v7** | Handles navigation between pages entirely in the browser — no page reloads. Uses `HashRouter` mode (`/#/home`) because GitHub Pages is static hosting and cannot redirect unknown paths to `index.html`. |

---

### Build & Deployment Layer

| Technology | Role |
|---|---|
| **npm** | Package manager. Installs and manages all the third-party libraries the app depends on (React, Tailwind, shadcn/ui etc). Running `npm install` downloads them into `node_modules/`. Running `npm run dev` or `npm run build` hands off to Vite. npm is the launcher — Vite is the engine it starts. |
| **Vite** | Build tool and local dev server. When you run `npm run dev`, npm calls Vite, which compiles your JSX and serves the app locally. When you run `npm run build`, Vite compiles everything into the `dist/` folder for deployment. npm and Vite are always used together — npm manages packages, Vite does the actual building. |
| **GitHub Actions** | CI/CD pipeline. Three independent workflows watch different parts of the repo — changes to `src/` trigger a frontend deploy, changes to `supabase/migrations/` will trigger a database migration, changes to `supabase/functions/` will trigger a function deploy. |
| **GitHub Pages** | Static hosting for the compiled frontend. Serves the contents of `dist/` at the live URL. The app logic runs entirely in the browser. |

---

### Backend & Data Layer *(Phase 2)*

| Technology | Role |
|---|---|
| **Supabase Auth** | User authentication. Handles sign up, login, and session management with email/password. |
| **Supabase Database** | Postgres database hosted by Supabase. Stores recipes, ingredients, and shopping lists. Schema defined in `supabase/migrations/`. |
| **Supabase Storage** | File storage for uploaded recipe PDFs. |
| **Supabase Edge Functions** | Serverless functions running on Deno. The `parse-recipe` function receives an uploaded PDF, extracts the recipe name, ingredients, and steps, and writes the result to the database. |
| **pdf.js** | PDF parsing library used inside the edge function to read text content from uploaded HelloFresh recipe cards. |

---

## Roadmap

### ✅ Phase 1 — Live Shell
Get a real, installable web app deployed with a working CI/CD pipeline.

- [x] React 19 + Vite 8 + Tailwind CSS + shadcn/ui
- [x] Login page and Home page (UI only, no real auth yet)
- [x] Dark theme, green accents, mobile-friendly layout
- [x] PWA manifest — installable on iPhone and Android home screen
- [x] GitHub Actions pipeline — push to `main` → auto deploys to GitHub Pages
- [x] Independent pipeline stubs for Supabase migrations and functions

---

### 🔜 Phase 2 — Supabase Integration
Wire up the backend so the app stores and retrieves real data.

- [ ] Supabase project setup
- [ ] User authentication (email/password)
- [ ] PDF upload to Supabase Storage
- [ ] `parse-recipe` edge function — extracts recipe data from uploaded PDFs
- [ ] Recipe catalogue — display all uploaded recipes
- [ ] Ingredient search
- [ ] Shopping list generator
- [ ] Migrations and functions pipelines go live

---

### 💡 Phase 3 — Polish
- [ ] Form validation with React Hook Form + Zod
- [ ] Error tracking with Sentry
- [ ] Analytics with PostHog or Plausible
- [ ] Onboarding empty states
- [ ] Lighthouse performance audit
- [ ] Vitest unit tests for components and utility functions
- [ ] Unit tests run as part of CI check on every PR

---

## Project Structure

```
src/
├── components/
│   ├── ui/               # shadcn/ui base components (Button, Card, Input)
│   ├── RecipeCatalogue   # displays all recipes
│   ├── PDFUploader       # handles PDF upload
│   ├── IngredientSearch  # search recipes by ingredient
│   └── ShoppingList      # shopping list generator
├── pages/
│   ├── Login             # login screen
│   └── Home              # main app screen
└── lib/
    └── utils.js          # cn() helper for combining Tailwind classes

supabase/
├── migrations/           # database schema changes (SQL)
└── functions/
    └── parse-recipe/     # edge function that parses uploaded PDFs

.github/workflows/
├── deploy-frontend.yml   # triggers on src/ changes → deploys to GitHub Pages
├── deploy-migrations.yml # triggers on supabase/migrations/ changes
└── deploy-functions.yml  # triggers on supabase/functions/ changes
```

---

## Local Development

### Step 1 — Install Node and npm (first time only)

npm comes bundled with Node.js. The best way to install Node on a Mac is via nvm (Node Version Manager), which lets you install and switch between Node versions easily.

Open your Terminal app and run these two commands one at a time:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

Close Terminal completely, reopen it, then run:

```bash
# Install Node 20
nvm install 20
nvm use 20
```

Verify it worked:

```bash
node --version
npm --version
```

Both should print a version number. You only ever need to do this once on your machine.

---

### Step 2 — Navigate to the project folder

In Terminal, use `cd` (change directory) to move into the project folder:

```bash
cd /Users/jennifergelinas/Documents/GitHub/hello-fresh-trash-app
```

You can also type `cd ` (with a space) and then drag the project folder from Finder directly into the Terminal window — it will fill in the path for you.

---

### Step 3 — Install project dependencies (first time, or after pulling new changes)

This downloads all the libraries the app needs (React, Tailwind, shadcn/ui etc) into a `node_modules/` folder. That folder is never committed to git — everyone runs this command themselves.

```bash
npm install
```

You need to re-run this any time someone adds a new package to `package.json`.

---

### Step 4 — Start the local dev server

```bash
npm run dev
```

The app is now running on your machine at:

```
http://localhost:5173/hello-fresh-trash-app/
```

Open that URL in your browser. Changes you make to the code appear instantly in the browser without needing to refresh — this is called hot reload.

---

### Step 5 — Stop the dev server

In Terminal, press:

```
Ctrl + C
```

That stops the server. The app will no longer be accessible at the localhost URL until you run `npm run dev` again.

---

### Deploying

You do not need to build or deploy manually. Push your changes to `main` and GitHub Actions handles everything automatically. The live site updates in about 2 minutes.

```bash
git add .
git commit -m "your message here"
git push origin main
```

> **Phase 2 note:** Copy `.env.example` to `.env` and fill in your Supabase credentials before working on any backend features.
