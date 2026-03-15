import os
import copy
import json
import re
import shlex
import subprocess
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Any
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from openai import AzureOpenAI
import requests as http_requests

# Import validation functions from engine.py
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine import validate_connector_shape, validate_configuration, OrchestratorError

load_dotenv()

app = FastAPI(title="OpenAI Python Server", version="1.0.0")

IGNORED_TOP_LEVEL_KEYS = {
    "schemaVersion",
    "connectorType",
    "displayName",
    "description",
    "version",
    "notes",
    "files",
}


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1)
    enable_internet_search: bool = Field(default=False, description="Enable web search/grounding for real-time information")
    api_docs: str | None = Field(default=None, description="Optional API documentation URLs or references. Use + to separate multiple entries (e.g., 'https://api1.com/docs + https://api2.com/docs')")
    documentation: str | None = Field(default=None, description="Optional additional documentation, guides, or specifications. Use + to separate multiple entries")


class ChatResponse(BaseModel):
    model: str
    reply: str


class CodeCheckerRequest(BaseModel):
    connector_json: str = Field(min_length=1, description="Connector JSON to validate and improve")
    model: str | None = None
    enable_internet_search: bool = Field(default=False, description="Enable web search/grounding for real-time information")


class CodeCheckerResponse(BaseModel):
    model: str
    original_valid: bool
    validation_errors: list[str] | None = None
    improved_json: str
    changes_made: list[str]
    recommendations: list[str] | None = None


class ExecuteConnectorRequest(BaseModel):
    connector: dict[str, Any]
    configuration_overrides: dict[str, Any] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)
    timeout_ms: int | None = Field(default=None, ge=100, le=300000)
    network_mode: Literal["bridge", "none"] | None = None


class ExecuteConnectorResponse(BaseModel):
    ok: bool
    result: dict[str, Any] | list[Any] | str | int | float | bool | None = None
    error: str | None = None
    exit_code: int
    duration_ms: int
    stdout: str | None = None
    stderr: str | None = None



