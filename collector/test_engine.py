import unittest
import numpy as np
import pandas as pd
from collector.engine import calculate, align_prices


class CalculationTests(unittest.TestCase):
    def test_matches_original_notebook(self):
        rng = np.random.default_rng(42)
        prices = pd.DataFrame(rng.uniform(1, 50, (270, 20)), index=pd.bdate_range('2024-01-01', periods=270))
        prices.columns = [f'{i:06}' for i in range(20)]
        mapping = {s: str(int(s) % 3) for s in prices}
        result = calculate(prices, mapping, {str(i): str(i) for i in range(3)})
        # Reference is a transcription of the supplied notebook's orientation/grouping.
        close = prices.T
        ma = close.T.rolling(20).mean().T.iloc[:, -250:]
        bias = close.iloc[:, -250:] > ma
        market = (100*bias.sum()/bias.count()).round()
        bias['industry_code'] = pd.Series(mapping)
        ratios = (100*bias.groupby('industry_code').sum()/bias.groupby('industry_code').count()).round()
        for row in result['rows']:
            date = pd.Timestamp(row['date'])
            self.assertEqual(row['values']['market']['value'], market[date])
            self.assertEqual(row['values']['sum']['value'], ratios[date].sum())
            for code in mapping.values():
                self.assertEqual(row['values'][code]['value'], ratios.loc[code, date])

    def test_equal_is_not_above_and_missing_not_zero(self):
        df = pd.DataFrame({'a': [10.]*270, 'b': [11.]*269+[np.nan]}, index=pd.bdate_range('2024-01-01', periods=270))
        r = calculate(df, {'a':'x','b':'y'}, {'x':'X','y':'Y'})
        self.assertEqual(r['eligibleStocks'], 1)
        self.assertEqual(r['rows'][0]['values']['x']['value'], 0)
        self.assertIsNone(r['rows'][0]['values']['y']['value'])
        self.assertIsNone(r['rows'][0]['values']['sum']['value'])

    def test_round_half_even(self):
        df = pd.DataFrame(10., index=pd.bdate_range('2024-01-01', periods=270), columns=list('abcdefgh'))
        df.iloc[-1,0] = 11
        r = calculate(df, {c:'x' for c in df}, {'x':'X'})
        self.assertEqual(r['rows'][0]['values']['x']['value'], 12)

    def test_intraday_replaces_only_current_bar(self):
        df = pd.DataFrame({'a':[10.]*269+[20.]}, index=pd.bdate_range('2024-01-01', periods=270))
        r = calculate(df, {'a':'x'}, {'x':'X'})
        self.assertEqual(r['rows'][0]['values']['market']['value'],100)
        self.assertEqual(r['rows'][1]['values']['market']['value'],0)

    def test_missing_bar_is_not_forward_filled(self):
        out = align_prices({'a':pd.Series([10.,11.],index=['2026-10-08','2026-10-12'])}, ['2026-10-08','2026-10-09','2026-10-12'])
        self.assertTrue(pd.isna(out.loc['2026-10-09','a']))

    def test_short_window_rejected(self):
        with self.assertRaises(ValueError):
            calculate(pd.DataFrame({'a':[1]*20}), {'a':'x'}, {'x':'X'})

if __name__ == '__main__':
    unittest.main()
