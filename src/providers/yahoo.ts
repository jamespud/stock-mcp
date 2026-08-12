import { httpJson, httpText, HttpError } from "./http.js";
import type { Bar, Dividend, FinancialField, NewsItem, OptionChain, OptionQuote, RatioValue } from "./types.js";

const CHART_HOST = "https://query1.finance.yahoo.com";
const COOKIE_URL = "https://fc.yahoo.com/";
const CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const CRUMB_TTL_MS = 25 * 60 * 1000;

interface CrumbCache {
  cookie: string;
  crumb: string;
  expiresAt: number;
}
let crumbCache: CrumbCache | null = null;

async function refreshCrumb(): Promise<CrumbCache> {
  const cookieRes = await fetch(COOKIE_URL, { headers: { "user-agent": process.env.USER_AGENT ?? "" } });
  await cookieRes.text();
  if (cookieRes.status >= 500) throw new Error(`yahoo cookie HTTP ${cookieRes.status}`);
  const cookie = cookieRes.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("yahoo: no cookies from fc.yahoo.com");

  const crumb = (await httpText(CRUMB_URL, { headers: { cookie } })).trim();
  if (!crumb) throw new Error("yahoo: empty crumb");
  crumbCache = { cookie, crumb, expiresAt: Date.now() + CRUMB_TTL_MS };
  return crumbCache;
}

async function auth(): Promise<CrumbCache> {
  if (crumbCache && Date.now() < crumbCache.expiresAt) return crumbCache;
  return refreshCrumb();
}

async function authedGet<T>(url: string, retry = true): Promise<T> {
  const c = await auth();
  try {
    return await httpJson<T>(url, { headers: { cookie: c.cookie } });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401 && retry) {
      crumbCache = null;
      const c2 = await auth();
      const u = new URL(url);
      u.searchParams.set("crumb", c2.crumb);
      return httpJson<T>(u.toString(), { headers: { cookie: c2.cookie } });
    }
    throw err;
  }
}

// ── chart / bars ────────────────────────────────────────────────

const SECONDS_PER_POINT: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "60m": 3600,
  "1d": 86400,
  "1wk": 7 * 86400,
  "1mo": 30 * 86400,
};

export async function fetchYahooBars(
  symbol: string,
  interval: "1d" | "1wk" | "1mo" | "60m" | "15m" | "5m" | "1m",
  from: string,
  to: string
): Promise<Bar[]> {
  const secPerPoint = SECONDS_PER_POINT[interval] ?? 86400;
  const start = Math.floor(new Date(from + "T00:00:00Z").getTime() / 1000);
  const end = Math.floor(new Date(to + "T23:59:59Z").getTime() / 1000);
  const out: Bar[] = [];
  let cur = start;
  const CHUNK = 1500;
  while (cur < end) {
    const chunkEnd = Math.min(cur + CHUNK * secPerPoint, end);
    const url = `${CHART_HOST}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${cur}&period2=${chunkEnd}&includePrePost=false`;
    const resp = await httpJson<any>(url);
    if (resp.chart?.error) throw new Error(`yahoo chart: ${resp.chart.error.description}`);
    const res = resp.chart?.result?.[0];
    if (!res) break;
    const q = res.indicators?.quote?.[0] ?? {};
    const adj = res.indicators?.adjclose?.[0]?.adjclose ?? [];
    for (let i = 0; i < (res.timestamp?.length ?? 0); i++) {
      if (q.close?.[i] == null) continue;
      out.push({
        date: new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10),
        open: q.open?.[i] ?? null,
        high: q.high?.[i] ?? null,
        low: q.low?.[i] ?? null,
        close: q.close[i] ?? null,
        adjClose: adj[i] ?? null,
        volume: q.volume?.[i] ?? null,
        source: "yahoo",
      });
    }
    const lastTs = res.timestamp?.[res.timestamp.length - 1];
    if (!lastTs || lastTs <= cur) cur = chunkEnd + 1;
    else cur = (Math.floor(lastTs / 86400) + 1) * 86400; // advance to next UTC day to avoid dupes
  }
  // dedupe by date (keep last occurrence)
  const byDate = new Map<string, Bar>();
  for (const b of out) byDate.set(b.date, b);
  return [...byDate.values()];
}

// ── quoteSummary ────────────────────────────────────────────────

const SUMMARY_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
  "quoteType",
  "calendarEvents",
  "earnings",
  "recommendationTrend",
  "earningsTrend",
  "institutionOwnership",
  "fundOwnership",
  "majorHoldersBreakdown",
  "insiderTransactions",
  "upgradeDowngradeHistory",
  "summaryProfile",
  "esgScores",
].join(",");

export interface YahooSummary {
  raw: any;
  modules: Record<string, any>;
}

