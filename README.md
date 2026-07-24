# Bloom Scout

Interactive map to find **Pikmin Bloom** decor locations near you.

Live site (after Pages is enabled): **https://no1summer.github.io/bloom-scout/**

## How it works

1. Pick a place on the map (defaults to ZIP **50010 · Ames, Iowa**).
2. The app matches nearby OpenStreetMap places to in-game decor categories (restaurant, park, station, …).
3. Results show within ~100&nbsp;m — the game’s approximate detector range.

**Find a decor** mode lists all matching spots inside the cached 50010 area instantly.

## Accuracy

- Uses **live / cached OSM** data. Pikmin Bloom also uses other sources (e.g. Foursquare) and may use older OSM snapshots, so results can differ from the game.
- Decor ↔ OSM tag mappings adapted from community work ([Pikipedia](https://www.pikminwiki.com/Decor_Pikmin), [bloom-decor-map](https://github.com/midwestindigoenjoyer/bloom-decor-map), [pixlpirate/pikmin-map](https://github.com/pixlpirate/pikmin-map)).

## Local development

```bash
cd bloom-scout   # or pikmin-bloom-decor-map
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## Files

| Path | Purpose |
|------|---------|
| `index.html` | App shell |
| `app.js` | Map UI, Overpass queries, 50010 cache |
| `decor-mappings.js` | Decor category ↔ OSM tags |
| `styles.css` | Layout / theme |
| `data/ames-50010.json` | Preloaded OSM snapshot for ZIP 50010 |
| `bloom-scout-standalone.html` | Single-file offline-friendly build |

## License

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
This project is a fan-made tool and is not affiliated with Nintendo or Niantic.
