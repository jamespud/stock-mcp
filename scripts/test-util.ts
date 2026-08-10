import { getPool } from "../src/db.js";

export const TEST_SYMBOL = "ZZTEST";
export const TEST_NAME = "ZZ Test Corp";

const CHILD_TABLES = [
  "sync_state",
  "options",
  "holders",
  "earnings",
  "analyst_forecasts",
  "dividends_summary",
  "dividends",
  "ratios",
  "financial_statements",
  "daily_bars",
  "news",
];

export async function cleanupTestData(): Promise<void> {
  const pool = getPool();
  for (const t of CHILD_TABLES) {
    await pool.query(
      `DELETE FROM ${t} WHERE instrument_id = (SELECT id FROM instruments WHERE symbol = ?)`,
      [TEST_SYMBOL]
    );
  }
  await pool.query("DELETE FROM instruments WHERE symbol = ?", [TEST_SYMBOL]);
}

export async function seedTestData(): Promise<number> {
  const pool = getPool();
  await cleanupTestData();

  const [ins] = await pool.query(
    `INSERT INTO instruments (symbol, name, exchange, currency, yahoo_symbol, sector, industry)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [TEST_SYMBOL, TEST_NAME, "TEST", "USD", "ZZTEST.Y", "Technology", "Testing"]
  );
  const id = Number((ins as any).insertId);

  const bars = [
    [id, "2026-08-01", 10, 11, 9.5, 10.5, 10.5, 1000],
    [id, "2026-08-02", 10.5, 12, 10, 11.5, 11.5, 1200],
    [id, "2026-08-03", 11.5, 13, 11, 12.5, 12.5, 1500],
  ];
  for (const b of bars) {
    await pool.query(
      `INSERT INTO daily_bars (instrument_id, trade_date, open, high, low, close, adj_close, volume, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'yahoo')`,
      b
    );
  }

  const stmts = [
    ["INCOME", "ANNUAL", "2025-12-31", "total_revenue", 1000],
    ["INCOME", "ANNUAL", "2025-12-31", "net_income", 100],
    ["BALANCE", "ANNUAL", "2025-12-31", "total_assets", 5000],
    ["CASHFLOW", "ANNUAL", "2025-12-31", "operating_cash_flow", 200],
  ];
  for (const s of stmts) {
    await pool.query(
      `INSERT INTO financial_statements (instrument_id, statement_type, period_type, period_end, field_name, value, currency, source)
       VALUES (?, ?, ?, ?, ?, ?, 'USD', 'investing')`,
      [id, ...s]
    );
  }

  await pool.query(
    `INSERT INTO ratios (instrument_id, metric, as_of, value, source)
     VALUES (?, 'pe', '2026-08-01', ?, 'yahoo'), (?, 'ps', '2026-08-01', ?, 'yahoo')`,
    [id, 25.5, id, 5.2]
  );

  await pool.query(
    `INSERT INTO dividends (instrument_id, ex_date, amount, pay_date, ttm_dividend, yield_pct, source)
     VALUES (?, '2026-06-01', ?, '2026-06-15', ?, ?, 'investing')`,
    [id, 0.1, 0.4, 0.5]
  );

  await pool.query(
    `INSERT INTO dividends_summary (instrument_id, dividend_yield, payout_ratio, annualized_payout, five_year_growth, next_dividend_date, source)
     VALUES (?, ?, ?, ?, ?, '2026-09-01', 'investing')`,
    [id, 0.5, 0.2, 0.4, 5]
  );

  await pool.query(
    `INSERT INTO analyst_forecasts (instrument_id, as_of, consensus, n_buy, n_hold, n_sell, n_estimates, target_high, target_low, target_mean, source)
     VALUES (?, '2026-08-01 00:00:00', 'BUY', 10, 2, 1, 13, 150, 100, 125, 'investing')`,
    [id]
  );

  await pool.query(
    `INSERT INTO earnings (instrument_id, report_year, report_month, report_date, eps_actual, eps_forecast, revenue_actual, revenue_forecast, source)
     VALUES (?, 2025, 12, '2026-02-15', 1.2, 1.1, 1000, 900, 'investing')`,
    [id]
  );

  await pool.query(
    `INSERT INTO holders (instrument_id, holding_date, owner_name, shares_held, percent_of_shares, percent_of_portfolio, shares_changed, total_value, source)
     VALUES (?, '2026-06-30', 'Vanguard Group', 1000000, 8.5, 3.2, 10000, 120000000, 'investing')`,
    [id]
  );

  await pool.query(
    `INSERT INTO options (instrument_id, contract_symbol, expiration, option_type, strike, last_price, bid, ask, volume, open_interest, implied_vol, in_the_money, currency, source)
     VALUES (?, 'ZZTEST250919C00100000', '2026-09-19', 'CALL', 100, 2.5, 2.4, 2.6, 100, 50, 0.35, 1, 'USD', 'yahoo'),
            (?, 'ZZTEST250919P00100000', '2026-09-19', 'PUT', 100, 1.5, 1.4, 1.6, 80, 40, 0.32, 0, 'USD', 'yahoo')`,
    [id, id]
  );

  await pool.query(
    `INSERT INTO news (id, instrument_id, symbols, title, link, publisher, published_at, news_type)
     VALUES ('zztest-news-1', ?, 'ZZTEST', 'Test News 1', 'https://example.com/1', 'Test Publisher', '2026-08-01 10:00:00', 'NEWS'),
            ('zztest-news-2', ?, 'ZZTEST', 'Test News 2', 'https://example.com/2', 'Test Publisher', '2026-08-02 10:00:00', 'NEWS')`,
    [id, id]
  );

  await pool.query(
    `INSERT INTO sync_state (instrument_id, full_synced, last_full_sync_at, last_incremental_at, last_bar_date, last_quote_at, error_count)
     VALUES (?, 1, '2026-08-01 00:00:00', '2026-08-03 00:00:00', '2026-08-03', '2026-08-03 00:00:00', 0)`,
    [id]
  );

  return id;
}
