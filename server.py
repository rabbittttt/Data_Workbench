"""Local data workspace. Run: python server.py (http://127.0.0.1:8765)."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from dataclasses import asdict
import json
import hashlib
import threading
import time
import pandas as pd
from openpyxl import load_workbook
from warehouse import Warehouse

ROOT = Path(__file__).resolve().parent
STORE = Warehouse(ROOT / 'output_file' / 'warehouse.db')
LOCK = threading.RLock()
STATUS = {'busy': False, 'errors': [], 'last_sync': None}
CONFIG = ROOT / 'output_file' / 'workspace.json'


def config():
    return json.loads(CONFIG.read_text(encoding='utf-8')) if CONFIG.exists() else {'folder': str(ROOT / 'input_file'), 'auto': True}


def sync():
    if STATUS['busy']:
        return
    with LOCK:
        STATUS['busy'] = True
        try:
            result = STORE.sync(config()['folder'])
            STATUS.update(asdict(result), last_sync=time.strftime('%Y-%m-%d %H:%M:%S'))
        except Exception as exc:
            STATUS['errors'] = [str(exc)]
        finally:
            STATUS['busy'] = False


def catalog():
    records = STORE.catalog().to_dict('records')
    folder = Path(config()['folder']).resolve()
    for row in records:
        row['fields'] = json.loads(row.pop('columns_json'))
        path = Path(row['file_path'])
        row['relative_path'] = str(path.relative_to(folder)) if path.is_relative_to(folder) else str(path)
        row['archived'] = not path.exists() or not path.is_relative_to(folder)
        row['issues'] = []
        if any(f['name'].startswith('字段') for f in row['fields']):
            row['issues'].append('存在未命名字段，建议核对表头')
        if any(f['non_null'] < row['row_count']*.5 for f in row['fields']):
            row['issues'].append('部分字段缺失超过一半')
        if row['row_count'] <= 4:
            row['issues'].append('小型数据区域，可能是图表辅助区')
    return records


def data(dataset_id):
    frame = STORE.load(dataset_id)
    # JSON serializer preserves nulls and ISO dates; no NaN reaches the browser.
    return {'columns': list(frame.columns), 'rows': json.loads(frame.to_json(orient='records', date_format='iso', force_ascii=False))}


def workbook_files():
    folder = Path(config()['folder']).resolve()
    return {hashlib.sha256(str(p.resolve()).encode()).hexdigest()[:24]: p.resolve()
            for p in folder.rglob('*') if p.is_file() and p.suffix.lower() in {'.xlsx', '.xlsm'}
            and not p.name.startswith('~$') and p.resolve().is_relative_to(folder)}


def original_sheet(path, sheet_name=None, start=1, column=1):
    """Read source cells independently of inferred tables. Never save the workbook."""
    book = load_workbook(path, data_only=True)
    try:
        sheet = book[sheet_name] if sheet_name else book.worksheets[0]
        start = min(max(1, start), sheet.max_row)
        column = min(max(1, column), sheet.max_column)
        bottom, right = min(start+79, sheet.max_row), min(column+29, sheet.max_column)
        rows = [[cell.value for cell in row] for row in sheet.iter_rows(
            min_row=start, max_row=bottom, min_col=column, max_col=right)]
        merges = [list(r.bounds) for r in sheet.merged_cells.ranges
                  if r.min_row <= bottom and r.max_row >= start and r.min_col <= right and r.max_col >= column]
        return dict(sheets=book.sheetnames, sheet=sheet.title, rows=rows, merges=merges,
                    start=start, column=column, max_row=sheet.max_row, max_col=sheet.max_column)
    finally:
        book.close()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'web'), **kwargs)

    def send_json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = urlparse(self.path)
        query = parse_qs(parts.query)
        try:
            if parts.path == '/api/catalog':
                return self.send_json({'tables': catalog(), 'status': STATUS, 'config': config()})
            if parts.path == '/api/table':
                return self.send_json(data(query['id'][0]))
            if parts.path == '/api/workbooks':
                folder = Path(config()['folder']).resolve()
                return self.send_json({'files': [{'id': key, 'name': str(path.relative_to(folder)), 'path': str(path)}
                                                for key, path in sorted(workbook_files().items(), key=lambda item: str(item[1]))]})
            if parts.path == '/api/sheet':
                path = workbook_files().get(query['id'][0])
                if path is None:
                    raise ValueError('文件已移走，请重新选择数据文件')
                return self.send_json(original_sheet(path, query.get('sheet', [None])[0],
                                      int(query.get('start', ['1'])[0]), int(query.get('column', ['1'])[0])))
            if parts.path == '/api/search':
                words = query.get('q', [''])[0].casefold().split()
                hits = []
                if words:
                    for table in catalog():
                        context = ' '.join([table['file_name'], table['sheet_name'], table['table_name'], *[f['name'] for f in table['fields']]]).casefold()
                        frame = STORE.load(table['id'])
                        matched = []
                        for row in frame.to_dict('records'):
                            if all(w in context + ' ' + ' '.join(str(v) for v in row.values()).casefold() for w in words):
                                matched.append(row)
                                if len(matched) >= 3:
                                    break
                        if matched or all(w in context for w in words):
                            hits.append({'table': table, 'rows': json.loads(pd.DataFrame(matched).to_json(orient='records', date_format='iso'))})
                return self.send_json({'hits': hits})
            if parts.path == '/api/raw':
                table = next(t for t in catalog() if t['id'] == query['id'][0])
                book = load_workbook(table['file_path'], read_only=True, data_only=True)
                try:
                    sheet = book[table['sheet_name']]
                    start = max(1, int(query.get('start', ['1'])[0]))
                    rows = list(sheet.iter_rows(min_row=start, max_row=min(start+79, sheet.max_row), max_col=min(sheet.max_column, 60), values_only=True))
                    return self.send_json({'rows': rows, 'start': start, 'max_row': sheet.max_row, 'max_col': sheet.max_column})
                finally:
                    book.close()
            if parts.path.startswith('/api/'):
                return self.send_json({'error': '接口不存在'}, 404)
            return super().do_GET()
        except Exception as exc:
            self.send_json({'error': str(exc)}, 400)

    def do_POST(self):
        # JSON + same-origin requests only; server listens exclusively on loopback.
        if self.headers.get('Origin') and self.headers['Origin'] != 'http://' + self.headers.get('Host', ''):
            return self.send_json({'error': '来源不匹配'}, 403)
        if 'application/json' not in self.headers.get('Content-Type', ''):
            return self.send_json({'error': '需要 JSON 请求'}, 400)
        try:
            payload = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length', 0)), 65536)) or b'{}')
            if self.path == '/api/sync':
                if not STATUS['busy']:
                    threading.Thread(target=sync, daemon=True).start()
                return self.send_json({'started': True})
            if self.path == '/api/config':
                folder = Path(payload['folder']).expanduser().resolve()
                if not folder.is_dir():
                    raise ValueError('文件夹不存在')
                CONFIG.write_text(json.dumps({'folder': str(folder), 'auto': bool(payload.get('auto', True))}, ensure_ascii=False), encoding='utf-8')
                threading.Thread(target=sync, daemon=True).start()
                return self.send_json({'saved': True})
            if self.path == '/api/recognition':
                from excel_parser import discover_tables, OVERRIDES
                table = next(t for t in catalog() if t['id'] == payload['id'])
                from openpyxl.utils.cell import range_boundaries
                left, top, right, bottom = range_boundaries(payload['range'])
                if not all([left, top, right, bottom]) or bottom <= top or right < left:
                    raise ValueError('区域需包含一行表头及至少一行数据，例如 A2:F80')
                with LOCK:
                    rules = json.loads(OVERRIDES.read_text(encoding='utf-8')) if OVERRIDES.exists() else {}
                    key = table['file_path'] + '|' + table['sheet_name'] + '|' + table['range_ref'].split(':')[0]
                    rules[key] = {'file': table['file_path'], 'sheet': table['sheet_name'], 'range': payload['range'], 'name': payload.get('name') or table['table_name'], 'original': table['range_ref']}
                    # Validate the entire workbook before persisting the rule.
                    parsed = discover_tables(table['file_path'], rules=rules)
                    STORE._replace_file(Path(table['file_path']), parsed, '')
                    OVERRIDES.write_text(json.dumps(rules, ensure_ascii=False, indent=2), encoding='utf-8')
                return self.send_json({'saved': True})
            self.send_json({'error': '接口不存在'}, 404)
        except Exception as exc:
            self.send_json({'error': str(exc)}, 400)


def watch():
    while True:
        if config().get('auto', True):
            sync()
        time.sleep(60)


if __name__ == '__main__':
    threading.Thread(target=watch, daemon=True).start()
    print('数据速查工作台: http://127.0.0.1:8765', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
