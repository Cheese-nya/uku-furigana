#!/usr/bin/env python3
"""
Uku Furigana (浮く) — Feedback & Update Relay Server.

Single-file Python 3.11+ standard-library HTTP service behind nginx on
127.0.0.1:8787. Handles anonymous bug/feedback issue creation, release
metadata caching, streaming mirror downloads with Range support, and a Pixiv
novel proxy for the static web build (which has no Next.js `/api/pixiv` route).
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterable, NamedTuple, Optional, Union

DEFAULT_REPO = "Cheese-nya/uku-furigana"
DEFAULT_BIND = "127.0.0.1"
DEFAULT_PORT = 8787
DEFAULT_CACHE_DIR = "/var/cache/uku-relay"
DEFAULT_MIRROR_BASE = "https://uku.saiaino.xyz"
DEFAULT_ALLOWED_ORIGINS = (
    "https://localhost",
    "https://uku.saiaino.xyz",
    "http://localhost:3000",
)

MAX_FEEDBACK_BODY_BYTES = 64 * 1024
MAX_ISSUE_BODY_CHARS = 60000
MAX_LOG_ENTRIES = 500
MAX_LOG_MESSAGE_CHARS = 500
MAX_TITLE_CHARS = 80
MAX_MESSAGE_CHARS = 4000
MAX_CONTACT_CHARS = 80

RELEASE_CACHE_TTL_SECONDS = 10 * 60
RELEASE_STALE_TTL_SECONDS = 60 * 60
MAX_CONCURRENT_DOWNLOADS = 2
MAX_CACHED_VERSIONS = 2
STREAM_CHUNK_BYTES = 64 * 1024

PIXIV_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
MAX_PIXIV_JSON_BYTES = 8 * 1024 * 1024
MAX_PIXIV_COVER_BYTES = 2 * 1024 * 1024
PIXIV_CACHE_TTL_SECONDS = 10 * 60
PIXIV_CACHE_MAX_ENTRIES = 16

_CJK_KANA_RUN_RE = re.compile(
    r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{6,}"
)
_UNIX_HOME_RE = re.compile(r"(/home/)[^/\\\s]+(/)")
_MAC_USERS_RE = re.compile(r"(/Users/)[^/\\\s]+(/)")
_WIN_USERS_BACKSLASH_RE = re.compile(r"([A-Za-z]:\\Users\\)[^\\/\s]+(\\)")
_WIN_USERS_SLASH_RE = re.compile(r"([A-Za-z]:/Users/)[^/\\\s]+(/)")

_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
_ASSET_WHITELIST_RE = re.compile(
    r"^Uku-Furigana-v(?P<version>[\d.]+)(?:\.apk|-windows\.exe)$"
)
_SUM_LINE_RE = re.compile(r"^([0-9a-fA-F]{64})\s+\*?([^\s/\\]+)$")
_RANGE_HEADER_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
_LOOPBACK_ORIGIN_RE = re.compile(r"^http://127\.0\.0\.1:\d+$")
# Same 4-15 digit rule as `extractPixivNovelId` in app/utils/pixivImporter.ts.
_PIXIV_ID_RE = re.compile(r"^\d{4,15}$")
_PIXIV_RUBY_RE = re.compile(r"\[\[rb:([^\s>＞]+)\s*[>＞]\s*([^\]]+)\]\]")
_PIXIV_COVER_HOST_RE = re.compile(r"^https://[a-z0-9-]+\.pximg\.net/", re.IGNORECASE)


def log_stdout(message: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sys.stdout.write(f"{ts} [uku-relay] {message}\n")
    sys.stdout.flush()


def _redact_paths(text: str) -> str:
    """Replace username segments in /home/xxx/, /Users/xxx/, and C:\\Users\\xxx\\."""
    if not isinstance(text, str) or not text:
        return ""
    out = _UNIX_HOME_RE.sub(lambda m: f"{m.group(1)}<user>{m.group(2)}", text)
    out = _MAC_USERS_RE.sub(lambda m: f"{m.group(1)}<user>{m.group(2)}", out)
    out = _WIN_USERS_BACKSLASH_RE.sub(lambda m: f"{m.group(1)}<user>{m.group(2)}", out)
    out = _WIN_USERS_SLASH_RE.sub(lambda m: f"{m.group(1)}<user>{m.group(2)}", out)
    return out


def redact_log_text(text: str) -> str:
    """Redact user home paths and runs of >= 6 CJK/Kana characters."""
    if not isinstance(text, str) or not text:
        return ""
    out = _redact_paths(text)
    out = _CJK_KANA_RUN_RE.sub("[文本已隐去]", out)
    return out


def validate_feedback(payload: Any) -> bool:
    """Validate FeedbackPayload shape and bounds."""
    if not isinstance(payload, dict):
        return False

    kind = payload.get("kind")
    if kind not in ("log", "text"):
        return False

    include_log = payload.get("includeLog")
    if not isinstance(include_log, bool):
        return False

    if kind == "log" and not include_log:
        return False

    title = payload.get("title")
    if kind == "text":
        if not isinstance(title, str):
            return False
        if len(title.strip()) < 1 or len(title) > MAX_TITLE_CHARS:
            return False
    elif title is not None:
        if not isinstance(title, str) or len(title) > MAX_TITLE_CHARS:
            return False

    message = payload.get("message")
    if message is not None:
        if not isinstance(message, str) or len(message) > MAX_MESSAGE_CHARS:
            return False

    contact = payload.get("contact")
    if contact is not None:
        if not isinstance(contact, str) or len(contact) > MAX_CONTACT_CHARS:
            return False

    log_obj = payload.get("log")
    if include_log:
        if not isinstance(log_obj, dict):
            return False
        if log_obj.get("app") != "uku-furigana":
            return False
        version = log_obj.get("version")
        if version is not None and not isinstance(version, str):
            return False
        platform = log_obj.get("platform")
        if platform is not None and not isinstance(platform, str):
            return False
        distribution = log_obj.get("distribution")
        if distribution is not None and not isinstance(distribution, str):
            return False
        device = log_obj.get("device")
        if device is not None and not isinstance(device, dict):
            return False
        native_log = log_obj.get("nativeLog")
        if native_log is not None and not isinstance(native_log, str):
            return False

        entries = log_obj.get("entries")
        if not isinstance(entries, list) or len(entries) > MAX_LOG_ENTRIES:
            return False
        for entry in entries:
            if not isinstance(entry, dict):
                return False
            entry_msg = entry.get("message")
            if not isinstance(entry_msg, str) or len(entry_msg) > MAX_LOG_MESSAGE_CHARS:
                return False
            t_val = entry.get("t")
            if t_val is not None and (isinstance(t_val, bool) or not isinstance(t_val, (int, float))):
                return False
            level = entry.get("level")
            if level is not None and not isinstance(level, str):
                return False
            source = entry.get("source")
            if source is not None and not isinstance(source, str):
                return False

    return True


CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9-]{16,64}$")


def rate_limit_key(payload: dict[str, Any], ip: str) -> str:
    """Per-install id when the client sent a well-formed one, else the (shared) IP."""
    client_id = payload.get("clientId")
    if isinstance(client_id, str) and CLIENT_ID_RE.match(client_id):
        return f"id:{client_id}"
    return f"ip:{ip}"


class RateLimiter:
    """In-memory sliding-window rate limiter per client key (hour/day) and global (hour/day).

    Behind the SNI router every request arrives from 127.0.0.1, so the key is the
    client's own random id, not an IP; the global caps bound what a spammer can do.
    """

    def __init__(
        self,
        per_hour: int = 5,
        per_day: int = 20,
        global_per_day: int = 200,
        clock: Callable[[], float] = time.time,
        global_per_hour: int = 30,
    ) -> None:
        self.per_hour = per_hour
        self.per_day = per_day
        self.global_per_day = global_per_day
        self.global_per_hour = global_per_hour
        self._clock = clock
        self._lock = threading.Lock()
        self._ip_events: dict[str, list[float]] = {}
        self._global_events: list[float] = []

    def allow(self, ip: str, now: Optional[float] = None) -> bool:
        current = float(self._clock() if now is None else now)
        hour_cutoff = current - 3600.0
        day_cutoff = current - 86400.0

        with self._lock:
            self._global_events = [t for t in self._global_events if t > day_cutoff]
            if len(self._global_events) >= self.global_per_day:
                return False
            if sum(1 for t in self._global_events if t > hour_cutoff) >= self.global_per_hour:
                return False

            ip_list = [t for t in self._ip_events.get(ip, []) if t > day_cutoff]
            if ip_list:
                self._ip_events[ip] = ip_list
            else:
                self._ip_events.pop(ip, None)

            if len(ip_list) >= self.per_day:
                return False

            recent_hour = sum(1 for t in ip_list if t > hour_cutoff)
            if recent_hour >= self.per_hour:
                return False

            ip_list.append(current)
            self._ip_events[ip] = ip_list
            self._global_events.append(current)
            return True


class IssueSpec(NamedTuple):
    """GitHub issue payload; unpacks as (title, body, labels)."""

    title: str
    body: str
    labels: list[str]


def _format_iso_ms(epoch_ms: Any) -> str:
    if isinstance(epoch_ms, (int, float)) and not isinstance(epoch_ms, bool):
        try:
            dt = datetime.fromtimestamp(epoch_ms / 1000.0, tz=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        except (OSError, OverflowError, ValueError):
            pass
    return "1970-01-01T00:00:00.000Z"


def build_issue(payload: dict[str, Any]) -> IssueSpec:
    """Build GitHub issue title, markdown body, and labels from a validated FeedbackPayload."""
    kind = payload.get("kind", "log")
    include_log = bool(payload.get("includeLog"))
    log_obj = payload.get("log") if isinstance(payload.get("log"), dict) else {}

    version = str(log_obj.get("version") or "unknown")
    platform = str(log_obj.get("platform") or "unknown")
    distribution = str(log_obj.get("distribution") or "website")
    device = log_obj.get("device") if isinstance(log_obj.get("device"), dict) else {}

    if kind == "text":
        raw_title = _redact_paths(str(payload.get("title") or "").strip())
        title = raw_title or f"[用户反馈] {version} / {platform}"
        labels = ["from-app", "feedback"]
    else:
        title = f"[自动反馈] {version} / {platform}"
        labels = ["from-app", "bug"]

    sections: list[str] = []

    # Metadata summary table
    user_agent = redact_log_text(str(device.get("userAgent") or "-"))
    screen = str(device.get("screen") or "-")
    language = str(device.get("language") or "-")
    theme = str(device.get("theme") or "-")
    online = str(device.get("online") if "online" in device else "-")

    table_lines = [
        "| 字段 | 值 |",
        "| --- | --- |",
        f"| 类型 | `{kind}` |",
        f"| 版本 | `{version}` |",
        f"| 平台 | `{platform}` |",
        f"| 发行版 | `{distribution}` |",
        f"| 屏幕 | `{screen}` |",
        f"| 语言 | `{language}` |",
        f"| 主题 | `{theme}` |",
        f"| 在线 | `{online}` |",
        f"| User-Agent | `{user_agent}` |",
    ]
    sections.append("\n".join(table_lines))

    # Optional user contact
    contact = str(payload.get("contact") or "").strip()
    if contact:
        sections.append(f"**联系方式**：{contact}")

    # User message / description
    raw_message = str(payload.get("message") or "").strip()
    if raw_message:
        # Typed by the user on purpose (the panel warns it is public), so only paths are masked.
        sections.append(f"### 用户描述\n\n{_redact_paths(raw_message)}")

    base_body = "\n\n".join(sections)

    if not include_log or not log_obj:
        if len(base_body) > MAX_ISSUE_BODY_CHARS:
            base_body = base_body[:MAX_ISSUE_BODY_CHARS]
        return IssueSpec(title=title, body=base_body, labels=labels)

    entries = log_obj.get("entries") if isinstance(log_obj.get("entries"), list) else []
    sorted_entries = sorted(
        (e for e in entries if isinstance(e, dict)),
        key=lambda e: e.get("t", 0) if isinstance(e.get("t"), (int, float)) else 0,
    )

    log_lines: list[str] = []
    for entry in sorted_entries:
        iso_time = _format_iso_ms(entry.get("t"))
        level = str(entry.get("level") or "info")
        source = str(entry.get("source") or "app")
        msg = redact_log_text(str(entry.get("message") or ""))
        log_lines.append(f"{iso_time} [{level}] {source}: {msg}")

    native_log = log_obj.get("nativeLog")
    if isinstance(native_log, str) and native_log.strip():
        log_lines.append("--- nativeLog ---")
        log_lines.append(redact_log_text(native_log.strip()))

    log_text = "\n".join(log_lines) if log_lines else "(无日志条目)"
    details_open = "\n\n<details><summary>诊断日志</summary>\n\n```text\n"
    details_close = "\n```\n</details>"
    truncation_note = "\n...(日志过长已截断)"

    full_body = base_body + details_open + log_text + details_close
    if len(full_body) <= MAX_ISSUE_BODY_CHARS:
        return IssueSpec(title=title, body=full_body, labels=labels)

    budget = (
        MAX_ISSUE_BODY_CHARS
        - len(base_body)
        - len(details_open)
        - len(truncation_note)
        - len(details_close)
    )
    truncated_log = log_text[: max(0, budget)]
    truncated_body = (
        base_body + details_open + truncated_log + truncation_note + details_close
    )
    return IssueSpec(title=title, body=truncated_body, labels=labels)


def parse_sums(text: str) -> dict[str, str]:
    """Parse sha256sum output (`<64hex>  <name>` or `<64hex> *<name>`)."""
    if not isinstance(text, str):
        return {}
    result: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = _SUM_LINE_RE.match(line)
        if not match:
            continue
        digest, filename = match.group(1).lower(), match.group(2)
        result[filename] = digest
    return result


def valid_tag(tag: str) -> bool:
    """Validate release tag format `^v\\d+\\.\\d+\\.\\d+$`."""
    return isinstance(tag, str) and bool(_TAG_RE.match(tag))


def valid_asset_name(name: str, tag: Optional[str] = None) -> bool:
    """Validate release asset filename against whitelist and optional tag."""
    if not isinstance(name, str):
        return False
    match = _ASSET_WHITELIST_RE.match(name)
    if not match:
        return False
    version = match.group("version")
    if version.startswith(".") or version.endswith(".") or ".." in version:
        return False
    if tag is not None:
        if not valid_tag(tag):
            return False
        if f"v{version}" != tag:
            return False
    return True


def build_release_info(
    release_data: dict[str, Any],
    sums: Union[str, dict[str, str], None] = None,
    mirror_base: str = DEFAULT_MIRROR_BASE,
) -> dict[str, Any]:
    """Convert GitHub release JSON + SHA256SUMS into ReleaseInfo shape."""
    tag = str(release_data.get("tag_name") or "")
    version = tag[1:] if tag.startswith("v") else tag
    notes = str(release_data.get("body") or "")

    if isinstance(sums, str):
        sums_map = parse_sums(sums)
    elif isinstance(sums, dict):
        sums_map = {str(k): str(v).lower() for k, v in sums.items()}
    else:
        sums_map = {}

    base = mirror_base.rstrip("/")
    raw_assets = release_data.get("assets")
    assets_out: list[dict[str, Any]] = []
    if isinstance(raw_assets, list):
        for item in raw_assets:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            if valid_tag(tag):
                if not valid_asset_name(name, tag):
                    continue
            elif not valid_asset_name(name):
                continue

            asset_entry: dict[str, Any] = {
                "name": name,
                "size": int(item.get("size") or 0),
                "url": str(item.get("browser_download_url") or ""),
                "mirrorUrl": f"{base}/api/update/dl/{tag}/{name}",
            }
            if name in sums_map:
                asset_entry["sha256"] = sums_map[name]
            assets_out.append(asset_entry)

    return {
        "version": version,
        "tag": tag,
        "notes": notes,
        "assets": assets_out,
    }


def parse_range(
    range_header: Optional[str], file_size: int
) -> Optional[tuple[int, int]]:
    """Parse HTTP Range header into inclusive (start, end) byte offsets."""
    if not isinstance(range_header, str) or not range_header or file_size <= 0:
        return None
    match = _RANGE_HEADER_RE.match(range_header.strip())
    if not match:
        return None
    start_str, end_str = match.group(1), match.group(2)
    if not start_str and not end_str:
        return None

    if start_str and end_str:
        start = int(start_str)
        end = int(end_str)
        if start >= file_size or start > end:
            return None
        return (start, min(end, file_size - 1))

    if start_str:
        start = int(start_str)
        if start >= file_size:
            return None
        return (start, file_size - 1)

    suffix = int(end_str)
    if suffix <= 0:
        return None
    start = max(0, file_size - suffix)
    return (start, file_size - 1)


parse_range_header = parse_range


def is_allowed_origin(
    origin: Optional[str],
    allowed_origins: Iterable[str] = DEFAULT_ALLOWED_ORIGINS,
) -> bool:
    if not origin or not isinstance(origin, str):
        return False
    if _LOOPBACK_ORIGIN_RE.match(origin):
        return True
    return origin in set(allowed_origins)


class _TimeoutHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args: Any, read_timeout: float = 20.0, **kwargs: Any) -> None:
        self._read_timeout = read_timeout
        super().__init__(*args, **kwargs)

    def connect(self) -> None:
        super().connect()
        if self.sock is not None:
            self.sock.settimeout(self._read_timeout)


class _TimeoutHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args: Any, read_timeout: float = 20.0, **kwargs: Any) -> None:
        self._read_timeout = read_timeout
        super().__init__(*args, **kwargs)

    def connect(self) -> None:
        super().connect()
        if self.sock is not None:
            self.sock.settimeout(self._read_timeout)


def _build_timeout_opener(read_timeout: float) -> urllib.request.OpenerDirector:
    class TimeoutHTTPHandler(urllib.request.HTTPHandler):
        def http_open(self, req: urllib.request.Request) -> Any:
            return self.do_open(
                lambda host, **kw: _TimeoutHTTPConnection(
                    host, read_timeout=read_timeout, **kw
                ),
                req,
            )

    class TimeoutHTTPSHandler(urllib.request.HTTPSHandler):
        def https_open(self, req: urllib.request.Request) -> Any:
            return self.do_open(
                lambda host, **kw: _TimeoutHTTPSConnection(
                    host, read_timeout=read_timeout, **kw
                ),
                req,
                context=self._context,
            )

    return urllib.request.build_opener(TimeoutHTTPHandler, TimeoutHTTPSHandler)


class GitHubError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class GitHubClient:
    """Thin wrapper around GitHub REST API and release downloads."""

    def __init__(
        self,
        token: str,
        repo: str = DEFAULT_REPO,
        connect_timeout: float = 10.0,
        read_timeout: float = 20.0,
        opener: Optional[ urllib.request.OpenerDirector] = None,
    ) -> None:
        self.token = token
        self.repo = repo
        self.connect_timeout = connect_timeout
        self.read_timeout = read_timeout
        self._opener = opener or _build_timeout_opener(read_timeout)

    def _headers(self, accept: str = "application/vnd.github+json") -> dict[str, str]:
        headers = {
            "Accept": accept,
            "User-Agent": "uku-relay/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def create_issue(
        self, title: str, body: str, labels: list[str]
    ) -> dict[str, Any]:
        url = f"https://api.github.com/repos/{self.repo}/issues"
        payload = json.dumps(
            {"title": title, "body": body, "labels": labels}
        ).encode("utf-8")
        headers = self._headers()
        headers["Content-Type"] = "application/json; charset=utf-8"
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with self._opener.open(req, timeout=self.connect_timeout) as resp:
                raw = resp.read().decode("utf-8")
                data = json.loads(raw)
                return {
                    "number": int(data["number"]),
                    "url": str(data.get("html_url") or data.get("url") or ""),
                }
        except urllib.error.HTTPError as exc:
            raise GitHubError(f"GitHub create_issue HTTP {exc.code}", exc.code) from exc
        except Exception as exc:
            raise GitHubError("GitHub create_issue failed") from exc

    def get_latest_release(self) -> dict[str, Any]:
        url = f"https://api.github.com/repos/{self.repo}/releases/latest"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with self._opener.open(req, timeout=self.connect_timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            raise GitHubError(
                f"GitHub get_latest_release HTTP {exc.code}", exc.code
            ) from exc
        except Exception as exc:
            raise GitHubError("GitHub get_latest_release failed") from exc

    def fetch_text(self, url: str) -> str:
        req = urllib.request.Request(
            url, headers=self._headers(accept="*/*"), method="GET"
        )
        try:
            with self._opener.open(req, timeout=self.connect_timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            raise GitHubError(f"GitHub fetch_text HTTP {exc.code}", exc.code) from exc
        except Exception as exc:
            raise GitHubError("GitHub fetch_text failed") from exc

    def download_asset(
        self,
        tag: str,
        name: str,
        dest_path: Path,
        url: Optional[str] = None,
    ) -> None:
        target_url = (
            url or f"https://github.com/{self.repo}/releases/download/{tag}/{name}"
        )
        req = urllib.request.Request(
            target_url,
            headers={"User-Agent": "uku-relay/1.0", "Accept": "application/octet-stream"},
            method="GET",
        )
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        part_path = dest_path.parent / f".{dest_path.name}.{threading.get_ident()}.part"
        try:
            with self._opener.open(req, timeout=self.connect_timeout) as resp:
                with part_path.open("wb") as out_file:
                    while True:
                        chunk = resp.read(STREAM_CHUNK_BYTES)
                        if not chunk:
                            break
                        out_file.write(chunk)
            os.replace(part_path, dest_path)
        except urllib.error.HTTPError as exc:
            if part_path.exists():
                try:
                    part_path.unlink()
                except OSError:
                    pass
            raise GitHubError(
                f"GitHub download_asset HTTP {exc.code}", exc.code
            ) from exc
        except Exception as exc:
            if part_path.exists():
                try:
                    part_path.unlink()
                except OSError:
                    pass
            raise GitHubError("GitHub download_asset failed") from exc


# The three helpers below mirror `cleanPixivDescription`, `cleanPixivContent` and
# `toPixivMirrorCoverUrl` in app/utils/pixivImporter.ts: keep them in step.
def clean_pixiv_description(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"\r\n?", "\n", html)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"&nbsp;", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"&lt;", "<", text, flags=re.IGNORECASE)
    text = re.sub(r"&gt;", ">", text, flags=re.IGNORECASE)
    text = re.sub(r"&quot;", '"', text, flags=re.IGNORECASE)
    text = re.sub(r"&#39;|&apos;|&#x27;", "'", text, flags=re.IGNORECASE)
    text = re.sub(r"&amp;", "&", text, flags=re.IGNORECASE)
    return text.strip()


def clean_pixiv_content(raw: str) -> tuple[str, dict[str, str]]:
    ruby_overrides: dict[str, str] = {}
    if not raw:
        return "", ruby_overrides

    def ruby(match: re.Match[str]) -> str:
        kanji = match.group(1).strip()
        reading = match.group(2).strip()
        if kanji and reading:
            ruby_overrides[kanji] = reading
        return f"{kanji}({reading})" if reading else kanji

    content = re.sub(r"\r\n?", "\n", raw)
    content = _PIXIV_RUBY_RE.sub(ruby, content)
    content = re.sub(r"\[chapter:([^\]]+)\]", "\n【\\1】\n", content, flags=re.IGNORECASE)
    content = re.sub(r"\[newpage\]", "\n\n", content, flags=re.IGNORECASE)
    content = re.sub(r"\[pixivimage:[^\]]+\]", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\[uploadedimage:[^\]]+\]", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\n{4,}", "\n\n\n", content).strip()
    return content, ruby_overrides


def to_pixiv_mirror_cover_url(cover_url: str) -> str:
    if not cover_url:
        return ""
    trimmed = cover_url.strip()
    if trimmed.startswith("data:"):
        return trimmed
    return re.sub(r"^https?://i\.pximg\.net/", "https://i.pixiv.re/", trimmed, flags=re.IGNORECASE)


class PixivError(Exception):
    """A failure whose message is shown to the user as is (same wording as the Next.js route)."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class PixivClient:
    """Fetches a novel from Pixiv's AJAX API, which browsers cannot call cross-origin."""

    def __init__(
        self,
        connect_timeout: float = 10.0,
        read_timeout: float = 20.0,
        opener: Optional[urllib.request.OpenerDirector] = None,
    ) -> None:
        self.connect_timeout = connect_timeout
        self._opener = opener or _build_timeout_opener(read_timeout)

    def _get(self, url: str, limit: int) -> tuple[bytes, str]:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": PIXIV_USER_AGENT,
                "Referer": "https://www.pixiv.net/",
                "Accept-Language": "ja,zh-CN;q=0.9,en;q=0.8",
            },
            method="GET",
        )
        with self._opener.open(req, timeout=self.connect_timeout) as resp:
            data = resp.read(limit + 1)
            if len(data) > limit:
                raise ValueError("response too large")
            return data, str(resp.headers.get("Content-Type") or "")

    def _cover_data_url(self, cover_url: str) -> str:
        # Embed the cover so the library keeps it offline and i.pximg.net's Referer check
        # never matters; fall back to the public mirror when the download fails.
        if not _PIXIV_COVER_HOST_RE.match(cover_url):
            return to_pixiv_mirror_cover_url(cover_url)
        try:
            data, content_type = self._get(cover_url, MAX_PIXIV_COVER_BYTES)
        except Exception:
            return to_pixiv_mirror_cover_url(cover_url)
        mime = content_type.split(";", 1)[0].strip().lower()
        if not mime.startswith("image/"):
            mime = "image/jpeg"
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"

    def fetch_novel(self, novel_id: str) -> dict[str, Any]:
        url = f"https://www.pixiv.net/ajax/novel/{urllib.parse.quote(novel_id)}"
        try:
            raw, _ = self._get(url, MAX_PIXIV_JSON_BYTES)
        except urllib.error.HTTPError as exc:
            # Pixiv answers a deleted or private novel with an error JSON body; prefer its message.
            message = ""
            try:
                message = str(json.loads(exc.read(64 * 1024).decode("utf-8")).get("message") or "")
            except Exception:
                pass
            if message:
                raise PixivError(message, 404) from exc
            raise PixivError(
                f"无法从 Pixiv 获取小说 (HTTP {exc.code})", 404 if exc.code == 404 else 502
            ) from exc
        except Exception as exc:
            raise PixivError("无法连接 Pixiv，请稍后再试") from exc

        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise PixivError("Pixiv 返回了无法解析的数据") from exc
        body = data.get("body") if isinstance(data, dict) else None
        if not isinstance(data, dict) or data.get("error") is not False or not isinstance(body, dict):
            message = data.get("message") if isinstance(data, dict) else None
            raise PixivError(str(message or "未找到该 Pixiv 小说"), 404)

        def text(key: str) -> str:
            value = body.get(key)
            return value if isinstance(value, str) else ""

        content, ruby_overrides = clean_pixiv_content(text("content"))
        if not content.strip():
            if body.get("isLoginOnly") is True:
                raise PixivError(
                    "这篇 Pixiv 小说需要登录后才能阅读。请前往「设置 → Pixiv 账号」登录自己的账号后重试。", 403
                )
            raise PixivError("Pixiv 返回的正文为空，未导入空白书籍。作品可能需要登录或受到访问限制，请在 Pixiv 页面确认正文是否可见。")
        cover = text("coverUrl")
        return {
            "id": novel_id,
            "title": (text("title") or f"Pixiv #{novel_id}").strip(),
            "author": text("userName").strip(),
            "description": clean_pixiv_description(text("description")),
            "content": content,
            "rubyOverrides": ruby_overrides,
            "coverUrl": self._cover_data_url(cover) if cover else "",
            "sourceUrl": f"https://www.pixiv.net/novel/show.php?id={novel_id}",
        }


