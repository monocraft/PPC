import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validateAscmEnvelope } from '../../supabase/functions/ppc-master/ascm-mail-policy.mjs';
import { runAscmSupervisor } from '../../server/ascm-supervisor.mjs';

const bytes = Buffer.from('synthetic workbook fixture');
const digest = 'ascm-' + createHash('sha256').update(bytes).digest('hex');
const instant = '2026-10-17T12:00:00.000Z';
const sender = 'linny.chen@hp.com';
const subject = 'ASCM Report Accessories HyperX Release Notification October 2026';
const fileName = 'ASCM Report_HyperX_2026-09-30.xlsx';
const envelope = { sender, subject, receivedAt: '2026-10-10T12:00:00Z', messageId: 'message-one', fileName };
const env = {
  PPC_ASCM_ENABLED: 'true',
  PPC_ASCM_TENANT_ID: '11111111-2222-4333-8444-555555555555',
  PPC_ASCM_CLIENT_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  PPC_ASCM_CLIENT_SECRET: 'synthetic-client-secret',
  PPC_ASCM_MAILBOX: 'owner@example.test',
  PPC_ASCM_API_URL: 'https://fixture.supabase.co/functions/v1/ppc-master/api/master/ascm',
  PPC_ASCM_IMPORT_SECRET: 'synthetic-import-secret',
  PPC_ASCM_START_AFTER: '2026-10-01T00:00:00Z',
};
const userPath = '/v1.0/users/owner%40example.test';
const inboxPath = userPath + '/mailFolders/inbox/messages';
const message = (patch = {}) => ({
  id: 'message-one', from: { emailAddress: { name: 'Synthetic sender', address: sender } }, subject,
  receivedDateTime: envelope.receivedAt, hasAttachments: true, ...patch,
});
const attachment = (patch = {}) => ({
  '@odata.type': '#microsoft.graph.fileAttachment', id: 'attachment-one', name: fileName,
  size: bytes.length, isInline: false,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...patch,
});
const receipt = (patch = {}) => ({ requestId: digest, storageRevision: 7, alreadySaved: false,
  archiveAllowed: true, status: 'accepted', summary: { savedProducts: 1 }, ...patch });
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers });

// Doubles replace only HTTP transport; all policy, decoding, selection, and archive gates run for real.
function transport({ messages = [message()], pages, attachments = [attachment()], attachmentBody,
  apiReceipt = receipt(), apiStatus = 200, backendError = false, moveBody,
  archiveError = false, tokenBody, pageResponse } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    assert.equal(options.redirect, 'error', 'every authenticated request rejects redirects');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal, 'every transport has a timeout signal');
    if (parsed.origin === 'https://login.microsoftonline.com') {
      assert.equal(parsed.pathname, '/11111111-2222-4333-8444-555555555555/oauth2/v2.0/token');
      assert.equal(options.method, 'POST');
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'client_credentials');
      assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');
      assert.equal(form.get('client_id'), env.PPC_ASCM_CLIENT_ID);
      assert.equal(form.get('client_secret'), env.PPC_ASCM_CLIENT_SECRET);
      return tokenBody || json({ token_type: 'Bearer', expires_in: 3599, access_token: 'fixture-token' });
    }
    if (parsed.href === env.PPC_ASCM_API_URL) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['X-PPC-ASCM-Secret'], env.PPC_ASCM_IMPORT_SECRET);
      assert.equal(options.headers.Authorization, undefined, 'Graph token never reaches PPC');
      assert.deepEqual(JSON.parse(options.body), { ...envelope, workbookBase64: bytes.toString('base64') });
      if (backendError) throw new Error('private payload must never escape transport');
      return json(apiReceipt, apiStatus);
    }
    assert.equal(parsed.origin, 'https://graph.microsoft.com', 'Graph token never leaves pinned origin');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(options.headers['X-PPC-ASCM-Secret'], undefined);
    assert.equal(options.headers.Prefer, 'IdType="ImmutableId"');
    if (parsed.pathname === inboxPath) {
      assert.equal(options.method, 'GET');
      const page = Number(parsed.searchParams.get('page') || 0);
      return pageResponse || json(pages ? pages[page] : { value: messages });
    }
    if (parsed.pathname === userPath + '/messages/message-one/attachments') {
      assert.equal(options.method, 'GET');
      return json({ value: attachments });
    }
    if (parsed.pathname === userPath + '/messages/message-one/attachments/attachment-one') {
      assert.equal(options.method, 'GET');
      return json(attachmentBody || { ...attachment(), contentBytes: bytes.toString('base64') });
    }
    if (parsed.pathname === userPath + '/mailFolders/archive') {
      assert.equal(options.method, 'GET');
      return json({ id: 'archive-folder', displayName: 'Archive' });
    }
    if (parsed.pathname === userPath + '/messages/message-one/move') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { destinationId: 'archive-folder' });
      if (archiveError) throw new Error('private move response');
      return json(moveBody || { ...message(), parentFolderId: 'archive-folder' }, 201);
    }
    throw new Error('Unexpected synthetic transport route');
  };
  return { calls, fetchImpl };
}
const callsOf = (harness, suffix) => harness.calls.filter(call => call.url.pathname.endsWith(suffix));
const run = (harness, overrides = {}) => runAscmSupervisor({ env: { ...env, ...overrides },
  fetchImpl: harness.fetchImpl, now: () => new Date(instant) });

