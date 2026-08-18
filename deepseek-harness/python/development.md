# Python contributor workflows

English | [中文](development.zh.md)

Follow the workflow for the contributor outcome you need: build runtime artifacts, validate the SDK, run against source, or build distributions. Package behavior belongs in the [SDK reference](sdk/README.md) and [runtime carrier reference](sdk-runtime/README.md).

## Build runtime artifacts

Platform executables are build artifacts and are not checked into git. Run the build from the repository root:

```sh
pnpm install
pnpm exec tsx scripts/build-exe-for-python-sdk.ts
```

Use `--skip-build` when the required `lib/` artifacts already exist, or `--targets=node24-linux-x64,node24-linux-arm64,node24-macos-arm64` to select platforms. Products land in `dist-exe/` and the script syncs the selected carriers into `python/sdk-runtime/`. macOS builds also sync the matching spawn helper required by `node-pty`.

## Validate the SDK

Keep the virtual environment outside `python/`, install the test group, and run the Python suite:

```sh
export UV_PROJECT_ENVIRONMENT="$PWD/tmp/py-sdk-venv"
uv sync --project python/sdk --group test
uv run --project python/sdk pytest
```

`python/sdk/tests/test_bundled_runtime.py` exercises available bundled carriers and skips a carrier when its artifact has not been built. For repository-wide test policy, see [Testing](../docs/testing.md).

That suite drives fake runtime peers. `scripts/smoke-python-runtime.py` drives the real packaged runtime instead, and the required `python-runtime` CI job runs every scenario against a freshly built executable:

```sh
uv run --project python/sdk python scripts/smoke-python-runtime.py \
  --scenario sdk-minimal --exe dist-exe/dsh-jsonrpc-agent-pkg-macos-arm64
```

Two scenarios compare committed expected output under `scripts/snapshots/python-sdk-single-exe/`. `minimal/model-visible.json` pins the checked-in minimal composition's assembled system prompts, advertised tool schemas, and model-visible messages, so a plugin that contributes an unintended system section or user message fails the job; it drops the dynamic runtime-context snapshot, which the same composition emits on macOS and not on Linux ([#2488](https://github.com/deepseek-harness/deepseek-harness/issues/2488)). `advanced/` pins the SDK result and the persisted session logs. Rerun the owning scenario with `--update-snapshots` and review that diff before committing it.

An interactive smoke test needs `DEEPSEEK_API_KEY` in the environment or repository-root `.env`:

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    print(harness.run("say hi").final_response)
```

## Run against Node source

Repository contributors can select either development carrier:

- Set `DSH_RUNTIME_MODE=node` to use the built Node carrier on system Node `>=22.19`. The build script refreshes this carrier, but distributions never include or auto-select it.
- Set `launch_args_override=("./node_modules/.bin/tsx", "packages/examples/jsonrpc-demo/src/bin.ts")` with the repository root as `cwd` to run unbuilt TypeScript source. Supply `cordis=...` when the default configuration is not suitable.

See `python/sdk/tests/manual_sdk_agent_smoke.py` for a complete source-mode invocation.

## Build distributions

The root `package.json` version is authoritative for both Python distributions. The staging script injects that version into both wheels and pins the SDK to the same `deepseek-harness-runtime-bin` version.

Build the pure SDK wheel once and one runtime wheel on each native platform:

```sh
version="$(node -p "require('./package.json').version")"
python scripts/build-python-release.py --package sdk --output-dir dist-python
python scripts/build-python-release.py --package runtime --platform macos-arm64 --runtime-exe dist-exe/dsh-jsonrpc-agent-pkg-macos-arm64 --output-dir dist-python
pip install --find-links dist-python deepseek-harness-sdk=="$version"
```

The runtime distribution is wheel-only. The release pipeline publishes three platform wheels with the pure SDK wheel: Linux x64, Linux arm64, and macOS 14 or newer on arm64. A `python-v<repository-version>` tag is accepted only when it matches the repository version; prerelease repository versions such as `0.0.1-rc.1` use their normalized PEP 440 spelling, such as `0.0.1rc1`, inside wheel filenames and metadata.

## Validate a release candidate

Label a pull request `python-release-dry-run`, or manually run the GitHub `Release (Python)` workflow with `publish=false`, to build all four wheels, install the Linux release set on Python 3.10 and 3.14, check exact filenames and metadata, enforce PyPI's default per-file size limit, and retain one aggregate artifact with SHA-256 hashes. Both paths have no registry credentials; a pull request run cannot enter either publication job.

Public publication runs from the private automation repository; package metadata points to the separate read-only public source mirror, which does not run release Actions. The private repository defines the repository variable `PYPI_PUBLISHER_REPOSITORY` as its own `owner/name` and keeps `PUBLIC_PYPI_RELEASE_ENABLED=false` except during an intentional release.

Separate runtime and SDK jobs let an SDK upload failure resume without resending immutable runtime files. They accept `publish=true` only when the workflow runs from the configured publisher repository at the matching `python-v*` tag and the protected `pypi-runtime` and `pypi` environments approve the runtime and SDK jobs, respectively. PyPI Trusted Publishing still supplies short-lived OIDC credentials, but public attestations are disabled because they would disclose the private publisher identity.