def _version_tuple_from_name(filename: str) -> tuple[int, ...]:
    match = _ASSET_WHITELIST_RE.match(filename)
    if not match:
        return (0, 0, 0)
    parts = []
    for p in match.group("version").split("."):
        if p.isdigit():
            parts.append(int(p))
    return tuple(parts)


class RelayService:
    """Stateful application core for feedback, release cache, and mirror downloads."""

    def __init__(
        self,
        github_client: Any,
        cache_dir: Union[str, Path] = DEFAULT_CACHE_DIR,
        allowed_origins: Iterable[str] = DEFAULT_ALLOWED_ORIGINS,
        mirror_base: str = DEFAULT_MIRROR_BASE,
        rate_limiter: Optional[RateLimiter] = None,
        clock: Callable[[], float] = time.time,
        max_concurrent_downloads: int = MAX_CONCURRENT_DOWNLOADS,
        max_cached_versions: int = MAX_CACHED_VERSIONS,
        pixiv_client: Any = None,
        pixiv_rate_limiter: Optional[RateLimiter] = None,
    ) -> None:
        self.github = github_client
        self.pixiv = pixiv_client or PixivClient()
        # Every request reaches us from 127.0.0.1 (see RateLimiter), so this only caps how hard
        # the server as a whole can hit Pixiv; the per-key limits are set to the same values.
        self.pixiv_rate_limiter = pixiv_rate_limiter or RateLimiter(
            per_hour=120, per_day=1000, global_per_hour=120, global_per_day=1000, clock=clock
        )
        self._pixiv_lock = threading.Lock()
        self._pixiv_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self.cache_dir = Path(cache_dir)
        self.allowed_origins = tuple(allowed_origins)
        self.mirror_base = mirror_base
        self._clock = clock
        self.rate_limiter = rate_limiter or RateLimiter(clock=clock)
        self.max_cached_versions = max_cached_versions

        self._release_lock = threading.Lock()
        self._cached_release: Optional[dict[str, Any]] = None
        self._cached_release_at: float = 0.0
        self._sums_cache: dict[str, str] = {}

        self._download_sem = threading.BoundedSemaphore(max_concurrent_downloads)
        self._file_locks_guard = threading.Lock()
        self._file_locks: dict[str, threading.Lock] = {}
        self._version_seq_lock = threading.Lock()
        self._version_seq: dict[str, int] = {}
        self._seq_counter = 0

    def get_pixiv_novel(self, novel_id: str) -> Optional[dict[str, Any]]:
        """Returns the novel, or None when the Pixiv rate limit is exhausted."""
        now = float(self._clock())
        with self._pixiv_lock:
            cached = self._pixiv_cache.get(novel_id)
            if cached is not None and (now - cached[0]) < PIXIV_CACHE_TTL_SECONDS:
                return cached[1]
        if not self.pixiv_rate_limiter.allow("pixiv", now=now):
            return None
        novel = self.pixiv.fetch_novel(novel_id)
        with self._pixiv_lock:
            self._pixiv_cache = {
                k: v
                for k, v in self._pixiv_cache.items()
                if (now - v[0]) < PIXIV_CACHE_TTL_SECONDS
            }
            while len(self._pixiv_cache) >= PIXIV_CACHE_MAX_ENTRIES:
                oldest = min(self._pixiv_cache, key=lambda k: self._pixiv_cache[k][0])
                del self._pixiv_cache[oldest]
            self._pixiv_cache[novel_id] = (now, novel)
        return novel

    def get_latest_release_info(self) -> dict[str, Any]:
        now = float(self._clock())
        with self._release_lock:
            if (
                self._cached_release is not None
                and (now - self._cached_release_at) < RELEASE_CACHE_TTL_SECONDS
            ):
                return self._cached_release

        try:
            raw_release = self.github.get_latest_release()
            tag = str(raw_release.get("tag_name") or "")
            sums_text = self._resolve_sums_text(raw_release, tag)
            info = build_release_info(
                raw_release, sums=sums_text, mirror_base=self.mirror_base
            )
            with self._release_lock:
                self._cached_release = info
                self._cached_release_at = now
            return info
        except Exception as exc:
            log_stdout(f"WARN release refresh failed: {type(exc).__name__}")
            with self._release_lock:
                if (
                    self._cached_release is not None
                    and (now - self._cached_release_at) < RELEASE_STALE_TTL_SECONDS
                ):
                    return self._cached_release
            raise

    def _resolve_sums_text(self, raw_release: dict[str, Any], tag: str) -> str:
        assets = raw_release.get("assets")
        if not isinstance(assets, list):
            return ""
        sums_url = ""
        for item in assets:
            if isinstance(item, dict) and item.get("name") == "SHA256SUMS.txt":
                sums_url = str(item.get("browser_download_url") or "")
                break
        if not sums_url:
            return ""
        cache_key = f"{tag}:{sums_url}"
        with self._release_lock:
            if cache_key in self._sums_cache:
                return self._sums_cache[cache_key]
        text = self.github.fetch_text(sums_url)
        with self._release_lock:
            self._sums_cache[cache_key] = text
        return text

    def _get_file_lock(self, name: str) -> threading.Lock:
        with self._file_locks_guard:
            lock = self._file_locks.get(name)
            if lock is None:
                lock = threading.Lock()
                self._file_locks[name] = lock
            return lock

    def _record_version_touch(self, tag: str) -> None:
        with self._version_seq_lock:
            self._seq_counter += 1
            self._version_seq[tag] = self._seq_counter

    def cleanup_old_cached_files(self) -> None:
        """Keep at most `max_cached_versions` versions in cache_dir, deleting older ones."""
        if not self.cache_dir.exists():
            return
        version_files: dict[str, list[Path]] = {}
        version_mtime: dict[str, float] = {}
        for entry in self.cache_dir.iterdir():
            if not entry.is_file() or entry.name.endswith(".part") or entry.name.startswith("."):
                continue
            match = _ASSET_WHITELIST_RE.match(entry.name)
            if not match:
                continue
            ver_tag = f"v{match.group('version')}"
            version_files.setdefault(ver_tag, []).append(entry)
            try:
                mtime = entry.stat().st_mtime
            except OSError:
                mtime = 0.0
            if ver_tag not in version_mtime or mtime > version_mtime[ver_tag]:
                version_mtime[ver_tag] = mtime

        if len(version_files) <= self.max_cached_versions:
            return

        with self._version_seq_lock:
            seq_snapshot = dict(self._version_seq)

        def sort_key(ver_tag: str) -> tuple[int, float, tuple[int, ...]]:
            ver_nums = tuple(int(x) for x in ver_tag[1:].split(".") if x.isdigit())
            return (
                seq_snapshot.get(ver_tag, 0),
                version_mtime.get(ver_tag, 0.0),
                ver_nums,
            )

        ordered_versions = sorted(version_files.keys(), key=sort_key, reverse=True)
        for stale_ver in ordered_versions[self.max_cached_versions :]:
            for path in version_files.get(stale_ver, []):
                try:
                    path.unlink()
                except OSError:
                    pass

    def ensure_cached_asset(self, tag: str, name: str) -> Path:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        final_path = self.cache_dir / name
        file_lock = self._get_file_lock(name)
        with file_lock:
            if not final_path.exists():
                self.github.download_asset(tag, name, final_path)
            self._record_version_touch(tag)
            self.cleanup_old_cached_files()
        return final_path


