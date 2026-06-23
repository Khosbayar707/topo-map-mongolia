/**
 * Converts the pre-generated tile folder (public/tiles/) into a single MBTiles file.
 * MBTiles = SQLite database with tiles stored as BLOBs — one file, fast lookup.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const TILES_DIR = path.join(__dirname, 'public/tiles');
const OUT_FILE  = path.join(__dirname, 'map/topo.mbtiles');

if (!fs.existsSync(TILES_DIR)) {
  console.error('Tile folder not found:', TILES_DIR);
  process.exit(1);
}

console.log('Creating MBTiles:', OUT_FILE);
if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);

const db = new Database(OUT_FILE);

// MBTiles schema
db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
  CREATE TABLE IF NOT EXISTS tiles (
    zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB
  );
  CREATE UNIQUE INDEX IF NOT EXISTS tiles_idx
    ON tiles (zoom_level, tile_column, tile_row);
`);

const insertMeta = db.prepare(`INSERT OR REPLACE INTO metadata VALUES (?, ?)`);
const insertTile = db.prepare(`INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)`);

// Metadata
const metaRows = [
  ['name',        'Топографийн зураг 1:200,000'],
  ['type',        'overlay'],
  ['version',     '1'],
  ['description', 'Mongolia topographic map'],
  ['format',      'png'],
  ['bounds',      '87.712,41.333,120.000,52.000'],
  ['center',      '103.856,46.667,8'],
  ['minzoom',     '6'],
  ['maxzoom',     '11'],
];
const insertMetas = db.transaction(() => metaRows.forEach(r => insertMeta.run(...r)));
insertMetas();

// Walk tile folder: tiles/{z}/{x}/{tms_y}.png  (TMS convention from gdal2tiles)
const zoomDirs = fs.readdirSync(TILES_DIR).filter(d => /^\d+$/.test(d));
let total = 0;

const insertBatch = db.transaction((rows) => {
  for (const r of rows) insertTile.run(r.z, r.x, r.y, r.data);
});

for (const zStr of zoomDirs) {
  const z = parseInt(zStr);
  const zDir = path.join(TILES_DIR, zStr);
  if (!fs.statSync(zDir).isDirectory()) continue;

  const xDirs = fs.readdirSync(zDir).filter(d => /^\d+$/.test(d));
  let batch = [];

  for (const xStr of xDirs) {
    const x = parseInt(xStr);
    const xDir = path.join(zDir, xStr);
    const files = fs.readdirSync(xDir).filter(f => f.endsWith('.png'));

    for (const file of files) {
      const tmsY = parseInt(file.replace('.png', ''));
      // MBTiles stores TMS y (same as gdal2tiles output — no flip needed)
      const data = fs.readFileSync(path.join(xDir, file));
      batch.push({ z, x, y: tmsY, data });

      if (batch.length >= 500) {
        insertBatch(batch);
        total += batch.length;
        batch = [];
        process.stdout.write(`\r  ${total} tiles written...`);
      }
    }
  }

  if (batch.length > 0) {
    insertBatch(batch);
    total += batch.length;
    process.stdout.write(`\r  ${total} tiles written...`);
  }
  console.log(`\n  Zoom ${z} done`);
}

db.close();
console.log(`\nDone! ${total} tiles → ${OUT_FILE}`);
console.log(`File size: ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB`);
