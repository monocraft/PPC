"""Offline SharePoint worker contracts and Windows storage. No service work on import.

All WorkerError strings and recovery warnings are fixed diagnostic codes.
"""
import base64
from copy import deepcopy
from contextlib import contextmanager, ExitStack
import ctypes
from ctypes import wintypes as W
from datetime import datetime, timedelta, timezone
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
import time
import http.client
from email.utils import parsedate_to_datetime
import subprocess
import tempfile
import csv
from io import StringIO
import getpass
import xml.etree.ElementTree as ET

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
        (k, "GetSystemDirectoryW", [W.LPWSTR, W.UINT], W.UINT),
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
    return {"version": 1, "source": None, "publication": None, "pending": None, "idleAttempts": [], "maxWallTime": None,
            "engine": {"retryAt": None, "providerSignal": None, "commandSubmission": None, "preSubmissionHistory": [], "deliveryDemand": None}}


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
    # Upgrade only the reviewed pre-engine shape; never reset its accepted work.
    if type(state) is dict and set(state) == set(_new_state()) - {"engine"}:
        state["engine"] = {"retryAt": None, "providerSignal": None, "commandSubmission": None, "preSubmissionHistory": [], "deliveryDemand": None}
    _require(_exact(state, _new_state()) and type(state["version"]) is int and state["version"] == 1
             and type(state["idleAttempts"]) is list and len(state["idleAttempts"]) <= 24, "WORKER_STATE_INVALID")
    _require(_exact(state["engine"], {"retryAt", "providerSignal", "commandSubmission", "preSubmissionHistory", "deliveryDemand"})
             and state["engine"]["providerSignal"] in (None, "available", "reconnect_required"), "WORKER_STATE_INVALID")
    if state["engine"]["retryAt"] is not None: _instant(state["engine"]["retryAt"])
    demand = state["engine"]["deliveryDemand"]
    if demand is not None:
        _require(_exact(demand, {"candidateId", "generation", "observedAt"}) and _match(demand["candidateId"], UUID_PATTERN)
                 and _integer(demand["generation"]) and _instant(demand["observedAt"]) <= now, "WORKER_STATE_INVALID")
    history = state["engine"]["preSubmissionHistory"]
    _require(type(history) is list and len(history) <= 64, "WORKER_STATE_INVALID")
    for entry in history:
        _require(_exact(entry, {"candidate", "command", "expiredAt"}) and type(entry["candidate"]) is dict, "WORKER_STATE_INVALID")
        c = entry["candidate"]; _candidate(c, {k: c.get(k) for k in ("driveId", "folderId")}, now, unexpired=False)
        _require(_instant(entry["expiredAt"]) <= now, "WORKER_STATE_INVALID")
        cmd = entry["command"]
        if cmd is not None:
            _handoff_header(cmd, {"kind": "publication"}, now)
            _require(cmd["candidate"] == c, "WORKER_STATE_INVALID")
            for key in ("ciphertextFile", "stageFile"): _basename(cmd[key], ".pkg")
    submission = state["engine"]["commandSubmission"]
    if submission is not None:
        _require(_exact(submission, {"attemptId", "phase"}) and _match(submission["attemptId"], UUID_PATTERN)
                 and submission["phase"] in ("staging", "submitted") and type(state["publication"]) is dict
                 and type(state["publication"].get("command")) is dict
                 and submission["attemptId"] == state["publication"]["command"].get("attemptId"), "WORKER_STATE_INVALID")
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


def _transition_locked(root, state, event, value, expected, now):
    """Caller holds worker_lock for this entire durable session."""
    now = _now(now)
    _require(type(expected) is dict, "JOURNAL_CONTEXT_INVALID")
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
            state["engine"]["commandSubmission"] = None
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



def transition_journal(root: Path, event: str, value, expected: dict, now: datetime) -> dict:
    """Serialize a standalone local transition; run_pass uses the locked helper."""
    with worker_lock(root):
        try:
            state = load_journal(root)
        except JournalMissing:
            _require(event in ("source", "candidate", "pending", "idle_charge"), "JOURNAL_NOT_INITIALIZED")
            state = _new_state()
        return _transition_locked(root, state, event, value, expected, now)


