"""Owner-only GUI for the unchanged ASCM worker's one-time setup."""

import hashlib
import json
import os
from pathlib import Path
import queue
import threading
import sys
import tkinter as tk
from tkinter import messagebox, ttk
from types import ModuleType


ENGINE_SHA256 = "bafdcc01e571b15f6f83f37701e654fff0d53d3d1617e31805a7d2060898c118"
INSTALL_DIR = Path.home() / "AppData" / "Local" / "PPC" / "ASCM" / "worker"
ENGINE = INSTALL_DIR / "ascm-sync-worker.py"
HELPER = INSTALL_DIR / "ascm-setup-dialog.py"
SAFE_CODES = {
    # Fixed WorkerError codes reachable from setup's private root, binding,
    # scheduler, task readback, and encrypted-file writes. Never pass raw text.
    "SETUP_COMPLETE", "SETUP_UNAVAILABLE", "SETUP_BINDING_REQUIRED",
    "ACL_NOT_PRIVATE", "WORKER_NOT_CONFIGURED", "CREDENTIAL_INVALID",
    "TASK_OWNER_INVALID", "RUNTIME_PATH_INVALID",
    "TASK_DEFINITION_INVALID", "SCHEDULER_UNAVAILABLE", "SCHEDULER_ACTION_INVALID",
    "ACL_READ_FAILED", "ACL_DESCRIPTOR_FAILED", "ACL_APPLY_FAILED", "ACL_VERIFY_FAILED",
    "DPAPI_INPUT_INVALID", "DPAPI_PROTECT_FAILED", "DPAPI_OUTPUT_INVALID",
    "LOCK_BUSY", "FILE_MISSING", "FILE_SIZE_INVALID", "FILE_READ_FAILED",
    "FILE_CHANGED_OR_OVERSIZE", "PATH_ROOT_INVALID", "PATH_FINAL_FAILED",
    "PATH_ATTRIBUTES_FAILED", "PATH_REPARSE_REJECTED", "PATH_OPEN_FAILED",
    "PATH_DIRECTORY_REQUIRED", "PATH_ROOT_ESCAPE", "PATH_NAME_INVALID",
    "PATH_ESCAPE", "PATH_FILE_REQUIRED", "JSON_SIZE_INVALID", "JSON_DUPLICATE_KEY",
    "JSON_NUMBER_INVALID", "JSON_OBJECT_REQUIRED", "JSON_INVALID",
    "JOURNAL_PAYLOAD_INVALID", "CONTROL_TIME_INVALID", "HANDOFF_NAME_INVALID",
    "SID_INVALID", "OWNER_IDENTITY_FAILED",
    "RUNTIME_UNSUPPORTED", "WINDOWS_REQUIRED",
}


def _emit(outcome):
    """Write only a fixed, safe result for the private launcher."""
    try:
        if sys.stdout is not None:
            print(json.dumps(outcome), flush=True)
    except (OSError, ValueError):
        pass


class SetupUnavailable(Exception):
    """A fixed diagnostic; never carry a credential or OS exception text."""


def valid_pair(first, second):
    return (type(first) is str and type(second) is str and first == second
            and 32 <= len(first) <= 512 and all(33 <= ord(char) <= 126 for char in first))


def load_verified_module(path, digest):
    """Execute exactly the bytes checked by the pinned digest."""
    try:
        raw = Path(path).read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise SetupUnavailable("SETUP_UNAVAILABLE")
        module = ModuleType("ascm_verified_worker")
        module.__file__ = str(path)
        exec(compile(raw, str(path), "exec"), module.__dict__)
        return module
    except (OSError, SyntaxError, ValueError) as error:
        raise SetupUnavailable("SETUP_UNAVAILABLE") from None


def load_worker():
    """Pin the private installed paths, native containment, ACLs and engine."""
    try:
        actual_helper = Path(__file__).absolute()
        if (os.path.normcase(str(actual_helper)) != os.path.normcase(str(HELPER))
                or actual_helper.resolve(strict=True) != HELPER
                or INSTALL_DIR.resolve(strict=True) != INSTALL_DIR):
            raise SetupUnavailable("SETUP_UNAVAILABLE")
        worker = load_verified_module(ENGINE, ENGINE_SHA256)
        sid = worker.current_sid()
        with worker._root_handles(INSTALL_DIR):
            pass
        for path in (INSTALL_DIR, HELPER, ENGINE):
            if not worker.verify_owner_acl(path, sid):
                raise SetupUnavailable("SETUP_UNAVAILABLE")
        with worker.checked_file(INSTALL_DIR, ENGINE.name) as handle:
            raw = worker.read_handle(handle, 131072)
        if hashlib.sha256(raw).hexdigest() != ENGINE_SHA256:
            raise SetupUnavailable("SETUP_UNAVAILABLE")
        worker._private_root(worker.default_root())
        return worker
    except Exception:
        raise SetupUnavailable("SETUP_UNAVAILABLE") from None


