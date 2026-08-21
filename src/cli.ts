import { closeDb, initSchema } from "./db.js";
import { syncAll, syncOne, syncSectors, type IntradayInterval } from "./services/sync.service.js";
import { startMcpServer } from "./mcp/server.js";

const INTRADAY_INTERVALS = ["1m", "5m", "15m", "30m", "60m"] as const;

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const cmd = args[0] ?? "server";
  const flags = new Map<string, string>();
  let symbol: string | undefined;
  let all = false;
  let full = false;
  let sectors = false;
  let sectorMembers = true;
  let intraday: IntradayInterval | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--symbol" && args[i + 1]) { symbol = args[++i]; }
    else if (a === "--all") all = true;
    else if (a === "--full") full = true;
    else if (a === "--incremental") full = false;
    else if (a === "--sectors") sectors = true;
    else if (a === "--no-members") sectorMembers = false;
    else if (a === "--intraday") {
      const iv = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "15m";
      if (!(INTRADAY_INTERVALS as readonly string[]).includes(iv)) {
        console.error(`invalid intraday interval: ${iv} (use ${INTRADAY_INTERVALS.join("/")})`);
        process.exit(1);
      }
      intraday = iv as IntradayInterval;
    }
    else if (a.startsWith("--")) flags.set(a, args[i + 1] ?? "");
  }
  return { cmd, symbol, all, full, sectors, sectorMembers, intraday };
}

async function main() {
  const { cmd, symbol, all, full, sectors, sectorMembers, intraday } = parseArgs(process.argv);

  switch (cmd) {
    case "db:init":
      await initSchema();
      break;

    case "sync":
      if (sectors) {
        await syncSectors({ members: sectorMembers });
      } else if (all) {
        await syncAll({ full, intraday });
      } else if (symbol) {
        const r = await syncOne(symbol, { full, intraday });
        console.log(`synced ${symbol}: bars=${r.bars} news=${r.news} options=${r.options} intraday=${r.intraday}`);
      } else {
        console.error(
          "usage: yahoo-stock-mcp sync --symbol NVDA [--full|--incremental] [--intraday 15m] | sync --all [--full] [--intraday 15m] | sync --sectors [--no-members]"
        );
        process.exitCode = 1;
      }
      break;

    case "server":
    default:
      await startMcpServer();
      break;
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
