/**
 * Топо зургийн tile-уудыг Garmin Custom Maps KMZ болгох
 * Zoom 8 tile-уудыг ашиглана (TMS convention)
 * sharp эсвэл jimp-гүй — PNG-г шууд embed хийнэ (Garmin PNG дэмждэг)
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const TILES_DIR = 'public/tiles/8';
const OUT_DIR   = 'garmin_kmz';
const ZOOM      = 8;
const MAX_TILES = 100;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// TMS tile → lat/lon bounds
function tileBounds(x, yTms, z) {
  const n   = Math.pow(2, z);
  const y   = n - 1 - yTms; // TMS → XYZ
  const lonW = x / n * 360 - 180;
  const lonE = (x + 1) / n * 360 - 180;
  const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const latS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
  return { n: latN, s: latS, e: lonE, w: lonW };
}

// KML үүсгэх
function makeKml(tilesInfo, partNum) {
  const overlays = tilesInfo.map(({ fname, b }, i) => `  <GroundOverlay>
    <name>topo_p${partNum}_${i}</name>
    <drawOrder>50</drawOrder>
    <Icon><href>files/${fname}</href></Icon>
    <LatLonBox>
      <north>${b.n.toFixed(6)}</north>
      <south>${b.s.toFixed(6)}</south>
      <east>${b.e.toFixed(6)}</east>
      <west>${b.w.toFixed(6)}</west>
    </LatLonBox>
  </GroundOverlay>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Mongolia Topo 1:200000 Part ${partNum}</name>
${overlays}
</Document>
</kml>`;
}

// ZIP/KMZ үүсгэх (node built-in зипгүй тул archiver ашиглах)
// Эхлээд archiver байгаа эсэх шалгах
let useArchiver = false;
try { require.resolve('archiver'); useArchiver = true; } catch {}

if (!useArchiver) {
  console.log('📦 archiver суулгаж байна...');
  require('child_process').execSync('npm install archiver --save-dev', { stdio: 'inherit' });
  useArchiver = true;
}

const { ZipArchive } = require('archiver');

// Tile бүгдийг цуглуул
const allTiles = [];
const xDirs = fs.readdirSync(TILES_DIR).sort((a, b) => +a - +b);
for (const xName of xDirs) {
  const xPath = path.join(TILES_DIR, xName);
  if (!fs.statSync(xPath).isDirectory()) continue;
  const x = parseInt(xName);
  const pngs = fs.readdirSync(xPath).filter(f => f.endsWith('.png')).sort((a, b) => +a.replace('.png','') - +b.replace('.png',''));
  for (const png of pngs) {
    const yTms = parseInt(png);
    allTiles.push({ x, yTms, pngPath: path.join(xPath, png) });
  }
}

console.log(`Нийт ${allTiles.length} tile олдлоо`);

// MAX_TILES-аар хуваах
const chunks = [];
for (let i = 0; i < allTiles.length; i += MAX_TILES) {
  chunks.push(allTiles.slice(i, i + MAX_TILES));
}

async function makeKmz(chunk, partNum) {
  return new Promise((resolve, reject) => {
    const kmzPath = path.join(OUT_DIR, `mongolia_topo_part${partNum}.kmz`);
    const output  = fs.createWriteStream(kmzPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => {
      const mb = (archive.pointer() / 1024 / 1024).toFixed(1);
      console.log(`  ✅ mongolia_topo_part${partNum}.kmz — ${chunk.length} tile, ${mb} MB`);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);

    // Tile файлуудыг нэмэх
    const tilesInfo = [];
    for (const { x, yTms, pngPath } of chunk) {
      const b     = tileBounds(x, yTms, ZOOM);
      const fname = `t_${x}_${yTms}.png`;
      archive.file(pngPath, { name: `files/${fname}` });
      tilesInfo.push({ fname, b });
    }

    // KML нэмэх
    const kml = makeKml(tilesInfo, partNum);
    archive.append(kml, { name: 'doc.kml' });
    archive.finalize();
  });
}

(async () => {
  for (let i = 0; i < chunks.length; i++) {
    await makeKmz(chunks[i], i + 1);
  }
  console.log(`\n✅ Дуусав! ${chunks.length} KMZ файл → ${OUT_DIR}/ хавтаст байна`);
  console.log('📲 Цагны /GARMIN/CustomMaps/ хавтсанд хуулна уу.');
})();
