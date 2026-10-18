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
  let now = 1700000000000, timerId = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    count: () => timers.size,
    async advance(milliseconds) {
      const until = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(id);
        timer.callback(); await flush();
      }
      now = until; await flush();
    },
  };
  const schedule = (callback, delay, interval) => { const id = ++timerId; timers.set(id, { callback, at: now + delay, interval }); return id; };
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
      getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 400 }),
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
  let connectHandler = async () => { state.hasKey = true; };
  let githubHandler = async () => ({ login: "test-user" });
  let discardedPending = [], discardFailure = false;
  const session = {
    getState: () => state, track: () => state.pending,
    async refresh() { calls.refreshes += 1; return refreshHandler(); },
    async connect(options) { calls.connects.push(options); return connectHandler(options); },
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
    addEventListener(name, handler) { listeners.set(name, handler); }, dispatchEvent() {},
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setInterval: (callback, delay) => schedule(callback, delay, delay), clearInterval: id => timers.delete(id),
    setTimeout: (callback, delay) => schedule(callback, delay, 0), clearTimeout: id => timers.delete(id),
  };
  vm.createContext(sandbox); new vm.Script(source).runInContext(sandbox);
  const api = sandbox.PortfolioMasterUI.initialize({ source: { mode, team: mode === "service", owner: "fixture", repo: "fixture", endpoint: "https://private.example/api/master" }, adapter });
  const dialog = document.getElementById("masterDialog");
  return { api, publicApi: sandbox.PortfolioMasterUI, dialog, button, saveButton, document, adapter, calls, notices, state, listeners, messageStore, notificationEvents, clock, setSave: (handler) => { saveHandler = handler; }, setGitHub: handler => { githubHandler = handler; }, setRefresh: (handler) => { refreshHandler = handler; }, setConnect: (handler) => { connectHandler = handler; }, setScopedSave: (handler) => { scopedSaveHandler = handler; }, failDiscard: () => { discardFailure = true; }, submit: () => byTag(dialog, "form")[0].dispatchEvent({ type: "submit" }) };
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

const unsupportedPlacement = createUi([edited]); await flush();
unsupportedPlacement.setSave(async () => { throw Object.assign(new Error("Private placement service details"), { code: "PLACEMENT_UNAVAILABLE" }); });
const unsupportedPlacementFlow = unsupportedPlacement.api.save(); unsupportedPlacement.submit(); await unsupportedPlacementFlow;
assert.match(unsupportedPlacement.notices.get("master-sync-error").message, /positions.*saved on this device.*service update/i, "A known unsupported service explains the actual dependency instead of promising a retry will save positions.");
assert.doesNotMatch(unsupportedPlacement.notices.get("master-sync-error").message, /try saving again|Private placement/i);
assert.equal(unsupportedPlacement.state.pending.length, 1, "Capability feedback preserves the genuine pending edit.");

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
assert.equal(savingReview.clock.count(), 1, "completion removes the visible progress timer and keeps only the existing refresh interval");
assert.equal(savingReview.dialog.open, false);

async function heldProgress() {
  const review = createUi([edited]); await flush();
  let finish, fail;
  const held = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  review.setSave(async () => { review.state.busy = true; try { return await held; } finally { review.state.busy = false; } });
  const operation = review.api.save(); review.submit(); await flush();
  return { review, operation, finish, fail };
}
const keepWorking = review => byTag(review.dialog, "button").find(button => button.textContent === "Keep working");
const closeProgress = review => byTag(review.dialog, "button").find(button => button.getAttribute("aria-label") === "Close save progress");

