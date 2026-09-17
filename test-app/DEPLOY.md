# Test app packaging checklist

1. From this directory, run `npm install`.
2. Run `npm run build`.
3. Confirm `dist/app.js` exists.
4. Package the contents of this directory so `manifest.json` is at the ZIP root.
5. Upload the ZIP as a private Zendesk Support app in a test environment.

The original root-level `manifest.json` and `assets/` app are not part of this test package.
