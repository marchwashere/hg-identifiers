# Gen 4 Identifier — static web package

## Deploy

Extract the ZIP and upload the **contents** of its folder to a static directory
on your server. `index.html`, `catalog.json`, the JavaScript/CSS files, and the
entire `data/` directory must stay together. Then visit that directory over
HTTP or HTTPS. If deployed in a subdirectory, visit its trailing-slash URL,
for example `https://your-server.example/identifier/`.

Works with Nginx, Apache, Caddy, or other ordinary static hosting. No Rust,
Node.js, Python, database, API server, build step, or external CDN is required
on the production server. Do not double-click index.html: browsers restrict
the local-file fetches used to load the catalogue.

The package includes snapshots of the current Falkner and Whitney exports.
They are already bundled; visitors do not need to choose a directory. Each
cluster shows its win rate before selection. Full data downloads only after
selection. Original observations are used for identification, and the saved
parser projects actual route replay events for the solution display.

The bundled catalogue loads automatically. There are no JSON upload or dataset
reload controls. If loading fails, refresh the page to retry. There is no
analytics or third-party network call.

## Hosting and caching

- Serve `.json` as `application/json`, `.js` as `text/javascript`, and `.css`
  as `text/css`. Do not redirect missing assets to index.html: return 404.
- Enable HTTP gzip or Brotli for JSON/JS/CSS. JSON is minified without dropping
  fields, but the Whitney collection is large; HTTP compression helps greatly.
- Set `Cache-Control: no-cache` on index.html, catalog.json, and JS/CSS.
- Files in `data/` have SHA-256 content-addressed names and can use
  `Cache-Control: public, max-age=31536000, immutable`.
- Upload new data assets first and catalog.json last (or deploy a complete
  release atomically). Keep old hashed assets while older pages may use them.
- Use HTTPS when publicly hosting. Protect the directory with server-side
  authentication if access should be private: **all bundled data is downloadable
  by anyone who can access the site**. No password/authentication is built in.
- No SPA routing fallback, CORS configuration, or service worker is needed when
  the application and data are served together.

## Local preview (optional)

From the extracted folder, if Python is installed:

```text
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/`. Stop the preview with Ctrl+C.

## Rebuild with newer data (development machine only)

From the hg-identifiers repository, with Node.js installed:

```text
node tools/build-web.cjs --source "C:/path/to/Identifier" --out "C:/path/to/new-web-output"
```

The source must have Falkner and Whitney scenario folders. It is read-only.
The output must be a new directory; the builder refuses to overwrite an existing
release. Only these two scenario folders are bundled, including nested clusters.
The build validates observations and route event format, computes win counts,
and preserves the JSON data exactly apart from insignificant whitespace.
