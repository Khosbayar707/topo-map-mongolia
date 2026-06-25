/**
 * GeoJSON → Shapefile (.zip) with UTF-8 support
 * - Points/Polygons: uses @mapbox/shp-write
 * - LineStrings: custom writer (shp-write merges all lines into one SHP
 *   record while keeping N DBF rows, causing geometry/attribute mismatch)
 * node geojson_to_shp.js
 */
const shpwrite = require('@mapbox/shp-write');
const JSZip    = require('jszip');
const fs       = require('fs');
const path     = require('path');

const GEOJSON_DIR = path.join(__dirname, 'public', 'geojson');
const OUT_DIR     = path.join(__dirname, 'shapefiles');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

// ── UTF-8 encoding helpers ────────────────────────────────────────────────────

// Fake Latin-1 trick: each UTF-8 byte becomes a char with that code point.
// shp-write writes the low byte of each char → raw UTF-8 bytes land in DBF.
function toUtf8FakeLatin(str) {
  if (!str) return '';
  const buf = Buffer.from(String(str), 'utf8');
  return Array.from(buf).map(b => String.fromCharCode(b)).join('');
}

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

async function addCpgAndClearLangByte(zipBuf, baseName) {
  const zip = await JSZip.loadAsync(zipBuf);
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.toLowerCase().endsWith('.dbf')) {
      const buf = Buffer.from(await file.async('arraybuffer'));
      buf[29] = 0x00;
      zip.file(name, buf);
    }
  }
  zip.file(`${baseName}.cpg`, 'UTF-8');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Custom LineString shapefile writer ───────────────────────────────────────

function u8(v)  { const b = Buffer.alloc(1); b.writeUInt8(v);        return b; }
function i32le(v){ const b = Buffer.alloc(4); b.writeInt32LE(v);      return b; }
function i32be(v){ const b = Buffer.alloc(4); b.writeInt32BE(v);      return b; }
function f64le(v){ const b = Buffer.alloc(8); b.writeDoubleLe !== undefined ? b.writeDoubleLE(v) : b.writeDoubleBE(v); return b; }

function writeDouble(buf, offset, v) { buf.writeDoubleLE(v, offset); }

