#!/usr/bin/env node
/**
 * Shared helpers for the repo scripts: package discovery, the checked-in
 * prebuild matrix, and binary verification. The package matrix is explicit
 * metadata — `packages/<name>/prebuilds.json` marks a platform package and
 * declares its binaries; everything else under `packages/` is an entry
 * package. Scripts derive from these files and never guess.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
const packagesRoot = path.join(root, 'packages');

/** ELF `e_machine` (offset 18, little-endian) per platform-package `cpu` value. */
const E_MACHINE = { x64: 62, arm64: 183 };

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Platform packages: every `packages/<name>` carrying a `prebuilds.json`. */
export function platformDirs() {
  return fs.readdirSync(packagesRoot)
    .filter((name) => fs.existsSync(path.join(packagesRoot, name, 'prebuilds.json')))
    .sort()
    .map((name) => path.join('packages', name));
}

/** Entry packages: every other `packages/<name>` with a `package.json`. */
export function entryDirs() {
  return fs.readdirSync(packagesRoot)
    .filter((name) => !fs.existsSync(path.join(packagesRoot, name, 'prebuilds.json')))
    .filter((name) => fs.existsSync(path.join(packagesRoot, name, 'package.json')))
    .sort()
    .map((name) => path.join('packages', name));
}

/** All published packages in publish order: platform packages before the entries that optionally depend on them. */
export function packageDirs() {
  return [...platformDirs(), ...entryDirs()];
}

/**
 * Verify one platform package's binaries against its `prebuilds.json`:
 * every declared binary exists, nothing undeclared sits in `bin/`, and each
 * file's ELF `e_machine` matches the package's declared `cpu`. Throws with
 * a remediation message on the first mismatch.
 */
export function verifyPlatformBinaries(packageDir) {
  const manifest = readJson(path.join(packageDir, 'package.json'));
  const prebuilds = readJson(path.join(packageDir, 'prebuilds.json'));
  const cpu = manifest.cpu?.[0];
  if (cpu === undefined || !(cpu in E_MACHINE)) {
    throw new Error(`${manifest.name}: unsupported or missing "cpu" in package.json (expected one of: ${Object.keys(E_MACHINE).join(', ')})`);
  }

  for (const binary of prebuilds.binaries) {
    const file = path.join(packageDir, binary.path);
    if (!fs.existsSync(file)) {
      throw new Error(`${manifest.name}: missing ${binary.path} — run \`pnpm build:native\` on a ${prebuilds.platform} host (or assemble release artifacts) before packing.`);
    }
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch {
      // Only reachable when the mode was mangled somewhere between build and
      // here (e.g. an archive step that normalized permissions) — the build
      // itself always produces 755.
      throw new Error(`${manifest.name}: ${binary.path} is not executable — a pack/extract step stripped the mode bit.`);
    }
    const machine = fs.readFileSync(file).readUInt16LE(18);
    if (machine !== E_MACHINE[cpu]) {
      throw new Error(`${manifest.name}: ${binary.path} has ELF e_machine ${machine}, expected ${E_MACHINE[cpu]} for ${cpu} — the binary was built for a different architecture.`);
    }
  }

  const declared = prebuilds.binaries.map((binary) => path.basename(binary.path)).sort();
  const binDir = path.join(packageDir, 'bin');
  const actual = fs.existsSync(binDir) ? fs.readdirSync(binDir).sort() : [];
  const extra = actual.filter((name) => !declared.includes(name));
  if (extra.length) {
    throw new Error(`${manifest.name}: bin/ contains files not declared in prebuilds.json: ${extra.join(', ')}`);
  }

  return { name: manifest.name, count: prebuilds.binaries.length };
}