export async function fetchYahooSummary(symbol: string): Promise<YahooSummary> {
  const c = await auth();
  const url = `${CHART_HOST}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${SUMMARY_MODULES}&crumb=${encodeURIComponent(c.crumb)}&formatted=false&lang=en-US&region=US`;
  const resp = await authedGet<any>(url);
  const result = resp.quoteSummary?.result?.[0];
  if (resp.quoteSummary?.error || !result) {
    throw new Error(`yahoo quoteSummary: ${JSON.stringify(resp.quoteSummary?.error ?? "no result")}`);
  }
  return { raw: resp, modules: result };
}

// ── options ─────────────────────────────────────────────────────

async function fetchYahooOptionChainRaw(symbol: string, dateUnix?: number): Promise<any> {
  const c = await auth();
  let url = `${CHART_HOST}/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(c.crumb)}&formatted=false&lang=en-US&region=US`;
  if (dateUnix) url += `&date=${dateUnix}`;
  const resp = await authedGet<any>(url);
  if (resp.optionChain?.error) {
    throw new Error(`yahoo options: ${JSON.stringify(resp.optionChain.error)}`);
  }
  const r = resp.optionChain?.result?.[0];
  if (!r) throw new Error(`yahoo options: no result for ${symbol}`);
  return r;
}

function toDateStr(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function parseOptionQuote(l: any, expiration: string, optionType: "CALL" | "PUT"): OptionQuote {
  return {
    contractSymbol: l.contractSymbol,
    expiration,
    optionType,
    strike: l.strike,
    lastPrice: l.lastPrice ?? null,
    change: l.change ?? null,
    percentChange: l.percentChange ?? null,
    bid: l.bid ?? null,
    ask: l.ask ?? null,
    bidSize: l.bidSize ?? null,
    askSize: l.askSize ?? null,
    volume: l.volume ?? null,
    openInterest: l.openInterest ?? null,
    impliedVol: l.impliedVolatility ?? null,
    inTheMoney: l.inTheMoney ?? null,
    lastTradeDate: l.lastTradeDate ? new Date(l.lastTradeDate * 1000).toISOString() : null,
    currency: l.currency ?? null,
  };
}

export async function fetchYahooOptions(symbol: string, dateUnix?: number): Promise<OptionQuote[]> {
  const r = await fetchYahooOptionChainRaw(symbol, dateUnix);
  const legs: OptionQuote[] = [];
  for (const g of r.options ?? []) {
    const expiration = toDateStr(g.expirationDate);
    for (const l of g.calls ?? []) legs.push(parseOptionQuote(l, expiration, "CALL"));
    for (const l of g.puts ?? []) legs.push(parseOptionQuote(l, expiration, "PUT"));
  }
  return legs;
}

/** Live options chain from Yahoo (on-demand, no DB): underlying quote, expirations, strikes and per-contract quotes. */
export async function fetchYahooOptionChain(symbol: string, dateUnix?: number): Promise<OptionChain> {
  const r = await fetchYahooOptionChainRaw(symbol, dateUnix);
  const q = r.quote ?? {};
  const legs: OptionQuote[] = [];
  for (const g of r.options ?? []) {
    const expiration = toDateStr(g.expirationDate);
    for (const l of g.calls ?? []) legs.push(parseOptionQuote(l, expiration, "CALL"));
    for (const l of g.puts ?? []) legs.push(parseOptionQuote(l, expiration, "PUT"));
  }
  return {
    symbol: r.underlyingSymbol ?? symbol,
    asOf: new Date().toISOString(),
    underlying: {
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      currency: q.currency ?? null,
      marketState: q.marketState ?? null,
    },
    expirations: (r.expirationDates ?? []).map((d: number) => toDateStr(d)),
    strikes: r.strikes ?? [],
    legs,
  };
}

// ── news / search ───────────────────────────────────────────────

export async function fetchYahooNews(symbol: string, count: number): Promise<NewsItem[]> {
  const resp = await httpJson<any>(`${CHART_HOST}/v1/finance/search?q=${encodeURIComponent(symbol)}&news_count=${count}`);
  const items: NewsItem[] = [];
  for (const n of resp.news ?? []) {
    items.push({
      id: String(n.uuid ?? n.id ?? `${n.providerPublishTime}-${n.title}`),
      symbols: symbol,
      title: n.title ?? "",
      link: n.link ?? null,
      publisher: n.publisher ?? null,
      publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 19).replace("T", " ") : null,
      type: n.type ?? null,
    });
  }
  return items;
}

// ── fundamentals time series (no auth) ──────────────────────────

