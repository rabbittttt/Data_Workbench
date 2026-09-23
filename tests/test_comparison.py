import unittest
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory
import pandas as pd
from comparison import aggregate, numbers
from excel_parser import ParsedTable, _make_headers
from warehouse import Warehouse


class ComparisonTests(unittest.TestCase):
    def test_numbers_and_missing(self):
        result = numbers(pd.Series(['1,200', '40%', None, '错误']))
        self.assertEqual(result.iloc[0], 1200)
        self.assertEqual(result.iloc[1], .4)
        self.assertTrue(pd.isna(result.iloc[2]))

    def test_missing_group_not_zero(self):
        frame = pd.DataFrame({'车型': ['M8', 'M8', 'M9'], '销量': [100, 200, None]})
        result = aggregate(frame, '车型', '销量', '求和')
        self.assertEqual(result['M8'], 300)
        self.assertTrue(pd.isna(result['M9']))

    def test_colliding_headers(self):
        headers = _make_headers(['A', 'a', 'a_2', '_source_row'])
        self.assertEqual(len(set(h.casefold() for h in headers)), 4)
        self.assertFalse(any(h.startswith('_') for h in headers))

    def test_sync_preserves_failed_file_and_skips_unchanged(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'input.xlsx'
            path.touch()
            table = ParsedTable(path, 'Sheet', '销量', 'A1:B2', pd.DataFrame({'车型':['M8'], '销量':[100]}), 1)
            store = Warehouse(Path(directory) / 'test.db')
            with patch('warehouse.discover_tables', return_value=[table]) as parse:
                store.sync(directory)
                store.sync(directory)
                self.assertEqual(parse.call_count, 1)
            with patch('warehouse.discover_tables', side_effect=ValueError('损坏')):
                result = store.sync(directory, force=True)
            self.assertEqual(len(result.errors), 1)
            self.assertEqual(len(store.catalog()), 1)
            self.assertEqual(store.load(store.catalog().iloc[0].id)['销量'].iloc[0], 100)

    def test_failed_database_replace_rolls_back(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'input.xlsx'
            store = Warehouse(Path(directory) / 'test.db')
            table = ParsedTable(path, 'S', 'T', 'A1:B2', pd.DataFrame({'a':['M8'], 'b':[100]}), 1)
            store._replace_file(path, [table], '1')
            bad = ParsedTable(path, 'S', 'T', 'A1:B2', pd.DataFrame({'a':[['unsupported']], 'b':[200]}), 1)
            with self.assertRaises(Exception):
                store._replace_file(path, [bad], '2')
            self.assertEqual(store.load(store.catalog().iloc[0].id)['b'].iloc[0], 100)
