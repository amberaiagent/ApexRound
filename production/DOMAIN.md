# Domain migration to arenarounds.xyz

Owner-requested canonical domain: `arenarounds.xyz`.
The owner confirmed DNS setup and Cloudflare Full (strict) on 2026-09-14.

Status: deployed at **2026-09-14 17:39:40 UTC**. Canonical site: `https://arenarounds.xyz`.

The 5M access update was deployed first to `apex-round.com` as release `3049065271a95e6795bd7ed303b158b4b08dcd5a`. The completed migration uses main release `441902a5f8af25c682b62a5b734a69148e55b15f`, retaining the same 5M requirement. A fresh archive and the main installer were transferred to the VPS. Archive SHA-256: `6f57eded92f7df046f7376bd10b3350116e7a9528cd373d968c4e8c1cdf15895`. Never deploy the earlier `cb2ac74` archive, which still contains the superseded 10M requirement.

## DNS and certificates

- Registrar-published nameservers: `piers.ns.cloudflare.com`, `tina.ns.cloudflare.com`.
- Both root and www A records target the existing VPS `169.128.190.61` through Cloudflare.
- The official .xyz RDAP record reports registration at `2026-09-14 16:44:30 UTC`; the new delegation was not yet published in the parent zone at 16:56 UTC. Direct Cloudflare nameserver queries already returned the correct A records.
- Delegation and proxied public DNS were verified at `2026-09-14 17:36:02 UTC`, 51 minutes 32 seconds after registration. There were no registry `clientHold` or `serverHold` flags.
- The HTTP validation virtual host was prepared and verified locally for both new hostnames. Private pre-migration configuration/database backup: `/root/backups/arena-domain-20260914T165751Z/`.
- Let's Encrypt issued the new root/www certificate using `/var/lib/letsencrypt`. Its SAN covers both names and it expires on `2026-12-13`. The old-domain certificate remains installed for HTTPS redirects. The existing `certbot.timer` is active and enabled; its Nginx deploy hook validates and reloads the configuration on renewal.

## Cutover and validation

The new virtual hosts, API origins and canonical page links were deployed together with `deploy/install.py`. Old-domain and new-www requests redirect to the matching path/query on `https://arenarounds.xyz`. Private cutover backup: `/root/backups/apex-20260914T173940Z/`. The previous release and stopped API container are retained for rollback.

Public verification from the VPS passed for all eight HTTPS pages, old-domain/www redirects with preserved path/query, API no-store responses and origin enforcement (new canonical accepted, old-domain/www origins rejected). Fourteen public files, including the favicon, matched the release byte for byte. The live policy is 5M with message version 3; the API remains in prelaunch with no token or activation timestamp. All six active/archive database tables matched the cutover backup exactly; integrity and foreign-key checks passed. Never restore a pre-retirement database during rollback.

At verification time, the owner's local network DNS resolver (`192.168.100.1`) still returned `127.0.0.1` for the new root and www despite correct public DNS. Clearing the Windows DNS cache did not change that response, and the in-app browser could not load the new domain. No router, DNS-server or security settings were changed. Public HTTPS checks succeeded independently; local browser reachability needs rechecking after the network resolver updates.
