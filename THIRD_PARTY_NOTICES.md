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

- `@open-spaced-repetition/binding-wasm32-wasip1@0.6.1` — MIT · pinned WASM SHA-256 `498d916b2d92180d8547f4d41ad204d63a488e6e0a1fe8c2ab330cf4ff5b8c05` · 1,396,770 bytes
- `@emnapi/core@2.0.0-beta.3` — MIT
- `@emnapi/runtime@2.0.0-beta.3` — MIT
- `@emnapi/wasi-threads@2.2.0` — MIT
- `@napi-rs/wasm-runtime@1.2.6` — MIT · npm package omits the repository-level licence file; verified upstream text retained at `licences/napi-rs-wasm-runtime-MIT.txt` · SHA-256 `3f1ce66533302df3a32edbfdfc0b78f0dd34659e4c1f5817162e5ea3c2297215`
- `@tybys/wasm-util@0.10.4` — MIT
- `tslib@2.9.1` — 0BSD

The optimizer-static build copies installed package licence texts into `licenses/optimizer/` beside the Worker/WASM distribution. For `@napi-rs/wasm-runtime@1.2.6`, whose npm `files` whitelist omits the repository-level licence, the build uses only the version- and checksum-pinned upstream fallback retained above.
