from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text()


class Inspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.external: list[tuple[str, str]] = []
        self.elements: list[tuple[str, dict[str, str]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key: value or "" for key, value in attrs}
        self.elements.append((tag, data))
        if "id" in data:
            self.ids.append(data["id"])
        if tag == "script" and data.get("src"):
            self.external.append((tag, data["src"]))
        if tag == "link" and data.get("href"):
            self.external.append((tag, data["href"]))
        if tag in {"img", "audio", "video", "source", "iframe"} and data.get("src"):
            self.external.append((tag, data["src"]))


parser = Inspector()
parser.feed(HTML)
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def matching(tag: str | None = None, **attrs: str) -> list[dict[str, str]]:
    return [
        data
        for element_tag, data in parser.elements
        if (tag is None or element_tag == tag)
        and all(data.get(key) == value for key, value in attrs.items())
    ]


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

check("<!-- INLINE_" not in HTML, "Build placeholder survived")

csp = next(
    (
        data.get("content", "")
        for tag, data in parser.elements
        if tag == "meta" and data.get("http-equiv", "").lower() == "content-security-policy"
    ),
    "",
)
check("connect-src 'none'" in csp, "Offline network policy missing from Content-Security-Policy")

check(bool(matching(id="revision-director-presentation-manifest")), "Presentation manifest missing")
check(bool(matching("script", **{"data-rd-presentation-prepaint": "1"})), "Presentation prepaint missing")
check(
    HTML.index('data-rd-presentation-prepaint="1"') < HTML.index("<style>"),
    "Presentation prepaint does not precede CSS",
)

tablists = matching(role="tablist")
tabs = matching(role="tab")
panels = matching(role="tabpanel")
check(len(tablists) == 1, "Primary navigation must expose one ARIA tablist")
check(bool(tabs) and len(tabs) == len(panels), "ARIA tabs and tabpanels must form a non-empty one-to-one set")
pane_keys = [tab.get("data-pane", "") for tab in tabs]
check(all(pane_keys) and len(pane_keys) == len(set(pane_keys)), "ARIA tabs must have unique semantic pane keys")
panel_ids = {panel.get("id", "") for panel in panels}
check(panel_ids == {f"pane-{pane}" for pane in pane_keys}, "ARIA tabpanels do not match the semantic pane registry")

dialogs = matching("dialog")
check(bool(dialogs), "No dialogs found")
for dialog in dialogs:
    labelled_by = dialog.get("aria-labelledby", "")
    check(bool(labelled_by) and labelled_by in parser.ids, f"Dialog lacks a valid accessible name: {dialog.get('id', '<unknown>')}")

print(f"PASS {checks} static HTML semantic/accessibility checks")
