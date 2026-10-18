import assert from 'node:assert/strict';
import test from 'node:test';
import { createPackageDeliveryClient, PackageDeliveryClientError } from '../package-delivery-client.mjs';

const endpoint = 'https://fixture.supabase.co/functions/v1/ppc-package/api/package';
const publisherSecret = 'fixture_publisher_secret_123456789000';
const candidate = { candidateId: '11111111-1111-4111-8111-111111111111', generation: 2 };
const okay = () => Response.json({ status: 'ready' });
function setup(fetchImpl, overrides = {}) {
  const waits = [];
  const client = createPackageDeliveryClient({ endpoint, publisherSecret, fetchImpl,
    wait: async ms => { waits.push(ms); }, now: () => Date.parse('2026-10-18T00:00:00Z'), ...overrides });
  return { client, waits };
}
for (const operation of ['readCurrent', 'reserve', 'seed', 'finalize']) {
  test(`${operation} retries a transient failure with the exact replay-safe request`, async () => {
    const sent = []; const input = { ...candidate };
    const { client, waits } = setup(async (url, options) => {
      sent.push({ url, body: options.body });
      if (sent.length === 1) { input.generation = 90; throw new Error(`${publisherSecret}: private transport details`); }
      return okay();
    });
    assert.deepEqual(await client[operation](input), { status: 'ready' });
    assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.deepEqual(waits, [250]);
  });
}
for (const status of [408, 429, 502, 503, 504]) {
  test(`safe current read retries HTTP ${status} with a finite budget`, async () => {
    let attempts = 0;
    const { client, waits } = setup(async () => { attempts++; return Response.json({ code: 'PACKAGE_UNAVAILABLE' }, { status }); });
    await assert.rejects(client.readCurrent(), error => {
      assert(error instanceof PackageDeliveryClientError); assert.equal(error.code, 'PACKAGE_UNAVAILABLE');
      assert.equal(error.stage, 'current'); assert.equal(error.httpStatus, status); return true;
    });
    assert.equal(attempts, 3); assert.deepEqual(waits, [250, 500]);
  });
}
test('transport failures exhaust the same finite budget without logging upstream details', async () => {
  let attempts = 0;
  const { client, waits } = setup(async () => { attempts++; throw new Error(publisherSecret); });
  await assert.rejects(client.readCurrent(), error => {
    assert.equal(error.code, 'DELIVERY_CONNECTION_FAILED'); assert.equal(error.stage, 'current');
    assert(!`${error.message} ${error.stack} ${JSON.stringify(error)}`.includes(publisherSecret)); return true;
  });
  assert.equal(attempts, 3); assert.deepEqual(waits, [250, 500]);
});
for (const [header, expected] of [['2', 2000], ['999999999', 30000], ['Sun, 18 Oct 2026 00:00:07 GMT', 7000],
  ['Sun, 18 Oct 2026 00:00:00 GMT', 250], ['not-a-delay', 250], ['-1', 250]]) {
  test(`Retry-After ${header} is honored within the active-operation bound`, async () => {
    let attempts = 0;
    const { client, waits } = setup(async () => ++attempts === 1
      ? new Response('temporarily unavailable', { status: 503, headers: { 'Retry-After': header } }) : okay());
    assert.deepEqual(await client.readCurrent(), { status: 'ready' }); assert.deepEqual(waits, [expected]);
  });
}
for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [400, 'INVALID_REQUEST'], [409, 'PACKAGE_UPLOAD_UNSETTLED'],
  [500, 'PACKAGE_UNAVAILABLE'], [503, 'UNAUTHORIZED'], [503, 'POLICY_DENIED'], [503, 'INVALID_REQUEST'], [503, 'PACKAGE_STATE_INVALID'], [503, 'PACKAGE_UPLOAD_UNSETTLED']]) {
  test(`HTTP ${status}/${code} holds without retry`, async () => {
    let attempts = 0;
    const { client, waits } = setup(async () => { attempts++; return Response.json({ code }, { status }); });
    await assert.rejects(client.readCurrent(), error => error.code === code);
    assert.equal(attempts, 1); assert.deepEqual(waits, []);
  });
}
for (const failure of ['transport', 'http', 'body']) {
  test(`upload ${failure} uncertainty never blindly repeats the binary mutation`, async () => {
    let attempts = 0;
    const { client, waits } = setup(async () => {
      attempts++;
      if (failure === 'transport') throw new Error(publisherSecret);
      if (failure === 'body') return new Response('not-json');
      return Response.json({ code: 'PACKAGE_UNAVAILABLE' }, { status: 503, headers: { 'Retry-After': '3' } });
    });
    await assert.rejects(client.upload(candidate, new Uint8Array(36)), error => error.stage === 'upload');
    assert.equal(attempts, 1); assert.deepEqual(waits, []);
  });
}
test('successful but malformed JSON is not a transient failure', async () => {
  let attempts = 0;
  const { client, waits } = setup(async () => { attempts++; return new Response('private malformed body'); });
  await assert.rejects(client.readCurrent(), error => error.code === 'DELIVERY_RESPONSE_INVALID');
  assert.equal(attempts, 1); assert.deepEqual(waits, []);
});

test('safe read retries an interrupted response stream without treating malformed JSON as transport loss', async () => {
  let attempts = 0;
  const { client, waits } = setup(async () => ++attempts === 1 ? new Response(new ReadableStream({
    start(controller) { controller.error(new Error(publisherSecret)); }
  })) : okay());
  assert.deepEqual(await client.readCurrent(), { status: 'ready' }); assert.equal(attempts, 2); assert.deepEqual(waits, [250]);
});
test('response size validation holds even when upstream uses a transient status', async () => {
  let attempts = 0;
  const { client, waits } = setup(async () => { attempts++; return new Response('{}', { status: 503, headers: { 'Content-Length': '32769' } }); });
  await assert.rejects(client.readCurrent(), error => error.code === 'DELIVERY_RESPONSE_INVALID');
  assert.equal(attempts, 1); assert.deepEqual(waits, []);
});
test('unknown upstream codes never enter diagnostics or trigger retries', async () => {
  let attempts = 0;
  const { client, waits } = setup(async () => { attempts++; return Response.json({ code: 'PRIVATE_SECRET_VALUE' }, { status: 503 }); });
  await assert.rejects(client.readCurrent(), error => error.code === 'DELIVERY_UNAVAILABLE' && !JSON.stringify(error).includes('PRIVATE_SECRET_VALUE'));
  assert.equal(attempts, 1); assert.deepEqual(waits, []);
});