for (const dismissal of ["keep-working", "close", "escape", "outside"]) {
  const { review, operation, finish } = await heldProgress();
  const drafts = structuredClone(review.state.pending), refreshes = review.calls.refreshes;
  assert.equal(review.dialog.open, true); assert.equal(review.clock.count(), 2, "visible progress adds one bounded elapsed-time timer beside the existing refresh timer");
  assert.equal(byClass(review.dialog, "master-progress-title").length, 1);
  assert.equal(byClass(review.dialog, "master-progress-detail").length, 1);
  assert.equal(byClass(review.dialog, "master-progress-elapsed").length, 1);
  assert.ok(keepWorking(review)); assert.ok(closeProgress(review), "save progress has an explicitly named close control");
  await review.clock.advance(9000);
  const beforeWait = text(byClass(review.dialog, "master-progress-detail")[0]);
  await review.clock.advance(1000);
  const afterWait = text(byClass(review.dialog, "master-progress-detail")[0]);
  assert.notEqual(afterWait, beforeWait, "a longer wait changes the explanatory copy at ten seconds");
  assert.match(afterWait, /wait|respond|longer|still|working|confirm/i);
  assert.doesNotMatch(text(review.dialog), /\d+\s*%/, "an indeterminate save never fabricates a completion percentage");
  assert.match(text(byClass(review.dialog, "master-progress-elapsed")[0]), /10/);
  if (dismissal === "keep-working") keepWorking(review).dispatchEvent({ type: "click" });
  else if (dismissal === "close") closeProgress(review).dispatchEvent({ type: "click" });
  else if (dismissal === "escape") review.dialog.dispatchEvent({ type: "cancel" });
  else review.dialog.dispatchEvent({ type: "click", target: review.dialog, clientX: 0, clientY: 0 });
  assert.equal(review.dialog.open, false, `${dismissal} dismisses the progress presentation`);
  assert.equal(review.clock.count(), 1, "hidden progress stops its own timer rather than polling off screen");
  assert.equal(review.api.getSummary().busy, true); assert.equal(review.state.busy, true);
  assert.deepEqual(review.state.pending, drafts); assert.equal(review.state.hasKey, true); assert.equal(review.calls.disconnects, 0);
  assert.equal(review.document.activeElement, review.saveButton, "dismissal returns keyboard focus to the persistent save status action");
  assert.equal(review.saveButton.disabled, false, "an ongoing save can be inspected again from the header");
  await review.api.refresh();
  assert.equal(review.calls.refreshes, refreshes, "hiding progress does not permit a competing refresh");
  assert.equal((await review.publicApi.saveScoped({ patches: [] })).code, "MASTER_BUSY");
  assert.equal(review.calls.scopedSaves.length, 0);
  assert.equal(review.publicApi.reviewConflicts(reviewConflicts), null, "an independent conflict chooser cannot replace the current save");
  await review.clock.advance(5000);
  review.saveButton.dispatchEvent({ type: "click" }); await flush();
  assert.equal(review.dialog.open, true); assert.equal(review.clock.count(), 2);
  assert.match(text(byClass(review.dialog, "master-progress-elapsed")[0]), /15/, "reopening retains the operation's original start time");
  assert.equal(review.calls.beforeSaves, 1); assert.equal(review.calls.saves.length, 1); assert.equal(review.calls.connects.length, 0);
  await review.api.save();
  assert.equal(review.calls.beforeSaves, 1); assert.equal(review.calls.saves.length, 1, "API and header reopens never submit another save");
  keepWorking(review).dispatchEvent({ type: "click" }); review.state.pending = [];
  const ongoingEdit = review.document.createElement("input"); ongoingEdit.focus();
  finish({ saved: true }); await operation;
  assert.equal(review.dialog.open, false, "a hidden save completes without reopening a modal");
  assert.equal(review.document.activeElement, ongoingEdit, "background completion leaves the user's current edit focus alone");
  assert.equal(review.clock.count(), 1); assert.equal(review.api.getSummary().busy, false);
  assert.equal(review.notices.get("master-save-result").title, "Changes saved"); assert.equal(review.saveButton.hidden, true);
}

