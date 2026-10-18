"""Offline behavioral checks; all payloads and filesystem objects are synthetic."""
import importlib.util
import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
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

NOW = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)
OP = "11111111-1111-4111-8111-111111111111"
ATTEMPT = "22222222-2222-4222-8222-222222222222"
WORKBOOK = "33333333-3333-4333-8333-333333333333.xlsx"
CIPHER = "44444444-4444-4444-8444-444444444444.pkg"
STAGE = "55555555-5555-4555-8555-555555555555.pkg"
RETURN = "66666666-6666-4666-8666-666666666666.pkg"
CANDIDATE = "77777777-7777-4777-8777-777777777777"
DESTINATION = {"driveId": "synthetic-pinned-drive", "folderId": "synthetic-pinned-folder"}
BOOK = b"synthetic-workbook-cells-SENTINEL"
PACKAGE = b"PPCPKG01" + b"synthetic ciphertext payload!" * 2


def intake():
    source = {"provider": "sharepoint", "hostname": "hp.sharepoint.com",
              "sitePath": "/teams/IPSG_SCM_and_Product_Requirements_Info",
              "driveId": "b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9",
              "listId": "2e5224b4-f8be-4265-88a5-90b32a66497d", "listItemId": 908,
              "itemUniqueId": "e5cb1d81-7071-40b6-93cb-86ef0b577f52",
              "fileName": "ASCM Report_HyperX_2026-09-30.xlsx",
              "relativePath": "(09) September 2026/ASCM Report_HyperX_2026-09-30.xlsx",
              "versionLabel": "2.0", "eTag": '"synthetic-file-etag,2"',
              "createdAt": "2026-09-30T09:00:46Z", "lastModifiedAt": "2026-10-07T07:44:51Z", "bytes": len(BOOK)}
    stable = {k: source[k] for k in ("listItemId", "itemUniqueId", "versionLabel", "eTag", "bytes")}
    return {"schemaVersion": 1, "kind": "sharepoint_intake", "operationId": OP, "attemptId": ATTEMPT,
            "createdAt": "2026-10-18T11:59:00Z", "source": source, "before": stable,
            "after": deepcopy(stable), "workbookFile": WORKBOOK, "sha256": None}


def candidate():
    return {"candidateId": CANDIDATE, "generation": 3, "storageRevision": 84,
            "sha256": hashlib.sha256(PACKAGE).hexdigest(), "bytes": len(PACKAGE),
            "expiresAt": "2026-10-18T13:00:00Z", "fileName": f"master-r84-g3-{CANDIDATE}.pkg",
            "provider": "sharepoint", **DESTINATION}


def command():
    return {"schemaVersion": 1, "kind": "publication", "operationId": OP, "attemptId": ATTEMPT,
            "createdAt": "2026-10-18T12:00:00Z", "candidate": candidate(), "ciphertextFile": CIPHER, "stageFile": STAGE}


def result(status="verified"):
    item = {**DESTINATION, "itemId": "synthetic-remote-item", "versionId": "1.0", "fileName": candidate()["fileName"]}
    before = {"itemId": item["itemId"], "eTag": '"actual-remote-etag,1"', "versionId": "1.0", "bytes": len(PACKAGE)}
    return {"schemaVersion": 1, "kind": "publication_result", "operationId": OP, "attemptId": ATTEMPT,
            "createdAt": "2026-10-18T12:01:00Z", "status": status, "candidateId": CANDIDATE, "generation": 3,
            "item": item if status == "verified" else None, "before": before if status == "verified" else None,
            "after": deepcopy(before) if status == "verified" else None,
            "readbackFile": RETURN if status == "verified" else None, "code": "REMOTE_VERIFIED" if status == "verified" else "REMOTE_UNCERTAIN"}


def expected(kind, raw=None):
    value = {"kind": kind, "operationId": OP, "attemptId": ATTEMPT, "destination": DESTINATION,
             "candidate": candidate(), "notBefore": "2026-10-18T11:59:00Z", "forbiddenFiles": [CIPHER, STAGE]}
    if raw is not None:
        value["raw"] = raw
    return value


