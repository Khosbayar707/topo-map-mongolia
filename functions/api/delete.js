/**
 * Cloudflare Pages Function — /api/delete
 * R2-с GeoJSON файл болон layers.json-с бичлэг устгана.
 */

import { assertAdmin, corsHeaders, optionsResponse } from './_auth.js';

const SAFE_GEOJSON = /^[a-zA-Z0-9._-]+\.geojson$/;

export async function onRequestOptions({ request }) {
  return optionsResponse(request, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, 'POST, OPTIONS');

  const denied = assertAdmin(request, env);
  if (denied) return denied;

  if (!env.BUCKET) {
    return Response.json({ error: 'R2 BUCKET binding тохируулаагүй байна' }, { status: 500, headers: cors });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'JSON биш payload' }, { status: 400, headers: cors }); }

  const { name, file } = body;
  if (!name && !file) {
    return Response.json({ error: 'name эсвэл file шаардлагатай' }, { status: 400, headers: cors });
  }

  if (file) {
    if (typeof file !== 'string' || file.includes('/') || file.includes('..') || !SAFE_GEOJSON.test(file)) {
      return Response.json({ error: 'Зөв file нэр шаардлагатай' }, { status: 400, headers: cors });
    }
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
  }, { headers: cors });
}
