import assert from "node:assert/strict";
import { closeDb, initSchema, query } from "../src/db.js";
import * as q from "../src/services/query.service.js";
import { cleanupTestData, seedTestData, TEST_NAME, TEST_SYMBOL } from "./test-util.js";

async function main() {
  await initSchema();
  const id = await seedTestData();
  try {
    // --- search_symbol regression (LIMIT used to be bound as DOUBLE) ---
    const hits = await q.searchSymbols(TEST_SYMBOL);
    assert.ok(hits.some((h: any) => h.symbol === TEST_SYMBOL), "searchSymbols should find seeded instrument");
    const wild = await q.searchSymbols("%ZZ%");
    assert.ok(wild.some((h: any) => h.symbol === TEST_SYMBOL), "wildcard input should still work");
    assert.equal((await q.searchSymbols("QQQQNOPE")).length, 0);

    // --- db helper regression: LIMIT ? via text protocol must not error ---
    const viaHelper = await query<Array<{ symbol: string }>>(
      "SELECT symbol FROM instruments WHERE symbol LIKE ? ORDER BY symbol LIMIT ?",
      ["%ZZ%", 10]
    );
    assert.ok(viaHelper.length >= 1, "helper with LIMIT ? should return rows");

    // --- instrument lookup ---
    const inst = await q.getInstrument(TEST_SYMBOL);
    assert.ok(inst && inst.id === id);
    assert.equal(await q.getInstrument("QQQQNOPE"), null);

    // --- quote ---
    const quote = await q.getQuote(TEST_SYMBOL);
    assert.ok(quote?.latestBar, "getQuote should return latest bar");
    assert.ok(quote?.ratios && "pe" in quote.ratios, "getQuote should pivot ratios");
    assert.equal(await q.getQuote("QQQQNOPE"), null);

    // --- bars ---
    assert.equal((await q.getBars(TEST_SYMBOL, "1d", undefined, undefined, 100))?.length, 3);
    assert.equal((await q.getBars(TEST_SYMBOL, "1d", undefined, undefined, 1))?.length, 1);
    assert.equal((await q.getBars(TEST_SYMBOL, "1wk"))?.length, 2);
    assert.equal((await q.getBars(TEST_SYMBOL, "1mo"))?.length, 1);
    assert.equal(await q.getBars("QQQQNOPE", "1d"), null);

    // --- profile / financials ---
    assert.equal((await q.getProfile(TEST_SYMBOL))?.name, TEST_NAME);
    const fin = await q.getFinancials(TEST_SYMBOL);
    assert.equal(fin?.periods.length, 3, "all statement types seeded");
    const inc = await q.getFinancials(TEST_SYMBOL, "INCOME", "ANNUAL");
    assert.equal(inc?.periods.length, 1);
    assert.ok(inc && "total_revenue" in inc.periods[0].fields, "income fields should be pivoted");

    // --- ratios / dividends / forecast / earnings ---
    assert.equal((await q.getRatios(TEST_SYMBOL))?.ratios.length, 2);
    const divs = await q.getDividends(TEST_SYMBOL);
    assert.ok(divs?.summary, "dividend summary should exist");
    assert.equal(divs?.dividends.length, 1);
    assert.equal((await q.getForecast(TEST_SYMBOL))?.forecasts.length, 1);
    assert.equal((await q.getEarnings(TEST_SYMBOL))?.earnings.length, 1);

    // --- holders / news / options ---
    assert.equal((await q.getHolders(TEST_SYMBOL, 10))?.holders.length, 1);
    assert.equal((await q.getHolders(TEST_SYMBOL, 0))?.holders.length, 1, "limit should be clamped to >= 1");
    assert.equal((await q.getNews(TEST_SYMBOL, 10))?.news.length, 2, "getNews regression");
    assert.equal((await q.getNews(TEST_SYMBOL, 0))?.news.length, 1, "limit should be clamped to >= 1");
    const opts = await q.getOptions(TEST_SYMBOL);
    assert.equal(opts?.expirations.length, 1);
    assert.equal(opts?.legs.length, 2);
    assert.ok(opts?.legs[0]?.contract_symbol, "options legs should include contract_symbol");
    assert.equal((await q.getOptions(TEST_SYMBOL, "2026-09-19"))?.legs.length, 2);
    assert.equal(await q.getOptions("QQQQNOPE"), null);
    assert.equal(await q.getNews("QQQQNOPE"), null);

    console.log("db tests OK");
  } finally {
    await cleanupTestData();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => closeDb());
