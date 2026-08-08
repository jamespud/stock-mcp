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

export interface NewsItem {
  id: string;
  symbols: string | null;
  title: string;
  link: string | null;
  publisher: string | null;
  publishedAt: string | null;
  type: string | null;
}
