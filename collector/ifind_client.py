"""iFinD HTTP transport. No legacy-provider fallback and no credential logging.

Official protocol examples:
https://quantapi.10jqka.com.cn/gwstatic/static/ds_web/quantapi-web/example.html
"""
import os
from pathlib import Path
import requests

BASE = 'https://quantapi.51ifind.com/api/v1/'


class IFinDError(RuntimeError):
    pass


def local_refresh_token():
    token = os.environ.get('IFIND_REFRESH_TOKEN', '').strip()
    if not token:
        path = Path(__file__).resolve().parents[1] / '.env.ifind.local'
        if path.exists():
            for line in path.read_text(encoding='utf-8-sig').splitlines():
                if line.startswith('IFIND_REFRESH_TOKEN='):
                    token = line.split('=', 1)[1].strip().strip('\"\'')
    if not token:
        raise IFinDError('IFIND_REFRESH_TOKEN is not configured')
    return token


class IFinDClient:
    def __init__(self, refresh_token, session=None):
        self._refresh_token = refresh_token
        self._access_token = None
        self._session = session or requests.Session()

    def _post(self, endpoint, headers, payload=None):
        try:
            response = self._session.post(
                BASE + endpoint, headers={'Content-Type': 'application/json', **headers},
                json=payload, timeout=(10, 45), allow_redirects=False)
        except requests.RequestException:
            raise IFinDError('iFinD connection failed; no other provider was queried') from None
        if response.status_code != 200:
            raise IFinDError(f'iFinD HTTP {response.status_code}')
        try:
            data = response.json()
        except ValueError:
            raise IFinDError('iFinD returned invalid JSON') from None
        if not isinstance(data, dict):
            raise IFinDError('iFinD returned an invalid response')
        code = data.get('errorcode')
        if code not in (None, 0, '0'):
            # Provider free-text errors may contain sensitive request details.
            safe_code = str(code) if str(code).lstrip('-').isdigit() else 'unknown'
            raise IFinDError(f'iFinD errorcode {safe_code}')
        return data

    def authenticate(self):
        data = self._post('get_access_token', {'refresh_token': self._refresh_token})
        token = data.get('data', {}).get('access_token')
        if not isinstance(token, str) or not token:
            raise IFinDError('iFinD authentication did not return an access token')
        self._access_token = token

    def high_frequency(self, codes, indicators, start, end):
        if not self._access_token:
            self.authenticate()
        return self._post('high_frequency', {'access_token': self._access_token}, {
            'codes': codes, 'indicators': indicators,
            'starttime': start, 'endtime': end,
        })

    def query(self, endpoint, payload):
        allowed = {'basic_data_service', 'date_sequence', 'cmd_history_quotation',
                   'real_time_quotation', 'smart_stock_picking', 'data_pool', 'edb_service'}
        if endpoint not in allowed:
            raise IFinDError('Unsupported iFinD endpoint')
        if not self._access_token:
            self.authenticate()
        return self._post(endpoint, {'access_token': self._access_token}, payload)

    def history(self, codes, indicators, start, end, **parameters):
        return self.query('cmd_history_quotation', {
            'codes': codes, 'indicators': indicators, 'startdate': start,
            'enddate': end, 'functionpara': {'Fill': 'Blank', **parameters}})

    def basic(self, codes, indicators):
        return self.query('basic_data_service', {'codes': codes, 'indipara': indicators})
