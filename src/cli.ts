import { closeDb, initSchema } from "./db.js";
import { syncAll, syncOne } from "./services/sync.service.js";
import { startMcpServer } from "./mcp/server.js";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const cmd = args[0] ?? "server";
  const flags = new Map<string, string>();
  let symbol: string | undefined;
  let all = false;
  let full = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--symbol" && args[i + 1]) { symbol = args[++i]; }
    else if (a === "--all") all = true;
    else if (a === "--full") full = true;
    else if (a === "--incremental") full = false;
    else if (a.startsWith("--")) flags.set(a, args[i + 1] ?? "");
  }
  return { cmd, symbol, all, full };
}

async function main() {
  const { cmd, symbol, all, full } = parseArgs(process.argv);

  switch (cmd) {
    case "db:init":
      await initSchema();
      break;

    case "sync":
      if (all) {
        await syncAll({ full });
      } else if (symbol) {
        const r = await syncOne(symbol, { full });
        console.log(`synced ${symbol}: bars=${r.bars} news=${r.news} options=${r.options}`);
      } else {
        console.error("usage: stock-mcp sync --symbol NVDA [--full|--incremental] | sync --all [--full]");
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
