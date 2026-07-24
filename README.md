# US Bloom Scout

**Fast Pikmin Bloom decor finder built for the United States.**

Most existing decor maps were built and hosted with Europe-first workflows. They query live Overpass on every click, which is often **slow or times out from the US**. This project flips that:

- **US-first default** — opens on ZIP **50010 (Ames, Iowa)** with a real downtown pin, not a random world map
- **Instant local cache** — preloads OSM places for the home ZIP so nearby scans and “find a decor” don’t wait on overseas Overpass round-trips
- **Same decor logic** — OSM tags → in-game categories (restaurant, park, station, …), ~100&nbsp;m detector range

Live site (after Pages is enabled): **https://no1summer.github.io/us-bloom-scout/**

## Why US-first?

| | Typical prior maps | **US Bloom Scout** |
|--|--|--|
| Default region | Often EU / click-anywhere blank slate | United States (Ames · 50010) |
| First load | Live Overpass every time | Bundled US ZIP snapshot → **instant** |
| From US networks | Slow / 504 / rate limits common | Cache hit for home area; live API only outside it |

Community tools this builds on (tag mappings, ideas): [bloom-decor-map](https://github.com/midwestindigoenjoyer/bloom-decor-map), [pixlpirate/pikmin-map](https://github.com/pixlpirate/pikmin-map), [Pikipedia Decor list](https://www.pikminwiki.com/Decor_Pikmin).

## How it works

1. Land on downtown Ames (or search any US address).
2. **Nearby all** — decor within ~100&nbsp;m of the pin (cached inside 50010).
3. **Find a decor** — pick a type (Park, Sushi, Station, …) and list every match in the cached ZIP instantly.
4. Outside the cached bbox, the app falls back to live Overpass (slower).

## Accuracy

Uses OSM data (cached + live). Pikmin Bloom also pulls other sources and may use older OSM snapshots, so results can differ from the game.

## Local development

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## Files

| Path | Purpose |
|------|---------|
| `index.html` | App shell |
| `app.js` | Map UI, US cache path, Overpass fallback |
| `decor-mappings.js` | Decor category ↔ OSM tags |
| `styles.css` | Layout / theme |
| `data/ames-50010.json` | Preloaded US OSM snapshot (ZIP 50010) |
| `bloom-scout-standalone.html` | Single-file build with cache inlined |

## Extending to more US cities

Drop another `data/<zip>.json` snapshot and point `HOME` in `app.js` at it — same instant path, no Europe-roundtrip required.

## License

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).  
Fan-made tool — not affiliated with Nintendo or Niantic.
