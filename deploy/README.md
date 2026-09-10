# APEX VPS deployment

Public address: https://apex-round.com. Cloudflare proxies the root domain and `www` to the existing VPS. Both HTTP and `www` redirect to the canonical HTTPS root domain.

The website is still the clearly marked demo. Hosting and certificates do not activate live trading, balances, entries or payouts.

## Server layout
- Authored assets: `dist/` in this repository.
- Releases: `/var/www/apex/releases/<source-commit>`.
- Active release: `/var/www/apex/current` symlink.
- Nginx source template: `deploy/nginx/apex-round.conf`.
- Installed virtual host: `/etc/nginx/sites-available/apex-round`, linked from `sites-enabled`.
- ACME webroot: `/var/lib/letsencrypt`. Keep `/.well-known/acme-challenge/` reachable over HTTP for renewal.
- Certificate and private key: `/etc/letsencrypt/live/apex-round.com/` on the VPS only; never commit or download the private key.
- `certbot.timer` performs renewal checks. `/etc/letsencrypt/renewal-hooks/deploy/apex-reload-nginx` validates and reloads Nginx after successful renewal.

Cloudflare must use **Full (strict)** encryption. Its edge certificate is separate from the Let's Encrypt certificate on the VPS. Do not use Flexible. HTTPS/HTTP origin ports remain restricted to Cloudflare, and SSH remains available for administration.

## Updating the site
Deployment is currently manual; pushing to GitHub alone does not update the VPS. Export the desired commit's `dist/` to a fresh release directory, verify its assets, switch `current` to that directory, and verify the public page. Keep the previous release for rollback. APEX does not require a Node runtime on the VPS while it is a static demo.

For a renewal check, use `certbot renew --cert-name apex-round.com --dry-run --run-deploy-hooks --no-random-sleep-on-renew`. Do not repeatedly request production certificates for testing.

## Local and private previews
`START-APEX.cmd` opens local development on port 4173. `OPEN-VPS-PREVIEW.cmd` opens the VPS preview through the existing SSH key on port 4174. The latter requires the user's `stakeland` SSH configuration and `canto_key`; it does not contain the key itself. The preview virtual host is bound to VPS loopback on port 8081.

The previous website is retained in private backups under `/root/backups/`, including a verified SQLite snapshot and exported container filesystems. These backups contain secrets and must stay off GitHub and outside all web roots.

After the owner's explicit confirmation, the old stakeland web/API containers were stopped and their restart policies set to `no`. The old virtual host now returns 410 for application requests. A final SQLite snapshot was verified before shutdown; keep it alongside the earlier full backup. The old source and snapshots have not been deleted.

HTTPS and canonical redirects have been verified through Cloudflare. Certbot's simulated renewal, including the Nginx deploy hook, passed. The owner confirmed switching Cloudflare to **Full (strict)**; subsequent public HTTPS checks for both the root domain and `www` returned 200 with the APEX page. At handoff the local Windows DNS resolver still returned the prior loopback address, while the `.com` delegation and remote public resolvers returned the active Cloudflare setup. Do not replace DNS with a permanent hosts-file override; use the SSH preview while caches update.
