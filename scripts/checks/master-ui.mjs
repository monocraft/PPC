import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/master-model.js";
import "../../public/js/workspace-notifications.js";

const source = await readFile(new URL("../../public/js/master-ui.js", import.meta.url), "utf8");
const model = globalThis.PortfolioMasterModel;
const all = (node) => [node, ...(node.children || []).flatMap(all)];
const text = (node) => `${node.textContent || ""}${(node.children || []).map(text).join(" ")}`;
const byClass = (node, name) => all(node).filter((entry) => String(entry.className || "").split(" ").includes(name));
const byTag = (node, tag) => all(node).filter((entry) => entry.tagName === tag.toUpperCase());
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function createUi(initialPending, { configured = true, hasKey = true, publication = { status: "pending" }, acknowledgmentStorage = null, mode = "service", describeChanges = model.describeChanges } = {}) {
  const listeners = new Map(), notices = new Map(), calls = { saves: [], scopedSaves: [], connects: [], disconnects: 0, refreshes: 0, adoptions: 0, discards: [], undos: [], beforeSaves: 0, packageOpens: [] };
  const notificationEvents = [], messageStore = globalThis.PortfolioNotifications.createStore({ acknowledgmentStorage });
  const syncNotices = () => { notices.clear(); for (const item of messageStore.getState().items) notices.set(item.id, item); };
  messageStore.subscribe(event => { notificationEvents.push(event); syncNotices(); });
  const document = { activeElement: null, visibilityState: "visible", addEventListener() {} };
  document.createTextNode = textContent => ({ textContent, children: [] });
  document.createElement = (tag) => {
    const handlers = new Map(), attributes = new Map(), classes = new Set();
    const node = { tagName: tag.toUpperCase(), className: "", children: [], textContent: "", open: false, hidden: false, disabled: false, value: "", isConnected: true,
      classList: { add(...names) { for (const name of names) classes.add(name); }, toggle(name, force) { const include = force ?? !classes.has(name); if (include) classes.add(name); else classes.delete(name); } },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { attributes.set(name, String(value)); }, getAttribute: (name) => attributes.get(name),
      addEventListener(name, handler) { const list = handlers.get(name) || []; list.push(handler); handlers.set(name, list); },
      dispatchEvent(event) { for (const handler of handlers.get(event.type) || []) handler({ preventDefault() {}, stopImmediatePropagation() {}, ...event }); },
      querySelector(selector) { return all(this).slice(1).find((child) => selector === "[autofocus]" ? attributes.has("autofocus") : selector.split(",").some((tagName) => child.tagName === tagName.toUpperCase())); },
      focus() { document.activeElement = this; }, showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.isConnected = false; },
    };
    Object.defineProperty(node, "innerHTML", { set() { throw new Error("Review copy must stay plain text."); } });
    return node;
  };
  const button = document.createElement("button"); button.id = "pullLatestData";
  const saveButton = document.createElement("button"); saveButton.id = "saveSharedChanges";
  document.body = document.createElement("body"); document.body.append(saveButton, button);
  document.getElementById = (id) => all(document.body).find((node) => node.id === id);
  const state = { configured, hasKey, connected: false, pending: structuredClone(initialPending), snapshot: { publication } };
  let saveHandler = async () => { state.pending = []; return { saved: true, snapshot: state.snapshot }; };
  let scopedSaveHandler = async () => ({ status: "saved", saved: true, message: "Imported values shared." });
  let refreshHandler = async () => { state.connected = true; };
  let githubHandler = async () => ({ login: "test-user" });
  let discardedPending = [], discardFailure = false;
  const session = {
    getState: () => state, track: () => state.pending,
    async refresh() { calls.refreshes += 1; return refreshHandler(); },
    async connect(options) { calls.connects.push(options); state.hasKey = true; },
    async save(options) { calls.saves.push(options); return saveHandler(options); },
    async saveScoped(options) { calls.scopedSaves.push(options); return scopedSaveHandler(options); },
    disconnect() { calls.disconnects += 1; state.hasKey = false; },
    adoptLocalBaseline() { calls.adoptions += 1; state.connected = false; state.snapshot = null; },
    setGitHubToken: token => githubHandler(token),
  };
  const adapter = { getProducts() {}, canRefresh: () => true,
    beforeSave() { calls.beforeSaves += 1; assert.equal(document.getElementById("masterDialog").open, false, "finish temporary layout mode before showing the save review"); },
    async discardChanges(productIds) {
      calls.discards.push(productIds); if (discardFailure) throw new Error("Private implementation details should stay hidden");
      discardedPending = state.pending.filter((product) => productIds.includes(product.productId));
      state.pending = state.pending.filter((product) => !productIds.includes(product.productId));
      return { discarded: discardedPending.length, undoId: "undo-token" };
    },
    async undoDiscard(undoId) { calls.undos.push(undoId); state.pending.push(...discardedPending); discardedPending = []; return true; },
  };
  const sandbox = { document, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    PortfolioMasterClient: { createSession: () => session }, PortfolioMasterModel: { ...model, describeChanges },
    PortfolioPackageUI: { open: mode => calls.packageOpens.push(mode) },
    PortfolioProductMergeAdapter: { getImageSource: (id) => id === "local-image" ? "blob:local-preview" : id === "latest-image" ? "blob:latest-preview" : "" },
    PortfolioNotifications: { publish(notice) { const result = messageStore.publish(notice); syncNotices(); return result; }, resolve: messageStore.resolve, show() {} },
    addEventListener(name, handler) { listeners.set(name, handler); }, dispatchEvent() {}, setInterval: () => 1, clearInterval() {},
  };
  vm.createContext(sandbox); new vm.Script(source).runInContext(sandbox);
  const api = sandbox.PortfolioMasterUI.initialize({ source: { mode, team: mode === "service", owner: "fixture", repo: "fixture", endpoint: "https://private.example/api/master" }, adapter });
  const dialog = document.getElementById("masterDialog");
  return { api, publicApi: sandbox.PortfolioMasterUI, dialog, button, saveButton, document, adapter, calls, notices, state, listeners, messageStore, notificationEvents, setSave: (handler) => { saveHandler = handler; }, setGitHub: handler => { githubHandler = handler; }, setRefresh: (handler) => { refreshHandler = handler; }, setScopedSave: (handler) => { scopedSaveHandler = handler; }, failDiscard: () => { discardFailure = true; }, submit: () => byTag(dialog, "form")[0].dispatchEvent({ type: "submit" }) };
}

