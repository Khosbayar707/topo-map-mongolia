/**
 * Upload tiles + geojson → Cloudflare R2
 * node upload_r2.js
 *
 * Wrangler-ийн S3-compatible API ашиглан batch upload хийнэ.
 * Шаардлага: npm install @aws-sdk/client-s3
 */
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs   = require('fs');
const path = require('path');

// ── Тохиргоо ──────────────────────────────────────────────────────────
// wrangler r2 token үүсгэх: https://dash.cloudflare.com → R2 → Manage R2 API tokens
// Эсвэл: wrangler r2 bucket credentials topo-map-tiles
const BUCKET   = 'topo-map-tiles';
const ENDPOINT = process.env.R2_ENDPOINT; // https://<ACCOUNT_ID>.r2.cloudflarestorage.com
const KEY_ID   = process.env.R2_KEY_ID;
const SECRET   = process.env.R2_SECRET;

const TILES_DIR  = path.join(__dirname, 'public', 'tiles');
const GEOJSON_DIR = path.join(__dirname, 'public', 'geojson');
const CONCURRENCY = 20;

if (!ENDPOINT || !KEY_ID || !SECRET) {
  console.error(`
ERROR: R2 credentials байхгүй байна.

Дараах командаар .env файл үүсгэнэ үү:

1. Cloudflare dashboard → R2 → "Manage R2 API Tokens" → "Create API Token"
   - Permission: Object Read & Write
   - Specify bucket: topo-map-tiles

2. .env файл үүсгэх:
   R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   R2_KEY_ID=<Access Key ID>
   R2_SECRET=<Secret Access Key>

3. Ажиллуулах:
   node -r dotenv/config upload_r2.js
`);
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
});

async function uploadFile(localPath, key, contentType) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key:    key,
    Body:   body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  }));
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function collectFiles(dir, prefix, ext, contentType) {
  const files = [];
  function walk(d, p) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${p}${e.name}/`);
      else if (e.name.endsWith(ext)) {
        files.push({ local: path.join(d, e.name), key: `${p}${e.name}`, ct: contentType });
      }
    }
  }
  walk(dir, prefix);
  return files;
}

async function uploadBatch(files, label) {
  let done = 0, skipped = 0;
  const total = files.length;
  const t0 = Date.now();

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async ({ local, key, ct }) => {
      try {
        await uploadFile(local, key, ct);
        done++;
      } catch (e) {
        console.error(`\n  ✗ ${key}: ${e.message}`);
      }
      const elapsed = (Date.now() - t0) / 1000;
      const rate = done / elapsed;
      const rem  = Math.max(0, (total - done - skipped) / (rate || 1));
      process.stdout.write(
        `\r  ${label}: ${done + skipped}/${total}  (${rate.toFixed(0)}/s, ~${rem.toFixed(0)}s үлдсэн)   `
      );
    }));
  }
  console.log(`\n  ✓ ${done} файл upload, ${skipped} алгасав`);
}

async function writeInfoJson() {
  // Tile-ийн хязгааруудыг хатуу кодлоно (serverless-д /info endpoint байхгүй)
  const info = {
    west: 87.712, south: 41.333, east: 120.000, north: 52.000,
    width: 322880, height: 106669,
  };
  const key = 'info.json';
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: JSON.stringify(info),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=3600',
  }));
  console.log(`  ✓ info.json upload`);
}

async function writeLayersJson() {
  if (!fs.existsSync(GEOJSON_DIR)) return;
  const files = fs.readdirSync(GEOJSON_DIR).filter(f => f.endsWith('.geojson'));
  const layers = files.map(f => ({
    name: f.replace('.geojson', ''),
    file: f,
    ready: true,
  }));
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: 'geojson/layers.json',
    Body: JSON.stringify(layers),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=3600',
  }));
  console.log(`  ✓ layers.json (${layers.length} давхарга)`);
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Cloudflare R2 Upload');
  console.log(`  Bucket: ${BUCKET}`);
  console.log('═══════════════════════════════════════\n');

  // 1. Tiles
  console.log('① Tiles цуглуулж байна...');
  const tiles = await collectFiles(TILES_DIR, 'tiles/', '.png', 'image/png');
  console.log(`  ${tiles.length.toLocaleString()} tile олдлоо\n`);
  console.log('① Tiles upload...');
  await uploadBatch(tiles, 'tiles');

  // 2. GeoJSON
  console.log('\n② GeoJSON upload...');
  const geojsons = await collectFiles(GEOJSON_DIR, 'geojson/', '.geojson', 'application/geo+json');
  console.log(`  ${geojsons.length} файл`);
  await uploadBatch(geojsons, 'geojson');

  // 3. Metadata
  console.log('\n③ Metadata файлууд...');
  await writeInfoJson();
  await writeLayersJson();

  const total = tiles.length + geojsons.length;
  console.log(`\n✅ Дууслаа! ${total.toLocaleString()} файл → R2`);
  console.log(`\nPublic URL: https://pub-2d7bdb113e09406eab77dc06705c4461.r2.dev`);
}

main().catch(e => { console.error(e); process.exit(1); });
