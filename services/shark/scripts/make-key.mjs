// Makes an ed25519 key for one of the services and writes the SECRET straight into a git-ignored .env file, so it never
// shows up on screen, in the shell history or in chat. Prints only the PUBLIC key, which is what goes on chain.
//   node scripts/make-key.mjs <path to .env> <NAME>      e.g.  node scripts/make-key.mjs .env SHARK_QUOTE_KEY
// It refuses to overwrite a key that is already there.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { KeyPair } from "near-api-js";

const [envPath, name] = process.argv.slice(2);
if (!envPath || !/^[A-Z][A-Z0-9_]*$/.test(name ?? "")) {
  console.error("usage: node scripts/make-key.mjs <path to .env> <NAME>");
  process.exit(2);
}
const text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (new RegExp(`^${name}=.+$`, "m").test(text)) {
  console.error(`${name} is already set in ${envPath}; delete that line first if you really want a new key.`);
  process.exit(1);
}
const key = KeyPair.fromRandom("ed25519");
appendFileSync(envPath, `${text && !text.endsWith("\n") ? "\n" : ""}${name}=${key.toString()}\n`);
console.log(`${name} written to ${envPath}`);
console.log(`public key: ${key.getPublicKey().toString()}`);
