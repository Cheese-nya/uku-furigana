import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import relay  # noqa: E402


def _sample_log_report(**overrides):
    base = {
        "app": "uku-furigana",
        "version": "1.2.1",
        "platform": "android",
        "distribution": "website",
        "device": {
            "platform": "android",
            "userAgent": "Mozilla/5.0 /home/alice/secret",
            "screen": "412x915@2.6",
            "language": "zh-CN",
            "theme": "dark",
            "online": True,
        },
        "entries": [
            {
                "t": 1729753005000,
                "level": "error",
                "source": "export",
                "message": "Failed at C:\\Users\\bob\\Documents\\script.docx with あいうえおかき",
            },
            {
                "t": 1729753000000,
                "level": "info",
                "source": "engine",
                "message": "Init ok 日本語漢字",
            },
        ],
        "nativeLog": "Crash at /home/charlie/app: 一二三四五六七",
    }
    base.update(overrides)
    return base


class FakeGitHubClient:
    def __init__(self, token="test-token"):
        self.token = token
        self.issues_created = []
        self.fail_create_issue = False
        self.fail_latest_release = False
        self.release_calls = 0
        self.sums_calls = 0
        self.download_calls = []
        self.download_Barrier = None
        self.latest_release_payload = {
            "tag_name": "v1.3.0",
            "body": "### What's New\n- Bug fixes",
            "assets": [
                {
                    "name": "Uku-Furigana-v1.3.0.apk",
                    "size": 1024,
                    "browser_download_url": "https://github.com/Cheese-nya/uku-furigana/releases/download/v1.3.0/Uku-Furigana-v1.3.0.apk",
                },
                {
                    "name": "Uku-Furigana-v1.3.0-windows.exe",
                    "size": 2048,
                    "browser_download_url": "https://github.com/Cheese-nya/uku-furigana/releases/download/v1.3.0/Uku-Furigana-v1.3.0-windows.exe",
                },
                {
                    "name": "SHA256SUMS.txt",
                    "size": 256,
                    "browser_download_url": "https://github.com/Cheese-nya/uku-furigana/releases/download/v1.3.0/SHA256SUMS.txt",
                },
                {
                    "name": "notes.txt",
                    "size": 12,
                    "browser_download_url": "https://github.com/Cheese-nya/uku-furigana/releases/download/v1.3.0/notes.txt",
                },
            ],
        }
        self.sums_text = (
            "a" * 64 + "  Uku-Furigana-v1.3.0.apk\n"
            + "B" * 64 + " *Uku-Furigana-v1.3.0-windows.exe\n"
        )
        self.asset_bytes = b"0123456789abcdef" * 4

    def create_issue(self, title, body, labels):
        if self.fail_create_issue:
            raise relay.GitHubError("Simulated failure token=ghp_secret", 500)
        self.issues_created.append({"title": title, "body": body, "labels": labels})
        return {
            "number": 42,
            "url": "https://github.com/Cheese-nya/uku-furigana/issues/42",
        }

    def get_latest_release(self):
        self.release_calls += 1
        if self.fail_latest_release:
            raise relay.GitHubError("Simulated failure", 502)
        return self.latest_release_payload

    def fetch_text(self, url):
        self.sums_calls += 1
        if self.fail_latest_release:
            raise relay.GitHubError("Simulated sums failure", 502)
        return self.sums_text

    def download_asset(self, tag, name, dest_path, url=None):
        self.download_calls.append((tag, name))
        if self.download_Barrier is not None:
            self.download_Barrier()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        part_path = dest_path.parent / f".{dest_path.name}.part"
        part_path.write_bytes(self.asset_bytes)
        part_path.replace(dest_path)


