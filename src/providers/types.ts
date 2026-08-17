export interface InstrumentIdentity {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  yahooSymbol?: string;
  investingId?: number | null;
}

export interface Bar {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
  source: string;
}

export interface FinancialField {
  statementType: "INCOME" | "BALANCE" | "CASHFLOW";
  periodType: "ANNUAL" | "QUARTERLY" | "LTM";
  periodEnd: string; // YYYY-MM-DD
  fieldName: string;
  value: number | null;
  currency: string;
  source: string;
}

export interface RatioValue {
  metric: string;
  value: number | null;
  asOf: string;
  source: string;
}

export interface Dividend {
  exDate: string;
  amount: number;
  payDate: string | null;
  ttmDividend: number | null;
  yieldPct: number | null;
  source: string;
}

export interface AnalystForecast {
  asOf: string;
  consensus: string | null;
  nBuy: number | null;
  nHold: number | null;
  nSell: number | null;
  nEstimates: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  targetMean: number | null;
  source: string;
}

export interface EarningsRecord {
  reportYear: number;
  reportMonth: number;
  reportDate: string | null;
  epsActual: number | null;
  epsForecast: number | null;
  revenueActual: number | null;
  revenueForecast: number | null;
  source: string;
}

export interface Holder {
  holdingDate: string;
  ownerName: string;
  sharesHeld: number | null;
  percentOfShares: number | null;
  percentOfPortfolio: number | null;
  sharesChanged: number | null;
  totalValue: number | null;
  source: string;
}

export interface OptionLeg {
  contractSymbol: string;
  expiration: string;
  optionType: "CALL" | "PUT";
  strike: number;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVol: number | null;
  inTheMoney: boolean | null;
  currency: string | null;
}

export interface OptionQuote extends OptionLeg {
  change: number | null;
  percentChange: number | null;
  bidSize: number | null;
  askSize: number | null;
  lastTradeDate: string | null;
}

export interface OptionChain {
  symbol: string;
  asOf: string;
  underlying: {
    price: number | null;
    change: number | null;
    changePercent: number | null;
    currency: string | null;
    marketState: string | null;
  };
  expirations: string[];
  strikes: number[];
  legs: OptionQuote[];
}

export interface NewsItem {
  id: string;
  symbols: string | null;
  title: string;
  link: string | null;
  publisher: string | null;
  publishedAt: string | null;
  type: string | null;
}

// ── data-checklist types (Yahoo / Investing) ───────────────────

export interface CompanyEvent {
  eventType: "EARNINGS" | "EARNINGS_CALL" | "EX_DIVIDEND" | "DIVIDEND_PAY";
  eventDate: string; // YYYY-MM-DD
  details: string | null;
  source: string;
}

export interface InsiderTransaction {
  transactionDate: string;
  insiderName: string;
  title: string | null;
  transactionText: string | null;
  shares: number | null;
  value: number | null;
  ownership: string | null;
  source: string;
}

export interface AnalystAction {
  actionDate: string;
  firm: string | null;
  fromGrade: string | null;
  toGrade: string | null;
  actionType: string | null;
  priceTargetAction: string | null;
  currentPriceTarget: number | null;
  priorPriceTarget: number | null;
  source: string;
}

export interface EarningsTrendRow {
  periodEnd: string;
  periodLabel: string;
  epsEstimate: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  epsGrowth: number | null;
  revenueEstimate: number | null;
  revenueGrowth: number | null;
  nAnalysts: number | null;
  epsCurrent: number | null;
  eps7dAgo: number | null;
  eps30dAgo: number | null;
  eps60dAgo: number | null;
  eps90dAgo: number | null;
  up7d: number | null;
  up30d: number | null;
  down7d: number | null;
  down30d: number | null;
  source: string;
}

export interface RecommendationTrendRow {
  periodLabel: string;
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
  source: string;
}

export interface FundHolder {
  holdingDate: string;
  ownerName: string;
  pctHeld: number | null;
  position: number | null;
  value: number | null;
  pctChange: number | null;
  source: string;
}

export interface ShortInterest {
  asOf: string;
  sharesShort: number | null;
  sharesShortPriorMonth: number | null;
  shortRatio: number | null;
  shortPercentOfFloat: number | null;
  sharesPercentSharesOut: number | null;
  shortDate: string | null;
  source: string;
}

export interface HolderBreakdown {
  asOf: string;
  insidersPercent: number | null;
  institutionsPercent: number | null;
  institutionsFloatPercent: number | null;
  institutionsCount: number | null;
  source: string;
}

export interface IntradayBar {
  ts: string; // YYYY-MM-DDTHH:MM:SSZ
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  source: string;
}
