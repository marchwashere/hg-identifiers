# HG Identifiers

Standalone static browser version of the Gen 4 seed identifier. The readable
HTML, CSS and JavaScript in `site/` are both the source and deployable application.
No build, backend, database or production Node dependency is required.

Bundled snapshot (2026-09-20): **22 Falkner clusters / 4,695 fights** and
**151 Whitney clusters / 96,779 fights**. All original JSON fields are retained;
only whitespace is removed. Data occupies about 420 MB uncompressed. The browser
loads catalogue metadata first and only one selected cluster's full data at a
time. Identification uses original visible observations; solution display uses
the saved route replay projected through its embedded parser.
Nonlethal enemy recoil is hidden unless recoil HP is enabled. Recoil deaths and
residual deaths remain explicit; old `burn dmg` / `poison dmg` labels mean
`fainted to burn/poison`. Random status infliction and own visible HP remain.
Existing bundled data is normalized at read time, without rewriting fights.

## Serve with Caddy

This repository is public. HTTPS cloning and pulling require no GitHub login
or deploy key. Clone as your deployment user into a directory that user owns:

```sh
git clone https://github.com/marchwashere/hg-identifiers.git /srv/hg-identifiers
```

Use `Caddyfile.example`, replacing the domain and path as appropriate. Caddy
serves this directly; no reverse-proxy process is needed. Serve **only `site/`**,
not the repository root (which contains `.git`). The Caddy service account needs
read access to files and traversal access to their parent directories.

```caddyfile
example.com {
    root * /srv/hg-identifiers/site
    encode zstd gzip
    header Cache-Control "no-cache"
    file_server
}
```

Replace `example.com` with your root domain. The app is served at
`https://example.com/`, not `/site/` or `/identifier/`: `site/` is only the
filesystem document root. No path prefix or reverse proxy is needed.

Merge the block into your existing configuration; do not replace unrelated sites.
Validate and reload with your usual service workflow, for example on the
packaged Linux service:

```sh
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

See Caddy's [static-file guide](https://caddyserver.com/docs/quick-starts/static-files)
and [compression reference](https://caddyserver.com/docs/caddyfile/directives/encode).
Configure DNS and network access for your existing Caddy installation.

**The source and bundled datasets are public on GitHub.** Anyone who can visit
the site can also download its bundled data.
The bundled catalogue loads automatically; there are no upload or database-reload controls.

## Update the server

```sh
git -C /srv/hg-identifiers pull --ff-only
```

No build or application restart is required for static-file changes. Git pull
is not an atomic deployment: use a quiet maintenance window, or separate release
directories and an atomic web-root switch when uninterrupted updates matter.
Keep old hashed assets while existing browser pages may reference them. Caddy
only needs reloading when its configuration changes.

## Development and data updates

Edit `site/*.js`, `site/*.css`, or `site/index.html` directly. Keep the typed
replay projector consistent with the engine export format. The battle engine
and brute-force search are intentionally not part of this repository.

Optional local preview, with Python installed:

```sh
python -m http.server 8080 --bind 127.0.0.1 --directory site
```

Visit `http://127.0.0.1:8080/`, not a `file://` URL. Root and trailing-slash
subdirectory hosting are supported. Missing assets must return 404, not an SPA
fallback page.

With Node installed on your development machine, validate the bundle:

```sh
node tools/verify.cjs
```

To package newer exports, provide a read-only source directory containing
`Falkner/` and `Whitney/` folders. Output must be a new directory outside the
source; the builder refuses to overwrite existing releases:

```sh
node tools/build-web.cjs --source /path/to/Identifier --out /path/to/new-release
node tools/verify.cjs /path/to/new-release
```

Review the release, copy its data assets into `site/data/`, then its catalogue
into `site/catalog.json`, commit and push. No battle search is rerun when
packaging data. Existing source data is never modified by the builder.