class TestRedactLogText(unittest.TestCase):
    def test_five_cjk_or_kana_not_redacted(self):
        self.assertEqual(relay.redact_log_text("あいうえお"), "あいうえお")
        self.assertEqual(relay.redact_log_text("アイウエオ"), "アイウエオ")
        self.assertEqual(relay.redact_log_text("一二三四五"), "一二三四五")
        self.assertEqual(
            relay.redact_log_text("prefix あいうえお suffix"),
            "prefix あいうえお suffix",
        )

    def test_six_or_more_cjk_or_kana_redacted(self):
        self.assertEqual(relay.redact_log_text("あいうえおか"), "[文本已隐去]")
        self.assertEqual(relay.redact_log_text("アイウエオカキ"), "[文本已隐去]")
        self.assertEqual(relay.redact_log_text("一二三四五六"), "[文本已隐去]")
        self.assertEqual(
            relay.redact_log_text("err: 漢字あいうえ! ok: 漢字あいう"),
            "err: [文本已隐去]! ok: 漢字あいう",
        )

    def test_user_paths_redacted(self):
        self.assertEqual(
            relay.redact_log_text("open /home/cheese/project/a.txt failed"),
            "open /home/<user>/project/a.txt failed",
        )
        self.assertEqual(
            relay.redact_log_text(r"File C:\Users\Administrator\AppData\Local\uku.log"),
            r"File C:\Users\<user>\AppData\Local\uku.log",
        )
        self.assertEqual(
            relay.redact_log_text("File C:/Users/alice/Desktop/script.docx"),
            "File C:/Users/<user>/Desktop/script.docx",
        )
        self.assertEqual(
            relay.redact_log_text("File /Users/macuser/Library/Logs/uku.log"),
            "File /Users/<user>/Library/Logs/uku.log",
        )


class TestValidateFeedback(unittest.TestCase):
    def test_valid_log_and_text_payloads(self):
        self.assertTrue(
            relay.validate_feedback(
                {
                    "kind": "log",
                    "includeLog": True,
                    "log": _sample_log_report(),
                }
            )
        )
        self.assertTrue(
            relay.validate_feedback(
                {
                    "kind": "text",
                    "title": "导出 Word 失败",
                    "message": "点击导出按钮没有任何反应",
                    "contact": "qq:123456",
                    "includeLog": False,
                }
            )
        )

    def test_invalid_inputs(self):
        self.assertFalse(relay.validate_feedback(None))
        self.assertFalse(relay.validate_feedback([]))
        # Bad kind
        self.assertFalse(
            relay.validate_feedback({"kind": "other", "includeLog": False})
        )
        # kind == 'text' requires title 1..80 chars
        self.assertFalse(
            relay.validate_feedback({"kind": "text", "includeLog": False})
        )
        self.assertFalse(
            relay.validate_feedback(
                {"kind": "text", "title": "   ", "includeLog": False}
            )
        )
        self.assertFalse(
            relay.validate_feedback(
                {"kind": "text", "title": "x" * 81, "includeLog": False}
            )
        )
        # message > 4000
        self.assertFalse(
            relay.validate_feedback(
                {
                    "kind": "text",
                    "title": "ok",
                    "message": "m" * 4001,
                    "includeLog": False,
                }
            )
        )
        # contact > 80
        self.assertFalse(
            relay.validate_feedback(
                {
                    "kind": "text",
                    "title": "ok",
                    "contact": "c" * 81,
                    "includeLog": False,
                }
            )
        )
        # includeLog true but missing or wrong app
        self.assertFalse(
            relay.validate_feedback(
                {"kind": "text", "title": "ok", "includeLog": True}
            )
        )
        self.assertFalse(
            relay.validate_feedback(
                {
                    "kind": "log",
                    "includeLog": True,
                    "log": _sample_log_report(app="other-app"),
                }
            )
        )
        # entries > 500
        many_entries = [
            {"t": i, "level": "info", "source": "s", "message": "ok"}
            for i in range(501)
        ]
        self.assertFalse(
            relay.validate_feedback(
                {
                    "kind": "log",
                    "includeLog": True,
                    "log": _sample_log_report(entries=many_entries),
                }
            )
        )
        # single entry message > 500
        long_entry = [
            {"t": 1, "level": "error", "source": "s", "message": "e" * 501}
        ]
        self.assertFalse(
            relay.validate_feedback(
                {
                    "kind": "log",
                    "includeLog": True,
                    "log": _sample_log_report(entries=long_entry),
                }
            )
        )


