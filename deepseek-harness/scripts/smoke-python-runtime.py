#!/usr/bin/env python3
"""Keyless full-turn and snapshot smoke for the Python SDK runtime."""

from __future__ import annotations

import argparse
import difflib
import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from deepseek_harness import RunResult


EXPECTED_TEXT = "runtime smoke ok"
CODE_PROMPT = "Use run_code to compute the packaged worker smoke value."
CODE_WORKER_TEXT = "code worker smoke ok"
WORKFLOW_PROMPT = "Use workflow to compute the packaged worker smoke value without agents."
WORKFLOW_WORKER_TEXT = "workflow worker smoke ok"
MINIMAL_PROMPT = "Exercise the packaged minimal agent's persistent Bash and string-replacement editor."
MINIMAL_TEXT = "minimal agent smoke ok"
MINIMAL_EDITOR_PATH_PREFIX = "Editor path: "
MINIMAL_CORDIS = (
    Path(__file__).resolve().parent.parent / "examples" / "jsonrpc-agent" / "minimal.cordis.yml"
)
MINIMAL_BASH_COMMAND = (
    "counter=$(( ${counter:-0} + 1 )); export counter; "
    "printf 'COUNT=%s CWD=%s\\n' \"$counter\" \"$PWD\"; "
    "if [ \"$counter\" -eq 1 ]; then cd /tmp; fi"
)
SNAPSHOT_PROMPT = "Run the advanced packaged-runtime snapshot scenario."
SNAPSHOT_SESSION_ID = "advanced-executable"
SNAPSHOT_DIRECT_CHILD_PROMPT = "Reply with exactly DIRECT_CHILD_OK and nothing else."
SNAPSHOT_WORKFLOW_CHILD_PROMPT = "Reply with exactly WORKFLOW_CHILD_OK and nothing else."
SNAPSHOT_FINAL_TEXT = "ADVANCED_EXECUTABLE_OK"
SNAPSHOT_PLUGIN_CODE = """\
return (ctx) => {
  harness.registerTool(ctx, harness.defineTool({
    name: 'snapshot_double',
    description: 'Double a number for executable snapshot verification.',
    parameters: { value: { type: 'number', required: true } },
    output: {
      schema: { type: 'number' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      }
    },
    async execute(args) {
      return args.value * 2
    }
  }))
}
"""
SNAPSHOT_WORKFLOW_SCRIPT = (
    "phase('Delegate')\n"
    f"const reply = await agent('{SNAPSHOT_WORKFLOW_CHILD_PROMPT}', {{ label: 'workflow-child' }})\n"
    "return { reply }"
)
ADVANCED_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "advanced"
)
ADVANCED_SNAPSHOT_FILENAMES = ("result.json", "session.jsonl", "session.1.jsonl", "session.2.jsonl")
MINIMAL_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "minimal"
)
MINIMAL_SNAPSHOT_FILENAMES = ("model-visible.json",)
# The agent loop's dynamic runtime-context snapshot is the one model-visible message this
# expected output cannot carry: the same composition emits it on macOS and not on Linux
# (deepseek-harness#2488), and the file must replay on both. Everything else is compared.
RUNTIME_CONTEXT_PREFIX = "Current runtime context"
CUSTOM_CORDIS = """\
- id: sdk-jsonrpc-server
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
- id: agent-core
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    workspaceContext: false
    skills:
      enabled: false
    toolBash: false
    tools:
      mode: both
- id: sessions
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js process.env.DSH_SESSION_ROOT
    compression: 'none'
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
- id: subagents
  name: '@deepseek-ai/dsh-subagent'
- id: subagent-spawn-in-process
  name: '@deepseek-ai/dsh-subagent-spawn-in-process'
  config:
    providerName: spawn
- id: subagent-tool
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
- id: workflow-engine
  name: '@deepseek-ai/dsh-workflow-worker-thread'
  config:
    provider: spawn
- id: workflow-tool
  name: '@deepseek-ai/dsh-tool-workflow'
- id: cordis-host-runner
  name: '@deepseek-ai/dsh-cordis-host-runner'
- id: cordis-tool
  name: '@deepseek-ai/dsh-tool-cordis'
"""
class MockModelHandler(BaseHTTPRequestHandler):
    """Return deterministic text, worker, and orchestration completions."""

    requests: list[dict[str, object]] = []

    def do_POST(self) -> None:
        content_length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(content_length))
        self.requests.append(body)
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        chunks = completion_chunks(body)
        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, _format: str, *_args: object) -> None:
        return


