/**
 * mongolia.gpkg → 3 GeoJSON файл
 *  1. settlements.geojson  — хот/тосгон/hamlet
 *  2. roads.geojson        — trunk/primary/secondary зам
 *  3. rivers.geojson       — river/stream
 */
const sqlite3 = require('better-sqlite3');
const fs      = require('fs');
const path    = require('path');

const db  = sqlite3(path.join(__dirname, 'map', 'mongolia.gpkg'));
const OUT = path.join(__dirname, 'public', 'geojson');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ── GeoPackage binary header → WKB offset ──────────────────────────────────
function wkbOffset(buf) {
  if (!buf || buf[0] !== 0x47 || buf[1] !== 0x50) return -1;
  const envType = (buf[3] >> 1) & 0x07;
  const envBytes = [0, 32, 48, 48, 64][envType] ?? 0;
  return 8 + envBytes;
}

// ── WKB parser → GeoJSON geometry ──────────────────────────────────────────
function parseWkb(buf, pos) {
  let i = pos;
  const le   = buf[i++] === 1;
  const ri32 = () => { const v = le ? buf.readUInt32LE(i)  : buf.readUInt32BE(i);  i += 4; return v; };
  const rdbl = () => { const v = le ? buf.readDoubleLE(i)  : buf.readDoubleBE(i);  i += 8; return v; };

  function pt()   { return [rdbl(), rdbl()]; }
  function ring() { const n = ri32(); const r = []; for (let j=0;j<n;j++) r.push(pt()); return r; }
  function poly() { const n = ri32(); const r = []; for (let j=0;j<n;j++) r.push(ring()); return r; }
  function subGeom() {
    i++;               // byte order
    return byType(ri32());
  }
  function multi(fn) {
    const n = ri32();
    const gs = [];
    for (let j = 0; j < n; j++) gs.push(subGeom());
    return gs.map(fn);
  }

  function byType(t) {
    const b = t & 0xFFFF;
    if (b === 1) return { type: 'Point',           coordinates: pt() };
    if (b === 2) { const n=ri32(); const c=[]; for(let j=0;j<n;j++) c.push(pt()); return { type:'LineString',      coordinates:c }; }
    if (b === 3) return { type: 'Polygon',          coordinates: poly() };
    if (b === 4) return { type: 'MultiPoint',       coordinates: multi(g=>g.coordinates) };
    if (b === 5) return { type: 'MultiLineString',  coordinates: multi(g=>g.coordinates) };
    if (b === 6) return { type: 'MultiPolygon',     coordinates: multi(g=>g.coordinates) };
    return null;
  }

  return byType(ri32());
}

function toGeom(blob) {
  const buf = Buffer.from(blob);
  const off = wkbOffset(buf);
  if (off < 0) return null;
  try { return parseWkb(buf, off); } catch { return null; }
}

function save(name, features) {
  const fc = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(fc));
  console.log(`✅ ${name} — ${features.length} features`);
}

// ── 1. Хот/тосгон (points layer) ───────────────────────────────────────────
console.log('1. Суурин газрууд...');
const settleRows = db.prepare(`
  SELECT geom, name, place, other_tags FROM points
  WHERE place IN ('city','town','village','hamlet','locality','suburb','isolated_dwelling')
`).all();

const settlements = settleRows.map(r => {
  const geom = toGeom(r.geom);
  if (!geom) return null;
  return {
    type: 'Feature',
    geometry: geom,
    properties: { name: r.name, place: r.place }
  };
}).filter(Boolean);
save('settlements.geojson', settlements);

// ── 2. Үндсэн зам (lines layer) ────────────────────────────────────────────
console.log('2. Үндсэн замууд...');
const roadRows = db.prepare(`
  SELECT geom, name, highway FROM lines
  WHERE highway IN ('trunk','primary','secondary','motorway')
`).all();

const roads = roadRows.map(r => {
  const geom = toGeom(r.geom);
  if (!geom) return null;
  return {
    type: 'Feature',
    geometry: geom,
    properties: { name: r.name, highway: r.highway }
  };
}).filter(Boolean);
save('roads.geojson', roads);

// ── 3. Гол/горхи (lines layer) ─────────────────────────────────────────────
console.log('3. Гол/горхи...');
const riverRows = db.prepare(`
  SELECT geom, name, waterway FROM lines
  WHERE waterway IN ('river','canal')
`).all();

const rivers = riverRows.map(r => {
  const geom = toGeom(r.geom);
  if (!geom) return null;
  return {
    type: 'Feature',
    geometry: geom,
    properties: { name: r.name, waterway: r.waterway }
  };
}).filter(Boolean);
save('rivers.geojson', rivers);

// ── other_tags hstore parser ───────────────────────────────────────────────
function parseOtherTags(str) {
  if (!str) return {};
  const out = {};
  const re = /"([^"]+)"=>"([^"]*)"/g;
  let m;
  while ((m = re.exec(str)) !== null) out[m[1]] = m[2];
  return out;
}

// ── 4. Ой / Бут бургас (multipolygons layer) ──────────────────────────────
console.log('4. Ойн бүс...');
const forestRows = db.prepare(`
  SELECT geom, osm_id, name, "natural", landuse, other_tags FROM multipolygons
  WHERE "natural" IN ('wood','scrub') OR landuse IN ('forest')
`).all();

const FOREST_SUBTYPE = { wood: 'Ой', forest: 'Ой', scrub: 'Бут бургас' };

const forests = forestRows.map(r => {
  const geom = toGeom(r.geom);
  if (!geom) return null;
  const tags = parseOtherTags(r.other_tags);
  const key = r.natural || r.landuse;
  return {
    type: 'Feature', geometry: geom,
    properties: {
      id:       r.osm_id || '',
      name:     r.name || '',
      alt_name: tags['alt_name'] || tags['name:en'] || '',
      natural:  r.natural || '',
      landuse:  r.landuse || '',
      subtype:  FOREST_SUBTYPE[key] || 'Ой',
      wikidata: tags['wikidata'] || '',
    }
  };
}).filter(Boolean);
save('forests.geojson', forests);

// ── 5. Ус (multipolygons layer) ────────────────────────────────────────────
console.log('5. Усан бүс...');
const waterRows = db.prepare(`
  SELECT geom, osm_id, name, "natural", other_tags FROM multipolygons
  WHERE "natural" IN ('water','wetland')
`).all();

function waterSubtype(r) {
  if (r.natural === 'wetland') return 'Намаг';
  const tags = parseOtherTags(r.other_tags);
  const w = tags['water'];
  if (w === 'lake' || w === 'reservoir') return 'Нуур';
  if (w === 'river') return 'Гол';
  if (w === 'stream' || w === 'brook') return 'Горхи';
  if (w === 'spring') return 'Булаг/Шанд';
  return 'Нуур';
}

const waters = waterRows.map(r => {
  const geom = toGeom(r.geom);
  if (!geom) return null;
  const tags = parseOtherTags(r.other_tags);
  return {
    type: 'Feature', geometry: geom,
    properties: {
      id:       r.osm_id || '',
      name:     r.name || '',
      alt_name: tags['alt_name'] || tags['name:en'] || tags['int_name'] || '',
      natural:  r.natural || '',
      area:     tags['area'] || '',
      subtype:  waterSubtype(r),
      wikidata: tags['wikidata'] || '',
    }
  };
}).filter(Boolean);
save('waters.geojson', waters);

console.log('\nДуусав! public/geojson/ фолдерт хадгалагдлаа.');