def _load_prompt_template() -> str:
    """Load the connector JSON schema prompt from fixtures/how to prompt.txt"""
    prompt_path = Path(__file__).parent.parent / "fixtures" / "how to prompt.txt"
    try:
        with open(prompt_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Prompt template file not found")


def _validate_connector_json(connector_json: dict[str, Any]) -> tuple[bool, str | None]:
    """Validate connector JSON using engine.py validators.
    Returns (is_valid, error_message)
    """
    try:
        # Validate shape (files, requirements, runtime)
        validate_connector_shape(connector_json)
        
        # Validate configuration if present
        configuration = connector_json.get("configuration", {})
        configuration_types = connector_json.get("configurationTypes")
        if configuration and configuration_types:
            validate_configuration(configuration, configuration_types)
        
        return True, None
    except OrchestratorError as e:
        return False, str(e)
    except Exception as e:
        return False, f"Validation error: {str(e)}"


def _extract_json_from_text(text: str) -> dict[str, Any] | None:
    """Extract JSON object from text, handling markdown code blocks."""
    # Try to find JSON within markdown code blocks
    json_patterns = [
        r"```json\s*\n(.*?)\n```",
        r"```\s*\n(.*?)\n```",
        r"\{[^}]*\}",
    ]
    
    for pattern in json_patterns:
        matches = re.findall(pattern, text, re.DOTALL)
        for match in matches:
            try:
                return json.loads(match)
            except json.JSONDecodeError:
                continue
    
    # Try parsing the entire text as JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _get_client() -> AzureOpenAI:
    api_key = os.getenv('AZURE_OPENAI_API_KEY')
    endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
    api_version ='2024-10-21'

    if not api_key:
        raise HTTPException(status_code=500, detail="AZURE_OPENAI_API_KEY is not set")
    if not endpoint:
        raise HTTPException(status_code=500, detail="AZURE_OPENAI_ENDPOINT is not set")

    return AzureOpenAI(
        api_key=api_key,
        azure_endpoint=endpoint,
        api_version=api_version,
    )


def _validate_relative_file_path(path_str: str) -> None:
    if not path_str:
        raise HTTPException(status_code=400, detail="files keys cannot be empty")

    file_path = PurePosixPath(path_str)
    if file_path.is_absolute() or ".." in file_path.parts:
        raise HTTPException(status_code=400, detail=f"Invalid file path in connector.files: {path_str}")


def _validate_connector(connector: dict[str, Any]) -> None:
    runtime = connector.get("runtime")
    if not isinstance(runtime, dict):
        raise HTTPException(status_code=400, detail="connector.runtime must be an object")

    language = runtime.get("language")
    if language != "python":
        raise HTTPException(status_code=400, detail="Only runtime.language='python' is currently supported")

    entry_point = runtime.get("entryPoint")
    if not isinstance(entry_point, str) or not entry_point.strip():
        raise HTTPException(status_code=400, detail="connector.runtime.entryPoint is required")

    dependencies = runtime.get("dependencies")
    if dependencies is not None:
        _normalize_runtime_dependencies(dependencies)

    files = connector.get("files")
    if not isinstance(files, dict) or not files:
        raise HTTPException(status_code=400, detail="connector.files must be a non-empty object")

    _validate_relative_file_path(entry_point)

    for name, content in files.items():
        if not isinstance(name, str):
            raise HTTPException(status_code=400, detail="connector.files keys must be strings")
        _validate_relative_file_path(name)
        if not isinstance(content, str):
            raise HTTPException(status_code=400, detail=f"connector.files['{name}'] must be a string")

    if entry_point not in files:
        raise HTTPException(status_code=400, detail=f"Entry point '{entry_point}' not found in connector.files")


def _parse_json_if_possible(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _normalize_runtime_dependencies(raw_dependencies: Any) -> list[str]:
    def _validate_name(name: Any) -> str:
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(status_code=400, detail="runtime.dependencies name must be a non-empty string")
        name = name.strip()
        if not re.match(r"^[A-Za-z0-9_.-]+$", name):
            raise HTTPException(status_code=400, detail=f"Invalid dependency name: {name}")
        return name

    def _validate_version(version: Any) -> str:
        if version is None:
            return ""
        if not isinstance(version, str) or not version.strip():
            raise HTTPException(status_code=400, detail="runtime.dependencies version must be a string when provided")
        version = version.strip()
        if " " in version:
            raise HTTPException(status_code=400, detail=f"Invalid dependency version: {version}")
        return version

    normalized: list[str] = []

    if isinstance(raw_dependencies, dict):
        for name, version in raw_dependencies.items():
            dep_name = _validate_name(name)
            dep_version = _validate_version(version)
            normalized.append(f"{dep_name}=={dep_version}" if dep_version else dep_name)
        return sorted(normalized)

    if isinstance(raw_dependencies, list):
        for item in raw_dependencies:
            if isinstance(item, str):
                dep_name = _validate_name(item)
                normalized.append(dep_name)
                continue

            if not isinstance(item, dict):
                raise HTTPException(
                    status_code=400,
                    detail="runtime.dependencies list items must be strings or objects with name/version",
                )

            dep_name = _validate_name(item.get("name"))
            dep_version = _validate_version(item.get("version"))
            normalized.append(f"{dep_name}=={dep_version}" if dep_version else dep_name)

        return sorted(set(normalized))

    raise HTTPException(
        status_code=400,
        detail="runtime.dependencies must be an array or object",
    )


def _path_exists(obj: dict[str, Any], dotted_path: str) -> bool:
    current: Any = obj
    for part in dotted_path.split("."):
        if not isinstance(current, dict) or part not in current:
            return False
        current = current[part]
    return True


def _extract_direct_connector_paths(code: str) -> set[str]:
    paths: set[str] = set()

    direct_patterns = [
        r"\bconnector\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)",
        r"\bcontext\.connector\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)",
        r"\bconnector\[['\"]([A-Za-z_$][\w$]*)['\"]\]",
        r"\bcontext\.connector\[['\"]([A-Za-z_$][\w$]*)['\"]\]",
        r"\bcontext\[['\"]connector['\"]\]\[['\"]([A-Za-z_$][\w$]*)['\"]\]",
    ]

    for pattern in direct_patterns:
        for match in re.findall(pattern, code):
            if isinstance(match, tuple):
                candidate = next((group for group in match if group), "")
            else:
                candidate = match
            if candidate:
                paths.add(candidate)

    for match in re.finditer(r"\bconnector(?:\[['\"][A-Za-z_$][\w$]*['\"]\])+", code):
        keys = re.findall(r"\[['\"]([A-Za-z_$][\w$]*)['\"]\]", match.group(0))
        if keys:
            paths.add(".".join(keys))

    for match in re.finditer(r"\bcontext\[['\"]connector['\"]\](?:\[['\"][A-Za-z_$][\w$]*['\"]\])+", code):
        keys = re.findall(r"\[['\"]([A-Za-z_$][\w$]*)['\"]\]", match.group(0))
        if len(keys) >= 2 and keys[0] == "connector":
            paths.add(".".join(keys[1:]))

    return paths


def _strip_code_strings_and_comments(code: str) -> str:
    pattern = re.compile(
        r"\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*[\s\S]*?\*/|#[^\n]*"
    )
    return pattern.sub(" ", code)


def _extract_alias_connector_paths(code: str) -> set[str]:
    paths: set[str] = set()

    alias_pattern = re.compile(
        r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:context\.)?connector\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)"
    )
    python_alias_pattern = re.compile(
        r"\b([A-Za-z_][\w]*)\s*=\s*(?:context\.)?connector\.([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)"
    )
    aliases: dict[str, str] = {}
    for alias_name, base_path in alias_pattern.findall(code):
        aliases[alias_name] = base_path
    for alias_name, base_path in python_alias_pattern.findall(code):
        aliases[alias_name] = base_path

    for alias_name, base_path in aliases.items():
        attr_pattern = re.compile(rf"\b{re.escape(alias_name)}\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)")
        bracket_pattern = re.compile(rf"\b{re.escape(alias_name)}\[['\"]([A-Za-z_$][\w$]*)['\"]\]")

        alias_refs = {ref for ref in attr_pattern.findall(code)}
        alias_refs.update(bracket_pattern.findall(code))

        if not alias_refs:
            paths.add(base_path)
            continue

        for ref in alias_refs:
            paths.add(f"{base_path}.{ref}")

    return paths


def _discover_referenced_connector_paths(files: dict[str, Any]) -> list[str]:
    all_paths: set[str] = set()

    for file_name, content in files.items():
        if not isinstance(content, str):
            continue
        code = _strip_code_strings_and_comments(content)
        all_paths.update(_extract_direct_connector_paths(code))
        all_paths.update(_extract_alias_connector_paths(code))

    normalized_paths: set[str] = set()
    for dotted_path in all_paths:
        root = dotted_path.split(".", 1)[0]
        if root in IGNORED_TOP_LEVEL_KEYS:
            continue
        normalized_paths.add(dotted_path)

    return sorted(normalized_paths)


def _required_top_level_keys_from_paths(paths: list[str]) -> list[str]:
    top_level = {path.split(".", 1)[0] for path in paths}
    top_level = {key for key in top_level if key not in IGNORED_TOP_LEVEL_KEYS}
    return sorted(top_level)


def _extract_required_env_keys(connector: dict[str, Any]) -> list[str]:
    required: set[str] = set()

    connector_text = json.dumps(connector)
    required.update(re.findall(r"\{\{env:([A-Z][A-Z0-9_]*)\}\}", connector_text))

    files = connector.get("files")
    if isinstance(files, dict):
        for content in files.values():
            if not isinstance(content, str):
                continue
            required.update(re.findall(r"\bos\.getenv\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]", content))
            required.update(re.findall(r"\bos\.environ\[['\"]([A-Z][A-Z0-9_]*)['\"]\]", content))
            required.update(re.findall(r"\bos\.environ\.get\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]", content))
            required.update(re.findall(r"\benviron\[['\"]([A-Z][A-Z0-9_]*)['\"]\]", content))
            required.update(re.findall(r"\benviron\.get\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]", content))
            required.update(re.findall(r"\bprocess\.env\.([A-Z][A-Z0-9_]*)\b", content))
            required.update(re.findall(r"\bprocess\.env\[['\"]([A-Z][A-Z0-9_]*)['\"]\]", content))

    return sorted(required)


