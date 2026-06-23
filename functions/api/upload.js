/**
 * Cloudflare Pages Function — /api/upload
 * Browser-аас ирсэн GeoJSON-г R2-д хадгалж, layers.json шинэчилнэ.
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

  const { name, geojson } = body;
  if (!name || !geojson) {
    return Response.json({ error: 'name болон geojson шаардлагатай' }, { status: 400, headers: CORS });
  }

  // ASCII-safe filename — Кирилл/зай URL-д асуудал үүсгэхгүйн тулд
  // Кирилл үсгийг хасаад үлдсэнийг авна; хэрэв хоосон бол timestamp ашиглана
  const asciiPart = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9\-]/g, '');
  const fileBase  = asciiPart.replace(/^_+|_+$/g, '') || Date.now().toString(36);
  const fileName  = `${fileBase}.geojson`;
  const geoKey    = `geojson/${fileName}`;

  // GeoJSON → R2
  await env.BUCKET.put(geoKey, JSON.stringify(geojson), {
    httpMetadata: {
      contentType:  'application/geo+json',
      cacheControl: 'public, max-age=3600',
    },
  });

  // layers.json шинэчлэх
  let layers = [];
  try {
    const obj = await env.BUCKET.get('geojson/layers.json');
    if (obj) layers = JSON.parse(await obj.text());
  } catch { layers = []; }

  const existing = layers.findIndex(l => l.name === name);
  if (existing >= 0) {
    layers[existing].file  = fileName;
    layers[existing].ready = true;
  } else {
    layers.push({ name, file: fileName, ready: true });
  }

  await env.BUCKET.put('geojson/layers.json', JSON.stringify(layers), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache' },
  });

  const featCount = geojson.features?.length ?? '?';
  return Response.json({
    success: true, name, key: geoKey,
    features: featCount, totalLayers: layers.length,
  }, { headers: CORS });
}
