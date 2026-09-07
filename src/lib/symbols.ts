import type { PortfolioAssetType } from "./types";

/**
 * A curated list of what most people actually hold.
 *
 * The point is not to be exhaustive — it is to make the common case one click instead of typing a
 * ticker from memory and hoping it is right. Anything not here can still be entered by hand; this
 * list is a shortcut, never a restriction.
 *
 * Two deliberate exclusions worth knowing about:
 *
 *   SPX and NDX are *indices*. You cannot buy them, and most free feeds will not quote them. The
 *   tradeable equivalents are SPY and QQQ, so those are what appear here — searching "SPX" finds
 *   SPY through the alias below rather than returning nothing.
 *
 *   No leveraged or inverse products (TQQQ, SQQQ, UVXY). They decay against the index over any
 *   holding period longer than a day, so they do not belong in a list framed as long-term
 *   investments. They can still be typed in if you want one.
 */

export interface SymbolInfo {
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  /** Grouping for the picker. */
  group: string;
  /** Other things you might type when looking for this. */
  aliases?: string[];
  /**
   * What to ask the price feed for, when that differs from what you call it.
   *
   * Finnhub quotes crypto only under an exchange-prefixed symbol — "BTC" returns nothing, while
   * "BINANCE:BTCUSDT" returns a price. Keeping the two apart means the table can say BTC while the
   * fetch asks for what the feed actually understands.
   */
  quoteSymbol?: string;
}

