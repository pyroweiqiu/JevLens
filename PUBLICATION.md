# Public repository contents

The public project lives at `https://github.com/pyroweiqiu/JevLens`. Its one-screen showcase is in `docs/`, intended for `https://pyroweiqiu.github.io/JevLens/`.

## Included

- `src/`, `entrypoints/`, `server/`: extension and optional proxy source.
- `tests/`, `scripts/`: synthetic fixtures, regression tooling, local preview and verification scripts. Live API checks read a local file; no key is bundled.
- `docs/`: standalone HTML/CSS/JavaScript showcase and original SVG icon. It makes no AI requests, has no analytics and uses no external fonts or CDN scripts.
- Dependency manifests/lockfile, build/test configuration, `.env.example` with empty credentials, README, implementation plan and status.

## Excluded

- **All of `conf/`**, including every spelling of the API-key filenames.
- `.env` and local environment files, private-key/certificate files.
- `node_modules/`, `output/`, `.wxt/`, local editor settings and logs.
- `qa-results/`, `test-results/`, `playwright-report/`: screenshots, downloaded PDFs, account diagnostics and generated test output.
- `third_party/`: separate checkouts such as the personal profile repository. They are not dependencies or submodules of JevLens.

Before committing, run `npm run audit:public`. It examines the exact Git index, rejects known private/generated paths and checks common credential patterns plus locally supplied OpenRouter keys. It reports filenames only, never secret values. This check is a supplement to reviewing the staged diff, not a guarantee against every possible secret format.

## GitHub Pages

The project does **not** require a `pyroweiqiu.github.io` user-site repository or changes to the `pyroweiqiu/pyroweiqiu` profile repository.

In `JevLens → Settings → Pages`, select **Deploy from a branch → main → /docs → Save**. GitHub then publishes the showcase whenever `docs/` changes on `main`. The `docs/.nojekyll` file keeps it a plain static site. There is no build-time secret or API key to configure.

Local preview: `npm run site:preview`. With that server running, `npm run site:check` verifies six desktop/mobile viewports, no page overflow, demo interactions, keyboard navigation and the installation dialog.
