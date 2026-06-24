## Summary

- **Garmin Custom Maps (KMZ)**: 11-part HD topo map generated from zoom-11 tiles merged 4x4 (1024x1024px each); fixes TMS y-axis flip and lat/lon bounds swap bugs that caused misaligned stripes
- **JNX download**: BirdsEye-format topo map for Garmin GPS navigators (Oregon, GPSMAP etc.)
- **GPX export**: Per-shapefile-layer GPX download button in the layer panel (browser-side GeoJSON to GPX conversion, no server needed)
- **Admin lock button**: Restored subtle lock icon in header pointing to /upload
- **Bug fix**: Removed stale upload JavaScript from main page that referenced removed DOM elements, causing the map to stay stuck on loading screen
- **KMZ generation scripts**: make_kmz.js (zoom-8 draft) and make_kmz_hd.js (zoom-11 HD, production)

## Test plan

- [ ] Open https://topo-map.pages.dev -- map loads without infinite spinner
- [ ] Header shows lock button linking to /upload
- [ ] Layer panel Garmin section shows Part 1-11 download buttons
- [ ] Each KMZ part downloads from R2 successfully
- [ ] Open a KMZ in Google Earth -- tiles align correctly with no black stripes
- [ ] Copy KMZ files to /GARMIN/CustomMaps/ on Garmin Venu X1 -- topo map visible
- [ ] Shapefile layer card shows GPX download button after layer loads
- [ ] GPX download produces valid file openable in Garmin Express

Generated with [Claude Code](https://claude.com/claude-code)
