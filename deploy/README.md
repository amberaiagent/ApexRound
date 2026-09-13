# APEX VPS deployment

Public address: https://apex-round.com. Cloudflare proxies the root and www; HTTP and www redirect to canonical HTTPS. Keep Cloudflare **Full (strict)** and the existing Cloudflare-only firewall rules.

## Server layout
- Static releases: `/var/www/apex/releases/<source-commit>`; active symlink `/var/www/apex/current`.
- Private API source: `/opt/apex/releases/<source-commit>`.
- Docker image: `apex-api:<source-commit>`; container `apex-api`, Node 24, user node, read-only root, dropped capabilities and loopback port 8082.
- Persistent data: `/var/lib/apex-api/arena.sqlite` plus its WAL files, owned by uid 1000, outside all web roots. **Never replace this directory during deployment.**
- Public Nginx: `/etc/nginx/sites-available/apex-round`.
- SSH preview Nginx: `/etc/nginx/conf.d/apex-preview.conf`, loopback port 8081.
- Both Nginx hosts proxy `/api/` to loopback 8082 with no caching. Only canonical HTTPS and the private SSH preview origin may submit entries.
- ACME webroot `/var/lib/letsencrypt`; certificate `/etc/letsencrypt/live/apex-round.com/`. Keep the private key on the server.
- Existing `certbot.timer` and deploy hook validate/reload Nginx on renewal.

## Deploy
GitHub push alone does not deploy. Run tests, commit, export the exact commit's `dist api scripts/lib deploy package.json package-lock.json .dockerignore` into a tar archive. Transfer to the existing VPS and verify its SHA-256. `deploy/install.py` installs this archive given the commit and digest, builds the API image, retains the previous release/config/container for rollback, switches the static symlink and checks the preview/API.

Only `dist/` becomes public. Tests, local data, metadata, archives and secrets are excluded. An API deployment never invokes token activation. See `production/TOKEN.md` for that separate owner-triggered action.

Check public HTTPS after deployment, the prelaunch state (unless previously activated), main-timer behavior and private preview. API routes must return no-store. There is no public admin/reset route. Keep previous images/releases and backups; do not prune during routine deployment.

## Frontend-only design updates

For a design-only release, export the exact committed `dist/` tree with `git archive --format=tar --output=arena-design.tar <40-character-commit> dist`, calculate its SHA-256, and transfer the archive plus `deploy/static.py` to the VPS. Run `python3 static.py /path/to/arena-design.tar <40-character-commit> <sha256>` as root. The script accepts only regular files and directories under `dist/`, saves the previous frontend symlink and API launch snapshot in a private `/root/backups/arena-design-<UTCstamp>` directory, and switches `/var/www/apex/current` atomically. It checks the served HTML, JavaScript and CSS bytes and verifies that `activatedAt` and the access-token address have not changed; a failed check restores the previous symlink. Existing releases are retained. This flow does not change the API container, database, Nginx configuration or certificates.

## Data backup and rollback
Before updates, the installer uses Python SQLite's online backup API to make a consistent snapshot (including committed WAL data) in a new private `/root/backups/apex-<timestamp>` directory and verifies integrity. It also saves Nginx configurations, active release and previous image ID. It never includes private data in the deployment archive.

During a live registration period, use the same online SQLite backup procedure for further snapshots and copy them to the owner's private backup storage. Do not copy just the active main SQLite file while WAL is in use. No off-server backup destination is configured yet.

On deployment failure the installer restores Nginx, the previous static symlink and previous container. The persistent database stays intact. To roll back later, use the recorded image/release/configs; review database-schema compatibility first. Do not restore an old launch/entry snapshot just to roll back frontend code: this would discard newer registrations.

## Local and private previews
Install dependencies once with `npm ci`. `START-APEX.cmd` runs the local Node service on 4173 using a separate ignored `data/arena.sqlite`. Local activation cannot start the public arena.
`OPEN-VPS-PREVIEW.cmd` uses the existing SSH key to open the actual VPS release at 4174. No keys are in the repository.

## Existing infrastructure
The prior stakeland virtual host remains disabled (410). Its two containers remain stopped with restart policy no, and private backups remain under `/root/backups/`. Do not delete them.

Let's Encrypt renewal and the Nginx deploy hook were previously tested successfully; do not repeatedly request production certificates. Cloudflare strict TLS was confirmed. Do not create permanent hosts-file workarounds for DNS cache delays.
