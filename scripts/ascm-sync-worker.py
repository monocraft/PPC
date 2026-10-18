"""Offline SharePoint worker contracts and Windows storage. No service work on import.

All WorkerError strings and recovery warnings are fixed diagnostic codes.
"""
import base64
from copy import deepcopy
from contextlib import contextmanager, ExitStack
import ctypes
from ctypes import wintypes as W
from datetime import datetime, timedelta
from functools import lru_cache
import hashlib
import json
import math
import ntpath
import os
from pathlib import Path, PureWindowsPath
import re
import sys
import uuid
import warnings

MAX_JSON = 3_145_728
MAX_CIPHER = MAX_JSON + 65_536
MAX_HANDOFF = 65_536
MAX_WORKBOOK = 2_097_152
MAX_PACKAGE = 67_108_864
MAX_SAFE_INT = 9_007_199_254_740_991
UUID_PATTERN = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
SOURCE_AUTHORITY = {
    "provider": "sharepoint", "hostname": "hp.sharepoint.com",
    "sitePath": "/teams/IPSG_SCM_and_Product_Requirements_Info",
    "driveId": "b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9",
    "listId": "2e5224b4-f8be-4265-88a5-90b32a66497d",
}
COMMON_FIELDS = {"schemaVersion", "kind", "operationId", "attemptId", "createdAt"}
SOURCE_FIELDS = set(SOURCE_AUTHORITY) | {"listItemId", "itemUniqueId", "fileName", "relativePath", "versionLabel", "eTag", "createdAt", "lastModifiedAt", "bytes"}
SOURCE_STABLE = {"listItemId", "itemUniqueId", "versionLabel", "eTag", "bytes"}
CANDIDATE_FIELDS = {"candidateId", "generation", "storageRevision", "sha256", "bytes", "expiresAt", "fileName", "provider", "driveId", "folderId"}
ITEM_FIELDS = {"driveId", "folderId", "itemId", "versionId", "fileName"}
REMOTE_STABLE = {"itemId", "eTag", "versionId", "bytes"}


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
    try:
        root = secure_root(root)
        with _lock(root, "journal.lock"):
            return _load(root, True)
    except OSError:
        raise WorkerError("JOURNAL_LOAD_FAILED") from None


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
    try:
        root = secure_root(root)
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


def _require(condition, code="HANDOFF_INVALID"):
    if not condition:
        raise WorkerError(code)


def _exact(value, fields):
    return type(value) is dict and set(value) == set(fields)


def _text(value, maximum=512):
    return type(value) is str and 0 < len(value) <= maximum and value == value.strip() and not re.search(r"[\x00-\x1f\x7f]", value)


def _match(value, pattern):
    return type(value) is str and re.fullmatch(pattern, value) is not None


def _integer(value, minimum=1, maximum=MAX_SAFE_INT - 1):
    return type(value) is int and minimum <= value <= maximum


