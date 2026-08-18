#!/usr/bin/env node
/**
 * Prepack gate for entry packages: refuse to pack a tarball whose built
 * `lib/` is missing. Entry `files` lists use globs, and a glob matching
 * nothing packs a silently JS-less tarball instead of failing — this gate
 * turns that into a loud refusal on a checkout that never ran
 * `pnpm build:ts`.
 *
 * Runs from each entry package's `prepack` hook (pnpm sets the script cwd
 * to the package directory).
 */

import fs from 'node:fs';
import path from 'node:path';

const packageDir = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

for (const file of ['lib/index.js', 'lib/index.d.ts']) {
  if (!fs.existsSync(path.join(packageDir, file))) {
    console.error(`verify-entry-lib: ${manifest.name} has no ${file} — run \`pnpm build:ts\` before packing.`);
    process.exit(1);
  }
}
console.log(`verify-entry-lib: ${manifest.name} built lib/ present.`);
