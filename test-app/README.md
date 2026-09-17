# PDF Stamp and Send test app

This directory is a standalone Zendesk Support app. It does not replace the existing app in the repository root.

## Structure

- `manifest.json` — Zendesk app manifest for this test app
- `index.html` — Zendesk entry point
- `app.js` — JSX source for the test app
- `config.js` — validated field and stamp configuration
- `styles.css` — app styles
- `dist/app.js` — generated browser bundle after building

## Build

From this directory:

```bash
npm install
npm run build
```

The generated bundle is written to `dist/app.js`. Build it before packaging the app for Zendesk.
