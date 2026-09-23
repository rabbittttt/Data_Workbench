from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import hashlib
import json
import sqlite3
from contextlib import contextmanager

import pandas as pd

from excel_parser import ParsedTable, discover_tables, infer_series_type, scan_excel_files, PARSER_VERSION


@dataclass
class ScanResult:
    files: int
    tables: int
    rows: int
    errors: list[str]


class Warehouse:
    def __init__(self, database_path: str | Path):
        self.path = Path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _init_schema(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY,
                    sql_table TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    sheet_name TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    range_ref TEXT NOT NULL,
                    row_count INTEGER NOT NULL,
                    column_count INTEGER NOT NULL,
                    columns_json TEXT NOT NULL,
                    scanned_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_datasets_file ON datasets(file_name);
                CREATE TABLE IF NOT EXISTS file_versions (path TEXT PRIMARY KEY, signature TEXT NOT NULL);
                """
            )

    @staticmethod
    def _identity(table: ParsedTable) -> tuple[str, str]:
        raw = f"{table.file_path}|{table.sheet_name}|{table.range_ref.split(':')[0]}"
        digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
        return digest, f"data_{digest}"

    def rebuild(self, folder: str | Path) -> ScanResult:
        return self.sync(folder, force=True)

    def sync(self, folder: str | Path, force: bool = False) -> ScanResult:
        files = scan_excel_files(folder)
        errors: list[str] = []
        for file_path in files:
            try:
                stat = file_path.stat()
                signature = f"{stat.st_mtime_ns}:{stat.st_size}:{PARSER_VERSION}"
                with self.connect() as connection:
                    previous = connection.execute('SELECT signature FROM file_versions WHERE path=?', (str(file_path),)).fetchone()
                if not force and previous and previous[0] == signature:
                    continue
                tables = discover_tables(file_path)
                after = file_path.stat()
                if signature != f"{after.st_mtime_ns}:{after.st_size}:{PARSER_VERSION}":
                    raise ValueError('文件正在保存，下次刷新重试')
                if not tables:
                    raise ValueError('未发现可识别表格，保留上次导入数据')
                self._replace_file(file_path, tables, signature)
            except Exception as exc:  # one damaged workbook must not stop the scan
                errors.append(f"{file_path.name}: {exc}")
        catalog = self.catalog()
        return ScanResult(len(files), len(catalog), int(catalog.row_count.sum()), errors)

    def _replace_file(self, file_path, tables, signature):
        with self.connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            old_tables = [row[0] for row in connection.execute("SELECT sql_table FROM datasets WHERE file_path=?", (str(file_path),))]
            for sql_table in old_tables:
                connection.execute(f'DROP TABLE IF EXISTS "{sql_table}"')
            connection.execute("DELETE FROM datasets WHERE file_path=?", (str(file_path),))
            now = datetime.now().isoformat(timespec="seconds")
            for table in tables:
                dataset_id, sql_table = self._identity(table)
                frame = table.dataframe.copy()
                frame.columns = [str(column) for column in frame.columns]
                frame.insert(0, "_source_row", range(table.header_row + 1, table.header_row + 1 + len(frame)))
                quote = lambda name: '"' + str(name).replace('"', '""') + '"'
                connection.execute(f'CREATE TABLE "{sql_table}" ({", ".join(quote(c) for c in frame.columns)})')
                def scalar(value):
                    if pd.isna(value):
                        return None
                    if isinstance(value, (datetime, pd.Timestamp)):
                        return value.isoformat()
                    return value.item() if hasattr(value, 'item') else value
                connection.executemany(
                    f'INSERT INTO "{sql_table}" VALUES ({", ".join("?" for _ in frame.columns)})',
                    [tuple(scalar(v) for v in row) for row in frame.itertuples(index=False, name=None)],
                )
                column_info = [
                    {
                        "name": column,
                        "type": infer_series_type(table.dataframe[column]),
                        "non_null": int(table.dataframe[column].notna().sum()),
                    }
                    for column in table.dataframe.columns
                ]
                connection.execute(
                    """INSERT INTO datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        dataset_id,
                        sql_table,
                        str(table.file_path),
                        table.file_path.name,
                        table.sheet_name,
                        table.table_name,
                        table.range_ref,
                        len(table.dataframe),
                        len(table.dataframe.columns),
                        json.dumps(column_info, ensure_ascii=False),
                        now,
                    ),
                )
            connection.execute('INSERT OR REPLACE INTO file_versions VALUES (?, ?)', (str(file_path), signature))

    def catalog(self) -> pd.DataFrame:
        with self.connect() as connection:
            return pd.read_sql_query(
                """SELECT id, file_path, file_name, sheet_name, table_name, range_ref,
                          row_count, column_count, columns_json, scanned_at
                   FROM datasets ORDER BY file_name, sheet_name, table_name""",
                connection,
            )

    def load(self, dataset_id: str) -> pd.DataFrame:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT sql_table, file_name, sheet_name, table_name FROM datasets WHERE id = ?",
                (dataset_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"找不到数据表：{dataset_id}")
            frame = pd.read_sql_query(f'SELECT * FROM "{row["sql_table"]}"', connection)
            frame.insert(0, "_数据表", row["table_name"])
            frame.insert(0, "_Sheet", row["sheet_name"])
            frame.insert(0, "_文件", row["file_name"])
            return frame
