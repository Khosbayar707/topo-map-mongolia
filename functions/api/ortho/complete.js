/**
 * POST /api/ortho/complete — multipart upload дуусгаж, list.json шинэчилнэ
 * body: { key, uploadId, parts:[{partNumber,etag}], name, file, size }
 */
import { assertAdmin, corsHeaders, optionsResponse } from '../_auth.js';

export async function onRequestOptions({ request }) {
  return optionsResponse(request, 'POST, OPTIONS');
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request, 'POST, OPTIONS');

  const denied = assertAdmin(request, env);
  if (denied) return denied;

  if (!env.BUCKET) {
    return Response.json({ error: 'R2 BUCKET binding тохируулаагүй байна' }, { status: 500, headers: cors });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'JSON биш payload' }, { status: 400, headers: cors }); }

  const { key, uploadId, parts, name, file, size } = body;
  if (!key || !uploadId || !Array.isArray(parts) || !name || !file) {
    return Response.json({ error: 'key, uploadId, parts, name, file шаардлагатай' }, { status: 400, headers: cors });
  }
  if (!key.startsWith('ortho/')) {
    return Response.json({ error: 'Буруу key' }, { status: 400, headers: cors });
  }

  try {
    const mpu = env.BUCKET.resumeMultipartUpload(key, uploadId);
    await mpu.complete(parts);
  } catch (err) {
    return Response.json({ error: 'Upload дуусгаж чадсангүй: ' + err.message }, { status: 500, headers: cors });
  }

  // list.json шинэчлэх
  let list = [];
  try {
    const obj = await env.BUCKET.get('ortho/list.json');
    if (obj) list = await obj.json();
  } catch {}

  const entry = { name, file, size: size || 0, date: new Date().toISOString().slice(0, 10) };
  const idx = list.findIndex(l => l.file === file);
  if (idx >= 0) list[idx] = entry; else list.push(entry);

  await env.BUCKET.put('ortho/list.json', JSON.stringify(list), {
    httpMetadata: { contentType: 'application/json' },
  });

  return Response.json({ success: true, file, count: list.length }, { headers: cors });
}