const base = model.productValues({ id: "p1", name: "Headset", specs: [{ id: "s1", label: "Weight", value: "200g" }, { id: "s2", label: "Notes", value: "Original" }], partSkus: [], variantGroups: [], roadmap: { startMonth: "2027-01", endMonth: "2028-01" } });
const mine = { ...structuredClone(base), ffsDate: "2027-01-10", specs: [{ id: "s1", label: "Weight", value: "220g" }, { id: "s2", label: "Notes", value: "More detail. ".repeat(100) }] };
const edited = { productId: "p1", productName: "Headset <svg onload=alert(1)>", base, mine, patch: model.diffValues(base, mine) };
const pending = [edited,
  { kind: "create", productId: "new", productName: "New keyboard", mine: base },
  { kind: "delete", productId: "old", productName: "Old mouse", base },
  { kind: "merge", productId: "merged", productName: "Completed headset", sourceProductName: "Imported headset", base, mine },
  ...Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(edited), productId: `extra-${index}`, productName: `Extra ${index}` })),
];
const ui = createUi(pending);
await flush();
assert.equal(ui.button.textContent, "Updates", "drafts never change the Updates action into a save");
assert.equal(ui.saveButton.textContent, "Save changes (8)");
assert.equal(ui.notices.has("master-publication"), false, "accepted changes pending follow-up do not show distracting publication messages");
assert.equal(typeof ui.publicApi.save, "function", "product actions can open the public save review");
const flow = ui.publicApi.save();
assert.equal(ui.calls.beforeSaves, 1, "API saves finish the reorder session before review");
assert.equal(ui.dialog.open, true);
assert.equal(byClass(ui.dialog, "master-product-changes").length, 8);
assert.ok(byClass(ui.dialog, "master-product-changes").every((item) => item.tagName === "DETAILS" && item.open === false), "each product starts as a keyboard-accessible collapsed disclosure");
assert.ok(byClass(ui.dialog, "master-discard-product").every((button) => button.type === "button"), "Discard buttons never accidentally submit the review");
assert.ok(byClass(ui.dialog, "master-product-changes").every((item) => byClass(item, "master-discard-product").length === 0), "Discard is a sibling control that does not toggle product details");
assert.match(text(byClass(ui.dialog, "master-review-overview")[0]), /8 products.*5 edited.*1 added.*1 removed.*1 merged/);
assert.match(text(byClass(ui.dialog, "master-product-summary")[0]), /Dates 1.*Specs 2/);
assert.match(text(byClass(ui.dialog, "master-product-summary")[3]), /Merge Imported headset into this product/);
assert.equal(byClass(ui.dialog, "master-change-row").length, 0, "large batches do not render thousands of hidden detail rows upfront");
const firstProduct = byClass(ui.dialog, "master-product-changes")[0]; firstProduct.open = true; firstProduct.dispatchEvent({ type: "toggle" });
assert.equal(byClass(firstProduct, "master-change-row").length, 3);
firstProduct.open = false; firstProduct.dispatchEvent({ type: "toggle" }); firstProduct.open = true; firstProduct.dispatchEvent({ type: "toggle" });
assert.equal(byClass(firstProduct, "master-change-row").length, 3, "reopening a product does not duplicate its details");
assert.equal(byClass(ui.dialog, "master-value-details")[0].open, false, "long values stay collapsed until requested");
assert.equal(byClass(ui.dialog, "master-full-value")[0].textContent, mine.specs[1].value, "the full long value is still available");
assert.equal(byClass(ui.dialog, "master-review-note")[0].open, false, "optional note does not add default scrolling");
assert.doesNotMatch(text(ui.dialog), /GitHub|master|Disconnect|private\.example|package key|storage/i, "normal review reveals no storage details or connection controls");
assert.match(text(ui.dialog), /Headset <svg onload=alert\(1\)>/, "product names render as literal text");
const search = byClass(ui.dialog, "master-review-search")[0];
search.value = "new keyboard"; search.dispatchEvent({ type: "input" });
assert.equal(byClass(ui.dialog, "master-product-card").filter((item) => !item.hidden).length, 1);
assert.match(text(byClass(ui.dialog, "master-review-matches")[0]), /1 of 8.*All 8 will be saved/);
search.value = "does not exist"; search.dispatchEvent({ type: "input" });
assert.match(text(byClass(ui.dialog, "master-review-matches")[0]), /0 of 8/);
search.value = ""; search.dispatchEvent({ type: "input" });
assert.equal(byClass(ui.dialog, "master-product-card").filter((item) => !item.hidden).length, 8);
byClass(ui.dialog, "master-reason")[0].value = "Revised factory schedule";
ui.submit(); await flow;
assert.equal(ui.calls.saves.length, 1);
assert.equal(ui.calls.saves[0].reason, "Revised factory schedule");
assert.equal(ui.notices.get("master-save-result").title, "Changes saved");
assert.doesNotMatch(ui.notices.get("master-save-result").message, /GitHub|master|package|private/i);
assert.equal(ui.calls.disconnects, 0);