export const SYMBOLS: SymbolInfo[] = [
  // ------------------------------- broad market ETFs -------------------------------
  { symbol: "SPY", name: "S&P 500", assetType: "etf", group: "Index funds", aliases: ["SPX", "S&P", "SP500", "500"] },
  { symbol: "VOO", name: "Vanguard S&P 500", assetType: "etf", group: "Index funds", aliases: ["vanguard"] },
  { symbol: "IVV", name: "iShares Core S&P 500", assetType: "etf", group: "Index funds" },
  { symbol: "QQQ", name: "Nasdaq 100", assetType: "etf", group: "Index funds", aliases: ["NDX", "nasdaq", "100"] },
  { symbol: "DIA", name: "Dow Jones Industrial Average", assetType: "etf", group: "Index funds", aliases: ["DJI", "dow"] },
  { symbol: "IWM", name: "Russell 2000 (small caps)", assetType: "etf", group: "Index funds", aliases: ["RUT", "russell", "small"] },
  { symbol: "VTI", name: "Vanguard Total US Market", assetType: "etf", group: "Index funds", aliases: ["total market"] },
  { symbol: "VT", name: "Vanguard Total World", assetType: "etf", group: "Index funds", aliases: ["world"] },
  { symbol: "VXUS", name: "Vanguard Total International", assetType: "etf", group: "Index funds", aliases: ["international"] },
  { symbol: "VEA", name: "Vanguard Developed Markets", assetType: "etf", group: "Index funds" },
  { symbol: "VWO", name: "Vanguard Emerging Markets", assetType: "etf", group: "Index funds", aliases: ["emerging"] },
  { symbol: "SCHD", name: "Schwab US Dividend Equity", assetType: "etf", group: "Index funds", aliases: ["dividend"] },
  { symbol: "VIG", name: "Vanguard Dividend Appreciation", assetType: "etf", group: "Index funds", aliases: ["dividend"] },
  { symbol: "VYM", name: "Vanguard High Dividend Yield", assetType: "etf", group: "Index funds", aliases: ["dividend", "yield"] },

  // ----------------------------------- sector ETFs ---------------------------------
  { symbol: "XLK", name: "Technology sector", assetType: "etf", group: "Sectors", aliases: ["tech"] },
  { symbol: "XLF", name: "Financials sector", assetType: "etf", group: "Sectors", aliases: ["banks", "financial"] },
  { symbol: "XLE", name: "Energy sector", assetType: "etf", group: "Sectors", aliases: ["oil", "energy"] },
  { symbol: "XLV", name: "Health care sector", assetType: "etf", group: "Sectors", aliases: ["health"] },
  { symbol: "XLY", name: "Consumer discretionary", assetType: "etf", group: "Sectors" },
  { symbol: "XLP", name: "Consumer staples", assetType: "etf", group: "Sectors" },
  { symbol: "XLI", name: "Industrials sector", assetType: "etf", group: "Sectors" },
  { symbol: "XLU", name: "Utilities sector", assetType: "etf", group: "Sectors" },
  { symbol: "SMH", name: "Semiconductors", assetType: "etf", group: "Sectors", aliases: ["semis", "chips"] },
  { symbol: "SOXX", name: "iShares Semiconductors", assetType: "etf", group: "Sectors", aliases: ["semis", "chips"] },
  { symbol: "ARKK", name: "ARK Innovation", assetType: "etf", group: "Sectors", aliases: ["ark", "cathie"] },

  // ------------------------------ bonds, gold, commodities -------------------------
  { symbol: "BND", name: "Vanguard Total Bond Market", assetType: "etf", group: "Bonds & commodities", aliases: ["bonds"] },
  { symbol: "AGG", name: "iShares Core US Aggregate Bond", assetType: "etf", group: "Bonds & commodities", aliases: ["bonds"] },
  { symbol: "TLT", name: "20+ Year Treasury Bonds", assetType: "etf", group: "Bonds & commodities", aliases: ["treasury", "bonds", "long bond"] },
  { symbol: "SHY", name: "1–3 Year Treasury Bonds", assetType: "etf", group: "Bonds & commodities", aliases: ["treasury", "short"] },
  { symbol: "GLD", name: "Gold", assetType: "etf", group: "Bonds & commodities", aliases: ["gold"] },
  { symbol: "SLV", name: "Silver", assetType: "etf", group: "Bonds & commodities", aliases: ["silver"] },
  { symbol: "USO", name: "US Oil Fund", assetType: "etf", group: "Bonds & commodities", aliases: ["oil", "crude"] },

  // --------------------------------- mega-cap tech ---------------------------------
  { symbol: "AAPL", name: "Apple", assetType: "stock", group: "Big tech", aliases: ["apple"] },
  { symbol: "MSFT", name: "Microsoft", assetType: "stock", group: "Big tech", aliases: ["microsoft"] },
  { symbol: "NVDA", name: "NVIDIA", assetType: "stock", group: "Big tech", aliases: ["nvidia"] },
  { symbol: "GOOGL", name: "Alphabet (Google) Class A", assetType: "stock", group: "Big tech", aliases: ["google", "alphabet"] },
  { symbol: "GOOG", name: "Alphabet (Google) Class C", assetType: "stock", group: "Big tech", aliases: ["google", "alphabet"] },
  { symbol: "AMZN", name: "Amazon", assetType: "stock", group: "Big tech", aliases: ["amazon"] },
  { symbol: "META", name: "Meta Platforms (Facebook)", assetType: "stock", group: "Big tech", aliases: ["facebook", "meta", "FB"] },
  { symbol: "TSLA", name: "Tesla", assetType: "stock", group: "Big tech", aliases: ["tesla"] },
  { symbol: "AVGO", name: "Broadcom", assetType: "stock", group: "Big tech", aliases: ["broadcom"] },
  { symbol: "AMD", name: "Advanced Micro Devices", assetType: "stock", group: "Big tech", aliases: ["amd"] },
  { symbol: "NFLX", name: "Netflix", assetType: "stock", group: "Big tech", aliases: ["netflix"] },
  { symbol: "CRM", name: "Salesforce", assetType: "stock", group: "Big tech", aliases: ["salesforce"] },
  { symbol: "ORCL", name: "Oracle", assetType: "stock", group: "Big tech", aliases: ["oracle"] },
  { symbol: "ADBE", name: "Adobe", assetType: "stock", group: "Big tech", aliases: ["adobe"] },
  { symbol: "INTC", name: "Intel", assetType: "stock", group: "Big tech", aliases: ["intel"] },
  { symbol: "MU", name: "Micron", assetType: "stock", group: "Big tech", aliases: ["micron"] },
  { symbol: "QCOM", name: "Qualcomm", assetType: "stock", group: "Big tech", aliases: ["qualcomm"] },
  { symbol: "PLTR", name: "Palantir", assetType: "stock", group: "Big tech", aliases: ["palantir"] },
  { symbol: "UBER", name: "Uber", assetType: "stock", group: "Big tech", aliases: ["uber"] },
  { symbol: "SHOP", name: "Shopify", assetType: "stock", group: "Big tech", aliases: ["shopify"] },

  // ----------------------------------- blue chips ----------------------------------
  { symbol: "BRK.B", name: "Berkshire Hathaway Class B", assetType: "stock", group: "Blue chips", aliases: ["berkshire", "buffett", "BRKB"] },
  { symbol: "JPM", name: "JPMorgan Chase", assetType: "stock", group: "Blue chips", aliases: ["jpmorgan", "chase"] },
  { symbol: "BAC", name: "Bank of America", assetType: "stock", group: "Blue chips", aliases: ["bank of america"] },
  { symbol: "GS", name: "Goldman Sachs", assetType: "stock", group: "Blue chips", aliases: ["goldman"] },
  { symbol: "V", name: "Visa", assetType: "stock", group: "Blue chips", aliases: ["visa"] },
  { symbol: "MA", name: "Mastercard", assetType: "stock", group: "Blue chips", aliases: ["mastercard"] },
  { symbol: "JNJ", name: "Johnson & Johnson", assetType: "stock", group: "Blue chips", aliases: ["johnson"] },
  { symbol: "UNH", name: "UnitedHealth", assetType: "stock", group: "Blue chips", aliases: ["unitedhealth"] },
  { symbol: "LLY", name: "Eli Lilly", assetType: "stock", group: "Blue chips", aliases: ["lilly"] },
  { symbol: "PFE", name: "Pfizer", assetType: "stock", group: "Blue chips", aliases: ["pfizer"] },
  { symbol: "ABBV", name: "AbbVie", assetType: "stock", group: "Blue chips" },
  { symbol: "MRK", name: "Merck", assetType: "stock", group: "Blue chips", aliases: ["merck"] },
  { symbol: "WMT", name: "Walmart", assetType: "stock", group: "Blue chips", aliases: ["walmart"] },
  { symbol: "COST", name: "Costco", assetType: "stock", group: "Blue chips", aliases: ["costco"] },
  { symbol: "HD", name: "Home Depot", assetType: "stock", group: "Blue chips", aliases: ["home depot"] },
  { symbol: "MCD", name: "McDonald's", assetType: "stock", group: "Blue chips", aliases: ["mcdonalds"] },
  { symbol: "KO", name: "Coca-Cola", assetType: "stock", group: "Blue chips", aliases: ["coke", "coca cola"] },
  { symbol: "PEP", name: "PepsiCo", assetType: "stock", group: "Blue chips", aliases: ["pepsi"] },
  { symbol: "PG", name: "Procter & Gamble", assetType: "stock", group: "Blue chips", aliases: ["procter"] },
  { symbol: "NKE", name: "Nike", assetType: "stock", group: "Blue chips", aliases: ["nike"] },
  { symbol: "SBUX", name: "Starbucks", assetType: "stock", group: "Blue chips", aliases: ["starbucks"] },
  { symbol: "DIS", name: "Disney", assetType: "stock", group: "Blue chips", aliases: ["disney"] },
  { symbol: "XOM", name: "ExxonMobil", assetType: "stock", group: "Blue chips", aliases: ["exxon"] },
  { symbol: "CVX", name: "Chevron", assetType: "stock", group: "Blue chips", aliases: ["chevron"] },
  { symbol: "CAT", name: "Caterpillar", assetType: "stock", group: "Blue chips", aliases: ["caterpillar"] },
  { symbol: "BA", name: "Boeing", assetType: "stock", group: "Blue chips", aliases: ["boeing"] },
  { symbol: "LMT", name: "Lockheed Martin", assetType: "stock", group: "Blue chips", aliases: ["lockheed", "defense"] },
  { symbol: "RTX", name: "RTX (Raytheon)", assetType: "stock", group: "Blue chips", aliases: ["raytheon", "defense"] },
  { symbol: "NOC", name: "Northrop Grumman", assetType: "stock", group: "Blue chips", aliases: ["northrop", "defense"] },
  { symbol: "GE", name: "General Electric", assetType: "stock", group: "Blue chips" },
  { symbol: "F", name: "Ford", assetType: "stock", group: "Blue chips", aliases: ["ford"] },
  { symbol: "T", name: "AT&T", assetType: "stock", group: "Blue chips", aliases: ["att"] },
  { symbol: "VZ", name: "Verizon", assetType: "stock", group: "Blue chips", aliases: ["verizon"] },

  // ------------------------------------- crypto ------------------------------------
  // Coins held directly, quoted through Finnhub's exchange-prefixed crypto symbols.
  { symbol: "BTC", name: "Bitcoin", assetType: "crypto", group: "Crypto", aliases: ["bitcoin"], quoteSymbol: "BINANCE:BTCUSDT" },
  { symbol: "ETH", name: "Ethereum", assetType: "crypto", group: "Crypto", aliases: ["ethereum", "ether"], quoteSymbol: "BINANCE:ETHUSDT" },
  { symbol: "SOL", name: "Solana", assetType: "crypto", group: "Crypto", aliases: ["solana"], quoteSymbol: "BINANCE:SOLUSDT" },
  { symbol: "XRP", name: "XRP", assetType: "crypto", group: "Crypto", aliases: ["ripple"], quoteSymbol: "BINANCE:XRPUSDT" },
  { symbol: "DOGE", name: "Dogecoin", assetType: "crypto", group: "Crypto", aliases: ["dogecoin"], quoteSymbol: "BINANCE:DOGEUSDT" },
  { symbol: "ADA", name: "Cardano", assetType: "crypto", group: "Crypto", aliases: ["cardano"], quoteSymbol: "BINANCE:ADAUSDT" },
  { symbol: "LINK", name: "Chainlink", assetType: "crypto", group: "Crypto", aliases: ["chainlink"], quoteSymbol: "BINANCE:LINKUSDT" },
  // Spot ETFs, for holding the exposure inside a brokerage account rather than the coin itself.
  { symbol: "IBIT", name: "iShares Bitcoin Trust", assetType: "crypto", group: "Crypto", aliases: ["bitcoin etf"] },
  { symbol: "FBTC", name: "Fidelity Bitcoin Fund", assetType: "crypto", group: "Crypto", aliases: ["bitcoin", "btc"] },
  { symbol: "ETHA", name: "iShares Ethereum Trust", assetType: "crypto", group: "Crypto", aliases: ["ethereum", "eth"] },
  { symbol: "COIN", name: "Coinbase", assetType: "stock", group: "Crypto", aliases: ["coinbase"] },
  { symbol: "MSTR", name: "MicroStrategy (Strategy)", assetType: "stock", group: "Crypto", aliases: ["microstrategy", "saylor"] },
];

