#!/usr/bin/env python3
"""Check the structural contract of a Research HTML report.

Usage:
    python3 check_report.py report.html [--note note.md]

Checks report structure and source references. With --note, each cited source
must exist in the evidence note and the report must link back to that note.
The report may select and reorganize content. This does not verify factual
support, retention of important caveats, or readability.
"""

from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mdnote import parse_note  # noqa: E402

REQUIRED_SECTIONS = {"conclusions", "sources", "impact", "unknowns"}
# Sections that are lists or references and do not need a plain-language lead.
PLAIN_EXEMPT_SECTIONS = {"sources", "glossary", "unknowns"}
# Elements whose nesting we track so we can tell what a data-plain or <h2> belongs to.
CONTAINER_TAGS = {"header", "section", "article", "li", "div", "figure"}
GITHUB_SOURCE_KINDS = {"github-issue", "github-pr"}
GITHUB_STATES = {"open", "closed", "merged"}
HEADING_TAGS = {"h2", "h3"}


class ReportParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.has_main = False
        self.has_title = False
        self.note_links: list[str] = []
        self.sections: set[str] = set()
        self.claims: list[tuple[str, list[str]]] = []
        self.source_ids: set[str] = set()
        self.source_links: dict[str, list[str]] = {}
        self.source_metadata: dict[str, dict[str, str]] = {}
        self.svg_stack: list[dict[str, bool]] = []
        self.svg_errors: list[str] = []
        self.hrefs: set[str] = set()
        self.plain_errors: list[str] = []
        self.dfn_terms: set[str] = set()
        self.glossary_terms: set[str] = set()
        self._current_source: str | None = None
        self._heading_buffer: list[str] | None = None
        self._frames: list[dict] = []
        self._dfn_buffer: list[str] | None = None
        self._dt_buffer: list[str] | None = None
        self._in_glossary = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if tag == "title":
            self.has_title = True
        elif tag == "main":
            self.has_main = True
        elif tag in HEADING_TAGS:
            self._heading_buffer = []
            if tag == "h2":
                for frame in reversed(self._frames):
                    if frame["tag"] == "section":
                        frame["has_h2"] = True
                        break
        elif tag == "dfn":
            self._dfn_buffer = []
        elif tag == "dt" and self._in_glossary:
            self._dt_buffer = []

        if tag == "a" and values.get("href"):
            self.hrefs.add(values["href"])
            if "data-note-link" in values:
                self.note_links.append(values["href"])

        section = values.get("data-report-section")
        if section:
            self.sections.add(section)
            if section == "glossary":
                self._in_glossary = True

        claim_id = values.get("data-claim-id")
        if claim_id:
            source_ids = values.get("data-source-ids", "").split()
            self.claims.append((claim_id, source_ids))

        if "data-plain" in values:
            for frame in self._frames:
                frame["has_plain"] = True

        if tag in CONTAINER_TAGS:
            self._frames.append(
                {
                    "tag": tag,
                    "kind": section or "",
                    "claim": claim_id or "",
                    "has_plain": False,
                    "has_h2": False,
                    "heading": "",
                }
            )

        element_id = values.get("id", "")
        if element_id.startswith("source-"):
            source_id = element_id.removeprefix("source-")
            self.source_ids.add(source_id)
            self.source_metadata[source_id] = values
            self._current_source = source_id

        if tag == "a" and self._current_source and values.get("href"):
            self.source_links.setdefault(self._current_source, []).append(values["href"])

        if tag == "svg":
            self.svg_stack.append(
                {
                    "role": values.get("role") == "img",
                    "labelled": bool(values.get("aria-labelledby")),
                    "title": False,
                    "desc": False,
                }
            )
        elif self.svg_stack and tag == "title":
            self.svg_stack[-1]["title"] = True
        elif self.svg_stack and tag == "desc":
            self.svg_stack[-1]["desc"] = True

    def handle_data(self, data: str) -> None:
        if self._heading_buffer is not None:
            self._heading_buffer.append(data)
        if self._dfn_buffer is not None:
            self._dfn_buffer.append(data)
        if self._dt_buffer is not None:
            self._dt_buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in HEADING_TAGS and self._heading_buffer is not None:
            heading = normalize("".join(self._heading_buffer))
            self._heading_buffer = None
            if tag == "h2":
                for frame in reversed(self._frames):
                    if frame["tag"] == "section" and not frame["heading"]:
                        frame["heading"] = heading
                        break
        if tag == "dfn" and self._dfn_buffer is not None:
            self.dfn_terms.add(normalize("".join(self._dfn_buffer)))
            self._dfn_buffer = None
        if tag == "dt" and self._dt_buffer is not None:
            self.glossary_terms.add(normalize("".join(self._dt_buffer)))
            self._dt_buffer = None
        if tag in CONTAINER_TAGS:
            self._close_frame(tag)
        if tag == "svg" and self.svg_stack:
            svg = self.svg_stack.pop()
            if not all(svg.values()):
                self.svg_errors.append("each SVG needs role=img, aria-labelledby, title, and desc")
        if tag == "li" and self._current_source:
            self._current_source = None

    def _close_frame(self, tag: str) -> None:
        for index in range(len(self._frames) - 1, -1, -1):
            if self._frames[index]["tag"] != tag:
                continue
            frame = self._frames.pop(index)
            del self._frames[index:]
            if frame["claim"] and not frame["has_plain"]:
                self.plain_errors.append(f"claim {frame['claim']!r} has no data-plain sentence")
            if frame["tag"] == "header" and not frame["has_plain"]:
                self.plain_errors.append("<header> needs a data-plain one-sentence answer")
            if (
                frame["tag"] == "section"
                and frame["has_h2"]
                and frame["kind"] not in PLAIN_EXEMPT_SECTIONS
                and not frame["has_plain"]
            ):
                self.plain_errors.append(f"section '{frame['heading']}' has no data-plain sentence")
            if frame["kind"] == "glossary":
                self._in_glossary = False
            return


