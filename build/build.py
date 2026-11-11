from __future__ import annotations
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import textwrap

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "source"
SOURCE_APP_DIR = SOURCE_DIR / "app"
SOURCE_MANIFEST = SOURCE_APP_DIR / "source-manifest.json"
GENERATED_JS_DIR = ROOT / "build/generated-js"
TSCONFIG = SOURCE_DIR / "tsconfig.json"
TSC = ROOT / "node_modules/.bin" / ("tsc.cmd" if os.name == "nt" else "tsc")
EXPECTED_TYPESCRIPT_VERSION = "7.0.2"
PRESENTATION_SENTINEL = "__RD_PRESENTATION_MANIFEST__"
SHELL = SOURCE_DIR / "revision-director.shell.html"
CSS = SOURCE_DIR / "revision-director.va7.css"
PRESENTATION_MANIFEST = SOURCE_DIR / "presentation/revision-director.presentation.json"
PRESENTATION_PREPAINT = SOURCE_DIR / "presentation/prepaint.js"
APP_JS = ROOT / "dist/app.js"
VENDOR_DIR = ROOT / "vendor/ts-fsrs-6.0.0"
VENDOR_JS = VENDOR_DIR / "index.umd.js"
VENDOR_PACKAGE = VENDOR_DIR / "package.json"
EXPECTED_VENDOR_SHA256 = "6ef23308221a59a524c18153e665480159bc4e26e9d437a70d9e1e912cc54554"


def source_parts() -> list[Path]:
    manifest = json.loads(SOURCE_MANIFEST.read_text())
    if manifest.get("schemaVersion") != 1:
        raise SystemExit("Unsupported source-manifest schema.")
    parts = manifest.get("parts")
    if not isinstance(parts, list) or not parts:
        raise SystemExit("Source manifest has no parts.")
    ordered = sorted(parts, key=lambda item: item.get("order", -1))
    if [item.get("order") for item in ordered] != list(range(len(ordered))):
        raise SystemExit("Source manifest order must be contiguous and unique.")

    paths: list[Path] = []
    seen: set[Path] = set()
    for item in ordered:
        relative = item.get("path")
        if not isinstance(relative, str) or not relative.startswith("app/") or not relative.endswith(".ts"):
            raise SystemExit("Source manifest contains an invalid TypeScript path.")
        path = (SOURCE_DIR / relative).resolve()
        if SOURCE_DIR.resolve() not in path.parents or path in seen or not path.is_file():
            raise SystemExit(f"Invalid or duplicate source part: {relative}")
        seen.add(path)
        paths.append(path)

    discovered = {path.resolve() for path in SOURCE_APP_DIR.glob("*.ts")}
    declared = set(paths)
    if discovered != declared:
        extras = sorted(str(path.relative_to(SOURCE_DIR)) for path in discovered - declared)
        missing = sorted(str(path.relative_to(SOURCE_DIR)) for path in declared - discovered)
        raise SystemExit(f"Source manifest mismatch. Unowned={extras}; missing={missing}.")
    return paths


def strip_emitted_use_strict(source: str) -> str:
    marker = '"use strict";'
    stripped = source.lstrip("﻿")
    if stripped.startswith(marker):
        stripped = stripped[len(marker):]
        if stripped.startswith("\r\n"):
            stripped = stripped[2:]
        elif stripped.startswith("\n"):
            stripped = stripped[1:]
    return stripped.rstrip()


