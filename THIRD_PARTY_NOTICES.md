# Third-party notices

## ts-fsrs 6.0.0

- Project: `open-spaced-repetition/ts-fsrs`
- Package: `ts-fsrs@6.0.0`
- Licence: MIT
- Vendored artifact: `vendor/ts-fsrs-6.0.0/index.umd.js`
- SHA-256: `6ef23308221a59a524c18153e665480159bc4e26e9d437a70d9e1e912cc54554`

The official UMD artifact is embedded into the production HTML at build time.
The package metadata, checksum manifest and full MIT licence text are retained in
`vendor/ts-fsrs-6.0.0/`.

## @open-spaced-repetition/srs-kit 1.0.0

`ts-fsrs@6.0.0` bundles `@open-spaced-repetition/srs-kit@1.0.0` into its
browser UMD artifact.

- Project: `open-spaced-repetition/ts-fsrs`
- Package: `@open-spaced-repetition/srs-kit@1.0.0`
- Licence: BSD-3-Clause
- Licence text: `licences/srs-kit-BSD-3-Clause.txt`


## Optional local FSRS optimizer runtime

The optional `Revision_Director_Optimizer_Static/` distribution additionally contains the browser-targeted optimizer runtime. These packages are not embedded in the normal root `index.html`.

- `@open-spaced-repetition/binding-wasm32-wasip1@0.6.1` — MIT
- `@emnapi/core@2.0.0-beta.3` — MIT
- `@emnapi/runtime@2.0.0-beta.3` — MIT
- `@emnapi/wasi-threads@2.2.0` — MIT
- `@napi-rs/wasm-runtime@1.2.6` — MIT
- `@tybys/wasm-util` — MIT
- `tslib` — 0BSD

The optimizer-static build copies the installed packages' licence texts into `licenses/optimizer/` beside the Worker/WASM distribution.