for (const outcome of ["success", "failure"]) {
  const { review, operation, finish, fail } = await heldProgress();
  assert.equal(review.dialog.open, true);
  if (outcome === "success") { review.state.pending = []; finish({ saved: true }); }
  else fail(new Error("The visible request failed"));
  await operation;
  assert.equal(review.dialog.open, false); assert.equal(review.clock.count(), 1); assert.equal(review.api.getSummary().busy, false);
  assert.equal(review.document.activeElement, outcome === "success" ? review.button : review.saveButton,
    "visible completion restores focus to Updates when clean, or the actionable Save control when drafts remain");
  assert.equal(review.document.activeElement.disabled, false); assert.equal(review.document.activeElement.hidden, false);
}

{
  const { review, operation, fail } = await heldProgress();
  keepWorking(review).dispatchEvent({ type: "click" });
  fail(new Error("Private backend detail at https://private.example/?key=secret")); await operation;
  assert.equal(review.dialog.open, false); assert.equal(review.clock.count(), 1); assert.equal(review.api.getSummary().busy, false);
  assert.equal(review.state.pending.length, 1); assert.equal(review.state.hasKey, true);
  assert.equal(review.saveButton.textContent, "Save changes (1)"); assert.equal(review.saveButton.disabled, false);
  assert.equal(review.notices.get("master-sync-error").title, "Changes still need saving");
  assert.doesNotMatch(review.notices.get("master-sync-error").message, /private|secret|backend/i);
}

{
  const { review, operation, finish } = await heldProgress();
  keepWorking(review).dispatchEvent({ type: "click" });
  review.state.pending = [{ ...structuredClone(edited), productId: "later-draft", productName: "Edited after submission" }];
  finish({ saved: true }); await operation;
  assert.equal(review.state.pending[0].productId, "later-draft");
  assert.equal(review.saveButton.textContent, "Save changes (1)"); assert.equal(review.saveButton.hidden, false); assert.equal(review.saveButton.disabled, false);
  assert.equal(review.notices.get("master-save-result").title, "Changes saved");
  assert.match(review.notices.get("master-pending").message, /1 product.*unsaved/, "accepted earlier changes do not hide newer pending work");
}

{
  const review = createUi([edited]); await flush(); let releaseConflict, choices;
  const held = new Promise(resolve => { releaseConflict = resolve; });
  review.setSave(async ({ resolveConflicts }) => {
    review.state.busy = true;
    try { await held; choices = await resolveConflicts(reviewConflicts); return { saved: false, cancelled: true }; }
    finally { review.state.busy = false; }
  });
  const operation = review.api.save(); review.submit(); await flush(); keepWorking(review).dispatchEvent({ type: "click" });
  releaseConflict(); await flush();
  assert.equal(review.dialog.open, true); assert.match(text(review.dialog), /Choose the final values/);
  assert.equal(review.clock.count(), 1, "a conflict chooser does not retain the progress repaint timer");
  assert.ok(byTag(review.dialog, "input").every(radio => radio.checked !== true && radio.required === true));
  assert.equal(byTag(review.dialog, "button").find(button => button.type === "submit").disabled, true);
  review.saveButton.dispatchEvent({ type: "click" }); await review.api.save();
  assert.match(text(review.dialog), /Choose the final values/, "progress reopening never replaces a required conflict decision");
  assert.equal(review.clock.count(), 1); assert.equal(review.calls.saves.length, 1); assert.equal(review.calls.beforeSaves, 1);
  review.dialog.dispatchEvent({ type: "cancel" }); await operation;
  assert.equal(choices, null); assert.equal(review.state.pending.length, 1); assert.equal(review.notices.has("master-save-result"), false);
  assert.equal(review.clock.count(), 1); assert.equal(review.api.getSummary().busy, false);
}

