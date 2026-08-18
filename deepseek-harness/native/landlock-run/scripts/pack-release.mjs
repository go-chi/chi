#!/usr/bin/env node
/**
 * Pack every published package into release tarballs, in publish order
 * (platform packages first, then the entries that optionally depend on
 * them), and write `publish-order.txt` next to them. `pnpm pack` produces
 * the EXACT bytes `pnpm publish` would upload and runs each package's
 * `prepack` gate, so a missing binary or unbuilt `lib/` refuses here.
 *
 * Usage: `node scripts/pack-release.mjs [dest] [--current-platform-only]`.
 * The flag packs only THIS host's platform package plus the entries — for
 * per-architecture CI legs, where the other architecture's binary does not
 * exist (the exact refusal its prepack gate exists for).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { entryDirs, platformDirs, readJson, root } from './repo.mjs';

const args = process.argv.slice(2);
const currentPlatformOnly = args.includes('--current-platform-only');
const destination = path.resolve(args.find((arg) => !arg.startsWith('--')) || path.join(root, 'dist', 'npm'));

function hostPlatformDirs() {
  const hostPlatform = `${process.platform}-${process.arch}`;
  return platformDirs().filter((dir) => readJson(path.join(root, dir, 'prebuilds.json')).platform === hostPlatform);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function tarballName(manifest) {
  if (manifest.name.startsWith('@')) {
    return `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`;
  }
  return `${manifest.name}-${manifest.version}.tgz`;
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

const dirs = [...(currentPlatformOnly ? hostPlatformDirs() : platformDirs()), ...entryDirs()];
const platformSet = new Set(platformDirs());
const publishOrder = [];
for (const dir of dirs) {
  const manifest = readJson(path.join(root, dir, 'package.json'));
  // Platform packages are packed with npm: pnpm pack (observed on 11.7.0)
  // normalizes file modes and STRIPS the executable bit, which ships a
  // launcher no consumer can spawn; npm pack preserves it. Platform packages
  // have no dependencies by construction, so they need none of pnpm's
  // workspace-protocol conversion — the entry packages do, and carry no
  // executables, so they keep pnpm pack.
  if (platformSet.has(dir)) {
    run('npm', ['pack', `./${dir}`, '--pack-destination', destination]);
  } else {
    run('pnpm', ['--dir', dir, 'pack', '--pack-destination', destination]);
  }

  const tarball = tarballName(manifest);
  const tarballPath = path.join(destination, tarball);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`expected pack output not found: ${tarballPath}`);
  }
  publishOrder.push(tarball);
}

fs.writeFileSync(path.join(destination, 'publish-order.txt'), `${publishOrder.join('\n')}\n`);
console.log(`Packed ${publishOrder.length} packages into ${path.relative(root, destination)}`);
