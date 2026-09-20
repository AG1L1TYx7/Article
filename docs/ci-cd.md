# CI/CD

Every push and pull request is checked automatically by GitHub Actions
(`.github/workflows/ci.yml`). Pushes to `main` also build the cPanel
bundle and, once you have given the repository the server details, deploy
it. Nothing reaches the server unless every check has passed first.

## What runs, and when

| Job | Runs on | What it does | Roughly |
| --- | --- | --- | --- |
| **checks** | every push and PR | `npm ci`, Prisma client, type-check, lint, unit tests, dependency audit | 2 min |
| **e2e** | every push and PR, after checks | Starts MariaDB 11 with `innodb_ft_min_token_size=2`, runs the migrations and seed, builds the production site, runs the whole Playwright suite. Failed runs upload their traces as an artifact. | 12–20 min |
| **bundle** | pushes to `main`, after e2e | `npm run build:cpanel`; keeps `cpanel-dist/` as a downloadable artifact for 14 days | 5 min |
| **docker** | pushes to `main` | Builds the Docker image to prove the Dockerfile still works (does not push it anywhere) | 5 min |
| **deploy** | pushes to `main`, after bundle, **only if enabled** | rsyncs the bundle to the server over SSH, runs `node setup.js check` and `migrate`, restarts Passenger, then checks the site answers 200 | 3 min |

A second workflow, **Load test** (`load-test.yml`), is run by hand from
the Actions tab against a URL you enter. See [operations.md](operations.md).

Dependabot (`.github/dependabot.yml`) opens grouped update PRs every
Monday; the same CI decides whether they are safe to merge.

## Reading a run

Actions tab → the run → a red job → the failing step. The e2e job's
failures come with a `playwright-traces` artifact: download it, unzip,
and open a trace with

```bash
npx playwright show-trace path/to/trace.zip
```

which replays the browser step by step, with network and console.

The pull request page shows the same jobs as checks. Protect `main`
(Settings → Branches → Add rule → require status checks `checks` and
`e2e`) and nothing can be merged that fails them.

## Enabling deployment to cPanel

The deploy job is off until you add the server details. It needs SSH
access to the cPanel account, which most hosts provide (cPanel → SSH
Access, or ask support to enable it).

### 1. A deploy key

On your own machine:

```bash
ssh-keygen -t ed25519 -C "github-deploy" -f cpanel_deploy_key -N ""
```

Put the **public** half (`cpanel_deploy_key.pub`) on the server:
cPanel → SSH Access → Manage SSH Keys → Import Key, then **Authorize**
it. Check it works before going further:

```bash
ssh -i cpanel_deploy_key -p 22 youraccount@yourdomain.com 'echo ok'
```

### 2. Repository secrets

GitHub → the repository → Settings → Secrets and variables → Actions →
**Secrets** → New repository secret, one for each:

| Secret | Value |
| --- | --- |
| `CPANEL_SSH_HOST` | The server hostname or IP (from cPanel → SSH Access) |
| `CPANEL_SSH_PORT` | Usually `22`; some hosts use another — SSH Access says |
| `CPANEL_SSH_USER` | Your cPanel username |
| `CPANEL_SSH_KEY` | The whole contents of `cpanel_deploy_key` (the **private** file, including the BEGIN/END lines) |
| `CPANEL_APP_ROOT` | The application root you chose in Setup Node.js App, as an absolute path, e.g. `/home/youraccount/dispatch` |
| `CPANEL_NODE_ACTIVATE` | The `source /home/.../nodevenv/.../bin/activate` line shown at the top of Setup Node.js App. Lets the job run the right `node`. |

Optionally `E2E_AUTH_SECRET`: any random string, used only by the test
job. Without it a fixed test value is used, which is fine.

The deploy key is the only thing here that could do harm if it leaked,
and it can only reach that one cPanel account. Never put your database
password or `AUTH_SECRET` in GitHub — they live in the server's `.env`,
which the deploy deliberately never touches.

### 3. Repository variables

Same page → **Variables** tab:

| Variable | Value |
| --- | --- |
| `CPANEL_DEPLOY` | `true` — this is the switch. Delete it or set anything else to stop deploying. |
| `SITE_URL` | `https://yourdomain.com` — shown on the environment and used for the post-deploy smoke test |

### 4. The first deploy

The pipeline uploads code and runs migrations, but it does not create the
database, write `.env`, or create the first admin: those are one-time
steps you do once, by hand, following [cpanel.md](cpanel.md) steps 3
to 6. After that, every push to `main` that passes its checks goes live
on its own.

Optionally require approval: Settings → Environments → `production` →
Required reviewers. The deploy job then waits for a click before it
touches the server.

## When a deploy goes wrong

The job stops at the first failing step, and the site keeps running the
previous version until `tmp/restart.txt` is touched, which is the last
step — so a failed `setup.js check` or `migrate` leaves the old code
serving. If the smoke test fails after the restart, cPanel → Setup
Node.js App shows the Passenger log; `node setup.js check` on the server
(cPanel → Terminal) explains most causes in plain words.

To roll back, re-run the previous successful workflow (Actions → that run
→ Re-run all jobs) or download its `cpanel-dist` artifact and upload it
by hand. Migrations are forward-only; a rollback across a schema change
also needs the database restored — see [operations.md](operations.md).

## Running the same checks locally

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run audit
npm run test:e2e          # builds and starts the production server itself
npm run build:cpanel      # what the bundle job produces
```