for (const replacement of ["adopt", "disconnect", "destroy"]) {
  for (const outcome of ["success", "failure"]) {
    const { review, operation, finish, fail } = await heldProgress();
    if (replacement === "adopt") review.publicApi.adoptLocalBaseline();
    else if (replacement === "disconnect") review.publicApi.disconnect();
    else review.api.destroy();
    assert.equal(review.dialog.open, false, `${replacement} retires the obsolete progress view immediately`);
    assert.equal(review.clock.count(), replacement === "destroy" ? 0 : 1, `${replacement} retires its progress timer`);
    if (outcome === "failure") fail(new Error("An obsolete request failed")); else finish({ saved: true });
    await operation; await review.clock.advance(11000);
    assert.equal(review.dialog.open, false);
    assert.equal(review.clock.count(), replacement === "destroy" ? 0 : 1);
    assert.equal(review.notices.has("master-save-result"), false, `${replacement}/${outcome} cannot announce an obsolete save`);
    assert.equal(review.notices.has("master-sync-error"), false, `${replacement}/${outcome} cannot restore an obsolete error`);
    assert.equal(review.calls.saves.length, 1);
  }
}

const reviewedMerge = {
  ...structuredClone(pending[3]), sourceProductId: "source", categoryId: "audio", laneId: "wireless", sourceCategoryId: "legacy-audio", sourceLaneId: "wired",
  base: { values: structuredClone(base), productVersion: "keeper-v1" }, sourceBase: { values: structuredClone(base), productVersion: "source-v1" },
  baseProductVersion: "keeper-v1", sourceBaseProductVersion: "source-v1", choices: { name: "mine" },
  keeperProduct: { id: "merged", name: "Keeper", specs: [] }, sourceProduct: { id: "source", name: "Source", specs: [] },
};
const changedReviewCases = [
  { label: "edited field", pending: [edited], mutate: entries => { entries[0].patch.name = "Changed after review"; entries[0].mine.name = "Changed after review"; } },
  { label: "category placement", pending: [edited], mutate: entries => { entries[0].categoryId = "another-category"; } },
  { label: "new product", pending: [pending[1]], mutate: entries => { entries[0].mine.name = "A different new product"; } },
  { label: "deletion baseline", pending: [{ ...pending[2], baseProductVersion: "reviewed-version" }], mutate: entries => { entries[0].baseProductVersion = "later-version"; } },
  { label: "added draft", pending: [edited], mutate: entries => { entries.push({ ...structuredClone(edited), productId: "unreviewed-product" }); } },
  { label: "merge choice", pending: [reviewedMerge], mutate: entries => { entries[0].choices.name = "master"; } },
  { label: "merge source identity", pending: [reviewedMerge], mutate: entries => { entries[0].sourceProductId = "different-source"; } },
  { label: "merge source content", pending: [reviewedMerge], mutate: entries => { entries[0].sourceProduct.specs.push({ id: "new-spec", label: "Notes", value: "Unreviewed" }); } },
];
{
  const review = createUi([edited], { hasKey: false }); await flush(); let finishConnect, finishSave;
  review.setConnect(() => new Promise(resolve => { finishConnect = () => { review.state.hasKey = true; resolve(); }; }));
  review.setSave(() => new Promise(resolve => { finishSave = resolve; }));
  const operation = review.api.save(); review.submit(); await flush(); byClass(review.dialog, "master-key")[0].value = "synthetic-package-key"; review.submit(); await flush();
  await review.clock.advance(12000);
  assert.match(text(byClass(review.dialog, "master-progress-elapsed")[0]), /12/);
  assert.match(text(byClass(review.dialog, "master-progress-detail")[0]), /Still waiting/i);
  finishConnect(); await flush();
  assert.equal(review.calls.saves.length, 1);
  assert.match(text(byClass(review.dialog, "master-progress-elapsed")[0]), /12/, "real phase transitions keep the total elapsed save time");
  assert.doesNotMatch(text(byClass(review.dialog, "master-progress-detail")[0]), /Still waiting/i, "a newly started request receives its own waiting threshold");
  await review.clock.advance(9000);
  assert.match(text(byClass(review.dialog, "master-progress-elapsed")[0]), /21/);
  assert.doesNotMatch(text(byClass(review.dialog, "master-progress-detail")[0]), /Still waiting/i);
  await review.clock.advance(1000); assert.match(text(byClass(review.dialog, "master-progress-detail")[0]), /Still waiting/i);
  review.state.pending = []; finishSave({ saved: true }); await operation;
  assert.equal(review.clock.count(), 1);
}

