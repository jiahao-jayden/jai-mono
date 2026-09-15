"""Run with python3 research/scripts/test_check_report.py."""
from pathlib import Path
from tempfile import TemporaryDirectory
from check_report import validate


def test_report():
    with TemporaryDirectory() as directory:
        root = Path(directory)
        note = root / 'note.md'
        note.write_text('''# Evidence
## 结论
1. A [source](https://example.com/a)
2. B [other](https://example.com/b)
## Detailed implementation omitted from HTML
> Long excerpt stays here.
| Name | Value |
|---|---|
| A | B |
''')
        report = root / 'report.html'
        html = '''<html><head><title>Answer</title></head><body><main>
<header><p data-plain>A direct answer.</p><a data-note-link href="note.md">Evidence</a></header>
<section data-report-section="conclusions"><h2>A different heading</h2>
<article data-claim-id="c1" data-source-ids="s1"><p data-plain>Selected answer, with conditions.</p></article></section>
<section data-report-section="impact"><h2>Our next action</h2><p data-plain>Do this under these conditions.</p></section>
<section data-report-section="unknowns"><h2>Limits</h2><p>Not measured.</p></section>
<section data-report-section="sources"><h2>Sources</h2><ol><li id="source-s1"><a href="https://example.com/a">A</a></li></ol></section>
</main></body></html>'''
        report.write_text(html)
        assert validate(report, note) == [], 'A selective, offline report should pass'
        for before, after, error in [
            ('data-source-ids="s1"', 'data-source-ids="absent"', 'missing source'),
            ('https://example.com/a', 'https://example.com/unverified', 'not in the evidence note'),
            ('href="note.md"', 'href="wrong.md"', 'supplied Markdown note'),
            ('data-note-link', 'data-unused', 'missing complete evidence note'),
        ]:
            report.write_text(html.replace(before, after))
            assert any(error in e for e in validate(report, note)), error
        print('PASS: selective report accepted; missing sources, new sources and broken note links rejected')


if __name__ == '__main__':
    test_report()
