"""Pure calculations. No network, files, credentials or trading operations."""
from __future__ import annotations
import numpy as np
import pandas as pd


def calculate(closes: pd.DataFrame, membership: dict[str, str], names: dict[str, str], count=250, window=20):
    """Rows are dates, columns are stocks; same full-window dropna as the notebook."""
    closes = closes.sort_index().tail(count + window).dropna(axis=1, how="any")
    if len(closes) < count + window or closes.empty:
        raise ValueError("历史窗口不完整，不能计算完整市场宽度")
    averages = closes.rolling(window, min_periods=window).mean().tail(count)
    above = closes.tail(count).gt(averages)
    sectors = []
    for code, name in sorted(names.items()):
        stocks = [s for s in above if membership.get(s) == code]
        sectors.append({"code": code, "name": name, "stocks": stocks})
    rows = []
    for date, values in above.iterrows():
        cells = {}
        for sector in sectors:
            n = len(sector["stocks"])
            k = int(values[sector["stocks"]].sum()) if n else 0
            cells[sector["code"]] = {"value": int(np.rint(100*k/n)) if n else None, "above": k, "total": n}
        total = len(values)
        market = int(np.rint(100*values.sum()/total))
        cells["market"] = {"value": market, "above": int(values.sum()), "total": total}
        valid = [v["value"] for v in cells.values() if v is not cells["market"] and v["value"] is not None]
        # A missing entire sector makes the sum unavailable, rather than silently zero.
        cells["sum"] = {"value": sum(valid) if len(valid) == len(sectors) else None, "above": None, "total": len(sectors)}
        rows.append({"date": str(pd.Timestamp(date).date()), "values": cells})
    return {"industries": [{"code": s["code"], "name": s["name"]} for s in sectors], "rows": rows[::-1], "eligibleStocks": len(closes.columns)}


def align_prices(prices: dict[str, pd.Series], dates: list[str]) -> pd.DataFrame:
    """Missing bars stay missing: we cannot infer a suspension from a failed request."""
    result = pd.DataFrame(prices)
    result.index = pd.to_datetime(result.index).normalize()
    return result.reindex(pd.to_datetime(dates))
