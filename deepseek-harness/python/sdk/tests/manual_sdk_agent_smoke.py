"""Drive the repo-source JSON-RPC bin through the SDK and a keyless mock SSE server.

Requires ``pnpm install`` but no build. This manual test is not collected by
pytest; run ``python tests/manual_sdk_agent_smoke.py``.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from deepseek_harness import DeepSeekHarness
from deepseek_harness_runtime import bundled_default_config_path


class MockCompletionHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        self.requests.append({
            "path": self.path,
            "authorization": self.headers.get("authorization"),
            "body": json.loads(body),
        })
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        self.wfile.write(b'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n')
        self.wfile.write(b'data: {"choices":[{"delta":{"content":"SDK runtime reached the configured HTTP model endpoint."}}]}\n\n')
        self.wfile.write(b'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":9}}\n\n')
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, _format: str, *_args: object) -> None:
        return


def run_smoke(repo_root: Path, keep_sessions: bool) -> None:
    session_root = Path(tempfile.mkdtemp(prefix="dsh-sdk-smoke-sessions-"))
    runtime_entry = repo_root / "packages/examples/jsonrpc-demo/src/bin.ts"
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockCompletionHandler)
    thread = threading.Thread(target=server.serve_forever, name="mock-openai-compatible-server", daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    print(f"repo_root={repo_root}")
    print(f"session_root={session_root}")
    print(f"mock_base_url={base_url}")

    try:
        with DeepSeekHarness(
            model="sdk-smoke-model",
            cwd=str(repo_root / "python/sdk"),
            runtime_cwd=str(repo_root),
            session_root=str(session_root),
            cordis=str(bundled_default_config_path()),
            launch_args_override=("node", "--import", "tsx", str(runtime_entry)),
            env={
                "DEEPSEEK_BASE_URL": base_url,
                "DEEPSEEK_API_KEY": "sdk-smoke-key",
            },
            request_timeout_seconds=20,
            shutdown_timeout_seconds=2,
        ) as harness:
            result = harness.run(
                "Please reply with a short confirmation and do not call tools.",
                session_id="sdk-smoke-main",
            )
        print(f"final_response={result.final_response}")
        assert "configured HTTP model endpoint" in result.final_response
        assert len(MockCompletionHandler.requests) == 1
        request = MockCompletionHandler.requests[0]
        print(json.dumps(request, ensure_ascii=False, indent=2)[:4000])
        assert request["authorization"] == "Bearer sdk-smoke-key"
        assert request["body"]["model"] == "sdk-smoke-model"

        jsonl_files = sorted(session_root.rglob("*.jsonl.zstd"))
        assert jsonl_files, f"no Zstandard JSONL sessions were written under {session_root}"
        print("session_jsonl_zstd_files:")
        for path in jsonl_files:
            print(f"  {path} bytes={path.stat().st_size}")
            assert path.read_bytes().startswith(bytes.fromhex("28b52ffd"))
    finally:
        server.shutdown()
        server.server_close()

    if keep_sessions:
        print(f"kept_session_root={session_root}")
    else:
        shutil.rmtree(session_root)
        print("removed temporary session root")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="Path to the deepseek-harness checkout.",
    )
    parser.add_argument("--keep-sessions", action="store_true")
    args = parser.parse_args()
    run_smoke(args.repo_root.resolve(), args.keep_sessions)


if __name__ == "__main__":
    main()
