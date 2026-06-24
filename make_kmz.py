"""
Топо зургийн tile-уудыг Garmin Custom Maps KMZ болгох
Zoom 8 tile-уудыг ашиглана (TMS convention - y inverted)
Max 100 tile/KMZ → олон файлд хуваана
"""
import os, math, zipfile, struct, shutil
from pathlib import Path
from PIL import Image

TILES_DIR = Path("public/tiles/8")
OUT_DIR   = Path("garmin_kmz")
ZOOM      = 8
MAX_TILES = 100  # Garmin Custom Maps limit

OUT_DIR.mkdir(exist_ok=True)

def tile_bounds(x, y_tms, z):
    """TMS tile → (north, south, east, west) lat/lon"""
    n = 2 ** z
    y = n - 1 - y_tms  # TMS → XYZ
    lon_w = x / n * 360 - 180
    lon_e = (x + 1) / n * 360 - 180
    lat_n = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_s = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lat_n, lat_s, lon_e, lon_w

def make_kml(tiles_info):
    """tiles_info = list of (img_filename, north, south, east, west)"""
    overlays = ""
    for i, (fname, n, s, e, w) in enumerate(tiles_info):
        overlays += f"""  <GroundOverlay>
    <name>topo_{i}</name>
    <drawOrder>50</drawOrder>
    <Icon><href>files/{fname}</href></Icon>
    <LatLonBox>
      <north>{n:.6f}</north>
      <south>{s:.6f}</south>
      <east>{e:.6f}</east>
      <west>{w:.6f}</west>
    </LatLonBox>
  </GroundOverlay>\n"""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Mongolia Topo 1:200000</name>
{overlays}</Document>
</kml>"""

# Tile бүгдийг цуглуул
all_tiles = []
for x_dir in sorted(TILES_DIR.iterdir()):
    if not x_dir.is_dir(): continue
    x = int(x_dir.name)
    for png in sorted(x_dir.glob("*.png")):
        y_tms = int(png.stem)
        all_tiles.append((x, y_tms, png))

print(f"Нийт {len(all_tiles)} tile олдлоо")

# MAX_TILES-аар хувааж KMZ үүсгэ
chunks = [all_tiles[i:i+MAX_TILES] for i in range(0, len(all_tiles), MAX_TILES)]

for ci, chunk in enumerate(chunks):
    kmz_path = OUT_DIR / f"mongolia_topo_part{ci+1}.kmz"
    tmp_dir  = OUT_DIR / f"_tmp_{ci}"
    tmp_dir.mkdir(exist_ok=True)
    (tmp_dir / "files").mkdir(exist_ok=True)

    tiles_info = []
    for x, y_tms, png_path in chunk:
        n, s, e, w = tile_bounds(x, y_tms, ZOOM)
        jpg_name = f"t_{x}_{y_tms}.jpg"
        # PNG → JPEG (жижигрүүлнэ)
        img = Image.open(png_path).convert("RGB")
        img.save(tmp_dir / "files" / jpg_name, "JPEG", quality=85)
        tiles_info.append((jpg_name, n, s, e, w))

    kml = make_kml(tiles_info)
    (tmp_dir / "doc.kml").write_text(kml, encoding="utf-8")

    with zipfile.ZipFile(kmz_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(tmp_dir / "doc.kml", "doc.kml")
        for f in (tmp_dir / "files").iterdir():
            zf.write(f, f"files/{f.name}")

    shutil.rmtree(tmp_dir)
    size_mb = kmz_path.stat().st_size / 1024 / 1024
    print(f"  ✅ {kmz_path.name} — {len(chunk)} tile, {size_mb:.1f} MB")

print(f"\nДуусав! {OUT_DIR}/ хавтасноос KMZ файлуудыг")
print("цагны /GARMIN/CustomMaps/ хавтсанд хуулна уу.")
