## Summary

- **Mobile responsive**: Layer panel becomes a bottom drawer on mobile with FAB toggle, swipe-to-close, and backdrop overlay
- **Admin upload page** (`/upload`): Password-protected page for shapefile upload and layer management — removed from public main page
- **Delete API** (`/api/delete`): New Pages Function to remove layers from R2 and layers.json
- **R2 CORS fix**: Configured CORS on R2 bucket so browser fetch() calls to GeoJSON files succeed
- **layers.json fixes**: Repaired corrupted filename entry; added cache-busting and correct layer.file field usage
- **Admin login button** added to header (subtle lock icon)

## Test plan

- [ ] Open https://topo-map.pages.dev on mobile — FAB visible, panel slides up from bottom
- [ ] Swipe down or tap backdrop to close panel
- [ ] Navigate to https://topo-map.pages.dev/upload — password gate shown
- [ ] Enter `topo2024` to unlock admin UI and load layer list
- [ ] Shapefile folder upload converts to GeoJSON and appears in layer list
- [ ] Delete button removes layer from R2 and list
- [ ] Main map loads shapefile layers correctly from R2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