def _resolve_container_env(payload_env: dict[str, str], required_env_keys: list[str]) -> dict[str, str]:
    resolved = dict(payload_env)
    missing: list[str] = []

    for key in required_env_keys:
        if key in resolved:
            continue
        host_value = os.getenv(key)
        if host_value is None:
            missing.append(key)
        else:
            resolved[key] = host_value

    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Missing required environment variables for connector execution",
                "missing": missing,
            },
        )

    return resolved


def _execute_connector_in_docker(payload: ExecuteConnectorRequest) -> ExecuteConnectorResponse:
    connector = copy.deepcopy(payload.connector)
    _validate_connector(connector)

    configuration = connector.get("configuration")
    if configuration is not None and not isinstance(configuration, dict):
        raise HTTPException(status_code=400, detail="connector.configuration must be an object when provided")

    if payload.configuration_overrides:
        if configuration is None:
            connector["configuration"] = {}
            configuration = connector["configuration"]
        configuration.update(payload.configuration_overrides)

    referenced_paths = _discover_referenced_connector_paths(connector["files"])
    if not referenced_paths:
        raise HTTPException(
            status_code=400,
            detail="No connector JSON parameter references were found in files code",
        )

    required_top_level_keys = _required_top_level_keys_from_paths(referenced_paths)
    missing_top_level_keys = [key for key in required_top_level_keys if key not in connector]
    if missing_top_level_keys:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Connector is missing required top-level keys used by code",
                "missing": missing_top_level_keys,
            },
        )

    missing_paths = [path for path in referenced_paths if not _path_exists(connector, path)]
    if missing_paths:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Missing connector values referenced by code",
                "missing": missing_paths,
            },
        )

    runtime = connector["runtime"]
    entry_point = runtime["entryPoint"]
    python_dependencies = _normalize_runtime_dependencies(runtime.get("dependencies", []))
    timeout_ms = payload.timeout_ms or int(runtime.get("timeoutMs", 30000))
    memory_mb = int(runtime.get("memoryMb", 256))
    network_mode = payload.network_mode or "bridge"

    if memory_mb < 64 or memory_mb > 4096:
        raise HTTPException(status_code=400, detail="runtime.memoryMb must be between 64 and 4096")

    env_key_pattern = re.compile(r"^[A-Z][A-Z0-9_]*$")
    for env_key in payload.env:
        if not env_key_pattern.match(env_key):
            raise HTTPException(status_code=400, detail=f"Invalid env key: {env_key}")

    required_env_keys = _extract_required_env_keys(connector)
    container_env = _resolve_container_env(payload.env, required_env_keys)

    started_at = time.perf_counter()

    with tempfile.TemporaryDirectory(prefix="connector-run-") as temp_dir:
        run_dir = os.path.join(temp_dir, "run")
        code_dir = os.path.join(run_dir, "code")
        os.makedirs(code_dir, exist_ok=True)

        connector_json_path = os.path.join(run_dir, "connector.json")
        with open(connector_json_path, "w", encoding="utf-8") as connector_file:
            json.dump(connector, connector_file)

        for file_name, content in connector["files"].items():
            destination_path = os.path.join(code_dir, file_name)
            os.makedirs(os.path.dirname(destination_path), exist_ok=True)
            with open(destination_path, "w", encoding="utf-8") as output_file:
                output_file.write(content)

        mount_path = f"{run_dir}:/run:rw"
        container_entrypoint = f"/run/code/{entry_point}"

        command = [
            "docker",
            "run",
            "--rm",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",
            "--cap-drop",
            "ALL",
            "--pids-limit",
            "128",
            "--memory",
            f"{memory_mb}m",
            "--network",
            network_mode,
            "-v",
            mount_path,
            "-w",
            "/run/code",
        ]

        for key, value in container_env.items():
            command.extend(["-e", f"{key}={value}"])

        install_and_run_script_parts: list[str] = []
        if python_dependencies:
            quoted_dependencies = " ".join(shlex.quote(dep) for dep in python_dependencies)
            install_and_run_script_parts.append(
                f"python -m pip install --no-cache-dir --disable-pip-version-check {quoted_dependencies}"
            )

        install_and_run_script_parts.append(f"python {shlex.quote(container_entrypoint)}")
        install_and_run_script = " && ".join(install_and_run_script_parts)

        command.extend([
            "python:3.13-slim",
            "sh",
            "-lc",
            install_and_run_script,
        ])

        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout_ms / 1000,
                check=False,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail="Docker CLI not found on server") from exc
        except subprocess.TimeoutExpired as exc:
            elapsed = int((time.perf_counter() - started_at) * 1000)
            return ExecuteConnectorResponse(
                ok=False,
                error=f"Connector execution timed out after {timeout_ms} ms",
                exit_code=124,
                duration_ms=elapsed,
                stdout=(exc.stdout or ""),
                stderr=(exc.stderr or ""),
            )

    elapsed = int((time.perf_counter() - started_at) * 1000)
    stdout_text = completed.stdout.strip() if completed.stdout else ""
    stderr_text = completed.stderr.strip() if completed.stderr else ""

    if completed.returncode == 0:
        payload_json = _parse_json_if_possible(stdout_text)
        if isinstance(payload_json, dict) and payload_json.get("ok") is True:
            return ExecuteConnectorResponse(
                ok=True,
                result=payload_json.get("result"),
                exit_code=0,
                duration_ms=elapsed,
                stdout=stdout_text,
                stderr=stderr_text or None,
            )

        return ExecuteConnectorResponse(
            ok=True,
            result=payload_json if payload_json is not None else stdout_text,
            exit_code=0,
            duration_ms=elapsed,
            stdout=stdout_text,
            stderr=stderr_text or None,
        )

    stderr_json = _parse_json_if_possible(stderr_text)
    error_message = None
    if isinstance(stderr_json, dict):
        error_message = stderr_json.get("error") if isinstance(stderr_json.get("error"), str) else None

    if not error_message:
        error_message = stderr_text or "Connector execution failed"

    return ExecuteConnectorResponse(
        ok=False,
        error=error_message,
        exit_code=completed.returncode,
        duration_ms=elapsed,
        stdout=stdout_text or None,
        stderr=stderr_text or None,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health2")
def health() -> dict[str, str]:
    x = "dasdsa"
    y =x + "sdfsdf"
    return {"status": "ok"}


@app.get("/get-file/{file_name}")
def get_file(file_name: str) -> dict[str, Any]:
    url = f"https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/get-file/{file_name}"
    try:
        resp = http_requests.get(url, verify=False, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except http_requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach Connector API: {exc}") from exc
    except http_requests.exceptions.HTTPError as exc:
        raise HTTPException(status_code=resp.status_code, detail=resp.text) from exc
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Response is not valid JSON")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch file: {exc}") from exc

@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    model = payload.model or os.getenv("AZURE_OPENAI_DEPLOYMENT")
   
    if not model:
        raise HTTPException(status_code=500, detail="AZURE_OPENAI_DEPLOYMENT is not set")

    default_temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.7"))
    default_max_tokens = int(os.getenv("OPENAI_MAX_TOKENS", "2000"))

    temperature = payload.temperature if payload.temperature is not None else default_temperature
    max_tokens = payload.max_tokens if payload.max_tokens is not None else default_max_tokens

    try:
        # Load the connector JSON schema prompt template
        prompt_template = _load_prompt_template()
        
        # Build the complete user prompt with template + API docs + documentation + user request
        user_message_parts = [prompt_template]
        
        # Add API documentation if provided
        if payload.api_docs and payload.api_docs.strip():
            api_docs_message = (
                "\n\n────────────────────────────────\n"
                "API Documentation and References:\n"
                "────────────────────────────────\n\n"
                "Use the following API documentation links and references to ensure accurate implementation:\n\n"
                f"{payload.api_docs.strip()}\n\n"
                "Please refer to these resources to verify endpoint URLs, authentication methods, "
                "request/response formats, and required parameters."
            )
            user_message_parts.append(api_docs_message)
        
        # Add additional documentation if provided
        if payload.documentation and payload.documentation.strip():
            additional_docs_message = (
                "\n\n────────────────────────────────\n"
                "Additional Documentation:\n"
                "────────────────────────────────\n\n"
                "Additional documentation, guides, and specifications:\n\n"
                f"{payload.documentation.strip()}\n"
            )
            user_message_parts.append(additional_docs_message)
        
        # Add the user's actual request
        user_message_parts.append("\n\n────────────────────────────────\n")
        user_message_parts.append("USER REQUEST:\n")
        user_message_parts.append("────────────────────────────────\n\n")
        for msg in payload.messages:
            if msg.role == "user":
                user_message_parts.append(msg.content)
        
        combined_user_message = "".join(user_message_parts)
        
        # Prepare messages with combined user prompt
        enhanced_messages = [
            {"role": "user", "content": combined_user_message}
        ]
        client = _get_client()
        
        # First call: Generate the connector
        # Build completion parameters
        completion_params = {
            "model": model or 'gpt-5',
            "messages": enhanced_messages,
            "response_format": {"type": "json_object"},
            "max_completion_tokens": 20000,
        }
        
        # Enable internet search/web grounding if requested
        if payload.enable_internet_search:
            completion_params["extra_body"] = {
                "data_sources": [{
                    "type": "internet",
                    "parameters": {
                        "grounding": True
                    }
                }]
            }
        
        completion = client.chat.completions.create(**completion_params)
        
        content = completion.choices[0].message.content
        
       
        if not content:
            raise HTTPException(status_code=502, detail="Model returned empty content")
        
        # Extract JSON from the response
        connector_json = _extract_json_from_text(content)
        
        if not connector_json:
            raise HTTPException(status_code=502, detail="Could not extract valid JSON from response")
        
        return ChatResponse(model=model, reply=content)
        # Validate using engine.py
        
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OpenAI request failed: {exc}") from exc


@app.post("/check-code", response_model=CodeCheckerResponse)
def check_code(payload: CodeCheckerRequest) -> CodeCheckerResponse:
    """
    Validate and improve connector JSON while maintaining structure.
    Reviews the connector for correctness, suggests fixes, and returns improved version.
    """
    model = payload.model or os.getenv("AZURE_OPENAI_DEPLOYMENT")
    
    if not model:
        raise HTTPException(status_code=500, detail="AZURE_OPENAI_DEPLOYMENT is not set")
    
    try:
        # Parse the provided connector JSON
        try:
            connector_json = json.loads(payload.connector_json)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")
        
        # Validate the connector using engine validators
        is_valid, validation_error = _validate_connector_json(connector_json)
        validation_errors = [validation_error] if validation_error else []
        
        # Build prompt for AI to check and improve the code
        system_prompt = (
            "You are a senior connector validation and improvement specialist.\n\n"
            "Your job is to:\n"
            "1. Review the provided connector JSON for correctness\n"
            "2. Check if API endpoints, auth, configuration are correct\n"
            "3. Validate code logic, imports, and dependencies\n"
            "4. Suggest improvements while MAINTAINING the exact JSON structure\n"
            "5. Return the improved connector JSON\n\n"
            "CRITICAL RULES:\n"
            "- You MUST maintain the connector JSON structure (auth, configuration, configurationTypes, files, runtime, etc.)\n"
            "- You CAN modify values, fix code, update endpoints, correct auth fields\n"
            "- You MUST return valid, working connector JSON\n"
            "- List all changes you made in a separate 'changes_made' array\n"
            "- Add recommendations in a 'recommendations' array if any\n\n"
            "Return JSON with this structure:\n"
            "{\n"
            "  \"improved_connector\": {the complete improved connector JSON},\n"
            "  \"changes_made\": [\"list of changes\"],\n"
            "  \"recommendations\": [\"optional recommendations\"]\n"
            "}\n"
        )
        
        user_prompt = (
            "Review and improve this connector JSON:\n\n"
            f"{json.dumps(connector_json, indent=2, ensure_ascii=False)}\n\n"
            "Return the improved version with all changes documented."
        )
        
        client = _get_client()
        
        # Build completion parameters
        completion_params = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": {"type": "json_object"},
            "max_completion_tokens": 20000,
        }
        
        # Enable internet search if requested
        if payload.enable_internet_search:
            completion_params["extra_body"] = {
                "data_sources": [{
                    "type": "internet",
                    "parameters": {
                        "grounding": True
                    }
                }]
            }
        
        completion = client.chat.completions.create(**completion_params)
        content = completion.choices[0].message.content
        
        if not content:
            raise HTTPException(status_code=502, detail="Model returned empty content")
        
        # Parse AI response
        try:
            ai_response = json.loads(content)
            improved_connector = ai_response.get("improved_connector", connector_json)
            changes_made = ai_response.get("changes_made", [])
            recommendations = ai_response.get("recommendations")
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="Could not parse AI response")
        
        # Return the improved connector
        return CodeCheckerResponse(
            model=model,
            original_valid=is_valid,
            validation_errors=validation_errors if validation_errors else None,
            improved_json=json.dumps(improved_connector, indent=2, ensure_ascii=False),
            changes_made=changes_made,
            recommendations=recommendations
        )
        
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Code check failed: {exc}") from exc


