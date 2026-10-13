# 市场宽度观察站

唯一数据源：同花顺 iFinD HTTP。网站保持现有私有访问；公开仓库只保存代码，凭证、原始行情和缓存不提交。

## 本地初始化与刷新

```powershell
.venv/Scripts/python.exe -m collector.ifind_collect --initialize
.venv/Scripts/python.exe -m collector.ifind_worker --publish-cache
powershell -ExecutionPolicy Bypass -File scripts/start-ifind-worker.ps1
```

初始化最近30个交易日；市场宽度另外缓存20个前置交易日用于 MA20。期初已上市、全窗口历史完整的沪深A股（含ST）；当前股票目录可能不含期间退市股票。申万一级行业由 iFinD 提供。

- `.cache/ifind/history.sqlite3`：持久日线及覆盖区间，按固定复权基点隔离序列。
- `.cache/ifind/flows/YYYY-MM-DD/`：原始分钟记录。
- `.cache/ifind/rankings/`：各交易日的板块日终资金排名。
- `.cache/ifind/reports/`：可发布的网站汇总。
- `.env.ifind.local`：IFIND_REFRESH_TOKEN。
- `.env.collector.local`：SITE_URL、SITE_INGEST_TOKEN、SITE_BYPASS_TOKEN（仅发往本网站）。

页面点击“获取最新数据”后向本机工作进程提交任务。工作进程先保存本地缓存，再同步网站。电脑关机、睡眠或断网时无法采集；页面显示离线提示并保留结果。重启电脑后重新运行启动脚本。重复启动由文件锁拒绝。后台只检查待办刷新请求，不自动消耗行情额度。

按模块立即执行一次：

```powershell
.venv/Scripts/python.exe -m collector.ifind_worker --once breadth
.venv/Scripts/python.exe -m collector.ifind_worker --once analytics
.venv/Scripts/python.exe -m collector.ifind_worker --once flow-concept
```

已完成的历史日复用缓存，只补缺口与新增区间。当天未最终确认的行情不写入永久日线覆盖区间；盘中采用最新价与前19日收盘价进行估算，失败保留上一份结果。两融发布存在延迟，未公布日期不记零、不标记已缓存。

## 资金流覆盖与额度

免费账户高频序列额度150万单元格/月。保存30日全部可用板块日终排名，预加载每天流入前5、流出前5的分钟线；其余曲线可在页面勾选后手动刷新补取并永久缓存。概念包含885和886代码段；行业采用881代码段。固定交易时间轴9:30—11:30、13:00—15:00；13:01用于缺失的13:00节点，保留真实采样时间。

指数主力资金字段并非全部可用。沪深300、中证500、中证1000、中证2000或部分历史日未提供有效字段时显示缺失，不以零或其他来源代替。指数分时净流入使用同花顺主动大单、超大单买卖差额累计，与同花顺部分日终排名字段可能存在口径差异；曲线和显示的指数净值使用同一累计口径。

当前生产配置需要可用的网站服务凭证。若工作日志持续提示网站401，更新本机服务凭证；若iFinD账号续期或权限变更，按官方要求更新本地refresh token。所有凭证文件均被Git忽略。

## 验证

```powershell
.venv/Scripts/python.exe -m unittest discover -s collector -p 'test_*.py'
node --experimental-strip-types --test tests/ifind-report.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```