def make_handler(service: RelayService) -> type[BaseHTTPRequestHandler]:
    class RelayRequestHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            log_stdout(f"{self.client_address[0]} - {fmt % args}")

        def _client_ip(self) -> str:
            real_ip = self.headers.get("X-Real-IP")
            if real_ip and real_ip.strip():
                return real_ip.strip()
            return self.client_address[0]

        def _send_cors_headers(self, expose_range: bool = False) -> None:
            origin = self.headers.get("Origin")
            if is_allowed_origin(origin, service.allowed_origins):
                self.send_header("Access-Control-Allow-Origin", origin)  # type: ignore[arg-type]
                self.send_header("Vary", "Origin")
                if expose_range:
                    self.send_header(
                        "Access-Control-Expose-Headers",
                        "Content-Length, Content-Range, Accept-Ranges",
                    )

        def _send_json(
            self,
            status: int,
            data: dict[str, Any],
            extra_headers: Optional[dict[str, str]] = None,
        ) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            if extra_headers:
                for k, v in extra_headers.items():
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._send_cors_headers()
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Content-Type, Range"
            )
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            if path == "/api/health":
                self._send_json(200, {"ok": True})
                return
            if path == "/api/update/latest":
                self._handle_update_latest()
                return
            if path.startswith("/api/update/dl/"):
                self._handle_update_download(path)
                return
            if path == "/api/pixiv":
                self._handle_pixiv()
                return
            self._send_json(404, {"ok": False, "error": "not-found"})

        def do_POST(self) -> None:
            path = self.path.split("?", 1)[0]
            if path == "/api/feedback":
                self._handle_feedback()
                return
            self._send_json(404, {"ok": False, "error": "not-found"})

        def _handle_feedback(self) -> None:
            length_str = self.headers.get("Content-Length")
            if length_str is None:
                self._send_json(400, {"ok": False, "error": "invalid"})
                return
            try:
                content_length = int(length_str)
            except ValueError:
                self._send_json(400, {"ok": False, "error": "invalid"})
                return

            if content_length < 0:
                self._send_json(400, {"ok": False, "error": "invalid"})
                return

            if content_length > MAX_FEEDBACK_BODY_BYTES:
                self.close_connection = True
                self._send_json(
                    413,
                    {"ok": False, "error": "too-large"},
                    extra_headers={"Connection": "close"},
                )
                return

            raw_body = self.rfile.read(content_length)
            if len(raw_body) > MAX_FEEDBACK_BODY_BYTES:
                self._send_json(413, {"ok": False, "error": "too-large"})
                return

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except Exception:
                self._send_json(400, {"ok": False, "error": "invalid"})
                return

            if not validate_feedback(payload):
                self._send_json(400, {"ok": False, "error": "invalid"})
                return

            if not service.github.token:
                self._send_json(503, {"ok": False, "error": "server"})
                return

            if not service.rate_limiter.allow(rate_limit_key(payload, self._client_ip())):
                self._send_json(429, {"ok": False, "error": "rate-limited"})
                return

            issue = build_issue(payload)
            try:
                created = service.github.create_issue(
                    issue.title, issue.body, issue.labels
                )
            except Exception as exc:
                log_stdout(f"ERROR create_issue failed: {type(exc).__name__}")
                self._send_json(502, {"ok": False, "error": "server"})
                return

            self._send_json(
                200,
                {
                    "ok": True,
                    "number": int(created["number"]),
                    "url": str(created["url"]),
                },
            )

        def _handle_pixiv(self) -> None:
            # Same contract as app/api/pixiv/route.ts: the novel on success, `{"error": message}`
            # otherwise, which pixivImporter.ts shows to the user verbatim.
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            novel_id = (query.get("id") or [""])[0].strip()
            if not _PIXIV_ID_RE.match(novel_id):
                self._send_json(400, {"error": "无效的 Pixiv 小说链接或 ID"})
                return
            try:
                novel = service.get_pixiv_novel(novel_id)
            except PixivError as exc:
                self._send_json(exc.status_code, {"error": str(exc)})
                return
            except Exception as exc:
                log_stdout(f"ERROR pixiv fetch failed: {type(exc).__name__}")
                self._send_json(502, {"error": "获取 Pixiv 小说失败"})
                return
            if novel is None:
                self._send_json(
                    429,
                    {"error": "请求过于频繁，请稍后再试"},
                    extra_headers={"Retry-After": "60"},
                )
                return
            self._send_json(200, novel)

        def _handle_update_latest(self) -> None:
            try:
                info = service.get_latest_release_info()
            except Exception as exc:
                log_stdout(f"ERROR get_latest_release_info failed: {type(exc).__name__}")
                self._send_json(502, {"ok": False, "error": "server"})
                return
            self._send_json(200, info)

        def _handle_update_download(self, path: str) -> None:
            prefix = "/api/update/dl/"
            rest = path[len(prefix) :]
            parts = rest.split("/")
            if len(parts) != 2:
                self._send_json(404, {"ok": False, "error": "not-found"})
                return
            tag, name = parts[0], parts[1]
            if not valid_tag(tag) or not valid_asset_name(name, tag):
                self._send_json(404, {"ok": False, "error": "not-found"})
                return

            if not service._download_sem.acquire(blocking=False):
                self._send_json(
                    503,
                    {"ok": False, "error": "busy"},
                    extra_headers={"Retry-After": "5"},
                )
                return

            try:
                try:
                    cached_path = service.ensure_cached_asset(tag, name)
                except GitHubError as exc:
                    if exc.status_code == 404:
                        self._send_json(404, {"ok": False, "error": "not-found"})
                    else:
                        log_stdout(f"ERROR mirror download failed: {exc}")
                        self._send_json(502, {"ok": False, "error": "server"})
                    return
                except Exception as exc:
                    log_stdout(f"ERROR mirror download failed: {type(exc).__name__}")
                    self._send_json(502, {"ok": False, "error": "server"})
                    return

                try:
                    file_size = cached_path.stat().st_size
                except OSError:
                    self._send_json(502, {"ok": False, "error": "server"})
                    return

                range_header = self.headers.get("Range")
                if range_header is not None:
                    byte_range = parse_range(range_header, file_size)
                    if byte_range is None:
                        self.send_response(416)
                        self._send_cors_headers(expose_range=True)
                        self.send_header("Content-Range", f"bytes */{file_size}")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    start, end = byte_range
                    content_length = end - start + 1
                    self.send_response(206)
                    self._send_cors_headers(expose_range=True)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header(
                        "Content-Range", f"bytes {start}-{end}/{file_size}"
                    )
                    self.send_header("Content-Length", str(content_length))
                    self.end_headers()
                    self._stream_file_range(cached_path, start, content_length)
                else:
                    self.send_response(200)
                    self._send_cors_headers(expose_range=True)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", str(file_size))
                    self.end_headers()
                    self._stream_file_range(cached_path, 0, file_size)
            finally:
                service._download_sem.release()

        def _stream_file_range(
            self, file_path: Path, start: int, length: int
        ) -> None:
            remaining = length
            with file_path.open("rb") as fh:
                if start > 0:
                    fh.seek(start)
                while remaining > 0:
                    chunk = fh.read(min(STREAM_CHUNK_BYTES, remaining))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        break
                    remaining -= len(chunk)

    return RelayRequestHandler


