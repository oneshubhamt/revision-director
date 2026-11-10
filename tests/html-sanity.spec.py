from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text()

class Inspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.external: list[tuple[str, str]] = []
        self.scripts = 0
        self.styles = 0
        self.dialogs = 0
        self.canvases = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key: value or "" for key, value in attrs}
        if "id" in data:
            self.ids.append(data["id"])
        if tag == "script":
            self.scripts += 1
            if data.get("src"):
                self.external.append((tag, data["src"]))
        if tag == "link" and data.get("href"):
            self.external.append((tag, data["href"]))
        if tag in {"img", "audio", "video", "source", "iframe"} and data.get("src"):
            self.external.append((tag, data["src"]))
        if tag == "style": self.styles += 1
        if tag == "dialog": self.dialogs += 1
        if tag == "canvas": self.canvases += 1

parser = Inspector()
parser.feed(HTML)
checks = 0

def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)

check(not parser.external, f"External resources found: {parser.external}")
check(len(parser.ids) == len(set(parser.ids)), "Duplicate static HTML ids found")
for required in [
    "pane-today", "today-content", "pane-review", "review-content",
    "pane-library", "library-content", "pane-study", "study-content",
    "pane-history", "history-content", "pane-settings", "settings-content",
    "unit-dialog", "unit-form", "study-dialog", "study-form",
    "obligation-dialog", "obligation-form", "restore-dialog", "restore-preview", "toast", "fatal-error",
]:
    check(required in parser.ids, f"Missing required id: {required}")
check(parser.scripts == 4, f"Expected manifest, prepaint, vendor and app scripts, found {parser.scripts}")
check(parser.styles == 1, f"Expected one embedded stylesheet, found {parser.styles}")
check(parser.dialogs == 4, f"Expected four dialogs, found {parser.dialogs}")
check("<!-- INLINE_" not in HTML, "Build placeholder survived")
check("Revision Director · VA7.1 Pass E1" in HTML, "Pass E1 product label missing")
check('connect-src \'none\'' in HTML, "Offline network policy missing")
check('id="revision-director-presentation-manifest"' in HTML, "Presentation manifest missing")
check('data-rd-presentation-prepaint="1"' in HTML, "Presentation prepaint missing")
check(HTML.index('data-rd-presentation-prepaint="1"') < HTML.index("<style>"), "Presentation prepaint does not precede CSS")
check('data-vendor="ts-fsrs@6.0.0"' in HTML, "Pinned FSRS marker missing")
check('role="tablist"' in HTML, "Primary ARIA tablist missing")
check(HTML.count('role="tab"') == 6, "Expected six ARIA tabs")
check(HTML.count('role="tabpanel"') == 6, "Expected six ARIA tabpanels")
check('aria-labelledby="unit-dialog-title"' in HTML and 'aria-labelledby="study-dialog-title"' in HTML and 'aria-labelledby="obligation-dialog-title"' in HTML and 'aria-labelledby="restore-dialog-title"' in HTML, "Dialog accessible names missing")
print(f"PASS {checks} static HTML sanity checks")