def compile_typescript(parts: list[Path]) -> None:
    shutil.rmtree(GENERATED_JS_DIR, ignore_errors=True)
    GENERATED_JS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        if not TSC.is_file():
            raise SystemExit("Local TypeScript compiler is missing. Run `npm ci` first.")
        version = subprocess.run(
            [str(TSC), "--version"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if version != f"Version {EXPECTED_TYPESCRIPT_VERSION}":
            raise SystemExit(
                f"Expected TypeScript {EXPECTED_TYPESCRIPT_VERSION}, got {version or 'unknown'}."
            )

        subprocess.run([str(TSC), "-p", str(TSCONFIG)], cwd=ROOT, check=True)

        expected_outputs = [
            GENERATED_JS_DIR / path.relative_to(SOURCE_DIR).with_suffix(".js")
            for path in parts
        ]
        emitted = {path.resolve() for path in GENERATED_JS_DIR.rglob("*.js")}
        expected = {path.resolve() for path in expected_outputs}
        if emitted != expected:
            extras = sorted(str(path.relative_to(GENERATED_JS_DIR.resolve())) for path in emitted - expected)
            missing = sorted(str(path.relative_to(GENERATED_JS_DIR.resolve())) for path in expected - emitted)
            raise SystemExit(f"TypeScript emitted an unexpected file set. Extra={extras}; missing={missing}.")

        fragments = [strip_emitted_use_strict(path.read_text()) for path in expected_outputs]
        body = "\n\n".join(fragment for fragment in fragments if fragment)
        sentinel = json.dumps(PRESENTATION_SENTINEL)
        if body.count(sentinel) != 1:
            raise SystemExit("Presentation manifest sentinel must occur exactly once in emitted JavaScript.")
        presentation_manifest = json.loads(PRESENTATION_MANIFEST.read_text())
        body = body.replace(
            sentinel,
            json.dumps(presentation_manifest, separators=(",", ":"), ensure_ascii=True),
        )

        runtime = '(() => {\n  "use strict";\n' + textwrap.indent(body, "  ") + "\n})();\n"
        APP_JS.parent.mkdir(parents=True, exist_ok=True)
        APP_JS.write_text(runtime)
    finally:
        shutil.rmtree(GENERATED_JS_DIR, ignore_errors=True)


def build_html() -> None:
    parts = source_parts()
    compile_typescript(parts)

    shell = SHELL.read_text()
    css = CSS.read_text()
    presentation_manifest = json.loads(PRESENTATION_MANIFEST.read_text())
    presentation_prepaint = PRESENTATION_PREPAINT.read_text().strip()
    js = APP_JS.read_text()
    vendor = VENDOR_JS.read_text()
    metadata = json.loads(VENDOR_PACKAGE.read_text())

    for placeholder in ("<!-- INLINE_PRESENTATION_MANIFEST -->", "<!-- INLINE_PRESENTATION_PREPAINT -->", "<!-- INLINE_CSS -->", "<!-- INLINE_VENDOR_JS -->", "<!-- INLINE_JS -->"):
        if placeholder not in shell:
            raise SystemExit(f"Build placeholder is missing: {placeholder}")
    if "</script" in js.lower() or "</script" in vendor.lower() or "</script" in presentation_prepaint.lower():
        raise SystemExit("JavaScript contains a closing script sequence.")
    if presentation_manifest.get("format") != "revision-director.presentation-manifest" or presentation_manifest.get("version") != 1:
        raise SystemExit("Unexpected presentation manifest identity.")
    default_id = presentation_manifest.get("defaults", {}).get("presentation")
    profiles = presentation_manifest.get("profiles", {})
    if not isinstance(default_id, str) or default_id not in profiles or profiles[default_id].get("immutable") is not True:
        raise SystemExit("Presentation manifest default must exist and be immutable.")
    if metadata.get("name") != "ts-fsrs" or metadata.get("version") != "6.0.0" or metadata.get("license") != "MIT":
        raise SystemExit("Unexpected ts-fsrs package metadata.")
    actual_hash = hashlib.sha256(VENDOR_JS.read_bytes()).hexdigest()
    if actual_hash != EXPECTED_VENDOR_SHA256:
        raise SystemExit(f"ts-fsrs vendor checksum mismatch: {actual_hash}")

    manifest_json = json.dumps(presentation_manifest, separators=(",", ":"), ensure_ascii=True).replace("<", "\\u003c")
    html = shell.replace(
        "<!-- INLINE_PRESENTATION_MANIFEST -->",
        f'<script type="application/json" id="revision-director-presentation-manifest">{manifest_json}</script>',
    )
    html = html.replace(
        "<!-- INLINE_PRESENTATION_PREPAINT -->",
        f'<script data-rd-presentation-prepaint="1">\n{presentation_prepaint}\n</script>',
    )
    html = html.replace("<!-- INLINE_CSS -->", f"<style>\n{css}\n</style>")
    html = html.replace(
        "<!-- INLINE_VENDOR_JS -->",
        f'<script data-vendor="ts-fsrs@6.0.0" data-sha256="{actual_hash}">\n{vendor}\n</script>',
    )
    html = html.replace("<!-- INLINE_JS -->", f"<script>\n{js}\n</script>")
    (ROOT / "index.html").write_text(html)
    print(f"Compiled {len(parts)} maintained TypeScript files with TypeScript {EXPECTED_TYPESCRIPT_VERSION}")
    print(f"Built {ROOT / 'index.html'} ({len(html):,} bytes)")


if __name__ == "__main__":
    build_html()
