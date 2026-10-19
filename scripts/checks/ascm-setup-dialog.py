"""Synthetic, local checks for the private ASCM setup dialog."""

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
from io import StringIO
from pathlib import Path
import tempfile
import time
import tkinter as tk
import unittest
from unittest.mock import patch


HELPER = Path(__file__).resolve().parents[1] / "ascm-setup-dialog.py"
SENTINEL = "synthetic-ASCII-secret-0123456789-ABCDEF"


def helper():
    if not HELPER.is_file():
        raise AssertionError("setup dialog helper is missing")
    spec = importlib.util.spec_from_file_location("ascm_setup_dialog", HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeWorker:
    def __init__(self, outcome=None):
        self.outcome = outcome or {"status": "configured", "code": "SETUP_COMPLETE"}
        self.calls = []

    def setup(self, root, *, services):
        self.calls.append((root, services["prompt"]()))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class DialogChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tk_root = tk.Tk()
        cls.tk_root.withdraw()

    @classmethod
    def tearDownClass(cls):
        cls.tk_root.destroy()

    def test_printable_ascii_boundaries_and_confirmation(self):
        app = helper()
        for value, valid in (
            ("!" * 31, False), ("!" * 32, True), ("~" * 512, True),
            ("~" * 513, False), ("A" * 31 + " ", False),
            ("A" * 31 + "\x16", False), ("A" * 31 + "é", False),
        ):
            with self.subTest(value_length=len(value), valid=valid):
                self.assertEqual(app.valid_pair(value, value), valid)
        self.assertFalse(app.valid_pair(SENTINEL, SENTINEL + "x"))

    def test_pinned_source_rejects_changed_bytes_before_execution(self):
        app = helper()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "engine.py"
            marker = Path(temp) / "executed"
            payload = f"from pathlib import Path\nPath({str(marker)!r}).write_text('bad')\n"
            path.write_text(payload, encoding="utf-8")
            with self.assertRaises(app.SetupUnavailable):
                app.load_verified_module(path, "0" * 64)
            self.assertFalse(marker.exists())

    def test_verified_bytes_supply_module_file_without_running_main(self):
        app = helper()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "engine.py"
            raw = b"__name_seen__ = __name__\nfile_seen = __file__\n"
            path.write_bytes(raw)
            module = app.load_verified_module(path, hashlib.sha256(raw).hexdigest())
            self.assertEqual(module.file_seen, str(path))
            self.assertNotEqual(module.__name_seen__, "__main__")

    def test_pinned_frozen_worker_loads_from_exact_current_bytes(self):
        app = helper()
        path = HELPER.with_name("ascm-sync-worker.py")
        module = app.load_verified_module(path, app.ENGINE_SHA256)
        self.assertEqual(module.__file__, str(path))
        self.assertTrue(callable(module.setup))

    def test_source_checkout_cannot_enter_installed_setup(self):
        app = helper()
        with self.assertRaises(app.SetupUnavailable):
            app.load_worker()

    def test_command_argument_is_rejected_before_gui_or_worker_load(self):
        app = helper()
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(app.main(["setup"]), 2)
        self.assertEqual(output.getvalue().strip(), '{"status": "held", "code": "COMMAND_UNAVAILABLE"}')

    def test_tk_start_failure_has_only_safe_result(self):
        app = helper()
        output = StringIO()
        with patch.object(app, "load_worker", return_value=FakeWorker()), \
             patch.object(app.tk, "Tk", side_effect=RuntimeError("SENTINEL_WINDOW_ERROR")), \
             redirect_stdout(output), redirect_stderr(output):
            self.assertEqual(app.main([]), 2)
        self.assertEqual(output.getvalue().strip(), '{"status": "held", "code": "SETUP_UNAVAILABLE"}')

    def test_cancel_does_not_invoke_setup(self):
        app = helper()
        window = tk.Toplevel(self.tk_root)
        window.withdraw()
        try:
            worker = FakeWorker()
            dialog = app.SetupDialog(window, worker, Path("synthetic-root"))
            dialog.first.set(SENTINEL)
            dialog.second.set(SENTINEL)
            output = StringIO()
            with redirect_stdout(output):
                dialog.cancel()
            self.assertEqual(worker.calls, [])
            self.assertEqual(dialog.first.get(), "")
            self.assertEqual(dialog.second.get(), "")
            self.assertEqual(dialog.outcome, {"status": "held", "code": "SETUP_CANCELLED"})
            self.assertEqual(output.getvalue().strip(), '{"status": "held", "code": "SETUP_CANCELLED"}')
        finally:
            window.destroy()

    def test_masked_entries_gate_connect_and_clear_before_prompt(self):
        app = helper()
        window = tk.Toplevel(self.tk_root)
        window.withdraw()
        try:
            worker = FakeWorker()
            dialog = app.SetupDialog(window, worker, Path("synthetic-root"))
            self.assertEqual(dialog.first_entry.cget("show"), "*")
            self.assertEqual(dialog.second_entry.cget("show"), "*")
            self.assertIn("disabled", dialog.connect.state())
            dialog.first.set(SENTINEL)
            dialog.second.set(SENTINEL + "x")
            self.assertIn("disabled", dialog.connect.state())
            dialog.second.set(SENTINEL)
            self.assertNotIn("disabled", dialog.connect.state())
            output = StringIO()
            with redirect_stdout(output):
                dialog.submit()
                self.assertEqual(dialog.first.get(), "")
                self.assertEqual(dialog.second.get(), "")
                for _ in range(100):
                    window.update()
                    if dialog.finished:
                        break
                    time.sleep(0.01)
                dialog._callback_error(RuntimeError, RuntimeError("SENTINEL_LATE"), None)
            self.assertTrue(dialog.finished)
            self.assertEqual(dialog.status.get(), "Setup complete.")
            self.assertEqual(dialog.outcome, {"status": "configured", "code": "SETUP_COMPLETE"})
            self.assertEqual(output.getvalue().strip(), '{"status": "configured", "code": "SETUP_COMPLETE"}')
            self.assertEqual(worker.calls, [(Path("synthetic-root"), SENTINEL)])
        finally:
            window.destroy()

    def test_engine_exception_and_malformed_result_never_reveal_text(self):
        app = helper()
        for outcome in (RuntimeError("SENTINEL_EXCEPTION"),
                        {"status": "held", "code": "SENTINEL_EXCEPTION"},
                        {"status": "held", "code": ["SENTINEL_EXCEPTION"]},
                        {"status": "held", "code": "TASK_NOT_VERIFIED"}):
            with self.subTest(outcome=type(outcome).__name__):
                window = tk.Toplevel(self.tk_root)
                window.withdraw()
                output = StringIO()
                try:
                    dialog = app.SetupDialog(window, FakeWorker(outcome), Path("synthetic-root"))
                    dialog.first.set(SENTINEL)
                    dialog.second.set(SENTINEL)
                    with redirect_stdout(output), redirect_stderr(output):
                        dialog.submit()
                        for _ in range(100):
                            window.update()
                            if dialog.finished:
                                break
                            time.sleep(0.01)
                    self.assertTrue(dialog.finished)
                    self.assertNotIn("SENTINEL", dialog.status.get() + output.getvalue())
                    self.assertIn("SETUP_UNAVAILABLE", dialog.status.get())
                    self.assertEqual(dialog.outcome, {"status": "held", "code": "SETUP_UNAVAILABLE"})
                finally:
                    window.destroy()

    def test_reachable_setup_errors_keep_fixed_diagnostic_codes(self):
        app = helper()
        for code in ("TASK_DEFINITION_INVALID", "SCHEDULER_UNAVAILABLE",
                     "SCHEDULER_ACTION_INVALID", "DPAPI_PROTECT_FAILED",
                     "LOCK_BUSY", "JSON_DUPLICATE_KEY"):
            with self.subTest(code=code):
                window = tk.Toplevel(self.tk_root)
                window.withdraw()
                output = StringIO()
                try:
                    worker = FakeWorker({"status": "held", "code": code})
                    dialog = app.SetupDialog(window, worker, Path("synthetic-root"))
                    dialog.first.set(SENTINEL)
                    dialog.second.set(SENTINEL)
                    with redirect_stdout(output):
                        dialog.submit()
                        for _ in range(100):
                            window.update()
                            if dialog.finished:
                                break
                            time.sleep(0.01)
                    self.assertEqual(dialog.outcome, {"status": "held", "code": code})
                    self.assertIn(code, dialog.status.get())
                    self.assertIn('"code": "' + code + '"', output.getvalue())
                finally:
                    window.destroy()

    def test_thread_start_failure_releases_close_without_invoking_setup(self):
        app = helper()
        window = tk.Toplevel(self.tk_root)
        window.withdraw()
        output = StringIO()
        try:
            worker = FakeWorker()
            dialog = app.SetupDialog(window, worker, Path("synthetic-root"))
            dialog.first.set(SENTINEL)
            dialog.second.set(SENTINEL)
            with patch.object(app.threading.Thread, "start", side_effect=RuntimeError("SENTINEL_THREAD")), \
                 redirect_stdout(output), redirect_stderr(output):
                dialog.submit()
            self.assertEqual(worker.calls, [])
            self.assertEqual(dialog.first.get(), "")
            self.assertEqual(dialog.second.get(), "")
            self.assertTrue(dialog.finished)
            self.assertFalse(dialog.busy)
            self.assertNotIn("disabled", dialog.cancel_button.state())
            self.assertEqual(dialog.outcome, {"status": "held", "code": "SETUP_UNAVAILABLE"})
            self.assertEqual(output.getvalue().strip(), '{"status": "held", "code": "SETUP_UNAVAILABLE"}')
        finally:
            window.destroy()

    def test_tk_callback_error_exits_with_safe_result(self):
        app = helper()
        window = tk.Toplevel(self.tk_root)
        window.withdraw()
        output = StringIO()
        try:
            worker = FakeWorker()
            dialog = app.SetupDialog(window, worker, Path("synthetic-root"))
            dialog.first.set(SENTINEL)
            dialog.second.set(SENTINEL)
            with redirect_stdout(output), redirect_stderr(output):
                dialog._callback_error(RuntimeError, RuntimeError("SENTINEL_CALLBACK"), None)
            self.assertTrue(dialog.finished)
            self.assertEqual(dialog.outcome, {"status": "held", "code": "SETUP_UNAVAILABLE"})
            self.assertEqual(dialog.first.get(), "")
            self.assertEqual(dialog.second.get(), "")
            self.assertEqual(worker.calls, [])
            self.assertEqual(output.getvalue().strip(), '{"status": "held", "code": "SETUP_UNAVAILABLE"}')
        finally:
            window.destroy()


if __name__ == "__main__":
    unittest.main()
