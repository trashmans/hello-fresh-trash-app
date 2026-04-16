# Claude Instructions for Hello Fresh Trash

## Starting every session

Before writing any code, confirm the working branch with the human. Every change goes on a dedicated branch — never directly on `main`.

1. Ask the human to confirm their current branch (`git status` or the branch indicator in their IDE)
2. If they are on `main`, help them create a new branch before touching any files:
   - Suggest a branch name following the `prefix/short-slug` convention (see Branch names below)
   - Ask them to run: `git checkout -b <branch-name>`
3. If they are already on a feature branch, confirm it is up to date: `git pull origin main`
4. At the end of the session, suggest a commit message and remind the human to open a PR — never push directly

## Using AI assistance (Superpowers)

This project uses the Superpowers skill system for structured planning:

- **Brainstorming and planning** — use Superpowers skills (`superpowers:brainstorming`, `superpowers:writing-plans`) to explore ideas, design solutions, and produce implementation plans before touching code
- **Execution** — always use normal Claude Code directly, never Superpowers execution skills (`superpowers:executing-plans`, `superpowers:subagent-driven-development`)

The workflow is: Superpowers for thinking → Claude Code for doing.

## Repo rules

- **Never run git commands.** The user handles all git operations — checkout, commit, push, and branch creation. Claude never runs git.
- **Never push to main.** All changes go through pull requests.
- **Never run npm commands.** Only the human runs `npm`. After making code changes, prompt the user to run the relevant command and verify the result before proceeding.
- **No tests.** This project operates in dev mode — do not write test files or use TDD patterns.
- **No git worktrees.** Work directly on the current branch.

## Running the app

The human runs all npm commands. After code changes, prompt them to run the appropriate command and confirm the result before proceeding.

| Command | When to prompt |
|---|---|
| `npm run dev` | After any UI or logic change — verify in browser at `http://localhost:5173` |
| `npm run build` | Before opening a PR — confirm the production build passes |
| `npm install <pkg>` | When a new dependency is needed — tell the human exactly what to run |

## Tech stack

- **React 19** + **Vite** — component framework and build tool
- **Tailwind v4** — utility classes directly in JSX, no config file to edit
- **shadcn/ui** — pre-built components live in `src/components/ui/`, use these rather than building from scratch
- **React Router v7** with `BrowserRouter` — clean URLs (`/home`), not hash routing (`/#/home`)
- **Supabase** — backend: auth (Google OAuth), Postgres database, file storage, edge functions
- **Vercel** — frontend hosting, deployed via GitHub Actions (not the native Vercel Git integration)

## CI/CD

Two GitHub Actions workflows:
- `deploy-frontend.yml` — human PRs and pushes to `main`. Runs `vercel build` and deploys. Posts preview URL as a PR comment.
- `dependabot-build.yml` — Dependabot PRs only. Build check with no secrets.

Secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) are stored in GitHub repo settings. Never hardcode them.

## Branch names and commit messages

**Branch names** use a prefix that describes the type of change, followed by a short slug:

| Prefix | Use for |
|---|---|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `chore/` | Config, docs, tooling |

Examples: `feature/recipe-upload`, `fix/login-button`, `chore/update-readme`

**Commit messages** use the same prefix as the branch, followed by a short lowercase imperative description:

- `feature: add recipe upload component`
- `fix: login button not responding on mobile`
- `chore: update readme with vercel deployment steps`

Before a PR is opened, suggest a branch name and a commit message that follows these conventions.

## Keeping the README up to date

When completing work that changes the project's capabilities or structure, update `README.md` to reflect it:
- Check off roadmap items when a feature is fully implemented
- Update the Project Structure section if files or folders are added or removed
- Update the Architecture section if a new platform or technology is introduced

## Security rules

### Environments
- Local `.env` always points at the **preview** Supabase project — never prod
- Prod credentials exist only in Vercel (Production scope) — never in `.env`, never in code
- `.env` is gitignored and must remain so — `.env.example` contains only empty placeholders, never real keys

### Supabase keys
- The **anon key** (`VITE_SUPABASE_ANON`) is the only Supabase credential the browser ever sees
- The **service role key** bypasses RLS entirely — it must never appear in frontend code, `.env`, or GitHub secrets — it only lives as a Supabase-managed secret inside Edge Functions

### Migrations
- Every `CREATE TABLE` migration must enable RLS and define explicit access policies **in the same file** — no table may exist without RLS
- Deny all by default — no policy means no access — grant only what the feature explicitly requires
- Policies for SELECT, INSERT, UPDATE, and DELETE are defined separately — only add what the feature needs
- Same schema and RLS policies must be applied to both preview and production projects — no relaxed preview mode

### Standard migration pattern

Every new table follows this structure:

```sql
CREATE TABLE public.<table_name> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own <table_name>"
  ON public.<table_name> FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users can insert own <table_name>"
  ON public.<table_name> FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Only add UPDATE/DELETE policies if the feature explicitly requires them
```

### Seed data
- Real email addresses and user data never go in git — this is a public repo
- Use `supabase/seed.sql` as a template — swap in real values locally when seeding a new environment
