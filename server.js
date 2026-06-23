const express = require('express');
const cors = require('cors');
const { fromFile, Pool } = require('geotiff');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

sharp.cache(false);

const app = express();
app.use(cors());
app.use(express.static('public'));

const TIFF_PATH    = path.join(__dirname, 'map/topo_200_2.tif');
const STATIC_TILES = path.join(__dirname, 'public/tiles');
const CACHE_DIR    = path.join(__dirname, 'tile_cache');
const DATA_DIR     = path.join(__dirname, 'data');
const GEOJSON_DIR  = path.join(__dirname, 'public/geojson');
const OGR2OGR      = 'C:\\Program Files\\QGIS 3.26.3\\bin\\ogr2ogr.exe';

fs.mkdirSync(CACHE_DIR,   { recursive: true });
fs.mkdirSync(GEOJSON_DIR, { recursive: true });

// ── GeoTIFF ────────────────────────────────────────────────────────────────
let tiffImage = null, pool = null, meta = null;
let activeReads = 0;
const MAX_READS = 2, readQueue = [];
function acquireRead() {
  return new Promise(r => { if (activeReads < MAX_READS) { activeReads++; r(); } else readQueue.push(r); });
}
function releaseRead() {
  activeReads--;
  if (readQueue.length) { activeReads++; readQueue.shift()(); }
}

async function initTiff() {
  console.log('Loading GeoTIFF...');
  const tiff = await fromFile(TIFF_PATH);
  tiffImage = await tiff.getImage();
  pool = new Pool();
  const bbox = tiffImage.getBoundingBox();
  meta = { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3],
           width: tiffImage.getWidth(), height: tiffImage.getHeight() };
  console.log(`GeoTIFF ready: ${meta.width}×${meta.height}`);
}

// ── Shapefile scan: data/<FolderName>/*.shp ────────────────────────────────
function findShapefileFolders() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .flatMap(dir => {
      const dirPath = path.join(DATA_DIR, dir.name);
      const shp = fs.readdirSync(dirPath).find(f => f.toLowerCase().endsWith('.shp'));
      if (!shp) return [];
      return [{ layerName: dir.name, shpPath: path.join(dirPath, shp) }];
    });
}

