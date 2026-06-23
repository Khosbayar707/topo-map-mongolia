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
  if (!env.BUCKET) return Response.json({ error: 'R2 binding алга' }, { status: 500, headers: CORS });

  const { name, file } = await request.json();
  if (!name || !file) return Response.json({ error: 'name болон file шаардлагатай' }, { status: 400, headers: CORS });

  // GeoJSON файл устгах
  await env.BUCKET.delete(`geojson/${file}`);

  // layers.json шинэчлэх
  let layers = [];
  try {
    const obj = await env.BUCKET.get('geojson/layers.json');
    if (obj) layers = JSON.parse(await obj.text());
  } catch {}

  layers = layers.filter(l => l.name !== name);
  await env.BUCKET.put('geojson/layers.json', JSON.stringify(layers), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache' },
  });

  return Response.json({ success: true, remaining: layers.length }, { headers: CORS });
}