const cancelled = createUi([edited]); await flush();
const cancelledFlow = cancelled.api.save();
assert.equal(byClass(cancelled.dialog, "master-review-search").length, 0, "small batches do not need extra controls");
byTag(cancelled.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" });
await cancelledFlow;
assert.equal(cancelled.calls.saves.length, 0); assert.equal(cancelled.state.pending.length, 1);
assert.equal(cancelled.calls.disconnects, 0, "keeping the draft never clears access");

for (const failurePoint of ["before-save", "review-details", "review-dialog"]) {
  let failDetails = failurePoint === "review-details";
  const prepared = createUi(Array.from({ length: 103 }, (_, index) => ({ ...structuredClone(edited), productId: `preparation-${index}`, productName: `Preparation ${index}` })), {
    describeChanges(...args) {
      if (failDetails) throw new Error("Private review failure at https://private.example/?key=secret");
      return model.describeChanges(...args);
    },
  });
  await flush();
  const before = structuredClone(prepared.state.pending), beforeSave = prepared.adapter.beforeSave, showModal = prepared.dialog.showModal;
  if (failurePoint === "before-save") prepared.adapter.beforeSave = () => { throw new Error("Private layout failure at https://private.example/?key=secret"); };
  if (failurePoint === "review-dialog") prepared.dialog.showModal = () => { throw new Error("Private dialog failure at https://private.example/?key=secret"); };
  await assert.doesNotReject(prepared.api.save(), `${failurePoint} is handled by the public save action`);
  assert.deepEqual(prepared.state.pending, before, `${failurePoint} keeps all 103 pending product drafts`);
  assert.equal(prepared.calls.saves.length, 0); assert.equal(prepared.calls.connects.length, 0);
  assert.equal(prepared.calls.discards.length, 0); assert.equal(prepared.calls.adoptions, 0); assert.equal(prepared.calls.disconnects, 0);
  assert.equal(prepared.dialog.open, false, "a failed review is closed and its resolver is retired");
  assert.equal(prepared.saveButton.textContent, "Save changes (103)");
  assert.equal(prepared.saveButton.disabled, false, "preparation failure never strands the save action in its busy state");
  const notice = prepared.notices.get("master-sync-error");
  assert.equal(notice.title, "Changes still need saving"); assert.equal(notice.dismissible, false);
  assert.match(notice.message, /Could not save.*changes are safe/);
  assert.doesNotMatch(notice.message, /private|secret|layout failure|review failure|dialog failure/i);
  assert.equal(notice.actions[0].label, "Review and try again");
  prepared.adapter.beforeSave = beforeSave; prepared.dialog.showModal = showModal; failDetails = false;
  const retryCancelled = notice.actions[0].onClick();
  assert.equal(prepared.dialog.open, true, "a preparation error leaves the next review usable");
  byTag(prepared.dialog, "button").find(button => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await retryCancelled;
  assert.deepEqual(prepared.state.pending, before); assert.equal(prepared.calls.saves.length, 0);
  assert.equal(prepared.notices.has("master-sync-error"), true, "cancelling a retry preserves the unsaved failure notice");
  const retrySaved = prepared.notices.get("master-sync-error").actions[0].onClick(); prepared.submit(); await retrySaved;
  assert.equal(prepared.calls.saves.length, 1); assert.equal(prepared.state.pending.length, 0);
  assert.equal(prepared.notices.has("master-sync-error"), false, "a later accepted save clears the preparation failure");
}

const failed = createUi([edited]); await flush();
failed.setSave(async () => { throw new Error("GitHub failed to publish public/data/master_ppc.pkg at https://private.example/?key=secret"); });
const failedFlow = failed.api.save(); failed.submit(); await failedFlow;
assert.match(failed.notices.get("master-sync-error").message, /Could not save.*changes are safe/);
assert.doesNotMatch(failed.notices.get("master-sync-error").message, /GitHub|master_ppc|private\.example|secret/);
assert.equal(failed.notices.get("master-sync-error").dismissible, false, "a rejected team save remains actionable and cannot be dismissed");
assert.equal(failed.messageStore.dismiss("master-sync-error"), false);
await failed.api.refresh();
assert.match(failed.notices.get("master-sync-error").message, /Could not save/, "successful background reads do not hide an unsaved write failure");
const retryCancelled = failed.api.save();
byTag(failed.dialog, "button").find(button => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await retryCancelled;
assert.equal(failed.notices.get("master-sync-error").dismissible, false, "cancelling a retry review does not clear the failed save");
failed.setSave(async () => { failed.state.pending = []; return { saved: true }; });
const retrySaved = failed.api.save(); failed.submit(); await retrySaved;
assert.equal(failed.notices.has("master-sync-error"), false, "the write failure resolves after an accepted save");

const staleMergeUi = createUi([pending[3]]); await flush();
staleMergeUi.setSave(async () => { const error = new Error("A private master merge changed"); error.code = "MERGE_REVIEW_REQUIRED"; throw error; });
const staleMergeFlow = staleMergeUi.api.save(); staleMergeUi.submit(); await staleMergeFlow;
assert.equal(staleMergeUi.notices.get("master-sync-error").message, "These products changed. Review the merge again. Your draft is safe.");

const conflictUi = createUi([edited]); await flush(); let finalChoices;
conflictUi.setSave(async ({ resolveConflicts }) => {
  finalChoices = await resolveConflicts([{ productName: "Headset", label: "Launch", key: "launch", mine: "2027-01-20", master: "2027-02-01" }, { productName: "Headset", label: "Notes", key: "notes", mine: "My notes", master: "Latest notes" }]);
  conflictUi.state.pending = []; return { saved: true, keptMaster: true };
});
const conflictFlow = conflictUi.api.save(); conflictUi.submit(); await flush();
assert.match(text(conflictUi.dialog), /Choose the final values/);
assert.doesNotMatch(text(conflictUi.dialog), /master|GitHub/i);
const conflicts = byClass(conflictUi.dialog, "master-conflict");
const conflictSubmit = byTag(conflictUi.dialog, "button").find((button) => button.type === "submit");
assert.equal(conflictSubmit.disabled, true);
byTag(conflicts[0], "input")[0].dispatchEvent({ type: "change" }); assert.equal(conflictSubmit.disabled, true);
byTag(conflicts[1], "input")[1].dispatchEvent({ type: "change" }); assert.equal(conflictSubmit.disabled, false);
conflictUi.submit(); await conflictFlow;
assert.equal(finalChoices.launch, "mine"); assert.equal(finalChoices.notes, "master", "clean copy preserves the actual conflict decisions");
assert.equal(conflictUi.notices.get("master-save-result").title, "Latest values kept");

const independentReview = createUi([edited]); await flush();
const reviewConflicts = [{ productName: "Headset", label: "FFS", key: "ffs", mine: "2027-01-10", master: "2027-02-01" }, { productName: "Headset", label: "Weight", key: "weight", mine: "220 g", master: "230 g" }];
const cancelledConflict = independentReview.publicApi.reviewConflicts(reviewConflicts);
assert.equal(independentReview.dialog.open, true);
assert.ok(byTag(independentReview.dialog, "input").every((radio) => radio.checked !== true && radio.required === true), "standalone conflict review never defaults to another team's value or a user's draft");
assert.equal(byTag(independentReview.dialog, "button").find((button) => button.type === "submit").disabled, true);
const refreshesBeforeReview = independentReview.calls.refreshes; await independentReview.publicApi.refresh();
assert.equal(independentReview.calls.refreshes, refreshesBeforeReview, "updates remain paused while the user chooses final values");
independentReview.dialog.dispatchEvent({ type: "cancel" });
assert.equal(await cancelledConflict, null, "cancelling standalone review does not choose values");
assert.equal(independentReview.calls.saves.length, 0);
const chosenConflict = independentReview.publicApi.reviewConflicts(reviewConflicts);
const standaloneGroups = byClass(independentReview.dialog, "master-conflict");
byTag(standaloneGroups[0], "input")[1].dispatchEvent({ type: "change" });
assert.equal(byTag(independentReview.dialog, "button").find((button) => button.type === "submit").disabled, true);
byTag(standaloneGroups[1], "input")[0].dispatchEvent({ type: "change" }); independentReview.submit();
const decisions = await chosenConflict;
assert.equal(decisions.ffs, "master"); assert.equal(decisions.weight, "mine");
assert.equal(independentReview.calls.saves.length, 0, "standalone review returns explicit choices without saving or changing the draft");
independentReview.state.busy = true;
assert.equal(independentReview.publicApi.reviewConflicts(reviewConflicts), null);
assert.equal(independentReview.dialog.open, false, "a busy session cannot open a competing conflict review");
independentReview.state.busy = false;
assert.equal(independentReview.publicApi.reviewConflicts([]), null);

const imageChoices = independentReview.publicApi.reviewConflicts([{ productName: "Headset", label: "Product image", key: "image", mine: "local-image", master: "latest-image", mineImageId: "local-image", masterImageId: "latest-image" }]);
assert.deepEqual(byClass(independentReview.dialog, "master-choice-image").map((image) => image.src), ["blob:local-preview", "blob:latest-preview"]);
assert.deepEqual(byClass(independentReview.dialog, "master-choice-image").map((image) => image.alt), ["Use my change image", "Keep latest value image"]);
assert.doesNotMatch(text(independentReview.dialog), /local-image|latest-image/, "image choices show previews instead of opaque asset IDs");
independentReview.dialog.dispatchEvent({ type: "cancel" }); assert.equal(await imageChoices, null);

const savingReview = createUi([edited]); await flush(); let finishSaving;
savingReview.setSave(() => new Promise((resolve) => { finishSaving = resolve; }));
const savingReviewFlow = savingReview.api.save(); savingReview.submit(); await flush();
assert.equal(savingReview.publicApi.reviewConflicts(reviewConflicts), null);
assert.match(text(savingReview.dialog), /Saving changes/, "a standalone conflict review cannot replace an active save progress dialog");
await savingReview.api.save();
assert.equal(savingReview.calls.beforeSaves, 1, "a busy save does not restart the layout settlement hook");
finishSaving({ saved: true }); await savingReviewFlow;

const unavailable = createUi([edited], { configured: false, publication: { status: "error" } });
const unavailableFlow = unavailable.api.save();
assert.equal(byTag(unavailable.dialog, "button").find((button) => button.type === "submit").disabled, true);
assert.doesNotMatch(text(unavailable.dialog), /master|GitHub|private/i);
assert.match(unavailable.notices.get("master-publication").message, /saved changes are available to the team/);
byTag(unavailable.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await unavailableFlow;

const acknowledgmentBytes = new Map();
const acknowledgmentStorage = { getItem: key => acknowledgmentBytes.get(key) || null, setItem: (key, value) => acknowledgmentBytes.set(key, value), removeItem: key => acknowledgmentBytes.delete(key) };
const publicationFailure = { status: "error", requestedRevision: 15, publishedRevision: 14 };
const delayed = createUi([], { publication: publicationFailure, acknowledgmentStorage }); await flush();
const publicationEvents = ui => ui.notificationEvents.filter(event => event.type === "publish" && event.item.id === "master-publication");
assert.equal(publicationEvents(delayed).length, 1);
assert.equal(publicationEvents(delayed)[0].toast, false, "the follow-up publisher does not interrupt work with a toast");
assert.equal(delayed.messageStore.dismiss("master-publication"), true);
assert.equal(acknowledgmentBytes.size, 1);
assert.ok([...acknowledgmentBytes.values()].every(value => !/productId|token|private\.example|secret/i.test(value)), "the isolated preference contains no product data or access credentials");
assert.equal(delayed.messageStore.getState().attentionCount, 0);
assert.equal(delayed.notices.get("master-publication").acknowledged, true, "a quiet status remains available after acknowledgment");
assert.equal(delayed.notices.get("master-publication").actions[0].label, "Check status");
assert.match(delayed.button.title, /saved changes.*team.*downloadable copy/i);
for (let attempt = 0; attempt < 5; attempt++) {
  delayed.state.snapshot.publication = { status: "pending", requestedRevision: 16, publishedRevision: 14 }; delayed.api.updateStatus();
  delayed.state.snapshot.publication = { ...publicationFailure, requestedRevision: 16 }; await delayed.api.refresh();
  delayed.api.updateStatus();
}
assert.equal(publicationEvents(delayed).length, 1, "pending/error background retry cycles do not reset the same acknowledged warning");
const beforeStatusCheck = delayed.calls.refreshes; await delayed.notices.get("master-publication").actions[0].onClick();
assert.equal(delayed.calls.refreshes, beforeStatusCheck + 1, "checking status reads the shared state without saving again");
assert.equal(delayed.calls.saves.length, 0);
const reopenedDelayed = createUi([], { publication: publicationFailure, acknowledgmentStorage }); await flush();
assert.equal(reopenedDelayed.notices.get("master-publication").acknowledged, true, "the same acknowledgment survives a page reload");
assert.equal(publicationEvents(reopenedDelayed)[0].announce, false);
assert.equal(reopenedDelayed.messageStore.getState().attentionCount, 0);
reopenedDelayed.state.snapshot = null; reopenedDelayed.api.updateStatus();
reopenedDelayed.state.snapshot = { publication: publicationFailure }; reopenedDelayed.api.updateStatus();
assert.equal(reopenedDelayed.notices.get("master-publication").acknowledged, true, "temporary package snapshot absence does not count as publisher recovery");
reopenedDelayed.state.snapshot.publication = { status: "current", requestedRevision: 16, publishedRevision: 16 }; reopenedDelayed.api.updateStatus();
assert.equal(reopenedDelayed.notices.has("master-publication"), false);
assert.equal(acknowledgmentBytes.size, 0, "confirmed recovery retires its durable acknowledgment");
reopenedDelayed.state.snapshot.publication = { ...publicationFailure, requestedRevision: 17 }; reopenedDelayed.api.updateStatus();
assert.equal(reopenedDelayed.notices.get("master-publication").acknowledged, false, "a failure after a confirmed recovery is a new meaningful warning");
assert.equal(reopenedDelayed.messageStore.getState().attentionCount, 1);

const discardCancelled = createUi([edited, pending[1]]); await flush();
const discardCancelledFlow = discardCancelled.api.save();
byClass(discardCancelled.dialog, "master-discard-product")[0].dispatchEvent({ type: "click" }); await flush();
assert.match(text(discardCancelled.dialog), /Discard changes\?.*Headset.*Edits will be reverted/);
byTag(discardCancelled.dialog, "button").find((button) => button.textContent === "Keep changes").dispatchEvent({ type: "click" }); await flush();
assert.equal(discardCancelled.calls.discards.length, 0); assert.equal(discardCancelled.state.pending.length, 2);
assert.match(text(discardCancelled.dialog), /Review changes/, "cancelling discard returns to a fresh review");
byTag(discardCancelled.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await discardCancelledFlow;

const discardOne = createUi([edited, pending[1]]); await flush();
const discardOneFlow = discardOne.api.save();
byClass(discardOne.dialog, "master-discard-product")[0].dispatchEvent({ type: "click" }); await flush(); discardOne.submit(); await flush();
assert.deepEqual(Array.from(discardOne.calls.discards[0]), ["p1"]);
assert.equal(discardOne.state.pending.length, 1);
assert.equal(byClass(discardOne.dialog, "master-product-changes").length, 1, "review refreshes after discarding one product");
assert.match(text(discardOne.dialog), /New keyboard/);
byTag(discardOne.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await discardOneFlow;
await discardOne.notices.get("master-discard-result").actions[0].onClick();
assert.equal(discardOne.state.pending.length, 2); assert.equal(discardOne.calls.undos[0], "undo-token");
assert.equal(discardOne.calls.saves.length, 0, "discard and Undo never submit edits");

const discardAll = createUi(pending); await flush();
const discardAllFlow = discardAll.api.save();
const discardSearch = byClass(discardAll.dialog, "master-review-search")[0]; discardSearch.value = "new keyboard"; discardSearch.dispatchEvent({ type: "input" });
byClass(discardAll.dialog, "master-discard-all")[0].dispatchEvent({ type: "click" }); await flush();
assert.match(text(discardAll.dialog), /And 2 more products/);
discardAll.submit(); await flush(); await discardAllFlow;
assert.equal(discardAll.calls.discards[0].length, 8, "Discard all targets the entire batch even while search shows one product");
assert.equal(discardAll.state.pending.length, 0); assert.equal(discardAll.dialog.open, false);
assert.equal(discardAll.calls.disconnects, 0);

const discardFailed = createUi([edited]); await flush(); discardFailed.failDiscard();
const discardFailedFlow = discardFailed.api.save();
byClass(discardFailed.dialog, "master-discard-product")[0].dispatchEvent({ type: "click" }); await flush(); discardFailed.submit(); await flush();
assert.equal(discardFailed.state.pending.length, 1);
assert.doesNotMatch(discardFailed.notices.get("master-discard-result").message, /Private implementation/);
assert.match(text(discardFailed.dialog), /Review changes/);
byTag(discardFailed.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await discardFailedFlow;
const automatic = createUi([edited]); await flush();
const automaticOptions = { reason: "Biweekly PLC import", patches: [{ productId: "p1", patch: { ffsDate: mine.ffsDate, plc: { version: 1, importedAt: "2026-10-09T16:00:00.000Z" } } }] };
assert.equal(typeof automatic.publicApi.saveScoped, "function");
assert.equal((await automatic.publicApi.saveScoped(automaticOptions)).status, "saved");
assert.deepEqual(automatic.calls.scopedSaves[0], automaticOptions);
assert.equal(automatic.dialog.open, false); assert.equal(automatic.calls.saves.length, 0); assert.equal(automatic.calls.beforeSaves, 0, "automatic source sharing never starts the general manual-draft save flow");
assert.equal(automatic.state.pending.length, 1);
automatic.setScopedSave(async () => ({ status: "pending", saved: false, code: "MASTER_CONFLICT", message: "Private endpoint https://private.example/ changed" }));
assert.equal((await automatic.publicApi.saveScoped(automaticOptions)).status, "pending");
assert.equal(automatic.dialog.open, false, "conflicts stay available for later review without interrupting an Excel drop");
assert.ok(automatic.notices.has("plc-master-sharing")); assert.doesNotMatch(automatic.notices.get("plc-master-sharing").message, /private|endpoint/);
automatic.setScopedSave(async () => ({ status: "saved", saved: true }));
await automatic.publicApi.saveScoped(automaticOptions); assert.equal(automatic.notices.has("plc-master-sharing"), false);
const manualReview = automatic.api.save(); assert.equal(automatic.dialog.open, true);
const scopedBeforeReview = automatic.calls.scopedSaves.length;
assert.equal((await automatic.publicApi.saveScoped(automaticOptions)).status, "pending");
assert.equal(automatic.calls.scopedSaves.length, scopedBeforeReview, "an automatic update cannot compete with a user's open manual review");
byTag(automatic.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await manualReview;
automatic.setScopedSave(async () => ({ status: "local", saved: false, code: "SHARING_ACCESS_REQUIRED" }));
assert.equal((await automatic.publicApi.saveScoped(automaticOptions)).status, "local");
assert.equal(automatic.dialog.open, false); assert.equal(automatic.calls.connects.length, 0, "missing access leaves collected data local without a credential prompt");
const updatesUi = createUi([edited], { hasKey: false });
updatesUi.button.dispatchEvent({ type: "click" });
const updatesPanel = updatesUi.document.getElementById("portfolioUpdatesDialog");
assert.equal(updatesPanel.open, true); assert.equal(updatesUi.calls.saves.length, 0); assert.equal(updatesUi.calls.refreshes, 0);
assert.equal(updatesUi.button.textContent, "Updates"); assert.equal(updatesUi.saveButton.textContent, "Save changes (1)");
assert.match(text(updatesPanel), /Team records.*Complete portfolio package/);
assert.equal(byTag(updatesPanel, "button").find(b=>b.textContent==="Open complete package").disabled, true, "a full replacement is blocked while shared drafts exist");
updatesUi.state.hasKey = true; updatesUi.state.pending = [];
updatesUi.adapter.getLoadedPackageInfo = () => ({ version: 1, gitBlobSha: "a".repeat(40), loadedAt: "2026-10-15T02:00:00.000Z" });
updatesUi.state.snapshot.publication = { status: "current", githubSha: "a".repeat(40) };
updatesUi.api.updateStatus();
assert.match(text(updatesPanel), /Check team updates to compare/, "old publication metadata alone never proves a fresh comparison");
let releaseCheck;
updatesUi.setRefresh(() => new Promise(resolve => { releaseCheck = resolve; }));
updatesUi.document.getElementById("checkTeamUpdates").dispatchEvent({ type: "click" });
assert.match(text(updatesPanel), /Checking team updates/); assert.equal(updatesUi.document.getElementById("checkTeamUpdates").disabled, true);
assert.equal(byTag(updatesPanel, "button").find(b=>b.textContent==="Open complete package").disabled, true, "package replacement cannot compete with a running check");
releaseCheck(); await flush();
assert.match(text(updatesPanel), /Last checked/); assert.match(text(updatesPanel), /matches the published copy at the last check/);
updatesUi.state.snapshot.publication.githubSha = "b".repeat(40); updatesUi.api.updateStatus();
assert.match(text(updatesPanel), /matches the published copy at the last check/, "unverified later metadata cannot rewrite the last successful check's package proof");
updatesUi.setRefresh(async () => undefined);
updatesUi.document.getElementById("checkTeamUpdates").dispatchEvent({ type: "click" }); await flush();
assert.match(text(updatesPanel), /different published package/, "a changed package SHA detects image-only publication at the same record revision");
updatesUi.adapter.getLoadedPackageInfo = () => null; updatesUi.api.updateStatus();
assert.match(text(updatesPanel), /Package comparison unavailable/);
updatesUi.setRefresh(async () => { throw new Error("Private source details"); });
updatesUi.document.getElementById("checkTeamUpdates").dispatchEvent({ type: "click" }); await flush();
assert.match(text(updatesPanel), /Could not check team updates/); assert.match(text(updatesPanel), /Last successful check/); assert.match(text(updatesPanel), /Retry check/);
assert.doesNotMatch(text(updatesPanel), /Private source details/);
const checksBeforeBusy = updatesUi.calls.refreshes; updatesUi.adapter.canRefresh = () => false;
updatesUi.document.getElementById("checkTeamUpdates").dispatchEvent({ type: "click" }); await flush();
assert.equal(updatesUi.calls.refreshes, checksBeforeBusy); assert.match(text(updatesPanel), /Finish the current edit or update/);
updatesUi.adapter.canRefresh = () => true; updatesUi.setRefresh(async () => null);
updatesUi.document.getElementById("checkTeamUpdates").dispatchEvent({ type: "click" }); await flush();
assert.match(text(updatesPanel), /Could not check team updates/, "a skipped client refresh is never reported as a successful check");
const adoptedUi = createUi([edited]); await flush();
assert.ok(adoptedUi.api.getSummary().lastCheckedAt > 0);
adoptedUi.setRefresh(async () => { throw new Error("Old copy check failed"); });
await adoptedUi.api.refresh(); assert.equal(adoptedUi.api.getSummary().error, true);
const refreshesBeforeAdoption = adoptedUi.calls.refreshes;
adoptedUi.publicApi.adoptLocalBaseline();
assert.equal(adoptedUi.calls.adoptions, 1); assert.equal(adoptedUi.calls.refreshes, refreshesBeforeAdoption, "local adoption never starts a quiet refresh");
assert.equal(adoptedUi.calls.disconnects, 0); assert.equal(adoptedUi.state.hasKey, true);
assert.equal(adoptedUi.api.getSummary().lastCheckedAt, 0); assert.equal(adoptedUi.api.getSummary().error, false);
assert.equal(adoptedUi.api.getSummary().publicationStatus, ""); assert.equal(adoptedUi.api.getSummary().pendingCount, 1);
assert.equal(adoptedUi.notices.has("master-sync-error"), false); assert.equal(adoptedUi.notices.has("master-save-result"), false);
for (const staleCheck of ["success", "failure"]) {
  let finishCheck, rejectCheck;
  adoptedUi.setRefresh(() => new Promise((resolve, reject) => { finishCheck = resolve; rejectCheck = reject; }));
  const checking = adoptedUi.api.refresh();
  adoptedUi.publicApi.adoptLocalBaseline();
  if (staleCheck === "success") finishCheck(); else rejectCheck(new Error("Obsolete check failed"));
  assert.equal((await checking).status, "superseded");
  assert.equal(adoptedUi.api.getSummary().lastCheckedAt, 0, "a held check cannot certify the replacement copy");
  assert.equal(adoptedUi.api.getSummary().error, false, "an obsolete failure cannot resurrect an old copy's error");
  assert.equal(adoptedUi.api.getSummary().busy, false); assert.equal(adoptedUi.state.hasKey, true);
}
for (const operation of ["save", "scoped", "github-profile", "github-refresh"]) {
  for (const outcome of ["success", "failure"]) {
    const oldUi = createUi([edited], { mode: operation.startsWith("github") ? "github" : "service" }); await flush();
    let finish, fail;
    const held = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    let oldOperation;
    if (operation === "save") { oldUi.setSave(() => held); oldOperation = oldUi.api.save(); oldUi.submit(); await flush(); assert.equal(oldUi.calls.saves.length, 1); }
    else if (operation === "scoped") { oldUi.setScopedSave(() => held); oldOperation = oldUi.publicApi.saveScoped({}); }
    else {
      if (operation === "github-profile") oldUi.setGitHub(() => held); else oldUi.setRefresh(() => held);
      oldOperation = oldUi.publicApi.connectGitHub(); byClass(oldUi.dialog, "master-key")[0].value = "synthetic-memory-token"; oldUi.submit(); await flush();
    }
    const callsBeforeAdoption = oldUi.calls.refreshes;
    oldUi.publicApi.adoptLocalBaseline();
    if (outcome === "failure") fail(Object.assign(new Error("Obsolete request failed"), { code: "INVALID_KEY" }));
    else finish(operation.startsWith("github") ? { login: "old-profile" } : { saved: true, status: "pending" });
    await oldOperation;
    assert.equal(oldUi.calls.refreshes, callsBeforeAdoption, `${operation} cannot start another fetch after local adoption`);
    for (const id of ["master-sync-error", "master-save-result", "master-github-connected", "plc-master-sharing"]) assert.equal(oldUi.notices.has(id), false, `${operation}/${outcome} cannot republish a notice belonging to an old copy`);
    assert.equal(oldUi.api.getSummary().error, false); assert.equal(oldUi.api.getSummary().busy, false); assert.equal(oldUi.state.hasKey, true);
  }
}
console.log("Master UI checks passed: explicit Updates/Save controls, checked/error/busy/unknown package states and exact package identity, protected drafts, accessible save/conflict/discard decisions, publisher/scoped-sharing protections, and local-baseline adoption without fetching or stale check/save/scoped/GitHub results.");
