import "dotenv/config";

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function buildDatabaseUrl(): string {
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = num(process.env.DB_PORT, 3306);
  const user = process.env.DB_USER ?? "stock";
  const password = process.env.DB_PASSWORD ?? "stock123";
  const database = process.env.DB_NAME ?? "stock_mcp";
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export const config = {
  /** External MySQL connection string, e.g. mysql://user:pass@host:3306/stock_mcp */
  databaseUrl: process.env.DATABASE_URL ?? buildDatabaseUrl(),
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? "stock",
    password: process.env.DB_PASSWORD ?? "stock123",
    database: process.env.DB_NAME ?? "stock_mcp",
  },
  userAgent:
    process.env.USER_AGENT ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  requestDelayMs: num(process.env.REQUEST_DELAY_MS, 300),
  barsStartDate: process.env.BARS_START_DATE ?? "2000-01-01",
  barsProvider: (process.env.BARS_PROVIDER ?? "yahoo") as "yahoo" | "investing",
  newsCount: num(process.env.NEWS_COUNT, 20),
  /** Optional HTTP(S) proxy for all Node fetch requests, e.g. http://127.0.0.1:17890 */
  proxyUrl: process.env.PROXY_URL?.trim() || null,
};
