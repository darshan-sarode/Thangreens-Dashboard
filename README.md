# 📊 Thangreens Greenhouse Dashboard

A static dashboard visualizing ambient temperature, humidity, and water temperature
from the Thangreens greenhouse sensors (`West GH` and `East GH`).

Live site: **https://<your-username>.github.io/stok-dashboard/**

## Files

| File | Purpose |
|------|---------|
| `index.html` | Main dashboard — time-series charts with pan/zoom, CSV/XLSX import |
| `report.html` | Field report page (Chart.js) |
| `data.js` | Embedded dataset auto-loaded on startup (generated) |
| `build-data.js` | Node script that regenerates `data.js` from sensor CSVs |
| `*.csv` | Sample / reference sensor data |

Built with **Chart.js**, **Chart.js zoom plugin**, **PapaParse**, and **SheetJS (xlsx)** —
all loaded from CDNs, no build step or package manager required.

## Regenerating the data

The dashboard is served as plain static files, so the data bundle is committed.
To refresh it from the source sensor CSVs (located in
`C:\Users\darsh\Downloads\Thangreens\data\`):

```bash
node build-data.js
```

This parses each CSV, validates against the dashboard's range rules, merges by
greenhouse + type, deduplicates, sorts, and decimates with LTTB so Chart.js
stays responsive (max 2000 points per series).

## Deploying to GitHub Pages

1. Create a public GitHub repo (no README init) — e.g. `stok-dashboard`.
2. Push these files:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/stok-dashboard.git
   git push -u origin main
   ```

3. In the repo: **Settings → Pages** → under **Branch**, select `main` and `/ (root)` → **Save**.
4. Visit `https://<your-username>.github.io/stok-dashboard/` after a minute or two.

> Internal links and data files use relative paths, so the site works correctly
> under the `/stok-dashboard/` subpath with no config changes.