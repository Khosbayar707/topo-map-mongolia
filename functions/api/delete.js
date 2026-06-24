/**
 * Cloudflare Pages Function — /api/delete
 * R2-с GeoJSON файл болон layers.json-с бичлэг устгана.
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BUCKET) {
    return Response.json({ error: 'R2 BUCKET binding тохируулаагүй байна' }, { status: 500, headers: CORS });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'JSON биш payload' }, { status: 400, headers: CORS }); }

  const { name, file } = body;
  if (!name && !file) {
    return Response.json({ error: 'name эсвэл file шаардлагатай' }, { status: 400, headers: CORS });
  }

  // R2-с GeoJSON файл устгах
  if (file) {
    try { await env.BUCKET.delete(`geojson/${file}`); } catch {}
  }

  // layers.json-с бичлэг хасах
  let layers = [];
  try {
    const obj = await env.BUCKET.get('geojson/layers.json');
    if (obj) layers = JSON.parse(await obj.text());
  } catch { layers = []; }

  const before = layers.length;
  layers = layers.filter(l => l.name !== name && l.file !== file);

  await env.BUCKET.put('geojson/layers.json', JSON.stringify(layers), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache' },
  });

  return Response.json({
    success: true,
    removed: before - layers.length,
    totalLayers: layers.length,
  }, { headers: CORS });
}