def _instant(value):
    _require(_match(value, r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z"), "CONTROL_TIME_INVALID")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise WorkerError("CONTROL_TIME_INVALID") from None


def _now(value):
    _require(type(value) is datetime and value.tzinfo is not None and value.utcoffset() == timedelta(0), "CONTROL_TIME_INVALID")
    return value


def _stamp(value):
    return _now(value).isoformat().replace("+00:00", "Z")


def _basename(value, extension):
    _require(_match(value, UUID_PATTERN + re.escape(extension)), "HANDOFF_NAME_INVALID")


def _raw_identity(raw, sha256, size, *, package=False):
    maximum, minimum = (MAX_PACKAGE, 36) if package else (MAX_WORKBOOK, 1)
    _require(type(raw) is bytes and _integer(size, minimum, maximum) and len(raw) == size
             and _match(sha256, r"[a-f0-9]{64}") and hashlib.sha256(raw).hexdigest() == sha256, "HANDOFF_BYTES_MISMATCH")
    if package:
        _require(raw.startswith(b"PPCPKG01"), "PACKAGE_ENVELOPE_INVALID")


def _workbook_bytes(raw, size):
    _require(type(raw) is bytes and _integer(size, 1, MAX_WORKBOOK) and len(raw) == size, "HANDOFF_BYTES_MISMATCH")
    return hashlib.sha256(raw).hexdigest()


def _source(value, before, after):
    _require(_exact(value, SOURCE_FIELDS) and all(value[key] == expected for key, expected in SOURCE_AUTHORITY.items()), "SOURCE_AUTHORITY_INVALID")
    _require(_integer(value["listItemId"]) and _match(value["itemUniqueId"], UUID_PATTERN)
             and _match(value["versionLabel"], r"[1-9][0-9]{0,14}\.0") and _integer(int(value["versionLabel"][:-2]))
             and _text(value["eTag"]) and _integer(value["bytes"], 1, MAX_WORKBOOK), "SOURCE_METADATA_INVALID")
    _require(_exact(before, SOURCE_STABLE) and _exact(after, SOURCE_STABLE)
             and all(type(metadata[key]) is type(value[key]) for metadata in (before, after) for key in SOURCE_STABLE)
             and before == after == {key: value[key] for key in SOURCE_STABLE}, "SOURCE_CHANGED")
    _require(_instant(value["createdAt"]) <= _instant(value["lastModifiedAt"]), "SOURCE_METADATA_INVALID")
    _require(_match(value["fileName"], r"ASCM Report_HyperX_\d{4}-\d{2}-\d{2}\.xlsx"), "SOURCE_FILENAME_INVALID")
    try:
        day = datetime.strptime(value["fileName"][19:29], "%Y-%m-%d").date()
    except ValueError:
        raise WorkerError("SOURCE_FILENAME_INVALID") from None
    _require(day.isoformat() >= "2026-09-30", "SOURCE_FILENAME_INVALID")
    path = value["relativePath"]
    _require(_text(path, 1024) and not path.startswith(("/", "\\")) and "\\" not in path
             and ":" not in path and "%" not in path and "?" not in path and "#" not in path
             and all(part not in ("", ".", "..") and part == part.strip() for part in path.split("/"))
             and path.split("/")[-1] == value["fileName"], "SOURCE_PATH_INVALID")


def _candidate(value, destination, now, *, unexpired=True):
    _require(_exact(destination, {"driveId", "folderId"}) and all(_text(v) for v in destination.values()), "DESTINATION_UNCONFIGURED")
    _require(_exact(value, CANDIDATE_FIELDS) and value["provider"] == "sharepoint"
             and _match(value["candidateId"], UUID_PATTERN) and _integer(value["generation"])
             and _integer(value["storageRevision"]) and _match(value["sha256"], r"[a-f0-9]{64}")
             and _integer(value["bytes"], 36, MAX_PACKAGE)
             and all(value[key] == destination[key] for key in destination), "CANDIDATE_INVALID")
    _require(value["fileName"] == f'master-r{value["storageRevision"]}-g{value["generation"]}-{value["candidateId"]}.pkg', "CANDIDATE_INVALID")
    expiry = _instant(value["expiresAt"])
    _require(not unexpired or expiry > now, "CANDIDATE_EXPIRED")


def _handoff_header(value, expected, now):
    _require(type(expected) is dict and type(value) is dict, "HANDOFF_INVALID")
    kind = expected.get("kind")
    additions = {
        "sharepoint_intake": {"source", "before", "after", "workbookFile", "sha256"},
        "publication": {"candidate", "ciphertextFile", "stageFile"},
        "publication_result": {"status", "candidateId", "generation", "item", "before", "after", "readbackFile", "code"},
    }
    _require(type(kind) is str and kind in additions and _exact(value, COMMON_FIELDS | additions[kind])
             and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and value["kind"] == kind
             and _match(value["operationId"], UUID_PATTERN) and _match(value["attemptId"], UUID_PATTERN))
    for key in ("operationId", "attemptId"):
        if key in expected:
            _require(value[key] == expected[key], "HANDOFF_FOREIGN_ATTEMPT")
    created = _instant(value["createdAt"])
    _require(created <= now and ("notBefore" not in expected or created >= _instant(expected["notBefore"])), "HANDOFF_STALE")
    return kind, created


def _result_metadata(value, c, expected):
    _require(all(key in expected for key in ("operationId", "attemptId", "notBefore", "forbiddenFiles")), "HANDOFF_CONTEXT_REQUIRED")
    _require(value["candidateId"] == c["candidateId"] and type(value["generation"]) is int and value["generation"] == c["generation"]
             and value["status"] in ("verified", "held", "unknown")
             and _match(value["code"], r"[A-Z][A-Z0-9_]{0,63}"), "RESULT_INVALID")
    item, before, after = value["item"], value["before"], value["after"]
    if item is not None:
        _require(_exact(item, ITEM_FIELDS) and all(_text(v) for v in item.values())
                 and all(item[key] == c[key] for key in ("driveId", "folderId", "fileName")), "RESULT_IDENTITY_MISMATCH")
    for metadata in (before, after):
        if metadata is not None:
            _require(_exact(metadata, REMOTE_STABLE) and all(_text(metadata[key]) for key in ("itemId", "eTag", "versionId"))
                     and _integer(metadata["bytes"], 36, MAX_PACKAGE), "RESULT_METADATA_INVALID")
    if value["readbackFile"] is not None:
        _basename(value["readbackFile"], ".pkg")
        _require(type(expected["forbiddenFiles"]) in (tuple, list)
                 and value["readbackFile"] not in expected["forbiddenFiles"], "RESULT_NOT_FRESH")
    if value["status"] == "verified":
        _require(item is not None and before is not None and before == after and value["readbackFile"] is not None
                 and before["itemId"] == item["itemId"] and before["versionId"] == item["versionId"]
                 and before["bytes"] == c["bytes"], "RESULT_PROOF_INCOMPLETE")


def validate_handoff(value: dict, expected: dict, now: datetime) -> dict:
    """Validate a closed manifest against trusted context and actual checked bytes.

    expected.kind is mandatory. For publication/result, expected.candidate and
    expected.destination come from durable trusted configuration/control, never
    from the manifest. Results additionally bind operationId, attemptId,
    notBefore (original command time), and forbiddenFiles (upload/stage names).
    raw is mandatory for intake/command/verified result and is never serialized.
    Intake IDs may be unclaimed on discovery; supplied IDs always bind exactly.
    """
    now = _now(now)
    kind, created = _handoff_header(value, expected, now)
    if kind == "sharepoint_intake":
        _source(value["source"], value["before"], value["after"])
        _require(_instant(value["source"]["lastModifiedAt"]) <= created, "SOURCE_METADATA_INVALID")
        _basename(value["workbookFile"], ".xlsx")
        # Standard cloud actions do not attest SHA256. Hash these actual checked
        # bytes locally; never replace the immutable cloud manifest's null hint.
        _require(value["sha256"] is None, "INTAKE_HASH_HINT_INVALID")
        _workbook_bytes(expected.get("raw"), value["source"]["bytes"])
        if "source" in expected:
            _require(value["source"] == expected["source"], "SOURCE_IDENTITY_MISMATCH")
    else:
        c = expected.get("candidate")
        _candidate(c, expected.get("destination"), now, unexpired=kind == "publication")
        if kind == "publication":
            _candidate(value["candidate"], expected["destination"], now)
            _require(value["candidate"] == c, "CANDIDATE_MISMATCH")
            for key in ("ciphertextFile", "stageFile"):
                _basename(value[key], ".pkg")
            _require(value["ciphertextFile"] != value["stageFile"], "HANDOFF_NAME_INVALID")
            _raw_identity(expected.get("raw"), c["sha256"], c["bytes"], package=True)
        else:
            _result_metadata(value, c, expected)
            if value["status"] == "verified":
                _raw_identity(expected.get("raw"), c["sha256"], c["bytes"], package=True)
    try:
        raw = json.dumps(value, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise WorkerError("HANDOFF_INVALID") from None
    _require(len(raw) <= MAX_HANDOFF, "HANDOFF_SIZE_INVALID")
    return deepcopy(value)


def read_handoff(root: Path, manifest_file: str, expected: dict, now: datetime):
    """Read manifest and actual object under checked handles; incomplete sync holds."""
    _basename(manifest_file, ".json")
    value = strict_json(read_checked(root, manifest_file, MAX_HANDOFF))
    _require(type(expected) is dict, "HANDOFF_INVALID")
    kind = expected.get("kind")
    reference = {"sharepoint_intake": "workbookFile", "publication": "ciphertextFile", "publication_result": "readbackFile"}.get(kind)
    _require(reference is not None and reference in value, "HANDOFF_INVALID")
    raw = None
    if value[reference] is not None:
        _basename(value[reference], ".xlsx" if kind == "sharepoint_intake" else ".pkg")
        raw = read_checked(root, value[reference], MAX_WORKBOOK if kind == "sharepoint_intake" else MAX_PACKAGE)
    return validate_handoff(value, {**expected, "raw": raw}, now), raw


def _new_state():
    return {"version": 1, "source": None, "publication": None, "pending": None, "idleAttempts": [], "maxWallTime": None}


def _request_id(source):
    fields = ("hostname", "sitePath", "driveId", "listId", "listItemId", "itemUniqueId", "versionLabel")
    identity = ["ppc-ascm-sharepoint-v1", *(source[key] for key in fields)]
    return "ascm-sp-" + hashlib.sha256(json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def _source_reply(value, frozen, now):
    fields = {"sourceProvider", "requestId", "acceptedRequestId", "source", "storageRevision", "alreadySaved", "outcome", "status", "archiveAllowed", "summary"}
    _require(_exact(value, {"statusCode", "body", "requestedAt"}), "SOURCE_REPLY_INVALID")
    body = value["body"]
    _require(_exact(body, fields) and body["sourceProvider"] == "sharepoint" and body["requestId"] == frozen["requestId"]
             and _match(body["acceptedRequestId"], r"ascm-sp-[a-f0-9]{64}") and _integer(body["storageRevision"])
             and type(body["alreadySaved"]) is bool and body["outcome"] in ("accepted", "equivalent")
             and body["archiveAllowed"] is False and _exact(body["summary"], {"savedFields", "savedProducts"})
             and all(_integer(count, 0) for count in body["summary"].values()), "SOURCE_REPLY_INVALID")
    source = frozen["handoff"]["source"]
    bound = {key: source[key] for key in ("driveId", "listId", "listItemId", "itemUniqueId", "versionLabel")}
    bound["rawSha256"] = frozen["rawSha256"]
    _require(body["source"] == bound and _exact(body["source"], bound)
             and all(type(body["source"][key]) is type(bound[key]) for key in bound), "SOURCE_REPLY_MISMATCH")
    _require(type(value["statusCode"]) is int and (value["statusCode"], body["status"]) in ((202, "publication_pending"), (200, "published")), "SOURCE_REPLY_INVALID")
    requested = _instant(value["requestedAt"])
    _require(_instant(frozen["frozenAt"]) <= requested <= now
             and (frozen["replyAt"] is None or requested >= _instant(frozen["replyAt"])), "SOURCE_REPLY_STALE")
    if body["outcome"] == "accepted":
        _require(body["acceptedRequestId"] == body["requestId"], "SOURCE_REPLY_MISMATCH")
    else:
        _require(body["acceptedRequestId"] != body["requestId"] and body["summary"] == {"savedFields": 0, "savedProducts": 0}, "SOURCE_REPLY_MISMATCH")
    original = frozen["receipt"]
    if original is not None:
        _require(all(original[key] == body[key] for key in ("requestId", "acceptedRequestId", "source", "storageRevision", "outcome", "summary")), "SOURCE_REPLY_MISMATCH")
    return deepcopy(body)


def _pending(value):
    _require(_exact(value, {"prepareKey", "intent", "retryAt", "producerRunIds"}) and _match(value["prepareKey"], r"[a-f0-9]{64}")
             and _exact(value["intent"], {"kind", "ownerImagesCommit"}), "PENDING_INVALID")
    intent = value["intent"]
    _require(intent["kind"] == "ordinary" and intent["ownerImagesCommit"] is None
             or intent["kind"] == "owner_images" and _match(intent["ownerImagesCommit"], r"[a-f0-9]{40}"), "PENDING_INVALID")
    if value["retryAt"] is not None:
        _instant(value["retryAt"])
    _require(type(value["producerRunIds"]) is list and len(value["producerRunIds"]) <= 16
             and all(_integer(v) for v in value["producerRunIds"]) and len(set(value["producerRunIds"])) == len(value["producerRunIds"]), "PENDING_INVALID")


def _confirmation(value, candidate, now):
    _require(_exact(value, {"status", "publication", "archiveAllowed"}) and value["status"] in ("published", "already_published")
             and value["archiveAllowed"] is False, "CONFIRMATION_INVALID")
    item = value["publication"]
    fields = {"provider", "kind", "candidateId", "generation", "storageRevision", "sha256", "bytes", "publishedAt"}
    _require(_exact(item, fields) and item["provider"] == "sharepoint" and item["kind"] == "publication"
             and all(type(item[key]) is type(candidate[key]) and item[key] == candidate[key] for key in ("candidateId", "generation", "storageRevision", "sha256", "bytes"))
             and _instant(item["publishedAt"]) <= now, "CONFIRMATION_MISMATCH")


def _state_shape(state, now):
    """Reject malformed protected business state before indexing nested records."""
    _require(_exact(state, _new_state()) and type(state["version"]) is int and state["version"] == 1
             and type(state["idleAttempts"]) is list and len(state["idleAttempts"]) <= 24, "WORKER_STATE_INVALID")
    for stamp in state["idleAttempts"]:
        _instant(stamp)
    if state["pending"] is not None:
        _pending(state["pending"])
    source = state["source"]
    if source is not None:
        _require(_exact(source, {"handoff", "rawBase64", "rawSha256", "requestId", "frozenAt", "receipt", "replyAt", "phase"})
                 and source["phase"] in ("frozen", "pending", "complete") and _match(source["rawSha256"], r"[a-f0-9]{64}")
                 and _match(source["requestId"], r"ascm-sp-[a-f0-9]{64}"), "WORKER_STATE_INVALID")
        if source["phase"] == "complete":
            _require(source["rawBase64"] is None, "WORKER_STATE_INVALID")
            handoff = source["handoff"]
            _handoff_header(handoff, {"kind": "sharepoint_intake"}, now)
            _require(handoff["sha256"] is None, "WORKER_STATE_INVALID")
            _source(handoff["source"], handoff["before"], handoff["after"])
            _basename(handoff["workbookFile"], ".xlsx")
        else:
            _require(type(source["rawBase64"]) is str and len(source["rawBase64"]) <= 2_796_204, "WORKER_STATE_INVALID")
            try:
                raw = base64.b64decode(source["rawBase64"], validate=True)
            except (ValueError, UnicodeError):
                raise WorkerError("WORKER_STATE_INVALID") from None
            handoff = validate_handoff(source["handoff"], {"kind": "sharepoint_intake", "raw": raw}, now)
            _require(hashlib.sha256(raw).hexdigest() == source["rawSha256"], "WORKER_STATE_INVALID")
        _require(source["requestId"] == _request_id(handoff["source"]) and _instant(source["frozenAt"]) <= now
                 and ((source["receipt"] is None and source["replyAt"] is None) if source["phase"] == "frozen"
                      else (source["receipt"] is not None and source["replyAt"] is not None)), "WORKER_STATE_INVALID")
        if source["receipt"] is not None:
            status = 200 if source["phase"] == "complete" else 202
            _source_reply({"body": source["receipt"], "statusCode": status, "requestedAt": source["replyAt"]}, source, now)
    publication = state["publication"]
    if publication is not None:
        _require(_exact(publication, {"candidate", "verifiedAt", "command", "phase", "remoteProof", "confirmation"})
                 and publication["phase"] in ("candidate_verified", "command_prepared", "write_unknown", "command_held", "remote_verified", "confirmed"), "WORKER_STATE_INVALID")
        c = publication["candidate"]
        _require(type(c) is dict and "driveId" in c and "folderId" in c, "WORKER_STATE_INVALID")
        _candidate(c, {key: c[key] for key in ("driveId", "folderId")}, now, unexpired=False)
        _require(_instant(publication["verifiedAt"]) <= now, "WORKER_STATE_INVALID")
        cmd = publication["command"]
        _require((publication["phase"] == "candidate_verified") == (cmd is None), "WORKER_STATE_INVALID")
        if cmd is not None:
            _handoff_header(cmd, {"kind": "publication"}, now)
            _require(cmd["candidate"] == c, "WORKER_STATE_INVALID")
            for key in ("ciphertextFile", "stageFile"):
                _basename(cmd[key], ".pkg")
            _require(cmd["ciphertextFile"] != cmd["stageFile"], "WORKER_STATE_INVALID")
        proof = publication["remoteProof"]
        _require((publication["phase"] in ("remote_verified", "confirmed")) == (proof is not None), "WORKER_STATE_INVALID")
        if proof is not None:
            _require(_exact(proof, {"result", "sha256", "bytes", "verifiedAt"})
                     and proof["sha256"] == c["sha256"] and type(proof["bytes"]) is int and proof["bytes"] == c["bytes"]
                     and type(proof["result"]) is dict and proof["result"].get("status") == "verified"
                     and _instant(proof["verifiedAt"]) <= now, "WORKER_STATE_INVALID")
            context = {"kind": "publication_result", "operationId": cmd["operationId"], "attemptId": cmd["attemptId"],
                       "notBefore": cmd["createdAt"], "forbiddenFiles": [cmd["ciphertextFile"], cmd["stageFile"]]}
            _handoff_header(proof["result"], context, now)
            _result_metadata(proof["result"], c, context)
        _require((publication["phase"] == "confirmed") == (publication["confirmation"] is not None), "WORKER_STATE_INVALID")
        if publication["confirmation"] is not None:
            _confirmation(publication["confirmation"], c, now)


def transition_journal(root: Path, event: str, value, expected: dict, now: datetime) -> dict:
    """Serialize one local transition and save before returning any next-step data.

    This helper owns worker_lock; callers must not nest another worker_lock.
    It performs no network/file publication. The later engine must reload and
    reverify checked byte objects before transport or raw confirmation.
    """
    now = _now(now)
    _require(type(expected) is dict, "JOURNAL_CONTEXT_INVALID")
    with worker_lock(root):
        try:
            state = load_journal(root)
        except JournalMissing:
            _require(event in ("source", "candidate", "pending", "idle_charge"), "JOURNAL_NOT_INITIALIZED")
            state = _new_state()
        _state_shape(state, now)
        _require(state["maxWallTime"] is None or now >= _instant(state["maxWallTime"]), "CLOCK_ROLLBACK")
        source, publication = state["source"], state["publication"]
        if event == "source":
            handoff = validate_handoff(value, {**expected, "kind": "sharepoint_intake"}, now)
            raw_sha = _workbook_bytes(expected["raw"], handoff["source"]["bytes"])
            same_attempt = source is not None and all(source["handoff"][key] == handoff[key] for key in ("operationId", "attemptId"))
            if same_attempt:
                _require(source["handoff"] == handoff and source["rawSha256"] == raw_sha, "SOURCE_REPLAY_MISMATCH")
            elif source is None or source["phase"] == "complete":
                state["source"] = {"handoff": handoff, "rawBase64": base64.b64encode(expected["raw"]).decode("ascii"),
                                   "rawSha256": raw_sha, "requestId": _request_id(handoff["source"]), "frozenAt": _stamp(now),
                                   "receipt": None, "replyAt": None, "phase": "frozen"}
            else:
                raise WorkerError("SOURCE_ALREADY_ACTIVE")
        elif event == "source_reply":
            _require(source is not None, "SOURCE_NOT_ACTIVE")
            reply = _source_reply(value, source, now)
            _require(source["phase"] != "complete" or value["statusCode"] == 200, "SOURCE_ALREADY_COMPLETE")
            source.update({"receipt": reply, "replyAt": _stamp(now), "phase": "complete" if value["statusCode"] == 200 else "pending"})
            if value["statusCode"] == 200:
                source["rawBase64"] = None
        elif event == "candidate":
            _candidate(value, expected.get("destination"), now)
            _raw_identity(expected.get("raw"), value["sha256"], value["bytes"], package=True)
            if publication is not None and publication["phase"] != "confirmed":
                _require(publication["candidate"] == value, "PUBLICATION_ALREADY_ACTIVE")
            else:
                state["publication"] = {"candidate": deepcopy(value), "verifiedAt": _stamp(now), "command": None,
                                        "phase": "candidate_verified", "remoteProof": None, "confirmation": None}
        elif event == "command":
            _require(publication is not None, "PUBLICATION_NOT_ACTIVE")
            prior = publication["command"]
            if prior is not None:
                _require(value == prior, "COMMAND_REPLAY_MISMATCH")
            context = {**expected, "kind": "publication", "candidate": publication["candidate"]}
            handoff = validate_handoff(value, context, now)
            _require(publication["phase"] in ("candidate_verified", "command_prepared"), "COMMAND_ALREADY_MUTATING")
            publication.update({"command": handoff, "phase": "command_prepared"})
        elif event == "result":
            _require(publication is not None and publication["command"] is not None
                     and publication["phase"] in ("command_prepared", "write_unknown", "command_held", "remote_verified"), "COMMAND_NOT_ACTIVE")
            cmd, c = publication["command"], publication["candidate"]
            context = {**expected, "kind": "publication_result", "operationId": cmd["operationId"], "attemptId": cmd["attemptId"],
                       "notBefore": cmd["createdAt"], "candidate": c, "destination": {key: c[key] for key in ("driveId", "folderId")},
                       "forbiddenFiles": [cmd["ciphertextFile"], cmd["stageFile"]]}
            checked = validate_handoff(value, context, now)
            if checked["status"] == "verified":
                proof = {"result": checked, "sha256": c["sha256"], "bytes": c["bytes"], "verifiedAt": _stamp(now)}
                if publication["remoteProof"] is not None:
                    _require(publication["remoteProof"]["result"] == checked, "RESULT_REPLAY_MISMATCH")
                publication.update({"remoteProof": proof, "phase": "remote_verified"})
            elif publication["remoteProof"] is None:
                publication["phase"] = "write_unknown" if checked["status"] == "unknown" else "command_held"
        elif event == "confirmation":
            _require(publication is not None and publication["phase"] in ("remote_verified", "confirmed"), "REMOTE_PROOF_REQUIRED")
            _confirmation(value, publication["candidate"], now)
            publication.update({"confirmation": deepcopy(value), "phase": "confirmed"})
        elif event == "pending":
            _pending(value)
            state["pending"] = deepcopy(value)
        elif event == "idle_charge":
            _require(value is None and state["pending"] is None and (source is None or source["phase"] == "complete")
                     and (publication is None or publication["phase"] == "confirmed"), "DURABLE_WORK_ACTIVE")
            attempts = [_instant(stamp) for stamp in state["idleAttempts"]]
            _require(all(stamp <= now for stamp in attempts), "CLOCK_ROLLBACK")
            attempts = [stamp for stamp in attempts if now - stamp < timedelta(hours=24)]
            _require(len(attempts) < 24 and (not attempts or now - max(attempts) >= timedelta(hours=1)), "IDLE_BUDGET_HELD")
            state["idleAttempts"] = [_stamp(stamp) for stamp in attempts] + [_stamp(now)]
        else:
            raise WorkerError("JOURNAL_EVENT_INVALID")
        state["maxWallTime"] = _stamp(now)
        save_journal(root, state)
        return deepcopy(state)


def prepare_command(root: Path, command: dict, expected: dict, now: datetime) -> dict:
    """Persist exact pre-mutation attempt, then return manifest-last ingredients.

    The engine writes the checked ciphertext first and immutable manifest last.
    No caller receives a manifest when the durable journal save fails.
    """
    state = transition_journal(root, "command", command, expected, now)
    frozen = state["publication"]["command"]
    raw = json.dumps(frozen, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {"manifestFile": frozen["attemptId"] + ".json", "manifestBytes": raw}


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args != ["status"]:
        print(json.dumps({"code": "COMMAND_UNAVAILABLE"}))
        return 2
    print(json.dumps({"status": "unconfigured", "code": "WORKER_NOT_CONFIGURED"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
