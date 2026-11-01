#!/usr/bin/env node
// Writes every Shark & Co. mascot SVG from scripts/mascots.js (single source of truth).
//   node scripts/generate_mascots.mjs assets/brand
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { MASCOTS } = require(join(dirname(fileURLToPath(import.meta.url)), "mascots.js"));
const out = process.argv[2] || "assets/brand";
mkdirSync(out, { recursive: true });
for (const [, file, , svg] of MASCOTS) writeFileSync(join(out, `${file}.svg`), svg);
console.log(`wrote ${MASCOTS.length} SVGs to ${out}`);
