# Claude Instructions for Hello Fresh Trash

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
