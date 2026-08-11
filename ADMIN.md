# Admin secret setup

Mutating APIs (`/api/upload`, `/api/delete`, `/api/ortho/*`) require a Bearer token that matches the Cloudflare Pages secret `ADMIN_SECRET`. The `/upload` and `/ortho` password gates use the same string; their SHA-256 hash is embedded as `PASSWORD_HASH` in those HTML files.

## One-time setup

1. Choose a strong secret (do not reuse any old public password).

2. Set it in Cloudflare (never commit this value):

```bash
npx wrangler pages secret put ADMIN_SECRET --project-name=topo-map
```

3. Compute the SHA-256 hex of the **exact same** secret:

```bash
echo -n 'YOUR_SECRET' | shasum -a 256
```

4. Set `PASSWORD_HASH` in both:

- `public/upload.html` and `deploy/upload.html`
- `public/ortho.html` and `deploy/ortho.html`

5. Redeploy Pages so Functions receive `ADMIN_SECRET`.

## Local Wrangler

For `wrangler pages dev`, put the secret in `.dev.vars` (gitignored if you use Wrangler defaults):

```
ADMIN_SECRET=your-local-secret
```

`PASSWORD_HASH` in the HTML must match that local secret’s SHA-256.

## Verify

```bash
# Expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://topo-map.pages.dev/api/delete \
  -H 'content-type: application/json' \
  -d '{"name":"test"}'

# Expect 401 with wrong token
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://topo-map.pages.dev/api/delete \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer wrong' \
  -d '{"name":"test"}'
```

Unlock `/upload` or `/ortho` with the secret, then upload/delete should succeed.
