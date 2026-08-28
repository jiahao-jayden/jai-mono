#!/usr/bin/env python3
"""Check the structural contract of a Research HTML report.

Usage:
    python3 check_report.py report.html

This checks that the report keeps its claims connected to sources. It does not
verify that a source actually proves a claim; that remains the researcher's job.
"""

from __future__ import annotations

import argparse
import sys
from html.parser import HTMLParser
from pathlib import Path


TAILWIND_CDN = "https://cdn.tailwindcss.com"
REQUIRED_SECTIONS = {"conclusions", "sources", "impact", "unknowns"}


class ReportParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.has_main = False
        self.has_title = False
        self.tailwind_scripts: list[str] = []
        self.sections: set[str] = set()
        self.claims: list[tuple[str, list[str]]] = []
        self.source_ids: set[str] = set()
        self.source_links: dict[str, list[str]] = {}
        self.svg_stack: list[dict[str, bool]] = []
        self.svg_errors: list[str] = []
        self._current_source: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if tag == "title":
            self.has_title = True
        elif tag == "main":
            self.has_main = True
        elif tag == "script" and values.get("src"):
            self.tailwind_scripts.append(values["src"])

        section = values.get("data-report-section")
        if section:
            self.sections.add(section)

        claim_id = values.get("data-claim-id")
        if claim_id:
            source_ids = values.get("data-source-ids", "").split()
            self.claims.append((claim_id, source_ids))

        element_id = values.get("id", "")
        if element_id.startswith("source-"):
            self.source_ids.add(element_id.removeprefix("source-"))
            self._current_source = element_id.removeprefix("source-")

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

    def handle_endtag(self, tag: str) -> None:
        if tag == "svg" and self.svg_stack:
            svg = self.svg_stack.pop()
            if not all(svg.values()):
                self.svg_errors.append("each SVG needs role=img, aria-labelledby, title, and desc")
        if tag == "li" and self._current_source:
            self._current_source = None


def validate(path: Path) -> list[str]:
    parser = ReportParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    errors: list[str] = []

    if not parser.has_title:
        errors.append("missing <title>")
    if not parser.has_main:
        errors.append("missing <main>")
    if parser.tailwind_scripts.count(TAILWIND_CDN) != 1:
        errors.append(f"expected exactly one Tailwind CDN script: {TAILWIND_CDN}")

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
        if not parser.source_links.get(source_id):
            errors.append(f"source {source_id!r} has no link")

    errors.extend(parser.svg_errors)
    return errors


def main() -> int:
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("reports", nargs="+", type=Path)
    args = arguments.parse_args()
    failed = False
    for report in args.reports:
        try:
            errors = validate(report)
        except (OSError, UnicodeError) as exc:
            errors = [str(exc)]
        if errors:
            failed = True
            print(f"FAIL {report}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"OK {report}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