export async function fetchYahooFundamentals(
  symbol: string,
  types: string[]
): Promise<FinancialField[]> {
  const url = `${CHART_HOST}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types.join(",")}`;
  const resp = await httpJson<any>(url);
  const fields: FinancialField[] = [];
  for (const result of resp.timeseries?.result ?? []) {
    const typeName: string = result.meta?.type?.[0] ?? "";
    const annual = typeName.startsWith("annual");
    const periodType: "ANNUAL" | "QUARTERLY" = annual ? "ANNUAL" : "QUARTERLY";
    const statementType = typeName.includes("TotalRevenue") || typeName.includes("NetIncome")
      ? "INCOME"
      : typeName.includes("TotalAssets") || typeName.includes("TotalLiabilities") || typeName.includes("StockholdersEquity")
        ? "BALANCE"
        : "CASHFLOW";
    const key = Object.keys(result).find((k) => k !== "meta" && k !== "timestamp");
    if (!key) continue;
    const fieldName = humanizeField(typeName);
    for (const item of result[key] ?? []) {
      if (!item?.asOfDate || item.reportedValue?.raw == null) continue;
      fields.push({
        statementType,
        periodType,
        periodEnd: item.asOfDate,
        fieldName,
        value: item.reportedValue.raw,
        currency: item.currencyCode ?? "USD",
        source: "yahoo",
      });
    }
  }
  return fields;
}

function humanizeField(typeName: string): string {
  // annualTotalRevenue -> Total Revenue
  return typeName
    .replace(/^(annual|quarterly)/, "")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

// ── quote / ratio extraction ────────────────────────────────────

/** Yahoo returns plain numbers with formatted=false, or {raw,fmt} objects otherwise. */
function num(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "object") return v.raw ?? v.fmt ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function extractRatiosFromSummary(modules: Record<string, any>, symbol: string, asOf: string): RatioValue[] {
  const out: RatioValue[] = [];
  const push = (metric: string, v: any) => {
    const value = num(v);
    if (value == null) return;
    out.push({ metric, value, asOf, source: "yahoo" });
  };
  const dks = modules.defaultKeyStatistics ?? {};
  const fd = modules.financialData ?? {};
  const sd = modules.summaryDetail ?? {};
  const price = modules.price ?? {};
  const pairs: Array<[string, any]> = [
    ["market_cap", price.marketCap ?? dks.marketCap],
    ["enterprise_value", dks.enterpriseValue],
    ["trailing_pe", dks.trailingPE ?? sd.trailingPE],
    ["forward_pe", dks.forwardPE ?? sd.forwardPE],
    ["price_to_sales", dks.priceToSalesTrailing12Months ?? sd.priceToSalesTrailing12Months],
    ["price_to_book", dks.priceToBook],
    ["profit_margin", dks.profitMargins ?? fd.profitMargins],
    ["gross_margin", fd.grossMargins],
    ["operating_margin", fd.operatingMargins],
    ["return_on_equity", fd.returnOnEquity],
    ["return_on_assets", fd.returnOnAssets],
    ["dividend_yield", sd.dividendYield],
    ["payout_ratio", sd.payoutRatio ?? dks.payoutRatio],
    ["beta", dks.beta ?? fd.beta],
    ["52w_high", sd.fiftyTwoWeekHigh],
    ["52w_low", sd.fiftyTwoWeekLow],
    ["target_mean_price", fd.targetMeanPrice],
    ["target_high_price", fd.targetHighPrice],
    ["target_low_price", fd.targetLowPrice],
    ["recommendation_mean", fd.recommendationMean],
    ["number_of_analyst_opinions", fd.numberOfAnalystOpinions],
    ["shares_outstanding", dks.sharesOutstanding],
    ["float_shares", dks.floatShares],
    ["shares_short", dks.sharesShort],
    ["held_percent_insiders", dks.heldPercentInsiders],
    ["held_percent_institutions", dks.heldPercentInstitutions],
    ["total_cash", dks.totalCash ?? fd.totalCash],
    ["total_debt", dks.totalDebt ?? fd.totalDebt],
    ["free_cash_flow", fd.freeCashflow],
    ["operating_cash_flow", fd.operatingCashflows],
    ["revenue_growth", fd.revenueGrowth],
    ["earnings_growth", fd.earningsGrowth],
    ["current_ratio", fd.currentRatio],
    ["quick_ratio", fd.quickRatio],
    ["debt_to_equity", fd.debtToEquity],
    ["eps_ttm", dks.trailingEps],
    ["total_revenue", fd.totalRevenue],
    ["gross_profit", fd.grossProfits],
    ["ebitda", fd.ebitda],
  ];
  for (const [m, v] of pairs) push(m, v);
  return out;
}

export function yahooNum(v: any): number | null {
  return num(v);
}

export function extractDividendsFromSummary(modules: Record<string, any>): Dividend[] {
  const out: Dividend[] = [];
  const sd = modules.summaryDetail ?? {};
  const dks = modules.defaultKeyStatistics ?? {};
  const lastDiv = num(sd.lastDividendValue ?? dks.lastDividendValue);
  if (lastDiv != null) {
    const lastDate = num(sd.lastDividendDate ?? dks.lastDividendDate);
    const yieldRaw = num(sd.dividendYield);
    out.push({
      exDate: lastDate ? new Date(lastDate * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      amount: lastDiv,
      payDate: null,
      ttmDividend: num(sd.dividendRate ?? dks.dividendRate),
      yieldPct: yieldRaw != null ? yieldRaw * 100 : null,
      source: "yahoo",
    });
  }
  return out;
}