class AddToStorageRequest(BaseModel):
    Content: str = Field(min_length=1)
    Name: str = Field(min_length=1)


class FixErrorRequest(BaseModel):
    fileName: str = Field(min_length=1)
    error: str = Field(min_length=1)
    filePath: str = Field(min_length=1)
    enable_internet_search: bool = Field(default=False, description="Enable web search/grounding for real-time information")
    solution_hint: str | None = Field(default=None, description="Optional hint or guidance to direct the AI toward a specific solution")


class FixErrorResponse(BaseModel):
    success: bool
    fixed_code: str | None = None
    error: str | None = None


class SdkContextRequest(BaseModel):
    decision_required: bool = True
    source: str | None = None
    timestamp: str | None = None
    file_name: str | None = None
    connector_json: dict[str, Any] | None = None
    docker_response: dict[str, Any] = Field(default_factory=dict)
    enable_internet_search: bool = Field(default=False, description="Enable web search/grounding for real-time information")
    solution_hint: str | None = Field(default=None, description="Optional hint or guidance to direct the AI toward a specific solution")


class SdkContextResponse(BaseModel):
    accepted: bool
    forwarded: bool
    message: str
    analysis: dict[str, Any] | None = None
    model_used: str | None = None
    forward_status: int | None = None
    response_excerpt: str | None = None
    fixed_connector: dict[str, Any] | None = None


