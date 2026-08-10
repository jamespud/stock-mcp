import { query } from "../db.js";

function rows<T = any>(r: T): T {
  return r;
}

export async function getInstrument(symbol: string) {
  const r = await query<any[]>(
    "SELECT * FROM instruments WHERE symbol = ? OR yahoo_symbol = ?",
    [symbol, symbol]
  );
  return r[0] ?? null;
}

export async function getQuote(symbol: string) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const [bar] = await query<any[]>(
    "SELECT * FROM daily_bars WHERE instrument_id = ? ORDER BY trade_date DESC LIMIT 1",
    [inst.id]
  );
  const [divSummary] = await query<any[]>(
    "SELECT * FROM dividends_summary WHERE instrument_id = ?",
    [inst.id]
  );
  const ratios = await query<any[]>(
    `SELECT metric, value, as_of FROM ratios r
     WHERE instrument_id = ? AND as_of = (SELECT MAX(as_of) FROM ratios WHERE instrument_id = r.instrument_id)
     ORDER BY metric`,
    [inst.id]
  );
  const ratioMap: Record<string, number | null> = {};
  for (const rr of ratios) ratioMap[rr.metric] = rr.value;
  return {
    symbol: inst.symbol,
    name: inst.name,
    exchange: inst.exchange,
    currency: inst.currency,
    latestBar: bar ?? null,
    dividendSummary: divSummary ?? null,
    ratios: ratioMap,
    syncedAt: inst.updated_at,
  };
}

function toDateStr(d: any): string {
  if (typeof d === "string") return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

export async function getBars(symbol: string, interval: "1d" | "1wk" | "1mo", from?: string, to?: string, limit = 1000) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const cond = [];
  const params: any[] = [inst.id];
  if (from) { cond.push("trade_date >= ?"); params.push(from); }
  if (to) { cond.push("trade_date <= ?"); params.push(to); }
  const where = cond.length ? `AND ${cond.join(" AND ")}` : "";
  const bars = await query<any[]>(
    `SELECT trade_date, open, high, low, close, adj_close, volume, source
     FROM daily_bars WHERE instrument_id = ? ${where} ORDER BY trade_date ASC LIMIT ${Math.max(1, Math.min(limit, 10000))}`,
    params
  );
  if (interval === "1d") {
    return bars.map((b) => ({ ...b, trade_date: toDateStr(b.trade_date) }));
  }
  // aggregate weekly / monthly in JS
  const out: any[] = [];
  const keyOf = (d: string) =>
    interval === "1wk"
      ? (() => { const t = new Date(d + "T00:00:00Z"); const day = t.getUTCDay(); const diff = (day + 6) % 7; t.setUTCDate(t.getUTCDate() - diff); return t.toISOString().slice(0, 10); })()
      : d.slice(0, 7);
  const buckets = new Map<string, any>();
  for (const b of bars) {
    const k = keyOf(toDateStr(b.trade_date));
    const cur = buckets.get(k) ?? { period: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0, count: 0 };
    cur.high = Math.max(cur.high ?? -Infinity, b.high ?? -Infinity);
    cur.low = Math.min(cur.low ?? Infinity, b.low ?? Infinity);
    cur.close = b.close;
    cur.volume += b.volume ?? 0;
    cur.count += 1;
    buckets.set(k, cur);
  }
  for (const b of buckets.values()) out.push(b);
  return out;
}

export async function getProfile(symbol: string) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  return {
    symbol: inst.symbol,
    name: inst.name,
    exchange: inst.exchange,
    sector: inst.sector,
    industry: inst.industry,
    businessSummary: inst.business_summary,
    employees: inst.employees,
    website: inst.website,
    address: inst.street_address,
    city: inst.city,
    country: inst.country,
    phone: inst.phone,
  };
}

