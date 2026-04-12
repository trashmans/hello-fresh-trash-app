# Contributing to Hello Fresh Trash

All changes go through pull requests. No one pushes directly to `main`. This document covers everything you need to know to get the app running locally and contribute using either GitHub Desktop or VS Code.

---

## Contents

- [Getting started locally](#getting-started-locally)
- [Branch naming](#branch-naming)
- [Workflow: GitHub Desktop](#workflow-github-desktop)
- [Workflow: VS Code](#workflow-vs-code)
- [What happens when you open a PR](#what-happens-when-you-open-a-pr)
- [Recovery: accidentally committed to main](#recovery-accidentally-committed-to-main)

---

## Getting started locally

### Step 1 — Install Node and npm (first time only)

npm comes bundled with Node.js. The best way to install Node on a Mac is via nvm (Node Version Manager), which lets you install and switch between Node versions easily.

Open your Terminal app and run:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

Close Terminal completely, reopen it, then run:

```bash
# Install Node 24
nvm install 24
nvm use 24
```

Verify it worked:

```bash
node --version
npm --version
```

Both should print a version number. You only ever need to do this once on your machine.

---

### Step 2 — Navigate to the project folder

In Terminal, use `cd` to move into the project folder:

```bash
cd /Users/your-username/Documents/GitHub/hello-fresh-trash-app
```

You can also type `cd ` (with a space) and then drag the project folder from Finder directly into the Terminal window — it will fill in the path for you.

---

### Step 3 — Install dependencies and start the dev server

```bash
npm install
npm run dev
```

The app is now running at `http://localhost:5173/`. Changes you make to the code appear instantly without refreshing — this is called hot reload.

To stop the server, press `Ctrl + C` in Terminal.

---

## Branch naming

Use a prefix that describes what the branch is for:

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

---

## Workflow: GitHub Desktop

1. Open GitHub Desktop
2. Click **Fetch origin** to make sure your `main` is up to date
3. Click **Current Branch** → **New Branch** → enter a branch name (e.g. `feature/recipe-upload`) → **Create Branch**
4. Make your changes in VS Code
5. Back in GitHub Desktop — your changed files appear on the left
6. Write a short summary in the **Summary** field (e.g. `add recipe upload button`)
7. Click **Commit to feature/recipe-upload**
8. Click **Publish Branch** (first time) or **Push origin**
9. GitHub Desktop shows a banner → click **Create Pull Request** — this opens GitHub in your browser
10. Fill in the PR title and description → click **Create pull request**
11. Wait for the deploy check to go green (see [What happens when you open a PR](#what-happens-when-you-open-a-pr))
12. Click **Squash and merge** on GitHub
13. Back in GitHub Desktop → switch to `main` → **Fetch origin** → **Pull origin**

---

## Workflow: VS Code

1. Open the **Source Control** panel in VS Code (the branch icon in the left sidebar, or `Ctrl+Shift+G` / `Cmd+Shift+G`)
2. Click the **...** menu (top right of the Source Control panel) → **Branch** → **Create Branch** → enter a name (e.g. `feature/recipe-upload`) → press Enter
3. Make your changes
4. In the Source Control panel, your changed files appear under **Changes**
5. Hover over a file and click **+** to stage it, or click **+** next to **Changes** to stage all files
6. Type a commit message in the box at the top (e.g. `add recipe upload button`)
7. Click the **✓ Commit** button
8. Click **Publish Branch** in the blue bar at the bottom of VS Code (or click **Sync Changes** if it appears)
9. VS Code may prompt you to open GitHub in the browser to create a PR — click it, or go to your repo on GitHub manually
10. On GitHub, open a pull request from your branch → `main`
11. Wait for the deploy check to go green
12. Click **Squash and merge**
13. Back in VS Code Source Control → click **...** → **Branch** → **Checkout to** → `main` → then click **Sync Changes** to pull the latest

---

## What happens when you open a PR

When a PR is opened targeting `main`, GitHub Actions automatically runs the **Deploy Frontend** workflow:

1. Spins up a fresh Ubuntu machine
2. Installs Node 24 and the Vercel CLI
3. Pulls the Vercel project configuration
4. Runs `vercel build` to compile the app
5. Deploys the built output to a temporary preview URL
6. Posts a comment on the PR with the preview link — open it on your phone to check how it looks before merging

If the build **passes** → a green checkmark appears on the PR and it can be merged.

If the build **fails** → the PR is blocked. Click **Details** on the failed check to see the full build log in GitHub Actions — no Vercel account needed to read it. Fix the issue on your branch, push again — the workflow re-runs automatically.

The branch must also be **up to date with `main`** before merging. If `main` has moved since you branched off, GitHub will show an **Update branch** button — click it before merging.

The preview URL is unique to that branch, stays live indefinitely, and is publicly accessible — your collaborator can open it without a Vercel account.

---

## Recovery: accidentally committed to main

This happens. Here's how to fix it without losing your work.

### GitHub Desktop

1. In GitHub Desktop, while still on `main`, click **Current Branch** → **New Branch** → create `feature/rescue-my-changes`
   - This carries your commits onto the new branch automatically
2. Switch back to `main` via **Current Branch**
3. In the **History** tab, right-click the accidental commit → **Undo commit**
   - If there are multiple accidental commits, undo them one at a time from the most recent
4. Click **Push origin** — your local `main` now matches remote `main`
5. Switch to `feature/rescue-my-changes` → **Publish Branch** → open a PR normally

### VS Code

1. In the Source Control panel, click **...** → **Branch** → **Create Branch** → name it `feature/rescue-my-changes`
   - Your uncommitted or committed-but-not-pushed changes come with you
2. Click **...** → **Branch** → **Checkout to** → `main`
3. Click **...** → **Pull** to reset local `main` to match remote
   - If VS Code says your branch is ahead of origin, click **...** → **Branch** → **Discard** or use the timeline to undo the commit
4. Switch back to `feature/rescue-my-changes` → **Publish Branch** → open a PR normally

> **Tip:** If you're ever unsure what state your branch is in, GitHub Desktop shows a clear visual history. When in doubt, check there before taking action.
