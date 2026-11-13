from __future__ import annotations

from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
MANIFEST = SOURCE / "app/source-manifest.json"

manifest = json.loads(MANIFEST.read_text())
parts = sorted(manifest.get("parts", []), key=lambda item: item.get("order", -1))
declared_paths = [item.get("path", "") for item in parts]
source_paths = [SOURCE / path for path in declared_paths]
actual_typescript = {
    path.relative_to(SOURCE).as_posix()
    for path in (SOURCE / "app").glob("*.ts")
    if path.is_file()
}

checks: list[tuple[str, bool]] = []
def check(name: str, condition: bool) -> None:
    checks.append((name, condition))
    if not condition:
        raise AssertionError(name)

check("manifest schema", manifest.get("schemaVersion") == 1)
check("manifest runtime contract", manifest.get("runtime") == {
    "assembly": "manifest-ordered-emitted-js",
    "boundary": "build-owned-iife",
    "output": "../dist/app.js",
})
check("manifest order contiguous", [item.get("order") for item in parts] == list(range(len(parts))))
check("manifest paths unique", len(declared_paths) == len(set(declared_paths)))
check("manifest owns exact TypeScript source set", set(declared_paths) == actual_typescript)
check("manifest entries valid", all(
    path.startswith("app/")
    and path.endswith(".ts")
    and source_path.is_file()
    and source_path.stat().st_size > 0
    and isinstance(item.get("layer"), str)
    and item["layer"].strip()
    for path, source_path, item in zip(declared_paths, source_paths, parts)
))

tsconfig = json.loads((SOURCE / "tsconfig.json").read_text())
compiler = tsconfig.get("compilerOptions", {})
check("TypeScript source graph", tsconfig.get("include") == ["app/*.ts"] and compiler.get("rootDir") == "." and compiler.get("outDir") == "../build/generated-js")
check("TypeScript strict contract", all(compiler.get(name) is expected for name, expected in {
    "strict": True,
    "noEmitOnError": True,
    "noImplicitReturns": True,
    "noFallthroughCasesInSwitch": True,
    "noPropertyAccessFromIndexSignature": True,
    "allowUnreachableCode": False,
    "allowUnusedLabels": False,
    "noUnusedLocals": True,
    "noUnusedParameters": True,
    "forceConsistentCasingInFileNames": True,
}.items()))
check("clean source topology", not (SOURCE / "revision-director.va7.ts").exists() and not (ROOT / "build/generated/revision-director.combined.ts").exists())
check("compiler output cleaned after build", not (ROOT / "build/generated-js").exists())

js_path = ROOT / "dist/app.js"
html_path = ROOT / "index.html"
check("generated artifacts present", js_path.is_file() and js_path.stat().st_size > 0 and html_path.is_file() and html_path.stat().st_size > 0)
js = js_path.read_text()
html = html_path.read_text()
css = (SOURCE / "revision-director.va7.css").read_text()
check("sealed runtime boundary", js.startswith('(() => {\n  "use strict";') and js.rstrip().endswith("})();"))
check("build placeholders resolved", "<!-- INLINE_" not in html)
check("inline application parity", f"<script>\n{js}\n</script>" in html)
check("inline stylesheet parity", f"<style>\n{css}\n</style>" in html)

vendor_dir = ROOT / "vendor/ts-fsrs-6.0.0"
vendor_package = json.loads((vendor_dir / "package.json").read_text())
vendor_sums = {}
for line in (vendor_dir / "SHA256SUMS.txt").read_text().splitlines():
    digest, name = line.split("  ", 1)
    vendor_sums[name] = digest
vendor_path = vendor_dir / "index.umd.js"
vendor = vendor_path.read_text()
vendor_hash = hashlib.sha256(vendor_path.read_bytes()).hexdigest()
check("vendored scheduler identity", vendor_package.get("name") == "ts-fsrs" and vendor_package.get("version") == "6.0.0" and vendor_package.get("license") == "MIT")
check("vendored scheduler checksum", vendor_sums.get("index.umd.js") == vendor_hash)
vendor_marker = f'data-vendor="ts-fsrs@6.0.0" data-sha256="{vendor_hash}"'
check("embedded scheduler parity", vendor_marker in html and f'<script {vendor_marker}>\n{vendor}\n</script>' in html)
check("scheduler loads before application", html.index(vendor_marker) < html.rindex(f"<script>\n{js}\n</script>"))

optimizer_package = json.loads((ROOT / "tools/fsrs-optimizer/package.json").read_text())
optimizer_lock = json.loads((ROOT / "tools/fsrs-optimizer/package-lock.json").read_text())
optimizer_dependencies = optimizer_package.get("dependencies", {})
expected_optimizer_dependencies = {
    "@emnapi/core": "2.0.0-beta.3",
    "@emnapi/runtime": "2.0.0-beta.3",
    "@napi-rs/wasm-runtime": "1.2.6",
    "@open-spaced-repetition/binding": "0.6.1",
    "@open-spaced-repetition/binding-wasm32-wasip1": "0.6.1",
}
check("optimizer dependencies pinned", optimizer_dependencies == expected_optimizer_dependencies)
check("optimizer lock root matches package", optimizer_lock.get("packages", {}).get("", {}).get("dependencies") == optimizer_dependencies)
check("portable build excludes optimizer assets", "revision-director-browser-optimizer" not in html and "fsrs-binding.wasm32-wasip1.wasm" not in html)

checksum_targets = {
    line.split("  ./", 1)[1]
    for line in (ROOT / "CHECKSUMS.sha256").read_text().splitlines()
    if line
}
required_checksum_targets = {
    *(f"source/{path}" for path in declared_paths),
    "source/app/source-manifest.json",
    "source/tsconfig.json",
    "source/revision-director.shell.html",
    "source/revision-director.va7.css",
    "source/presentation/prepaint.js",
    "source/presentation/revision-director.presentation.json",
    "build/build.py",
    "build/build-hosted.mjs",
    "build/checksums.py",
    "dist/app.js",
    "index.html",
    "package.json",
    "package-lock.json",
    "vendor/ts-fsrs-6.0.0/index.umd.js",
    "vendor/ts-fsrs-6.0.0/package.json",
    "vendor/ts-fsrs-6.0.0/SHA256SUMS.txt",
}
check("checksum coverage for release-critical graph", required_checksum_targets <= checksum_targets)
check("checksum scope excludes QA and prose", not any(path.startswith(("tests/", "docs/", ".github/")) for path in checksum_targets))

print(f"PASS {len(checks)} authoritative build/architecture checks")
