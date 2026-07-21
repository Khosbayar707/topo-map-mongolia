// Ортофото файлын proxy — Referer шалгаж, Range хүсэлт дэмжиж R2-оос үйлчилнэ.
// georaster/geotiff.js нь том TIFF-ийг бүтнээр нь биш, Range-аар хэсэгчлэн татдаг.
const ALLOWED_REF = /^https:\/\/([a-z0-9-]+\.)?topo-map\.pages\.dev(\/|$)/;

function contentType(name) {
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  if (name.endsWith('.tif') || name.endsWith('.tiff')) return 'image/tiff';
  return 'application/octet-stream';
}

function isAllowed(request) {
  const ref = request.headers.get('Referer') || '';
  if (ALLOWED_REF.test(ref)) return true;
  if (ref.startsWith('http://localhost') || ref.startsWith('http://127.0.0.1')) return true;
  // Web Worker дотроос гарсан fetch Referer-гүй байж болно — browser автоматаар
  // Sec-Fetch-Site илгээдэг (curl/wget/скрипт илгээдэггүй)
  const sfs = request.headers.get('Sec-Fetch-Site') || '';
  return sfs === 'same-origin' || sfs === 'same-site';
}

function keyOf(params) {
  let raw = Array.isArray(params.path) ? params.path.join('/') : params.path;
  try { raw = decodeURIComponent(raw); } catch {}
  return raw;
}

// georaster нь url+'.ovr' байгаа эсэхийг HEAD-ээр шалгадаг. HEAD handler байхгүй
// бол SPA fallback index.html-ийг 200-оор буцааж, байхгүй файлыг "байна" гэж
// андууруулдаг тул HEAD-ийг зөв зохицуулах ёстой.
export async function onRequestHead({ request, env, params }) {
  if (!isAllowed(request)) return new Response(null, { status: 403 });
  const raw = keyOf(params);
  const head = await env.BUCKET.head('ortho/' + raw);
  if (!head) return new Response(null, { status: 404 });
  return new Response(null, {
    headers: {
      'Content-Type': contentType(raw),
      'Content-Length': String(head.size),
      'Accept-Ranges': 'bytes',
    },
  });
}

export async function onRequestGet({ request, env, params }) {
  if (!isAllowed(request)) {
    return new Response('Forbidden', { status: 403 });
  }

  let raw = Array.isArray(params.path) ? params.path.join('/') : params.path;
  try { raw = decodeURIComponent(raw); } catch {}
  const key = 'ortho/' + raw;
  const ct  = contentType(raw);

  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    // R2 binding нь Headers объектоос Range-ийг шууд уншиж чаддаг
    const obj = await env.BUCKET.get(key, { range: request.headers });
    if (!obj) return new Response('Not found', { status: 404 });
    const r = obj.range || {};
    const start = r.offset ?? 0;
    const len   = r.length ?? (obj.size - start);
    const end   = start + len - 1;
    return new Response(obj.body, {
      status: 206,
      headers: {
        'Content-Type': ct,
        'Content-Range': `bytes ${start}-${end}/${obj.size}`,
        'Content-Length': String(len),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': ct,
      'Content-Length': String(obj.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': raw.endsWith('.json') ? 'no-store' : 'public, max-age=3600',
    },
  });
}