def prepare_command(root: Path, command: dict, expected: dict, now: datetime) -> dict:
    """Persist exact pre-mutation attempt, then return manifest-last ingredients.

    The engine writes the checked ciphertext first and immutable manifest last.
    No caller receives a manifest when the durable journal save fails.
    """
    state = transition_journal(root, "command", command, expected, now)
    frozen = state["publication"]["command"]
    raw = json.dumps(frozen, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {"manifestFile": frozen["attemptId"] + ".json", "manifestBytes": raw}


PPC_HOST = "abzzcswajjzbordmwuuh.supabase.co"
PPC_MOUNT = "/functions/v1/ppc-ascm-flow"
CONTROL_ROUTE = "/api/ascm/publication/queued"
SOURCE_ROUTE = "/api/ascm/sharepoint/import"
PREPARE_ROUTE = "/api/ascm/publication/prepare"
CONNECTION_ROUTE = "/api/ascm/connection"
HOLD_CODES = {"PHASE_NOT_READY", "CURRENT_MISSING", "STATE_INVALID", "OWNER_INTENT_UNKNOWN", "PUBLISHER_NOT_CONFIGURED", "PREPARE_ATTEMPTS_EXHAUSTED"}


def validate_control(value, destination, now):
    fields = {"version", "action", "requestedRevision", "publishedRevision", "generation", "prepareKey", "retryAt", "intent", "candidate", "binaryPath", "holdCode", "archiveAllowed"}
    _require(_exact(value, fields) and type(value["version"]) is int and value["version"] == 1 and value["archiveAllowed"] is False
             and value["action"] in ("idle", "deliver", "prepare", "recover", "backoff", "held")
             and _integer(value["requestedRevision"]) and _integer(value["publishedRevision"], 0, value["requestedRevision"])
             and _integer(value["generation"], 0)
             and (value["prepareKey"] is None or _match(value["prepareKey"], r"[a-f0-9]{64}"))
             and (value["holdCode"] is None or value["holdCode"] in HOLD_CODES), "CONTROL_INVALID")
    if value["retryAt"] is not None: _instant(value["retryAt"])
    intent = value["intent"]
    if intent is not None:
        _pending({"prepareKey": "a"*64, "intent": intent, "retryAt": None, "producerRunIds": []})
    action = value["action"]
    if action == "idle":
        _require(value["requestedRevision"] == value["publishedRevision"] and all(value[k] is None for k in ("prepareKey", "retryAt", "intent", "candidate", "binaryPath", "holdCode")), "CONTROL_INVALID")
    elif action == "held":
        _require(value["holdCode"] in HOLD_CODES - {"PREPARE_ATTEMPTS_EXHAUSTED"}
                 and all(value[k] is None for k in ("prepareKey", "retryAt", "intent", "candidate", "binaryPath")), "CONTROL_INVALID")
    elif action == "deliver":
        _candidate(value["candidate"], destination, now)
        _require(intent is not None and value["candidate"]["storageRevision"] <= value["requestedRevision"]
                 and value["binaryPath"] == f'/api/ascm/publication/{value["candidate"]["candidateId"]}/bytes'
                 and all(value[k] is None for k in ("prepareKey", "retryAt", "holdCode")), "CONTROL_INVALID")
    else:
        _require(intent is not None and _match(value["prepareKey"], r"[a-f0-9]{64}") and value["candidate"] is None and value["binaryPath"] is None
                 and ((value["retryAt"] is not None and value["holdCode"] in (None, "PREPARE_ATTEMPTS_EXHAUSTED")) if action == "backoff"
                      else (value["retryAt"] is None and value["holdCode"] is None)), "CONTROL_INVALID")
    return deepcopy(value)


def validate_preparation(value):
    _require(_exact(value, {"version", "status", "prepareKey", "retryAt", "holdCode", "archiveAllowed"})
             and type(value["version"]) is int and value["version"] == 1 and value["archiveAllowed"] is False
             and value["status"] in ("dispatch_requested", "dispatch_rejected", "dispatch_uncertain", "busy", "backoff", "not_needed", "held")
             and (value["holdCode"] is None or value["holdCode"] in HOLD_CODES)
             and (value["holdCode"] != "PREPARE_ATTEMPTS_EXHAUSTED" or value["status"] == "backoff"), "PREPARE_INVALID")
    if value["status"] in ("dispatch_requested", "dispatch_rejected", "dispatch_uncertain", "busy", "backoff"):
        _require(_match(value["prepareKey"], r"[a-f0-9]{64}") and value["retryAt"] is not None
                 and value["holdCode"] in (None, "PREPARE_ATTEMPTS_EXHAUSTED"), "PREPARE_INVALID")
        _instant(value["retryAt"])
    else:
        _require(value["prepareKey"] is None and value["retryAt"] is None
                 and (value["holdCode"] is not None if value["status"] == "held" else value["holdCode"] is None), "PREPARE_INVALID")
    return deepcopy(value)


def _route(method, route, headers, body):
    binary = re.fullmatch(r"/api/ascm/publication/("+UUID_PATTERN+r")/(bytes|confirm)", route)
    valid = (method, route) in (("GET", CONTROL_ROUTE), ("POST", SOURCE_ROUTE), ("POST", PREPARE_ROUTE), ("POST", CONNECTION_ROUTE))
    _require(valid or binary is not None and method == ("GET" if binary[2] == "bytes" else "POST"), "HTTP_ROUTE_INVALID")
    allowed = {"X-PPC-ASCM-Flow-Secret"}
    if binary:
        allowed.add("X-PPC-Package-Generation")
        _require(_match(headers.get("X-PPC-Package-Generation"), r"[1-9][0-9]*"), "HTTP_HEADERS_INVALID")
        if binary[2] == "confirm": allowed |= {"X-PPC-SP-"+part for part in ("Drive-Id", "Folder-Id", "Item-Id", "Version-Id", "File-Name")}
    _require(set(headers) <= allowed | {"Content-Type"} and all(_text(v, 512) for v in headers.values()), "HTTP_HEADERS_INVALID")
    _require(body is None if method == "GET" else type(body) is bytes, "HTTP_BODY_INVALID")


def _https(method, route, *, headers, body, timeout, maximum):
    """Fixed TLS origin; http.client never follows redirects or uses proxy settings."""
    _route(method, route, headers, body)
    connection = http.client.HTTPSConnection(PPC_HOST, timeout=timeout)
    started = time.monotonic()
    try:
        connection.request(method, PPC_MOUNT+route, body=body, headers=headers)
        remaining = timeout-(time.monotonic()-started)
        _require(remaining > 0, "HTTP_TIMEOUT")
        if connection.sock is not None: connection.sock.settimeout(remaining)
        response = connection.getresponse()
        chunks, size = [], 0
        while True:
            remaining = timeout-(time.monotonic()-started)
            _require(remaining > 0, "HTTP_TIMEOUT")
            if connection.sock is not None: connection.sock.settimeout(remaining)
            chunk = response.read(min(65536, maximum+1-size))
            if not chunk: break
            chunks.append(chunk); size += len(chunk)
            _require(size <= maximum, "HTTP_RESPONSE_OVERSIZE")
        return {"status": response.status, "headers": {k.lower(): v for k, v in response.getheaders()}, "body": b"".join(chunks)}
    except (OSError, http.client.HTTPException):
        raise WorkerError("HTTP_UNCERTAIN") from None
    finally:
        connection.close()


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _manifest_files(folder):
    with _root_handles(folder):
        files = sorted(path.name for path in Path(folder).iterdir() if path.name.endswith(".json"))
        _require(len(files) <= 256, "HANDOFF_SCAN_LIMIT")
        for name in files: _basename(name, ".json")
        return files


def _write_once(folder, name, raw):
    """Publish a complete immutable object; never overwrite or recreate an uncertain name."""
    _relative(name)
    with _root_handles(folder):
        target = Path(folder)/name
        if os.path.lexists(target):
            _require(read_checked(folder, name, max(MAX_HANDOFF, len(raw))) == raw, "HANDOFF_REPLAY_MISMATCH")
            return
        # A same-directory complete temporary is renamed create-only. Windows
        # os.rename refuses an existing destination; no replace/overwrite used.
        temporary = Path(folder)/(str(uuid.uuid4())+".tmp")
        with temporary.open("xb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try:
            os.rename(temporary, target)
        except FileExistsError:
            _require(read_checked(folder, name, max(MAX_HANDOFF, len(raw))) == raw, "HANDOFF_REPLAY_MISMATCH")
        finally:
            temporary.unlink(missing_ok=True)


class _Pass:
    def __init__(self, root, state, config, credential, services):
        self.root, self.state, self.config, self.credential = root, state, config, credential
        self.clock = services.get("clock", lambda: datetime.now(timezone.utc))
        self.monotonic = services.get("monotonic", time.monotonic)
        self.sleep = services.get("sleep", time.sleep)
        self.transport = services.get("transport", _https)
        self.fault = services.get("fault", lambda phase: None)
        self.started = self.monotonic(); self.calls = 0
        self.handoff = Path(config["handoffRoot"]); self.destination = config["destination"]
        self.was_active = False

    def now(self):
        value = _now(self.clock())
        _require(self.state["maxWallTime"] is None or value >= _instant(self.state["maxWallTime"]), "CLOCK_ROLLBACK")
        return value

    def save(self):
        self.state["maxWallTime"] = _stamp(self.now()); _state_shape(self.state, self.now()); save_journal(self.root, self.state)

    def event(self, event, value, expected=None):
        self.state = _transition_locked(self.root, self.state, event, value, expected or {}, self.now())

    def defer(self, seconds=300):
        self.state["engine"]["retryAt"] = _stamp(self.now()+timedelta(seconds=seconds)); self.save()

    def call(self, method, route, *, value=None, raw=None, headers=None, idle=False, replay=True, maximum=MAX_HANDOFF):
        body = raw if raw is not None else _json_bytes(value) if value is not None else None
        request_headers = {"X-PPC-ASCM-Flow-Secret": self.credential, **(headers or {})}
        if body is not None: request_headers["Content-Type"] = "application/octet-stream" if raw is not None else "application/json"
        _route(method, route, request_headers, body)
        for attempt in range(3):
            remaining = 480-(self.monotonic()-self.started)
            _require(self.calls < 6 and remaining > 0, "PASS_BUDGET_HELD")
            # Record the observed wall maximum before every external attempt;
            # even a lost reply/restart cannot roll the local clock backward.
            self.save(); self.calls += 1
            try:
                response = self.transport(method, route, headers=request_headers, body=body, timeout=min(120, remaining), maximum=maximum)
            except WorkerError as error:
                if error.code in ("HTTP_UNCERTAIN", "HTTP_TIMEOUT") and not idle: self.defer()
                raise
            except (OSError, TimeoutError, http.client.HTTPException):
                if not idle: self.defer()
                raise WorkerError("HTTP_UNCERTAIN") from None
            _require(_exact(response, {"status", "headers", "body"}) and type(response["status"]) is int
                     and type(response["headers"]) is dict and type(response["body"]) is bytes and len(response["body"]) <= maximum, "HTTP_RESPONSE_INVALID")
            _require(self.monotonic()-self.started <= 480, "PASS_BUDGET_HELD")
            status = response["status"]
            if status in (408, 429, 502, 503, 504):
                retry = response["headers"].get("retry-after", "5")
                try:
                    delay = float(retry) if re.fullmatch(r"[0-9]+", retry) else (parsedate_to_datetime(retry)-self.now()).total_seconds()
                except (ValueError, TypeError, OverflowError): delay = 5
                delay = max(1, min(900, delay))
                if not idle and replay and attempt < 2 and self.calls < 6 and delay < 480-(self.monotonic()-self.started):
                    self.sleep(delay); continue
                if not idle: self.defer(delay)
                raise WorkerError("HTTP_BACKOFF")
            return response
        raise WorkerError("HTTP_BACKOFF")

    def json_call(self, method, route, **kwargs):
        response = self.call(method, route, **kwargs)
        value = strict_json(response["body"])
        return response["status"], value

    def finish(self, phase, code, *, report=True):
        signal = self.state["engine"]["providerSignal"]
        if report and self.was_active and signal is not None and self.calls < 6 and self.monotonic()-self.started < 480:
            status, result = self.json_call("POST", CONNECTION_ROUTE, value={"service": "sharepoint", "state": signal}, replay=False)
            _require(status == 200 and _exact(result, {"reported", "archiveAllowed"}) and type(result["reported"]) is bool and result["archiveAllowed"] is False, "CONNECTION_REPLY_INVALID")
            if result["reported"]: self.state["engine"]["providerSignal"] = None; self.save()
        return {"phase": phase, "calls": self.calls, "code": code}

    def discover(self):
        source = self.state["source"]
        if source is not None and source["phase"] != "complete": return
        found = []
        for name in _manifest_files(self.handoff/"intake"):
            manifest, raw = read_handoff(self.handoff/"intake", name, {"kind": "sharepoint_intake"}, self.now())
            if source is not None and _request_id(manifest["source"]) == source["requestId"]:
                _require(source["rawSha256"] == hashlib.sha256(raw).hexdigest(), "SOURCE_REPLAY_MISMATCH")
                # Different cloud observation UUIDs do not create business work.
                continue
            if source is not None:
                baseline = source["handoff"]["source"]
                if manifest["source"]["fileName"] < baseline["fileName"]: continue
                if manifest["source"]["fileName"] == baseline["fileName"]:
                    _require(manifest["source"]["itemUniqueId"] == baseline["itemUniqueId"], "SOURCE_AMBIGUOUS")
                    if int(manifest["source"]["versionLabel"][:-2]) < int(baseline["versionLabel"][:-2]): continue
            if source is not None and all(source["handoff"][k] == manifest[k] for k in ("operationId", "attemptId")):
                _require(source["handoff"] == manifest and source["rawSha256"] == hashlib.sha256(raw).hexdigest(), "SOURCE_REPLAY_MISMATCH")
                continue
            found.append((manifest, raw))
        if found:
            # Cloud and backend own eligibility. Choose its latest handed-off
            # observation without silently resolving distinct same-day items.
            latest = max(entry[0]["source"]["fileName"] for entry in found)
            selected = [entry for entry in found if entry[0]["source"]["fileName"] == latest]
            _require(len({entry[0]["source"]["itemUniqueId"] for entry in selected}) == 1, "SOURCE_AMBIGUOUS")
            manifest, raw = max(selected, key=lambda entry: int(entry[0]["source"]["versionLabel"][:-2]))
            self.event("source", manifest, {"raw": raw}); self.state["engine"]["providerSignal"] = "available"; self.save()
            self.fault("source_frozen")

    def replay_source(self):
        source = self.state["source"]
        if source is None or source["phase"] == "complete": return
        handoff = source["handoff"]
        raw = base64.b64decode(source["rawBase64"], validate=True)
        _raw_identity(raw, source["rawSha256"], handoff["source"]["bytes"])
        requested = _stamp(self.now())
        status, body = self.json_call("POST", SOURCE_ROUTE, value={"schemaVersion": 1, "source": handoff["source"], "before": handoff["before"], "after": handoff["after"], "workbookBase64": source["rawBase64"]})
        _require(status in (200, 202), "SOURCE_HELD")
        self.event("source_reply", {"statusCode": status, "body": body, "requestedAt": requested})
        self.fault("source_reply_saved")

    def command_result(self):
        publication = self.state["publication"]
        if publication is None or publication["phase"] in ("candidate_verified", "confirmed"): return False
        c, cmd = publication["candidate"], publication["command"]
        expected = {"kind": "publication_result", "operationId": cmd["operationId"], "attemptId": cmd["attemptId"], "notBefore": cmd["createdAt"],
                    "candidate": c, "destination": self.destination, "forbiddenFiles": [cmd["ciphertextFile"], cmd["stageFile"]]}
        matches = []
        for name in _manifest_files(self.handoff/"results"):
            value = strict_json(read_checked(self.handoff/"results", name, MAX_HANDOFF))
            if value.get("operationId") != cmd["operationId"] or value.get("attemptId") != cmd["attemptId"]: continue
            result, raw = read_handoff(self.handoff/"results", name, expected, self.now()); matches.append((result, raw))
        if not matches: return False
        verified = [entry for entry in matches if entry[0]["status"] == "verified"]
        if verified:
            _require(all(entry[0] == verified[0][0] for entry in verified), "RESULT_REPLAY_MISMATCH")
            value, raw = verified[0]
        else: value, raw = matches[-1]
        self.event("result", value, {"raw": raw})
        if value["status"] != "verified":
            if value["code"] == "SHAREPOINT_AUTH_REQUIRED":
                self.state["engine"]["providerSignal"] = "reconnect_required"; self.save()
            return False
        self.state["engine"]["providerSignal"] = "available"; self.save(); self.fault("remote_verified")
        # Re-read the actual fresh return on every confirmation attempt; saved
        # proof labels never replace checked bytes, including after a restart.
        raw = read_checked(self.handoff/"results", value["readbackFile"], MAX_PACKAGE)
        _raw_identity(raw, c["sha256"], c["bytes"], package=True)
        headers = {"X-PPC-Package-Generation": str(c["generation"])}
        for field, header in (("driveId", "Drive-Id"), ("folderId", "Folder-Id"), ("itemId", "Item-Id"), ("versionId", "Version-Id"), ("fileName", "File-Name")):
            headers["X-PPC-SP-"+header] = value["item"][field]
        status, body = self.json_call("POST", f'/api/ascm/publication/{c["candidateId"]}/confirm', raw=raw, headers=headers)
        _require(status == 200, "CONFIRMATION_HELD")
        self.event("confirmation", body); self.fault("confirmation_saved")
        return True

    def deliver(self, candidate):
        headers = {"X-PPC-Package-Generation": str(candidate["generation"])}
        response = self.call("GET", f'/api/ascm/publication/{candidate["candidateId"]}/bytes', headers=headers, maximum=MAX_PACKAGE)
        _require(response["status"] == 200, "CANDIDATE_HELD")
        raw = response["body"]; self.event("candidate", candidate, {"destination": self.destination, "raw": raw})
        self.fault("candidate_verified")
        self.publish_command(raw)

    def publish_command(self, raw):
        publication = self.state["publication"]
        c = publication["candidate"]
        if publication["command"] is None:
            cmd = {"schemaVersion": 1, "kind": "publication", "operationId": str(uuid.uuid4()), "attemptId": str(uuid.uuid4()), "createdAt": _stamp(self.now()),
                   "candidate": c, "ciphertextFile": str(uuid.uuid4())+".pkg", "stageFile": str(uuid.uuid4())+".pkg"}
            self.event("command", cmd, {"destination": self.destination, "raw": raw})
        cmd = self.state["publication"]["command"]
        submission = self.state["engine"]["commandSubmission"]
        if submission is None:
            self.state["engine"]["commandSubmission"] = {"attemptId": cmd["attemptId"], "phase": "staging"}; self.save()
        elif submission["phase"] == "submitted":
            return
        self.fault("command_saved")
        _write_once(self.handoff/"commands", cmd["ciphertextFile"], raw)
        self.fault("ciphertext_written")
        self.state["engine"]["commandSubmission"]["phase"] = "submitted"; self.save()
        self.fault("command_submission_intent")
        _write_once(self.handoff/"commands", cmd["attemptId"]+".json", _json_bytes(cmd))
        self.fault("manifest_written")

    def execute(self):
        self.now(); _state_shape(self.state, self.now())
        retry = self.state["engine"]["retryAt"]
        if retry is not None and _instant(retry) > self.now(): return self.finish("waiting", "WORKER_BACKOFF", report=False)
        self.state["engine"]["retryAt"] = None
        self.discover()
        source, publication, pending = (self.state[k] for k in ("source", "publication", "pending"))
        self.was_active = (self.state["engine"]["deliveryDemand"] is not None or source is not None and source["phase"] != "complete" or publication is not None and publication["phase"] != "confirmed" or pending is not None)
        submission = self.state["engine"]["commandSubmission"]
        expired_presubmit = publication is not None and _instant(publication["candidate"]["expiresAt"]) <= self.now() and (
            publication["phase"] == "candidate_verified" and publication["command"] is None
            or publication["phase"] == "command_prepared" and submission is not None and submission["phase"] == "staging"
            and not _exists(self.handoff/"commands", publication["command"]["attemptId"]+".json"))
        if pending is not None and pending["retryAt"] is not None and _instant(pending["retryAt"]) > self.now():
            return self.finish("waiting", "PRODUCER_WAIT")
        if not expired_presubmit and publication is not None and publication["phase"] not in ("candidate_verified", "confirmed"):
            submission = self.state["engine"]["commandSubmission"]
            if submission is not None and submission["phase"] == "staging":
                cmd = publication["command"]
                raw = read_checked(self.handoff/"commands", cmd["ciphertextFile"], MAX_PACKAGE)
                _raw_identity(raw, publication["candidate"]["sha256"], publication["candidate"]["bytes"], package=True)
                self.publish_command(raw)
                return self.finish("waiting", "COMMAND_WAIT", report=False)
            if not self.command_result(): return self.finish("waiting", "COMMAND_WAIT", report=self.state["engine"]["providerSignal"] == "reconnect_required")
            self.replay_source()
        else:
            self.replay_source()
        publication = self.state["publication"]
        if not expired_presubmit and publication is not None and publication["phase"] == "candidate_verified":
            # A crash before the immutable command is recoverable through the
            # exact candidate GET; no cloud mutation was yet submitted.
            self.deliver(publication["candidate"])
            return self.finish("waiting", "COMMAND_WAIT")
        if not self.was_active:
            self.event("idle_charge", None)
        status, body = self.json_call("GET", CONTROL_ROUTE, idle=not self.was_active)
        _require(status == 200, "CONTROL_HELD")
        control = validate_control(body, self.destination, self.now())
        action = control["action"]
        if expired_presubmit and action != "held":
            # Eligibility comes from our positive durable pre-submit phase,
            # never from lease lapse/404/absence alone. Retain provenance and
            # orphan ciphertext; fresh server control decides continuation.
            history = self.state["engine"]["preSubmissionHistory"]
            _require(len(history) < 64, "PRESUBMISSION_HISTORY_FULL")
            history.append({"candidate": deepcopy(publication["candidate"]), "command": deepcopy(publication["command"]), "expiredAt": _stamp(self.now())})
            self.state["publication"] = None; self.state["engine"]["commandSubmission"] = None; self.save()
        if action == "idle":
            self.state["pending"] = None; self.state["engine"]["deliveryDemand"] = None; self.save()
            return self.finish("complete" if self.state["source"] is not None and self.state["source"]["phase"] == "complete" else "idle", "IDLE")
        if action == "held": return self.finish("held", control["holdCode"])
        self.was_active = True
        if action == "deliver":
            self.state["pending"] = None
            self.state["engine"]["deliveryDemand"] = {"candidateId": control["candidate"]["candidateId"], "generation": control["candidate"]["generation"], "observedAt": _stamp(self.now())}
            self.save(); self.deliver(control["candidate"])
            return self.finish("waiting", "COMMAND_WAIT")
        self.state["engine"]["deliveryDemand"] = None
        self.event("pending", {"prepareKey": control["prepareKey"], "intent": control["intent"], "retryAt": control["retryAt"], "producerRunIds": []})
        if action == "backoff": return self.finish("waiting", "PRODUCER_WAIT")
        status, body = self.json_call("POST", PREPARE_ROUTE, value={"prepareKey": control["prepareKey"]}, replay=False)
        if status == 409 and body.get("code") == "PREPARE_STALE":
            self.defer(1); return self.finish("waiting", "PREPARE_STALE", report=False)
        _require(status == 200, "PREPARE_HELD")
        prepared = validate_preparation(body)
        if prepared["prepareKey"] is not None:
            _require(prepared["prepareKey"] == control["prepareKey"], "PREPARE_INVALID")
            self.event("pending", {"prepareKey": prepared["prepareKey"], "intent": control["intent"], "retryAt": prepared["retryAt"], "producerRunIds": []})
        else:
            # not_needed/held is not completion. Next pass re-reads authority.
            self.defer(300)
        return self.finish("waiting", "PRODUCER_WAIT")


def run_pass(root: Path, *, services: dict | None = None) -> dict:
    """One bounded session. Injection is programmatic test-only, never a CLI option."""
    services = services or {}; session = None
    try:
        if "configuration" in services:
            config, credential = services["configuration"], services["credential"]
        else:
            config, credential = _runtime(root)
        with worker_lock(root):
            try: state = load_journal(root)
            except JournalMissing: state = _new_state()
            session = _Pass(root, state, config, credential, services)
            return session.execute()
    except WorkerError as error:
        return {"phase": "held", "calls": session.calls if session else 0, "code": error.code}
    except (OSError, ValueError, TypeError, KeyError, http.client.HTTPException):
        return {"phase": "held", "calls": session.calls if session else 0, "code": "WORKER_UNAVAILABLE"}


TASK_NAME = "PPC ASCM SharePoint Worker"
TASK_NS = "http://schemas.microsoft.com/windows/2004/02/mit/task"
PERSONAL_SITE = "https://hp-my.sharepoint.com/personal/tung_nguyen_hp_com"
DESTINATION_SITE = "https://hp.sharepoint.com/teams/PCGamingCategory"
DESTINATION_FOLDER = "/teams/PCGamingCategory/Shared Documents/Product Portfolio/PPC"


def runtime_paths():
    _require(os.name == "nt" and sys.version_info[:2] == (3, 11), "RUNTIME_UNSUPPORTED")
    alias = Path.home()/"AppData"/"Local"/"Microsoft"/"WindowsApps"/"PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0"
    return {"python": str(alias/"python.exe"), "pythonw": str(alias/"pythonw.exe"), "worker": str(Path(__file__).resolve())}


def default_root():
    _native()
    buffer = ctypes.create_unicode_buffer(32768)
    shell = ctypes.WinDLL("shell32", use_last_error=True)
    if shell.SHGetFolderPathW(None, 0x001C, None, 0, buffer): raise WorkerError("LOCAL_ROOT_UNAVAILABLE")
    return Path(buffer.value)/"PPC"/"ASCM"


def _private_root(root):
    root = Path(root)
    _require(root.is_dir(), "WORKER_NOT_CONFIGURED")
    with _root_handles(root):
        _require(verify_owner_acl(root, current_sid()), "ACL_NOT_PRIVATE")
    return root


def _validate_binding(value, root):
    """Validate a reviewed local attestation, never infer remote access from sync icons."""
    code = "SETUP_BINDING_REQUIRED"
    fields = {"schemaVersion", "ownerSid", "oneDriveBusinessRoot", "handoffRoot", "privateDocumentsListId", "source", "destination", "runtime", "proof"}
    _require(_exact(value, fields) and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
             and value["ownerSid"] == current_sid() and value["source"] == SOURCE_AUTHORITY
             and _match(value["privateDocumentsListId"], UUID_PATTERN), code)
    _require(value["ownerSid"] not in ("S-1-5-18", "S-1-5-19", "S-1-5-20"), "TASK_OWNER_INVALID")
    destination = value["destination"]
    _require(_exact(destination, {"site", "serverRelativeFolder", "driveId", "folderId"})
             and destination["site"] == DESTINATION_SITE and destination["serverRelativeFolder"] == DESTINATION_FOLDER
             and all(_text(destination[k]) and not re.search(r"__|placeholder|synthetic|unverified", destination[k], re.I) for k in ("driveId", "folderId")), code)
    runtime = value["runtime"]
    _require(runtime == runtime_paths(), "RUNTIME_PATH_INVALID")
    # The reviewed worker path is fixed, including spaces, never caller code.
    with checked_file(Path(runtime["worker"]).parent, Path(runtime["worker"]).name): pass
    business, handoff = _canonical(value["oneDriveBusinessRoot"]), _canonical(value["handoffRoot"])
    _require(handoff == _canonical(Path(business)/"PPC ASCM"), code)
    for path in (business, handoff, *(str(Path(handoff)/part) for part in ("intake", "commands", "results"))):
        with _root_handles(path): pass
    proof = value["proof"]
    _require(_exact(proof, {"mapping", "access", "flows"})
             and _exact(proof["mapping"], {"personalSite", "remoteRoot", "syncIncluded"})
             and proof["mapping"] == {"personalSite": PERSONAL_SITE, "remoteRoot": "/Documents/PPC ASCM", "syncIncluded": True}, code)
    access = proof["access"]
    _require(_exact(access, {"ownerSid", "ordinarySharedAccess", "corporateAdministrationPreserved", "observedAt"})
             and access["ownerSid"] == current_sid() and access["ordinarySharedAccess"] is False
             and access["corporateAdministrationPreserved"] is True, code)
    _instant(access["observedAt"])
    _require(_exact(proof["flows"], {"intake", "command"}), code)
    for kind, flow in proof["flows"].items():
        _require(_exact(flow, {"flowId", "definitionFile", "definitionSha256", "bindingVerified", "imported", "persisted"})
                 and _match(flow["flowId"], UUID_PATTERN) and _match(flow["definitionSha256"], r"[a-f0-9]{64}")
                 and all(flow[k] is True for k in ("bindingVerified", "imported", "persisted")), code)
        _basename(flow["definitionFile"], ".json")
        _require(verify_owner_acl(Path(root)/flow["definitionFile"], current_sid()), "ACL_NOT_PRIVATE")
        raw = read_checked(root, flow["definitionFile"], MAX_JSON)
        _require(hashlib.sha256(raw).hexdigest() == flow["definitionSha256"], code)
        exported = strict_json(raw)
        props = exported.get("properties")
        _require(type(props) is dict and type(props.get("definition")) is dict and type(props.get("connectionReferences")) is dict
                 and len(props["connectionReferences"]) == 1, code)
        for reference in props["connectionReferences"].values():
            _require(type(reference) is dict and reference.get("source") == "Embedded"
                     and reference.get("id") == "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"
                     and _text(reference.get("connectionName")), code)
        serialized = _json_bytes(exported).decode("utf-8")
        _require("BindingRequired" not in serialized and "__BIND_" not in serialized and "shared_office365" not in serialized
                 and "__VERIFIED_" not in serialized, code)
        tokens = (SOURCE_AUTHORITY["sitePath"], SOURCE_AUTHORITY["driveId"], SOURCE_AUTHORITY["listId"]) if kind == "intake" else (DESTINATION_SITE, destination["driveId"], destination["folderId"])
        _require(all(token in serialized for token in (*tokens, PERSONAL_SITE, "/Documents/PPC ASCM")), code)
    return deepcopy(value)


def _runtime(root):
    root = _private_root(root)
    config = _decode(root, "worker-config.dpapi")
    _require(_exact(config, {"binding", "taskVerified"}) and config["taskVerified"] is True, "TASK_NOT_VERIFIED")
    binding = _validate_binding(config["binding"], root)
    secret = _decode(root, "worker-secret.dpapi")
    _require(_exact(secret, {"credential"}) and _match(secret["credential"], r"[!-~]{32,512}"), "CREDENTIAL_INVALID")
    return {"handoffRoot": binding["handoffRoot"], "destination": {k: binding["destination"][k] for k in ("driveId", "folderId")}}, secret["credential"]


def task_xml(runtime, sid, now, *, enabled=False):
    _require(_match(sid, r"S-1-(?:[0-9]+-)*[0-9]+") and sid not in ("S-1-5-18", "S-1-5-19", "S-1-5-20"), "TASK_OWNER_INVALID")
    ET.register_namespace("", TASK_NS)
    root = ET.Element("{"+TASK_NS+"}Task", {"version": "1.4"})
    def sub(parent, tag, value=None, **attrs):
        node = ET.SubElement(parent, "{"+TASK_NS+"}"+tag, attrs)
        if value is not None: node.text = value
        return node
    triggers = sub(root, "Triggers")
    logon = sub(triggers, "LogonTrigger"); sub(logon, "Enabled", "true"); sub(logon, "UserId", sid)
    timer = sub(triggers, "TimeTrigger"); repetition = sub(timer, "Repetition")
    sub(repetition, "Interval", "PT5M"); sub(repetition, "StopAtDurationEnd", "false")
    sub(timer, "StartBoundary", _stamp(now)); sub(timer, "Enabled", "true")
    principal = sub(sub(root, "Principals"), "Principal", id="Owner")
    sub(principal, "UserId", sid); sub(principal, "LogonType", "InteractiveToken"); sub(principal, "RunLevel", "LeastPrivilege")
    settings = sub(root, "Settings")
    for key, text in (("MultipleInstancesPolicy", "IgnoreNew"), ("DisallowStartIfOnBatteries", "false"), ("StopIfGoingOnBatteries", "false"),
                      ("StartWhenAvailable", "false"), ("RunOnlyIfNetworkAvailable", "false"), ("Enabled", "true" if enabled else "false"), ("ExecutionTimeLimit", "PT8M")):
        sub(settings, key, text)
    action = sub(sub(root, "Actions", Context="Owner"), "Exec")
    sub(action, "Command", runtime["pythonw"])
    sub(action, "Arguments", '-I -B "'+runtime["worker"]+'" run')
    sub(action, "WorkingDirectory", str(Path(runtime["worker"]).parent))
    return ET.tostring(root, encoding="unicode")


def verify_task(xml, runtime, sid, *, enabled):
    code = "TASK_DEFINITION_INVALID"
    _require(type(xml) is str and len(xml) <= 131072 and "<!" not in xml, code)
    try: tree = ET.fromstring(xml)
    except ET.ParseError: raise WorkerError(code) from None
    def nodes(path): return tree.findall(path.replace("/", "/{*}") if path.startswith("{*}") else "{*}"+path.replace("/", "/{*}"))
    def one(path):
        values = nodes(path); _require(len(values) == 1, code); return values[0]
    def text(path, expected): _require(one(path).text == expected, code)
    _require(tree.tag == "{"+TASK_NS+"}Task", code)
    _require(len(list(one("Actions"))) == 1 and len(list(one("Principals"))) == 1 and len(list(one("Triggers"))) == 2, code)
    _require(one("Actions").get("Context") == "Owner" and one("Principals/Principal").get("id") == "Owner", code)
    for path, fields in (("Principals/Principal", {"UserId", "LogonType", "RunLevel"}),
                         ("Triggers/LogonTrigger", {"Enabled", "UserId"}),
                         ("Triggers/TimeTrigger", {"Repetition", "StartBoundary", "Enabled"}),
                         ("Triggers/TimeTrigger/Repetition", {"Interval", "StopAtDurationEnd"}),
                         ("Actions/Exec", {"Command", "Arguments", "WorkingDirectory"})):
        children = list(one(path))
        _require(len(children) == len(fields) and {child.tag.rsplit("}", 1)[-1] for child in children} == fields, code)
    for path, expected in (("Principals/Principal/UserId", sid), ("Principals/Principal/LogonType", "InteractiveToken"), ("Principals/Principal/RunLevel", "LeastPrivilege"),
                           ("Triggers/LogonTrigger/UserId", sid), ("Triggers/LogonTrigger/Enabled", "true"), ("Triggers/TimeTrigger/Enabled", "true"),
                           ("Triggers/TimeTrigger/Repetition/Interval", "PT5M"), ("Triggers/TimeTrigger/Repetition/StopAtDurationEnd", "false"),
                           ("Settings/MultipleInstancesPolicy", "IgnoreNew"), ("Settings/Enabled", "true" if enabled else "false"),
                           ("Settings/ExecutionTimeLimit", "PT8M"), ("Settings/StartWhenAvailable", "false"),
                           ("Settings/DisallowStartIfOnBatteries", "false"), ("Settings/StopIfGoingOnBatteries", "false"), ("Settings/RunOnlyIfNetworkAvailable", "false"),
                           ("Actions/Exec/Command", runtime["pythonw"]), ("Actions/Exec/Arguments", '-I -B "'+runtime["worker"]+'" run'),
                           ("Actions/Exec/WorkingDirectory", str(Path(runtime["worker"]).parent))): text(path, expected)
    _instant(one("Triggers/TimeTrigger/StartBoundary").text)
    _require(one("Triggers/TimeTrigger/Repetition").find("{*}Duration") is None, code)


def _scheduler(action, xml=None):
    """Setup-only native boundary. No shell, password, elevation or policy change."""
    buffer = ctypes.create_unicode_buffer(32768)
    if not _native()[0].GetSystemDirectoryW(buffer, len(buffer)): raise WorkerError("SCHEDULER_UNAVAILABLE")
    executable = str(Path(buffer.value)/"schtasks.exe")
    def invoke(args):
        result = subprocess.run([executable, *args], shell=False, capture_output=True, timeout=30, creationflags=0x08000000)
        _require(result.returncode == 0 and len(result.stdout) <= 1_048_576, "SCHEDULER_UNAVAILABLE")
        encoding = "utf-16" if result.stdout.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-16-le" if b"\x00" in result.stdout[:64] else "mbcs"
        return result.stdout.decode(encoding, errors="strict")
    if action == "query":
        rows = csv.reader(StringIO(invoke(["/Query", "/FO", "CSV", "/NH"])))
        if not any(row and row[0] == "\\"+TASK_NAME for row in rows): return None
        raw = invoke(["/Query", "/TN", TASK_NAME, "/XML"])
        return raw
    if action in ("enable", "disable"):
        invoke(["/Change", "/TN", TASK_NAME, "/ENABLE" if action == "enable" else "/DISABLE"]); return None
    _require(action == "create_disabled" and type(xml) is str, "SCHEDULER_ACTION_INVALID")
    # This temporary contains task paths/owner only; never credentials.
    with tempfile.TemporaryDirectory(prefix="ppc-ascm-task-") as directory:
        file = Path(directory)/"task.xml"; file.write_text(xml, encoding="utf-16")
        invoke(["/Create", "/TN", TASK_NAME, "/XML", str(file)])


def _masked_credential():
    _require(sys.stdin is not None and sys.stdin.isatty(), "MASKED_INPUT_REQUIRED")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            first = getpass.getpass("New narrow PPC ASCM worker credential: ")
            second = getpass.getpass("Confirm new worker credential: ")
        except (EOFError, getpass.GetPassWarning): raise WorkerError("MASKED_INPUT_REQUIRED") from None
    _require(first == second, "CREDENTIAL_MISMATCH")
    return first


def setup(root: Path, *, services: dict | None = None) -> dict:
    services = services or {}; scheduler = services.get("scheduler", _scheduler); changed = False
    try:
        root = _private_root(root)
        _require(verify_owner_acl(root/"setup-binding.json", current_sid()), "ACL_NOT_PRIVATE")
        binding = _validate_binding(strict_json(read_checked(root, "setup-binding.json", MAX_HANDOFF)), root)
        with worker_lock(root):
            existing = scheduler("query")
            if existing is not None:
                # An existing task may be enabled or deliberately stopped.
                try: verify_task(existing, binding["runtime"], current_sid(), enabled=True)
                except WorkerError: verify_task(existing, binding["runtime"], current_sid(), enabled=False)
            credential = services.get("prompt", _masked_credential)()
            _require(_match(credential, r"[!-~]{32,512}"), "CREDENTIAL_INVALID")
            _replace_cipher(root, "worker-config.dpapi", _encode({"binding": binding, "taskVerified": False}))
            _replace_cipher(root, "worker-secret.dpapi", _encode({"credential": credential}))
            now = services.get("clock", lambda: datetime.now(timezone.utc))()
            if existing is None: scheduler("create_disabled", task_xml(binding["runtime"], current_sid(), now, enabled=False))
            else: scheduler("disable")
            changed = True
            verify_task(scheduler("query"), binding["runtime"], current_sid(), enabled=False)
            scheduler("enable")
            verify_task(scheduler("query"), binding["runtime"], current_sid(), enabled=True)
            _replace_cipher(root, "worker-config.dpapi", _encode({"binding": binding, "taskVerified": True}))
        return {"status": "configured", "code": "SETUP_COMPLETE"}
    except (WorkerError, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
        if changed:
            try: scheduler("disable")
            except (WorkerError, OSError, subprocess.SubprocessError): pass
        return {"status": "held", "code": error.code if isinstance(error, WorkerError) else "SETUP_UNAVAILABLE"}


def status(root: Path) -> dict:
    """Local read only; never creates directories, repairs state or queries services."""
    try:
        if not Path(root).is_dir() or not _exists(Path(root), "worker-config.dpapi"):
            return {"status": "unconfigured", "code": "WORKER_NOT_CONFIGURED"}
        _runtime(root)
        phase = "idle"
        if _exists(Path(root), "journal.dpapi"):
            state = _decode(Path(root), "journal.dpapi"); _state_shape(state, datetime.now(timezone.utc))
            if state["source"] is not None: phase = state["source"]["phase"]
        return {"status": "configured", "phase": phase, "code": "LOCAL_STATUS"}
    except (WorkerError, OSError, ValueError, TypeError, KeyError) as error:
        return {"status": "held", "code": error.code if isinstance(error, WorkerError) else "LOCAL_STATUS_UNAVAILABLE"}


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or args[0] not in ("setup", "run", "status"):
        print(json.dumps({"code": "COMMAND_UNAVAILABLE"}))
        return 2
    try:
        root = default_root()
        value = status(root) if args[0] == "status" else setup(root) if args[0] == "setup" else run_pass(root)
    except WorkerError as error: value = {"status": "held", "code": error.code}
    except (OSError, ValueError, TypeError): value = {"status": "held", "code": "WORKER_UNAVAILABLE"}
    print(json.dumps(value))
    return 0 if value.get("phase") != "held" and value.get("status") != "held" else 2


if __name__ == "__main__":
    raise SystemExit(main())
