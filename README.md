# Course Intelligence Demo

A portfolio-safe demo of a course catalogue and recommendation workspace.

## What this repository contains

The root page is a static GitHub Pages build. It includes a fictional catalogue, search and filters, course CRUD interactions, course graph exploration, and a deterministic recommendation flow that works without an API key or external service.

All records are fictional demo fixtures. The browser adapter in `demo-api.js` mirrors the original API contracts in memory so the static page remains interactive when hosted on GitHub Pages.

The optional `server/` directory contains the sanitized Node/Express implementation for local experimentation. It does not contain credentials. If a live Groq integration is added later, the key must remain server-side and must never be committed or placed in the static bundle.

## Run the static demo locally

From this repository root:

```bash
python3 -m http.server 4170
```

Then open `http://127.0.0.1:4170/`.

## GitHub Pages

The published demo entry point is the repository root:

```text
https://harshmakhija24.github.io/suggestion-engine-demo-/
```

## Safety boundary

This is a fictionalized portfolio demonstration. It is not connected to any institutional course system, production spreadsheet, or external learning platform.
