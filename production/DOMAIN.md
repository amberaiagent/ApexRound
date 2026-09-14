# Domain migration to arenarounds.xyz

Owner-requested canonical domain: `arenarounds.xyz`.
The owner confirmed DNS setup and Cloudflare Full (strict) on 2026-09-14.

Status: prepared; DNS delegation and certificate issuance must complete before the final release is deployed.

## DNS and certificates

- Registrar-published nameservers: `piers.ns.cloudflare.com`, `tina.ns.cloudflare.com`.
- Both root and www A records target the existing VPS `169.128.190.61` through Cloudflare.
- The official .xyz RDAP record reports registration at `2026-09-14 16:44:30 UTC`; the new delegation was not yet published in the parent zone at 16:56 UTC. Direct Cloudflare nameserver queries already returned the correct A records.
- The HTTP validation virtual host was prepared and verified locally for both new hostnames. Private pre-migration configuration/database backup: `/root/backups/arena-domain-20260914T165751Z/`.
- Issue one Let's Encrypt certificate for the new root and www using the existing ACME webroot `/var/lib/letsencrypt`. Keep the old-domain certificate for its HTTPS redirects. The existing `certbot.timer` and Nginx deploy hook handle renewals.

## Cutover and validation

Deploy the new virtual hosts, API origins and canonical page links together with `deploy/install.py`. All old-domain and new-www requests redirect to the matching path/query on `https://arenarounds.xyz`.

Check public HTTPS for all eight pages, redirects, API no-store responses, favicon bytes, allowed-origin enforcement and prelaunch state. The database, retired token metadata and archived signature bytes must remain unchanged. Never restore a pre-retirement database for a domain migration or rollback. No token is activated by this change.