def _truncate_text(value: str, max_chars: int = 6000) -> str:
    if len(value) <= max_chars:
        return value
    return value[:max_chars] + "\n...[truncated]"


def _redact_secrets(value: str) -> str:
    redacted = re.sub(r"(?i)(api[_-]?key\s*[:=]\s*)([^\s,;]+)", r"\1[REDACTED]", value)
    redacted = re.sub(r"(?i)(authorization\s*[:=]\s*bearer\s+)([^\s,;]+)", r"\1[REDACTED]", redacted)
    redacted = re.sub(r"(?i)(password\s*[:=]\s*)([^\s,;]+)", r"\1[REDACTED]", redacted)
    redacted = re.sub(r"(?i)(token\s*[:=]\s*)([^\s,;]+)", r"\1[REDACTED]", redacted)
    return redacted


def _redact_connector_credentials(connector: dict[str, Any]) -> dict[str, Any]:
    """Deep copy connector and clear all values in auth and configuration sections."""
    redacted = copy.deepcopy(connector)
    
    # Clear configuration values
    if "configuration" in redacted and isinstance(redacted["configuration"], dict):
        for key in redacted["configuration"]:
            redacted["configuration"][key] = ""
    
    # Clear auth values
    if "auth" in redacted and isinstance(redacted["auth"], dict):
        for key in redacted["auth"]:
            redacted["auth"][key] = ""
    
    return redacted


def _prepare_bugfix_context(payload: SdkContextRequest) -> dict[str, Any]:
    
    docker_response = payload.docker_response if isinstance(payload.docker_response, dict) else {}
    result = _truncate_text(_redact_secrets(str(docker_response.get("result") or "")), 5000)
    stderr_text = _truncate_text(_redact_secrets(str(docker_response.get("stderr") or "")), 5000)
    error_text = _truncate_text(_redact_secrets(str(docker_response.get("error") or "")), 2000)
    
    if(docker_response.get("logs") and docker_response.get("logs")['stdout'] and docker_response.get("logs")['stdout']):
        result = _truncate_text(_redact_secrets(str(docker_response.get("logs")['stdout'] or "")), 5000) 

        
    context = {
        "source": payload.source,
        "timestamp": payload.timestamp,
        "file_name": payload.file_name,
        "exit_code": docker_response.get("exit_code"),
        "docker_operation_result": result,
    }
    
    # Fetch full clean connector from storage as reference
    if payload.file_name:
        try:
            clean_connector = get_file(payload.file_name)
            if isinstance(clean_connector, dict):
                # Include full connector JSON as reference (with actual auth/config values)
                context["full_connector_reference"] = clean_connector
                print(f"📥 Fetched full clean connector from storage: {payload.file_name}")
        except Exception as e:
            print(f"⚠️ Could not fetch clean connector from storage: {str(e)}")
            # Fallback to using provided connector_json with files
            if payload.connector_json and isinstance(payload.connector_json, dict):
                files = payload.connector_json.get("files", {})
                if isinstance(files, dict) and files:
                    context["code_files"] = files
    
    return context