def receipt(status="publication_pending", outcome="accepted"):
    # Hand-derived request identity tuple; server remains the receipt authority.
    source = intake()["source"]
    identity = ["ppc-ascm-sharepoint-v1", source["hostname"], source["sitePath"], source["driveId"],
                source["listId"], 908, source["itemUniqueId"], "2.0"]
    request_id = "ascm-sp-" + hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
    return {"sourceProvider": "sharepoint", "requestId": request_id, "acceptedRequestId": request_id,
            "source": {k: source[k] for k in ("driveId", "listId", "listItemId", "itemUniqueId", "versionLabel")} | {"rawSha256": hashlib.sha256(BOOK).hexdigest()},
            "storageRevision": 84, "alreadySaved": False, "outcome": outcome, "status": status,
            "archiveAllowed": False, "summary": {"savedFields": 0, "savedProducts": 0}}


class HandoffContracts(unittest.TestCase):
    def test_all_three_exact_handoffs_bind_actual_bytes(self):
        # Removing actual hash/length verification would accept altered local objects.
        for value, raw in ((intake(), BOOK), (command(), PACKAGE), (result(), PACKAGE)):
            with self.subTest(kind=value["kind"]):
                parsed = w.validate_handoff(value, expected(value["kind"], raw), NOW + timedelta(minutes=2))
                self.assertEqual(parsed, value)
                parsed["kind"] = "changed by caller"
                self.assertNotEqual(parsed, value)

    def test_closed_schema_rejects_partial_case_variant_unknown_and_duplicate_json(self):
        # Permissive schema or JSON parsing could hide conflicting identity fields.
        base = intake()
        cases = [dict(base, SchemaVersion=1), dict(base, unexpected="SENTINEL"), dict(base, schemaVersion=True)]
        missing = deepcopy(base); del missing["after"]; cases.append(missing)
        nested = deepcopy(base); nested["source"]["ItemUniqueId"] = nested["source"]["itemUniqueId"]; cases.append(nested)
        for value in cases:
            with self.subTest(value=value), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)
        for raw in (b'{"kind":"sharepoint_intake","kind":"publication"}', b'{"source":{"bytes":1,"bytes":2}}', b'{"kind":'):
            with self.assertRaises(w.WorkerError):
                w.strict_json(raw)

    def test_actual_source_authority_and_published_identity_are_required(self):
        # Relaxing any source authority/version/typed field must hold before import.
        mutations = {"hostname": "other.sharepoint.com", "sitePath": "/teams/elsewhere", "driveId": "other-drive",
                     "listId": OP, "listItemId": "908", "itemUniqueId": "NOT-UUID", "provider": "outlook",
                     "versionLabel": "2.1", "fileName": "ASCM Report_HyperX_2026-02-30.xlsx",
                     "relativePath": "https://sentinel.invalid/workbook.xlsx", "eTag": "", "bytes": True,
                     "createdAt": "2026-09-30T09:00:46", "lastModifiedAt": "2026-10-07T07:44:51+00:00"}
        for field, wrong in mutations.items():
            value = intake(); value["source"][field] = wrong
            with self.subTest(field=field), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)
        for label in ("0.0", "02.0", "2", "2.00", "-1.0", "1e1.0"):
            value = intake()
            for part in ("source", "before", "after"): value[part]["versionLabel"] = label
            with self.subTest(label=label), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)
        value = intake()
        for part in ("source", "before", "after"): value[part]["versionLabel"] = "10.0"
        self.assertEqual(w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)["source"]["versionLabel"], "10.0")

    def test_source_rejects_backend_rejected_provenance_and_integer_limits(self):
        # The local envelope must not claim eligible provenance that the fixed backend rejects.
        for path in ("folder%2fescape/" + intake()["source"]["fileName"], "f"*1024+"/"+intake()["source"]["fileName"]):
            value = intake(); value["source"]["relativePath"] = path
            with self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)
        value = intake()
        for part in ("source", "before", "after"): value[part]["listItemId"] = 9_007_199_254_740_991
        with self.assertRaises(w.WorkerError):
            w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)

    def test_stability_size_raw_hash_and_uuid_basename_fail_closed(self):
        # Missing stable before/after checks can publish bytes from a changing version.
        for part, field, wrong in (("before", "eTag", "old"), ("after", "bytes", len(BOOK)+1), ("after", "itemUniqueId", OP)):
            value = intake(); value[part][field] = wrong
            with self.subTest(part=part, field=field), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)
        for name in ("../"+WORKBOOK, "C:/private/"+WORKBOOK, WORKBOOK.upper(), "report.xlsx", WORKBOOK+":stream"):
            value = intake(); value["workbookFile"] = name
            with self.subTest(name=name), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)
        for raw in (None, BOOK+b"changed"):
            with self.subTest(raw=raw), self.assertRaises(w.WorkerError):
                w.validate_handoff(intake(), expected("sharepoint_intake", raw), NOW)

    def test_cloud_intake_hash_is_literal_null_and_not_an_attestation(self):
        # Trusting a supplied cloud hash revives an unverified Standard action assumption.
        for digest in (hashlib.sha256(BOOK).hexdigest(), "null", "", False):
            value = intake(); value["sha256"] = digest
            with self.subTest(digest=digest), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)
        self.assertIsNone(w.validate_handoff(intake(), expected("sharepoint_intake", BOOK), NOW)["sha256"])

    def test_foreign_stale_invalid_control_times_are_rejected(self):
        # Accepting a result from another attempt can confirm an uncertain old write.
        for field, wrong in (("operationId", CANDIDATE), ("attemptId", CANDIDATE), ("attemptId", "ABCDEFAB-1234-4567-8123-123456789012"),
                             ("createdAt", "2026-10-18T11:58:59Z"), ("createdAt", "2026-10-18T12:03:00Z"),
                             ("createdAt", "2026-02-30T12:00:00Z"), ("createdAt", "2026-10-18T12:00:00+00:00")):
            value = result(); value[field] = wrong
            with self.subTest(field=field, wrong=wrong), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("publication_result", PACKAGE), NOW+timedelta(minutes=2))

    def test_command_destination_expiry_and_package_envelope_are_not_overridable(self):
        # Allowing private handoff values to override pinned destination creates write authority.
        for field, wrong in (("driveId", "foreign"), ("folderId", "foreign"), ("fileName", "master_ppc.pkg"),
                             ("expiresAt", "2026-10-18T11:00:00Z"), ("generation", True), ("bytes", 35)):
            value = command(); value["candidate"][field] = wrong
            with self.subTest(field=field), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("publication", PACKAGE), NOW)
        for field in ("stageFile", "ciphertextFile"):
            value = command(); value[field] = "../" + CIPHER
            with self.assertRaises(w.WorkerError): w.validate_handoff(value, expected("publication", PACKAGE), NOW)
        value = command(); value["stageFile"] = CIPHER
        with self.assertRaises(w.WorkerError): w.validate_handoff(value, expected("publication", PACKAGE), NOW)
        with self.assertRaises(w.WorkerError): w.validate_handoff(command(), expected("publication", b"x"*len(PACKAGE)), NOW)

    def test_verified_result_requires_exact_stable_fresh_remote_proof(self):
        # A matching local copy or changed remote identity is not returned remote proof.
        for part, field, wrong in (("item", "driveId", "foreign"), ("item", "fileName", "wrong.pkg"),
                                  ("before", "itemId", "other"), ("after", "eTag", "changed"), ("after", "versionId", "2.0")):
            value = result(); value[part][field] = wrong
            with self.subTest(part=part, field=field), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("publication_result", PACKAGE), NOW+timedelta(minutes=2))
        for name in (CIPHER, STAGE, None):
            value = result(); value["readbackFile"] = name
            with self.subTest(name=name), self.assertRaises(w.WorkerError):
                w.validate_handoff(value, expected("publication_result", PACKAGE), NOW+timedelta(minutes=2))

    def test_held_unknown_typed_nulls_never_fabricate_verified_proof(self):
        # Treating absent results as successful would release an unknown write.
        for status in ("held", "unknown"):
            value = result(status)
            self.assertEqual(w.validate_handoff(value, expected("publication_result"), NOW+timedelta(minutes=2)), value)
            for field in ("item", "before", "after", "readbackFile"):
                wrong = deepcopy(value); wrong[field] = "null"
                with self.subTest(status=status, field=field), self.assertRaises(w.WorkerError):
                    w.validate_handoff(wrong, expected("publication_result"), NOW+timedelta(minutes=2))

    def test_source_stability_does_not_coerce_boolean_integer_fields(self):
        # Python equality alone treats True as1, violating the exact JSON types.
        value = intake()
        for part in ("source", "before", "after"): value[part]["listItemId"] = 1
        value["before"]["listItemId"] = True
        with self.assertRaises(w.WorkerError):
            w.validate_handoff(value, expected("sharepoint_intake", BOOK), NOW)


