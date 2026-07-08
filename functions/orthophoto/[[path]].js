// Ортофото tile proxy — Referer шалгаж R2-оос үйлчилнэ (hotlink/scrape хамгаалалт)
const ALLOWED_REF = /^https:\/\/([a-z0-9-]+\.)?topo-map\.pages\.dev(\/|$)/;

export async function onRequestGet({ request, env, params }) {
  const ref = request.headers.get('Referer') || '';
  const isLocal = ref.startsWith('http://localhost') || ref.startsWith('http://127.0.0.1');
  if (!ALLOWED_REF.test(ref) && !isLocal) {
    return new Response('Forbidden', { status: 403 });
  }

  const key = 'orthophoto/' + (Array.isArray(params.path) ? params.path.join('/') : params.path);
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