for (const fixture of changedReviewCases) {
  const review = createUi(fixture.pending, { hasKey: false }); await flush(); let finishConnect;
  review.setConnect(() => new Promise(resolve => { finishConnect = () => { review.state.hasKey = true; resolve(); }; }));
  const operation = review.api.save(); review.submit(); await flush();
  byClass(review.dialog, "master-key")[0].value = "synthetic-package-key"; review.submit(); await flush();
  assert.equal(review.calls.connects.length, 1); assert.equal(review.calls.saves.length, 0);
  keepWorking(review).dispatchEvent({ type: "click" }); fixture.mutate(review.state.pending);
  const changedDrafts = structuredClone(review.state.pending);
  finishConnect(); await operation;
  assert.equal(review.calls.saves.length, 0, `${fixture.label}: edits made while connecting require a fresh review before any write`);
  assert.deepEqual(review.state.pending, changedDrafts); assert.equal(review.state.hasKey, true);
  assert.equal(review.api.getSummary().busy, false); assert.equal(review.clock.count(), 1);
  assert.match(review.notices.get("master-sync-error").message, /Your draft changed\. Review the latest changes before saving\./);
}

{
  const review = createUi([edited]); await flush();
  const operation = review.api.save(); review.state.pending[0].patch.name = "Changed while review was open"; review.submit(); await operation;
  assert.equal(review.calls.saves.length, 0, "the reviewed intent is captured when the review renders, not after submission");
  assert.match(review.notices.get("master-sync-error").message, /Your draft changed/);
}

{
  const review = createUi([edited, { ...structuredClone(edited), productId: "second-reviewed-product" }], { hasKey: false }); await flush(); let finishConnect;
  review.setConnect(() => new Promise(resolve => { finishConnect = () => { review.state.hasKey = true; resolve(); }; }));
  const operation = review.api.save(); review.submit(); await flush(); byClass(review.dialog, "master-key")[0].value = "synthetic-package-key"; review.submit(); await flush();
  review.state.pending.reverse();
  for (const entry of review.state.pending) {
    entry.baseRevisions = { unrelated: 12 }; entry.base.name = "Another accepted baseline value";
    entry.patch = Object.fromEntries(Object.entries(entry.patch).reverse());
  }
  finishConnect(); await operation;
  assert.equal(review.calls.saves.length, 1, "list order, object property order and unrelated baseline/revision changes do not manufacture a new reviewed update intent");
  assert.equal(review.notices.has("master-sync-error"), false);
}

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
const delivered = { provider: "sharepoint", kind: "publication", generation: 8, candidateId: "12345678-1234-4234-8234-123456789abc", sha256: "a".repeat(64), bytes: 900, storageRevision: 5 };
updatesUi.adapter.getLoadedPackageInfo = () => ({ version: 2, ...delivered, loadedAt: "2026-10-15T02:00:00.000Z" });
updatesUi.state.snapshot.publication = { status: "current", ...delivered };
updatesUi.document.getElementById("checkTeamUpdates").dispatchEvent({ type: "click" }); await flush();
assert.match(text(updatesPanel), /matches the published copy at the last check/, "service freshness compares verified generation and digest");
updatesUi.state.snapshot.publication = { status: "current", ...delivered, generation: 9 };
updatesUi.document.getElementById("checkTeamUpdates").dispatchEvent({ type: "click" }); await flush();
assert.match(text(updatesPanel), /different published package/, "new generation detects image-only service publications");
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
console.log("Master UI checks passed: explicit Updates/Save controls, checked/error/busy/unknown package states and exact package identity, protected drafts, accessible save/conflict/discard decisions, dismissible/reopenable progress with truthful phase timing and bounded timers, reviewed-intent fences, newer-draft preservation, publisher/scoped-sharing protections, and adoption/disconnect/teardown without fetching or stale check/save/scoped/GitHub results.");