class TestRateLimiter(unittest.TestCase):
    def test_hourly_and_daily_per_ip_limits(self):
        now = [100000.0]
        limiter = relay.RateLimiter(
            per_hour=5, per_day=20, global_per_day=200, clock=lambda: now[0]
        )
        for _ in range(5):
            self.assertTrue(limiter.allow("1.2.3.4"))
        # 6th in the same hour is blocked
        self.assertFalse(limiter.allow("1.2.3.4"))
        # Different IP is still allowed
        self.assertTrue(limiter.allow("5.6.7.8"))

        # Advance 1h + 1s -> 3 more hours of 5 requests (total 20 in day)
        for _ in range(3):
            now[0] += 3601.0
            for _ in range(5):
                self.assertTrue(limiter.allow("1.2.3.4"))
            self.assertFalse(limiter.allow("1.2.3.4"))

        # 5th hour within same 24h window -> blocked by daily limit (20)
        now[0] += 3601.0
        self.assertFalse(limiter.allow("1.2.3.4"))

        # Advance past 24h from initial batch -> allowed again
        now[0] += 86401.0
        self.assertTrue(limiter.allow("1.2.3.4"))

    def test_global_daily_limit(self):
        now = [200000.0]
        limiter = relay.RateLimiter(
            per_hour=5, per_day=20, global_per_day=10, clock=lambda: now[0]
        )
        for i in range(10):
            self.assertTrue(limiter.allow(f"10.0.0.{i}"))
        self.assertFalse(limiter.allow("10.0.0.99"))
        now[0] += 86401.0
        self.assertTrue(limiter.allow("10.0.0.99"))


class TestBuildIssue(unittest.TestCase):
    def test_log_feedback_redacts_and_sorts_entries(self):
        payload = {
            "kind": "log",
            "message": "附加说明：あいうえおかきく",
            "contact": "user@example.com",
            "includeLog": True,
            "log": _sample_log_report(),
        }
        issue = relay.build_issue(payload)
        self.assertEqual(issue.title, "[自动反馈] 1.2.1 / android")
        self.assertEqual(issue.labels, ["from-app", "bug"])
        self.assertIn("user@example.com", issue.body)
        self.assertIn("附加说明：あいうえおかきく", issue.body)  # typed by the user: kept as written
        self.assertNotIn("一二三四五六", issue.body)
        self.assertNotIn("/home/alice/", issue.body)
        self.assertIn("/home/<user>/secret", issue.body)
        self.assertNotIn(r"C:\Users\bob", issue.body)
        self.assertIn(r"C:\Users\<user>\Documents", issue.body)
        self.assertIn("日本語漢字", issue.body)  # 5 chars preserved
        # Earlier timestamp (1729753000000) appears before later (1729753005000)
        idx_first = issue.body.index("[info] engine:")
        idx_second = issue.body.index("[error] export:")
        self.assertLess(idx_first, idx_second)

    def test_text_feedback_preserves_user_title_and_message_cjk(self):
        payload = {
            "kind": "text",
            "title": "在导出包含大量假名的文档时软件会卡住不动",
            "message": "当我打开一篇文章并点击导出按钮的时候，界面一直转圈无法完成导出。",
            "includeLog": True,
            "log": _sample_log_report(),
        }
        title, body, labels = relay.build_issue(payload)
        self.assertEqual(title, "在导出包含大量假名的文档时软件会卡住不动")
        self.assertEqual(labels, ["from-app", "feedback"])
        self.assertIn("当我打开一篇文章并点击导出按钮的时候", body)
        # Log entries are still redacted
        self.assertNotIn("あいうえおか", body)

    def test_issue_body_truncation_over_60000_chars(self):
        huge_entries = [
            {
                "t": 1729753000000 + i * 1000,
                "level": "error",
                "source": "worker",
                "message": f"line-{i}-" + ("x" * 450),
            }
            for i in range(200)
        ]
        payload = {
            "kind": "log",
            "includeLog": True,
            "log": _sample_log_report(entries=huge_entries),
        }
        issue = relay.build_issue(payload)
        self.assertLessEqual(len(issue.body), 60000)
        self.assertIn("<details><summary>诊断日志</summary>", issue.body)
        self.assertIn("日志过长已截断", issue.body)
        self.assertTrue(issue.body.endswith("```\n</details>"))


