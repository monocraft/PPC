import assert from 'node:assert/strict';
import { MAX_PACKAGE_BYTES, validateCandidate, validateReceipt, qualifiesSharePointPublication } from '../../supabase/functions/ppc-master/package-delivery-contract.mjs';

const candidateId = '11111111-1111-4111-8111-111111111111';
const candidate = { candidateId, kind: 'publication', generation: 2, expectedGeneration: 1,
  storageRevision: 7, sourceSha: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), ownerImagesCommit: null,
  sha256: 'c'.repeat(64), bytes: 36, objectKey: `packages/${candidateId}.pkg`,
  createdAt: '2026-10-17T12:00:00.000Z', expiresAt: '2026-10-17T15:00:00.000Z', status: 'reserved' };
const policy = { driveId: 'real-drive', folderId: 'real-folder' };
const receipt = { provider: 'sharepoint', kind: 'publication', candidateId, generation: 2,
  storageRevision: 7, sha256: 'c'.repeat(64), bytes: 36, ...policy, itemId: 'connector-item',
  versionId: '1.0', fileName: `master-r7-g2-${candidateId}.pkg`, confirmedAt: '2026-10-17T13:00:00.000Z' };
assert.deepEqual(validateCandidate(candidate), candidate);
assert.equal(validateCandidate({ ...candidate, bytes: MAX_PACKAGE_BYTES }).bytes, 67108864);
for (const patch of [{ bytes: 35 }, { bytes: 67108865 }, { bytes: '36' }, { generation: 3 },
  { manifestSha256: null }, { ownerImagesCommit: 'owner-branch' }, { objectKey: 'packages/other.pkg' },
  { storageRevision: -1 }, { sourceSha: 'A'.repeat(40) }, { status: 'uploading' }, { kind: 'legacy' },
  { expiresAt: candidate.createdAt }, { createdAt: 'yesterday' }, { arbitrary: true }]) {
  assert.throws(() => validateCandidate({ ...candidate, ...patch }), /Invalid package candidate/);
}
assert.deepEqual(validateCandidate({ ...candidate, kind: 'seed', manifestSha256: null }), { ...candidate, kind: 'seed', manifestSha256: null });
assert.throws(() => validateCandidate({ ...candidate, kind: 'seed', manifestSha256: null, ownerImagesCommit: 'd'.repeat(40) }), /Invalid package candidate/);
assert.deepEqual(validateReceipt(receipt, policy), receipt);
for (const patch of [{ provider: 'github' }, { driveId: 'other' }, { folderId: 'other' },
  { fileName: 'master_ppc.pkg' }, { itemId: '' }, { versionId: '\nversion' }, { host: 'elsewhere' },
  { bytes: 35 }, { candidateId: 'invalid' }, { confirmedAt: 'today' }]) {
  assert.throws(() => validateReceipt({ ...receipt, ...patch }, policy), /Invalid package receipt/);
}
assert.throws(() => validateReceipt(receipt, {}), /Invalid package receipt/);
const seedReceipt = { ...receipt, kind: 'seed', fileName: 'master_ppc.pkg', versionId: '4.0' };
assert.deepEqual(validateReceipt(seedReceipt, policy), seedReceipt);
assert.throws(() => validateReceipt({ ...seedReceipt, versionId: '5.0' }, policy), /Invalid package receipt/);
const publication = { provider: 'sharepoint', kind: 'publication', candidateId, generation: 2,
  sha256: 'c'.repeat(64), bytes: 36, storageRevision: 7, publishedAt: receipt.confirmedAt };
assert.equal(qualifiesSharePointPublication(publication, 7), true);
assert.equal(qualifiesSharePointPublication(publication, 6), true);
for (const value of [null, { ...publication, kind: 'seed' }, { ...publication, provider: 'github' },
  { ...publication, sha256: undefined }, { ...publication, generation: 0 }, { ...publication, publishedAt: null }]) {
  assert.equal(qualifiesSharePointPublication(value, 7), false);
}
assert.equal(qualifiesSharePointPublication(publication, 8), false);
assert.equal(qualifiesSharePointPublication(publication, '7'), false);
console.log('Package delivery contract passed: strict candidate/receipt identity, bounds, pinned destination and seed-ineligible Archive gate.');
