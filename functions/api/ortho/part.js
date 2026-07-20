/**
 * PUT /api/ortho/part?key=...&uploadId=...&partNumber=N — нэг хэсэг байршуулна
 * body: binary chunk  →  { partNumber, etag }
 */
export async function onRequestPut({ request, env }) {
  if (!env.BUCKET) {
    return Response.json({ error: 'R2 BUCKET binding тохируулаагүй байна' }, { status: 500 });
  }

  const url = new URL(request.url);
  const key        = url.searchParams.get('key');
  const uploadId   = url.searchParams.get('uploadId');
  const partNumber = parseInt(url.searchParams.get('partNumber'), 10);

  if (!key || !uploadId || !partNumber) {
    return Response.json({ error: 'key, uploadId, partNumber шаардлагатай' }, { status: 400 });
  }
  if (!key.startsWith('ortho/')) {
    return Response.json({ error: 'Буруу key' }, { status: 400 });
  }

  try {
    const mpu  = env.BUCKET.resumeMultipartUpload(key, uploadId);
    const part = await mpu.uploadPart(partNumber, request.body);
    return Response.json({ partNumber: part.partNumber, etag: part.etag });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