test('monthly policy accepts exact sender and publication identity with surrounding subject whitespace', () => {
  assert.deepEqual(validateAscmEnvelope({ ...envelope, sender: 'LINNY.CHEN@HP.COM',
    subject: '  ascm report accessories hyperx release notification october 2026  ' }),
  { reportDate: '2026-09-30', publicationMonth: '2026-10' });
  assert.deepEqual(validateAscmEnvelope({ ...envelope, fileName: 'ASCM Report_HyperX_2026-10-10.xlsx' }),
    { reportDate: '2026-10-10', publicationMonth: '2026-10' });
});

test('monthly policy holds weekly, spoofed, invalid, future-report, and incompatible-month envelopes', () => {
  for (const patch of [
    { sender: 'other@example.test' }, { subject: subject + ' weekly review' },
    { subject: 'Weekly ASCM Review' }, { fileName: 'ASCM Report_HyperX_2026-09-31.xlsx' },
    { fileName: 'ASCM Report_HyperX_2026-08-31.xlsx' }, { fileName: 'ASCM Report_HyperX_2026-10-11.xlsx' },
    { fileName: '../' + fileName }, { fileName: 'ASCM Report_HyperX_2026-09-30.xlsm' },
    { receivedAt: '2026-02-30T12:00:00Z' }, { receivedAt: '2026-10-10' }, { messageId: '' },
  ]) assert.throws(() => validateAscmEnvelope({ ...envelope, ...patch }));
});

test('monthly policy accepts Graph fractional-second precision and December-to-January reports', () => {
  assert.deepEqual(validateAscmEnvelope({ ...envelope, receivedAt: '2026-10-10T12:00:00.0000000Z' }),
    { reportDate: '2026-09-30', publicationMonth: '2026-10' });
  assert.deepEqual(validateAscmEnvelope({ ...envelope,
    subject: 'ASCM Report Accessories HyperX Release Notification January 2027',
    receivedAt: '2027-01-10T12:00:00+00:00', fileName: 'ASCM Report_HyperX_2026-12-31.xlsx' }),
  { reportDate: '2026-12-31', publicationMonth: '2027-01' });
});

test('an explicit disabled gate performs zero network requests without reporting failure', async () => {
  for (const enabled of ['', 'false', 'TRUE', undefined]) {
    const harness = transport();
    const result = await run(harness, { PPC_ASCM_ENABLED: enabled });
    assert.equal(result.status, 'disabled');
    assert.equal(result.failed, 0);
    assert.equal(harness.calls.length, 0);
  }
});

test('an enabled runner reports incomplete or unsafe configuration as failure without network requests', async () => {
  for (const key of Object.keys(env).filter(key => key !== 'PPC_ASCM_ENABLED')) {
    const harness = transport();
    const result = await run(harness, { [key]: '' });
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.failed, 1);
    assert.equal(harness.calls.length, 0);
  }
  for (const patch of [
    { PPC_ASCM_TENANT_ID: 'common' },
    { PPC_ASCM_API_URL: 'http://fixture.test/api/master/ascm' },
    { PPC_ASCM_API_URL: env.PPC_ASCM_API_URL + '?redirect=elsewhere' },
    { PPC_ASCM_START_AFTER: '2026-02-30T00:00:00Z' },
    { PPC_ASCM_MAILBOX: 'owner@example.test/messages' },
  ]) {
    const harness = transport();
    const result = await run(harness, patch);
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.failed, 1);
    assert.equal(harness.calls.length, 0);
  }
});

