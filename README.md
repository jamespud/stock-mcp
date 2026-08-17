# stock-mcp

MCP server（TypeScript / Node.js）通过 **Yahoo Finance** 和 **Investing.com（GraphQL + TVC）** 获取股票全量信息，持久化到 **外部 MySQL**（通过 `DATABASE_URL` 连接串配置，不随 server 内置），按标的代码查询。

架构上 MCP server 保持轻量：它只是一个薄查询层 + 同步触发器，数据库是完全外部的依赖。

## 快速开始

```bash
npm install
npm run build:all   # TypeScript + Go sidecar

# 0. 配置外部 MySQL 连接（.env）
#    DATABASE_URL=mysql://user:pass@host:3306/stock_mcp
#    本地临时开发库可用 deploy/docker-compose.mysql.yml 起一个：
#    docker compose -f deploy/docker-compose.mysql.yml up -d

# 1. 对配置的数据库初始化表结构
npm run db:init

# 2. 全量同步一只股票（从 2000-01-01 开始拉历史 + 全部基本面）
npm run sync -- --symbol NVDA --full

# 之后增量同步（只拉新增数据）
npm run sync -- --symbol NVDA

# 增量同步并同时拉取 15 分钟线（1m/5m/15m/30m/60m）
npm run sync -- --symbol NVDA --intraday 15m

# 同步所有已入库标的
npm run sync -- --all --full

# 同步全部 GICS 板块 ETF 行情 + 成分股（板块轮动数据）
npm run sync -- --sectors

# 3. 启动 MCP server（stdio）
npm run server
```

## 测试

```bash
# 需要本地 MySQL（默认 127.0.0.1:3306，见 deploy/docker-compose.mysql.yml）且已初始化表结构
npm run test:db    # 查询层：覆盖全部查询函数、LIMIT 绑定回归、边界参数
npm run test:mcp   # 协议层：initialize/tools/list/tools/call 全工具端到端 + stdin 关闭退出
npm test           # 两者一起
```

测试使用独立的 `ZZTEST` 标的，跑完自动清理，不会动已有数据。

## MCP 工具

| 工具 | 说明 |
|---|---|
| `sync_stock` | 全量/增量同步一只股票到 MySQL |
| `search_symbol` | 搜索已入库标的 |
| `get_quote` | 最新行情 + 关键指标 |
| `get_bars` | 历史 K 线（1d/1wk/1mo） |
| `get_profile` | 公司资料 |
| `get_financials` | 三张财务报表 |
| `get_ratios` | 估值/财务比率 |
| `get_dividends` | 分红历史与摘要 |
| `get_analyst_forecast` | 分析师共识与目标价 |
| `get_earnings` | 盈利历史与预测 |
| `get_holders` | 机构持有人 |
| `get_news` | 新闻 |
| `get_options` | 期权链快照（同步入库后查询） |
| `get_option_quote` | 实时拉取期权行情（Yahoo 直连、按需、不依赖本地库）：标的报价 + 可选到期日/行权价/方向过滤 |
| `get_company_events` | 前瞻事件日历：下次财报日 / 电话会 / 除息日 / 派息日（Yahoo calendarEvents + Investing next_release_date） |
| `get_insider_transactions` | 内部人交易：高管/董事买卖、股数、金额（Yahoo insiderTransactions） |
| `get_analyst_actions` | 分析师升级/降级与目标价调整（Yahoo upgradeDowngradeHistory） |
| `get_earnings_trend` | 季度盈利预测趋势：EPS/营收预估、增速、近 7/30/60/90 天修正（Yahoo earningsTrend） |
| `get_recommendation_trend` | 分析师评级趋势（月度 strong buy/buy/hold/sell/strong sell） |
| `get_fund_holders` | 基金持有人（mutual fund ownership，Yahoo fundOwnership） |
| `get_short_interest` | 空头持仓快照：做空股数、short ratio、占流通盘比例（Yahoo defaultKeyStatistics） |
| `get_holder_breakdown` | 持股结构：内部人/机构占比、机构占流通盘、机构数（Yahoo majorHoldersBreakdown） |
| `get_intraday_bars` | 分钟级 K 线（1m/5m/15m/30m/60m，同步入库后查询） |
| `list_sectors` | 板块目录：11 个 GICS 板块 + SPY 基准，映射到 SPDR 板块 ETF |
| `get_sector_performance` | 板块轮动视图：各板块最新价 + 1d/5d/20d 涨跌幅排名 + SPY 基准对比 |
| `get_sector_members` | 板块成分股（板块 ETF topHoldings，含权重） |
| `sync_sectors` | 同步全部板块 ETF 行情（约 30 天 K 线）与成分股 |

## 数据源

- **Yahoo Finance**：K 线（v8 chart）、quoteSummary（需 cookie+crumb）、期权（v7）、新闻（v1 search）、财务（fundamentals-timeseries，免认证）
- **Investing.com**：GraphQL `gql.api.investing.com/graphql`（行情/三表/比率/分红/预测/盈利/公司资料/高管/持有人，免认证）、TVC K 线（carrier token）

