#!/usr/bin/env python3
"""Check the structural contract of a research Markdown note.

Usage:
    python3 check_note.py note.md [more.md ...]

This checks the frame (conclusions first, coverage table, impact last) and that
every conclusion can be traced to an excerpt in the body. It does not verify
that an excerpt actually proves the claim; that remains the researcher's job.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mdnote import (  # noqa: E402
    CONCLUSIONS_HEADING,
    COVERAGE_HEADING,
    COVERAGE_ROWS,
    IMPACT_HEADING,
    LINK_RE,
    Note,
    is_placeholder,
    parse_note,
)

# A link in the body counts as "with excerpt" when a code fence or blockquote
# starts within this many lines after the line carrying the link.
EXCERPT_WINDOW = 8


def links_with_excerpt(note: Note) -> set[str]:
    conclusions = note.section(CONCLUSIONS_HEADING)
    skip = range(conclusions.start, conclusions.end) if conclusions else range(0)
    excerpt_starts = note.excerpt_starts()
    supported: set[str] = set()
    for index, line in enumerate(note.lines):
        if index in skip:
            continue
        urls = LINK_RE.findall(line)
        if not urls:
            continue
        if any(index < start <= index + EXCERPT_WINDOW for start in excerpt_starts):
            supported.update(urls)
    return supported


def validate(path: Path) -> list[str]:
    note = parse_note(path)
    errors: list[str] = []

    if note.title is None:
        errors.append("missing '# <title>' heading")

    h2 = note.h2_sections()
    if not h2:
        errors.append("no '## ' sections found")
        return errors

    if h2[0].title != CONCLUSIONS_HEADING:
        errors.append(f"first section must be '## {CONCLUSIONS_HEADING}', found '## {h2[0].title}'")
    if h2[-1].title != IMPACT_HEADING:
        errors.append(f"last section must be '## {IMPACT_HEADING}', found '## {h2[-1].title}'")

    preamble = "\n".join(note.lines[: h2[0].start])
    if "核验日期" not in preamble:
        errors.append("preamble before the first section must state 核验日期 and the pinned version")

    items = note.conclusion_items()
    if not items:
        errors.append(f"'## {CONCLUSIONS_HEADING}' has no numbered items")

    supported = links_with_excerpt(note)
    for position, item in enumerate(items, start=1):
        urls = LINK_RE.findall(item)
        if not urls:
            errors.append(f"conclusion {position} has no link")
            continue
        if not any(url in supported for url in urls):
            errors.append(
                f"conclusion {position}: none of its links reappear in the body with an excerpt "
                f"(code fence or blockquote within {EXCERPT_WINDOW} lines)"
            )

    excerpt_count = len(note.excerpt_starts())
    if items and excerpt_count < len(items):
        errors.append(f"{len(items)} conclusions but only {excerpt_count} excerpts (code fences or blockquotes)")

    coverage = note.coverage_rows()
    if note.section(COVERAGE_HEADING) is None:
        errors.append(f"missing '## {COVERAGE_HEADING}' section")
    else:
        for label in COVERAGE_ROWS:
            value = coverage.get(label)
            if value is None:
                errors.append(f"{COVERAGE_HEADING}: missing row '{label}'")
            elif is_placeholder(value):
                errors.append(f"{COVERAGE_HEADING}: row '{label}' is empty or still a placeholder")

    return errors


def main() -> int:
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("notes", nargs="+", type=Path)
    args = arguments.parse_args()
    failed = False
    for note in args.notes:
        try:
            errors = validate(note)
        except (OSError, UnicodeError) as exc:
            errors = [str(exc)]
        if errors:
            failed = True
            print(f"FAIL {note}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"OK {note}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
