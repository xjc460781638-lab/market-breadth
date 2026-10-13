import unittest
from unittest.mock import Mock
from collector.ifind_client import IFinDClient, IFinDError


class IFinDClientTests(unittest.TestCase):
    def test_auth_and_query_use_only_official_endpoint_and_headers(self):
        session = Mock()
        session.post.side_effect = [
            Mock(status_code=200, json=lambda: {'errorcode':0, 'data':{'access_token':'test-access'}}),
            Mock(status_code=200, json=lambda: {'errorcode':0, 'tables':[]}),
        ]
        client = IFinDClient('test-refresh', session)
        client.high_frequency('000001.SZ','close','2026-10-12 09:30:00','2026-10-12 09:31:00')
        self.assertEqual(session.post.call_count, 2)
        for call in session.post.call_args_list:
            self.assertTrue(call.args[0].startswith('https://quantapi.51ifind.com/api/v1/'))
            self.assertFalse(call.kwargs['allow_redirects'])
            self.assertNotIn('test-refresh', str(call.kwargs.get('json')))

    def test_permission_failure_has_no_fallback_or_secret_echo(self):
        session = Mock()
        session.post.return_value = Mock(status_code=200, json=lambda: {'errorcode':-1,'errmsg':'test-secret'})
        with self.assertRaisesRegex(IFinDError, '^iFinD errorcode -1$'):
            IFinDClient('test-secret', session).authenticate()
        self.assertEqual(session.post.call_count, 1)

    def test_redirect_is_not_followed(self):
        session = Mock()
        session.post.return_value = Mock(status_code=302)
        with self.assertRaisesRegex(IFinDError, 'HTTP 302'):
            IFinDClient('test-secret', session).authenticate()