@unittest.skipUnless(os.name == "nt", "Windows-native journal and checked-file integration requires Windows")
class DurableSharePointPhases(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ppc-worker-phases-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name); self.root = self.base / "private"; self.handoff = self.base / "intake"
        self.handoff.mkdir()

    def transition(self, event, value, moment=NOW, context=None):
        return w.transition_journal(self.root, event, value, context or {}, moment)

    def frozen(self):
        return self.transition("source", intake(), context=expected("sharepoint_intake", BOOK))

    def accepted(self):
        self.frozen()
        return self.transition("source_reply", {"statusCode": 202, "body": receipt(), "requestedAt": "2026-10-18T12:00:00Z"})

    def prepared(self):
        self.accepted()
        self.transition("candidate", candidate(), context={"destination": DESTINATION, "raw": PACKAGE})
        return w.prepare_command(self.root, command(), expected("publication", PACKAGE), NOW)

    def test_checked_manifest_partial_sync_and_private_bound(self):
        # A manifest arriving before bytes, a partial JSON, or a large private file must hold.
        manifest = self.handoff / (ATTEMPT+".json")
        manifest.write_bytes(json.dumps(intake()).encode())
        with self.assertRaises(w.WorkerError): w.read_handoff(self.handoff, manifest.name, expected("sharepoint_intake"), NOW)
        (self.handoff / WORKBOOK).write_bytes(BOOK)
        value, raw = w.read_handoff(self.handoff, manifest.name, expected("sharepoint_intake"), NOW)
        self.assertEqual(raw, BOOK); self.assertEqual(value, intake())
        for raw_json in (b'{"schemaVersion":', b'{"kind":"x","kind":"y"}', b" "*65537):
            manifest.write_bytes(raw_json)
            with self.assertRaises(w.WorkerError): w.read_handoff(self.handoff, manifest.name, expected("sharepoint_intake"), NOW)

    def test_frozen_actual_source_survives_restart_immutable_and_encrypted(self):
        # Replacing a pending source would lose the original accepted identity on a lost reply.
        state = self.frozen(); loaded = w.load_journal(self.root)
        self.assertEqual(state, loaded)
        self.assertEqual(base64.b64decode(loaded["source"]["rawBase64"]), BOOK)
        self.assertEqual(loaded["source"]["handoff"], intake())
        self.assertEqual(loaded["source"]["rawSha256"], hashlib.sha256(BOOK).hexdigest())
        self.assertIsNone(loaded["source"]["handoff"]["sha256"])
        # An identical cloud manifest with changed local bytes cannot replace its frozen digest.
        with self.assertRaises(w.WorkerError):
            self.transition("source", intake(), context=expected("sharepoint_intake", b"x"*len(BOOK)))
        wrong = intake(); wrong["source"]["versionLabel"] = "3.0"
        for part in ("before", "after"): wrong[part]["versionLabel"] = "3.0"
        with self.assertRaises(w.WorkerError): self.transition("source", wrong, context=expected("sharepoint_intake", BOOK))
        self.assertEqual(w.load_journal(self.root), loaded)
        self.assertNotIn(BOOK, (self.root/"journal.dpapi").read_bytes())

    def test_command_is_durable_before_manifest_return_and_same_attempt_content_holds(self):
        # Returning a manifest before saving the immutable attempt allows a crash duplicate write.
        prepared = self.prepared(); state = w.load_journal(self.root)
        self.assertEqual(state["publication"]["phase"], "command_prepared")
        self.assertEqual(state["publication"]["command"], command())
        self.assertEqual(w.strict_json(prepared["manifestBytes"]), command())
        self.assertEqual(prepared["manifestFile"], ATTEMPT+".json")
        wrong = command(); wrong["stageFile"] = RETURN
        with self.assertRaises(w.WorkerError) as caught:
            w.prepare_command(self.root, wrong, expected("publication", PACKAGE), NOW)
        self.assertEqual(caught.exception.code, "COMMAND_REPLAY_MISMATCH")
        self.assertEqual(w.load_journal(self.root), state)
        with mock.patch.object(w, "save_journal", side_effect=w.WorkerError("JOURNAL_SAVE_FAILED")):
            with self.assertRaises(w.WorkerError): w.prepare_command(self.root, command(), expected("publication", PACKAGE), NOW)

    def test_unknown_write_retains_identity_across_expiry_missing_result_and_new_attempt(self):
        # Expiry/absence must never erase a possible external mutation or authorize a second attempt.
        self.prepared()
        state = self.transition("result", result("unknown"), NOW+timedelta(minutes=2))
        self.assertEqual(state["publication"]["phase"], "write_unknown")
        self.assertEqual(state["publication"]["command"], command())
        wrong = command(); wrong["attemptId"] = CANDIDATE; wrong["createdAt"] = "2026-10-18T14:00:00Z"
        with self.assertRaises(w.WorkerError): w.prepare_command(self.root, wrong, expected("publication", PACKAGE), NOW+timedelta(hours=2))
        self.assertEqual(w.load_journal(self.root), state)
        # A delayed exact return can positively reconcile the original attempt after expiry.
        late = result(); late["createdAt"] = "2026-10-18T14:00:00Z"
        state = self.transition("result", late, NOW+timedelta(hours=2), {"raw": PACKAGE})
        self.assertEqual(state["publication"]["phase"], "remote_verified")
        self.assertEqual(state["publication"]["remoteProof"]["sha256"], hashlib.sha256(PACKAGE).hexdigest())

    def test_confirmation_is_not_source_completion_and_fresh_exact_receipt_is_required(self):
        # Advancing on package confirmation alone can complete a different source/revision.
        self.prepared()
        self.transition("result", result(), NOW+timedelta(minutes=2), {"raw": PACKAGE})
        publication = {"provider": "sharepoint", "kind": "publication", "candidateId": CANDIDATE, "generation": 3,
                       "storageRevision": 84, "sha256": hashlib.sha256(PACKAGE).hexdigest(), "bytes": len(PACKAGE), "publishedAt": "2026-10-18T12:02:00Z"}
        state = self.transition("confirmation", {"status": "published", "publication": publication, "archiveAllowed": False}, NOW+timedelta(minutes=3))
        self.assertEqual(state["source"]["phase"], "pending")
        self.assertEqual(state["publication"]["phase"], "confirmed")
        wrong = receipt("published"); wrong["storageRevision"] = 85
        with self.assertRaises(w.WorkerError): self.transition("source_reply", {"statusCode": 200, "body": wrong, "requestedAt": "2026-10-18T12:03:00Z"}, NOW+timedelta(minutes=4))
        wrong = receipt("published"); wrong["source"]["rawSha256"] = "a"*64
        with self.assertRaises(w.WorkerError): self.transition("source_reply", {"statusCode": 200, "body": wrong, "requestedAt": "2026-10-18T12:03:00Z"}, NOW+timedelta(minutes=4))
        with self.assertRaises(w.WorkerError): self.transition("source_reply", {"statusCode": 202, "body": receipt("published"), "requestedAt": "2026-10-18T12:03:00Z"}, NOW+timedelta(minutes=4))
        with self.assertRaises(w.WorkerError): self.transition("source_reply", {"statusCode": 200, "body": receipt("published"), "requestedAt": "2026-10-18T11:59:00Z"}, NOW+timedelta(minutes=4))
        state = self.transition("source_reply", {"statusCode": 200, "body": receipt("published"), "requestedAt": "2026-10-18T12:03:00Z"}, NOW+timedelta(minutes=4))
        self.assertEqual(state["source"]["phase"], "complete")
        self.assertEqual(state["source"]["receipt"]["storageRevision"], 84)
        self.assertIsNone(state["source"]["rawBase64"])
        self.assertEqual(state["source"]["rawSha256"], hashlib.sha256(BOOK).hexdigest())

    def test_large_frozen_workbook_fits_reviewed_raw_bound_without_plaintext(self):
        # Retaining the old one-MiB journal limit would lose a valid two-MiB source.
        raw = b"z"*2_097_152; value = intake()
        for part in ("source", "before", "after"): value[part]["bytes"] = len(raw)
        state = self.transition("source", value, context=expected("sharepoint_intake", raw))
        self.assertEqual(len(base64.b64decode(w.load_journal(self.root)["source"]["rawBase64"])), len(raw))
        self.assertEqual(state["source"]["phase"], "frozen")

    def test_idle_attempts_and_pending_producer_fields_are_durable_without_network(self):
        # Missing durable charges permits restart bursts; local pending IDs are suppression hints only.
        state = self.transition("idle_charge", None)
        self.assertEqual(state["idleAttempts"], ["2026-10-18T12:00:00Z"])
        for moment in (NOW, NOW+timedelta(minutes=59), NOW-timedelta(minutes=1)):
            with self.assertRaises(w.WorkerError): self.transition("idle_charge", None, moment)
        for hour in range(1,24): self.transition("idle_charge", None, NOW+timedelta(hours=hour))
        with self.assertRaises(w.WorkerError): self.transition("idle_charge", None, NOW+timedelta(hours=23,minutes=59))
        state = self.transition("idle_charge", None, NOW+timedelta(hours=24))
        self.assertEqual(len(state["idleAttempts"]), 24)
        pending = {"prepareKey": "a"*64, "intent": {"kind": "ordinary", "ownerImagesCommit": None},
                   "retryAt": "2026-10-19T12:15:00Z", "producerRunIds": [12345]}
        state = self.transition("pending", pending, NOW+timedelta(hours=24))
        self.assertEqual(w.load_journal(self.root)["pending"], pending)
        with self.assertRaises(w.WorkerError): self.transition("idle_charge", None, NOW+timedelta(hours=25))

    def test_manifests_and_failures_do_not_leak_sensitive_values(self):
        # Serializing the full state into handoff or exception text would leak source cells/credentials.
        prepared = self.prepared()
        for marker in (BOOK.decode(), "synthetic-credential-SENTINEL", str(self.root)):
            self.assertNotIn(marker, prepared["manifestBytes"].decode())
        value = intake(); value["unexpected"] = "synthetic-credential-SENTINEL"
        output = StringIO()
        with redirect_stdout(output), redirect_stderr(output), self.assertRaises(w.WorkerError) as caught:
            self.transition("source", value, context=expected("sharepoint_intake", BOOK))
        self.assertEqual(output.getvalue(), "")
        self.assertRegex(str(caught.exception), r"^[A-Z_]+$")
        self.assertNotIn("SENTINEL", str(caught.exception))

    def test_malformed_durable_phase_holds_with_safe_code(self):
        # Decoding a valid DPAPI dictionary does not make a malformed business phase safe.
        self.frozen(); state = w.load_journal(self.root)
        state["source"] = {"phase": "SENTINEL-private-malformed"}
        w.save_journal(self.root, state)
        with self.assertRaises(w.WorkerError) as caught:
            self.transition("source_reply", {"statusCode": 200, "body": receipt("published"), "requestedAt": "2026-10-18T12:00:00Z"})
        self.assertEqual(str(caught.exception), "WORKER_STATE_INVALID")

    def test_equivalent_receipt_preserves_original_link_and_zero_observation_counts(self):
        # Inferring equivalence from savedFields0 or adopting the current revision loses original acceptance.
        self.frozen()
        equivalent = receipt(outcome="equivalent"); equivalent["acceptedRequestId"] = "ascm-sp-"+"a"*64
        equivalent["storageRevision"] = 82
        state = self.transition("source_reply", {"statusCode": 202, "body": equivalent, "requestedAt": "2026-10-18T12:00:00Z"})
        self.assertEqual(state["source"]["receipt"]["storageRevision"], 82)
        wrong = deepcopy(equivalent); wrong["summary"]["savedProducts"] = 1
        with self.assertRaises(w.WorkerError): self.transition("source_reply", {"statusCode": 202, "body": wrong, "requestedAt": "2026-10-18T12:00:00Z"})
        self.assertEqual(w.load_journal(self.root), state)

    def test_confirmation_without_remote_proof_and_unknown_result_never_complete(self):
        # Local preparation must never be accepted in place of a fresh remote return.
        self.prepared()
        with self.assertRaises(w.WorkerError):
            self.transition("confirmation", {"status": "published", "publication": {}, "archiveAllowed": False})
        state = self.transition("result", result("held"), NOW+timedelta(minutes=2))
        self.assertEqual(state["publication"]["phase"], "command_held")
        self.assertEqual(state["source"]["phase"], "pending")

    def test_completed_same_attempt_never_refreezes_or_accepts_changed_bytes(self):
        # A duplicate sync event must not turn a complete receipt back into active work.
        self.frozen()
        completed = self.transition("source_reply", {"statusCode": 200, "body": receipt("published"), "requestedAt": "2026-10-18T12:00:00Z"})
        again = self.transition("source", intake(), context=expected("sharepoint_intake", BOOK))
        self.assertEqual(again, completed)
        with self.assertRaises(w.WorkerError):
            self.transition("source", intake(), context=expected("sharepoint_intake", b"x"*len(BOOK)))
        with self.assertRaises(w.WorkerError):
            self.transition("source_reply", {"statusCode": 202, "body": receipt(), "requestedAt": "2026-10-18T12:00:00Z"})
        self.assertEqual(w.load_journal(self.root), completed)

    def test_malformed_protected_remote_proof_cannot_advance_confirmation(self):
        # A phase label without its exact saved remote metadata must not become proof.
        self.prepared()
        state = self.transition("result", result(), NOW+timedelta(minutes=2), {"raw": PACKAGE})
        state["publication"]["remoteProof"]["result"] = {"status": "verified"}
        w.save_journal(self.root, state)
        publication = {"provider": "sharepoint", "kind": "publication", "candidateId": CANDIDATE, "generation": 3,
                       "storageRevision": 84, "sha256": hashlib.sha256(PACKAGE).hexdigest(), "bytes": len(PACKAGE), "publishedAt": "2026-10-18T12:02:00Z"}
        with self.assertRaises(w.WorkerError):
            self.transition("confirmation", {"status": "published", "publication": publication, "archiveAllowed": False}, NOW+timedelta(minutes=3))

    def test_malformed_protected_confirmation_cannot_advance_another_phase(self):
        # An invalid saved confirmation must hold before its phase label is trusted.
        self.prepared()
        self.transition("result", result(), NOW+timedelta(minutes=2), {"raw": PACKAGE})
        publication = {"provider": "sharepoint", "kind": "publication", "candidateId": CANDIDATE, "generation": 3,
                       "storageRevision": 84, "sha256": hashlib.sha256(PACKAGE).hexdigest(), "bytes": len(PACKAGE), "publishedAt": "2026-10-18T12:02:00Z"}
        state = self.transition("confirmation", {"status": "published", "publication": publication, "archiveAllowed": False}, NOW+timedelta(minutes=3))
        state["publication"]["confirmation"] = {}
        w.save_journal(self.root, state)
        with self.assertRaises(w.WorkerError):
            self.transition("source_reply", {"statusCode": 200, "body": receipt("published"), "requestedAt": "2026-10-18T12:03:00Z"}, NOW+timedelta(minutes=4))

    def test_completed_protected_source_requires_saved_receipt_before_idle_charge(self):
        # A complete phase with a surviving reply time cannot stand in for its native receipt.
        self.frozen()
        state = self.transition("source_reply", {"statusCode": 200, "body": receipt("published"), "requestedAt": "2026-10-18T12:00:00Z"})
        state["source"]["receipt"] = None
        w.save_journal(self.root, state)
        self.assertEqual(w.load_journal(self.root), state)
        with self.assertRaises(w.WorkerError) as caught:
            self.transition("idle_charge", None, NOW+timedelta(hours=1))
        self.assertEqual(caught.exception.code, "WORKER_STATE_INVALID")
        self.assertEqual(w.load_journal(self.root), state)

    def test_pending_protected_source_cannot_rebind_missing_saved_acceptance(self):
        # Losing only the protected receipt must not allow a later response to choose revision999.
        state = self.accepted()
        self.assertEqual(state["source"]["receipt"]["storageRevision"], 84)
        state["source"]["receipt"] = None
        w.save_journal(self.root, state)
        replacement = receipt(); replacement["storageRevision"] = 999
        with self.assertRaises(w.WorkerError) as caught:
            self.transition("source_reply", {"statusCode": 202, "body": replacement, "requestedAt": "2026-10-18T12:01:00Z"}, NOW+timedelta(minutes=1))
        self.assertEqual(caught.exception.code, "WORKER_STATE_INVALID")
        self.assertEqual(w.load_journal(self.root), state)

    def test_protected_source_receipt_and_reply_time_are_a_complete_phase_pair(self):
        # Pending/complete require both fields; frozen requires neither, never a half-pair.
        for phase in ("pending", "complete"):
            for missing in ("replyAt", "both"):
                with self.subTest(phase=phase, missing=missing):
                    local_root = self.base / (phase+missing)
                    w.transition_journal(local_root, "source", intake(), expected("sharepoint_intake", BOOK), NOW)
                    code = 200 if phase == "complete" else 202
                    body = receipt("published" if code == 200 else "publication_pending")
                    state = w.transition_journal(local_root, "source_reply", {"statusCode": code, "body": body, "requestedAt": "2026-10-18T12:00:00Z"}, {}, NOW)
                    state["source"]["replyAt"] = None
                    if missing == "both": state["source"]["receipt"] = None
                    w.save_journal(local_root, state)
                    with self.assertRaises(w.WorkerError) as caught:
                        w.transition_journal(local_root, "source_reply", {"statusCode": code, "body": body, "requestedAt": "2026-10-18T12:01:00Z"}, {}, NOW+timedelta(minutes=1))
                    self.assertEqual(caught.exception.code, "WORKER_STATE_INVALID")
                    self.assertEqual(w.load_journal(local_root), state)


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
                    b'[]', b'{} trailing', b'\xef\xbb\xbf{}', b' ' * (w.MAX_JSON + 1)):
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