def completion_chunks(body: dict[str, object]) -> list[dict[str, object]]:
    """Choose the next deterministic model response from request history."""
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise AssertionError(f"model request has no messages: {body}")
    latest = messages[-1]
    if not isinstance(latest, dict):
        raise AssertionError(f"model request has an invalid latest message: {body}")

    if latest.get("role") == "tool":
        call_id, tool_name = latest_tool_call(messages)
        tool_text = message_text(latest.get("content"))
        minimal = minimal_tool_followup(body, call_id, tool_name, tool_text)
        if minimal is not None:
            return minimal
        advanced = advanced_tool_followup(body, call_id, tool_name, tool_text)
        if advanced is not None:
            return advanced
        if "42" not in tool_text:
            raise AssertionError(f"{tool_name} worker returned no expected value: {latest}")
        if tool_name == "run_code":
            return text_chunks(CODE_WORKER_TEXT)
        if tool_name == "workflow":
            return text_chunks(WORKFLOW_WORKER_TEXT)
        raise AssertionError(f"unexpected tool follow-up: {tool_name}")

    user_prompts = [
        message_text(message.get("content"))
        for message in reversed(messages)
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    minimal_prompt = next(
        (
            prompt
            for prompt in user_prompts
            if prompt.startswith(f"{MINIMAL_PROMPT}\n{MINIMAL_EDITOR_PATH_PREFIX}")
        ),
        None,
    )
    # The minimal composition's assembled system prompt, advertised tool schemas, and
    # model-visible messages are pinned by its snapshot, not asserted here.
    if minimal_prompt is not None:
        return tool_call_chunks(
            "minimal-bash-1",
            "bash",
            {"command": MINIMAL_BASH_COMMAND},
        )
    scenario_prompts = {
        SNAPSHOT_DIRECT_CHILD_PROMPT,
        SNAPSHOT_WORKFLOW_CHILD_PROMPT,
        SNAPSHOT_PROMPT,
        CODE_PROMPT,
        WORKFLOW_PROMPT,
    }
    prompt = next(
        (candidate for candidate in user_prompts if candidate in scenario_prompts),
        message_text(latest.get("content")),
    )
    if prompt == SNAPSHOT_DIRECT_CHILD_PROMPT:
        return text_chunks("DIRECT_CHILD_OK")
    if prompt == SNAPSHOT_WORKFLOW_CHILD_PROMPT:
        return text_chunks("WORKFLOW_CHILD_OK")
    if prompt == SNAPSHOT_PROMPT:
        assert_advertised_tool(body, "cordis_define")
        return tool_call_chunks(
            "advanced-define",
            "cordis_define",
            {
                "plugin": {"kind": "new", "idPrefix": "snap"},
                "name": "Snapshot Double",
                "purpose": "Expose a deterministic doubling tool for executable snapshot verification.",
                "code": {"host": SNAPSHOT_PLUGIN_CODE},
            },
        )
    if prompt == CODE_PROMPT:
        assert_advertised_tool(body, "run_code")
        return tool_call_chunks(
            "call-code-worker",
            "run_code",
            {"code": "return 6 * 7", "description": "Compute the smoke value"},
        )
    if prompt == WORKFLOW_PROMPT:
        assert_advertised_tool(body, "workflow")
        return tool_call_chunks(
            "call-workflow-worker",
            "workflow",
            {
                "script": "return 6 * 7",
                "meta": {
                    "name": "pkg-worker-smoke",
                    "description": "exercise the packaged workflow worker",
                },
            },
        )
    return text_chunks(EXPECTED_TEXT)


def minimal_tool_followup(
    body: dict[str, object],
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Verify the checked-in minimal composition's PTY and editor."""
    if not call_id.startswith("minimal-"):
        return None
    if call_id == "minimal-bash-1" and tool_name == "bash":
        if "COUNT=1" not in tool_text:
            raise AssertionError(f"first persistent bash call lost its output: {tool_text}")
        return tool_call_chunks(
            "minimal-bash-2",
            "bash",
            {"command": MINIMAL_BASH_COMMAND},
        )
    if call_id == "minimal-bash-2" and tool_name == "bash":
        if "COUNT=2 CWD=/tmp" not in tool_text:
            raise AssertionError(f"persistent bash did not retain state: {tool_text}")
        messages = body.get("messages")
        if not isinstance(messages, list):
            raise AssertionError("persistent editor smoke request has no messages")
        editor_path = next(
            (
                text.split(MINIMAL_EDITOR_PATH_PREFIX, 1)[1].strip()
                for message in messages
                if isinstance(message, dict) and message.get("role") == "user"
                for text in [message_text(message.get("content"))]
                if MINIMAL_EDITOR_PATH_PREFIX in text
            ),
            None,
        )
        if editor_path is None:
            raise AssertionError("persistent editor smoke prompt has no editor path")
        return tool_call_chunks(
            "minimal-editor",
            "str_replace_editor",
            {
                "command": "create",
                "path": editor_path,
                "file_text": "created by packaged editor\n",
            },
        )
    if call_id == "minimal-editor" and tool_name == "str_replace_editor":
        if "New file created successfully" not in tool_text:
            raise AssertionError(f"packaged editor did not create its file: {tool_text}")
        return text_chunks(MINIMAL_TEXT)
    raise AssertionError(f"unexpected minimal-agent follow-up: {call_id} {tool_name}: {tool_text}")


def advanced_tool_followup(
    body: dict[str, object],
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Advance the executable snapshot's deterministic parent tool chain."""
    if not call_id.startswith("advanced-"):
        return None
    if call_id == "advanced-define" and tool_name == "cordis_define":
        if "Defined snap-1/pkg-1 (Snapshot Double)" not in tool_text:
            raise AssertionError(f"cordis_define returned no dynamic Package ids: {tool_text}")
        if "snapshot_double" in advertised_tool_names(body):
            raise AssertionError("snapshot_double was advertised before cordis_run")
        assert_advertised_tool(body, "cordis_run")
        return tool_call_chunks(
            "advanced-run",
            "cordis_run",
            {"pluginId": "snap-1", "packageId": "pkg-1", "mode": "run"},
        )
    if call_id == "advanced-run" and tool_name == "cordis_run":
        if "snap-1/pkg-1 is running (run-1)" not in tool_text:
            raise AssertionError(f"cordis_run returned no running Package ids: {tool_text}")
        assert_advertised_tool(body, "run_code")
        assert_advertised_tool(body, "snapshot_double")
        return tool_call_chunks(
            "advanced-code",
            "run_code",
            {
                "code": "return await tools.snapshot_double({ value: 21 })",
                "description": "Run the temporary Plugin tool",
            },
        )
    if call_id == "advanced-code" and tool_name == "run_code":
        if "42" not in tool_text:
            raise AssertionError(f"run_code returned no dynamic-tool value: {tool_text}")
        assert_advertised_tool(body, "subagent")
        return tool_call_chunks(
            "advanced-direct-child",
            "subagent",
            {
                "description": "Check direct child",
                "prompt": SNAPSHOT_DIRECT_CHILD_PROMPT,
            },
        )
    if call_id == "advanced-direct-child" and tool_name == "subagent":
        if "DIRECT_CHILD_OK" not in tool_text:
            raise AssertionError(f"subagent returned no expected child value: {tool_text}")
        assert_advertised_tool(body, "workflow")
        return tool_call_chunks(
            "advanced-workflow",
            "workflow",
            {
                "script": SNAPSHOT_WORKFLOW_SCRIPT,
                "meta": {
                    "name": "advanced-exe-snapshot",
                    "description": "exercise one packaged workflow child",
                },
            },
        )
    if call_id == "advanced-workflow" and tool_name == "workflow":
        if "WORKFLOW_CHILD_OK" not in tool_text:
            raise AssertionError(f"workflow returned no expected child value: {tool_text}")
        assert_advertised_tool(body, "cordis_undefine")
        return tool_call_chunks(
            "advanced-undefine",
            "cordis_undefine",
            {"pluginId": "snap-1"},
        )
    if call_id == "advanced-undefine" and tool_name == "cordis_undefine":
        if "Removed dynamic Plugin snap-1 and all of its Packages." not in tool_text:
            raise AssertionError(f"cordis_undefine returned no removal result: {tool_text}")
        if "snapshot_double" in advertised_tool_names(body):
            raise AssertionError("snapshot_double remained advertised after cordis_undefine")
        return text_chunks(SNAPSHOT_FINAL_TEXT)
    raise AssertionError(f"unexpected advanced tool follow-up: {call_id} {tool_name}: {tool_text}")


def text_chunks(text: str) -> list[dict[str, object]]:
    """Build a complete streaming text response."""
    return [
        {"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]},
        {"choices": [{"delta": {"content": text}}]},
        {
            "choices": [{"delta": {"content": ""}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 3},
        },
    ]


def tool_call_chunks(call_id: str, name: str, arguments: dict[str, object]) -> list[dict[str, object]]:
    """Build a complete streaming function-call response."""
    return [
        {"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]},
        {
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments)},
                    }],
                },
            }],
        },
        {
            "choices": [{"delta": {"content": ""}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 3},
        },
    ]


