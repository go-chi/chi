import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const neverDisposePlugin = pathToFileURL(
  fileURLToPath(new URL('./fixtures/never-dispose.mjs', import.meta.url)),
).href

const POSIX_HEADLESS_PTY_DRIVER = String.raw`
import errno, json, os, pty, select, signal, sys, time
node, launch_args_json, launch_env_json, cwd, timeout_seconds = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(launch_env_json))
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, *json.loads(launch_args_json)], env)

markers = [b"dsh-test: never-dispose ready", b"dsh-test: never-dispose started"]
output = bytearray()
marker_index = 0
deadline = time.monotonic() + float(timeout_seconds)
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)
    while marker_index < len(markers) and markers[marker_index] in output:
        if marker_index == 0:
            open(os.path.join(cwd, "shutdown-armed"), "w").close()
        os.write(fd, b"\x03")
        marker_index += 1
    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break

if status is None:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
if marker_index != len(markers):
    sys.stderr.write(f"completed {marker_index}/{len(markers)} PTY actions before timeout\n")
    sys.exit(124)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != 130:
    sys.stderr.write(f"expected exit 130, got {actual_exit}\n")
    sys.exit(125)
`

async function runHeadlessPtySmoke(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-headless-shutdown-'))
  try {
    const home = join(cwd, '.dsh')
    // Pre-initialize the headless profile with the never-dispose row in its
    // user patch layer (the same file a long-lived profile boot hot-reloads).
    const profileDir = join(home, 'profiles', 'headless')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-headless',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
    }, undefined, 2))
    await writeFile(join(profileDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: never-dispose',
      `      name: '${neverDisposePlugin}'`,
      '',
    ].join('\n'))
    const launch = resolveExampleLaunch({
      srcBin: dshBinScript,
      configArgs: ['--profile', 'headless', 'never complete'],
      tsconfigPath,
      env: {
        DSH_HOME: home,
        DSH_AGENTS_HOME: join(cwd, '.agents'),
        DEEPSEEK_API_KEY: 'keyless-shutdown-no-call',
        DSH_TELEMETRY_DISABLED: '1',
        DSH_TEST_SHUTDOWN_ARM_FILE: join(cwd, 'shutdown-armed'),
      },
    })
    const timeoutMs = 15_000
    const result = await execa('python3', [
      '-c',
      POSIX_HEADLESS_PTY_DRIVER,
      launch.command,
      JSON.stringify(launch.args),
      JSON.stringify(launch.env),
      cwd,
      String(timeoutMs / 1_000),
    ], {
      stdin: 'ignore',
      timeout: timeoutMs + 5_000,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    if (result.timedOut) {
      throw new Error(`dsh headless PTY driver did not exit. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    if (result.failed) {
      throw new Error(`dsh headless PTY driver exited ${String(result.exitCode)}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    return result.stdout
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('headless process shutdown (real Loader tree in a PTY)', () => {
  it('lets a second Ctrl+C force exit while the first signal is draining', async () => {
    const output = await runHeadlessPtySmoke()
    expect(output).not.toContain('dsh: observing at ')
    expect(output).toContain('dsh-test: never-dispose ready')
    expect(output).toContain('dsh-test: never-dispose started')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