def _apply_fixes_to_connector(connector_json: dict[str, Any] | None, analysis: dict[str, Any]) -> dict[str, Any] | None:
    """Apply fixed files and updated auth/configuration to the connector JSON and return updated connector."""
    if not connector_json or not isinstance(connector_json, dict):
        return None
    
    updated_connector = copy.deepcopy(connector_json)
    if "files" not in updated_connector or not isinstance(updated_connector["files"], dict):
        return None
    
    # Replace files with fixed versions
    changes_made = 0
    fixed_files = analysis.get("fixed_files", {})
    if isinstance(fixed_files, dict):
        for file_path, fixed_content in fixed_files.items():
            if file_path in updated_connector["files"]:
                print(f"🔧 Applying fix to file: {file_path}")
                updated_connector["files"][file_path] = fixed_content
                changes_made += 1
    
    # Update auth if provided
    if "updated_auth" in analysis and isinstance(analysis["updated_auth"], dict):
        print(f"🔐 Updating auth schema")
        updated_connector["auth"] = analysis["updated_auth"]
        changes_made += 1
    
    # Update configuration if provided
    if "updated_configuration" in analysis and isinstance(analysis["updated_configuration"], dict):
        print(f"⚙️ Updating configuration")
        updated_connector["configuration"] = analysis["updated_configuration"]
        changes_made += 1
    
    # Update configurationTypes if provided
    if "updated_configurationTypes" in analysis and isinstance(analysis["updated_configurationTypes"], dict):
        print(f"📋 Updating configurationTypes schema")
        updated_connector["configurationTypes"] = analysis["updated_configurationTypes"]
        changes_made += 1
    
    if changes_made > 0:
        print(f"✅ Applied {changes_made} fix(es) to connector")
    
    return updated_connector


def _model_bugfix_analysis(payload: SdkContextRequest) -> tuple[dict[str, Any], str]:
    client = _get_client()
    model = os.getenv("COPILOT_FIX_MODEL") or os.getenv("AZURE_OPENAI_DEPLOYMENT") or "gpt-5"
    safe_context = _prepare_bugfix_context(payload)
    system_prompt = (
        "You are a senior software debugging assistant. "
        "Given Python code execution errors from Docker, produce actual working fixed code. \n\n"
        "IMPORTANT INSTRUCTIONS:\n"
        "1. You have the FULL CLEAN connector JSON as reference (including actual auth and configuration values).\n"
        "2. If you need to change the API call/method and it requires different keys in 'auth' or 'configuration', you CAN modify them.\n"
        "3. If you add/change/remove keys in 'auth' or 'configuration', you MUST also update 'configurationTypes' to match.\n"
        "   - For each new key in 'auth' or 'configuration', add corresponding entry in 'configurationTypes' with: type, required, default, description.\n"
        "   - Remove configurationTypes entries for keys you delete.\n"
        "4. Ensure the payload structure matches the new API call requirements.\n"
        "5. Return the complete corrected code and updated connector schema ready to use.\n\n"
        "Return valid JSON only."
    )

    user_prompt = (
        "Analyze this Python code execution failure and return the FIXED CODE.\n\n"
        "You have been provided with the FULL CLEAN connector JSON (with actual auth/config values) as reference.\n"
        "Use it to understand the current structure and make informed fixes.\n\n"
        "Return JSON with this exact shape:\n"
        "{\n"
        "  \"root_cause\": \"string describing the bug\",\n"
        "  \"confidence\": 0.95,\n"
        "  \"fixed_files\": {\n"
        "    \"file_path_1\": \"complete fixed code content\",\n"
        "    \"file_path_2\": \"complete fixed code content\"\n"
        "  },\n"
        "  \"changes_summary\": [\"list of changes made\"],\n"
        "  \"verification_steps\": [\"steps to verify the fix\"],\n"
        "  \"needs_human_review\": false\n"
        "}\n\n"
        "CRITICAL RULES:\n"
        "1. In fixed_files, provide the COMPLETE file content after fixes, not just snippets or diffs.\n"
        "2. fixed_files is ALWAYS REQUIRED - include all modified code files.\n\n"
        "IF YOU CHANGE THE API ENDPOINT OR METHOD (e.g., switching from one API to another):\n"
        "3. You MUST add these additional fields to the JSON response:\n"
        "   \"updated_auth\": {\"complete auth object with all keys and values\"},\n"
        "   \"updated_configuration\": {\"complete configuration object with all keys and values\"},\n"
        "   \"updated_configurationTypes\": {\"complete schema for all configuration keys\"}\n"
        "4. updated_configurationTypes MUST define every key in updated_configuration with:\n"
        "   - \"type\": \"string\"|\"integer\"|\"boolean\"|\"object\"|\"array\"\n"
        "   - \"required\": true|false\n"
        "   - \"default\": default value (can be \"\" or null)\n"
        "   - \"description\": \"helpful description\"\n"
        "5. Include updated_auth, updated_configuration, and updated_configurationTypes ONLY if you're changing the API/endpoint.\n"
        "6. If you're only fixing code bugs (syntax, logic, imports), do NOT include these 3 fields.\n\n"
    )
    
    # Add solution hint if provided
    if payload.solution_hint:
        user_prompt += f"\n\nADDITIONAL GUIDANCE/HINT:\n{payload.solution_hint}\n\n"
    
    user_prompt += (
        "Error Context:\n"
        f"{json.dumps(safe_context, ensure_ascii=False)}"
    )
    
    # Build completion parameters
    completion_params = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
        "max_completion_tokens": 20000,
    }
    
    # Enable internet search/web grounding if requested
    if payload.enable_internet_search:
        completion_params["extra_body"] = {
            "data_sources": [{
                "type": "internet",
                "parameters": {
                    "grounding": True
                }
            }]
        }
    
    completion = client.chat.completions.create(**completion_params)

    content = completion.choices[0].message.content
    if not content or not content.strip():
        raise HTTPException(status_code=502, detail="Model returned empty analysis content")

    # Parse the JSON response
    try:
        parsed_analysis = json.loads(content)
        return parsed_analysis, model
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {str(e)}")