def latest_tool_call(messages: list[object]) -> tuple[str, str]:
    """Find the assistant call id and name paired with the latest tool result."""
    for message in reversed(messages[:-1]):
        if not isinstance(message, dict):
            continue
        calls = message.get("tool_calls")
        if not isinstance(calls, list):
            continue
        for call in reversed(calls):
            if not isinstance(call, dict):
                continue
            function = call.get("function")
            call_id = call.get("id")
            if (
                isinstance(call_id, str)
                and isinstance(function, dict)
                and isinstance(function.get("name"), str)
            ):
                return call_id, function["name"]
    raise AssertionError(f"tool result has no preceding assistant tool call: {messages}")


def message_text(content: object) -> str:
    """Read OpenAI text content in either string or block-list form."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )
    return ""


def advertised_tool_names(body: dict[str, object]) -> set[str]:
    """Return the model-facing tool names advertised on one request."""
    tools = body.get("tools")
    if not isinstance(tools, list):
        raise AssertionError(f"model request advertised no tools: {body}")
    names: set[str] = set()
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            names.add(function["name"])
    return names


def assert_advertised_tool(body: dict[str, object], expected: str) -> None:
    """Require the packaged deployment to expose the requested tool."""
    names = advertised_tool_names(body)
    if expected not in names:
        raise AssertionError(f"model request did not advertise {expected}: {names}")


class MockModel:
    def __enter__(self) -> "MockModel":
        MockModelHandler.requests.clear()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.url = f"http://{host}:{port}"
        return self

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        choices=("all", "sdk-default", "sdk-custom", "sdk-minimal", "sdk-snapshot", "direct"),
        default="all",
    )
    parser.add_argument("--exe", type=Path)
    parser.add_argument("--update-snapshots", action="store_true")
    args = parser.parse_args()
    if args.scenario in {"all", "sdk-custom", "sdk-minimal", "sdk-snapshot", "direct"} and args.exe is None:
        parser.error("--exe is required for custom, minimal, snapshot, and direct scenarios")
    if args.update_snapshots and args.scenario not in {"all", "sdk-minimal", "sdk-snapshot"}:
        parser.error("--update-snapshots requires --scenario sdk-minimal, sdk-snapshot, or all")
    if args.exe is not None and not args.exe.is_file():
        parser.error(f"runtime executable does not exist: {args.exe}")

    with MockModel() as model:
        if args.scenario in {"all", "sdk-default"}:
            smoke_sdk_default(model.url)
        if args.scenario in {"all", "sdk-custom"}:
            assert args.exe is not None
            smoke_sdk_custom(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-minimal"}:
            assert args.exe is not None
            smoke_sdk_minimal(model.url, args.exe.resolve(), args.update_snapshots)
        if args.scenario in {"all", "sdk-snapshot"}:
            assert args.exe is not None
            smoke_sdk_snapshot(model.url, args.exe.resolve(), args.update_snapshots)
        if args.scenario in {"all", "direct"}:
            assert args.exe is not None
            smoke_direct(model.url, args.exe.resolve())
        if not MockModelHandler.requests:
            raise AssertionError("mock model endpoint received no requests")
    print(f"smoke-python-runtime: {args.scenario} passed")


def smoke_sdk_default(base_url: str) -> None:
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-default-") as temporary:
        root = Path(temporary).resolve()
        sessions = root / "sessions"
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            session_root=str(sessions),
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run("reply with the smoke text", session_id="default-smoke")
        assert result.final_response == EXPECTED_TEXT, result.final_response
        assert_zstd_session_log(sessions)


def smoke_sdk_custom(base_url: str, executable: Path) -> None:
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-custom-") as temporary:
        root = Path(temporary).resolve()
        sessions = root / "sessions"
        cordis = root / "cordis.yml"
        cordis.write_text(CUSTOM_CORDIS)
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            session_root=str(sessions),
            cordis=str(cordis),
            runtime_bin=str(executable),
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            text_result = harness.run("reply with the smoke text", session_id="custom-smoke")
            code_result = harness.run(CODE_PROMPT, session_id="custom-smoke")
            workflow_result = harness.run(WORKFLOW_PROMPT, session_id="custom-smoke")
        assert text_result.final_response == EXPECTED_TEXT, text_result.final_response
        assert code_result.final_response == CODE_WORKER_TEXT, code_result.final_response
        assert workflow_result.final_response == WORKFLOW_WORKER_TEXT, workflow_result.final_response
        assert_session_log(sessions, root, EXPECTED_TEXT, CODE_WORKER_TEXT, WORKFLOW_WORKER_TEXT)


def smoke_sdk_minimal(base_url: str, executable: Path, update_snapshots: bool) -> None:
    """Exercise the checked-in minimal composition through the packaged executable."""
    from deepseek_harness import DeepSeekHarness

    # One mock model serves every scenario of a run, so the snapshot takes this turn's slice.
    first_request = len(MockModelHandler.requests)
    with tempfile.TemporaryDirectory(prefix="dsh-sdk-minimal-") as temporary:
        root = Path(temporary).resolve()
        editor_path = root / "created.txt"
        prompt = f"{MINIMAL_PROMPT}\n{MINIMAL_EDITOR_PATH_PREFIX}{editor_path}"
        sessions = root / "sessions"
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            session_root=str(sessions),
            cordis=str(MINIMAL_CORDIS),
            runtime_bin=str(executable),
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run(prompt, session_id="minimal-agent-smoke")

        event_text = json.dumps(result.events)
        if MINIMAL_TEXT not in event_text:
            raise AssertionError(f"minimal agent run emitted no final response: {result.events}")
        if editor_path.read_text() != "created by packaged editor\n":
            raise AssertionError(f"packaged editor wrote unexpected content: {editor_path.read_text()!r}")
        assert_session_log(sessions, root, MINIMAL_TEXT, "COUNT=1", "COUNT=2 CWD=/tmp")

        files = build_minimal_snapshot_files(MockModelHandler.requests[first_request:], root)
        compare_snapshot_files(
            files, update_snapshots, MINIMAL_SNAPSHOT_DIRECTORY, MINIMAL_SNAPSHOT_FILENAMES,
        )


def smoke_sdk_snapshot(base_url: str, executable: Path, update_snapshots: bool) -> None:
    """Drive and compare the advanced SDK/executable behavioral snapshot."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-snapshot-") as temporary:
        root = Path(temporary).resolve()
        sessions = root / "sessions"
        cordis = root / "cordis.yml"
        cordis.write_text(CUSTOM_CORDIS)
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            session_root=str(sessions),
            cordis=str(cordis),
            runtime_bin=str(executable),
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run(SNAPSHOT_PROMPT, session_id=SNAPSHOT_SESSION_ID)

        assert result.final_response == SNAPSHOT_FINAL_TEXT, result.final_response
        methods = [notification.method for notification in result.notifications]
        if methods.count("subagent.started") != 2 or methods.count("subagent.finished") != 2:
            raise AssertionError(f"advanced snapshot emitted unexpected subagent lifecycle: {methods}")
        if not any(event.get("type") == "tool/code-dispatch" for event in result.events):
            raise AssertionError("advanced snapshot emitted no tool/code-dispatch event")

        logs = read_session_logs(sessions)
        child_ids = snapshot_child_ids(result)
        expected_ids = {SNAPSHOT_SESSION_ID, *child_ids}
        if set(logs) != expected_ids:
            raise AssertionError(f"advanced snapshot expected parent plus two child logs: {sorted(logs)}")
        if "DIRECT_CHILD_OK" not in render_jsonl(logs[child_ids[0]]):
            raise AssertionError("first advanced child log has no direct-subagent result")
        if "WORKFLOW_CHILD_OK" not in render_jsonl(logs[child_ids[1]]):
            raise AssertionError("second advanced child log has no workflow-subagent result")

        files = build_snapshot_files(result, logs, child_ids, root)
        compare_snapshot_files(
            files, update_snapshots, ADVANCED_SNAPSHOT_DIRECTORY, ADVANCED_SNAPSHOT_FILENAMES,
        )


