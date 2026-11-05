# Deploy ESR-New independently

Target: **new.getesr.com**. Cloudflare Pages project: `esr-new`. D1 database: `esr-next`. Only this subdomain and these resources belong to this deployment. Do not modify the root, www or design DNS records or their deployments.

## Build and publish

```sh
npm ci
npm test
npm run check
npm run deploy
```

Wrangler must be logged into the intended Cloudflare account. `npm run deploy` builds the local chart/PDF libraries, copies assets to `deployment/`, compiles the API as `_worker.js`, writes `_routes.json`, and deploys to the separate Pages project. Only `/api/*` runs the Worker. The `DB` binding and allowed staff email settings are in wrangler.jsonc; the password hash is a Cloudflare secret and is not in that file.

Cloudflare Pages requires its config at the default wrangler.jsonc path. The local Worker preview uses the separate wrangler.worker.jsonc. Current Wrangler may delegate creation of a new Pages project to Workers; the initial `esr-new` project was created with `--force` to keep it on Pages. Existing-project deployments need no force flag.

For automatic GitHub builds, connect **kash2125/ESR-New**, production branch `main`, build command `npm run package:pages`, output directory `deployment`. GitHub integration authorization is performed by the owner in Cloudflare. This project was initially deployed through Wrangler; pushing source alone does not trigger deployment until Git integration or CI is configured.

## Database

```sh
npm run db:remote
node tools/import-projects.mjs ../migration-data/projects-export.json ../migration-data/projects-import.sql
npx wrangler d1 execute esr-next --remote --file ../migration-data/projects-import.sql
npx wrangler d1 execute esr-next --remote --command "SELECT count(*) AS records FROM projects"
```

The initial snapshot contains 59 records. Imports insert missing project numbers and never overwrite existing ones. Keep data seeds outside Git and the assets folder. The two apps are independent; they do not synchronize updates. Never run old Supabase cleanup/import scripts against this project.

## Staff password and sessions

The only approved account is `engineering@nswash.com`. It can create, edit, complete, restore and delete projects. Public visitors can only read.

To rotate the password, run `node tools/set-password.mjs`, enter the new password through hidden input, and save its resulting hash using `npx wrangler pages secret put STAFF_PASSWORD_HASH --project-name esr-new`. Paste only the hash at the secret prompt. Redeploy afterward. Keep the plaintext password out of commands, source and logs. To revoke all current staff sessions after rotation, execute `DELETE FROM staff_sessions` against the ESR D1 database. Do not delete project records.

The current password is configured as a Cloudflare server secret; it is not documented here. Sessions expire after eight hours, are revoked on logout, and store only hashed tokens in D1. Five failed sign-in attempts from an IP in a 15-minute window are allowed before throttling. Same-origin checks protect state-changing endpoints.

Cloudflare Access was considered, but the owner selected application-managed password login because Access was not enabled and the domain uses external DNS. No Access settings or root nameserver changes are needed.

## Custom domain

The NEW Pages project has `new.getesr.com` registered as a custom domain. Its DNS CNAME is **new → esr-new.pages.dev** at the existing DNS provider. Wait for verification and TLS before using the custom domain. Keep getesr.com, www.getesr.com and design.getesr.com unchanged.

Staff cookies are hostname-specific: signing into esr-new.pages.dev does not sign into new.getesr.com. Use the custom domain for normal work once active.

## Verify and back up

- Public visitors see the migrated projects and cannot change them.
- The engineering account signs in, shows staff controls and can save updates; logout removes access.
- A stale version receives a conflict rather than replacing a newer update.
- Presentation metadata is readable, comments expand, fullscreen works, and mobile pages fit.
- Release and Quote/Contract files auto-fill JO Details and populate downloaded ESRs. The automated checks use synthetic PDFs; check a real company JO before relying on extraction for production work.
- The original sites remain on their original deployments.

Export D1 periodically with `npx wrangler d1 export esr-next --remote --output <private-backup.sql>`. Keep backups outside this public repo. Rolling back a Pages deployment does not roll back D1 data.
