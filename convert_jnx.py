"""
PNG tiles → Garmin JNX (BirdsEye) converter
============================================
Input : public/tiles/{z}/{x}/{tms_y}.png   (TMS y convention from gdal2tiles)
Output: map/topo_garmin.jnx

Garmin device руу хуулах зам:
  /Garmin/BirdsEye/topo_garmin.jnx   (internal storage эсвэл SD card)

JNX version 3 format reference:
  https://www.javawa.nl/jnxspecs.html
"""

import struct
import math
import os
import io
import sys
import time

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow байхгүй байна. Дараах командаар суулгана уу:")
    print("  uv run --with pillow python convert_jnx.py")
    sys.exit(1)

# ── Тохиргоо ──────────────────────────────────────────────────────────────────
TILES_DIR    = os.path.join(os.path.dirname(__file__), 'public', 'tiles')
OUTPUT_PATH  = os.path.join(os.path.dirname(__file__), 'map', 'topo_garmin.jnx')
JPEG_QUALITY = 85

# JNX max 5 zoom level. Хамгийн тохиромжтой 5-г сонгоно.
# Гар утасны цагийн дэлгэцийн хувьд zoom 8-12 хамгийн ашигтай.
WANTED_ZOOMS = [7, 8, 9, 10, 11]

# Garmin-ы "scale" утгууд – zoom level тус бүрт (empirical, working values)
ZOOM_SCALE = {
    6:  49152,
    7:  24576,
    8:  12288,
    9:   6144,
    10:  3072,
    11:  1536,
    12:   768,
    13:   384,
    14:   192,
}

# ── Туслах функцүүд ────────────────────────────────────────────────────────────
def deg_to_garmin(deg):
    """Decimal degrees → Garmin 32-bit semicircle integer."""
    return int(round(deg * (2**31) / 180.0))

def tms_y_to_xyz(z, tms_y):
    return (1 << z) - 1 - tms_y

def tile_bbox(z, x, y_xyz):
    """XYZ tile → (lat_top, lon_left, lat_bot, lon_right)."""
    n = 1 << z
    lon_l = x / n * 360.0 - 180.0
    lon_r = (x + 1) / n * 360.0 - 180.0
    lat_t = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y_xyz / n))))
    lat_b = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y_xyz + 1) / n))))
    return lat_t, lon_l, lat_b, lon_r

