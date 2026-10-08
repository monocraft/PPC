import assert from 'node:assert/strict';
import '../../public/js/master-model.js';
import '../../public/js/product-merge.js';
import '../../public/js/master-client.js';
const model = globalThis.PortfolioMasterModel, merge = globalThis.PortfolioProductMerge, client = globalThis.PortfolioMasterClient;
const copy = (value) => structuredClone(value);
const keeper = { id: 'keep', laneId: 'wired', order: 3, name: 'Complete headset', codename: '', price: null, imageAssetId: 'keeper-image',
  generalAvailabilityDate: '2027-02-01', endManufacturingDate: '2029-02-01', roadmap: { startMonth: '2027-02', endMonth: '2029-02' },
  specs: [{ id: 'battery', label: 'Battery', value: '', ownerNote: 'Keep note' }], partSkus: [], variantGroups: [], custom: { owner: 'Team A' },
  ascm: { basePartNumbers: ['HP-ONE'], records: [{ basePartNumber: 'HP-ONE', procurement: 'first source' }] } };
const source = { id: 'source', laneId: 'wired', order: 7, name: 'Import headset', codename: 'Complete', imageAssetId: 'source-image',
  specs: [{ id: 'source-battery', label: 'battery', value: '80 hours', vendorNote: 'Keep source note' }, { id: 'drivers', label: 'Drivers', value: '53 mm' }],
  partSkus: [{ id: 'hp-row', code: 'HP-TWO', variantId: 'red', region: 'WW' }],
  variantGroups: [{ id: 'colors', type: 'color', label: 'Color', items: [{ id: 'red', code: 'RD', colorName: 'Red', colorHex: '#ff0000', imageAssetId: 'source-color', sourceNote: 'Color metadata' }] }],
  featuredVariantId: 'red', custom: { factory: 'Team B' }, ascm: { basePartNumbers: ['HP-TWO'], records: [{ basePartNumber: 'HP-TWO', procurement: 'second source' }] } };
