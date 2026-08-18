"""Keyless runtime-resolution tests; launch coverage lives in test_bundled_runtime.py."""

from __future__ import annotations

from pathlib import Path

import deepseek_harness_runtime as runtime
import pytest

from deepseek_harness_runtime import (
    RUNTIME_MODE_ENV_VAR,
    bundled_default_config_path,
    bundled_package_dir,
    resolve_bundled_launch_args,
)


def test_default_config_is_shipped_with_the_package() -> None:
    path = bundled_default_config_path()
    assert path == bundled_package_dir() / "runtime" / "cordis.yml"
    config = path.read_text()
    assert "@deepseek-ai/dsh-agent-spine-demo" in config
    assert "@deepseek-ai/dsh-session-persistence-jsonl" in config
    assert "@deepseek-ai/dsh-session-checkpoint-policy" in config


def test_unknown_explicit_mode_fails_loud() -> None:
    with pytest.raises(ValueError, match="expected 'exe' or 'node'"):
        resolve_bundled_launch_args("bogus")


def test_unknown_env_mode_fails_loud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, "bogus")
    with pytest.raises(ValueError, match="expected 'exe' or 'node'"):
        resolve_bundled_launch_args()


def test_explicit_mode_wins_over_env_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, "bogus")
    try:
        args = resolve_bundled_launch_args("exe")
    except FileNotFoundError:
        return  # explicit 'exe' was honored; only the artifact is missing
    assert args[0].endswith(("-x64", "-arm64"))


def test_runtime_requires_spawn_helper_only_on_macos(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()
    linux = runtime_dir / "dsh-jsonrpc-agent-pkg-linux-x64"
    linux.touch()
    (runtime_dir / "dsh-jsonrpc-agent-pkg-macos-arm64").touch()
    monkeypatch.setattr(runtime, "bundled_package_dir", lambda: tmp_path)

    monkeypatch.setattr(runtime, "_current_platform_tag", lambda: "macos-arm64")
    with pytest.raises(FileNotFoundError, match="node-pty spawn helper"):
        runtime.bundled_runtime_path()
    monkeypatch.setattr(runtime, "_current_platform_tag", lambda: "linux-x64")
    assert runtime.bundled_runtime_path() == linux
