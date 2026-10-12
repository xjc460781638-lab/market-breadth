# 市场宽度

[私有网站](https://market-breadth-observatory-261010.xjc460781638.chatgpt.site) · [公开仓库](https://github.com/xjc460781638-lab/market-breadth) · [采集任务状态](https://github.com/xjc460781638-lab/market-breadth/actions/workflows/collect.yml)

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

总览“刷新数据”会读取当日 MA20 计算基准，通过浏览器直接获取东方财富沪深 A 股最新报价，然后在登录保护的服务器重新计算 250 日行业宽度、全市场占比和合计，并更新热力图与趋势。加载页面和五分钟自动读取仍只读取已保存成果。手动采集显示批次进度，报价超过十分钟、缺失、非有效价格或昨收与复权基准不一致的股票均剔除，实际覆盖率同步显示；不足1000只有效样本时保留原数据。每分钟最多保存一次。手动刷新使用东方财富报价，定时采集使用新浪报价，报告中注明来源差异。

`collector.run` 每轮成功采集后同步私有 R2 的逐股计算基准；盘后为下一交易日准备基准。基准包含269个完整历史交易日筛选结果、前19日收盘价合计和249日严格大于MA20的判定。临界分价位预先沿用 pandas rolling 的精确比较，避免浮点误差改变严格大于结果；比例采用原脚本的四舍六入五成双。全250日使用本次同一有效样本，缺失不填零。历史基准未就绪时明确提示，不能用过期基准计算新交易日；可在已恢复历史缓存的环境运行 `python -m collector.refresh_basis` 补传当前基准。基准仅保存在缓存和私有网站，不提交逐股缓存到公开仓库。

验算：生成基准后运行 `python -m scripts.test-breadth-parity`，对照原 Python 引擎验证250日所有行业、全市场和合计，覆盖缺失报价及除权基准不一致的排除情况。

采集失败查看 Actions 状态；有效旧结果保留。接口限流可稍后重新执行 final。Secret 失效时更新对应 Secret，Sites 环境变量变更后需重新部署；行情更新无需部署。若覆盖率异常，先检查行业接口、腾讯复权和缺失比例，不用模拟数据替代。停止采集可在 Actions 禁用工作流。


## 新增市场观察模块

- 成交额比值：**中证2000（932000）成交额 / 沪深300（399300）成交额**，10日简单移动平均，严格大于2标记；保留最多3000交易日。用户参考脚本的399303实际是国证2000，按用户确认改用932000，因此不是原脚本指数结果的直接复刻。发布日前历史可能为数据源回溯序列。成交额以元保存，显示原值时换算亿元；缺失或分母为零不计算比值，缺失窗口不计算均线。
- 当日资金流向：东方财富沪深大盘分时接口，主力、超大单、大单、中单、小单的累计净流入，单位亿元。只展示源站提供的完整日期；休市显示最近交易日，交易时段源时间或采集时间超过10分钟提示过期。主力按订单大小统计，不代表账户资金余额。
- 两融：东方财富“融资融券账户统计”日频汇总，融资余额、融券余额及总余额（亿元），对照同一统计记录中的上证指数（点）。最多500日，按照披露时间更新，不声称盘中实时。

三个图表均支持底部滑块拖动与图内缩放、图例切换及CSV导出。比值/两融默认最近250日；分时默认完整交易日。

`collector/analytics.py` 与市场宽度独立，`Market analytics` 工作流盘中每5分钟尽力更新资金流，16:47和20:47重取日线和两融；交易日历筛选休市。标准公开仓库 Linux 运行器，不启用付费资源。数据通过同一组 Secrets 同步到私有站的 `/api/analytics/ingest`，并由 `/api/analytics/readback` 验证版本。每个模块独立保留最近有效数据，失败不清空历史。盘中缓存约1 MiB；每日公开实际统计结果在 `data/analytics.json`。

手工补采：Actions → Market analytics → Run workflow → bootstrap；`dry_run=true` 只验证并保存数据，不写网站。`sync` 使用缓存或仓库现有数据重新同步。失败时先看每个模块的状态及数据时间，再手工重跑；不要替换成模拟序列。

来源口径：[中证2000指数资料](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/932000factsheet.pdf)、[东方财富大盘资金流](https://data.eastmoney.com/zjlx/dpzjlx.html)、[融资融券账户统计](https://data.eastmoney.com/rzrq/zhtjday.html)。
