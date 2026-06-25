const sqlite3 = require('better-sqlite3');
const path = require('path');
const db = sqlite3(path.join(__dirname, 'map', 'mongolia.gpkg'));

const layers = ['points','lines','multipolygons'];
layers.forEach(layer => {
  console.log(`\n=== ${layer} ===`);
  const cols = db.prepare(`PRAGMA table_info("${layer}")`).all().map(c=>c.name);
  const useful = cols.filter(c=>!['geom','ogc_fid','id','osm_id'].includes(c));
  console.log('Columns:', useful.join(', '));

  if(layer==='lines' && cols.includes('highway')){
    const hw = db.prepare(`SELECT highway, COUNT(*) as c FROM lines WHERE highway IS NOT NULL GROUP BY highway ORDER BY c DESC LIMIT 8`).all();
    console.log('Highways:', hw.map(r=>`${r.highway}(${r.c})`).join(', '));
    const ww = db.prepare(`SELECT waterway, COUNT(*) as c FROM lines WHERE waterway IS NOT NULL GROUP BY waterway ORDER BY c DESC LIMIT 5`).all();
    console.log('Waterways:', ww.map(r=>`${r.waterway}(${r.c})`).join(', '));
  }
  if(layer==='points' && cols.includes('place')){
    const pl = db.prepare(`SELECT place, COUNT(*) as c FROM points WHERE place IS NOT NULL GROUP BY place ORDER BY c DESC LIMIT 8`).all();
    console.log('Places:', pl.map(r=>`${r.place}(${r.c})`).join(', '));
  }
  if(layer==='multipolygons'){
    const avail = ['landuse','natural','building','leisure','amenity'].filter(c=>cols.includes(c));
    avail.forEach(col=>{
      const rows = db.prepare(`SELECT "${col}", COUNT(*) as c FROM multipolygons WHERE "${col}" IS NOT NULL GROUP BY "${col}" ORDER BY c DESC LIMIT 5`).all();
      if(rows.length) console.log(`${col}:`, rows.map(r=>`${r[col]}(${r.c})`).join(', '));
    });
  }
});
