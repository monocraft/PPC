"""Offline Windows foundations for the ASCM worker. No service work on import.

Journal callers supply business dictionaries; this module knows no source schema.
All WorkerError strings and recovery warnings are fixed diagnostic codes.
"""
from contextlib import contextmanager, ExitStack
import ctypes
from ctypes import wintypes as W
from functools import lru_cache
import json
import math
import ntpath
import os
from pathlib import Path, PureWindowsPath
import re
import sys
import uuid
import warnings

MAX_JSON = 1_048_576
MAX_CIPHER = MAX_JSON + 65_536


class WorkerError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class JournalMissing(WorkerError):
    """No journal has ever been initialized under this root."""


class JournalRecoveryWarning(UserWarning):
    pass


class Blob(ctypes.Structure):
    _fields_ = [("size", W.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


class AttributeTag(ctypes.Structure):
    _fields_ = [("attributes", W.DWORD), ("tag", W.DWORD)]


@lru_cache(maxsize=1)
def _native():
    if os.name != "nt":
        raise WorkerError("WINDOWS_REQUIRED")
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    a = ctypes.WinDLL("advapi32", use_last_error=True)
    c = ctypes.WinDLL("crypt32", use_last_error=True)
    signatures = [
        (k, "CloseHandle", [W.HANDLE], W.BOOL),
        (k, "LocalFree", [W.HLOCAL], W.HLOCAL),
        (k, "GetCurrentProcess", [], W.HANDLE),
        (k, "CreateFileW", [W.LPCWSTR, W.DWORD, W.DWORD, W.LPVOID, W.DWORD, W.DWORD, W.HANDLE], W.HANDLE),
        (k, "GetFinalPathNameByHandleW", [W.HANDLE, W.LPWSTR, W.DWORD, W.DWORD], W.DWORD),
        (k, "GetFileInformationByHandleEx", [W.HANDLE, ctypes.c_int, W.LPVOID, W.DWORD], W.BOOL),
        (k, "GetFileType", [W.HANDLE], W.DWORD),
        (k, "GetFileSizeEx", [W.HANDLE, ctypes.POINTER(ctypes.c_longlong)], W.BOOL),
        (k, "ReadFile", [W.HANDLE, W.LPVOID, W.DWORD, ctypes.POINTER(W.DWORD), W.LPVOID], W.BOOL),
        (a, "OpenProcessToken", [W.HANDLE, W.DWORD, ctypes.POINTER(W.HANDLE)], W.BOOL),
        (a, "GetTokenInformation", [W.HANDLE, ctypes.c_int, W.LPVOID, W.DWORD, ctypes.POINTER(W.DWORD)], W.BOOL),
        (a, "ConvertSidToStringSidW", [W.LPVOID, ctypes.POINTER(W.LPWSTR)], W.BOOL),
        (a, "ConvertStringSecurityDescriptorToSecurityDescriptorW", [W.LPCWSTR, W.DWORD, ctypes.POINTER(W.LPVOID), ctypes.POINTER(W.DWORD)], W.BOOL),
        (a, "SetFileSecurityW", [W.LPCWSTR, W.DWORD, W.LPVOID], W.BOOL),
        (a, "GetSecurityInfo", [W.HANDLE, ctypes.c_int, W.DWORD, ctypes.POINTER(W.LPVOID), W.LPVOID, ctypes.POINTER(W.LPVOID), W.LPVOID, ctypes.POINTER(W.LPVOID)], W.DWORD),
        (a, "GetSecurityDescriptorControl", [W.LPVOID, ctypes.POINTER(W.WORD), ctypes.POINTER(W.DWORD)], W.BOOL),
        (a, "GetAce", [W.LPVOID, W.DWORD, ctypes.POINTER(W.LPVOID)], W.BOOL),
        (c, "CryptProtectData", [ctypes.POINTER(Blob), W.LPCWSTR, W.LPVOID, W.LPVOID, W.LPVOID, W.DWORD, ctypes.POINTER(Blob)], W.BOOL),
        (c, "CryptUnprotectData", [ctypes.POINTER(Blob), W.LPVOID, W.LPVOID, W.LPVOID, W.LPVOID, W.DWORD, ctypes.POINTER(Blob)], W.BOOL),
    ]
    for dll, name, args, result in signatures:
        fn = getattr(dll, name)
        fn.argtypes, fn.restype = args, result
    return k, a, c


def _dpapi(raw, decrypt):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_CIPHER:
        raise WorkerError("DPAPI_INPUT_INVALID")
    k, _, c = _native()
    buf = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = Blob(len(raw), buf)
    output = Blob()
    try:
        # UI_FORBIDDEN only. LOCAL_MACHINE is deliberately never set.
        fn = c.CryptUnprotectData if decrypt else c.CryptProtectData
        if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
            raise WorkerError("DPAPI_UNPROTECT_FAILED" if decrypt else "DPAPI_PROTECT_FAILED")
        if output.size > MAX_CIPHER:
            raise WorkerError("DPAPI_OUTPUT_INVALID")
        return ctypes.string_at(output.data, output.size)
    finally:
        ctypes.memset(buf, 0, len(raw))
        if output.data:
            ctypes.memset(output.data, 0, output.size)
            k.LocalFree(ctypes.cast(output.data, W.HLOCAL))


def protect(raw):
    return _dpapi(raw, False)


def unprotect(raw):
    return _dpapi(raw, True)


def _sid_text(sid):
    k, a, _ = _native()
    value = W.LPWSTR()
    if not a.ConvertSidToStringSidW(sid, ctypes.byref(value)):
        raise WorkerError("SID_INVALID")
    try:
        return value.value
    finally:
        k.LocalFree(ctypes.cast(value, W.HLOCAL))


def current_sid():
    k, a, _ = _native()
    token = W.HANDLE()
    if not a.OpenProcessToken(k.GetCurrentProcess(), 8, ctypes.byref(token)):
        raise WorkerError("OWNER_IDENTITY_FAILED")
    try:
        length = W.DWORD()
        a.GetTokenInformation(token, 1, None, 0, ctypes.byref(length))
        if not length.value or length.value > 65536:
            raise WorkerError("OWNER_IDENTITY_FAILED")
        buf = ctypes.create_string_buffer(length.value)
        if not a.GetTokenInformation(token, 1, buf, length, ctypes.byref(length)):
            raise WorkerError("OWNER_IDENTITY_FAILED")
        return _sid_text(ctypes.c_void_p.from_buffer(buf).value)
    finally:
        k.CloseHandle(token)


def _canonical(path):
    value = str(path).replace("/", "\\")
    if value.startswith("\\\\?\\UNC\\"):
        value = "\\\\" + value[8:]
    elif value.startswith("\\\\?\\"):
        value = value[4:]
    if value.startswith(("\\\\.\\", "\\??\\")) or not (re.match(r"^[A-Za-z]:\\", value) or value.startswith("\\\\")):
        raise WorkerError("PATH_ROOT_INVALID")
    drive, tail = ntpath.splitdrive(value)
    if not drive or (drive.startswith("\\\\") and len(drive.split("\\")) != 4):
        raise WorkerError("PATH_ROOT_INVALID")
    if ":" in tail:
        raise WorkerError("PATH_ROOT_INVALID")
    return ntpath.normcase(ntpath.normpath(value))


def _final(handle):
    k, _, _ = _native()
    buf = ctypes.create_unicode_buffer(32768)
    size = k.GetFinalPathNameByHandleW(handle, buf, len(buf), 0)
    if not size or size >= len(buf):
        raise WorkerError("PATH_FINAL_FAILED")
    return _canonical(buf.value)


def _tag(handle):
    k, _, _ = _native()
    info = AttributeTag()
    if not k.GetFileInformationByHandleEx(handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise WorkerError("PATH_ATTRIBUTES_FAILED")
    # IO_REPARSE_TAG_CLOUD and CLOUD_1 ... CLOUD_F. All links/junctions fail.
    if info.attributes & 0x400 and (info.tag & 0xFFFF0FFF) != 0x9000001A:
        raise WorkerError("PATH_REPARSE_REJECTED")
    return info.attributes


@contextmanager
def _open(path, *, access=0x80000000, share=3, directory=False, reparse=True, create=False):
    k, _, _ = _native()
    flags = (0x02000000 if directory else 0) | (0x00200000 if reparse else 0)
    handle = k.CreateFileW(str(path), access, share, None, 4 if create else 3, flags, None)
    if handle == W.HANDLE(-1).value:
        code = ctypes.get_last_error()
        raise WorkerError("FILE_MISSING" if code in (2, 3) else "LOCK_BUSY" if code in (32, 33) else "PATH_OPEN_FAILED")
    try:
        yield handle
    finally:
        k.CloseHandle(handle)


@contextmanager
def _root_handles(root):
    canonical = _canonical(root)
    path = PureWindowsPath(canonical)
    with ExitStack() as stack:
        current = Path(path.anchor)
        for part in (None, *path.parts[1:]):
            if part is not None:
                current = current / part
            handle = stack.enter_context(_open(current, access=0x80, directory=True))
            if not _tag(handle) & 0x10:
                raise WorkerError("PATH_DIRECTORY_REQUIRED")
            if _final(handle) != _canonical(current):
                raise WorkerError("PATH_ROOT_ESCAPE")
        yield canonical


def _relative(name):
    if not isinstance(name, str) or not name or len(name) > 4096:
        raise WorkerError("PATH_NAME_INVALID")
    value = name.replace("/", "\\")
    parts = value.split("\\")
    if any(not part or part in (".", "..") or part[-1] in (".", " ") or
           any(ord(ch) < 32 or ch in ':<>"|?*' for ch in part) or
           re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", part, re.I)
           for part in parts):
        raise WorkerError("PATH_NAME_INVALID")
    return parts


@contextmanager
def checked_file(root, relative):
    """Yield the checked native file handle; ancestry stays pinned until exit."""
    parts = _relative(relative)
    with _root_handles(root) as canonical, ExitStack() as stack:
        path = Path(canonical)
        for part in parts[:-1]:
            path = path / part
            parent = stack.enter_context(_open(path, access=0x80, directory=True))
            if not _tag(parent) & 0x10:
                raise WorkerError("PATH_DIRECTORY_REQUIRED")
            if _final(parent) != _canonical(path):
                raise WorkerError("PATH_ESCAPE")
        path = path / parts[-1]
        # Inspect reparse type without following links; pin it against replacement.
        guard = stack.enter_context(_open(path, access=0x80))
        if _tag(guard) & 0x10:
            raise WorkerError("PATH_FILE_REQUIRED")
        handle = stack.enter_context(_open(path, reparse=False))
        _tag(handle)
        final = _final(handle)
        if final != _canonical(path) or ntpath.commonpath([canonical, final]) != canonical:
            raise WorkerError("PATH_ESCAPE")
        if _native()[0].GetFileType(handle) != 1:
            raise WorkerError("PATH_FILE_REQUIRED")
        yield handle


def read_handle(handle, maximum):
    if type(maximum) is not int or maximum < 0 or maximum > 67_108_864:
        raise WorkerError("FILE_LIMIT_INVALID")
    k, _, _ = _native()
    size = ctypes.c_longlong()
    if not k.GetFileSizeEx(handle, ctypes.byref(size)) or size.value < 0 or size.value > maximum:
        raise WorkerError("FILE_SIZE_INVALID")
    remaining, chunks = maximum + 1, []
    while remaining:
        buf = ctypes.create_string_buffer(min(65536, remaining))
        count = W.DWORD()
        if not k.ReadFile(handle, buf, len(buf), ctypes.byref(count), None):
            raise WorkerError("FILE_READ_FAILED")
        if not count.value:
            break
        chunks.append(buf.raw[:count.value])
        remaining -= count.value
    result = b"".join(chunks)
    if len(result) != size.value or len(result) > maximum:
        raise WorkerError("FILE_CHANGED_OR_OVERSIZE")
    return result


def read_checked(root, relative, maximum):
    with checked_file(root, relative) as handle:
        return read_handle(handle, maximum)


def _set_owner_acl(path, sid):
    k, a, _ = _native()
    descriptor = W.LPVOID()
    inheritance = "OICI" if Path(path).is_dir() else ""
    sddl = f"O:{sid}D:P(A;{inheritance};FA;;;{sid})"
    if not a.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None):
        raise WorkerError("ACL_DESCRIPTOR_FAILED")
    try:
        if not a.SetFileSecurityW(str(path), 0x80000005, descriptor):
            raise WorkerError("ACL_APPLY_FAILED")
    finally:
        k.LocalFree(descriptor)
    if not verify_owner_acl(path, sid):
        raise WorkerError("ACL_VERIFY_FAILED")


def verify_owner_acl(path, sid):
    k, a, _ = _native()
    with _open(path, access=0x20080, directory=True) as handle:
        _tag(handle)
        owner, dacl, descriptor = W.LPVOID(), W.LPVOID(), W.LPVOID()
        if a.GetSecurityInfo(handle, 1, 5, ctypes.byref(owner), None, ctypes.byref(dacl), None, ctypes.byref(descriptor)):
            raise WorkerError("ACL_READ_FAILED")
        try:
            control, revision = W.WORD(), W.DWORD()
            if not a.GetSecurityDescriptorControl(descriptor, ctypes.byref(control), ctypes.byref(revision)):
                raise WorkerError("ACL_READ_FAILED")
            if _sid_text(owner) != sid or not dacl or not control.value & 0x1000:
                return False
            count = ctypes.c_ushort.from_address(dacl.value + 4).value
            if count != 1:
                return False
            ace = W.LPVOID()
            if not a.GetAce(dacl, 0, ctypes.byref(ace)):
                raise WorkerError("ACL_READ_FAILED")
            kind = ctypes.c_ubyte.from_address(ace.value).value
            flags = ctypes.c_ubyte.from_address(ace.value + 1).value
            mask = W.DWORD.from_address(ace.value + 4).value
            return kind == 0 and flags in (0, 3) and mask == 0x1F01FF and _sid_text(ace.value + 8) == sid
        finally:
            k.LocalFree(descriptor)


def secure_root(root):
    root = Path(_canonical(root))
    # No recursive creation: the caller must supply an existing parent.
    with _root_handles(root.parent):
        created = False
        try:
            root.mkdir()
            created = True
        except FileExistsError:
            pass
        with _root_handles(root):
            sid = current_sid()
            if created:
                _set_owner_acl(root, sid)
            elif not verify_owner_acl(root, sid):
                raise WorkerError("ACL_NOT_PRIVATE")
    return root


@contextmanager
def _lock(root, name):
    root = secure_root(root)
    with _root_handles(root), _open(root / name, access=0xC0020000, share=0, create=True, reparse=True) as handle:
        _tag(handle)
        if _final(handle) != _canonical(root / name):
            raise WorkerError("PATH_ESCAPE")
        # The new empty lock inherits owner-only permissions; protect it explicitly.
        _set_owner_acl(root / name, current_sid())
        yield


@contextmanager
def worker_lock(root):
    """Kernel share-denial lock; crashes close the handle without stale leases."""
    with _lock(root, "worker.lock"):
        yield


def strict_json(raw):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_JSON:
        raise WorkerError("JSON_SIZE_INVALID")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise WorkerError("JSON_DUPLICATE_KEY")
            result[key] = value
        return result
    def constant(_):
        raise WorkerError("JSON_NUMBER_INVALID")
    def floating(value):
        result = float(value)
        if not math.isfinite(result):
            raise WorkerError("JSON_NUMBER_INVALID")
        return result
    try:
        result = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant, parse_float=floating)
        if not isinstance(result, dict):
            raise WorkerError("JSON_OBJECT_REQUIRED")
        return result
    except (UnicodeError, ValueError, RecursionError):
        raise WorkerError("JSON_INVALID") from None


def _encode(payload):
    if not isinstance(payload, dict):
        raise WorkerError("JOURNAL_PAYLOAD_INVALID")
    pending = [(payload, 0)]
    while pending:
        value, depth = pending.pop()
        if depth > 64:
            raise WorkerError("JOURNAL_PAYLOAD_INVALID")
        if isinstance(value, dict):
            if any(type(key) is not str for key in value):
                raise WorkerError("JOURNAL_PAYLOAD_INVALID")
            pending.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, list):
            pending.extend((item, depth + 1) for item in value)
        elif type(value) not in (str, int, float, bool, type(None)):
            raise WorkerError("JOURNAL_PAYLOAD_INVALID")
    try:
        raw = json.dumps({"version": 1, "ownerSid": current_sid(), "payload": payload},
                         allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise WorkerError("JOURNAL_PAYLOAD_INVALID") from None
    strict_json(raw)
    return protect(raw)


def _decode(root, name):
    if not verify_owner_acl(root / name, current_sid()):
        raise WorkerError("ACL_NOT_PRIVATE")
    envelope = strict_json(unprotect(read_checked(root, name, MAX_CIPHER)))
    if set(envelope) != {"version", "ownerSid", "payload"} or type(envelope["version"]) is not int or envelope["version"] != 1 or not isinstance(envelope["payload"], dict):
        raise WorkerError("JOURNAL_FORMAT_INVALID")
    if envelope["ownerSid"] != current_sid():
        raise WorkerError("JOURNAL_OWNER_MISMATCH")
    return envelope["payload"]


def _exists(root, name):
    # lexists preserves broken symlinks as known state, which must fail closed.
    return os.path.lexists(root / name)


def _load(root, recover):
    marker = _exists(root, "initialized.dpapi")
    current = _exists(root, "journal.dpapi")
    previous = _exists(root, "journal.previous.dpapi")
    if not marker and not current and not previous:
        if list(root.glob("*.tmp")):
            raise WorkerError("JOURNAL_PRIOR_STATE_MISSING")
        raise JournalMissing("JOURNAL_NOT_INITIALIZED")
    if not marker or _decode(root, "initialized.dpapi") != {"initialized": True}:
        raise WorkerError("JOURNAL_INITIALIZATION_INVALID")
    try:
        if not current:
            raise WorkerError("JOURNAL_CURRENT_MISSING")
        return _decode(root, "journal.dpapi")
    except WorkerError:
        if not recover or not previous:
            raise WorkerError("JOURNAL_CURRENT_INVALID") from None
        result = _decode(root, "journal.previous.dpapi")
        warnings.warn("JOURNAL_PREVIOUS_RECOVERED", JournalRecoveryWarning, stacklevel=3)
        return result


def load_journal(root: Path) -> dict:
    root = secure_root(root)
    with _lock(root, "journal.lock"):
        return _load(root, True)


def _replace_cipher(root, name, ciphertext):
    temporary = root / (uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as stream:
            _set_owner_acl(temporary, current_sid())
            stream.write(ciphertext)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, root / name)
        if not verify_owner_acl(root / name, current_sid()):
            raise WorkerError("ACL_NOT_PRIVATE")
    finally:
        temporary.unlink(missing_ok=True)


def save_journal(root: Path, state: dict) -> None:
    ciphertext = _encode(state)
    root = secure_root(root)
    try:
        with _lock(root, "journal.lock"):
            try:
                _load(root, False)
            except JournalMissing:
                _replace_cipher(root, "initialized.dpapi", _encode({"initialized": True}))
            else:
                # Only a validated current may become previous. Corrupt current is held.
                current = read_checked(root, "journal.dpapi", MAX_CIPHER)
                _replace_cipher(root, "journal.previous.dpapi", current)
            _replace_cipher(root, "journal.dpapi", ciphertext)
    except OSError:
        raise WorkerError("JOURNAL_SAVE_FAILED") from None


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args != ["status"]:
        print(json.dumps({"code": "COMMAND_UNAVAILABLE"}))
        return 2
    print(json.dumps({"status": "unconfigured", "code": "WORKER_NOT_CONFIGURED"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
