# PAT rotation runbook — KidsTube (2026-10-26)

The old PAT (`ghp_cL…5gOn`, minted 2026-10-03) returns **401 Bad credentials**. It was revoked or
expired. It lives inside `.git/config` remote URL — a local-only secret that never entered chat.

## Steps for Amme (2 minutes)

1. Mint a new PAT: <https://github.com/settings/tokens>
   - **Classic token** (fine-grained also works if you give it `contents: write` + `workflows: write`).
   - Scopes: `repo` + `workflow`.
   - Expiry: 30–90 days. Amme rotates after each milestone.

2. Save the PAT to a file **instead of pasting it into Telegram** (chat + session transcripts are
   the wrong place for a live credential):

   ```bash
   printf '%s' 'ghp_xxxxxxxxxxxxxxxxxxxx' > ~/.openclaw/workspace/projects/kids-youtube/.pat
   chmod 600 ~/.openclaw/workspace/projects/kids-youtube/.pat
   ```

   `.gitignore` already ignores `*.pat` — confirm with `git check-ignore -v .pat`.

3. Let me install it (verifies against `GET /user` first, then rewrites the remote URL):

   ```bash
   cd ~/.openclaw/workspace/projects/kids-youtube
   ./scripts/set-pat.sh .pat
   ```

   Expected output:
   ```
   OK: PAT accepted — authenticated as 'ammechan724'
   OK: remote reachable with new PAT
   Done. PAT is installed in .git/config (local file, not in chat).
   ```

   The script never prints the PAT and never echoes the `Authorization:` header.

### Alternative: Amme runs it all herself

```bash
cd ~/.openclaw/workspace/projects/kids-youtube
printf '%s' 'ghp_xxx' | ./scripts/set-pat.sh -
```

## What Crabie does once the PAT is live

1. Verify `GET /user` → 200 and confirm the authed login is `ammechan724`.
2. Apply the staged Pages auto-deploy fix:
   `git apply notes/fix-pages-auto-deploy.patch` (adds `permissions: actions: write` +
   `gh workflow run pages.yml --ref main` to `scrape.yml`), commit, push.
   → the site then self-heals every week instead of going stale.
3. Backfill the 3-week gap: trigger a scrape run, then trigger `pages.yml` dispatch on the new
   commit, then verify `data/videos.json` `generatedAt` on the live site is fresh.
4. Delete `notes/fix-pages-auto-deploy.patch` consumption note + update MEMORY.md.

## Why the patch is needed at all

GitHub blocks downstream workflow triggers from `GITHUB_TOKEN` pushes (anti-recursion guard).
`scrape.yml` pushes with `GITHUB_TOKEN` → `pages.yml`'s `on: push` never fires. `workflow_dispatch`
**does** work from `GITHUB_TOKEN`, so the fix is to explicitly dispatch Pages at the end of the
scrape job. No secrets required.