const initial = { version: 4, categories: [{ id: 'audio', board: { lanes: [{ id: 'wired' }], products: [copy(keeper), copy(source), { id: 'related', laneId: 'wired', name: 'Successor', roadmap: { predecessorId: 'source' }, specs: [], partSkus: [], variantGroups: [] }] } }], imageAssets: ['keeper-image', 'source-image', 'source-color'].map((id) => ({ id, packagePath: `images/${id}.png` })) };
const records = (manifest) => model.snapshot(manifest).products;
const choicesFor = (planned) => Object.fromEntries(planned.conflicts.map((item) => [item.key, 'keeper']));
function operation(manifest = initial, overrides = {}) {
  const baseline = records(manifest), planned = merge.plan(keeper, source), choices = choicesFor(planned);
  return { kind: 'merge', productId: 'keep', sourceProductId: 'source', categoryId: 'audio', laneId: 'wired', sourceCategoryId: 'audio', sourceLaneId: 'wired', choices,
    base: baseline.find((item) => item.productId === 'keep'), sourceBase: baseline.find((item) => item.productId === 'source'),
    baseProductVersion: baseline.find((item) => item.productId === 'keep')?.productVersion, sourceBaseProductVersion: baseline.find((item) => item.productId === 'source')?.productVersion,
    mine: model.productValues(merge.resolve(planned, choices)), ...overrides };
}
const request = operation(), untouched = copy(initial), accepted = model.mergeChanges(initial, [request], { requestId: 'merge-one' });
assert.deepEqual(initial, untouched, 'planning and saving leave originals unchanged');
assert.equal(accepted.conflicts.length, 0);
const completed = accepted.manifest.categories[0].board.products.find((product) => product.id === 'keep');
assert.equal(accepted.manifest.categories[0].board.products.length, 2);
assert.equal(completed.order, 3); assert.equal(completed.imageAssetId, 'keeper-image');
assert.equal(completed.specs[0].value, '80 hours'); assert.equal(completed.specs[0].vendorNote, 'Keep source note');
assert.equal(completed.variantGroups[0].items[0].imageAssetId, 'source-color');
assert.equal(completed.partSkus[0].region, 'WW'); assert.deepEqual(completed.custom, { owner: 'Team A', factory: 'Team B' });
assert.equal(completed.ascm.records.length, 2); assert.deepEqual(completed.ascm.basePartNumbers, ['HP-ONE', 'HP-TWO']);
assert.deepEqual(accepted.manifest.imageAssets, initial.imageAssets);
assert.equal(accepted.manifest.masterSync.products.source.archivedProduct.imageAssetId, 'source-image');
assert.equal(accepted.manifest.categories[0].board.products.find((product) => product.id === 'related').roadmap.predecessorId, 'keep');
const tombstone = model.snapshot(accepted.manifest).tombstones.find((item) => item.productId === 'source');
assert.equal(tombstone.mergedIntoProductId, 'keep'); assert.deepEqual(tombstone.mergeChoices, request.choices);
assert(!JSON.stringify(model.snapshot(accepted.manifest)).includes('procurement'), 'public descriptors contain choices and IDs without private original source information');
assert.equal(model.mergeChanges(accepted.manifest, [request], { requestId: 'merge-one' }).savedFields, 0, 'same accepted merge replays safely');
for (const id of ['keep', 'source']) {
  const changed = copy(initial); changed.categories[0].board.products.find((product) => product.id === id).privateOwnerNote = 'A concurrent hidden change';
  const result = model.mergeChanges(changed, [request, { productId: 'related', base: records(initial).find((item) => item.productId === 'related').values, patch: { codename: 'Must remain atomic' } }]);
  assert.equal(result.conflicts[0].path, '@merge'); assert.equal(result.conflicts[0].requiresMergeReview, true);
  assert.deepEqual(result.manifest, changed, 'a stale original blocks the whole batch, including unrelated edits');
}
const abaFirst = model.mergeChanges(initial, [{ productId: 'source', base: request.sourceBase.values, patch: { codename: 'Temporary' } }]);
const abaBase = records(abaFirst.manifest).find((item) => item.productId === 'source');
const aba = model.mergeChanges(abaFirst.manifest, [{ productId: 'source', base: abaBase.values, baseRevisions: abaBase.revisions, patch: { codename: source.codename } }]);
assert.equal(model.mergeChanges(aba.manifest, [request]).conflicts[0].path, '@merge', 'returning to original values still fails original revision fences');
assert.throws(() => model.mergeChanges(initial, [request, { kind: 'delete', productId: 'source', base: request.sourceBase.values, baseProductVersion: request.sourceBaseProductVersion }]), /once|one change/);
assert.throws(() => model.mergeChanges(initial, [{ ...request, keeperProduct: { ...keeper, imageAssetId: 'untrusted' }, sourceProduct: { ...source, custom: { additional: true }, imageAssetId: 'untrusted' } }]), /has not been uploaded/, 'Reviewed supplemental records cannot inject unknown asset references.');
const empty = copy(initial); empty.categories[0].board.products = [];
const newRequest = operation(empty, { base: null, sourceBase: null, keeperProduct: copy(keeper), sourceProduct: copy(source) });
const imported = model.mergeChanges(empty, [newRequest]);
assert.equal(imported.conflicts.length, 0); assert.equal(imported.manifest.categories[0].board.products.length, 1);
assert.equal(imported.manifest.categories[0].board.products[0].ascm.records.length, 2, 'new imported sources can merge before either duplicate is saved');
assert.throws(() => model.mergeChanges(empty, [{ ...newRequest, sourceProduct: { ...source, imageAssetId: 'not-uploaded' } }]), /has not been uploaded/);
assert.throws(() => model.mergeChanges(initial, [{ ...request, choices: { constructor: 'source' } }]), /decisions/);