def smoke_direct(base_url: str, executable: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="dsh-direct-") as temporary:
        root = Path(temporary).resolve()
        sessions = root / "sessions"
        cordis = root / "cordis.yml"
        cordis.write_text(CUSTOM_CORDIS)
        environment = {
            **os.environ,
            "DSH_CORDIS_CONFIG": str(cordis),
            "DSH_SESSION_ROOT": str(sessions),
            "DSH_CWD": str(root),
            "DEEPSEEK_API_KEY": "sk-keyless-smoke",
            "DEEPSEEK_BASE_URL": base_url,
        }
        peer = RuntimePeer([str(executable)], root, environment)
        try:
            peer.send({"jsonrpc": "2.0", "id": "initialize", "method": "initialize", "params": {"cwd": str(root), "provider": "deepseek-official", "model": "smoke-model"}})
            peer.read_until(lambda message: message.get("id") == "initialize")
            peer.send({
                "jsonrpc": "2.0",
                "id": "prompt",
                "method": "session/prompt",
                "params": {"sessionId": "direct-smoke", "contentBlocks": [{"type": "text", "text": "reply with the smoke text"}]},
            })
            messages = peer.read_until(lambda message: message.get("id") == "prompt")
            if not any(is_idle_notification(message) for message in messages):
                messages.extend(peer.read_until(is_idle_notification))
            event_text = json.dumps(messages)
            if EXPECTED_TEXT not in event_text:
                raise AssertionError(f"direct runtime emitted no final response: {messages}")
            peer.send({"jsonrpc": "2.0", "id": "shutdown", "method": "shutdown"})
            peer.read_until(lambda message: message.get("id") == "shutdown")
        finally:
            peer.close()
        assert_session_log(sessions, root, EXPECTED_TEXT)


