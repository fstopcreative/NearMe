"""
Streaming reader for large OpenDocument spreadsheets (.ods).

GOV.UK publishes several datasets only as .ods (the crime tables unzip to
~1.4 GB of XML). This reads row by row with iterparse, so memory stays flat
(~30 MB) and no third-party package is needed.
"""
import zipfile
import xml.etree.ElementTree as ET

_T = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
_X = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
_O = '{urn:oasis:names:tc:opendocument:xmlns:office:1.0}'


def rows(path, sheets=None):
    """Yield (sheet_name, [cell, ...]) for every non-empty row.

    `sheets`: optional predicate on the sheet name; other sheets are skipped
    (still streamed, but rows are not decoded).
    """
    with zipfile.ZipFile(path) as z, z.open('content.xml') as f:
        sheet, wanted = None, True
        for ev, el in ET.iterparse(f, events=('start', 'end')):
            if ev == 'start':
                if el.tag == _T + 'table':
                    sheet = el.get(_T + 'name')
                    wanted = sheets is None or sheets(sheet)
                continue
            if el.tag == _T + 'table-row':
                if wanted:
                    vals = []
                    for c in el:
                        if c.tag not in (_T + 'table-cell', _T + 'covered-table-cell'):
                            continue
                        rep = int(c.get(_T + 'number-columns-repeated', '1'))
                        v = c.get(_O + 'value')
                        if v is None:
                            v = ''.join(''.join(p.itertext()) for p in c.findall(_X + 'p')) or None
                        if rep > 50 and v is None:
                            break
                        vals.extend([v] * min(rep, 50))
                    while vals and vals[-1] is None:
                        vals.pop()
                    if vals:
                        yield sheet, vals
                el.clear()
            elif el.tag == _T + 'table':
                el.clear()
