/**
 * Zoom 11 tile-уудыг 4×4 нэгтгэж HD KMZ үүсгэх
 * Нэг merged зураг = 1024×1024px (4×4 × 256px tile)
 * Garmin Custom Maps: max 500 tile → ~260 merged зураг → 3 KMZ файл
 */
const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');
const { ZipArchive } = require('archiver');

const TILES_DIR = 'public/tiles/11';
const OUT_DIR   = 'garmin_kmz_hd';
const ZOOM      = 11;
const MERGE     = 4;       // 4×4 tile нэгтгэнэ
const TILE_PX   = 256;
const MAX_TILES = 100;     // Garmin KMZ-ийн хязгаар

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// TMS tile → lat/lon bounds
function tileBounds(x, yTms, z) {
  const n    = Math.pow(2, z);
  const y    = n - 1 - yTms;
  const lonW = x / n * 360 - 180;
  const lonE = (x + 1) / n * 360 - 180;
  const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const latS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
  return { n: latN, s: latS, e: lonE, w: lonW };
}

// Бүх tile-уудыг x,y координатаар индексэл
console.log('Tile-уудыг унших...');
const tileMap = new Map(); // "x_y" → path
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

for (const xName of fs.readdirSync(TILES_DIR)) {
  const xPath = path.join(TILES_DIR, xName);
  if (!fs.statSync(xPath).isDirectory()) continue;
  const x = parseInt(xName);
  for (const f of fs.readdirSync(xPath)) {
    if (!f.endsWith('.png')) continue;
    const y = parseInt(f);
    tileMap.set(`${x}_${y}`, path.join(xPath, f));
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
}
console.log(`${tileMap.size} tile олдлоо. X:[${minX}-${maxX}], Y:[${minY}-${maxY}]`);

// 4×4 tile group бүрийг нэгтгэх
// Group координат: gx = floor(x/MERGE), gy = floor(y/MERGE)
const groups = new Map();
for (const [key, tilePath] of tileMap) {
  const [x, y] = key.split('_').map(Number);
  const gx = Math.floor(x / MERGE);
  const gy = Math.floor(y / MERGE);
  const gKey = `${gx}_${gy}`;
  if (!groups.has(gKey)) groups.set(gKey, []);
  groups.get(gKey).push({ x, y, tilePath });
}
console.log(`${groups.size} merged tile group үүслээ`);

// Нэг group-г нэгтгэх
async function mergeGroup(gx, gy, tiles) {
  const baseX = gx * MERGE;
  const baseY = gy * MERGE;
  const size  = TILE_PX * MERGE;

  // Цагаан дэвсгэр
  const base = sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } }
  }).png();

  const composites = [];
  for (const { x, y, tilePath } of tiles) {
    const dx = (x - baseX) * TILE_PX;
    // TMS y нь хойшоо өсдөг, зургийн y нь доошоо өсдөг — урвуулна
    const dy = (baseY + MERGE - 1 - y) * TILE_PX;
    composites.push({ input: tilePath, left: dx, top: dy });
  }

  return base.composite(composites).jpeg({ quality: 90 }).toBuffer();
}

// KML үүсгэх
function makeKml(tilesInfo, partNum) {
  const overlays = tilesInfo.map(({ fname, b }, i) =>
    `  <GroundOverlay>
    <name>topo_hd_p${partNum}_${i}</name>
    <drawOrder>50</drawOrder>
    <Icon><href>files/${fname}</href></Icon>
    <LatLonBox>
      <north>${b.n.toFixed(7)}</north>
      <south>${b.s.toFixed(7)}</south>
      <east>${b.e.toFixed(7)}</east>
      <west>${b.w.toFixed(7)}</west>
    </LatLonBox>
  </GroundOverlay>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Mongolia Topo HD Part ${partNum}</name>
${overlays}
</Document>
</kml>`;
}

// KMZ үүсгэх
function writeKmz(partNum, tilesData) {
  return new Promise((resolve, reject) => {
    const kmzPath = path.join(OUT_DIR, `mongolia_topo_hd_part${partNum}.kmz`);
    const output  = fs.createWriteStream(kmzPath);
    const archive = new ZipArchive({ zlib: { level: 5 } });
    output.on('close', () => {
      const mb = (archive.pointer() / 1024 / 1024).toFixed(1);
      console.log(`  ✅ part${partNum}.kmz — ${tilesData.length} tile, ${mb} MB`);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);

    const tilesInfo = tilesData.map(({ fname, b }) => ({ fname, b }));
    archive.append(makeKml(tilesInfo, partNum), { name: 'doc.kml' });
    for (const { fname, buf } of tilesData) {
      archive.append(buf, { name: `files/${fname}` });
    }
    archive.finalize();
  });
}

(async () => {
  const groupEntries = [...groups.entries()];
  let chunk = [];
  let partNum = 1;
  let total = 0;

  for (let i = 0; i < groupEntries.length; i++) {
    const [gKey, tiles] = groupEntries[i];
    const [gx, gy] = gKey.split('_').map(Number);

    // Бүх MERGE×MERGE tile-ийн bounds
    const x0 = gx * MERGE, y0 = gy * MERGE;
    const x1 = x0 + MERGE - 1, y1 = y0 + MERGE - 1;
    const bSW = tileBounds(x0, y0, ZOOM); // y0 = хамгийн өмнөд TMS y
    const bNE = tileBounds(x1, y1, ZOOM); // y1 = хамгийн хойд TMS y
    const b   = { n: bNE.n, s: bSW.s, e: bNE.e, w: bSW.w };

    process.stdout.write(`\r  Боловсруулж байна: ${i+1}/${groupEntries.length}`);
    const buf  = await mergeGroup(gx, gy, tiles);
    const fname = `m_${gx}_${gy}.jpg`;
    chunk.push({ fname, buf, b });

    if (chunk.length >= MAX_TILES || i === groupEntries.length - 1) {
      console.log('');
      await writeKmz(partNum++, chunk);
      total += chunk.length;
      chunk = [];
    }
  }

  console.log(`\n✅ Дуусав! Нийт ${total} merged tile, ${partNum-1} KMZ файл`);
  console.log(`📁 ${OUT_DIR}/ хавтаст байна`);
  console.log('📲 Цагны /GARMIN/CustomMaps/ хавтсанд 3 файлыг хуулна уу.');
})();