def png_to_jpeg(path):
    """PNG файлыг JPEG bytes болгоно (JNX зөвхөн JPEG дэмждэг)."""
    with Image.open(path) as img:
        if img.mode in ('RGBA', 'LA', 'PA'):
            bg = Image.new('RGB', img.size, (255, 255, 255))
            alpha = img.convert('RGBA').split()[3]
            bg.paste(img.convert('RGB'), mask=alpha)
            img_rgb = bg
        elif img.mode != 'RGB':
            img_rgb = img.convert('RGB')
        else:
            img_rgb = img.copy()
        buf = io.BytesIO()
        img_rgb.save(buf, format='JPEG', quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()

# ── Tile цуглуулах ─────────────────────────────────────────────────────────────
def collect_zoom(z):
    z_dir = os.path.join(TILES_DIR, str(z))
    if not os.path.isdir(z_dir):
        return []
    tiles = []
    for x_str in os.listdir(z_dir):
        x_dir = os.path.join(z_dir, x_str)
        if not os.path.isdir(x_dir):
            continue
        x = int(x_str)
        for fname in os.listdir(x_dir):
            if not fname.endswith('.png'):
                continue
            tms_y = int(fname[:-4])
            y_xyz = tms_y_to_xyz(z, tms_y)
            tiles.append((x, y_xyz, os.path.join(x_dir, fname)))
    return tiles

# ── JNX бичих ─────────────────────────────────────────────────────────────────
def write_jnx(output, levels, bounds):
    """
    levels : [(zoom, [(x, y_xyz, path), ...]), ...]
    bounds : (west, south, east, north)
    """
    west, south, east, north = bounds
    n_levels = len(levels)

    # --- Алхам 1: PNG → JPEG хөрвүүлэлт ---
    print("\nPNG → JPEG хөрвүүлж байна...")
    converted = []
    for zoom, tile_list in levels:
        tiles_out = []
        done = 0
        t0 = time.time()
        for x, y_xyz, path in tile_list:
            lat_t, lon_l, lat_b, lon_r = tile_bbox(zoom, x, y_xyz)
            jpeg = png_to_jpeg(path)
            tiles_out.append({
                'top':    deg_to_garmin(lat_t),
                'right':  deg_to_garmin(lon_r),
                'bottom': deg_to_garmin(lat_b),
                'left':   deg_to_garmin(lon_l),
                'w': 256, 'h': 256,
                'data': jpeg,
            })
            done += 1
            if done % 200 == 0 or done == len(tile_list):
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                remaining = (len(tile_list) - done) / rate if rate > 0 else 0
                print(f"  zoom {zoom}: {done}/{len(tile_list)} tiles"
                      f"  ({rate:.0f} tiles/s, ~{remaining:.0f}s үлдсэн)", end='\r')
        print(f"  zoom {zoom}: {len(tiles_out)} tile ✓              ")
        converted.append((zoom, tiles_out))

    # --- Алхам 2: файлын байрлал тооцоолох ---
    HEADER_BYTES   = 32   # 8 × int32
    LEVEL_HDR_SIZE = 20   # 5 × uint32 per level
    TILE_REC_SIZE  = 28   # per tile index record

    tile_idx_start = HEADER_BYTES + n_levels * LEVEL_HDR_SIZE

    tiles_offsets = []
    off = tile_idx_start
    for _, tiles in converted:
        tiles_offsets.append(off)
        off += len(tiles) * TILE_REC_SIZE

    jpeg_start = off

    jpeg_off = jpeg_start
    for _, tiles in converted:
        for t in tiles:
            t['offset'] = jpeg_off
            jpeg_off += len(t['data'])

    total_size = jpeg_off

    # --- Алхам 3: файл бичих ---
    print(f"\nJNX файл бичиж байна: {output}")
    print(f"  Нийт хэмжээ: ~{total_size / 1024 / 1024:.0f} MB")
    os.makedirs(os.path.dirname(output), exist_ok=True)

    with open(output, 'wb') as f:
        # File header (32 bytes)
        f.write(struct.pack('<iiiiiiii',
            3,                    # JNX version
            0,                    # device serial (0 = any device)
            deg_to_garmin(north),
            deg_to_garmin(west),
            deg_to_garmin(south),
            deg_to_garmin(east),
            n_levels,
            0,                    # expire (0 = never)
        ))

        # Level headers (20 bytes each)
        for i, (zoom, tiles) in enumerate(converted):
            f.write(struct.pack('<IIIII',
                len(tiles),
                tiles_offsets[i],
                ZOOM_SCALE[zoom],
                0,   # copyright string offset (none)
                0,   # copyright string length
            ))

        # Tile index records (28 bytes each)
        for _, tiles in converted:
            for t in tiles:
                f.write(struct.pack('<iiiiHHII',
                    t['top'], t['right'], t['bottom'], t['left'],
                    t['w'], t['h'],
                    len(t['data']),
                    t['offset'],
                ))

        # JPEG data
        written = 0
        total_tiles = sum(len(t) for _, t in converted)
        for _, tiles in converted:
            for t in tiles:
                f.write(t['data'])
                written += 1
                if written % 500 == 0 or written == total_tiles:
                    pct = written / total_tiles * 100
                    print(f"  {written}/{total_tiles} ({pct:.0f}%)...", end='\r')

    actual = os.path.getsize(output)
    print(f"\n\n✓ Дууслаа!")
    print(f"  Нийт tile: {sum(len(t) for _, t in converted)}")
    print(f"  Файлын хэмжээ: {actual / 1024 / 1024:.1f} MB")
    print(f"\nGarmin руу хуулах зам:")
    print(f"  /Garmin/BirdsEye/topo_garmin.jnx")
    print(f"\nAnэтгэгдэл (зарим цаг BirdsEye subscription шаардана):")
    print(f"  Fenix 6/7, MARQ, Montana 700 – subscription шаардахгүй")
    print(f"  Fenix 5 – шаардаж болно")

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("=" * 50)
    print("  PNG Tiles → Garmin JNX хөрвүүлэгч")
    print("=" * 50)

    # Байгаа zoom level-үүдийг олох
    available = [z for z in WANTED_ZOOMS
                 if os.path.isdir(os.path.join(TILES_DIR, str(z)))]

    if not available:
        print(f"АЛДАА: {TILES_DIR} дотор tile олдсонгүй!")
        sys.exit(1)

    print(f"\nОлдсон zoom level-үүд: {available}")
    if len(available) > 5:
        # JNX max 5 levels – сүүлийн 5-г авна (нарийн zoom)
        available = available[-5:]
        print(f"JNX хязгаар 5 level → {available} ашиглана")

    # Tile цуглуулах
    levels = []
    g_north, g_south, g_east, g_west = -90, 90, -180, 180

    for z in available:
        tiles = collect_zoom(z)
        if not tiles:
            print(f"  zoom {z}: tile байхгүй, алгасав")
            continue

        for x, y_xyz, _ in tiles:
            lat_t, lon_l, lat_b, lon_r = tile_bbox(z, x, y_xyz)
            g_north = max(g_north, lat_t)
            g_south = min(g_south, lat_b)
            g_east  = max(g_east,  lon_r)
            g_west  = min(g_west,  lon_l)

        print(f"  zoom {z}: {len(tiles)} tile")
        levels.append((z, tiles))

    if not levels:
        print("Tile олдсонгүй!")
        sys.exit(1)

    total = sum(len(t) for _, t in levels)
    print(f"\nНийт: {total} tile, {len(levels)} zoom level")
    print(f"Хязгаар: {g_west:.2f}°E – {g_east:.2f}°E, {g_south:.2f}°N – {g_north:.2f}°N")

    # Таамаглалт цаг
    est_min = total * 0.05 / 60  # ~50ms per tile
    print(f"Тооцоолсон хугацаа: ~{est_min:.0f} минут")
    if '--confirm' not in sys.argv:
        print("\nЭхлэх үү? (Enter дарна уу / Ctrl+C гарна уу)")
        try:
            input()
        except KeyboardInterrupt:
            print("\nЦуцлагдлаа.")
            sys.exit(0)

    t_start = time.time()
    write_jnx(OUTPUT_PATH, levels, (g_west, g_south, g_east, g_north))
    elapsed = time.time() - t_start
    print(f"Нийт хугацаа: {elapsed/60:.1f} минут")

if __name__ == '__main__':
    main()