// Flatten LineString / MultiLineString → array of rings (each ring = [[x,y]...])
function toRings(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString')      return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

function writeLineSHP(features) {
  const SHP_TYPE = 3; // PolyLine

  // Compute all SHP record bodies first so we know total file size
  const records = features.map(f => {
    const rings = toRings(f.geometry);
    const numParts  = rings.length;
    const numPoints = rings.reduce((s, r) => s + r.length, 0);

    let xmin =  Infinity, ymin =  Infinity;
    let xmax = -Infinity, ymax = -Infinity;
    rings.forEach(r => r.forEach(([x, y]) => {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }));

    // Content length in bytes: 4 (shapeType) + 32 (bbox) + 4 + 4 (parts/pts counts)
    //   + numParts*4 (parts array) + numPoints*16 (xy pairs)
    const contentBytes = 4 + 32 + 4 + 4 + numParts * 4 + numPoints * 16;
    return { rings, numParts, numPoints, xmin, ymin, xmax, ymax, contentBytes };
  });

  // SHP file header (100 bytes)
  const fileHeader = Buffer.alloc(100, 0);
  fileHeader.writeInt32BE(9994, 0);       // file code
  fileHeader.writeInt32LE(1000, 28);      // version
  fileHeader.writeInt32LE(SHP_TYPE, 32);  // shape type

  // Overall bounding box
  let GxMin=Infinity,GyMin=Infinity,GxMax=-Infinity,GyMax=-Infinity;
  records.forEach(r => {
    if(r.xmin<GxMin) GxMin=r.xmin; if(r.xmax>GxMax) GxMax=r.xmax;
    if(r.ymin<GyMin) GyMin=r.ymin; if(r.ymax>GyMax) GyMax=r.ymax;
  });
  fileHeader.writeDoubleLE(GxMin, 36);
  fileHeader.writeDoubleLE(GyMin, 44);
  fileHeader.writeDoubleLE(GxMax, 52);
  fileHeader.writeDoubleLE(GyMax, 60);

  const totalContentBytes = records.reduce((s, r) => s + 8 + r.contentBytes, 0);
  const shpFileBytes = 100 + totalContentBytes;
  fileHeader.writeInt32BE(shpFileBytes / 2, 24); // file length in 16-bit words

  // SHX header
  const shxFileBytes = 100 + records.length * 8;
  const shxHeader = Buffer.from(fileHeader);
  shxHeader.writeInt32BE(shxFileBytes / 2, 24);

  const shpParts = [fileHeader];
  const shxParts = [shxHeader];
  const shxRecords = Buffer.alloc(records.length * 8);
  let shpOffset = 100; // byte offset into SHP

  records.forEach((rec, i) => {
    const { rings, numParts, numPoints, xmin, ymin, xmax, ymax, contentBytes } = rec;
    const recHeader = Buffer.alloc(8);
    recHeader.writeInt32BE(i + 1, 0);                // record number (1-based)
    recHeader.writeInt32BE(contentBytes / 2, 4);     // content length in 16-bit words
    shpParts.push(recHeader);

    const body = Buffer.alloc(contentBytes);
    let o = 0;
    body.writeInt32LE(SHP_TYPE, o); o += 4;
    body.writeDoubleLE(xmin, o); o += 8;
    body.writeDoubleLE(ymin, o); o += 8;
    body.writeDoubleLE(xmax, o); o += 8;
    body.writeDoubleLE(ymax, o); o += 8;
    body.writeInt32LE(numParts,  o); o += 4;
    body.writeInt32LE(numPoints, o); o += 4;
    let ptIdx = 0;
    rings.forEach(r => { body.writeInt32LE(ptIdx, o); o += 4; ptIdx += r.length; });
    rings.forEach(r => r.forEach(([x, y]) => {
      body.writeDoubleLE(x, o); o += 8;
      body.writeDoubleLE(y, o); o += 8;
    }));
    shpParts.push(body);

    shxRecords.writeInt32BE(shpOffset / 2, i * 8);
    shxRecords.writeInt32BE(contentBytes / 2, i * 8 + 4);
    shpOffset += 8 + contentBytes;
  });
  shxParts.push(shxRecords);

  return { shp: Buffer.concat(shpParts), shx: Buffer.concat(shxParts) };
}

function writeLineDBF(features, fieldDefs) {
  // fieldDefs: [{name, length}]  (all character fields, UTF-8)
  const recSize = 1 + fieldDefs.reduce((s, f) => s + f.length, 0);
  const headerSize = 32 + fieldDefs.length * 32 + 1;
  const dbf = Buffer.alloc(headerSize + features.length * recSize, 0x20);

  dbf[0] = 3; // version
  const now = new Date();
  dbf[1] = now.getFullYear() - 1900; dbf[2] = now.getMonth() + 1; dbf[3] = now.getDate();
  dbf.writeUInt32LE(features.length, 4);
  dbf.writeUInt16LE(headerSize, 8);
  dbf.writeUInt16LE(recSize, 10);
  dbf[29] = 0x00; // UTF-8 declared via .cpg

  fieldDefs.forEach((fd, i) => {
    const base = 32 + i * 32;
    dbf.write(fd.name.slice(0, 10).padEnd(11, '\0'), base, 'ascii');
    dbf[base + 11] = 0x43; // 'C' character
    dbf[base + 16] = fd.length;
  });
  dbf[32 + fieldDefs.length * 32] = 0x0D; // header terminator

  features.forEach((f, i) => {
    let o = headerSize + i * recSize;
    dbf[o++] = 0x20; // not deleted
    fieldDefs.forEach(fd => {
      const raw = String(f.properties[fd.name] ?? '');
      const encoded = Buffer.from(raw, 'utf8').slice(0, fd.length);
      encoded.copy(dbf, o);
      o += fd.length;
    });
  });

  return dbf;
}

async function convertLines(filename, fieldDefs) {
  const inPath  = path.join(GEOJSON_DIR, filename);
  const baseName = path.basename(filename, '.geojson');
  const outPath = path.join(OUT_DIR, `${baseName}.zip`);

  const geojson = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  console.log(`Хөрвүүлж байна: ${filename} (${geojson.features.length} features)...`);

  const { shp, shx } = writeLineSHP(geojson.features);
  const dbf = writeLineDBF(geojson.features, fieldDefs);

  const zip = new JSZip();
  zip.file(`${baseName}.shp`, shp);
  zip.file(`${baseName}.shx`, shx);
  zip.file(`${baseName}.dbf`, dbf);
  zip.file(`${baseName}.prj`, WGS84_PRJ);
  zip.file(`${baseName}.cpg`, 'UTF-8');

  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outPath, zipBuf);
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`✅ ${baseName}.zip — ${sizeMB}MB`);
}

// ── Point/Polygon via shp-write ───────────────────────────────────────────────

async function convertDefault(filename) {
  const inPath  = path.join(GEOJSON_DIR, filename);
  const baseName = path.basename(filename, '.geojson');
  const outPath = path.join(OUT_DIR, `${baseName}.zip`);

  const geojson = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  console.log(`Хөрвүүлж байна: ${filename} (${geojson.features.length} features)...`);

  let zipBuf = await shpwrite.zip(encodeFeatures(geojson), {
    outputType: 'nodebuffer',
    compression: 'DEFLATE',
    types: {
      point: baseName, polyline: baseName, polygon: baseName,
      multipoint: baseName, multipolyline: baseName, multipolygon: baseName,
    }
  });

  zipBuf = await addCpgAndClearLangByte(zipBuf, baseName);
  fs.writeFileSync(outPath, zipBuf);
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`✅ ${baseName}.zip — ${sizeMB}MB`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  // Points and polygons — shp-write handles these correctly
  await convertDefault('settlements.geojson');
  await convertDefault('forests.geojson');
  await convertDefault('waters.geojson');

  // Lines — custom writer (one SHP record per feature)
  await convertLines('roads.geojson', [
    { name: 'id',       length: 12  },
    { name: 'name',     length: 200 },
    { name: 'alt_name', length: 100 },
    { name: 'highway',  length: 20  },
  ]);
  await convertLines('rivers.geojson', [
    { name: 'id',       length: 12  },
    { name: 'name',     length: 200 },
    { name: 'alt_name', length: 100 },
    { name: 'waterway', length: 20  },
  ]);

  console.log('\nДуусав! shapefiles/ фолдерт хадгалагдлаа.');
})();
