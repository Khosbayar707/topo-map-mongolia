# Шинэ давхарга нэмэх заавар

## Алхам 1 — Shapefile хуулах

```
data/
└── ДавхаргынНэр/          ← хавтасны нэр = вэб дээр харагдах нэр
    ├── file.shp
    ├── file.dbf
    ├── file.prj
    └── file.shx
```

Жишээ:
```
data/
└── Голын сүлжээ/
    ├── rivers.shp
    ├── rivers.dbf
    ├── rivers.prj
    └── rivers.shx
```

## Алхам 2 — Upload

```powershell
node -r dotenv/config add_layer.js
```

Эсвэл нэг давхарга:
```powershell
node -r dotenv/config add_layer.js "Голын сүлжээ"
```

## Алхам 3 — Шалгах

```powershell
node -r dotenv/config add_layer.js --list
```

Вэб дээр: https://topo-map.pages.dev (refresh хийнэ үү)

---

## Давхарга устгах

Cloudflare dashboard → R2 → topo-map-tiles → geojson/ хавтсаас файлыг устга,
дараа нь `layers.json`-с тухайн мөрийг гар аргаар устга.

Эсвэл:
```powershell
wrangler r2 object delete topo-map-tiles geojson/ДавхаргынНэр.geojson
```