const BY_SYMBOL = new Map(SYMBOLS.map((s) => [s.symbol, s]));

export function lookup(symbol: string): SymbolInfo | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/** The groups in the order they should appear in the picker. */
export const GROUPS = ["Index funds", "Big tech", "Blue chips", "Sectors", "Bonds & commodities", "Crypto"];

/**
 * Search the catalogue.
 *
 * Ranked, not just filtered: an exact ticker match comes first, then tickers that start with what
 * you typed, then name matches, then aliases. Typing "V" should offer Visa before Vanguard Total
 * World, and typing "SPX" should find SPY rather than nothing at all.
 */
export function searchSymbols(query: string, limit = 40): SymbolInfo[] {
  const q = query.trim().toUpperCase();
  if (!q) return SYMBOLS.slice(0, limit);

  const scored: { info: SymbolInfo; score: number }[] = [];
  for (const info of SYMBOLS) {
    const symbol = info.symbol.toUpperCase();
    const name = info.name.toUpperCase();
    let score = -1;

    if (symbol === q) score = 0;
    else if (symbol.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (info.aliases?.some((a) => a.toUpperCase() === q)) score = 3;
    else if (name.includes(q)) score = 4;
    else if (info.aliases?.some((a) => a.toUpperCase().includes(q))) score = 5;
    else if (symbol.includes(q)) score = 6;

    if (score >= 0) scored.push({ info, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.info.symbol.localeCompare(b.info.symbol))
    .slice(0, limit)
    .map((s) => s.info);
}

/**
 * What to ask the price feed for.
 *
 * Falls back to the symbol itself, so an unlisted ticker is passed through untouched — the mapping
 * only exists for the handful of things the feed names differently from everyone else.
 */
export function quoteSymbolFor(symbol: string): string {
  return lookup(symbol)?.quoteSymbol ?? symbol.trim().toUpperCase();
}
