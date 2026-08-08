import { config } from "../config.js";
import { query, runBatch } from "../db.js";
import { fetchInvestingBars, fetchInvestingSnapshot } from "../providers/investing.js";
import {
  extractDividendsFromSummary,
  extractRatiosFromSummary,
  yahooNum,
  fetchYahooBars,
  fetchYahooFundamentals,
  fetchYahooNews,
  fetchYahooOptions,
  fetchYahooSummary,
} from "../providers/yahoo.js";
import type { Bar, FinancialField, RatioValue } from "../providers/types.js";

interface InstrumentRow {
  id: number;
  symbol: string;
  yahoo_symbol: string | null;
  investing_id: number | null;
}

// ── instrument resolution ───────────────────────────────────────

export async function ensureInstrument(symbol: string): Promise<InstrumentRow> {
  const existing = await query<InstrumentRow[]>(
    "SELECT id, symbol, yahoo_symbol, investing_id FROM instruments WHERE symbol = ?",
    [symbol]
  );
  if (existing.length > 0) return existing[0];

  const yahoo = await fetchYahooSummary(symbol).catch(() => null);
  const investing = await fetchInvestingSnapshot(symbol).catch(() => null);

  const name = yahoo?.modules.price?.longName ?? investing?.identity.name ?? symbol;
  const exchange = yahoo?.modules.price?.exchangeName ?? investing?.identity.exchange ?? null;
  const currency = yahoo?.modules.price?.currency ?? null;
  const profile: any = investing?.profile ?? {};
  const assetProfile = yahoo?.modules.assetProfile ?? {};
  const companyName = yahoo?.modules.price?.longName ?? yahoo?.modules.quoteType?.longName ?? investing?.identity.name ?? symbol;

  const res = await query<{ insertId: number }>(
    `INSERT INTO instruments (symbol, name, exchange, currency, yahoo_symbol, investing_id, sector, industry, business_summary, employees, website, street_address, city, country, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), exchange = VALUES(exchange), currency = VALUES(currency),
       yahoo_symbol = VALUES(yahoo_symbol), investing_id = VALUES(investing_id), sector = VALUES(sector),
       industry = VALUES(industry), business_summary = VALUES(business_summary), employees = VALUES(employees),
       website = VALUES(website), street_address = VALUES(street_address), city = VALUES(city),
       country = VALUES(country), phone = VALUES(phone)`,
    [
      symbol, companyName, exchange, currency,
      yahoo?.modules.price?.symbol ?? symbol,
      investing?.identity.investingId ?? null,
      assetProfile.sector ?? profile.sector,
      assetProfile.industry ?? profile.industry,
      profile.businessSummary ?? assetProfile.longBusinessSummary ?? null,
      profile.employees ?? assetProfile.fullTimeEmployees?.raw ?? null,
      assetProfile.website ?? profile.web,
      profile.streetAddress ?? assetProfile.address1 ?? null,
      profile.city ?? assetProfile.city ?? null,
      profile.country ?? assetProfile.country ?? null,
      profile.phone ?? assetProfile.phone ?? null,
    ]
  );
  const row = await query<InstrumentRow[]>(
    "SELECT id, symbol, yahoo_symbol, investing_id FROM instruments WHERE symbol = ?",
    [symbol]
  );
  return row[0];
}

// ── bars ────────────────────────────────────────────────────────

async function syncBars(instrument: InstrumentRow, from: string, to: string): Promise<number> {
  const bars: Bar[] =
    config.barsProvider === "investing" && instrument.investing_id
      ? await fetchInvestingBars(instrument.investing_id, "D", from, to)
      : await fetchYahooBars(instrument.yahoo_symbol ?? instrument.symbol, "1d", from, to);
  if (bars.length === 0) return 0;
  const sql =
    `INSERT INTO daily_bars (instrument_id, trade_date, open, high, low, close, adj_close, volume, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE open = VALUES(open), high = VALUES(high), low = VALUES(low),
       close = VALUES(close), adj_close = VALUES(adj_close), volume = VALUES(volume)`;
  const stmts = bars.map((b): [string, any[]] => [
    sql,
    [instrument.id, b.date, b.open, b.high, b.low, b.close, b.adjClose, b.volume, b.source],
  ]);
  for (let i = 0; i < stmts.length; i += 500) {
    await runBatch(stmts.slice(i, i + 500));
  }
  return bars.length;
}

// ── financial statements / ratios ───────────────────────────────

async function saveFinancials(instrumentId: number, fields: FinancialField[]): Promise<void> {
  if (fields.length === 0) return;
  const sql =
    `INSERT INTO financial_statements (instrument_id, statement_type, period_type, period_end, field_name, value, currency, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`;
  const stmts = fields.map((f): [string, any[]] => [
    sql,
    [instrumentId, f.statementType, f.periodType, f.periodEnd, f.fieldName, f.value, f.currency, f.source],
  ]);
  for (let i = 0; i < stmts.length; i += 500) await runBatch(stmts.slice(i, i + 500));
}

