"""
JNX файл шалгагч + tile задлагч
================================
Хэрэглээ:
  uv run --with pillow --python 3.14 python inspect_jnx.py
  uv run --with pillow --python 3.14 python inspect_jnx.py --tiles 20   # 20 tile задлах
"""
import struct, os, sys, math
from pathlib import Path

JNX_PATH   = Path(__file__).parent / 'map' / 'topo_garmin.jnx'
OUT_DIR    = Path(__file__).parent / 'jnx_preview'
EXTRACT_N  = int(sys.argv[sys.argv.index('--tiles') + 1]) if '--tiles' in sys.argv else 6

def garmin_to_deg(v):
    return v * 180.0 / (2**31)

def read_jnx(path):
    with open(path, 'rb') as f:
        data = f.read()

    off = 0
    version, dev_id, top, left, bottom, right, n_levels, expire = struct.unpack_from('<iiiiiiii', data, off)
    off += 32

    print(f"{'='*52}")
    print(f"  JNX файлын мэдээлэл: {path.name}")
    print(f"{'='*52}")
    print(f"  Version   : {version}")
    print(f"  Levels    : {n_levels}")
    print(f"  Top       : {garmin_to_deg(top):.4f}°N")
    print(f"  Left      : {garmin_to_deg(left):.4f}°E")
    print(f"  Bottom    : {garmin_to_deg(bottom):.4f}°N")
    print(f"  Right     : {garmin_to_deg(right):.4f}°E")
    print(f"  Файлын хэмжээ: {path.stat().st_size / 1024 / 1024:.1f} MB")
    print()

    levels = []
    for i in range(n_levels):
        tile_count, tiles_offset, scale, cright_off, cright_len = struct.unpack_from('<IIIII', data, off)
        off += 20
        levels.append({'tile_count': tile_count, 'tiles_offset': tiles_offset, 'scale': scale})
        print(f"  Level {i}: {tile_count:,} tiles  |  scale={scale}  |  tile index @ offset {tiles_offset}")

    print()

    tiles_all = []
    for li, lv in enumerate(levels):
        off2 = lv['tiles_offset']
        tiles = []
        for _ in range(lv['tile_count']):
            t_top, t_right, t_bot, t_left, w, h, size, offset = struct.unpack_from('<iiiiHHII', data, off2)
            off2 += 28
            tiles.append({
                'top':    garmin_to_deg(t_top),
                'right':  garmin_to_deg(t_right),
                'bottom': garmin_to_deg(t_bot),
                'left':   garmin_to_deg(t_left),
                'w': w, 'h': h,
                'size': size, 'offset': offset,
                'level': li,
            })
        tiles_all.append(tiles)
        if tiles:
            t0 = tiles[0]
            print(f"  Level {li} дэх эхний tile:")
            print(f"    Байршил: {t0['top']:.3f}°N – {t0['bottom']:.3f}°N, "
                  f"{t0['left']:.3f}°E – {t0['right']:.3f}°E")
            print(f"    Хэмжээ: {t0['w']}×{t0['h']}px,  JPEG {t0['size']} bytes")
            # Verify JPEG magic
            magic = data[t0['offset']:t0['offset']+2]
            ok = '✓ зөв JPEG' if magic == b'\xff\xd8' else f'✗ буруу ({magic.hex()})'
            print(f"    JPEG толгой: {ok}")
        print()

    return data, tiles_all

def extract_tiles(data, tiles_all, n):
    """Tile-уудыг JPEG болон нэгдсэн PNG preview болгон хадгална."""
    try:
        from PIL import Image
        has_pil = True
    except ImportError:
        has_pil = False

    OUT_DIR.mkdir(exist_ok=True)

    # Сүүлийн (хамгийн нарийн) level-ийн төв орчмын tile-уудыг авна
    last_tiles = tiles_all[-1]
    mid = len(last_tiles) // 2
    sample = last_tiles[max(0, mid - n//2) : mid + n//2 + 1][:n]

    print(f"  {len(sample)} tile задлаж байна...")
    paths = []
    for i, t in enumerate(sample):
        jpeg = data[t['offset'] : t['offset'] + t['size']]
        out = OUT_DIR / f"tile_L{t['level']}_{i:03d}.jpg"
        out.write_bytes(jpeg)
        paths.append((out, t))
        print(f"    {out.name}  ({t['left']:.2f}°E–{t['right']:.2f}°E)")

    if has_pil and paths:
        # Нэгдсэн grid preview үүсгэнэ
        cols = 3
        rows = math.ceil(len(paths) / cols)
        grid = Image.new('RGB', (cols * 256, rows * 256), (20, 20, 40))
        for idx, (p, _) in enumerate(paths):
            img = Image.open(p).resize((256, 256))
            r, c = divmod(idx, cols)
            grid.paste(img, (c * 256, r * 256))
        grid_path = OUT_DIR / 'preview_grid.jpg'
        grid.save(grid_path, quality=90)
        print(f"\n  Grid preview: {grid_path}")

    print(f"\n  Бүх задласан файл: {OUT_DIR}/")

def main():
    if not JNX_PATH.exists():
        print(f"ERROR: {JNX_PATH} олдсонгүй!")
        sys.exit(1)

    data, tiles_all = read_jnx(JNX_PATH)

    total = sum(len(t) for t in tiles_all)
    print(f"  Нийт tile: {total:,}")
    print()

    extract_tiles(data, tiles_all, EXTRACT_N)

if __name__ == '__main__':
    main()
