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

# 同步所有已入库标的
npm run sync -- --all --full

# 3. 启动 MCP server（stdio）
npm run server
```

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
| `get_options` | 期权链快照 |

## 数据源

- **Yahoo Finance**：K 线（v8 chart）、quoteSummary（需 cookie+crumb）、期权（v7）、新闻（v1 search）、财务（fundamentals-timeseries，免认证）
- **Investing.com**：GraphQL `gql.api.investing.com/graphql`（行情/三表/比率/分红/预测/盈利/公司资料/高管/持有人，免认证）、TVC K 线（carrier token）

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

- 全量同步：从 `BARS_START_DATE`（默认 2000-01-01）拉全部日 K + 全部基本面 + 期权快照 + 新闻。
- 增量同步：按 `sync_state.last_bar_date` 只拉新 K 线，并刷新行情、比率、预测、新闻、期权快照。
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
| `BARS_START_DATE` | 2000-01-01 | 全量同步起点 |
| `BARS_PROVIDER` | yahoo | K 线来源（yahoo/investing） |
| `INVESTING_TRANSPORT` | auto | node / go / auto |
| `GQLPROXY_COOKIE_FILE` | .cache/gqlproxy_cookies.txt | sidecar cookie 会话文件 |
