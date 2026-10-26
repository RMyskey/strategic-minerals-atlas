# Quantum Xi — Strategic Mine Ownership Atlas

**Live site:** https://rmyskey.github.io/strategic-minerals-atlas/ · **Repo:** https://github.com/RMyskey/strategic-minerals-atlas

A static website: an open-source GEOINT decision-support tool tracking who owns the 147 major mines that dominate world supply of US critical minerals. The site has no server code. A scheduled GitHub Actions job refreshes the intel feed, filings and prices, then redeploys to GitHub Pages.

## Run locally
```
python3 -m http.server 8000      # then open http://localhost:8000
```
Opening `index.html` from disk (file://) also works, because the data is bundled in `assets/js/data.js`.

## Data pipeline (`scripts/`, Python 3.10+ standard library only)
```
python3 scripts/pipeline.py                 # run every feed that is due, then rebuild
python3 scripts/pipeline.py --force         # ignore cadence and run all feeds
python3 scripts/pipeline.py --only gnews,sec
python3 scripts/pipeline.py --build-only    # rebuild data/*.json, geojson, csv and assets/js/data.js from data/source/
```
The canonical, analyst-curated data lives in `data/source/` (`mines_master.json`, `reference.json`, `countries.geojson`, `sec_registrants.json`). Everything else in `data/`, plus `assets/js/data.js`, is generated. `data/meta.json` records per-feed status and last-success timestamps.

| Feed | Cadence | What it does |
|---|---|---|
| GDELT DOC 2.0 | daily | Topic queries (nationalisation, sanctions, suspension, ownership); headlines matched locally to mine and owner names |
| Google News RSS | daily | Name-group queries plus the same category matching |
| MINING.COM RSS | daily | Same matching |
| Wikidata SPARQL | weekly | Diffs coordinates (P625) and owner/operator (P127/P137) against `data/state/wikidata_snapshot.json`; changes are **flagged for review only** |
| SEC EDGAR | weekly | Recent 10-K/10-Q/8-K/6-K/20-F/40-F filings for US-listed owners; annual reports also create review items |
| World Bank Pink Sheet | monthly | 12 monthly commodity price series |
| FRED | monthly | Commodity price series (needs `FRED_API_KEY`, otherwise skipped) |
| USGS MCS | annual | Checks whether a new Mineral Commodity Summaries edition is published |

**Curated figures (owners, equity, production, coordinates) are never changed automatically.** Possible changes go into `data/review.json` and are shown in the site's "Review queue". An analyst verifies the source, edits `data/source/mines_master.json`, and runs `--build-only`. News alerts are machine-matched headlines, not verified facts. Empty, missing or failed feeds degrade gracefully: the site shows each feed's status, and the previous data is kept.

## Go-live / operations (GitHub Pages)
1. Settings → Pages → Source: **GitHub Actions** (already enabled).
2. `.github/workflows/pages.yml` deploys on every push to `main`.
3. `.github/workflows/refresh-data.yml` runs **daily at 06:00 UTC** (23:00 Arizona time) and on demand (Actions → Refresh data → Run workflow, with an optional `force` input). It runs the pipeline, commits changed data as github-actions[bot], then deploys.
4. Repository secrets (Settings → Secrets and variables → Actions):
   - `SEC_USER_AGENT`: **required for the SEC feed.** SEC asks for a contact, e.g. `Quantum Xi Mine Atlas ops@yourdomain.com`. Without it the feed reports `needs_config`.
   - `FRED_API_KEY`: optional (free key from fred.stlouisfed.org). Without it the feed reports `needs_key`.
   - `MAPTILER_KEY` or `ESRI_API_KEY`: optional basemap key. The deploy writes it into `assets/js/config.js`. Browser map keys are public by nature, so **restrict the key to `rmyskey.github.io`** in the provider console. Without a key the site uses keyless Esri services.

## Structure
| Path | Contents |
|---|---|
| `index.html` | Single-page app: map, intel feed, network, chart builder, data register, findings, method, sources, about |
| `assets/js/app.js`, `geo.js`, `config.js` | Application; WGS 84/MGRS helpers; tile provider config (`esri`, `esri-key`, `maptiler`) |
| `assets/js/data.js` | Generated data bundle |
| `assets/vendor/`, `assets/fonts/` | MapLibre GL JS 5.15.0 and ECharts 5.6.0, vendored; Noto Sans glyphs |
| `data/source/` | Canonical curated data (edit here) |
| `data/*.json`, `data/mines.geojson`, `data/mines.csv` | Generated outputs, including `updates.json`, `prices.json`, `review.json` and `meta.json` |
| `scripts/` | Pipeline (`pipeline.py`, `qxatlas/`) |
| `screenshots/` | Headless-Chrome test captures |

## Tile services
Esri World Imagery, World Topographic Map, Dark Gray Canvas and Boundaries & Places come from server.arcgisonline.com; Terrarium DEM tiles come from AWS for hillshade and 3D. Keyless Esri basemaps are meant for non-commercial or limited use. For production traffic, add a key and keep attribution visible.

## Data rules
No values were invented; anything without a credible public source shows as `n/a`. Coordinate precision classes:
- **S** — 87 mines site-verified on imagery (about 1 km).
- **W** — 14 mines from Wikidata/Wikipedia (about 2.5 km).
- **D** — 23 district centroids (about 25 km).
- **A** — 23 approximate positions (about 15 km).
