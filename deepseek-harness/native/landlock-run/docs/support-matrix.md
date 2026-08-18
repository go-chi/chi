# Support matrix

## Supported

| Platform package | GitHub runner (builder of record) | Notes |
|---|---|---|
| `@deepseek-ai/node-addon-landlock-run-linux-x64` | `ubuntu-24.04` | static musl — glibc and musl distros alike |
| `@deepseek-ai/node-addon-landlock-run-linux-arm64` | `ubuntu-24.04-arm` | static musl — glibc and musl distros alike |

Enforcement additionally requires a kernel with Landlock enabled (5.13+). The negotiated ABI level decides the probe verdict: every access this build knows governed → `full`; an older ABI governing a subset → `partial` (still confined for everything it supports); Landlock absent or disabled → `unusable`, and the launcher refuses to run commands at all. The probe — not the kernel version — is the authority: a kernel built without Landlock, or with the LSM disabled, probes `unusable` regardless of its version.

## Deliberately unsupported

- **darwin**: macOS consumers typically confine through `sandbox-exec`/Seatbelt, which ships with the OS — there is no binary to distribute.
- **win32**: a Windows confinement launcher would be a different mechanism in its own repository, not a port of this one.
- **Other Linux architectures** (riscv64, s390x, …): no native CI builder of record yet. The no-cross-toolchain rule means a platform package is added only together with a native runner that builds and proves it.

A consumer on an unsupported platform resolves a nonexistent launcher path, probes `unusable`, and falls closed — the documented degradation, exercised by CI's darwin leg.
