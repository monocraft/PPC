import { createHash } from 'node:crypto';
import { MAX_PACKAGE_BYTES } from '../ppc-master/package-delivery-contract.mjs';

/** Retains only eight envelope bytes and the native incremental SHA-256 state. */
export function createCiphertextVerifier() {
  const hash = createHash('sha256');
  const header = new Uint8Array(8); let bytes = 0, finished = false;
  return Object.freeze({
    update(chunk) {
      if (finished || !(chunk instanceof Uint8Array) || bytes + chunk.byteLength > MAX_PACKAGE_BYTES) throw new Error('Invalid encrypted package stream.');
      if (bytes < 8) header.set(chunk.subarray(0, 8 - bytes), bytes);
      bytes += chunk.byteLength; hash.update(chunk);
    },
    finish() {
      if (finished) throw new Error('Package verifier is already closed.');
      finished = true;
      if (bytes < 36 || new TextDecoder().decode(header) !== 'PPCPKG01') throw new Error('Unsupported encrypted package envelope.');
      return { sha256: hash.digest('hex'), bytes, envelope: 'PPCPKG01' };
    },
  });
}

/** Pull-based verification preserves transport backpressure and cancellation. */
export function verifiedCiphertextStream(body, candidate, { signal, onVerified = () => {} } = {}) {
  if (!body) throw new Error('Missing encrypted package stream.');
  const reader = body.getReader(), verifier = createCiphertextVerifier(); let closed = false;
  const cancel = reason => reader.cancel(reason).catch(() => {});
  let abort;
  return new ReadableStream({
    start(controller) {
      abort = () => { if (!closed) { closed = true; controller.error(new Error('Package transfer aborted.')); void cancel(signal?.reason); reader.releaseLock(); } };
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    },
    async pull(controller) {
      if (closed) return;
      try {
        const part = await reader.read();
        if (closed) return;
        if (part.done) {
          const actual = verifier.finish();
          if (actual.bytes !== candidate.bytes || actual.sha256 !== candidate.sha256) throw new Error('Encrypted package identity mismatch.');
          onVerified(actual); closed = true; signal?.removeEventListener('abort', abort); reader.releaseLock(); controller.close();
        } else { verifier.update(part.value); controller.enqueue(part.value); }
      } catch (error) {
        if (!closed) { closed = true; signal?.removeEventListener('abort', abort); await cancel(error); reader.releaseLock(); controller.error(error); }
      }
    },
    async cancel(reason) { if (!closed) { closed = true; signal?.removeEventListener('abort', abort); await cancel(reason); reader.releaseLock(); } },
  });
}

export async function verifyCiphertext(body, candidate, options) {
  let actual; const reader = verifiedCiphertextStream(body, candidate, { ...options, onVerified: value => { actual = value; } }).getReader();
  try { while (!(await reader.read()).done) { /* Incremental drain, no accumulation. */ } return actual; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
