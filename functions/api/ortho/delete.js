/**
 * POST /api/ortho/delete — ортофото устгаж, list.json шинэчилнэ
 * body: { file }
 */
export async function onRequestPost({ request, env }) {
  if (!env.BUCKET) {
    return Response.json({ error: 'R2 BUCKET binding тохируулаагүй байна' }, { status: 500 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'JSON биш payload' }, { status: 400 }); }

  const { file } = body;
  if (!file || file.includes('/') || file.includes('..')) {
    return Response.json({ error: 'Зөв file нэр шаардлагатай' }, { status: 400 });
  }

  try { await env.BUCKET.delete(`ortho/${file}`); } catch {}

  let list = [];
  try {
    const obj = await env.BUCKET.get('ortho/list.json');
    if (obj) list = await obj.json();
  } catch {}
  list = list.filter(l => l.file !== file);

  await env.BUCKET.put('ortho/list.json', JSON.stringify(list), {
    httpMetadata: { contentType: 'application/json' },
  });

  return Response.json({ success: true, count: list.length });
}
