import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { syncOne } from "../services/sync.service.js";
import * as q from "../services/query.service.js";
import { closeDb } from "../db.js";

const server = new McpServer({
  name: "stock-mcp",
  version: "0.1.0",
});

function text(data: unknown): any {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function guard(fn: () => Promise<unknown>): Promise<any> {
  try {
    return text(await fn());
  } catch (e: any) {
    return { isError: true, content: [{ type: "text" as const, text: `ERROR: ${e.message}` }] };
  }
}

server.tool(
  "search_symbol",
  "Search locally stored instruments by symbol or name.",
  { query: z.string().describe("Symbol or name fragment, e.g. NVDA or NVIDIA") },
  async ({ query: qry }) => guard(() => q.searchSymbols(qry))
);

server.tool(
  "get_quote",
  "Get latest quote for a stock: price, 52-week range, key ratios, dividend summary.",
  { symbol: z.string().describe("Ticker, e.g. NVDA") },
  async ({ symbol }) =>
    guard(async () => {
      const r = await q.getQuote(symbol);
      if (!r) throw new Error(`instrument not found in DB: ${symbol} (run sync_stock first)`);
      return r;
    })
);

server.tool(
  "get_bars",
  "Get historical OHLCV bars from the database (1d/1wk/1mo).",
  {
    symbol: z.string().describe("Ticker, e.g. NVDA"),
    interval: z.enum(["1d", "1wk", "1mo"]).default("1d"),
    from: z.string().optional().describe("Start date YYYY-MM-DD"),
    to: z.string().optional().describe("End date YYYY-MM-DD"),
    limit: z.number().int().min(1).max(10000).optional().default(1000),
  },
  async ({ symbol, interval, from, to, limit }) =>
    guard(async () => {
      const r = await q.getBars(symbol, interval, from, to, limit);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_profile",
  "Get company profile: business summary, sector, industry, employees, address, contact info.",
  { symbol: z.string().describe("Ticker, e.g. NVDA") },
  async ({ symbol }) =>
    guard(async () => {
      const r = await q.getProfile(symbol);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_financials",
  "Get financial statements (income statement, balance sheet, cash flow) from the database.",
  {
    symbol: z.string().describe("Ticker, e.g. NVDA"),
    statement: z.enum(["INCOME", "BALANCE", "CASHFLOW"]).optional(),
    period: z.enum(["ANNUAL", "QUARTERLY"]).optional(),
  },
  async ({ symbol, statement, period }) =>
    guard(async () => {
      const r = await q.getFinancials(symbol, statement, period);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_ratios",
  "Get valuation and financial ratios (PE, PS, PB, margins, ROE, beta, etc.).",
  { symbol: z.string().describe("Ticker, e.g. NVDA") },
  async ({ symbol }) =>
    guard(async () => {
      const r = await q.getRatios(symbol);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_dividends",
  "Get dividend history and dividend summary for a stock.",
  { symbol: z.string().describe("Ticker, e.g. NVDA") },
  async ({ symbol }) =>
    guard(async () => {
      const r = await q.getDividends(symbol);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_analyst_forecast",
  "Get analyst consensus, buy/hold/sell counts and price targets.",
  { symbol: z.string().describe("Ticker, e.g. NVDA") },
  async ({ symbol }) =>
    guard(async () => {
      const r = await q.getForecast(symbol);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_earnings",
  "Get earnings history and forecasts (EPS and revenue, actual vs estimate).",
  { symbol: z.string().describe("Ticker, e.g. NVDA") },
  async ({ symbol }) =>
    guard(async () => {
      const r = await q.getEarnings(symbol);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_holders",
  "Get institutional holders and ownership data.",
  {
    symbol: z.string().describe("Ticker, e.g. NVDA"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  },
  async ({ symbol, limit }) =>
    guard(async () => {
      const r = await q.getHolders(symbol, limit);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_news",
  "Get recent news for a stock.",
  {
    symbol: z.string().describe("Ticker, e.g. NVDA"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  },
  async ({ symbol, limit }) =>
    guard(async () => {
      const r = await q.getNews(symbol, limit);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "get_options",
  "Get the latest options chain snapshot for a stock (from Yahoo).",
  {
    symbol: z.string().describe("Ticker, e.g. NVDA"),
    expiration: z.string().optional().describe("Expiration date YYYY-MM-DD"),
  },
  async ({ symbol, expiration }) =>
    guard(async () => {
      const r = await q.getOptions(symbol, expiration);
      if (!r) throw new Error(`instrument not found in DB: ${symbol}`);
      return r;
    })
);

server.tool(
  "sync_stock",
  "Sync a stock from providers into the local MySQL database. full = complete history from 2000; incremental = only new data.",
  {
    symbol: z.string().describe("Ticker, e.g. NVDA"),
    mode: z.enum(["incremental", "full"]).default("incremental"),
  },
  async ({ symbol, mode }) =>
    guard(async () => {
      const r = await syncOne(symbol, { full: mode === "full" });
      return { synced: symbol, mode, ...r };
    })
);

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  // Exit when the client closes stdin. The SDK's stdio transport does not 
  // wire stdin 'end'/'close' to onclose, so the open MySQL pool would
  // otherwise keep the process alive and Close() would hang.
  const shutdown = async () => {
    await closeDb();
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  await server.connect(transport);
  process.on("SIGINT", async () => {
    await closeDb();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await closeDb();
    process.exit(0);
  });
}
