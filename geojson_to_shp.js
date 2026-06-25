/**
 * GeoJSON → Shapefile (.zip) with Windows-1251 Cyrillic support
 * node geojson_to_shp.js
 */
const shpwrite = require('@mapbox/shp-write');
const JSZip    = require('jszip');
const iconv    = require('iconv-lite');
const fs       = require('fs');
const path     = require('path');

const GEOJSON_DIR = path.join(__dirname, 'public', 'geojson');
const OUT_DIR     = path.join(__dirname, 'shapefiles');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const FILES = [
  'settlements.geojson',
  'roads.geojson',
  'rivers.geojson',
  'forests.geojson',
  'waters.geojson',
];

// Encode string as fake Latin-1 carrying raw UTF-8 bytes
// shp-write takes the low byte of each char code → writes UTF-8 bytes verbatim
function toUtf8FakeLatin(str) {
  if (!str) return '';
  const buf = Buffer.from(String(str), 'utf8');
  return Array.from(buf).map(b => String.fromCharCode(b)).join('');
}

// Encode all string properties in GeoJSON features
function encodeFeatures(geojson) {
  return {
    ...geojson,
    features: geojson.features.map(f => ({
      ...f,
      properties: Object.fromEntries(
        Object.entries(f.properties || {}).map(([k, v]) =>
          [k, typeof v === 'string' ? toUtf8FakeLatin(v) : v]
        )
      )
    }))
  };
}

// Add .cpg file (declares UTF-8) and clear DBF language driver byte
async function patchDbfEncoding(zipBuf, baseName) {
  const zip = await JSZip.loadAsync(zipBuf);
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.toLowerCase().endsWith('.dbf')) {
      const buf = Buffer.from(await file.async('arraybuffer'));
      buf[29] = 0x00; // clear codepage — defer to .cpg file
      zip.file(name, buf);
    }
  }
  // Add .cpg sidecar file so QGIS/ArcGIS reads UTF-8 correctly
  zip.file(`${baseName}.cpg`, 'UTF-8');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function convert(filename) {
  const inPath  = path.join(GEOJSON_DIR, filename);
  const baseName = path.basename(filename, '.geojson');
  const outPath = path.join(OUT_DIR, `${baseName}.zip`);

  const geojson = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  console.log(`Хөрвүүлж байна: ${filename} (${geojson.features.length} features)...`);

  const encoded = encodeFeatures(geojson);

  let zipBuf = await shpwrite.zip(encoded, {
    outputType: 'nodebuffer',
    compression: 'DEFLATE',
    types: {
      point: baseName, polyline: baseName, polygon: baseName,
      multipoint: baseName, multipolyline: baseName, multipolygon: baseName,
    }
  });

  zipBuf = await patchDbfEncoding(zipBuf, baseName);

  fs.writeFileSync(outPath, zipBuf);
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`✅ ${baseName}.zip — ${sizeMB}MB → ${outPath}`);
}

(async () => {
  for (const f of FILES) {
    await convert(f);
  }
  console.log(`\nДуусав! shapefiles/ фолдерт хадгалагдлаа.`);
})();