def load_config_from_env(
    env: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    source = os.environ if env is None else env
    # Optional: without a token the update endpoints still work and feedback answers 503.
    token = source.get("UKU_GITHUB_TOKEN", "").strip()
    repo = source.get("UKU_REPO", DEFAULT_REPO).strip() or DEFAULT_REPO
    bind = source.get("UKU_BIND", DEFAULT_BIND).strip() or DEFAULT_BIND
    port = int(source.get("UKU_PORT", str(DEFAULT_PORT)))
    cache_dir = source.get("UKU_CACHE_DIR", DEFAULT_CACHE_DIR).strip() or DEFAULT_CACHE_DIR
    origins_raw = source.get("UKU_ALLOWED_ORIGINS")
    if origins_raw is None or not origins_raw.strip():
        allowed_origins = DEFAULT_ALLOWED_ORIGINS
    else:
        allowed_origins = tuple(
            o.strip() for o in origins_raw.split(",") if o.strip()
        )
    return {
        "token": token,
        "repo": repo,
        "bind": bind,
        "port": port,
        "cache_dir": cache_dir,
        "allowed_origins": allowed_origins,
    }


def create_server(
    service: RelayService,
    bind: str = DEFAULT_BIND,
    port: int = DEFAULT_PORT,
) -> ThreadingHTTPServer:
    handler_cls = make_handler(service)
    return ThreadingHTTPServer((bind, port), handler_cls)


def main() -> None:
    cfg = load_config_from_env()
    if not cfg["token"]:
        log_stdout("WARN UKU_GITHUB_TOKEN is not set: /api/feedback is disabled")
    github = GitHubClient(token=cfg["token"], repo=cfg["repo"])
    service = RelayService(
        github_client=github,
        cache_dir=cfg["cache_dir"],
        allowed_origins=cfg["allowed_origins"],
    )
    server = create_server(service, bind=cfg["bind"], port=cfg["port"])
    log_stdout(f"Listening on http://{cfg['bind']}:{cfg['port']} (repo={cfg['repo']})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