test('an enabled misconfigured CLI exits unsuccessfully with sanitized counts', () => {
  const result = spawnSync(process.execPath,
    [fileURLToPath(new URL('../../server/ascm-supervisor.mjs', import.meta.url))],
    { env: { ...process.env, ...env, PPC_ASCM_CLIENT_SECRET: '' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'needs_attention');
  assert.equal(summary.failed, 1);
  assert.equal(summary.examined, 0);
  assert.ok(!result.stdout.includes(env.PPC_ASCM_MAILBOX));
});

test('Inbox query excludes weekly subjects and attachment-free mail before the message bound', async () => {
  const harness = transport({ messages: [] });
  await run(harness);
  const filter = callsOf(harness, '/messages')[0].url.searchParams.get('$filter');
  assert.match(filter, /contains\(subject,'ASCM Report Accessories HyperX Release Notification '\)/);
  assert.match(filter, /hasAttachments eq true/);
});

test('Inbox query requests newest reports first so older held messages cannot hide a new publication', async () => {
  const harness = transport({ messages: [] });
  await run(harness);
  assert.equal(callsOf(harness, '/messages')[0].url.searchParams.get('$orderby'), 'receivedDateTime desc');
});

test('empty or unrelated inbox never reads PPC or attachments', async () => {
  for (const messages of [[], [message({ subject: 'Weekly ASCM Review' }),
    message({ from: { emailAddress: { address: 'other@example.test' } } }),
    message({ receivedDateTime: '2026-09-30T00:00:00Z' }),
    message({ receivedDateTime: '2026-10-01T00:00:00Z' })]]) {
    const harness = transport({ messages });
    const result = await run(harness);
    assert.equal(result.submitted, 0);
    assert.equal(result.archived, 0);
    assert.equal(callsOf(harness, '/attachments').length, 0);
    assert.equal(harness.calls.some(call => call.url.href === env.PPC_ASCM_API_URL), false);
    const query = callsOf(harness, '/messages')[0].url.searchParams;
    assert.match(query.get('$filter'), /receivedDateTime gt 2026-10-01T00:00:00.000Z/);
  }
});

test('published digest receipt moves only the matching immutable message to verified Archive', async () => {
  const harness = transport();
  const result = await run(harness);
  assert.equal(result.submitted, 1);
  assert.equal(result.archived, 1);
  assert.equal(result.failed, 0);
  const backend = harness.calls.findIndex(call => call.url.href === env.PPC_ASCM_API_URL);
  const moved = harness.calls.findIndex(call => call.url.pathname.endsWith('/move'));
  assert.ok(moved > backend);
  assert.ok(harness.calls.every(call => !/\/(sendMail|send|delete)(\/|$)/i.test(call.url.pathname)));
  assert.ok(harness.calls.every(call => call.options.method !== 'DELETE'));
  const output = JSON.stringify(result);
  for (const privateValue of [sender, subject, fileName, env.PPC_ASCM_MAILBOX,
    env.PPC_ASCM_CLIENT_SECRET, env.PPC_ASCM_IMPORT_SECRET, bytes.toString('base64')])
    assert.ok(!output.includes(privateValue), 'run summary contains counts only');
});

test('pending publication never resolves or moves to Archive', async () => {
  const harness = transport({ apiReceipt: receipt({ archiveAllowed: false, status: 'pending' }) });
  const result = await run(harness);
  assert.equal(result.pending, 1);
  assert.equal(result.archived, 0);
  assert.equal(callsOf(harness, '/archive').length, 0);
  assert.equal(callsOf(harness, '/move').length, 0);
});

test('truthy flags, wrong digest, invalid revisions, failed HTTP and malformed receipts never archive', async () => {
  for (const patch of [
    { apiReceipt: receipt({ archiveAllowed: 'true' }) }, { apiReceipt: receipt({ requestId: 'ascm-other' }) },
    { apiReceipt: receipt({ storageRevision: 0 }) }, { apiReceipt: receipt({ storageRevision: 1.5 }) },
    { apiReceipt: receipt({ storageRevision: '7' }) }, { apiReceipt: {} }, { apiStatus: 500 },
  ]) {
    const harness = transport(patch);
    const result = await run(harness);
    assert.equal(result.archived, 0);
    assert.equal(callsOf(harness, '/move').length, 0);
    assert.equal(callsOf(harness, '/archive').length, 0);
  }
});

test('multiple matching workbooks, inline-only, item attachments, and oversize attachments stay in Inbox', async () => {
  for (const attachments of [
    [attachment(), attachment({ id: 'other' })], [attachment({ isInline: true })],
    [attachment({ '@odata.type': '#microsoft.graph.itemAttachment' })],
    [attachment({ size: 2 * 1024 * 1024 + 1 })],
    [attachment({ name: 'ASCM Report_HyperX_2026-09-31.xlsx' })],
  ]) {
    const harness = transport({ attachments });
    const result = await run(harness);
    assert.equal(result.submitted, 0);
    assert.equal(result.archived, 0);
  }
});

test('mismatched downloaded attachment identity and malformed or oversized bytes never reach PPC', async () => {
  for (const patch of [
    { id: 'different-attachment' }, { name: 'different.xlsx' }, { isInline: true },
    { contentBytes: 'invalid base64' }, { contentBytes: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') },
  ]) {
    const harness = transport({ attachmentBody: { ...attachment(), contentBytes: bytes.toString('base64'), ...patch } });
    assert.equal((await run(harness)).submitted, 0);
    assert.equal(harness.calls.some(call => call.url.href === env.PPC_ASCM_API_URL), false);
  }
});

test('lost API reply and archive failure can retry the same bytes without an unverified completion', async () => {
  const lost = transport({ backendError: true });
  assert.equal((await run(lost)).archived, 0);
  assert.equal(callsOf(lost, '/move').length, 0);
  const failedMove = transport({ archiveError: true });
  assert.equal((await run(failedMove)).uncertain, 1);
  const retry = transport({ apiReceipt: receipt({ alreadySaved: true }) });
  assert.equal((await run(retry)).archived, 1);
});

test('unverified move identity or folder is reported uncertain', async () => {
  for (const patch of [{ id: 'other-message' }, { parentFolderId: 'other-folder' }]) {
    const harness = transport({ moveBody: { ...message(), parentFolderId: 'archive-folder', ...patch } });
    const result = await run(harness);
    assert.equal(result.archived, 0);
    assert.equal(result.uncertain, 1);
  }
});

test('pagination rejects foreign origins and unrelated paths before a token-bearing followup', async () => {
  for (const next of [
    'https://graph.microsoft.com.evil.test' + inboxPath,
    'https://graph.microsoft.com:444' + inboxPath,
    'http://graph.microsoft.com' + inboxPath,
    'https://graph.microsoft.com/v1.0/users/other/mailFolders/inbox/messages',
    'https://graph.microsoft.com/v1.0/me/messages',
    'https://graph.microsoft.com' + inboxPath + '#fragment',
  ]) {
    const harness = transport({ pages: [{ value: [], '@odata.nextLink': next }] });
    assert.equal((await run(harness)).failed, 1);
    assert.equal(harness.calls.filter(call => call.url.origin === 'https://graph.microsoft.com').length, 1);
  }
});

test('pagination caps five pages and twenty-five examined messages across the complete run', async () => {
  const pages = Array.from({ length: 6 }, (_, i) => ({ value: [],
    '@odata.nextLink': 'https://graph.microsoft.com' + inboxPath + '?page=' + (i + 1) }));
  const paged = transport({ pages });
  await run(paged);
  assert.equal(callsOf(paged, '/messages').length, 5);
  const many = transport({ messages: Array.from({ length: 30 }, (_, i) => message({ id: 'skip-' + i, subject: 'Unrelated' })) });
  assert.equal((await run(many)).examined, 25);
  assert.equal(callsOf(many, '/attachments').length, 0);
});

test('oversized response declarations and authentication failures remain sanitized and stop requests', async () => {
  for (const config of [
    { tokenBody: json({ error: env.PPC_ASCM_CLIENT_SECRET }, 401) },
    { pageResponse: json({ value: [] }, 200, { 'content-length': '999999999' }) },
  ]) {
    const harness = transport(config);
    const result = await run(harness);
    assert.equal(result.failed, 1);
    assert.equal(result.submitted, 0);
    assert.ok(!JSON.stringify(result).includes(env.PPC_ASCM_CLIENT_SECRET));
  }
});

test('streamed oversize mailbox data is cancelled before any attachment or PPC request', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(128 * 1024).fill(32)); },
    cancel() { cancelled = true; },
  });
  const harness = transport({ pageResponse: new Response(body, { headers: { 'Content-Type': 'application/json' } }) });
  const result = await run(harness);
  assert.equal(result.failed, 1);
  assert.equal(result.submitted, 0);
  assert.equal(callsOf(harness, '/attachments').length, 0);
  assert.equal(cancelled, true);
});
