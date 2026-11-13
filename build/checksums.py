from __future__ import annotations

from pathlib import Path
import argparse
import hashlib

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "CHECKSUMS.sha256"


def checksum_targets() -> list[tuple[str, Path]]:
    targets: list[tuple[str, Path]] = []
    for line in MANIFEST.read_text().splitlines():
        if not line:
            continue
        _, relative = line.split("  ./", 1)
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit(f"Missing checksum target: {relative}")
        targets.append((relative, path))
    return targets


def rendered_manifest() -> str:
    return "\n".join(
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  ./{relative}"
        for relative, path in checksum_targets()
    ) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh or verify Revision Director tracked checksums.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="Rewrite CHECKSUMS.sha256 from current tracked targets.")
    mode.add_argument("--check", action="store_true", help="Verify CHECKSUMS.sha256 without modifying it.")
    args = parser.parse_args()

    rendered = rendered_manifest()
    if args.write:
        MANIFEST.write_text(rendered)
        return
    if MANIFEST.read_text() != rendered:
        raise SystemExit("Tracked checksums are stale.")


if __name__ == "__main__":
    main()
