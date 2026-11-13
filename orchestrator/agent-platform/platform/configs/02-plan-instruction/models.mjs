import { Cursor } from "@cursor/sdk";

async function main() {
  const apiKey = (process.env.CURSOR_API_KEY || "").trim();
  const items = await Cursor.models.list(apiKey ? { apiKey } : undefined);
  process.stdout.write(`${JSON.stringify({ items })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