async function saveRatios(instrumentId: number, ratios: RatioValue[]): Promise<void> {
  if (ratios.length === 0) return;
  const sql =
    `INSERT INTO ratios (instrument_id, metric, as_of, value, source)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`;
  const stmts = ratios.map((r): [string, any[]] => [
    sql,
    [instrumentId, r.metric, r.asOf, r.value, r.source],
  ]);
  await runBatch(stmts);
}

// ── full sync ───────────────────────────────────────────────────

export async function syncOne(symbol: string, opts: { full: boolean }): Promise<{ symbol: string; bars: number; news: number; options: number }> {
  const instrument = await ensureInstrument(symbol);
  const today = new Date().toISOString().slice(0, 10);
  const result = { symbol, bars: 0, news: 0, options: 0 };

  // 1. bars
  if (opts.full) {
    result.bars = await syncBars(instrument, config.barsStartDate, today);
  } else {
    const state = await query<any[]>(
      "SELECT last_bar_date FROM sync_state WHERE instrument_id = ?",
      [instrument.id]
    );
    const from = state[0]?.last_bar_date
      ? new Date(new Date(state[0].last_bar_date).getTime() + 86400000).toISOString().slice(0, 10)
      : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    result.bars = await syncBars(instrument, from, today);
  }

  // 2. yahoo summary (quote, ratios, dividends, forecast, holders)
  const summary = await fetchYahooSummary(instrument.yahoo_symbol ?? symbol).catch((e) => {
    console.warn(`[${symbol}] yahoo summary failed: ${e.message}`);
    return null;
  });
  if (summary) {
    const modules = summary.modules;
    const price = modules.price ?? {};
    const px = yahooNum(price.regularMarketPrice);
    if (px != null) {
      await query(
        `UPDATE instruments SET name = COALESCE(?, name), exchange = COALESCE(?, exchange), currency = COALESCE(?, currency), updated_at = NOW() WHERE id = ?`,
        [price.longName ?? null, price.exchangeName ?? null, price.currency ?? null, instrument.id]
      );
    }
    await saveRatios(instrument.id, extractRatiosFromSummary(modules, symbol, today));

    // dividends from yahoo
    const divs = extractDividendsFromSummary(modules);
    for (const d of divs) {
      await query(
        `INSERT INTO dividends (instrument_id, ex_date, amount, pay_date, ttm_dividend, yield_pct, source)
         VALUES (?, ?, ?, ?, ?, ?, 'yahoo')
         ON DUPLICATE KEY UPDATE amount = VALUES(amount), ttm_dividend = VALUES(ttm_dividend), yield_pct = VALUES(yield_pct)`,
        [instrument.id, d.exDate, d.amount, d.payDate, d.ttmDividend, d.yieldPct]
      );
    }

    // forecast from yahoo financialData
    const fd = modules.financialData ?? {};
    if (yahooNum(fd.targetMeanPrice) != null) {
      await query(
        `INSERT INTO analyst_forecasts (instrument_id, as_of, consensus, n_buy, n_hold, n_sell, n_estimates, target_high, target_low, target_mean, source)
         VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, 'yahoo')
         ON DUPLICATE KEY UPDATE consensus = VALUES(consensus), target_mean = VALUES(target_mean)`,
        [
          instrument.id,
          fd.recommendationKey ?? null,
          null, null, null,
          yahooNum(fd.numberOfAnalystOpinions),
          yahooNum(fd.targetHighPrice),
          yahooNum(fd.targetLowPrice),
          yahooNum(fd.targetMeanPrice),
        ]
      );
    }

    // holders from yahoo institutionOwnership
    const ownership = modules.institutionOwnership?.ownershipList ?? [];
    const holdDate = new Date().toISOString().slice(0, 10);
    const holderStmts = ownership
      .filter((o: any) => o.organization)
      .slice(0, 30)
      .map((o: any): [string, any[]] => [
        `INSERT INTO holders (instrument_id, holding_date, owner_name, shares_held, percent_of_shares, percent_of_portfolio, shares_changed, total_value, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'yahoo')
         ON DUPLICATE KEY UPDATE shares_held = VALUES(shares_held), percent_of_shares = VALUES(percent_of_shares),
           total_value = VALUES(total_value)`,
        [
          instrument.id,
          (() => { const ts = yahooNum(o.reportDate); return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : holdDate; })(),
          o.organization,
          yahooNum(o.position),
          (() => { const pct = yahooNum(o.pctHeld); return pct != null ? pct * 100 : null; })(),
          null,
          null,
          yahooNum(o.value),
        ],
      ]);
    if (holderStmts.length) await runBatch(holderStmts);
  }

  // 3. investing snapshot (financials, ratios, dividends, forecast, profile, holders, earnings)
  const snapshot = await fetchInvestingSnapshot(instrument.yahoo_symbol ?? symbol).catch((e) => {
    console.warn(`[${symbol}] investing snapshot failed: ${e.message}`);
    return null;
  });
  if (snapshot) {
    await saveFinancials(instrument.id, snapshot.financials);
    await saveRatios(instrument.id, snapshot.ratios);

    const divStmts = snapshot.dividends.map((d): [string, any[]] => [
      `INSERT INTO dividends (instrument_id, ex_date, amount, pay_date, ttm_dividend, yield_pct, source)
       VALUES (?, ?, ?, ?, ?, ?, 'investing')
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), pay_date = VALUES(pay_date)`,
      [instrument.id, d.exDate, d.amount, d.payDate, d.ttmDividend, d.yieldPct],
    ]);
    if (divStmts.length) await runBatch(divStmts);
    await query(
      `INSERT INTO dividends_summary (instrument_id, dividend_yield, payout_ratio, annualized_payout, five_year_growth, next_dividend_date, source)
       VALUES (?, ?, ?, ?, ?, ?, 'investing')
       ON DUPLICATE KEY UPDATE dividend_yield = VALUES(dividend_yield), payout_ratio = VALUES(payout_ratio),
         annualized_payout = VALUES(annualized_payout), five_year_growth = VALUES(five_year_growth),
         next_dividend_date = VALUES(next_dividend_date)`,
      [
        instrument.id,
        snapshot.dividendSummary.yield,
        snapshot.dividendSummary.payoutRatio,
        snapshot.dividendSummary.annualizedPayout,
        snapshot.dividendSummary.fiveYearGrowth,
        snapshot.dividendSummary.nextDividendDate,
      ]
    );

    if (snapshot.forecast) {
      await query(
        `INSERT INTO analyst_forecasts (instrument_id, as_of, consensus, n_buy, n_hold, n_sell, n_estimates, target_high, target_low, target_mean, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'investing')
         ON DUPLICATE KEY UPDATE consensus = VALUES(consensus), n_buy = VALUES(n_buy), n_hold = VALUES(n_hold),
           n_sell = VALUES(n_sell), n_estimates = VALUES(n_estimates), target_high = VALUES(target_high),
           target_low = VALUES(target_low), target_mean = VALUES(target_mean)`,
        [
          instrument.id, snapshot.forecast.asOf, snapshot.forecast.consensus,
          snapshot.forecast.nBuy, snapshot.forecast.nHold, snapshot.forecast.nSell,
          snapshot.forecast.nEstimates, snapshot.forecast.targetHigh,
          snapshot.forecast.targetLow, snapshot.forecast.targetMean,
        ]
      );
    }

    const prof = snapshot.profile;
    await query(
      `UPDATE instruments SET name = COALESCE(?, name), sector = COALESCE(?, sector), industry = COALESCE(?, industry),
         business_summary = COALESCE(?, business_summary), employees = COALESCE(?, employees),
         website = COALESCE(?, website), street_address = COALESCE(?, street_address),
         city = COALESCE(?, city), country = COALESCE(?, country), phone = COALESCE(?, phone),
         investing_id = COALESCE(?, investing_id), updated_at = NOW() WHERE id = ?`,
      [
        prof.businessSummary ? snapshot.identity.name : null,
        prof.sector, prof.industry, prof.businessSummary, prof.employees,
        prof.web, prof.streetAddress, prof.city, prof.country, prof.phone,
        snapshot.identity.investingId,
        instrument.id,
      ]
    );

    const holderStmts2 = snapshot.holders.map((h): [string, any[]] => [
      `INSERT INTO holders (instrument_id, holding_date, owner_name, shares_held, percent_of_shares, percent_of_portfolio, shares_changed, total_value, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'investing')
       ON DUPLICATE KEY UPDATE shares_held = VALUES(shares_held), percent_of_shares = VALUES(percent_of_shares),
         total_value = VALUES(total_value)`,
      [instrument.id, h.holdingDate, h.ownerName, h.sharesHeld, h.percentOfShares, h.percentOfPortfolio, h.sharesChanged, h.totalValue],
    ]);
    if (holderStmts2.length) await runBatch(holderStmts2);

    if (snapshot.institutionalHoldings.percent != null) {
      await saveRatios(instrument.id, [{
        metric: "institutional_holdings_pct",
        value: snapshot.institutionalHoldings.percent,
        asOf: today,
        source: "investing",
      }]);
    }

    const earnStmts = snapshot.earnings.map((e): [string, any[]] => [
      `INSERT INTO earnings (instrument_id, report_year, report_month, report_date, eps_actual, eps_forecast, revenue_actual, revenue_forecast, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'investing')
       ON DUPLICATE KEY UPDATE eps_actual = VALUES(eps_actual), eps_forecast = VALUES(eps_forecast),
         revenue_actual = VALUES(revenue_actual), revenue_forecast = VALUES(revenue_forecast)`,
      [instrument.id, e.reportYear, e.reportMonth, e.reportDate, e.epsActual, e.epsForecast, e.revenueActual, e.revenueForecast],
    ]);
    if (earnStmts.length) await runBatch(earnStmts);
  }

  // 4. financial statements from yahoo fundamentals (unauthenticated, structured)
  try {
    const yahooFinancials = await fetchYahooFundamentals(instrument.yahoo_symbol ?? symbol, [
      "annualTotalRevenue", "annualNetIncome", "annualGrossProfit", "annualOperatingIncome",
      "annualTotalAssets", "annualTotalLiabilities", "annualStockholdersEquity",
      "annualOperatingCashFlow", "annualCapitalExpenditure", "annualFreeCashFlow",
      "quarterlyTotalRevenue", "quarterlyNetIncome", "quarterlyTotalAssets",
    ]);
    await saveFinancials(instrument.id, yahooFinancials);
  } catch (e: any) {
    console.warn(`[${symbol}] yahoo fundamentals failed: ${e.message}`);
  }

  // 5. news
  try {
    const news = await fetchYahooNews(instrument.yahoo_symbol ?? symbol, config.newsCount);
    const newsStmts = news.map((n): [string, any[]] => [
      `INSERT IGNORE INTO news (id, instrument_id, symbols, title, link, publisher, published_at, news_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [n.id, instrument.id, n.symbols, n.title, n.link, n.publisher, n.publishedAt, n.type],
    ]);
    if (newsStmts.length) await runBatch(newsStmts);
    result.news = news.length;
  } catch (e: any) {
    console.warn(`[${symbol}] news failed: ${e.message}`);
  }

  // 6. options (snapshot of near-term chain)
  try {
    const legs = await fetchYahooOptions(instrument.yahoo_symbol ?? symbol);
    if (legs.length) {
      await query("DELETE FROM options WHERE instrument_id = ? AND source = 'yahoo'", [instrument.id]);
      const optStmts = legs.map((l): [string, any[]] => [
        `INSERT INTO options (instrument_id, contract_symbol, expiration, option_type, strike, last_price, bid, ask, volume, open_interest, implied_vol, in_the_money, currency, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'yahoo')`,
        [instrument.id, l.contractSymbol, l.expiration, l.optionType, l.strike, l.lastPrice, l.bid, l.ask,
         l.volume, l.openInterest, l.impliedVol, l.inTheMoney ? 1 : 0, l.currency],
      ]);
      for (let i = 0; i < optStmts.length; i += 500) await runBatch(optStmts.slice(i, i + 500));
      result.options = legs.length;
    }
  } catch (e: any) {
    console.warn(`[${symbol}] options failed: ${e.message}`);
  }

  // 7. sync state
  const lastBarDate = await query<any[]>(
    "SELECT MAX(trade_date) AS d FROM daily_bars WHERE instrument_id = ? AND source = ?",
    [instrument.id, barsSource()]
  );
  await query(
    `INSERT INTO sync_state (instrument_id, full_synced, last_full_sync_at, last_incremental_at, last_bar_date, last_quote_at, error_count)
     VALUES (?, ?, NOW(), NOW(), ?, NOW(), 0)
     ON DUPLICATE KEY UPDATE full_synced = VALUES(full_synced), last_full_sync_at = VALUES(last_full_sync_at),
       last_incremental_at = VALUES(last_incremental_at), last_bar_date = VALUES(last_bar_date),
       last_quote_at = VALUES(last_quote_at)`,
    [instrument.id, opts.full ? 1 : 0, lastBarDate[0]?.d ?? null]
  );

  return result;
}

function barsSource(): string {
  return config.barsProvider === "investing" ? "investing" : "yahoo";
}

export async function syncAll(opts: { full: boolean }): Promise<void> {
  const rows = await query<Array<{ symbol: string }>>("SELECT symbol FROM instruments ORDER BY symbol");
  for (const r of rows) {
    try {
      const res = await syncOne(r.symbol, opts);
      console.log(`[${r.symbol}] bars=${res.bars} news=${res.news} options=${res.options}`);
    } catch (e: any) {
      console.error(`[${r.symbol}] sync failed: ${e.message}`);
    }
  }
}