// Accepted products can also contain an import that has not been saved yet.
// Keep the fenced accepted originals, while retaining every reviewed local fact.
const reviewedKeeper = copy(keeper), reviewedSource = copy(source);
reviewedKeeper.specs[0].ownerNote = 'Reviewed local specification note';
reviewedKeeper.ascm.records.push({ basePartNumber: 'HP-THREE', procurement: 'New unsaved ASCM report', generalAvailabilityDate: '2027-02-01' });
reviewedKeeper.ascm.sourceFile = 'Latest-ASCM.xlsx';
reviewedSource.variantGroups[0].items[0].imageAssetId = 'keeper-image';
reviewedSource.variantGroups[0].items[0].localSupplierNote = 'Complete supplementary variant details';
reviewedSource.partSkus[0].certification = 'Supplier report information';
reviewedSource.custom.extraApproval = { compliance: 'Reviewed' };
const enrichedPlan = merge.plan(reviewedKeeper, reviewedSource), enrichedChoices = choicesFor(enrichedPlan);
const enrichedRequest = { ...request, keeperProduct: reviewedKeeper, sourceProduct: reviewedSource, choices: enrichedChoices, mine: model.values(merge.resolve(enrichedPlan, enrichedChoices)) };
const enriched = model.mergeChanges(initial, [enrichedRequest], { requestId: 'enriched-merge' });
assert.equal(enriched.conflicts.length, 0);
const enrichedProduct = enriched.manifest.categories[0].board.products.find((product) => product.id === 'keep');
assert.equal(enrichedProduct.ascm.records.length, 3); assert.equal(enrichedProduct.ascm.sourceFile, 'Latest-ASCM.xlsx');
assert.equal(enrichedProduct.ascm.records.find((row) => row.basePartNumber === 'HP-THREE').procurement, 'New unsaved ASCM report');
assert.equal(enrichedProduct.specs[0].ownerNote, 'Reviewed local specification note');
assert.equal(enrichedProduct.specs[0].vendorNote, 'Keep source note');
assert.equal(enrichedProduct.variantGroups[0].items[0].imageAssetId, 'keeper-image');
assert.equal(enrichedProduct.variantGroups[0].items[0].localSupplierNote, 'Complete supplementary variant details');
assert.equal(enrichedProduct.partSkus[0].certification, 'Supplier report information');
assert.equal(enrichedProduct.custom.extraApproval.compliance, 'Reviewed');
assert.deepEqual(enriched.manifest.masterSync.products.source.archivedKeeperProduct, keeper, 'Canonical original keeper is captured before reviewed supplemental overlays.');
assert.deepEqual(enriched.manifest.masterSync.products.source.archivedProduct, source, 'Canonical original donor is also retained before its local report enrichment.');
const partialReviewed = copy(reviewedKeeper); delete partialReviewed.custom; delete partialReviewed.specs[0].ownerNote;
const supplemented = model.supplementProduct(keeper, partialReviewed);
assert.equal(supplemented.custom.owner, 'Team A'); assert.equal(supplemented.specs[0].ownerNote, 'Keep note', 'Omitted private details are retained rather than replaced by the browser projection.');
const latestMetadata = copy(keeper), localMetadata = copy(keeper);
latestMetadata.name = 'Accepted new name'; latestMetadata.generalAvailabilityDate = '2027-03-01'; latestMetadata.roadmap.startMonth = '2027-03';
latestMetadata.specs[0].value = '100 hours'; latestMetadata.specs[0].ownerNote = 'Accepted supplier note';
latestMetadata.specs.push({ id: 'latest-only', label: 'Latest driver', value: '55 mm', sourceNote: 'Accepted new row context' });
latestMetadata.custom.owner = 'Accepted team'; latestMetadata.custom.accepted = true;
latestMetadata.ascm.records[0].procurement = 'Accepted procurement';
latestMetadata.variantGroups = copy(source.variantGroups); latestMetadata.partSkus = copy(source.partSkus);
localMetadata.categoryId = 'audio'; localMetadata.imageAssetId = 'source-image'; localMetadata.custom.owner = 'Local team'; localMetadata.custom.imported = 'Extra unsaved source detail';
localMetadata.specs[0].value = '90 hours'; localMetadata.specs[0].ownerNote = 'Local supplier note';
localMetadata.specs.push({ id: 'local-only', label: 'Local impedance', value: '32 ohms', sourceNote: 'Imported new row context' });
localMetadata.ascm.records[0].procurement = 'Local procurement'; localMetadata.ascm.records.push({ basePartNumber: 'HP-THREE', supplier: 'Unsaved ASCM import' });
localMetadata.variantGroups = copy(source.variantGroups); localMetadata.variantGroups[0].items[0].code = 'Changed local code'; localMetadata.variantGroups[0].items[0].imageAssetId = 'source-image';
localMetadata.variantGroups[0].items[0].sourceNote = 'Local variant note'; localMetadata.partSkus = copy(source.partSkus); localMetadata.partSkus[0].code = 'Changed local HP code'; localMetadata.partSkus[0].region = 'EMEA';
const beforeMetadata = JSON.stringify([latestMetadata, localMetadata]);
const metadataReview = model.supplementReview(latestMetadata, localMetadata);
assert.equal(metadataReview.product.name, 'Accepted new name'); assert.equal(metadataReview.product.generalAvailabilityDate, '2027-03-01'); assert.equal(metadataReview.product.roadmap.startMonth, '2027-03');
assert.equal(metadataReview.product.specs[0].value, '100 hours'); assert.equal(metadataReview.product.variantGroups[0].items[0].code, 'RD'); assert.equal(metadataReview.product.partSkus[0].code, 'HP-TWO', 'Canonical facts remain the latest facts until the separate granular facts review is applied.');
assert.ok(!('categoryId' in metadataReview.product), 'Intent restore placement is not injected into the full product record.');
assert.equal(metadataReview.product.custom.accepted, true); assert.equal(metadataReview.product.custom.imported, 'Extra unsaved source detail');
assert.equal(metadataReview.product.ascm.records.length, 2); assert.ok(metadataReview.product.specs.some((row) => row.id === 'latest-only')); assert.ok(metadataReview.product.specs.some((row) => row.id === 'local-only'));
assert.deepEqual(metadataReview.conflicts.map((entry) => entry.path).sort(), ['@metadata/ascm/records/HP-ONE/procurement', '@metadata/custom/owner', '@metadata/imageAssetId', '@metadata/partSkus/hp-row/region', '@metadata/specs/battery/ownerNote', '@metadata/variantGroups/colors/items/red/imageAssetId', '@metadata/variantGroups/colors/items/red/sourceNote'].sort());
assert.equal(metadataReview.conflicts.find((entry) => entry.path === '@metadata/imageAssetId').mineText, 'Image selected in your draft');
assert.equal(metadataReview.conflicts.find((entry) => entry.path === '@metadata/imageAssetId').masterImageId, 'keeper-image');
assert.throws(() => model.resolveSupplementReview(metadataReview, {}), /Choose which product details/, 'Every populated noncanonical disagreement requires an explicit choice.');
const ownMetadata = model.resolveSupplementReview(metadataReview, Object.fromEntries(metadataReview.conflicts.map((entry) => [client.conflictKey(entry.productId, entry.path), 'mine'])));
assert.equal(ownMetadata.custom.owner, 'Local team'); assert.equal(ownMetadata.specs[0].ownerNote, 'Local supplier note'); assert.equal(ownMetadata.imageAssetId, 'source-image');
assert.equal(ownMetadata.variantGroups[0].items[0].imageAssetId, 'source-image'); assert.equal(ownMetadata.partSkus[0].region, 'EMEA'); assert.equal(ownMetadata.ascm.records[0].procurement, 'Local procurement');
const acceptedMetadata = model.resolveSupplementReview(metadataReview, Object.fromEntries(metadataReview.conflicts.map((entry) => [entry.path, 'master'])));
assert.equal(acceptedMetadata.custom.owner, 'Accepted team'); assert.equal(acceptedMetadata.specs[0].ownerNote, 'Accepted supplier note'); assert.equal(acceptedMetadata.imageAssetId, 'keeper-image');
assert.equal(acceptedMetadata.specs[0].value, '100 hours'); assert.equal(acceptedMetadata.custom.imported, 'Extra unsaved source detail', 'Choosing latest competing metadata still preserves complementary unsaved information.');
assert.equal(JSON.stringify([latestMetadata, localMetadata]), beforeMetadata, 'Review planning and either choice leave both originals untouched.');
assert.throws(() => model.supplementReview(keeper, { ...keeper, custom: JSON.parse('{"__proto__":{"polluted":true}}') }), /unsupported property/);
const brokenReview = copy(metadataReview); brokenReview.conflicts[0].target = ['__proto__', 'bad'];
assert.throws(() => model.resolveSupplementReview(brokenReview, Object.fromEntries(brokenReview.conflicts.map((entry) => [entry.path, 'mine']))), /review is invalid/); assert.equal({}.polluted, undefined);
assert.throws(() => model.mergeChanges(initial, [{ ...enrichedRequest, sourceProduct: { ...reviewedSource, categoryId: 'another-portfolio' } }]), /different category/);
assert.throws(() => model.mergeChanges(initial, [{ ...enrichedRequest, sourceProduct: JSON.parse('{"id":"source","__proto__":{"polluted":true}}') }]), /unsupported property/);
assert.throws(() => model.mergeChanges(initial, [{ ...enrichedRequest, sourceProduct: { ...reviewedSource, notes: 'x'.repeat(1024 * 1024) } }]), /too large/);
const concurrentEnrichment = copy(initial); concurrentEnrichment.categories[0].board.products[1].custom.concurrent = 'Another team change';
assert.equal(model.mergeChanges(concurrentEnrichment, [enrichedRequest]).conflicts[0].path, '@merge', 'Supplemental records cannot bypass original full-record version fences.');
const hiddenOriginal = copy(initial); hiddenOriginal.categories[0].board.products[0].custom.privateApproval = 'Approved';
const hiddenBaseline = records(hiddenOriginal), incompleteKeeper = copy(keeper), conflictingSource = copy(source);
conflictingSource.custom.privateApproval = 'On hold';
const incompletePlan = merge.plan(incompleteKeeper, conflictingSource), incompleteChoices = choicesFor(incompletePlan);
const hiddenRequest = { ...request, keeperProduct: incompleteKeeper, sourceProduct: conflictingSource, choices: incompleteChoices,
  base: hiddenBaseline.find((row) => row.productId === 'keep'), sourceBase: hiddenBaseline.find((row) => row.productId === 'source'),
  baseProductVersion: hiddenBaseline.find((row) => row.productId === 'keep').productVersion, sourceBaseProductVersion: hiddenBaseline.find((row) => row.productId === 'source').productVersion,
  mine: model.values(merge.resolve(incompletePlan, incompleteChoices)) };
