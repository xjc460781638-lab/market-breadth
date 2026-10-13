"""Durable, provider-isolated daily history cache. No credentials are persisted."""
from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path


class HistoryCache:
    def __init__(self, path=None):
        self.path = Path(path or Path(__file__).resolve().parents[1] / '.cache/ifind/history.sqlite3')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=30)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS bars (
                series TEXT NOT NULL, day TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY(series, day));
            CREATE TABLE IF NOT EXISTS coverage (
                series TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
                PRIMARY KEY(series, start, end));
        ''')

    @staticmethod
    def key(code, indicators, parameters):
        # Adjustment convention and basis belong to the cache identity.
        return json.dumps(['ifind', code, indicators, parameters], sort_keys=True, separators=(',', ':'))

    def missing(self, series, start, end):
        cursor, limit = date.fromisoformat(start), date.fromisoformat(end)
        missing = []
        intervals = self.db.execute(
            'SELECT start,end FROM coverage WHERE series=? AND end>=? AND start<=? ORDER BY start',
            (series, start, end))
        for a, b in intervals:
            a, b = date.fromisoformat(a), date.fromisoformat(b)
            if a > cursor:
                missing.append((cursor.isoformat(), (a - timedelta(days=1)).isoformat()))
            cursor = max(cursor, b + timedelta(days=1))
            if cursor > limit:
                break
        if cursor <= limit:
            missing.append((cursor.isoformat(), end))
        return missing

    def store(self, series, start, end, table, indicators):
        dates, values = table.get('time', []), table.get('table', {})
        fields = indicators.split(',')
        # Empty/error/misaligned payloads must never poison coverage and prevent retries.
        if not dates or any(len(values.get(field, [])) != len(dates) for field in fields):
            raise ValueError('iFinD history is empty or incomplete; cache coverage not advanced')
        rows = []
        for i, day in enumerate(dates):
            day = day[:10]
            if not start <= day <= end:
                raise ValueError('iFinD history returned an out-of-range date')
            row = {field: values[field][i] for field in fields}
            rows.append((series, day, json.dumps(row, allow_nan=False)))
        with self.db:
            self.db.executemany('INSERT OR REPLACE INTO bars VALUES (?,?,?)', rows)
            self.db.execute('INSERT OR REPLACE INTO coverage VALUES (?,?,?)', (series, start, end))

    def read(self, series, start, end):
        return [{'date': day, **json.loads(value)} for day, value in self.db.execute(
            'SELECT day,value FROM bars WHERE series=? AND day>=? AND day<=? ORDER BY day',
            (series, start, end))]

    def invalidate(self, series):
        # An explicit adjustment change invalidates only this stock/series.
        with self.db:
            self.db.execute('DELETE FROM bars WHERE series=?', (series,))
            self.db.execute('DELETE FROM coverage WHERE series=?', (series,))

    def history(self, client, code, indicators, start, end, **parameters):
        """Only use for completed days; never freeze an intraday bar as final."""
        date.fromisoformat(start)
        date.fromisoformat(end)
        if start > end:
            raise ValueError('History start must not follow end')
        if str(parameters.get('CPS', '1')) != '1' and not parameters.get('baseDate'):
            raise ValueError('Adjusted cache requires an explicit baseDate; a moving basis cannot be appended safely')
        series = self.key(code, indicators, parameters)
        for a, b in self.missing(series, start, end):
            result = client.history(code, indicators, a, b, **parameters)
            table = next((t for t in result.get('tables', []) if t.get('thscode') == code), None)
            if table is None:
                raise ValueError('iFinD history did not return the requested security')
            self.store(series, a, b, table, indicators)
        return self.read(series, start, end)

    def close(self):
        self.db.close()
