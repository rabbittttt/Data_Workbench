import unittest
from unittest.mock import Mock

from server import Handler


class ServerResponseTests(unittest.TestCase):
    def make_handler(self):
        handler = object.__new__(Handler)
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.wfile = Mock()
        handler.close_connection = False
        return handler

    def test_disconnected_client_does_not_trigger_second_error_response(self):
        for error_type in (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            for stage in ('headers', 'body'):
                with self.subTest(error_type=error_type, stage=stage):
                    handler = self.make_handler()
                    target = handler.end_headers if stage == 'headers' else handler.wfile.write
                    target.side_effect = error_type(10053, 'connection closed')
                    handler.send_json({'tables': []})
                    self.assertTrue(handler.close_connection)
                    handler.send_response.assert_called_once_with(200)
                    self.assertEqual(handler.wfile.write.call_count, 0 if stage == 'headers' else 1)

    def test_successful_response_and_real_application_errors_are_not_swallowed(self):
        handler = self.make_handler()
        handler.send_json({'saved': True})
        handler.wfile.write.assert_called_once_with(b'{"saved": true}')
        self.assertFalse(handler.close_connection)
        handler.wfile.write.side_effect = ValueError('unexpected failure')
        with self.assertRaisesRegex(ValueError, 'unexpected failure'):
            handler.send_json({})


if __name__ == '__main__':
    unittest.main()