def is_idle_notification(message: dict[str, object]) -> bool:
    """Return whether a JSON-RPC notification marks a session idle."""
    params = message.get("params")
    return (
        message.get("method") == "session.status"
        and isinstance(params, dict)
        and params.get("status") == "idle"
    )


class RuntimePeer:
    def __init__(self, argv: list[str], cwd: Path, environment: dict[str, str]) -> None:
        self.process = subprocess.Popen(
            argv,
            cwd=cwd,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self.stdout: queue.Queue[str | None] = queue.Queue()
        self.stderr: list[str] = []
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def send(self, message: dict[str, object]) -> None:
        if self.process.stdin is None:
            raise RuntimeError("runtime stdin is unavailable")
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def read_until(self, predicate: Callable[[dict[str, object]], bool]) -> list[dict[str, object]]:
        deadline = time.monotonic() + 60
        messages: list[dict[str, object]] = []
        while time.monotonic() < deadline:
            try:
                line = self.stdout.get(timeout=min(0.25, deadline - time.monotonic()))
            except queue.Empty:
                continue
            if line is None:
                raise RuntimeError(f"runtime exited before expected message; stderr: {''.join(self.stderr)}")
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            messages.append(message)
            if predicate(message):
                return messages
        raise TimeoutError(f"runtime timed out; messages={messages}; stderr={''.join(self.stderr)}")

    def close(self) -> None:
        if self.process.stdin is not None and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        if self.process.returncode not in {0, -15}:
            raise RuntimeError(f"runtime exited {self.process.returncode}; stderr: {''.join(self.stderr)}")

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.stdout.put(line)
        self.stdout.put(None)

    def _read_stderr(self) -> None:
        assert self.process.stderr is not None
        self.stderr.extend(self.process.stderr)


def assert_session_log(sessions: Path, cwd: Path, *expected_texts: str) -> None:
    logs = list(sessions.rglob("*.jsonl"))
    if len(logs) != 1:
        raise AssertionError(f"expected one JSONL session log under {sessions}, found {logs}")
    lines = logs[0].read_text().splitlines()
    header = json.loads(lines[0])
    if header.get("cwd") != str(cwd):
        raise AssertionError(f"session header cwd is not absolute/canonical: {header}")
    rendered = "\n".join(lines)
    for expected in expected_texts:
        if expected not in rendered:
            raise AssertionError(f"session log has no {expected!r} response: {logs[0]}")


def assert_zstd_session_log(sessions: Path) -> None:
    logs = list(sessions.rglob("*.jsonl.zstd"))
    if len(logs) != 1:
        raise AssertionError(f"expected one Zstandard JSONL session log under {sessions}, found {logs}")
    if not logs[0].read_bytes().startswith(bytes.fromhex("28b52ffd")):
        raise AssertionError(f"session log has no Zstandard magic: {logs[0]}")


def read_session_logs(sessions: Path) -> dict[str, list[dict[str, object]]]:
    """Parse every persisted JSONL session into a map keyed by header id."""
    logs: dict[str, list[dict[str, object]]] = {}
    for path in sorted(sessions.rglob("*.jsonl")):
        records = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        ]
        if not records or records[0].get("type") != "session":
            raise AssertionError(f"session log has no header: {path}")
        session_id = records[0].get("id")
        if not isinstance(session_id, str):
            raise AssertionError(f"session log header has no string id: {path}")
        if session_id in logs:
            raise AssertionError(f"duplicate persisted session id: {session_id}")
        logs[session_id] = records
    return logs


