"""Zoom 7 зөвхөн тест — map/topo_test.jnx"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

# Override settings before importing
import convert_jnx as jnx
jnx.WANTED_ZOOMS = [7]
jnx.OUTPUT_PATH  = os.path.join(os.path.dirname(__file__), 'map', 'topo_test.jnx')

tiles = jnx.collect_zoom(7)
print(f"zoom 7: {len(tiles)} tiles олдлоо")

for x, y, _ in tiles[:3]:
    lat_t, lon_l, lat_b, lon_r = jnx.tile_bbox(7, x, y)
    print(f"  tile({x},{y}): {lat_t:.2f}N {lon_l:.2f}E → {lat_b:.2f}N {lon_r:.2f}E")

# Bounds
g_north, g_south, g_east, g_west = -90, 90, -180, 180
for x, y, _ in tiles:
    lat_t, lon_l, lat_b, lon_r = jnx.tile_bbox(7, x, y)
    g_north = max(g_north, lat_t); g_south = min(g_south, lat_b)
    g_east  = max(g_east, lon_r);  g_west  = min(g_west, lon_l)

print(f"\nBounds: {g_west:.2f}°E – {g_east:.2f}°E, {g_south:.2f}°N – {g_north:.2f}°N")
print("JNX бичиж байна...")

jnx.write_jnx(jnx.OUTPUT_PATH, [(7, tiles)], (g_west, g_south, g_east, g_north))

# Verify file structure
import struct
with open(jnx.OUTPUT_PATH, 'rb') as f:
    ver, dev, top, left, bot, right, levels, expire = struct.unpack('<iiiiiiii', f.read(32))
    print(f"\nJNX header шалгалт:")
    print(f"  Version:  {ver}")
    print(f"  Levels:   {levels}")
    print(f"  Top:      {top / 2**31 * 180:.4f}°")
    print(f"  Left:     {left / 2**31 * 180:.4f}°")
    print(f"  Bottom:   {bot / 2**31 * 180:.4f}°")
    print(f"  Right:    {right / 2**31 * 180:.4f}°")
    # Level 0
    tc, toff, scale, coff, clen = struct.unpack('<IIIII', f.read(20))
    print(f"  Level 0:  {tc} tiles, offset={toff}, scale={scale}")

print(f"\n✓ topo_test.jnx ({os.path.getsize(jnx.OUTPUT_PATH)/1024:.0f} KB)")
print("Энэ файлыг Garmin руу /Garmin/BirdsEye/topo_test.jnx хуулж туршина уу.")