## 数据清单（Data Checklist）

面向"关注行情、提前布局"场景，在原有个股基本面基础上新增以下数据维度，全部由 **Yahoo quoteSummary / Investing GraphQL** 现有接口获取：

| 维度 | 表 | 数据源 |
|---|---|---|
| 前瞻事件日历 | `company_events` | Yahoo `calendarEvents` + Investing `next_release_date`（下次财报/除息/派息） |
| 内部人交易 | `insider_transactions` | Yahoo `insiderTransactions` |
| 分析师动作 | `analyst_actions` | Yahoo `upgradeDowngradeHistory`（升级/降级/目标价调整） |
| 盈利预测趋势 | `earnings_trend` | Yahoo `earningsTrend`（季度 EPS/营收预估 + 近 7/30/60/90 天修正） |
| 评级趋势 | `recommendation_trend` | Yahoo `recommendationTrend`（月度评级分布） |
| 基金持有人 | `fund_holders` | Yahoo `fundOwnership` |
| 空头持仓 | `short_interest` | Yahoo `defaultKeyStatistics`（sharesShort/shortRatio/占流通盘） |
| 持股结构 | `holder_breakdown` | Yahoo `majorHoldersBreakdown`（内部人/机构占比） |
| 分钟线 | `intraday_bars` | Yahoo chart v8（1m/5m/15m/30m/60m） |
| 板块目录与轮动 | `sectors` / `sector_members` | GICS 11 板块 + SPY 基准，板块 ETF（XLC..XLU/SPY）行情 + `topHoldings` 成分股权重 |

> 指数 / ETF / 跨资产（如 `^GSPC`、`^VIX`、`SPY`、`TLT`）可直接当作标的同步：Yahoo 原生支持指数行情，Investing 侧失败会被自动跳过，不影响 Yahoo 数据落库。

## 客户端接入示例（Claude Desktop / Cursor / Codex）

```json
{
  "mcpServers": {
    "stock-mcp": {
      "command": "node",
      "args": ["/path/to/stock-mcp/dist/cli.js", "server"]
    }
  }
}
```

## 说明

- 全量同步：从 `BARS_START_DATE`（默认 2000-01-01）拉全部日 K + 全部基本面 + 期权快照 + 新闻 + 数据清单（事件/内部人/分析师/盈利趋势/空头/基金等）。
- 增量同步：按 `sync_state.last_bar_date` 只拉新 K 线，并刷新行情、比率、预测、新闻、期权快照与数据清单。
- 分钟线：`--intraday <1m|5m|15m|30m|60m>` 拉取最近 7 天分钟 K 到 `intraday_bars`（幂等 upsert）。
- 板块：`sync --sectors` 一键同步 11 个 GICS 板块 ETF（XLC..XLU）+ SPY 基准的行情与 `topHoldings` 成分股，`get_sector_performance` 输出板块轮动排名。
- 期权行情：`get_options` 读取同步入库的快照；`get_option_quote` 每次直接从 Yahoo 按需拉取最新报价（含标的现价、可选到期日、行权价、方向过滤），无需先执行同步。
- 所有写入均为幂等 upsert（`INSERT ... ON DUPLICATE KEY UPDATE`），可重复执行。
- 限流已内置（默认 300ms/请求），Yahoo crumb 缓存 25 分钟，TVC token 缓存 25 分钟。

## 关于 investing.com 的 TLS 拦截

investing.com 通过 Cloudflare **TLS 指纹**拦截 Node.js 的请求（HTTP 403），Go 客户端可正常访问。因此项目内置了一个极小的 Go 传输代理 `cmd/gqlproxy`（约 200 行，仅标准库）：

```bash
npm run build:sidecar   # 生成 bin/gqlproxy
```

TS 数据源层默认先试 Node fetch，遇到 403 自动切换到该代理（含持久化 cookie 会话，自动处理 Cloudflare challenge）。从不受指纹拦截的网络访问时无需代理，可设置 `INVESTING_TRANSPORT=node` 强制纯 Node。

```bash
# 完整构建（TypeScript + Go sidecar）
npm run build:all
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | 127.0.0.1/3306/stock/stock123/stock_mcp | MySQL 连接 |
| `USER_AGENT` | Chrome 148 UA | 请求指纹 |
| `REQUEST_DELAY_MS` | 300 | 请求间隔限流 |
| `PROXY_URL` | 无 | 所有 Node fetch 请求使用的 HTTP(S) 代理，例如 `http://127.0.0.1:17890`；Yahoo 在大陆需配置 |
| `BARS_START_DATE` | 2000-01-01 | 全量同步起点 |
| `BARS_PROVIDER` | yahoo | K 线来源（yahoo/investing） |
| `INVESTING_TRANSPORT` | auto | node / go / auto |
| `GQLPROXY_COOKIE_FILE` | .cache/gqlproxy_cookies.txt | sidecar cookie 会话文件 |