@app.post("/add-to-storage")
def add_to_storage(payload: AddToStorageRequest) -> dict[str, Any]:
    url = "https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/add-to-storage"
    try:
        resp = http_requests.post(
            url,
            json=payload.model_dump(),
            verify=False,
            timeout=30,
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except Exception:
            return {"status": resp.status_code, "body": resp.text}
    except http_requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach storage API: {exc}") from exc
    except http_requests.exceptions.HTTPError as exc:
        raise HTTPException(status_code=resp.status_code, detail=resp.text) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Storage request failed: {exc}") from exc


@app.post("/execute-connector", response_model=ExecuteConnectorResponse)
def execute_connector(payload: ExecuteConnectorRequest) -> ExecuteConnectorResponse:
    try:
        return _execute_connector_in_docker(payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Connector execution engine failed: {exc}") from exc


@app.get("/validate-connector/{file_name:path}")
def validate_connector(file_name: str) -> dict[str, Any]:
    """
    1. Fetch connector JSON from https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/get-file/{file_name}
    2. Validate it using engine.py validators
    3. Return validation result
    """
    # Step 1: Fetch the connector JSON
    url = f"https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/get-file/{file_name}"
    try:
        resp = http_requests.get(url, verify=False, timeout=600)
        resp.raise_for_status()
        connector_json = resp.json()
    except http_requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach Connector API: {exc}") from exc
    except http_requests.exceptions.HTTPError as exc:
        raise HTTPException(status_code=resp.status_code, detail=resp.text) from exc
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Response is not valid JSON")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch connector: {exc}") from exc
    
    # Step 2: Validate using engine.py validators
    is_valid, error_message = _validate_connector_json(connector_json)
    
    # Step 3: Return validation result
    if is_valid:
        return {
            "ok": True,
            "valid": True,
            "file_name": file_name,
            "message": "Connector JSON is valid"
        }
    else:
        return {
            "ok": False,
            "valid": False,
            "file_name": file_name,
            "error": error_message
        }


@app.get("/run-engine/{file_name:path}")
def run_engine(file_name: str) -> dict[str, Any]:
    """
    1. Fetch connector JSON from https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/{file_name}
    2. Write it to a temp file
    3. Run: python engine.py <temp_file>
    4. Return engine.py's JSON output
    """
    # Step 1: Fetch the connector JSON
    url = f"https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/get-file/{file_name}"
    try:
        resp = http_requests.get(url, verify=False, timeout=600)
        resp.raise_for_status()
        connector_json = resp.json()
    except http_requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach Connector API: {exc}") from exc
    except http_requests.exceptions.HTTPError as exc:
        raise HTTPException(status_code=resp.status_code, detail=resp.text) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch connector: {exc}") from exc

    # Step 2: Write to temp file and run engine.py
    engine_path = Path(__file__).parent.parent / "engine.py"
    if not engine_path.exists():
        raise HTTPException(status_code=500, detail="engine.py not found")

    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as tmp:
            json.dump(connector_json, tmp)
            tmp_path = tmp.name
        # Step 3: Run engine.py as subprocess
        result = subprocess.run(
            [sys.executable, str(engine_path), tmp_path],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    # Step 4: Parse and return engine.py output
    stdout_text = result.stdout.strip() if result.stdout else ""
    stderr_text = result.stderr.strip() if result.stderr else ""
    
    parsed = _parse_json_if_possible(stdout_text)
    if isinstance(parsed, dict):
        return parsed

    return {
        "ok": result.returncode == 0,
        "exit_code": result.returncode,
        "stdout": stdout_text or None,
        "stderr": stderr_text or None,
    }


@app.post("/run-engine-with-json")
def run_engine_with_json(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Run engine.py with a provided connector JSON (already edited by the user).
    Payload: {"connector": {full connector JSON including files}}
    """
    connector_json = payload.get("connector")
    if not connector_json or not isinstance(connector_json, dict):
        raise HTTPException(status_code=400, detail="Missing or invalid 'connector'")

    engine_path = Path(__file__).parent.parent / "engine.py"
    if not engine_path.exists():
        raise HTTPException(status_code=500, detail="engine.py not found")

    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as tmp:
            json.dump(connector_json, tmp)
            tmp_path = tmp.name

        result = subprocess.run(
            [sys.executable, str(engine_path), tmp_path],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    stdout_text = result.stdout.strip() if result.stdout else ""
    stderr_text = result.stderr.strip() if result.stderr else ""

    parsed = _parse_json_if_possible(stdout_text)
    if isinstance(parsed, dict):
        return parsed
    return {
        "ok": result.returncode == 0,
        "exit_code": result.returncode,
        "stdout": stdout_text or None,
        "stderr": stderr_text or None,
    }


@app.get("/debug/connector/{file_name}")
def get_connector_for_debug(file_name: str) -> dict[str, Any]:
    """
    Fetch connector JSON from external API and return its files for debugging.
    Returns: {"files": {"path/to/file.py": "code content", ...}}
    """
    url = f"https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/get-file/{file_name}"
    try:
        resp = http_requests.get(url, verify=False, timeout=30)
        resp.raise_for_status()
        connector_json = resp.json()
        
        # Extract files map
        files = connector_json.get("files", {})
        if not isinstance(files, dict):
            raise HTTPException(status_code=400, detail="Connector does not contain valid 'files' object")
        
        return {"files": files, "connector": connector_json}
    except http_requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach Connector API: {exc}") from exc
    except http_requests.exceptions.HTTPError as exc:
        raise HTTPException(status_code=resp.status_code, detail=resp.text) from exc
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Response is not valid JSON")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch connector: {exc}") from exc


@app.post("/debug/save-connector")
def save_connector(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Save the full connector JSON with updated files back to storage.
    Payload: {"file_name": "connector.json", "connector": {full connector object with updated files}}
    """
    file_name = payload.get("file_name")
    connector = payload.get("connector")

    if not file_name or not isinstance(file_name, str):
        raise HTTPException(status_code=400, detail="Missing or invalid 'file_name'")
    if not connector or not isinstance(connector, dict):
        raise HTTPException(status_code=400, detail="Missing or invalid 'connector'")
    if "files" not in connector or not isinstance(connector.get("files"), dict):
        raise HTTPException(status_code=400, detail="Connector must contain a valid 'files' map")

    url = "https://uploaderbe-b4dbh9eec3hmh5ep.westeurope-01.azurewebsites.net/api/Connector/add-to-storage"
    try:
        resp = http_requests.post(
            url,
            json={"Content": json.dumps(connector, ensure_ascii=False), "Name": file_name},
            verify=False,
            timeout=30,
        )
        resp.raise_for_status()
        try:
            return {"ok": True, "response": resp.json()}
        except Exception:
            return {"ok": True, "response": resp.text}
    except http_requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach storage API: {exc}") from exc
    except http_requests.exceptions.HTTPError as exc:
        raise HTTPException(status_code=resp.status_code, detail=resp.text) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Save failed: {exc}") from exc


@app.post("/fix-error", response_model=FixErrorResponse)
def fix_error(payload: FixErrorRequest) -> FixErrorResponse:
    """
    Fix errors in a single connector code file using LLM.
    Receives an error message, file name, and a specific file path.
    Fetches the connector, extracts the requested file, sends code + error to LLM.
    Returns only the fixed code content.
    """
    try:
        # Fetch the connector
        connector_data = get_file(payload.fileName)

        if not connector_data or not isinstance(connector_data, dict):
            return FixErrorResponse(
                success=False,
                error="Failed to fetch file or invalid file format"
            )

        all_files = connector_data.get("files", {})
        if not isinstance(all_files, dict):
            return FixErrorResponse(
                success=False,
                error="Connector does not contain a valid 'files' map"
            )

        # Extract the requested file
        if payload.filePath not in all_files:
            return FixErrorResponse(
                success=False,
                error=f"File path not found in connector: {payload.filePath}"
            )

        file_code = all_files[payload.filePath]

        # Build clean prompt - request ONLY fixed code
        fix_prompt = f"""File: {payload.filePath}

Code:
{file_code}

Error:
{payload.error}"""
        
        # Add solution hint if provided
        if payload.solution_hint:
            fix_prompt += f"\n\nGuidance/Hint:\n{payload.solution_hint}"
        
        fix_prompt += "\n\nReturn ONLY the corrected code. Do not include explanations, comments, or markdown."

        client = _get_client()
        model = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5")

        # Build completion parameters
        completion_params = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You are a code fixing assistant. Analyze the error and return ONLY the corrected code with no additional text, explanations, or formatting."},
                {"role": "user", "content": fix_prompt}
            ],
            "max_completion_tokens": 20000,
        }
        
        # Enable internet search/web grounding if requested
        if payload.enable_internet_search:
            completion_params["extra_body"] = {
                "data_sources": [{
                    "type": "internet",
                    "parameters": {
                        "grounding": True
                    }
                }]
            }
        
        completion = client.chat.completions.create(**completion_params)

        content = completion.choices[0].message.content
        
        if not content or not content.strip():
            return FixErrorResponse(
                success=False,
                error="LLM returned empty response"
            )

        # Clean up any markdown code blocks if present
        fixed_code = content.strip()
        if fixed_code.startswith("```"):
            # Remove markdown code blocks
            lines = fixed_code.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            fixed_code = "\n".join(lines)

        return FixErrorResponse(
            success=True,
            fixed_code=fixed_code,
        )

    except HTTPException:
        raise
    except Exception as exc:
        return FixErrorResponse(
            success=False,
            error=f"Failed to fix error: {str(exc)}"
        )


@app.post("/submit-sdk-context", response_model=SdkContextResponse)
def submit_sdk_context(payload: SdkContextRequest) -> SdkContextResponse:
    """
    Receive a validation/runtime failure context and run direct model analysis for bug fixing.
    Optionally forward payload + analysis to an external SDK endpoint when configured.
    """
    analysis, model_used = _model_bugfix_analysis(payload)
    print(f"📊 Analysis complete. Model: {model_used}")
    
    # Apply fixes to connector if available
    fixed_connector = None
    storage_saved = False
    if isinstance(analysis, dict) and ("fixed_files" in analysis or "updated_auth" in analysis or "updated_configuration" in analysis):
        fixed_connector = _apply_fixes_to_connector(payload.connector_json, analysis)
        
        # Save fixed connector to storage
        if fixed_connector and payload.file_name:
            try:
                print(f"💾 Saving fixed connector to storage: {payload.file_name}")
                storage_payload = AddToStorageRequest(
                    Content=json.dumps(fixed_connector, ensure_ascii=False),
                    Name=payload.file_name
                )
                add_to_storage(storage_payload)
                storage_saved = True
                print(f"✅ Successfully saved fixed connector to storage: {payload.file_name}")
            except Exception as e:
                print(f"⚠️ Failed to save to storage: {str(e)}")

    forward_url = os.getenv("COPILOT_SDK_CONTEXT_URL")
    forward_api_key = os.getenv("COPILOT_SDK_CONTEXT_API_KEY")
    
    success_message = "✅ Code fixed and saved to storage! Updated connector ready to test." if (fixed_connector and storage_saved) else "✅ Code fixed successfully! Updated connector ready to test." if fixed_connector else "Payload analyzed locally. Set COPILOT_SDK_CONTEXT_URL to also forward."
    
    if not forward_url:
        return SdkContextResponse(
            accepted=True,
            forwarded=False,
            message=success_message,
            analysis=analysis,
            model_used=model_used,
            fixed_connector=fixed_connector,
        )

    headers = {"Content-Type": "application/json"}
    if forward_api_key:
        headers["Authorization"] = f"Bearer {forward_api_key}"

    try:
        resp = http_requests.post(
            forward_url,
            json={
                "context": payload.model_dump(),
                "analysis": analysis,
                "model_used": model_used,
            },
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
    except http_requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach SDK endpoint: {exc}") from exc
    except http_requests.exceptions.Timeout as exc:
        raise HTTPException(status_code=504, detail=f"SDK endpoint timeout: {exc}") from exc
    except http_requests.exceptions.HTTPError as exc:
        body = (exc.response.text if exc.response is not None else str(exc))[:1000]
        status = exc.response.status_code if exc.response is not None else 502
        raise HTTPException(status_code=status, detail=f"SDK endpoint rejected payload: {body}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed forwarding SDK payload: {exc}") from exc

    excerpt = (resp.text or "")[:1000] if resp.text else None
    success_message = "✅ Code fixed and saved to storage! Updated connector ready to test." if (fixed_connector and storage_saved) else "✅ Code fixed successfully! Updated connector ready to test." if fixed_connector else "Payload analyzed and forwarded to SDK endpoint."
    
    return SdkContextResponse(
        accepted=True,
        forwarded=True,
        message=success_message,
        analysis=analysis,
        model_used=model_used,
        forward_status=resp.status_code,
        response_excerpt=excerpt,
        fixed_connector=fixed_connector,
    )


if __name__ == "__main__":
    import uvicorn
    from pathlib import Path

    port = int(os.getenv("PORT", "8000"))
    project_root = Path(__file__).resolve().parents[1]
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        app_dir=str(project_root),
    )
