/**
 * PUT /api/ortho/part?key=...&uploadId=...&partNumber=N — нэг хэсэг байршуулна
 * body: binary chunk  →  { partNumber, etag }
 */
import { assertAdmin, corsHeaders, optionsResponse } from '../_auth.js';

export async function onRequestOptions({ request }) {
  return optionsResponse(request, 'PUT, OPTIONS');
}

export async function onRequestPut({ request, env }) {
  const cors = corsHeaders(request, 'PUT, OPTIONS');

  const denied = assertAdmin(request, env);
  if (denied) return denied;

  if (!env.BUCKET) {
    return Response.json({ error: 'R2 BUCKET binding тохируулаагүй байна' }, { status: 500, headers: cors });
  }

  const url = new URL(request.url);
  const key        = url.searchParams.get('key');
  const uploadId   = url.searchParams.get('uploadId');
  const partNumber = parseInt(url.searchParams.get('partNumber'), 10);

  if (!key || !uploadId || !partNumber) {
    return Response.json({ error: 'key, uploadId, partNumber шаардлагатай' }, { status: 400, headers: cors });
  }
  if (!key.startsWith('ortho/')) {
    return Response.json({ error: 'Буруу key' }, { status: 400, headers: cors });
  }

  try {
    const mpu  = env.BUCKET.resumeMultipartUpload(key, uploadId);
    const part = await mpu.uploadPart(partNumber, request.body);
    return Response.json({ partNumber: part.partNumber, etag: part.etag }, { headers: cors });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers: cors });
  }
}
