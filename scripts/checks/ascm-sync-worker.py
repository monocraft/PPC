"""Offline behavioral checks; all payloads and filesystem objects are synthetic."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[1] / "ascm-sync-worker.py"
spec = importlib.util.spec_from_file_location("ascm_worker", SOURCE)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


@unittest.skipUnless(os.name == "nt", "Windows-native security unsupported on this platform")
class NativeFoundations(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ppc-worker-test-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base / "private"

    def test_dpapi_roundtrip_and_tampering(self):
        # Catches plaintext storage, wrong DPAPI scope/flags, or swallowed native errors.
        raw = b"synthetic secret\x00not a credential"
        encrypted = w.protect(raw)
        self.assertNotEqual(encrypted, raw)
        self.assertGreater(len(encrypted), len(raw))
        self.assertEqual(w.unprotect(encrypted), raw)
        with self.assertRaises(w.WorkerError):
            w.unprotect(encrypted[:-8] + b"tampered")
        with self.assertRaises(w.WorkerError):
            w.unprotect(b"synthetic foreign protected material")

    def test_strict_json_rejects_duplicates_and_nonfinite_and_bounds(self):
        self.assertEqual(w.strict_json(b'{"phase":"pending"}'), {"phase": "pending"})
        for raw in (b'{"a":1,"a":2}', b'{"a":{"x":1,"x":2}}', b'{"n":NaN}', b'{"n":1e999}',
                    b'[]', b'{} trailing', b'\xef\xbb\xbf{}', b' ' * (1048576 + 1)):
            with self.subTest(raw=raw[:40]), self.assertRaises(w.WorkerError):
                w.strict_json(raw)

    def test_new_journal_encrypted_owner_acl_and_roundtrip(self):
        with self.assertRaises(w.JournalMissing):
            w.load_journal(self.root)
        w.save_journal(self.root, {"phase": "pending", "opaque": "synthetic-sensitive-marker"})
        self.assertEqual(w.load_journal(self.root), {"phase": "pending", "opaque": "synthetic-sensitive-marker"})
        for item in [self.root, *self.root.iterdir()]:
            self.assertTrue(w.verify_owner_acl(item, w.current_sid()))
            if item.is_file():
                self.assertNotIn(b"synthetic-sensitive-marker", item.read_bytes())
        outer = w.strict_json(w.unprotect((self.root / "journal.dpapi").read_bytes()))
        self.assertEqual(set(outer), {"version", "ownerSid", "payload"})
        self.assertEqual(outer["version"], 1)
        self.assertEqual(outer["ownerSid"], w.current_sid())

    def test_public_journal_maps_root_creation_failures_to_safe_codes(self):
        # Catches root preparation outside the public safe-error boundary.
        private_path = "synthetic-private-root-must-not-appear"
        payload = "synthetic-payload-must-not-appear"
        for api, code in ((w.load_journal, "JOURNAL_LOAD_FAILED"),
                          (w.save_journal, "JOURNAL_SAVE_FAILED")):
            for error in (PermissionError(13, "synthetic creation failure", private_path),
                          OSError(28, "synthetic disk failure", private_path)):
                with self.subTest(api=api.__name__, error=type(error).__name__):
                    output = StringIO()
                    with mock.patch.object(Path, "mkdir", side_effect=error), redirect_stdout(output), redirect_stderr(output):
                        with self.assertRaises(Exception) as caught:
                            if api is w.save_journal:
                                api(self.root, {"opaque": payload})
                            else:
                                api(self.root)
                    self.assertIsInstance(caught.exception, w.WorkerError)
                    self.assertEqual(caught.exception.code, code)
                    self.assertEqual(str(caught.exception), code)
                    self.assertTrue(caught.exception.__suppress_context__)
                    self.assertIsNone(caught.exception.__cause__)
                    for secret in (private_path, payload, str(self.root)):
                        self.assertNotIn(secret, str(caught.exception))
                        self.assertNotIn(secret, output.getvalue())
                    self.assertEqual(output.getvalue(), "")

    def test_current_and_previous_recovery_and_known_loss(self):
        w.save_journal(self.root, {"sequence": 1})
        w.save_journal(self.root, {"sequence": 2})
        self.assertEqual(w.load_journal(self.root), {"sequence": 2})
        (self.root / "journal.dpapi").write_bytes(b"corrupt synthetic ciphertext")
        with self.assertWarnsRegex(w.JournalRecoveryWarning, "JOURNAL_PREVIOUS_RECOVERED"):
            self.assertEqual(w.load_journal(self.root), {"sequence": 1})
        with self.assertRaises(w.WorkerError):
            w.save_journal(self.root, {"sequence": 3})
        (self.root / "journal.previous.dpapi").unlink()
        with self.assertRaises(w.WorkerError):
            w.load_journal(self.root)
        (self.root / "journal.dpapi").unlink()
        with self.assertRaises(w.WorkerError) as caught:
            w.load_journal(self.root)
        self.assertNotIsInstance(caught.exception, w.JournalMissing)

    def test_atomic_failed_replacement_preserves_current(self):
        w.save_journal(self.root, {"sequence": 1})
        # Real DPAPI/files/flush/previous path; inject only the OS replace interruption.
        original = os.replace
        def interrupt(source, dest):
            if Path(dest).name == "journal.dpapi":
                raise OSError("synthetic interrupted replacement")
            return original(source, dest)
        with mock.patch.object(w.os, "replace", side_effect=interrupt):
            with self.assertRaises(w.WorkerError):
                w.save_journal(self.root, {"sequence": 2})
        self.assertEqual(w.load_journal(self.root), {"sequence": 1})
        self.assertFalse(list(self.root.glob("*.tmp")))

    def test_abrupt_first_save_is_known_missing_and_never_reinitialized(self):
        child = '''import importlib.util,os,sys
from pathlib import Path
s=importlib.util.spec_from_file_location("w",sys.argv[1]);w=importlib.util.module_from_spec(s);s.loader.exec_module(w)
replace=os.replace
def crash(source,dest):
 if Path(dest).name=="journal.dpapi": os._exit(41)
 return replace(source,dest)
w.os.replace=crash
w.save_journal(Path(sys.argv[2]),{"synthetic":"never printed"})
'''
        result = subprocess.run([sys.executable, "-B", "-c", child, str(SOURCE), str(self.root)], capture_output=True)
        self.assertEqual(result.returncode, 41)
        self.assertEqual(result.stdout, b"")
        with self.assertRaises(w.WorkerError) as caught:
            w.load_journal(self.root)
        self.assertNotIsInstance(caught.exception, w.JournalMissing)
        with self.assertRaises(w.WorkerError):
            w.save_journal(self.root, {"replacement": "forbidden"})
        for residue in self.root.glob("*.tmp"):
            self.assertNotIn(b"never printed", residue.read_bytes())

    def test_missing_current_uses_valid_previous_but_both_corrupt_hold(self):
        w.save_journal(self.root, {"sequence": 1})
        w.save_journal(self.root, {"sequence": 2})
        (self.root / "journal.dpapi").unlink()
        with self.assertWarns(w.JournalRecoveryWarning):
            self.assertEqual(w.load_journal(self.root), {"sequence": 1})
        (self.root / "journal.previous.dpapi").write_bytes(b"corrupt synthetic previous")
        with self.assertRaises(w.WorkerError):
            w.load_journal(self.root)

    def test_foreign_sid_and_outer_fields_rejected(self):
        w.save_journal(self.root, {"safe": True})
        for envelope in (
            {"version": 1, "ownerSid": "S-1-12-1-1-2-3-4", "payload": {"safe": True}},
            {"version": 1, "ownerSid": w.current_sid(), "payload": {}, "unexpected": True},
        ):
            (self.root / "journal.dpapi").write_bytes(w.protect(json.dumps(envelope).encode()))
            with self.assertRaises(w.WorkerError):
                w.load_journal(self.root)

    def test_actual_acl_rejects_foreign_grant(self):
        w.save_journal(self.root, {})
        result = subprocess.run(["icacls.exe", str(self.root), "/grant", "*S-1-1-0:(R)"],
                                capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(w.verify_owner_acl(self.root, w.current_sid()))
        with self.assertRaises(w.WorkerError):
            w.load_journal(self.root)

    def test_process_lock_excludes_another_process_and_releases(self):
        w.secure_root(self.root)
        child = '''import importlib.util,sys
from pathlib import Path
s=importlib.util.spec_from_file_location("w",sys.argv[1]);w=importlib.util.module_from_spec(s);s.loader.exec_module(w)
try:
 with w.worker_lock(Path(sys.argv[2])): print("ACQUIRED")
except w.WorkerError as e: print(e.code);sys.exit(23)
'''
        with w.worker_lock(self.root):
            result = subprocess.run([sys.executable, "-B", "-c", child, str(SOURCE), str(self.root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), "LOCK_BUSY")
        result = subprocess.run([sys.executable, "-B", "-c", child, str(SOURCE), str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "ACQUIRED")

    def test_checked_read_native_containment_bounds_and_extended_paths(self):
        handoff = self.base / "handoff"
        handoff.mkdir()
        (handoff / "nested").mkdir()
        (handoff / "nested" / "good.bin").write_bytes(b"synthetic bytes")
        outside = self.base / "outside.bin"
        outside.write_bytes(b"must not escape")
        self.assertEqual(w.read_checked(handoff, "nested/good.bin", 32), b"synthetic bytes")
        extended = Path("\\\\?\\" + str(handoff))
        self.assertEqual(w.read_checked(extended, "nested/good.bin", 32), b"synthetic bytes")
        for name in ("../outside.bin", str(outside), "nested/good.bin:stream", "nested/../outside.bin", "CON", "nested/good.bin."):
            with self.subTest(name=name), self.assertRaises(w.WorkerError):
                w.read_checked(handoff, name, 32)
        with self.assertRaises(w.WorkerError):
            w.read_checked(handoff, "nested/good.bin", 4)
        link = handoff / "escape"
        result = subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(link), str(self.base)], capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.addCleanup(lambda: os.rmdir(link) if link.exists() else None)
        with self.assertRaises(w.WorkerError):
            w.read_checked(handoff, "escape/outside.bin", 32)
        # This also catches an escaped root, even if the requested file is under it.
        with self.assertRaises(w.WorkerError):
            w.read_checked(link, "outside.bin", 32)

    def test_checked_handle_prevents_replacement_during_read(self):
        handoff = self.base / "handoff"
        handoff.mkdir()
        file = handoff / "stable.bin"
        file.write_bytes(b"stable object")
        with w.checked_file(handoff, "stable.bin") as handle:
            with self.assertRaises(OSError):
                os.replace(file, handoff / "renamed.bin")
            self.assertEqual(w.read_handle(handle, 64), b"stable object")

    def test_payload_rejects_nonstring_keys_without_losing_current(self):
        w.save_journal(self.root, {"sequence": 1})
        with self.assertRaises(w.WorkerError):
            w.save_journal(self.root, {7: "would change dictionary on reload"})
        self.assertEqual(w.load_journal(self.root), {"sequence": 1})

    def test_cli_status_is_safe_and_run_is_unavailable(self):
        result = subprocess.run([sys.executable, str(SOURCE), "status"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {"status": "unconfigured", "code": "WORKER_NOT_CONFIGURED"})
        result = subprocess.run([sys.executable, str(SOURCE), "run"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)

    def test_import_does_not_act_or_print(self):
        child = '''import importlib.util,sys
s=importlib.util.spec_from_file_location("w",sys.argv[1]);w=importlib.util.module_from_spec(s);s.loader.exec_module(w)
assert w._native.cache_info().currsize == 0
'''
        result = subprocess.run([sys.executable, "-B", "-c", child, str(SOURCE)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b"")


if __name__ == "__main__":
    unittest.main(verbosity=2)
