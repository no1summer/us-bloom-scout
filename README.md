# US Bloom Scout

**Fast Pikmin Bloom decor finder built for the United States.**

Most existing decor maps were built with Europe-first workflows and query live Overpass on every click, which is often **slow or times out from the US**. This project is US-first:

- Search **any US ZIP, city, or address**
- **Nearby** scan within ~100&nbsp;m (game detector range)
- **Find a decor** lists that type in your **current map view** (pan/zoom or search first)
- Geocoding prefers the US so ZIP codes resolve correctly

Live site: **https://no1summer.github.io/us-bloom-scout/**

## Why US-first?

| | Typical prior maps | **US Bloom Scout** |
|--|--|--|
| Default audience | Often EU-oriented | United States |
| ZIP / city search | Generic / EU-biased geocoding | US-preferring Nominatim |
| Live Overpass from US | Slow / 504 / rate limits common | Same APIs, plus request caching |

Tag mappings build on community work: [bloom-decor-map](https://github.com/midwestindigoenjoyer/bloom-decor-map), [pixlpirate/pikmin-map](https://github.com/pixlpirate/pikmin-map), [Pikipedia](https://www.pikminwiki.com/Decor_Pikmin).

## How it works

1. Search a ZIP (e.g. `78701`) or city, or use **my location**.
2. Multi-select decor types, then **Show in area**.

## Accuracy

Uses OpenStreetMap data. Pikmin Bloom also pulls other sources and may use older OSM snapshots, so results can differ from the game.

## Local development

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## License

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).  
Fan-made tool — not affiliated with Nintendo or Niantic.
