/**
 * POST /api/ortho/create — multipart upload эхлүүлнэ
 * body: { name }  →  { key, uploadId }
 */
export async function onRequestPost({ request, env }) {
  if (!env.BUCKET) {
    return Response.json({ error: 'R2 BUCKET binding тохируулаагүй байна' }, { status: 500 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'JSON биш payload' }, { status: 400 }); }

  const { name } = body;
  if (!name) return Response.json({ error: 'name шаардлагатай' }, { status: 400 });

  // ASCII-safe файлын нэр (Кирилл/зайг хасна)
  const asciiPart = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
  const fileBase  = asciiPart.replace(/^_+|_+$/g, '') || Date.now().toString(36);
  const key = `ortho/${fileBase}.tif`;

  const mpu = await env.BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType: 'image/tiff' },
  });

  return Response.json({ key: mpu.key, uploadId: mpu.uploadId, file: `${fileBase}.tif` });
}