class TestSumsAndReleaseInfo(unittest.TestCase):
    def test_parse_sums_with_star_and_blank_lines(self):
        h1 = "0123456789abcdef" * 4
        h2 = "FEDCBA9876543210" * 4
        raw = f"\n  \n{h1}  Uku-Furigana-v1.2.1.apk\n{h2} *Uku-Furigana-v1.2.1-windows.exe\ninvalid line\n"
        parsed = relay.parse_sums(raw)
        self.assertEqual(
            parsed,
            {
                "Uku-Furigana-v1.2.1.apk": h1,
                "Uku-Furigana-v1.2.1-windows.exe": h2.lower(),
            },
        )

    def test_valid_tag_and_asset_name(self):
        self.assertTrue(relay.valid_tag("v1.2.1"))
        self.assertFalse(relay.valid_tag("1.2.1"))
        self.assertFalse(relay.valid_tag("v1.2"))
        self.assertFalse(relay.valid_tag("v1.2.1-rc1"))

        self.assertTrue(relay.valid_asset_name("Uku-Furigana-v1.2.1.apk"))
        self.assertTrue(relay.valid_asset_name("Uku-Furigana-v1.2.1-windows.exe"))
        self.assertFalse(relay.valid_asset_name("Uku-Furigana-v1.2.1.zip"))
        self.assertFalse(relay.valid_asset_name("../Uku-Furigana-v1.2.1.apk"))

        # Tag/version consistency
        self.assertTrue(
            relay.valid_asset_name("Uku-Furigana-v1.2.1.apk", "v1.2.1")
        )
        self.assertFalse(
            relay.valid_asset_name("Uku-Furigana-v1.2.1.apk", "v1.2.2")
        )
        self.assertFalse(
            relay.valid_asset_name("Uku-Furigana-v1.2.1-windows.exe", "v2.0.0")
        )

    def test_build_release_info(self):
        fake = FakeGitHubClient()
        # Add an asset with mismatched version to ensure it is filtered out
        release_data = dict(fake.latest_release_payload)
        release_data["assets"] = list(fake.latest_release_payload["assets"]) + [
            {
                "name": "Uku-Furigana-v1.2.9.apk",
                "size": 999,
                "browser_download_url": "https://example.com/old.apk",
            }
        ]
        info = relay.build_release_info(release_data, fake.sums_text)
        self.assertEqual(info["version"], "1.3.0")
        self.assertEqual(info["tag"], "v1.3.0")
        self.assertEqual(len(info["assets"]), 2)
        apk, exe = info["assets"][0], info["assets"][1]
        self.assertEqual(apk["name"], "Uku-Furigana-v1.3.0.apk")
        self.assertEqual(
            apk["mirrorUrl"],
            "https://uku.saiaino.xyz/api/update/dl/v1.3.0/Uku-Furigana-v1.3.0.apk",
        )
        self.assertEqual(apk["sha256"], "a" * 64)
        self.assertEqual(exe["sha256"], "b" * 64)


