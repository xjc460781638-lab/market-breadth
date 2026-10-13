# 市场宽度观察站

唯一行情来源：同花顺 iFinD HTTP 接口。

旧来源的采集代码、自动任务、当前汇总文件和行情缓存已移除。旧格式的写入与读取均被拒绝，不会自动回退到其他来源。iFinD 全站采集迁移尚未完成，未初始化模块显示等待数据。

## 本地历史缓存

凭证放在忽略的 `.env.ifind.local`，键名 `IFIND_REFRESH_TOKEN`，不进入仓库或日志。

持久日线缓存：`.cache/ifind/history.sqlite3`。分钟缓存：`.cache/ifind/flows/`。已完成日期直接复用，只补缺口与新增尾段；前复权缓存必须带固定基点，避免混合复权基准。

已验证的本地采集：

```sh
python -m collector.ifind_datasets --start 2026-09-01 --end 2026-10-12
python -m unittest collector.test_ifind_client collector.test_ifind_cache collector.test_ifind_datasets
```

全市场 MA20 计算引擎保留在 `collector/engine.py`，使用严格大于和银行家取整，缺失不填零。完整 250 日初始化仍待确定账号额度安排。
