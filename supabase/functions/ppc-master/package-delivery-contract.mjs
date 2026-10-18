// Shared metadata contract only. Private destinations and Storage capabilities
// must never be inferred from caller-supplied paths or publication snapshots.
export const MAX_PACKAGE_BYTES = 67_108_864;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const integer = (value, minimum = 1) => Number.isSafeInteger(value) && value >= minimum && value < Number.MAX_SAFE_INTEGER;
const digest = (value, pattern) => typeof value === 'string' && pattern.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identity = value => digest(value.candidateId, UUID) && integer(value.generation) && integer(value.storageRevision)
  && digest(value.sha256, SHA256) && integer(value.bytes, 36) && value.bytes <= MAX_PACKAGE_BYTES;

export function validateCandidate(value) {
  const keys = ['candidateId', 'kind', 'generation', 'expectedGeneration', 'storageRevision', 'sourceSha',
    'manifestSha256', 'ownerImagesCommit', 'sha256', 'bytes', 'objectKey', 'createdAt', 'expiresAt', 'status'];
  if (!exact(value, keys) || !identity(value) || !integer(value.expectedGeneration, 0)
    || value.generation !== value.expectedGeneration + 1 || !digest(value.sourceSha, SHA1)
    || !['seed', 'publication'].includes(value.kind)
    || (value.kind === 'seed' ? value.manifestSha256 !== null || value.ownerImagesCommit !== null : !digest(value.manifestSha256, SHA256))
    || (value.ownerImagesCommit !== null && !digest(value.ownerImagesCommit, SHA1))
    || value.objectKey !== `packages/${value.candidateId}.pkg`
    || !instant(value.createdAt) || !instant(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
    || !['reserved', 'ready', 'published', 'cleanup'].includes(value.status)) throw new Error('Invalid package candidate');
  return value;
}

export function validateReceipt(value, policy) {
  const keys = ['provider', 'kind', 'candidateId', 'generation', 'storageRevision', 'sha256', 'bytes',
    'driveId', 'folderId', 'itemId', 'versionId', 'fileName', 'confirmedAt'];
  if (!exact(value, keys) || !identity(value) || value.provider !== 'sharepoint'
    || !policy || !text(policy.driveId) || !text(policy.folderId)
    || value.driveId !== policy.driveId || value.folderId !== policy.folderId
    || !text(value.itemId) || !text(value.versionId) || !instant(value.confirmedAt)
    || (value.kind === 'seed' ? value.fileName !== 'master_ppc.pkg' || value.versionId !== '4.0'
      : value.kind !== 'publication' || value.fileName !== `master-r${value.storageRevision}-g${value.generation}-${value.candidateId}.pkg`)) throw new Error('Invalid package receipt');
  return value;
}

export function qualifiesSharePointPublication(publication, receiptRevision) {
  return !!publication && typeof publication === 'object' && !Array.isArray(publication)
    && publication.provider === 'sharepoint' && publication.kind === 'publication'
    && identity(publication) && instant(publication.publishedAt)
    && integer(receiptRevision) && publication.storageRevision >= receiptRevision;
}
