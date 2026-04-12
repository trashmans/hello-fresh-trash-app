# Claude Instructions for Hello Fresh Trash

## Repo rules

- **Never commit.** The user always does commits. Stage changes if needed, but never run `git commit`.
- **Never push to main.** All changes go through pull requests.
- **Never push directly.** The user opens PRs.

## Running the app

```bash
npm run dev       # local dev server at http://localhost:5173
npm run build     # production build
npm test          # runs Vitest (no test files yet — that's expected)
```

## Tech stack

- **React 19** + **Vite** — component framework and build tool
- **Tailwind v4** — utility classes directly in JSX, no config file to edit
- **shadcn/ui** — pre-built components live in `src/components/ui/`, use these rather than building from scratch
- **React Router v7** with `BrowserRouter` — clean URLs (`/home`), not hash routing (`/#/home`)
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

**Commit messages** should be lowercase, imperative, and describe what the change does — not what you did:

- `add recipe upload component`
- `fix login button not responding on mobile`
- `update readme with vercel deployment steps`

Before a PR is opened, suggest a branch name and a commit message that follows these conventions.

## Keeping the README up to date

When completing work that changes the project's capabilities or structure, update `README.md` to reflect it:
- Check off roadmap items when a feature is fully implemented
- Update the Project Structure section if files or folders are added or removed
- Update the Architecture section if a new platform or technology is introduced
