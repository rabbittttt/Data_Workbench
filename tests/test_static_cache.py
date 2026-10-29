"""Verify ordinary browser revalidation against disposable static files."""
from html.parser import HTMLParser
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import server


class ResourceLinks(HTMLParser):
    def __init__(self, body):
        super().__init__()
        self.urls = {}
        self.feed(body.decode('utf-8'))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link':
            self.urls[attrs['rel']] = attrs['href']
        elif tag in ('img', 'script'):
            self.urls[tag] = attrs['src']


class QuietHandler(server.Handler):
    def log_message(self, *_args):
        pass


class StaticCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.web = root / 'web'
        self.web.mkdir()
        (self.web / 'index.html').write_text(
            '<link rel="icon" href="favicon.svg?v=old">'
            '<link rel="stylesheet" href="style.css">'
            '<script src="app.js?v=old"></script>'
            '<img src="favicon.svg?v=old" alt="">', encoding='utf-8')
        for name, body in {'favicon.svg': b'<svg>111</svg>',
                           'style.css': b'body{color:#111}',
                           'app.js': b'var version=111;'}.items():
            (self.web / name).write_bytes(body)
        root_patch = patch.object(server, 'ROOT', root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.worker = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.worker.join(timeout=5)

    def request(self, path, headers=None, method='GET'):
        connection = HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_unchanged_page_and_assets_revalidate_without_downloading_again(self):
        status, headers, body = self.request('/')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-cache')
        links = ResourceLinks(body).urls
        self.assertEqual(links['icon'], links['img'])
        self.assertEqual(self.request('/index.html')[2], body)
        for path in ['/', *['/' + url for url in links.values()]]:
            with self.subTest(path=path):
                status, headers, _ = self.request(path)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Cache-Control'], 'no-cache')
                status, cached_headers, cached_body = self.request(
                    path, {'If-None-Match': headers['ETag']})
                self.assertEqual(status, 304)
                self.assertEqual(cached_headers['ETag'], headers['ETag'])
                self.assertEqual(cached_headers['Cache-Control'], 'no-cache')
                self.assertEqual(cached_body, b'')

    def test_changed_bytes_refresh_page_and_assets_even_with_identical_file_metadata(self):
        for name, link in [('favicon.svg', 'icon'), ('style.css', 'stylesheet'), ('app.js', 'script')]:
            with self.subTest(asset=name):
                _, page_headers, page_body = self.request('/')
                links = ResourceLinks(page_body).urls
                old_url = '/' + links[link]
                _, asset_headers, old_body = self.request(old_url)
                path = self.web / name
                before = path.stat()
                new_body = old_body.replace(b'111', b'222')
                path.write_bytes(new_body)
                os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
                self.assertEqual(path.stat().st_size, before.st_size)
                self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)
                conditional = {'If-None-Match': asset_headers['ETag'],
                               'If-Modified-Since': 'Fri, 01 Jan 2100 00:00:00 GMT'}
                status, new_headers, actual = self.request(old_url, conditional)
                self.assertEqual(status, 200)
                self.assertEqual(actual, new_body)
                self.assertNotEqual(new_headers['ETag'], asset_headers['ETag'])
                status, _, new_page = self.request('/', {'If-None-Match': page_headers['ETag']})
                self.assertEqual(status, 200)
                new_links = ResourceLinks(new_page).urls
                self.assertNotEqual(new_links[link], links[link])
                self.assertEqual(new_links['icon'], new_links['img'])
                for other in ('icon', 'stylesheet', 'script'):
                    if other != link:
                        self.assertEqual(new_links[other], links[other])
                self.assertEqual(self.request('/' + new_links[link])[2], new_body)

    def test_old_timestamp_validators_cannot_hide_updates_and_head_has_no_body(self):
        for path in ('/', '/favicon.svg', '/style.css', '/app.js'):
            with self.subTest(path=path):
                status, headers, body = self.request(
                    path, {'If-Modified-Since': 'Fri, 01 Jan 2100 00:00:00 GMT'})
                self.assertEqual(status, 200)
                head_status, head_headers, head_body = self.request(path, method='HEAD')
                self.assertEqual(head_status, 200)
                self.assertEqual(head_headers['ETag'], headers['ETag'])
                self.assertEqual(int(head_headers['Content-Length']), len(body))
                self.assertEqual(head_body, b'')

    def test_missing_assets_stay_404_and_api_responses_remain_uncacheable(self):
        self.assertEqual(self.request('/missing.svg')[0], 404)
        status, headers, _ = self.request('/api/not-a-real-endpoint')
        self.assertEqual(status, 404)
        self.assertEqual(headers['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