class SetupDialog:
    def __init__(self, window, worker, work_root):
        self.window, self.worker, self.work_root = window, worker, work_root
        self.finished = False
        self.busy = False
        self.emitted = False
        self.outcome = {"status": "held", "code": "SETUP_CANCELLED"}
        self.results = queue.Queue(maxsize=1)
        self.first, self.second = tk.StringVar(window), tk.StringVar(window)
        self.status = tk.StringVar(window, value="Enter the same 32–512 character credential twice.")
        self.first_count, self.second_count = tk.StringVar(window), tk.StringVar(window)

        window.title("PPC ASCM worker setup")
        window.minsize(460, 230)
        frame = ttk.Frame(window, padding=20)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="Set up the private ASCM worker", font=("Segoe UI", 13, "bold")).grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 12))
        ttk.Label(frame, text="Worker credential").grid(row=1, column=0, sticky="w")
        self.first_entry = ttk.Entry(frame, textvariable=self.first, show="*", exportselection=False, width=48)
        self.first_entry.grid(row=2, column=0, columnspan=2, sticky="ew")
        ttk.Label(frame, textvariable=self.first_count).grid(row=3, column=0, columnspan=2, sticky="w", pady=(0, 8))
        ttk.Label(frame, text="Confirm worker credential").grid(row=4, column=0, sticky="w")
        self.second_entry = ttk.Entry(frame, textvariable=self.second, show="*", exportselection=False, width=48)
        self.second_entry.grid(row=5, column=0, columnspan=2, sticky="ew")
        ttk.Label(frame, textvariable=self.second_count).grid(row=6, column=0, columnspan=2, sticky="w", pady=(0, 8))
        ttk.Label(frame, textvariable=self.status, wraplength=420).grid(row=7, column=0, columnspan=2, sticky="w")
        self.cancel_button = ttk.Button(frame, text="Cancel", command=self.cancel)
        self.cancel_button.grid(row=8, column=0, sticky="e", pady=(12, 0))
        self.connect = ttk.Button(frame, text="Connect", command=self.submit)
        self.connect.grid(row=8, column=1, sticky="e", pady=(12, 0), padx=(8, 0))
        frame.columnconfigure(0, weight=1)
        window.protocol("WM_DELETE_WINDOW", self.cancel)
        window._root().report_callback_exception = self._callback_error
        window.bind("<Escape>", lambda _event: self.cancel())
        window.bind("<Return>", lambda _event: self.submit())
        self.first.trace_add("write", self._update)
        self.second.trace_add("write", self._update)
        self._update()
        self.first_entry.focus_set()

    def _update(self, *_unused):
        first, second = self.first.get(), self.second.get()
        self.first_count.set(f"{len(first)} characters")
        self.second_count.set(f"{len(second)} characters")
        if not self.busy and valid_pair(first, second):
            self.connect.state(["!disabled"])
        else:
            self.connect.state(["disabled"])

    def cancel(self):
        if self.busy:
            return
        self.first.set("")
        self.second.set("")
        if not self.emitted:
            self.emitted = True
            _emit(self.outcome)
        self.window.quit()

    def _callback_error(self, *_unused):
        if self.emitted:
            try:
                self.window.quit()
            except Exception:
                pass
            return
        self.outcome = {"status": "held", "code": "SETUP_UNAVAILABLE"}
        self.emitted = True
        _emit(self.outcome)
        self.finished = True
        try:
            self.first.set("")
            self.second.set("")
            self.status.set("Setup stopped: SETUP_UNAVAILABLE.")
            self.window.quit()
        except Exception:
            pass

    def submit(self):
        if self.busy or not valid_pair(self.first.get(), self.second.get()):
            return
        secret = self.first.get()
        self.busy = True
        self.first.set("")
        self.second.set("")
        self.first_entry.state(["disabled"])
        self.second_entry.state(["disabled"])
        self.cancel_button.state(["disabled"])
        self._update()
        self.status.set("Setting up the worker…")

        def run_setup():
            nonlocal secret
            try:
                result = self.worker.setup(self.work_root, services={"prompt": lambda: secret})
            except Exception:
                result = {"status": "held", "code": "SETUP_UNAVAILABLE"}
            finally:
                secret = None
            self.results.put(result)

        try:
            threading.Thread(target=run_setup, name="ASCM setup", daemon=False).start()
        except Exception:
            secret = None
            self.outcome = {"status": "held", "code": "SETUP_UNAVAILABLE"}
            self.status.set("Setup stopped: SETUP_UNAVAILABLE.")
            self.busy = False
            self.finished = True
            self.cancel_button.configure(text="Close")
            self.cancel_button.state(["!disabled"])
            if not self.emitted:
                self.emitted = True
                _emit(self.outcome)
            return
        self.window.after(50, self._poll)

    def _poll(self):
        try:
            result = self.results.get_nowait()
        except queue.Empty:
            self.window.after(50, self._poll)
            return
        success = (type(result) is dict and result.get("status") == "configured"
                   and result.get("code") == "SETUP_COMPLETE")
        code = result.get("code") if type(result) is dict else None
        code = code if type(code) is str and code in SAFE_CODES else "SETUP_UNAVAILABLE"
        if not success and code == "SETUP_COMPLETE":
            code = "SETUP_UNAVAILABLE"
        self.outcome = {"status": "configured" if success else "held",
                        "code": "SETUP_COMPLETE" if success else code}
        self.status.set("Setup complete." if success else f"Setup stopped: {code}.")
        self.finished = True
        self.busy = False
        self.cancel_button.configure(text="Close")
        self.cancel_button.state(["!disabled"])
        if not self.emitted:
            self.emitted = True
            _emit(self.outcome)


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args:
        _emit({"status": "held", "code": "COMMAND_UNAVAILABLE"})
        return 2
    try:
        worker = load_worker()
    except SetupUnavailable:
        _emit({"status": "held", "code": "SETUP_UNAVAILABLE"})
        try:
            window = tk.Tk()
            window.withdraw()
            messagebox.showerror("PPC ASCM worker setup", "Setup unavailable. The installed worker could not be verified.")
            window.destroy()
        except Exception:
            pass
        return 2
    dialog = None
    try:
        window = tk.Tk()
        dialog = SetupDialog(window, worker, worker.default_root())
        window.mainloop()
        window.destroy()
        return 0 if dialog.outcome["status"] == "configured" else 2
    except Exception:
        if dialog is None or not dialog.emitted:
            _emit({"status": "held", "code": "SETUP_UNAVAILABLE"})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
