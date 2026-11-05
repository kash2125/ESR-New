# ESR-New

Independent engineering dashboard and F-ENG-001 generator for **new.getesr.com**. Source: https://github.com/kash2125/ESR-New. The existing getesr.com and design.getesr.com deployments are separate.

## Runtime

- Cloudflare Pages hosts the website. A Pages Worker handles `/api/*`.
- Cloudflare D1 stores shared projects, their audit trail, expiring staff sessions, and login throttling counters. There is no Supabase runtime dependency.
- Anyone can view projects, comments, completed projects, charts and presentations, as selected by the owner.
- Staff login is handled by the Cloudflare Worker using engineering@nswash.com and a password. Only a salted PBKDF2 hash is kept in the Cloudflare `STAFF_PASSWORD_HASH` server secret. No plaintext password is in source, browser storage, or the database.
- Sessions last eight hours and use random tokens in Secure, HttpOnly, SameSite=Strict cookies. D1 stores only token hashes. The Worker enforces the staff email allowlist, same-origin writes, login throttling and delete permissions. No Cloudflare Access account or DNS-zone migration is required.
- PDF.js parses Release and Quote/Contract JOs locally in the browser, using page one. Scans need manual entry. pdf-lib fills the bundled ESR template and downloads it. Uploaded JOs never go to the server.
- Chart and PDF libraries are built into local assets; the running app makes no external CDN requests.

## Interface

The dashboard has a navy/cyan theme and a light theme, larger text, and responsive charts. Presentation job numbers, salesperson names, engineer names and dates are enlarged. Comments have natural height and use the slide viewport for scrolling. **Expand comments** hides secondary metadata for focused reading. Dashboard comment areas can also be resized vertically.

Project changes use versions to prevent silent overwrites and keep a server audit trail. The engineering-tool link points to design.getesr.com.

## Develop and test

Use a current Node.js release (Node 22.13+ for local SQLite tests) and npm. Google Chrome is used by browser tests.

```sh
npm ci
npm run build
npm run db:local
# Import a private local backup only if desired:
node tools/import-projects.mjs ../migration-data/projects-export.json ../migration-data/projects-import.sql
npx wrangler d1 execute esr-next --local --file ../migration-data/projects-import.sql
npm run dev
```

Open http://127.0.0.1:8788. To test staff login locally, put a test password HASH in a gitignored `.dev.vars` file as `STAFF_PASSWORD_HASH`. `node tools/set-password.mjs` derives a hash with hidden input. There is no authentication bypass in production code.

```sh
npm test
npm run check
# With the dev server running:
npm run test:browser
node tools/verify-migration.mjs ../migration-data/projects-export.json
npm run package:pages
```

`public/vendor/` and `deployment/` are generated from package-lock.json and excluded from Git. Build them with `npm run build`. Production Pages configuration is `wrangler.jsonc`; local Worker preview configuration is `wrangler.worker.jsonc`. The blank ESR template and embedded branding come from the original public site. An unused legacy JPEG is omitted; no page referenced it.

## Data migration

The November 5, 2026 ZIP had an empty projects.json. A read-only export from the old dashboard recovered **59 records (41 active, 18 completed)**. All fields and historical descriptions were retained in D1; rendered HTML is sanitized at the API boundary. The local imported objects were verified field-for-field against the export.

The backup and insert-only SQL seed stay in `../migration-data/`, outside this repository and the published assets. No ongoing connection to the old database remains. New changes in one app do not synchronize to the other.

Never commit project exports, SQL data seeds, local databases, passwords, server secrets or `.dev.vars`. See [DEPLOY.md](DEPLOY.md) for deployment, DNS and credential rotation.

