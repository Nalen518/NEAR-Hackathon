// Makes an ed25519 key for one of the services and writes the SECRET straight into a git-ignored .env file, so it never
// shows up on screen, in the shell history or in chat. Prints only the PUBLIC key, which is what goes on chain.
//   node scripts/make-key.mjs <path to .env> <NAME>      e.g.  node scripts/make-key.mjs .env SHARK_QUOTE_KEY
// With --token it writes a random 32 byte secret (hex) instead of a key, for SHARK_AGENT_TOKEN, and prints nothing secret.
// It refuses to overwrite a value that is already there.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { KeyPair } from "near-api-js";

const [envPath, name, mode] = process.argv.slice(2);
if (!envPath || !/^[A-Z][A-Z0-9_]*$/.test(name ?? "")) {
  console.error("usage: node scripts/make-key.mjs <path to .env> <NAME> [--token]");
  process.exit(2);
}
const text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (new RegExp(`^${name}=.+$`, "m").test(text)) {
  console.error(`${name} is already set in ${envPath}; delete that line first if you really want a new key.`);
  process.exit(1);
}
const nl = text && !text.endsWith("\n") ? "\n" : "";
if (mode === "--token") {
  appendFileSync(envPath, `${nl}${name}=${randomBytes(32).toString("hex")}\n`);
  console.log(`${name} written to ${envPath}. Copy the same value into the other env file by hand, never into chat.`);
} else {
  const key = KeyPair.fromRandom("ed25519");
  appendFileSync(envPath, `${nl}${name}=${key.toString()}\n`);
  console.log(`${name} written to ${envPath}`);
  console.log(`public key: ${key.getPublicKey().toString()}`);
}