def snapshot_child_ids(result: "RunResult") -> list[str]:
    """Return the two child session ids in their SDK notification order."""
    child_ids: list[str] = []
    for notification in result.notifications:
        if notification.method != "subagent.started":
            continue
        payload = notification.payload
        if payload.get("parentSessionId") != SNAPSHOT_SESSION_ID:
            continue
        child_id = payload.get("childSessionId")
        if isinstance(child_id, str) and child_id not in child_ids:
            child_ids.append(child_id)
    if len(child_ids) != 2:
        raise AssertionError(f"advanced snapshot expected two child session ids: {child_ids}")
    return child_ids


def build_minimal_snapshot_files(
    requests: list[dict[str, object]],
    cwd: Path,
) -> dict[str, str]:
    """Render the minimal composition's model-visible surface as expected output.

    Every assembled system prompt, advertised tool schema, and system or user message is
    kept verbatim: they carry what the deployment actually shows the model, so a plugin
    that contributes an unintended system section or user message cannot pass unnoticed.
    Assistant and tool payloads keep only their call identity, and the dynamic
    runtime-context snapshot is dropped, because their text differs across the platforms
    this expected output must replay on.
    """
    snapshot = []
    for body in requests:
        messages = body.get("messages")
        if not isinstance(messages, list):
            raise AssertionError(f"minimal model request has no messages: {body}")
        snapshot.append({
            "tools": minimal_snapshot_text(body.get("tools"), cwd),
            "messages": [
                minimal_snapshot_message(message, cwd)
                for message in messages
                if not is_runtime_context_message(message)
            ],
        })
    return {"model-visible.json": json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n"}


def is_runtime_context_message(message: object) -> bool:
    """Identify the agent loop's dynamic runtime-context snapshot, current or cleared."""
    return (
        isinstance(message, dict)
        and message.get("role") == "user"
        and message_text(message.get("content")).startswith(RUNTIME_CONTEXT_PREFIX)
    )


def minimal_snapshot_message(message: object, cwd: Path) -> dict[str, object]:
    """Reduce one model-visible message to its stable, behavior-carrying parts."""
    if not isinstance(message, dict):
        raise AssertionError(f"minimal model request has an invalid message: {message}")
    role = message.get("role")
    if role in ("system", "user"):
        return {"role": role, "text": minimal_snapshot_text(message_text(message.get("content")), cwd)}
    if role == "assistant":
        calls = message.get("tool_calls")
        if not isinstance(calls, list):
            raise AssertionError(f"minimal assistant message has no tool calls: {message}")
        return {
            "role": role,
            "toolCalls": [
                {"id": call.get("id"), "name": (call.get("function") or {}).get("name")}
                for call in calls
                if isinstance(call, dict)
            ],
        }
    if role == "tool":
        return {"role": role, "toolCallId": message.get("tool_call_id"), "text": "{{tool-result}}"}
    raise AssertionError(f"minimal model request has an unexpected message role: {message}")


def minimal_snapshot_text(value: object, cwd: Path) -> object:
    """Replace the scenario's temporary working directory everywhere it appears."""
    if isinstance(value, str):
        return value.replace(str(cwd), "{{cwd}}")
    if isinstance(value, list):
        return [minimal_snapshot_text(item, cwd) for item in value]
    if isinstance(value, dict):
        return {key: minimal_snapshot_text(item, cwd) for key, item in value.items()}
    return value


def build_snapshot_files(
    result: "RunResult",
    logs: dict[str, list[dict[str, object]]],
    child_ids: list[str],
    cwd: Path,
) -> dict[str, str]:
    """Render the SDK result and three persisted logs into stable expected outputs."""
    replacements = [(str(cwd), "{{cwd}}"), (SNAPSHOT_SESSION_ID, "{{parent}}")]
    replacements.append((snapshot_workflow_run_id(result), "{{workflow-run}}"))
    for index, child_id in enumerate(child_ids, start=1):
        replacements.append((child_id, f"{{{{child-{index}}}}}"))
        agent_id = snapshot_agent_id(result, child_id)
        replacements.append((agent_id, f"{{{{agent-{index}}}}}"))
    replacements.sort(key=lambda pair: len(pair[0]), reverse=True)

    result_value = {
        "session_id": result.session_id,
        "final_response": result.final_response,
        "events": result.events,
        "notifications": [
            {"method": notification.method, "payload": notification.payload}
            for notification in result.notifications
        ],
        "session_root": result.session_root,
    }
    normalized_result = normalize_snapshot_value(result_value, replacements)
    files = {
        "result.json": json.dumps(normalized_result, indent=2, ensure_ascii=False) + "\n",
        "session.jsonl": render_jsonl(
            [normalize_snapshot_value(record, replacements) for record in logs[SNAPSHOT_SESSION_ID]]
        ),
    }
    for index, child_id in enumerate(child_ids, start=1):
        files[f"session.{index}.jsonl"] = render_jsonl(
            [normalize_snapshot_value(record, replacements) for record in logs[child_id]]
        )
    return files


def snapshot_workflow_run_id(result: "RunResult") -> str:
    """Return the one workflow run id emitted by the advanced scenario."""
    run_ids: set[str] = set()
    for event in result.events:
        event_type = event.get("type")
        data = event.get("data")
        if not isinstance(event_type, str) or not event_type.startswith("tool-workflow/"):
            continue
        if isinstance(data, dict) and isinstance(data.get("runId"), str):
            run_ids.add(data["runId"])
    if len(run_ids) != 1:
        raise AssertionError(f"advanced snapshot expected one workflow run id: {sorted(run_ids)}")
    return next(iter(run_ids))


def snapshot_agent_id(result: "RunResult", child_id: str) -> str:
    """Find the successful subagent id paired with one child session."""
    for notification in result.notifications:
        if notification.method != "subagent.finished":
            continue
        payload = notification.payload
        if payload.get("childSessionId") != child_id:
            continue
        if payload.get("provider") != "spawn" or payload.get("status") != "ok":
            raise AssertionError(f"advanced child did not finish successfully: {payload}")
        agent_id = payload.get("agentId")
        if isinstance(agent_id, str):
            return agent_id
    raise AssertionError(f"advanced snapshot has no finished agent for child {child_id}")


def normalize_snapshot_value(
    value: object,
    replacements: list[tuple[str, str]],
) -> object:
    """Scrub volatile values and bulky request headers without losing behavior."""
    if isinstance(value, str):
        normalized = value
        for actual, token in replacements:
            normalized = normalized.replace(actual, token)
        return normalized
    if isinstance(value, list):
        return [normalize_snapshot_value(item, replacements) for item in value]
    if not isinstance(value, dict):
        return value

    normalized = {
        key: normalize_snapshot_value(item, replacements)
        for key, item in value.items()
    }
    if normalized.get("type") == "session" and "createdAt" in normalized:
        normalized["createdAt"] = 0
    if "seq" in normalized and "time" in normalized:
        normalized["time"] = 0
    if isinstance(normalized.get("id"), str) and normalized.get("role") in ("assistant", "user"):
        normalized["id"] = "{{messageId}}"
    scrub_snapshot_header(normalized)
    return normalized


def scrub_snapshot_header(value: dict[object, object]) -> None:
    """Tokenize full request-header bulk while retaining tool names."""
    data = value.get("data")
    if not isinstance(data, dict):
        return
    if value.get("type") == "request/header":
        header = data.get("header")
        if not isinstance(header, dict):
            return
        if "system" in header:
            header["system"] = "{{system}}"
        tools = header.get("tools")
        if isinstance(tools, list):
            header["tools"] = [
                tool.get("name") if isinstance(tool, dict) else "{{tools}}"
                for tool in tools
            ]


def render_jsonl(records: list[object]) -> str:
    """Render parsed JSON values as compact, newline-terminated JSONL."""
    return "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    )


def compare_snapshot_files(
    files: dict[str, str],
    update: bool,
    directory: Path,
    filenames: tuple[str, ...],
) -> None:
    """Write or exactly compare one scenario's expected snapshot files."""
    scenario = directory.name
    if tuple(files) != filenames:
        raise AssertionError(f"{scenario} snapshot builder produced {tuple(files)}, expected {filenames}")
    if update:
        directory.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (directory / name).write_text(content, encoding="utf-8")
        print(f"smoke-python-runtime: updated snapshots in {directory}")

    existing = {
        path.name
        for path in directory.iterdir()
        if path.is_file()
    } if directory.is_dir() else set()
    expected = set(filenames)
    if existing != expected:
        raise AssertionError(
            f"{scenario} snapshot files differ: "
            f"missing={sorted(expected - existing)}, unexpected={sorted(existing - expected)}"
        )
    for name, actual in files.items():
        expected_text = (directory / name).read_text(encoding="utf-8")
        if actual == expected_text:
            continue
        diff = "".join(difflib.unified_diff(
            expected_text.splitlines(keepends=True),
            actual.splitlines(keepends=True),
            fromfile=f"expected/{name}",
            tofile=f"actual/{name}",
        ))
        raise AssertionError(
            f"{scenario} executable snapshot mismatch in {name}; "
            "rerun with --update-snapshots after reviewing the behavior\n"
            f"{diff}"
        )


if __name__ == "__main__":
    main()
