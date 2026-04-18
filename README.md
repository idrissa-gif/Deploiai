# Deploia-Green companion site

Static companion page for the ECML PKDD 2026 Industrial Track paper
*Green Training at Scale: Data Sampling Strategies for Energy-Aware
Learning in Industry*.

## Contents
- `index.html` — single-page site (methodology + results)
- `style.css`  — dark theme
- `app.js`     — Plotly.js chart layer, reads `data.json`
- `data.json`  — pre-aggregated benchmark results
- `build_data.py` — regenerates `data.json` from `results/benchmark/**`

## Local preview
```bash
cd docs/site
python -m http.server 8000   # then open http://127.0.0.1:8000
```

## Regenerate `data.json`
```bash
python docs/site/build_data.py
```

## Hosting
Any static host works. For GitHub Pages, configure Pages to serve the
repository from `/docs/site` or push this folder to the root of a
dedicated gh-pages branch.