class TestRangeParsing(unittest.TestCase):
    def test_valid_ranges(self):
        self.assertEqual(relay.parse_range("bytes=0-99", 1000), (0, 99))
        self.assertEqual(relay.parse_range("bytes=500-", 1000), (500, 999))
        self.assertEqual(relay.parse_range("bytes=-200", 1000), (800, 999))
        self.assertEqual(relay.parse_range("bytes=900-5000", 1000), (900, 999))
        self.assertEqual(relay.parse_range("bytes=-5000", 1000), (0, 999))

    def test_invalid_ranges(self):
        self.assertIsNone(relay.parse_range(None, 1000))
        self.assertIsNone(relay.parse_range("", 1000))
        self.assertIsNone(relay.parse_range("bytes=0-10", 0))
        self.assertIsNone(relay.parse_range("bytes=1000-1000", 1000))
        self.assertIsNone(relay.parse_range("bytes=500-100", 1000))
        self.assertIsNone(relay.parse_range("bytes=-0", 1000))
        self.assertIsNone(relay.parse_range("bytes=-", 1000))
        self.assertIsNone(relay.parse_range("items=0-10", 1000))
        self.assertIsNone(relay.parse_range("bytes=0-1, 3-4", 1000))


class TestRelayServerHTTP(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.fake_gh = FakeGitHubClient()
        self.now = [1000000.0]
        self.service = relay.RelayService(
            github_client=self.fake_gh,
            cache_dir=self.temp_dir.name,
            clock=lambda: self.now[0],
        )
        self.server = relay.create_server(self.service, bind="127.0.0.1", port=0)
        self.port = self.server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp_dir.cleanup()

    def _request(self, method, path, body=None, headers=None):
        req_headers = dict(headers or {})
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=req_headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def test_health_and_cors(self):
        status, headers, raw = self._request(
            "GET", "/api/health", headers={"Origin": "http://127.0.0.1:49152"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"ok": True})
        self.assertEqual(
            headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:49152"
        )

        # Disallowed origin does not receive ACAO header
        status, headers, _ = self._request(
            "GET", "/api/health", headers={"Origin": "https://evil.example"}
        )
        self.assertEqual(status, 200)
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_feedback_endpoint_statuses(self):
        # Too large (> 64KB)
        status, _, raw = self._request(
            "POST", "/api/feedback", body=b"x" * (64 * 1024 + 10)
        )
        self.assertEqual(status, 413)
        self.assertEqual(json.loads(raw), {"ok": False, "error": "too-large"})

        # Invalid payload -> 400
        status, _, raw = self._request(
            "POST", "/api/feedback", body={"kind": "text", "includeLog": False}
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw), {"ok": False, "error": "invalid"})

        # Valid submission -> 200
        valid_body = {
            "kind": "log",
            "includeLog": True,
            "log": _sample_log_report(),
        }
        status, _, raw = self._request(
            "POST",
            "/api/feedback",
            body=valid_body,
            headers={"X-Real-IP": "203.0.113.10"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            json.loads(raw),
            {
                "ok": True,
                "number": 42,
                "url": "https://github.com/Cheese-nya/uku-furigana/issues/42",
            },
        )

        # GitHub failure -> 502 without leaking secret details
        self.fake_gh.fail_create_issue = True
        status, _, raw = self._request(
            "POST",
            "/api/feedback",
            body=valid_body,
            headers={"X-Real-IP": "203.0.113.11"},
        )
        self.assertEqual(status, 502)
        self.assertEqual(json.loads(raw), {"ok": False, "error": "server"})
        self.assertNotIn(b"ghp_secret", raw)

    def test_release_latest_caching_and_stale_fallback(self):
        status, _, raw = self._request("GET", "/api/update/latest")
        self.assertEqual(status, 200)
        data = json.loads(raw)
        self.assertEqual(data["version"], "1.3.0")
        self.assertEqual(self.fake_gh.release_calls, 1)

        # Within 10m: served from memory cache
        self.now[0] += 300
        status, _, _ = self._request("GET", "/api/update/latest")
        self.assertEqual(status, 200)
        self.assertEqual(self.fake_gh.release_calls, 1)

        # After 15m with upstream failure: serves stale cache (< 1h)
        self.now[0] += 600
        self.fake_gh.fail_latest_release = True
        status, _, raw = self._request("GET", "/api/update/latest")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["version"], "1.3.0")

        # After > 1h with upstream failure: returns 502
        self.now[0] += 3600
        status, _, raw = self._request("GET", "/api/update/latest")
        self.assertEqual(status, 502)

    def test_mirror_download_range_cache_eviction_and_concurrency(self):
        # Mismatched tag and asset version -> 404
        status, _, _ = self._request(
            "GET", "/api/update/dl/v1.3.0/Uku-Furigana-v1.2.0.apk"
        )
        self.assertEqual(status, 404)

        # Full download -> 200
        status, headers, raw = self._request(
            "GET", "/api/update/dl/v1.3.0/Uku-Furigana-v1.3.0.apk"
        )
        self.assertEqual(status, 200)
        self.assertEqual(raw, self.fake_gh.asset_bytes)
        self.assertEqual(len(self.fake_gh.download_calls), 1)

        # Range request -> 206 served from disk cache (no new upstream download)
        status, headers, raw = self._request(
            "GET",
            "/api/update/dl/v1.3.0/Uku-Furigana-v1.3.0.apk",
            headers={"Range": "bytes=4-9"},
        )
        self.assertEqual(status, 206)
        self.assertEqual(raw, b"456789")
        self.assertEqual(
            headers.get("Content-Range"),
            f"bytes 4-9/{len(self.fake_gh.asset_bytes)}",
        )
        self.assertEqual(len(self.fake_gh.download_calls), 1)

        # Download v1.4.0 and v1.5.0 -> v1.3.0 is evicted (keeps 2 latest versions)
        self._request("GET", "/api/update/dl/v1.4.0/Uku-Furigana-v1.4.0.apk")
        self._request("GET", "/api/update/dl/v1.5.0/Uku-Furigana-v1.5.0.apk")
        cached_names = sorted(p.name for p in Path(self.temp_dir.name).iterdir())
        self.assertEqual(
            cached_names,
            ["Uku-Furigana-v1.4.0.apk", "Uku-Furigana-v1.5.0.apk"],
        )

        # Concurrency limit: hold 2 slots and verify 3rd returns 503 + Retry-After: 5
        self.assertTrue(self.service._download_sem.acquire(blocking=False))
        self.assertTrue(self.service._download_sem.acquire(blocking=False))
        try:
            status, headers, _ = self._request(
                "GET", "/api/update/dl/v1.5.0/Uku-Furigana-v1.5.0.apk"
            )
            self.assertEqual(status, 503)
            self.assertEqual(headers.get("Retry-After"), "5")
        finally:
            self.service._download_sem.release()
            self.service._download_sem.release()