const hiddenConflict = model.mergeChanges(hiddenOriginal, [hiddenRequest]);
assert.equal(hiddenConflict.conflicts[0].path, '@merge'); assert.equal(hiddenConflict.conflicts[0].reason, 'additional-details-need-review');
assert.deepEqual(hiddenConflict.manifest, hiddenOriginal, 'A private disagreement absent from the browser review never receives an automatic winner.');

function harness({ localMerge = true, state = initial } = {}) {
  let manifest = copy(state), baseline = records(initial), products = copy(initial.categories[0].board.products).map((product) => ({ ...product, categoryId: 'audio' })), intents = [], calls = [], patches = [], duringSave;
  if (localMerge) {
    const planned = merge.plan(products[0], products[1]), choices = choicesFor(planned);
    intents = [{ productId: 'keep', sourceProductId: 'source', choices, keeperProduct: copy(products[0]), sourceProduct: copy(products[1]) }];
    products.splice(0, 2, merge.resolve(planned, choices));
  }
  const adapter = {
    getProducts: () => copy(products), getBaselineProducts: () => copy(baseline), setBaselineProducts: (value) => { baseline = copy(value); },
    getMergeIntents: () => copy(intents), setMergeIntents: (value) => { intents = copy(value); },
    applyPatches(updates) {
      patches.push(...copy(updates));
      for (const update of updates) {
        let index = products.findIndex((product) => product.id === update.productId);
        if (update.kind === 'merge') {
          const donor = products.find((product) => product.id === update.sourceProductId);
          if (index >= 0 && donor) products[index] = merge.resolve(merge.plan(products[index], donor), update.choices);
        } else if (update.kind === 'delete') { if (index >= 0) products.splice(index, 1); }
        else if (index >= 0) products[index] = model.applyProductValues(products[index], update.values);
        else products.push(model.applyProductValues({ id: update.productId, categoryId: update.categoryId, laneId: update.laneId }, update.values));
      }
    },
  };
  const session = client.createSession({ endpoint: 'https://share.example/api/master', adapter, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(copy(body));
    if (url.endsWith('/latest')) return Response.json({ snapshot: model.snapshot(manifest) });
    await duringSave?.();
    const result = model.mergeChanges(manifest, body.changes, { requestId: body.requestId });
    if (result.conflicts.length) return Response.json({ code: 'MASTER_CONFLICT', conflicts: result.conflicts, snapshot: model.snapshot(manifest) }, { status: 409 });
    manifest = result.manifest;
    return Response.json({ snapshot: model.snapshot(manifest), savedProducts: result.savedProducts, savedFields: result.savedFields });
  } });
  return { session, get products() { return products; }, get intents() { return intents; }, get baseline() { return baseline; }, get calls() { return calls; }, get patches() { return patches; },
    remoteMutate(fn) { fn(manifest); }, onSave(fn) { duringSave = fn; }, edit(patch) { Object.assign(products.find((product) => product.id === 'keep'), patch); } };
}
{
  const h = harness(); await h.session.connect('test-unlock');
  assert.equal(h.session.track().length, 1); assert.equal(h.session.track()[0].kind, 'merge');
  assert.equal(h.intents[0].sourceBase.productVersion, request.sourceBaseProductVersion);
  h.onSave(() => h.edit({ codename: 'Typed while saving' }));
  await h.session.save();
  const body = h.calls.find((call) => call.changes);
  assert.equal(body.changes.length, 1); assert.equal(body.changes[0].keeperProduct.id, 'keep'); assert.equal(body.changes[0].sourceProduct.id, 'source', 'Complete reviewed inputs preserve unsaved imported metadata while accepted original version fences remain authoritative.');
  assert.equal(h.intents.length, 0); assert.equal(h.products.find((product) => product.id === 'keep').codename, 'Typed while saving');
  assert.equal(h.session.track().length, 1, 'later typing remains an ordinary unsaved draft');
}
{
  const h = harness(); h.session.track(); const captured = copy(h.intents);
  h.remoteMutate((manifest) => { manifest.categories[0].board.products[1].custom.newTeamNote = 'A later change'; });
  await h.session.connect('test-unlock');
  assert.deepEqual(h.intents, captured, 'automatic refresh never moves the original merge fences');
  let asked = false;
  await assert.rejects(h.session.save({ resolveConflicts: () => { asked = true; return {}; } }), { code: 'MERGE_REVIEW_REQUIRED' });
  assert.equal(asked, false, 'stale full merges require another combined-product review rather than a destructive keep-mine shortcut');
  assert.equal(h.intents.length, 1); assert.equal(h.products.length, 2);
}
{
  const h = harness({ localMerge: false, state: accepted.manifest }); await h.session.connect('test-unlock');
  assert.equal(h.products.length, 2); assert(h.patches.some((patch) => patch.kind === 'merge'));
  assert.equal(h.products.find((product) => product.id === 'keep').variantGroups[0].items[0].imageAssetId, 'source-color', 'another clean tab transfers source images and custom row metadata from its local originals');
}
console.log('Atomic product merge checked: full private metadata and asset preservation, original-version and ABA fences, all-or-nothing save, accepted replay, new imports, private descriptors, in-flight drafts and remote merge refresh.');
