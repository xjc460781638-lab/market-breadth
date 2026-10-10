# 市场宽度

React / ECharts 私有观察网站，AKShare 免费行情采集。新实现及每日汇总公开，原始聚宽脚本未纳入仓库。

## 口径

沪深 A 股（含 ST，不含北交所），当前在市股票构成样本池。取 270 个交易日，剔除任何一天缺失的股票，计算最后 250 日的 close > MA20。行业比例与全市场比例使用 pandas/numpy 银行家取整；行业合计为取整后的行业比例相加。行业成分采用报告日期的申万一级分类回看历史。与聚宽的退市股票、复权和行业覆盖可能不同。

盘中使用前 19 日收盘与最新价；腾讯前复权昨收与新浪昨收不一致的股票暂时剔除，覆盖率同时下降，盘后统一重算历史。停牌或缺失数据不擅自填零、填充或当作正常报价。行业没有有效样本显示缺失，合计也显示缺失。

## 本地

需要 Python 3.11 和 Node >=22.13。`pip install -r collector/requirements.txt`，`python -m unittest collector.test_engine -v`，`python -m collector.run --mode bootstrap`。初始化按股票缓存，可重复运行继续；默认 8 个并发请求；腾讯日线使用与 AKShare 相同的接口进行单窗口读取，已做真实价格逐项对照。使用 `--limit 10` 做真实接口诊断，不输出市场汇总。缓存不提交。

前端使用 `npm run install:ci`，`npm run dev`；Sites 官方构建/发布助手负责 Worker 构建和私有部署。数据库迁移位于 drizzle，绑定 DB；R2 绑定 BUCKET。

## GitHub Actions

公开仓库启用 Market breadth 工作流。首次手动选择 bootstrap。设置 Secrets：SITE_URL（Sites HTTPS 根地址）、SITE_INGEST_TOKEN（与 Sites INGEST_TOKEN 相同）、SITE_SERVICE_TOKEN（Sites 服务访问凭证）。禁止在日志或文件打印凭证。

交易日北京时间 09:35–11:30、13:00–15:00 每 5 分钟计划采集；16:37 盘后刷新。XSHG 日历拒绝非交易日盘中运行；年度日历到期需升级 exchange-calendars，不能用工作日猜测交易日。Actions 免费调度可能延迟、合并或漏跑。连续 10 分钟未更新会在交易时段提示过期。公开仓库长期无活动可能被 GitHub 暂停定时运行，应查看 Actions 状态；不制造保活提交。

只在盘后提交实际汇总成果。盘中通过受保护接口直接写入网站数据库，公开仓库 latest.json 为最近盘后版本。所有网站用户读取须经 Sites 登录；机器写入另需服务凭证和 INGEST_TOKEN。数据写入有结构验证、体积限制、单调时间戳和幂等 revision；读回不一致即报错。

仅使用标准 ubuntu-24.04 免费公开运行器，无付费服务。历史缓存按每日保存，GitHub 自动逐出旧缓存；不上传 Actions 产物。全量盘后复权刷新较慢，不能承诺准点完成。

## 故障处理

采集失败查看 Actions 状态；有效旧结果保留。接口限流可稍后重新执行 final。Secret 失效时更新对应 Secret，Sites 环境变量变更后需重新部署；行情更新无需部署。若覆盖率异常，先检查行业接口、腾讯复权和缺失比例，不用模拟数据替代。停止采集可在 Actions 禁用工作流。