function convertShapefiles() {
  const entries = findShapefileFolders();
  if (entries.length === 0) { console.log('No shapefiles found in data/'); return; }

  for (const { layerName, shpPath } of entries) {
    // Safe filename: replace special chars
    const safeName = layerName.replace(/[/\\?%*:|"<>]/g, '_');
    const outPath  = path.join(GEOJSON_DIR, `${safeName}.geojson`);
    const shpTime  = fs.statSync(shpPath).mtimeMs;
    const jsonTime = fs.existsSync(outPath) ? fs.statSync(outPath).mtimeMs : 0;

    if (shpTime > jsonTime) {
      try {
        console.log(`Converting: "${layerName}" → ${safeName}.geojson`);
        execFileSync(OGR2OGR, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326',
          '-lco', 'RFC7946=YES', outPath, shpPath]);
        console.log(`  ✓ done`);
      } catch (e) {
        console.error(`  ✗ ${layerName}:`, e.message.split('\n')[0]);
      }
    } else {
      console.log(`  ✓ "${layerName}" (cached)`);
    }
  }
}

// ── Layer API ──────────────────────────────────────────────────────────────
app.get('/api/layers', (_req, res) => {
  const folders = findShapefileFolders();
  const result = folders.map(({ layerName }) => {
    const safeName = layerName.replace(/[/\\?%*:|"<>]/g, '_');
    const geojsonPath = path.join(GEOJSON_DIR, `${safeName}.geojson`);
    return { name: layerName, file: `${safeName}.geojson`, ready: fs.existsSync(geojsonPath) };
  });
  res.json(result);
});

app.get('/api/layers/:name.geojson', (req, res) => {
  const safeName = decodeURIComponent(req.params.name).replace(/[/\\?%*:|"<>]/g, '_');
  const filePath = path.join(GEOJSON_DIR, `${safeName}.geojson`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'Not found' }); return; }
  res.type('application/geo+json').sendFile(filePath);
});

// ── Tile helpers ───────────────────────────────────────────────────────────
function tile2lon(x, z) { return (x / (1 << z)) * 360 - 180; }
function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

async function generateTile(z, x, y) {
  const { west, south, east, north, width: W, height: H } = meta;
  const tLonL = tile2lon(x, z), tLonR = tile2lon(x + 1, z);
  const tLatT = tile2lat(y, z), tLatB = tile2lat(y + 1, z);
  const empty = () => sharp({ create: { width: 256, height: 256, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

  if (tLonR <= west || tLonL >= east || tLatT <= south || tLatB >= north) return empty();

  const lonL = Math.max(tLonL, west), lonR = Math.min(tLonR, east);
  const latT = Math.min(tLatT, north), latB = Math.max(tLatB, south);
  const pxL  = Math.max(0, Math.floor((lonL - west) / (east - west) * W));
  const pxR  = Math.min(W, Math.ceil ((lonR - west) / (east - west) * W));
  const pxT  = Math.max(0, Math.floor((north - latT) / (north - south) * H));
  const pxB  = Math.min(H, Math.ceil ((north - latB) / (north - south) * H));
  if (pxR - pxL < 1 || pxB - pxT < 1) return empty();

  const sLon = tLonR - tLonL, sLat = tLatT - tLatB;
  const outX = Math.round((lonL - tLonL) / sLon * 256);
  const outY = Math.round((tLatT - latT) / sLat * 256);
  const outW = Math.max(1, Math.round((lonR - lonL) / sLon * 256));
  const outH = Math.max(1, Math.round((latT - latB) / sLat * 256));

  await acquireRead();
  let rasters;
  try { rasters = await tiffImage.readRasters({ window: [pxL, pxT, pxR, pxB],
    width: outW, height: outH, pool }); }
  finally { releaseRead(); }

  const ns = tiffImage.getSamplesPerPixel();
  const buf = Buffer.alloc(outW * outH * 4);
  for (let i = 0; i < outW * outH; i++) {
    buf[i*4]   = rasters[0][i];
    buf[i*4+1] = ns > 1 ? rasters[1][i] : rasters[0][i];
    buf[i*4+2] = ns > 2 ? rasters[2][i] : rasters[0][i];
    buf[i*4+3] = ns > 3 ? rasters[3][i] : 255;
  }
  const patch = await sharp(buf, { raw: { width: outW, height: outH, channels: 4 } }).png().toBuffer();
  if (outX === 0 && outY === 0 && outW === 256 && outH === 256) return patch;
  return sharp({ create: { width: 256, height: 256, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: patch, left: outX, top: outY }]).png().toBuffer();
}

const inFlight = new Map();
app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  if (!meta) { res.status(503).send('Loading'); return; }
  const z = parseInt(req.params.z), x = parseInt(req.params.x), y = parseInt(req.params.y);
  const key = `${z}/${x}/${y}`;
  const tmsY = (1 << z) - 1 - y;
  const staticPath = path.join(STATIC_TILES, `${z}`, `${x}`, `${tmsY}.png`);
  if (fs.existsSync(staticPath)) { res.type('image/png').sendFile(staticPath); return; }
  const cachePath = path.join(CACHE_DIR, `${z}`, `${x}`, `${y}.png`);
  if (fs.existsSync(cachePath)) { res.type('image/png').sendFile(cachePath); return; }
  if (z < 8) {
    res.type('image/png').send(await sharp({ create: { width: 256, height: 256,
      channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    return;
  }
  if (inFlight.has(key)) {
    try { res.type('image/png').send(await inFlight.get(key)); } catch { res.status(500).send('Error'); }
    return;
  }
  const promise = generateTile(z, x, y).then(buf => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFile(cachePath, buf, () => {});
    inFlight.delete(key); return buf;
  }).catch(err => { console.error(`Tile ${key}:`, err.message); inFlight.delete(key); throw err; });
  inFlight.set(key, promise);
  try { res.type('image/png').send(await promise); } catch { res.status(500).send('Error'); }
});

app.get('/info', (_req, res) => {
  if (!meta) { res.status(503).json({ error: 'loading' }); return; }
  res.json(meta);
});

initTiff().then(() => {
  convertShapefiles();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server: http://localhost:${port}`));
}).catch(err => { console.error('Init failed:', err); process.exit(1); });
