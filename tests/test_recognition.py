import unittest
import tempfile
from pathlib import Path
from openpyxl import Workbook
from excel_parser import discover_tables


class RecognitionTest(unittest.TestCase):
    def test_explicit_rule_and_source_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'sample.xlsx'
            book = Workbook()
            sheet = book.active
            sheet.append(['销量说明'])
            sheet.append(['车型', '销量'])
            sheet.append(['M8', 100])
            sheet.append(['M9', 200])
            book.save(path)
            before = path.read_bytes()
            rules = {'test': {'file': str(path), 'sheet': sheet.title, 'range': 'A2:B4', 'original': 'A2:B4', 'name': '核对后的销量'}}
            tables = discover_tables(path, rules=rules)
            self.assertEqual(len(tables), 1)
            self.assertEqual(tables[0].table_name, '核对后的销量')
            self.assertEqual(tables[0].dataframe['销量'].sum(), 300)
            self.assertEqual(path.read_bytes(), before)

    def test_invalid_rule_not_silently_truncated(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'sample.xlsx'
            book = Workbook()
            book.active.append(['车型', '数量'])
            book.active.append(['M8', 100])
            book.save(path)
            rules = {'test': {'file': str(path), 'sheet': book.active.title, 'range': 'A1:D80', 'name': '无效'}}
            with self.assertRaises(ValueError):
                discover_tables(path, rules=rules)
