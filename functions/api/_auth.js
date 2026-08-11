/**
 * Shared admin auth + origin-locked CORS for mutating /api/* handlers.
 * Requires Cloudflare Pages secret: ADMIN_SECRET
 */

const ALLOWED_ORIGINS = new Set([
  'https://topo-map.pages.dev',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export function corsHeaders(request, methods = 'POST, OPTIONS') {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export function optionsResponse(request, methods = 'POST, OPTIONS') {
  return new Response(null, { status: 204, headers: corsHeaders(request, methods) });
}

/**
 * @returns {Response|null} Error response if unauthorized; null if OK.
 */
export function assertAdmin(request, env) {
  const cors = corsHeaders(request, request.method === 'PUT' ? 'PUT, OPTIONS' : 'POST, OPTIONS');

  if (!env.ADMIN_SECRET) {
    return Response.json(
      { error: 'ADMIN_SECRET тохируулаагүй байна' },
      { status: 500, headers: cors }
    );
  }

  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';

  if (!token || !timingSafeEqual(token, env.ADMIN_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  return null;
}
