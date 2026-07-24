# Deploy: btc.dataniilo.fi

The dashboard runs as a Docker container behind the existing **Caddy** reverse proxy on
the `dataniilo` server (`46.62.204.6`, Hetzner). Caddy handles HTTPS automatically.

Ports 3000–3003 are taken (homegames / fantasy / fantasyv2 / cs2), so this app uses
**host port 3004** → container port 3000.

## One-time setup

### 1. DNS

Add an A record at your DNS provider:

| Name | TTL | Type | Value |
|------|-----|------|-------|
| `btc.dataniilo.fi.` | 3600 | A | `46.62.204.6` |

No AAAA/CNAME needed. Wait for it to resolve (`dig +short btc.dataniilo.fi`).

### 2. Caddy reverse-proxy block

Append to `/home/niilo/docker/Caddyfile` (see `deploy/Caddyfile.snippet`):

```caddy
btc.dataniilo.fi {
    reverse_proxy 172.21.0.1:3004
}
```

Reload Caddy:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Caddy fetches the Let's Encrypt cert automatically once DNS resolves.

### 3. App on the server

```bash
# get the code (fresh clone recommended; the old ~/RALPH-BTC checkout is stale)
cd ~
git clone https://github.com/NiiloRi/RALPH-BTC.git btc-risk
cd btc-risk

# macro data key (optional but recommended)
cp .env.example .env
# edit .env and paste your FRED_API_KEY=...

# build & run on port 3004
docker compose up -d --build
```

Verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3004   # -> 200
```

Then open https://btc.dataniilo.fi.

## Updating after a push

Use the deploy script — it pulls, rebuilds, restarts, prunes the dangling
build layers (reclaims disk after each rebuild), and health-checks:

```bash
ssh dataniilo 'cd ~/btc-risk && ./deploy/update.sh'
```

It runs `docker image prune -f` (dangling layers only — never `-a`, which
would delete other apps' images on this shared server). Equivalent manual
steps:

```bash
cd ~/btc-risk
git pull --ff-only
docker compose up -d --build
docker image prune -f
```

## Notes

- The container fetches BTC prices from Binance and macro data from FRED at request time;
  outbound HTTPS must be allowed (it is on Hetzner). The FRED macro cache is written to a
  named volume (`macro-cache` → `/app/data`) and refreshed every 7 days.
- `HOSTNAME=0.0.0.0` in the compose env is required so the reverse proxy can reach the
  published port (Next.js standalone otherwise binds locally).
- If port 3004 is ever taken, change both the compose `ports:` mapping and the Caddy
  `reverse_proxy` target to a free port.

## Authentication

The whole site is behind a login (`src/proxy.ts` gate). Required env vars (server `.env`,
documented in `.env.example`): `AUTH_SECRET` (>= 32 chars, `openssl rand -hex 32`),
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (seed a single admin into an empty user store on
first request; ignored afterwards — change the password at `/account`).

- Users live in `/app/data/auth/users.json` inside the `macro-cache` volume — they
  survive rebuilds; deleting the volume deletes all accounts (the admin then re-seeds
  from env = the lockout recovery path).
- Rotating `AUTH_SECRET` logs every user out (break-glass lever).
- Self-registered accounts are `pending` until activated at `/admin`.
- The deploy health check hits `/login` (the root 307s for anonymous requests).
