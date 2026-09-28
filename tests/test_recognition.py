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

    def test_deleted_sheet_rule_does_not_block_current_workbook(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'sample.xlsx'
            book = Workbook()
            book.active.title = '当前订单'
            book.active.append(['车型', '销量'])
            book.active.append(['M8', 999])
            book.active.append(['M9', 200])
            book.save(path)
            before = path.read_bytes()
            rules = {'old': {'file': str(path), 'sheet': '已删除订单', 'range': 'A1:B3', 'name': '旧规则'}}
            notices = []
            tables = discover_tables(path, rules=rules, notices=notices)
            self.assertEqual({t.sheet_name for t in tables}, {'当前订单'})
            self.assertEqual(tables[0].dataframe['销量'].iloc[0], 999)
            self.assertEqual(len(notices), 1)
            self.assertIn('已删除订单', notices[0])
            self.assertEqual(rules['old']['sheet'], '已删除订单', 'stale rules are retained, not deleted')
            self.assertEqual(path.read_bytes(), before)
