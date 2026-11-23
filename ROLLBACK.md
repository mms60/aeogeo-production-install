# Rollback runbook: preserve Bing verification

Last updated: 2026-11-23

Production site: `https://aeogeosearch.com/`
Netlify site: `geoaeosearch` (`5e907ce6-0971-4862-9d52-651026e37c00`)

## Critical invariant

The homepage must contain this exact tag inside `<head>`:

```html
<meta name="msvalidate.01" content="2E167DAFE14DBC1C787CCF4F3D1D6ED9" />
```

Rules:

- It must be in the server-rendered `<head>`, **not** body copy.
- It must appear exactly once in the document.
- A Netlify deploy restore replaces the whole site and does not run the build guard. Run the production check after any restore.

## Release anchors

| Purpose | Git | Netlify deploy | Has Bing tag? |
| --- | --- | --- | --- |
| Tagged release baseline | `release-2026-11-23` -> `a9ccb21` | `6b04b6938fefb649fe538741` | Yes |
| Production at plan creation | `a5fe8aa` | `6b04b98d665cf537d3da9842` | Yes |
| Pre-tag deploy | historical deploy | `6b048bdd4d85b74f7fc35d86` | **No** |

`release-2026-11-23` is an annotated tag on `a9ccb21`. It is the rollback baseline that includes the free-tools rewrite and the Bing verification tag. The pre-tag deploy `6b048bdd4d85b74f7fc35d86` predates that tag and must not be left published if Bing verification matters.

## Preflight checks

Run these before choosing a rollback path:

```bash
git fetch --tags origin
git rev-parse 'release-2026-11-23^{commit}'   # expect a9ccb21...
npm run bing:check
npm run bing:check:prod
```

`bing:check` inspects `site/index.html` locally. `bing:check:prod` fetches the live homepage and applies the same head-only check.

## Preferred path: Git revert

Git revert is preferred because it produces a reviewable commit, preserves the release tag, and runs the Netlify build guard.

### Roll back to the release baseline

This keeps `a9ccb21` and the Bing tag, and reverses only commits made after the release:

```bash
git switch -c rollback/2026-11-23 origin/main
git revert --no-commit release-2026-11-23..HEAD
# Resolve conflicts without deleting the msvalidate.01 line.
npm run bing:check
git diff --check
git commit -m "Roll back post-release changes while preserving Bing verification"
git push origin HEAD:main
```

If `HEAD` is already at the release commit, there is nothing to revert.

### Roll back to a point before the release

This also removes the release commit, including the Bing tag, so repair the tag before committing:

```bash
git switch -c rollback/pre-release origin/main
git revert --no-commit 'release-2026-11-23^..HEAD'
node scripts/check-bing-tag.cjs --write
npm run bing:check
git diff --check
git commit -m "Roll back to pre-release content and restore Bing verification"
git push origin HEAD:main
```

`--write` inserts only the exact tag when it is missing. It refuses to overwrite a duplicate or a tag with the wrong content.

### Revert one bad commit

```bash
git revert --no-commit <bad-commit>
npm run bing:check
git commit -m "Revert <change> while preserving Bing verification"
git push origin HEAD:main
```

### Restore only the Bing tag

Do not cherry-pick the large release commit merely to recover the tag. Run:

```bash
node scripts/check-bing-tag.cjs --write
npm run bing:check
git diff -- site/index.html
```

If the helper cannot repair the file because a duplicate or wrong tag exists, remove the invalid occurrence manually, then rerun the check. The exact line must be inside `<head>`.

## Emergency path: Netlify deploy restore

Netlify's deploy restore is fast, but it swaps the published deploy without rebuilding from Git and therefore bypasses the build guard.

### Preferred restore target

Restore the tagged release deploy, which already contains the Bing tag:

```bash
netlify api restoreSiteDeploy -d '{"site_id":"5e907ce6-0971-4862-9d52-651026e37c00","deploy_id":"6b04b6938fefb649fe538741"}'
npm run bing:check:prod
```

In the Netlify UI: **Deploys** -> select `6b04b6938fefb649fe538741` -> **Restore deploy** (or **Publish deploy**).

### Pre-tag restore is a stopgap only

Restoring `6b048bdd4d85b74f7fc35d86` removes the Bing tag:

```bash
netlify api restoreSiteDeploy -d '{"site_id":"5e907ce6-0971-4862-9d52-651026e37c00","deploy_id":"6b048bdd4d85b74f7fc35d86"}'
```

Do not stop there. Immediately create a replacement Git deploy from the intended rollback source, reinsert the tag, and publish it:

```bash
git switch -c rollback/emergency-2026-11-23 origin/main
# Apply the intended rollback content.
node scripts/check-bing-tag.cjs --write
npm run bing:check
git diff --check
git commit -m "Restore Bing verification after emergency deploy rollback"
git push origin HEAD:main
```

While the pre-tag deploy is live, Bing verification can fail. Treat that interval as an outage for verification, not as the completed rollback.

## Netlify publication check

A deploy can be `ready` without being published. Do not assume a successful build is live.

```bash
netlify api listSiteDeploys -d '{"site_id":"5e907ce6-0971-4862-9d52-651026e37c00","per_page":5}'
netlify api getSiteDeploy -d '{"site_id":"5e907ce6-0971-4862-9d52-651026e37c00","deploy_id":"<deploy-id>"}'
```

Check `state`, `published_at`, and `error_message`. If the new deploy is ready but `published_at` is null, publish it with `restoreSiteDeploy`.

## Post-rollback verification

Run all three checks:

```bash
npm run bing:check
npm run bing:check:prod
curl -fsSL https://aeogeosearch.com/ | grep -o '<meta[^>]*msvalidate[^>]*>'
```

Expected result:

- Exactly one tag, inside `<head>`.
- Content is `2E167DAFE14DBC1C787CCF4F3D1D6ED9`.
- `http://aeogeosearch.com/` and `https://www.aeogeosearch.com/` still redirect to `https://aeogeosearch.com/`.
- `published_at` is set on the deploy carrying the rollback.

Finally, in Bing Webmaster Tools, verify the **apex** property `https://aeogeosearch.com/` (not the `www` or `http` variant) and click **Verify** again. Bing can retain a cached fetch from before the tag was deployed.

## Guard in the build

`netlify.toml` now runs `node scripts/check-bing-tag.cjs` after the existing test. Any Git-based deploy that removes, duplicates, or corrupts the tag fails the build.

This guard does not protect a Netlify deploy restore because restores reuse already-built files. The post-restore production check is mandatory.

## Decision table

| Situation | Action |
| --- | --- |
| Roll back post-release changes, keep tag | Git revert `release-2026-11-23..HEAD` |
| Roll back before the release, keep tag | Git revert, then `node scripts/check-bing-tag.cjs --write` |
| Fastest safe restore | Restore release deploy `6b04b6938fefb649fe538741` |
| Emergency pre-tag restore | Restore `6b048bdd4d85b74f7fc35d86`, then immediately rebuild/publish with the tag |
| Tag missing after any operation | `node scripts/check-bing-tag.cjs --write` |
| Tag in body copy | Move it into `<head>`; body copy does not verify |

## Do not

- Put the verification tag in the visible body.
- Revert `a9ccb21` without restoring the tag.
- Leave `6b048bdd4d85b74f7fc35d86` published as the final rollback state.
- Treat `state: "ready"` as proof that the deploy is live.