def normalize(text: str) -> str:
    return re.sub(r"\s+", "", text)


def validate_structure(parser: ReportParser) -> list[str]:
    errors: list[str] = []

    if not parser.has_title:
        errors.append("missing <title>")
    if not parser.has_main:
        errors.append("missing <main>")
    if not parser.note_links:
        errors.append("missing complete evidence note link (data-note-link)")

    missing_sections = REQUIRED_SECTIONS - parser.sections
    if missing_sections:
        errors.append("missing report sections: " + ", ".join(sorted(missing_sections)))

    if not parser.claims:
        errors.append("the report needs at least one data-claim-id")
    for claim_id, source_ids in parser.claims:
        if not source_ids:
            errors.append(f"claim {claim_id!r} has no data-source-ids")
            continue
        for source_id in source_ids:
            if source_id not in parser.source_ids:
                errors.append(f"claim {claim_id!r} refers to missing source {source_id!r}")

    for source_id in parser.source_ids:
        links = parser.source_links.get(source_id, [])
        if not links:
            errors.append(f"source {source_id!r} has no link")

        metadata = parser.source_metadata[source_id]
        kind = metadata.get("data-source-kind", "")
        if kind in GITHUB_SOURCE_KINDS:
            repository = metadata.get("data-github-repo", "")
            number = metadata.get("data-github-number", "")
            state = metadata.get("data-github-state", "")
            if not re.fullmatch(r"[^/\s]+/[^/\s]+", repository):
                errors.append(f"GitHub source {source_id!r} needs data-github-repo=owner/repo")
            if not number.isdecimal():
                errors.append(f"GitHub source {source_id!r} needs a numeric data-github-number")
            if state not in GITHUB_STATES:
                errors.append(
                    f"GitHub source {source_id!r} needs data-github-state="
                    "open, closed, or merged"
                )
            if repository and number:
                source_path = "issues" if kind == "github-issue" else "pull"
                expected_url = f"github.com/{repository}/{source_path}/{number}"
                if not any(expected_url in link for link in links):
                    errors.append(
                        f"GitHub source {source_id!r} needs a link to {expected_url}"
                    )

    errors.extend(parser.svg_errors)
    errors.extend(parser.plain_errors)
    for term in sorted(parser.dfn_terms - parser.glossary_terms):
        errors.append(f"<dfn> term '{term}' is not defined in the glossary")
    return errors


def validate_sources(parser: ReportParser, note_path: Path, report_path: Path) -> list[str]:
    note_links = set(parse_note(note_path).links())
    errors: list[str] = []
    if not any(
        not urlsplit(link).scheme and not urlsplit(link).netloc
        and (report_path.parent / unquote(urlsplit(link).path)).resolve() == note_path.resolve()
        for link in parser.note_links
    ):
        errors.append("data-note-link must point to the supplied Markdown note")
    for source_id, links in parser.source_links.items():
        for link in links:
            if link not in note_links:
                errors.append(f"source {source_id!r} link is not in the evidence note: {link}")
    return errors


def validate(path: Path, note_path: Path | None) -> list[str]:
    parser = ReportParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    errors = validate_structure(parser)
    if note_path is not None:
        errors.extend(validate_sources(parser, note_path, path))
    return errors


def main() -> int:
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("report", type=Path)
    arguments.add_argument("--note", type=Path, help="the evidence note supporting the selected report content")
    args = arguments.parse_args()
    try:
        errors = validate(args.report, args.note)
    except (OSError, UnicodeError) as exc:
        errors = [str(exc)]
    if errors:
        print(f"FAIL {args.report}")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"OK {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
