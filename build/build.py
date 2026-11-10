from __future__ import annotations
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "source"
SOURCE_MANIFEST = SOURCE_DIR / "app/source-manifest.json"
GENERATED_DIR = ROOT / "build/generated"
GENERATED_TS = GENERATED_DIR / "revision-director.combined.ts"
TSCONFIG = SOURCE_DIR / "tsconfig.json"
SHELL = SOURCE_DIR / "revision-director.shell.html"
CSS = SOURCE_DIR / "revision-director.va7.css"
PRESENTATION_MANIFEST = SOURCE_DIR / "presentation/revision-director.presentation.json"
PRESENTATION_PREPAINT = SOURCE_DIR / "presentation/prepaint.js"
APP_JS = ROOT / "dist/app.js"
VENDOR_DIR = ROOT / "vendor/ts-fsrs-6.0.0"
VENDOR_JS = VENDOR_DIR / "index.umd.js"
VENDOR_PACKAGE = VENDOR_DIR / "package.json"
EXPECTED_VENDOR_SHA256 = "6ef23308221a59a524c18153e665480159bc4e26e9d437a70d9e1e912cc54554"


def assemble_typescript() -> str:
    manifest = json.loads(SOURCE_MANIFEST.read_text())
    if manifest.get("schemaVersion") != 1:
        raise SystemExit("Unsupported source-manifest schema.")
    parts = manifest.get("parts")
    if not isinstance(parts, list) or not parts:
        raise SystemExit("Source manifest has no parts.")
    ordered = sorted(parts, key=lambda item: item.get("order", -1))
    if [item.get("order") for item in ordered] != list(range(len(ordered))):
        raise SystemExit("Source manifest order must be contiguous and unique.")

    chunks: list[str] = []
    seen: set[Path] = set()
    for item in ordered:
        relative = item.get("path")
        if not isinstance(relative, str) or not relative.endswith(".ts"):
            raise SystemExit("Source manifest contains an invalid TypeScript path.")
        path = (SOURCE_DIR / relative).resolve()
        if SOURCE_DIR.resolve() not in path.parents or path in seen or not path.is_file():
            raise SystemExit(f"Invalid or duplicate source part: {relative}")
        seen.add(path)
        chunks.append(path.read_text())

    source = "".join(chunks)
    presentation_manifest = json.loads(PRESENTATION_MANIFEST.read_text())
    marker = "/*__RD_PRESENTATION_MANIFEST__*/"
    if source.count(marker) != 1:
        raise SystemExit("Presentation manifest source marker must occur exactly once.")
    source = source.replace(marker, json.dumps(presentation_manifest, separators=(",", ":"), ensure_ascii=True))
    if not source.lstrip().startswith("(() => {") or not source.rstrip().endswith("})();"):
        raise SystemExit("Assembled source does not preserve the sealed IIFE boundary.")
    return source


def compile_typescript(source: str) -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    GENERATED_TS.write_text(source)
    try:
        subprocess.run(["tsc", "-p", str(TSCONFIG)], cwd=ROOT, check=True)
    finally:
        GENERATED_TS.unlink(missing_ok=True)
        try:
            GENERATED_DIR.rmdir()
        except OSError:
            pass


def build_html() -> None:
    source = assemble_typescript()
    compile_typescript(source)

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
    print(f"Assembled {len(source):,} TypeScript characters from the ownership manifest")
    print(f"Built {ROOT / 'index.html'} ({len(html):,} bytes)")


if __name__ == "__main__":
    build_html()
