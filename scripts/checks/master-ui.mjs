import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/master-model.js";

const source = await readFile(new URL("../../public/js/master-ui.js", import.meta.url), "utf8");
const model = globalThis.PortfolioMasterModel;
const all = (node) => [node, ...(node.children || []).flatMap(all)];
const text = (node) => `${node.textContent || ""}${(node.children || []).map(text).join(" ")}`;
const byClass = (node, name) => all(node).filter((entry) => String(entry.className || "").split(" ").includes(name));
const byTag = (node, tag) => all(node).filter((entry) => entry.tagName === tag.toUpperCase());
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function createUi(initialPending, { configured = true, hasKey = true, publication = { status: "pending" } } = {}) {
  const listeners = new Map(), notices = new Map(), calls = { saves: [], connects: [], disconnects: 0, refreshes: 0, discards: [], undos: [] };
  const document = { activeElement: null, visibilityState: "visible", addEventListener() {} };
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
  document.body = document.createElement("body"); document.body.append(button);
  document.getElementById = (id) => all(document.body).find((node) => node.id === id);
  const state = { configured, hasKey, connected: false, pending: structuredClone(initialPending), snapshot: { publication } };
  let saveHandler = async () => { state.pending = []; return { saved: true, snapshot: state.snapshot }; };
  let discardedPending = [], discardFailure = false;
  const session = {
    getState: () => state, track: () => state.pending,
    async refresh() { calls.refreshes += 1; state.connected = true; },
    async connect(options) { calls.connects.push(options); state.hasKey = true; },
    async save(options) { calls.saves.push(options); return saveHandler(options); },
    disconnect() { calls.disconnects += 1; state.hasKey = false; },
  };
  const adapter = { getProducts() {}, canRefresh: () => true,
    async discardChanges(productIds) {
      calls.discards.push(productIds); if (discardFailure) throw new Error("Private implementation details should stay hidden");
      discardedPending = state.pending.filter((product) => productIds.includes(product.productId));
      state.pending = state.pending.filter((product) => !productIds.includes(product.productId));
      return { discarded: discardedPending.length, undoId: "undo-token" };
    },
    async undoDiscard(undoId) { calls.undos.push(undoId); state.pending.push(...discardedPending); discardedPending = []; return true; },
  };
  const sandbox = { document, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    PortfolioMasterClient: { createSession: () => session }, PortfolioMasterModel: model,
    PortfolioProductMergeAdapter: { getImageSource: (id) => id === "local-image" ? "blob:local-preview" : id === "latest-image" ? "blob:latest-preview" : "" },
    PortfolioNotifications: { publish(notice) { notices.set(notice.id, notice); }, resolve(id) { notices.delete(id); }, show() {} },
    addEventListener(name, handler) { listeners.set(name, handler); }, dispatchEvent() {}, setInterval: () => 1, clearInterval() {},
  };
  vm.createContext(sandbox); new vm.Script(source).runInContext(sandbox);
  const api = sandbox.PortfolioMasterUI.initialize({ source: { mode: "service", team: true, endpoint: "https://private.example/api/master" }, adapter });
  const dialog = document.getElementById("masterDialog");
  return { api, publicApi: sandbox.PortfolioMasterUI, dialog, button, calls, notices, state, listeners, setSave: (handler) => { saveHandler = handler; }, failDiscard: () => { discardFailure = true; }, submit: () => byTag(dialog, "form")[0].dispatchEvent({ type: "submit" }) };
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
assert.equal(ui.button.textContent, "Save changes");
assert.equal(ui.notices.has("master-publication"), false, "accepted changes pending follow-up do not show distracting publication messages");
assert.equal(typeof ui.publicApi.save, "function", "product actions can open the public save review");
const flow = ui.publicApi.save();
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

const cancelled = createUi([edited]);
const cancelledFlow = cancelled.api.save();
assert.equal(byClass(cancelled.dialog, "master-review-search").length, 0, "small batches do not need extra controls");
byTag(cancelled.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" });
await cancelledFlow;
assert.equal(cancelled.calls.saves.length, 0); assert.equal(cancelled.state.pending.length, 1);
assert.equal(cancelled.calls.disconnects, 0, "keeping the draft never clears access");

const failed = createUi([edited]);
failed.setSave(async () => { throw new Error("GitHub failed to publish public/data/master_ppc.pkg at https://private.example/?key=secret"); });
const failedFlow = failed.api.save(); failed.submit(); await failedFlow;
assert.match(failed.notices.get("master-sync-error").message, /Could not save.*changes are safe/);
assert.doesNotMatch(failed.notices.get("master-sync-error").message, /GitHub|master_ppc|private\.example|secret/);

const staleMergeUi = createUi([pending[3]]);
staleMergeUi.setSave(async () => { const error = new Error("A private master merge changed"); error.code = "MERGE_REVIEW_REQUIRED"; throw error; });
const staleMergeFlow = staleMergeUi.api.save(); staleMergeUi.submit(); await staleMergeFlow;
assert.equal(staleMergeUi.notices.get("master-sync-error").message, "These products changed. Review the merge again. Your draft is safe.");

const conflictUi = createUi([edited]); let finalChoices;
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

const savingReview = createUi([edited]); let finishSaving;
savingReview.setSave(() => new Promise((resolve) => { finishSaving = resolve; }));
const savingReviewFlow = savingReview.api.save(); savingReview.submit(); await flush();
assert.equal(savingReview.publicApi.reviewConflicts(reviewConflicts), null);
assert.match(text(savingReview.dialog), /Saving changes/, "a standalone conflict review cannot replace an active save progress dialog");
finishSaving({ saved: true }); await savingReviewFlow;

const unavailable = createUi([edited], { configured: false, publication: { status: "error" } });
const unavailableFlow = unavailable.api.save();
assert.equal(byTag(unavailable.dialog, "button").find((button) => button.type === "submit").disabled, true);
assert.doesNotMatch(text(unavailable.dialog), /master|GitHub|private/i);
assert.match(unavailable.notices.get("master-publication").message, /saved changes are available to the team/);
byTag(unavailable.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await unavailableFlow;

const discardCancelled = createUi([edited, pending[1]]);
const discardCancelledFlow = discardCancelled.api.save();
byClass(discardCancelled.dialog, "master-discard-product")[0].dispatchEvent({ type: "click" }); await flush();
assert.match(text(discardCancelled.dialog), /Discard changes\?.*Headset.*Edits will be reverted/);
byTag(discardCancelled.dialog, "button").find((button) => button.textContent === "Keep changes").dispatchEvent({ type: "click" }); await flush();
assert.equal(discardCancelled.calls.discards.length, 0); assert.equal(discardCancelled.state.pending.length, 2);
assert.match(text(discardCancelled.dialog), /Review changes/, "cancelling discard returns to a fresh review");
byTag(discardCancelled.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await discardCancelledFlow;

const discardOne = createUi([edited, pending[1]]);
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

const discardAll = createUi(pending);
const discardAllFlow = discardAll.api.save();
const discardSearch = byClass(discardAll.dialog, "master-review-search")[0]; discardSearch.value = "new keyboard"; discardSearch.dispatchEvent({ type: "input" });
byClass(discardAll.dialog, "master-discard-all")[0].dispatchEvent({ type: "click" }); await flush();
assert.match(text(discardAll.dialog), /And 2 more products/);
discardAll.submit(); await flush(); await discardAllFlow;
assert.equal(discardAll.calls.discards[0].length, 8, "Discard all targets the entire batch even while search shows one product");
assert.equal(discardAll.state.pending.length, 0); assert.equal(discardAll.dialog.open, false);
assert.equal(discardAll.calls.disconnects, 0);

const discardFailed = createUi([edited]); discardFailed.failDiscard();
const discardFailedFlow = discardFailed.api.save();
byClass(discardFailed.dialog, "master-discard-product")[0].dispatchEvent({ type: "click" }); await flush(); discardFailed.submit(); await flush();
assert.equal(discardFailed.state.pending.length, 1);
assert.doesNotMatch(discardFailed.notices.get("master-discard-result").message, /Private implementation/);
assert.match(text(discardFailed.dialog), /Review changes/);
byTag(discardFailed.dialog, "button").find((button) => button.textContent === "Keep editing").dispatchEvent({ type: "click" }); await discardFailedFlow;
console.log("Master UI checks passed: compact accessible disclosures, summaries, search, bounded values, notes, safe save/conflict decisions, discard confirmation/cancel/single/all/Undo/failure, no visible disconnect and private-friendly messages.");
