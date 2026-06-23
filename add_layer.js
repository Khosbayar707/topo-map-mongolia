/**
 * Shapefile → GeoJSON → Cloudflare R2
 * =====================================
 * Хэрэглээ:
 *   node add_layer.js                     ← data/ дотох бүх шинэ давхарга
 *   node add_layer.js "Аймгийн хил"       ← нэг давхарга
 *   node add_layer.js --list              ← R2 дахь давхаргуудын жагсаалт
 *
 * Бэлтгэл:
 *   1. data/<ДавхаргынНэр>/<файл>.shp хуулах (.dbf .prj .shx хамт)
 *   2. node add_layer.js ажиллуулах
 */

require('dotenv').config();
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, 'data');
const CACHE_DIR  = path.join(__dirname, 'geojson_cache');
const OGR2OGR    = 'C:\\Program Files\\QGIS 3.26.3\\bin\\ogr2ogr.exe';
const BUCKET     = 'topo-map-tiles';
const R2_PUB_URL = 'https://pub-2d7bdb113e09406eab77dc06705c4461.r2.dev';

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── S3 client ─────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_KEY_ID,
    secretAccessKey: process.env.R2_SECRET,
  },
});

// ── Helpers ───────────────────────────────────────────────────────────
function safeName(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_');
}

async function getLayersJson() {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'geojson/layers.json' }));
    const body = await res.Body.transformToString();
    return JSON.parse(body);
  } catch {
    return [];
  }
}

async function putLayersJson(layers) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key:    'geojson/layers.json',
    Body:   JSON.stringify(layers, null, 2),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=60',
  }));
}

async function uploadGeoJSON(localPath, key) {
  const data = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key:    key,
    Body:   data,
    ContentType: 'application/geo+json',
    CacheControl: 'public, max-age=3600',
  }));
}

function findShp(dir) {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find(x => x.toLowerCase().endsWith('.shp'));
  return f ? path.join(dir, f) : null;
}

function convertToGeoJSON(shpPath, outPath) {
  execFileSync(OGR2OGR, [
    '-f', 'GeoJSON',
    '-t_srs', 'EPSG:4326',
    '-lco', 'RFC7946=YES',
    outPath, shpPath
  ]);
}

// ── Main operations ───────────────────────────────────────────────────
async function listLayers() {
  const layers = await getLayersJson();
  if (!layers.length) { console.log('R2 дэх давхарга алга.'); return; }
  console.log(`\nR2 дэх давхаргууд (${layers.length}):`);
  layers.forEach((l, i) => console.log(`  ${i + 1}. ${l.name}  ${l.ready ? '✓' : '⚠'}`));
  console.log(`\nURL: ${R2_PUB_URL}/geojson/layers.json`);
}

async function processLayer(layerName) {
  const dir    = path.join(DATA_DIR, layerName);
  const shp    = findShp(dir);
  const safe   = safeName(layerName);
  const cached = path.join(CACHE_DIR, `${safe}.geojson`);
  const r2Key  = `geojson/${safe}.geojson`;

  if (!shp) { console.error(`  ✗ "${layerName}": .shp файл олдсонгүй (${dir})`); return false; }

  // Convert shp → geojson if newer
  const shpTime  = fs.statSync(shp).mtimeMs;
  const cacheTime = fs.existsSync(cached) ? fs.statSync(cached).mtimeMs : 0;

  if (shpTime > cacheTime) {
    console.log(`  → ogr2ogr хөрвүүлж байна...`);
    try {
      if (fs.existsSync(cached)) fs.unlinkSync(cached);
      convertToGeoJSON(shp, cached);
      const size = (fs.statSync(cached).size / 1024 / 1024).toFixed(1);
      console.log(`  → ${safe}.geojson (${size} MB)`);
    } catch (e) {
      console.error(`  ✗ ogr2ogr алдаа: ${e.message.split('\n')[0]}`);
      return false;
    }
  } else {
    console.log(`  → Кэшлэгдсэн GeoJSON ашиглана`);
  }

  // Upload to R2
  console.log(`  → R2-д upload хийж байна...`);
  await uploadGeoJSON(cached, r2Key);
  console.log(`  ✓ ${R2_PUB_URL}/${r2Key}`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);

  // --list
  if (args.includes('--list')) { await listLayers(); return; }

  // Check credentials
  if (!process.env.R2_ENDPOINT) {
    console.error('ERROR: .env файл байхгүй эсвэл R2_ENDPOINT тохируулаагүй байна.');
    process.exit(1);
  }

  if (!fs.existsSync(OGR2OGR)) {
    console.error(`ERROR: ogr2ogr олдсонгүй:\n  ${OGR2OGR}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════');
  console.log('  Shapefile → R2 нэмэгч');
  console.log('═══════════════════════════════════════════\n');

  // Determine layers to process
  let targets = [];
  if (args.length && !args[0].startsWith('--')) {
    targets = args; // explicit layer names
  } else {
    // Auto-scan data/ folder
    if (!fs.existsSync(DATA_DIR)) { console.error(`data/ хавтас олдсонгүй: ${DATA_DIR}`); process.exit(1); }
    targets = fs.readdirSync(DATA_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && findShp(path.join(DATA_DIR, e.name)))
      .map(e => e.name);
    if (!targets.length) { console.log('data/ дотор shapefile олдсонгүй.'); return; }
  }

  console.log(`Давхарга: ${targets.join(', ')}\n`);

  // Process each layer
  const succeeded = [];
  for (const name of targets) {
    console.log(`📂 "${name}"`);
    const ok = await processLayer(name);
    if (ok) succeeded.push(name);
    console.log();
  }

  if (!succeeded.length) { console.log('Амжилттай давхарга алга.'); return; }

  // Update layers.json on R2
  console.log('→ layers.json шинэчилж байна...');
  const existing = await getLayersJson();
  const existingNames = new Set(existing.map(l => l.name));

  for (const name of succeeded) {
    const safe = safeName(name);
    if (!existingNames.has(name)) {
      existing.push({ name, file: `${safe}.geojson`, ready: true });
      console.log(`  + "${name}" нэмэгдлээ`);
    } else {
      console.log(`  ↺ "${name}" шинэчлэгдлээ`);
    }
  }

  await putLayersJson(existing);
  console.log(`  ✓ layers.json (${existing.length} давхарга)\n`);

  console.log('✅ Дууслаа!');
  console.log(`\n🌐 Вэб дээр харах: https://topo-map.pages.dev`);
  console.log('   (Хуудсыг refresh хийнэ үү)\n');
}

main().catch(e => { console.error('Алдаа:', e.message); process.exit(1); });
