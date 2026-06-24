## Summary

- **PNG/PDF export alignment fix**: Replaced SVG serialization with direct canvas path drawing using `map.latLngToContainerPoint()` — same projection Leaflet uses internally, guaranteeing pixel-perfect tile alignment
- **Label export**: Permanent labels rendered from geographic centroid via Leaflet projection (no DOM offset issues)
- **Export size picker**: Dialog with A4/A3 landscape/portrait options + DPI scale (1x/2x/3x)
- **Legend and title on canvas**: Drawn directly to avoid Cyrillic garbling in jsPDF
- **Iterative bug fixes**: leaflet-image incompatibility, SVG viewBox offset, `l.style.labelField` path, `roundRect` compatibility

## Test plan

- [ ] Open https://topo-map.pages.dev/editor
- [ ] Load a .shp file -- polygons appear correctly on map
- [ ] Click Export button -- size dialog appears with A4/A3/DPI options
- [ ] Export PNG -- polygons aligned with basemap tiles
- [ ] Export PDF -- title, legend, north arrow visible; Cyrillic renders correctly
- [ ] Enable labels on a field -- labels appear in correct position in export
- [ ] Test categorized and graduated color modes in export

Generated with [Claude Code](https://claude.com/claude-code)
