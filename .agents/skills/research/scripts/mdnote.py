"""Parse the parts of a research note that the checkers care about.

A note is Markdown with a fixed frame: a title, a verification line, a
"## 结论" section first, free-form sections in the middle, a "## 来源覆盖"
table, and "## 对本项目的影响" last. This module extracts headings, links,
excerpts, tables and the coverage table so check_note.py and check_report.py
can share one reading of the file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

CONCLUSIONS_HEADING = "结论"
COVERAGE_HEADING = "来源覆盖"
IMPACT_HEADING = "对本项目的影响"
COVERAGE_ROWS = (
    "官方文档 / 源码",
    "作者或维护者本人的说法",
    "同类方案",
    "issue / PR / 社区实践",
    "历史演变",
)

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
ORDERED_ITEM_RE = re.compile(r"^\s*\d+[.)]\s+")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
PLACEHOLDER_RE = re.compile(r"^\s*(<.*>|\.\.\.|…|替换.*)?\s*$")


@dataclass
class Section:
    level: int
    title: str
    start: int  # line index of the heading
    end: int  # exclusive line index
    lines: list[str] = field(default_factory=list)


@dataclass
class Note:
    path: Path
    lines: list[str]
    title: str | None
    sections: list[Section]

    def section(self, title: str) -> Section | None:
        for section in self.sections:
            if section.level == 2 and section.title == title:
                return section
        return None

    def h2_sections(self) -> list[Section]:
        return [section for section in self.sections if section.level == 2]

    def headings(self, levels: tuple[int, ...] = (2, 3)) -> list[str]:
        return [section.title for section in self.sections if section.level in levels]

    def links(self) -> list[str]:
        return [url for line in self._prose_lines(self.lines) for url in LINK_RE.findall(line)]

    def conclusion_items(self) -> list[str]:
        section = self.section(CONCLUSIONS_HEADING)
        if section is None:
            return []
        items: list[str] = []
        for line in section.lines[1:]:
            if ORDERED_ITEM_RE.match(line):
                items.append(line.strip())
            elif items and line.strip() and not line.startswith("#"):
                items[-1] += " " + line.strip()
        return items

    def excerpt_starts(self) -> list[int]:
        """Line indexes where a fenced code block or blockquote begins."""
        starts: list[int] = []
        in_fence = False
        in_quote = False
        for index, line in enumerate(self.lines):
            if FENCE_RE.match(line):
                if not in_fence:
                    starts.append(index)
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            if line.lstrip().startswith(">"):
                if not in_quote:
                    starts.append(index)
                in_quote = True
            else:
                in_quote = False
        return starts

    def table_count(self) -> int:
        count = 0
        in_table = False
        in_fence = False
        for line in self.lines:
            if FENCE_RE.match(line):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            is_row = bool(TABLE_ROW_RE.match(line))
            if is_row and not in_table:
                count += 1
            in_table = is_row
        return count

    def coverage_rows(self) -> dict[str, str]:
        section = self.section(COVERAGE_HEADING)
        if section is None:
            return {}
        rows: dict[str, str] = {}
        for line in section.lines[1:]:
            if not TABLE_ROW_RE.match(line):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) < 2 or set(cells[0]) <= {"-", ":", " "}:
                continue
            rows[cells[0]] = cells[1]
        return rows

    @staticmethod
    def _prose_lines(lines: list[str]) -> list[str]:
        prose: list[str] = []
        in_fence = False
        for line in lines:
            if FENCE_RE.match(line):
                in_fence = not in_fence
                continue
            if not in_fence:
                prose.append(line)
        return prose


def is_placeholder(text: str) -> bool:
    return bool(PLACEHOLDER_RE.match(text))


def parse_note(path: Path) -> Note:
    lines = path.read_text(encoding="utf-8").splitlines()
    title: str | None = None
    sections: list[Section] = []
    in_fence = False
    for index, line in enumerate(lines):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = HEADING_RE.match(line)
        if not match:
            continue
        level = len(match.group(1))
        heading = match.group(2).strip()
        if level == 1 and title is None:
            title = heading
            continue
        sections.append(Section(level=level, title=heading, start=index, end=len(lines)))
    for current, following in zip(sections, sections[1:]):
        current.end = following.start
    for section in sections:
        section.lines = lines[section.start : section.end]
    return Note(path=path, lines=lines, title=title, sections=sections)
