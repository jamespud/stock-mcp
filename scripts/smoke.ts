// Provider smoke test (no DB required): verifies both data sources are reachable.
import { fetchYahooSummary, fetchYahooBars, fetchYahooNews } from "../src/providers/yahoo.js";
import { fetchInvestingSnapshot } from "../src/providers/investing.js";

const symbol = process.argv[2] ?? "NVDA";

const y = await fetchYahooSummary(symbol);
const price = y.modules.price ?? {};
console.log("YAHOO quote:", {
  symbol: price.symbol,
  name: price.longName,
  price: price.regularMarketPrice?.raw,
  currency: price.currency,
  exchange: price.exchangeName,
});
const bars = await fetchYahooBars(symbol, "1d", "2026-07-20", "2026-08-08");
console.log("YAHOO bars (last 3):", bars.slice(-3));
const news = await fetchYahooNews(symbol, 3);
console.log("YAHOO news:", news.map((n) => n.title));

const inv = await fetchInvestingSnapshot(symbol);
console.log("INVESTING identity:", inv.identity);
console.log("INVESTING latest:", inv.latestPrice, "52w:", inv.high52Week, "/", inv.low52Week);
console.log("INVESTING income rows:", inv.financials.filter((f) => f.statementType === "INCOME" && f.periodType === "ANNUAL").length);
console.log("INVESTING ratios:", inv.ratios.slice(0, 5));
console.log("INVESTING dividends:", inv.dividends.slice(0, 3));
console.log("INVESTING forecast:", inv.forecast);
console.log("INVESTING holders:", inv.holders.length, "first:", inv.holders[0]);
console.log("INVESTING profile:", { summary: inv.profile.businessSummary?.slice(0, 80), employees: inv.profile.employees });
console.log("INVESTING earnings:", inv.earnings.slice(0, 3));
console.log("smoke OK");
