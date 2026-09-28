import tempfile
import unittest
from pathlib import Path
from openpyxl import Workbook
from server import original_sheet, workbook_info


class OriginalSheetTests(unittest.TestCase):
    def test_unrecognized_sheets_positions_and_paging(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.xlsx'
            book = Workbook()
            sheet = book.active
            sheet.title = '原表'
            sheet['B3'] = '标题'
            sheet.merge_cells('B3:D3')
            sheet['BK101'] = 42
            book.create_sheet('只有说明')['A1'] = '无需识别也能看见'
            book.save(path)
            before = path.read_bytes()
            first = original_sheet(path)
            self.assertEqual(first['rows'][2][1], '标题')
            self.assertEqual(first['merges'], [[2, 3, 4, 3]])
            self.assertIn('只有说明', first['sheets'])
            page = original_sheet(path, '原表', 101, 63)
            self.assertEqual(page['rows'], [[42]])
            self.assertEqual(original_sheet(path, '只有说明')['rows'][0][0], '无需识别也能看见')
            self.assertEqual(before, path.read_bytes())

    def test_missing_sheet_recovers_directory_without_reusing_old_region(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'changed.xlsx'
            book = Workbook()
            book.active.title = '汇总说明'
            book.active['A1'] = '当前版本'
            for index in range(1, 20):
                book.create_sheet(f'实际工作表{index}')
            book.save(path)
            before = path.read_bytes()
            result = original_sheet(path, '小转大进度', 500, 60)
            self.assertEqual(len(result['sheets']), 20)
            self.assertEqual(result['missing_sheet'], '小转大进度')
            self.assertEqual(result['sheet'], '汇总说明')
            self.assertEqual((result['start'], result['column']), (1, 1))
            self.assertEqual(result['rows'][0][0], '当前版本')
            self.assertIn('已不存在', result['warning'])
            self.assertEqual(workbook_info(path)['sheets'], result['sheets'])
            self.assertEqual(before, path.read_bytes())


if __name__ == '__main__':
    unittest.main()