export async function getFinancials(symbol: string, statementType?: string, periodType?: string, limit = 8) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const cond = ["instrument_id = ?"];
  const params: any[] = [inst.id];
  if (statementType) { cond.push("statement_type = ?"); params.push(statementType.toUpperCase()); }
  if (periodType) { cond.push("period_type = ?"); params.push(periodType.toUpperCase()); }
  const rows = await query<any[]>(
    `SELECT statement_type, period_type, period_end, field_name, value, currency, source
     FROM financial_statements WHERE ${cond.join(" AND ")}
     ORDER BY period_end DESC, field_name LIMIT ${Math.max(1, Math.min(limit * 40, 5000))}`,
    params
  );
  // pivot: period_end -> { field: value }
  const pivoted = new Map<string, any>();
  for (const r of rows) {
    const key = `${r.statement_type}|${r.period_type}|${r.period_end}`;
    const entry = pivoted.get(key) ?? { statementType: r.statement_type, periodType: r.period_type, periodEnd: r.period_end, fields: {}, source: r.source };
    entry.fields[r.field_name] = r.value;
    pivoted.set(key, entry);
  }
  return { symbol: inst.symbol, periods: [...pivoted.values()] };
}

export async function getRatios(symbol: string) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const rows = await query<any[]>(
    `SELECT metric, value, as_of, source FROM ratios r
     WHERE instrument_id = ? AND as_of = (SELECT MAX(as_of) FROM ratios WHERE instrument_id = r.instrument_id)
     ORDER BY metric`,
    [inst.id]
  );
  return { symbol: inst.symbol, asOf: rows[0]?.as_of ?? null, ratios: rows };
}

export async function getDividends(symbol: string) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const [summary] = await query<any[]>("SELECT * FROM dividends_summary WHERE instrument_id = ?", [inst.id]);
  const list = await query<any[]>(
    "SELECT ex_date, amount, pay_date, ttm_dividend, yield_pct, source FROM dividends WHERE instrument_id = ? ORDER BY ex_date DESC LIMIT 50",
    [inst.id]
  );
  return { symbol: inst.symbol, summary: summary ?? null, dividends: list };
}

export async function getForecast(symbol: string) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const rows = await query<any[]>(
    "SELECT * FROM analyst_forecasts WHERE instrument_id = ? ORDER BY as_of DESC LIMIT 5",
    [inst.id]
  );
  return { symbol: inst.symbol, forecasts: rows };
}

export async function getEarnings(symbol: string) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const rows = await query<any[]>(
    "SELECT report_year, report_month, report_date, eps_actual, eps_forecast, revenue_actual, revenue_forecast, source FROM earnings WHERE instrument_id = ? ORDER BY report_year DESC, report_month DESC LIMIT 20",
    [inst.id]
  );
  return { symbol: inst.symbol, earnings: rows };
}

export async function getHolders(symbol: string, limit = 20) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const rows = await query<any[]>(
    `SELECT h.* FROM holders h
     WHERE h.instrument_id = ?
     ORDER BY h.holding_date DESC, h.percent_of_shares DESC LIMIT ${Math.max(1, Math.min(limit, 100))}`,
    [inst.id]
  );
  return { symbol: inst.symbol, holders: rows };
}

export async function getNews(symbol: string, limit = 20) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const rows = await query<any[]>(
    `SELECT id, title, link, publisher, published_at, news_type FROM news
     WHERE instrument_id = ? ORDER BY published_at DESC LIMIT ${Math.max(1, Math.min(limit, 100))}`,
    [inst.id]
  );
  return { symbol: inst.symbol, news: rows };
}

export async function getOptions(symbol: string, expiration?: string) {
  const inst = await getInstrument(symbol);
  if (!inst) return null;
  const params: any[] = [inst.id];
  let extra = "";
  if (expiration) { extra = "AND expiration = ?"; params.push(expiration); }
  const rows = await query<any[]>(
    `SELECT expiration, option_type, strike, last_price, bid, ask, volume, open_interest, implied_vol, in_the_money, currency, updated_at
     FROM options WHERE instrument_id = ? ${extra} ORDER BY expiration, strike LIMIT 5000`,
    params
  );
  const expirations = await query<any[]>(
    "SELECT DISTINCT expiration FROM options WHERE instrument_id = ? ORDER BY expiration",
    [inst.id]
  );
  return {
    symbol: inst.symbol,
    expirations: expirations.map((r) => r.expiration),
    legs: rows,
  };
}

export async function searchSymbols(q: string, limit = 20) {
  const like = `%${q}%`;
  return rows(
    await query<any[]>(
      `SELECT id, symbol, name, exchange, currency FROM instruments
       WHERE symbol LIKE ? OR name LIKE ? ORDER BY symbol LIMIT ${Math.max(1, Math.min(limit, 100))}`,
      [like, like]
    )
  );
}