class RateLimitKeyTest(unittest.TestCase):
    def test_client_id_wins_over_ip_and_bad_ids_fall_back(self):
        good = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        self.assertEqual(relay.rate_limit_key({"clientId": good}, "127.0.0.1"), f"id:{good}")
        for bad in ("short", "x" * 65, "has space in it 1234567", 123, None):
            self.assertEqual(relay.rate_limit_key({"clientId": bad}, "127.0.0.1"), "ip:127.0.0.1")

    def test_global_hourly_cap_applies_across_clients(self):
        limiter = relay.RateLimiter(per_hour=5, per_day=20, global_per_day=200, global_per_hour=3, clock=lambda: 1000.0)
        self.assertTrue(all(limiter.allow(f"id:{n}") for n in range(3)))
        self.assertFalse(limiter.allow("id:other"))
        self.assertTrue(limiter.allow("id:later", now=1000.0 + 3601))


class OptionalTokenTest(unittest.TestCase):
    def test_config_loads_without_a_token(self):
        cfg = relay.load_config_from_env({})
        self.assertEqual(cfg["token"], "")
        self.assertEqual(relay.load_config_from_env({"UKU_GITHUB_TOKEN": " abc "})["token"], "abc")

    def test_feedback_is_503_when_the_token_is_missing(self):
        github = FakeGitHubClient(token="")
        service = relay.RelayService(github_client=github, cache_dir=tempfile.mkdtemp(), allowed_origins=("https://localhost",))
        server = relay.create_server(service, bind="127.0.0.1", port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            body = json.dumps({"kind": "text", "title": "t", "message": "m", "includeLog": False}).encode()
            req = urllib.request.Request(f"http://127.0.0.1:{server.server_address[1]}/api/feedback", data=body, headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(req, timeout=5)
            self.assertEqual(caught.exception.code, 503)
            self.assertEqual(github.issues_created, [])
        finally:
            server.shutdown()
            server.server_close()



class FakeResponse:
    def __init__(self, data, content_type="application/json"):
        self._data = data
        self.headers = {"Content-Type": content_type}

    def read(self, limit=-1):
        return self._data if limit < 0 else self._data[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    def __init__(self, routes):
        self.routes = routes
        self.urls = []

    def open(self, req, timeout=None):
        url = req.full_url
        self.urls.append(url)
        result = self.routes[url]
        if isinstance(result, Exception):
            raise result
        return result


NOVEL_URL = "https://www.pixiv.net/ajax/novel/22148644"
COVER_URL = "https://i.pximg.net/c/600x600/novel-cover-master/cover.jpg"


def _novel_json(**body):
    base = {
        "title": " 題名 ",
        "userName": "作者",
        "description": "説明<br />二行目 &amp;",
        "content": "[[rb:漢字 > かんじ]]です[newpage]次",
        "coverUrl": COVER_URL,
    }
    base.update(body)
    return json.dumps({"error": False, "message": "", "body": base}).encode("utf-8")


class PixivClientTest(unittest.TestCase):
    def test_login_only_metadata_is_a_403_not_a_successful_blank_book(self):
        opener = FakeOpener({NOVEL_URL: FakeResponse(_novel_json(
            content="", isLoginOnly=True, characterCount=18089,
            title="ひみつのはなし【ネップリ再録】"))})
        with self.assertRaises(relay.PixivError) as caught:
            relay.PixivClient(opener=opener).fetch_novel("22148644")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIn("需要登录", str(caught.exception))
        self.assertEqual(opener.urls, [NOVEL_URL])

    def test_empty_or_image_only_content_is_rejected_before_fetching_cover(self):
        for content in ("", " \n\t", None, "[uploadedimage:1]"):
            with self.subTest(content=content):
                opener = FakeOpener({NOVEL_URL: FakeResponse(_novel_json(content=content))})
                with self.assertRaises(relay.PixivError) as caught:
                    relay.PixivClient(opener=opener).fetch_novel("22148644")
                self.assertEqual(caught.exception.status_code, 502)
                self.assertIn("正文为空", str(caught.exception))
                self.assertEqual(opener.urls, [NOVEL_URL])

    def test_fetch_novel_matches_the_next_route_shape(self):
        opener = FakeOpener({
            NOVEL_URL: FakeResponse(_novel_json()),
            COVER_URL: FakeResponse(b"\xff\xd8jpeg", "image/jpeg"),
        })
        novel = relay.PixivClient(opener=opener).fetch_novel("22148644")
        self.assertEqual(novel["id"], "22148644")
        self.assertEqual(novel["title"], "題名")
        self.assertEqual(novel["author"], "作者")
        self.assertEqual(novel["description"], "説明\n二行目 &")
        self.assertEqual(novel["content"], "漢字(かんじ)です\n\n次")
        self.assertEqual(novel["rubyOverrides"], {"漢字": "かんじ"})
        self.assertEqual(novel["coverUrl"], "data:image/jpeg;base64,/9hqcGVn")
        self.assertEqual(novel["sourceUrl"], "https://www.pixiv.net/novel/show.php?id=22148644")

    def test_cover_falls_back_to_the_mirror(self):
        opener = FakeOpener({
            NOVEL_URL: FakeResponse(_novel_json()),
            COVER_URL: urllib.error.URLError("down"),
        })
        novel = relay.PixivClient(opener=opener).fetch_novel("22148644")
        self.assertEqual(novel["coverUrl"], "https://i.pixiv.re/c/600x600/novel-cover-master/cover.jpg")

    def test_cover_from_another_host_is_not_fetched(self):
        opener = FakeOpener({NOVEL_URL: FakeResponse(_novel_json(coverUrl="https://evil.example/x.jpg"))})
        novel = relay.PixivClient(opener=opener).fetch_novel("22148644")
        self.assertEqual(novel["coverUrl"], "https://evil.example/x.jpg")
        self.assertEqual(opener.urls, [NOVEL_URL])

    def test_pixiv_error_message_is_kept(self):
        body = json.dumps({"error": True, "message": "該当作品は削除されたか、存在しない作品IDです。", "body": []}).encode()
        opener = FakeOpener({
            NOVEL_URL: urllib.error.HTTPError(NOVEL_URL, 404, "Not Found", {}, __import__("io").BytesIO(body)),
        })
        with self.assertRaises(relay.PixivError) as caught:
            relay.PixivClient(opener=opener).fetch_novel("22148644")
        self.assertEqual(caught.exception.status_code, 404)
        self.assertIn("削除", str(caught.exception))

    def test_network_failure_is_a_502(self):
        opener = FakeOpener({NOVEL_URL: urllib.error.URLError("timeout")})
        with self.assertRaises(relay.PixivError) as caught:
            relay.PixivClient(opener=opener).fetch_novel("22148644")
        self.assertEqual(caught.exception.status_code, 502)


class FakePixivClient:
    def __init__(self):
        self.calls = []
        self.error = None

    def fetch_novel(self, novel_id):
        self.calls.append(novel_id)
        if self.error:
            raise self.error
        return {"id": novel_id, "title": "t", "content": "c"}


class PixivEndpointTest(unittest.TestCase):
    def setUp(self):
        self.pixiv = FakePixivClient()
        self.now = [1000.0]
        self.service = relay.RelayService(
            github_client=FakeGitHubClient(),
            cache_dir=tempfile.mkdtemp(),
            clock=lambda: self.now[0],
            pixiv_client=self.pixiv,
            pixiv_rate_limiter=relay.RateLimiter(
                per_hour=2, per_day=10, global_per_hour=2, global_per_day=10, clock=lambda: self.now[0]
            ),
        )
        self.server = relay.create_server(self.service, bind="127.0.0.1", port=0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def _get(self, query):
        url = f"http://127.0.0.1:{self.server.server_address[1]}/api/pixiv{query}"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_returns_the_novel_and_caches_it(self):
        self.assertEqual(self._get("?id=12345"), (200, {"id": "12345", "title": "t", "content": "c"}))
        self.assertEqual(self._get("?id=12345")[0], 200)
        self.assertEqual(self.pixiv.calls, ["12345"])
        self.now[0] += relay.PIXIV_CACHE_TTL_SECONDS + 1
        self._get("?id=12345")
        self.assertEqual(self.pixiv.calls, ["12345", "12345"])

    def test_rejects_invalid_ids(self):
        for query in ("", "?id=", "?id=123", "?id=abc12345", "?id=1234567890123456"):
            status, body = self._get(query)
            self.assertEqual(status, 400, query)
            self.assertEqual(body, {"error": "无效的 Pixiv 小说链接或 ID"})
        self.assertEqual(self.pixiv.calls, [])

    def test_pixiv_errors_become_error_json(self):
        self.pixiv.error = relay.PixivError("作品は削除されました", 404)
        self.assertEqual(self._get("?id=12345"), (404, {"error": "作品は削除されました"}))
        self.pixiv.error = RuntimeError("boom")
        self.assertEqual(self._get("?id=12346"), (502, {"error": "获取 Pixiv 小说失败"}))

    def test_rate_limited(self):
        self._get("?id=11111")
        self._get("?id=22222")
        status, body = self._get("?id=33333")
        self.assertEqual(status, 429)
        self.assertIn("error", body)
        self.assertEqual(self.pixiv.calls, ["11111", "22222"])


if __name__ == "__main__":
    unittest.main()
