# Bannerfall

A minimalist real-time strategy game in the spirit of Thronefall — flat colors, hard-edged shadows, tiny chunky armies — playable directly in the browser. No build step, no dependencies: plain HTML5 canvas and ES modules.

**▶ Play it here: https://mirator.github.io/bannerfall/**

## Run locally

Any static file server works (ES modules require http://, not file://):

```
python scripts/serve.py
```

then open http://localhost:8000.

## Structure

- `index.html` — entry point
- `src/` — game code (engine, world map, battles, data)
- `tests/qa_suite.js` — headless QA checks
- `scripts/` — local dev helpers (static server, screenshot server)
- `critiques/` — design critique notes from the build process
