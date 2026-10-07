/* Shared app dialogs keep confirmations and notices inside the portfolio. */
(() => {
  "use strict";

  const dialog = document.getElementById("appMessageDialog");
  const title = document.getElementById("appMessageTitle");
  const message = document.getElementById("appMessageText");
  const cancel = document.getElementById("appMessageCancel");
  const accept = document.getElementById("appMessageAccept");
  const queue = [];
  let current = null;
  let inertSnapshot = new Map();

  function isVisible(element) {
    return element instanceof HTMLElement && element.isConnected &&
      !element.disabled && !element.closest("[inert], .hidden, [hidden], .visually-hidden") &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  }

  function focusableElements(container) {
    return [...container.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && isVisible(element));
  }

  function restoreFocus(preferred) {
    if (preferred !== document.body && isVisible(preferred)) {
      preferred.focus({ preventScroll: true });
      return;
    }
    // A previous trigger can disappear after an import or after clearing products.
    const openModal = [...document.querySelectorAll(".modal-backdrop")]
      .reverse().find((element) => element !== dialog && isVisible(element));
    const fallback = (openModal && focusableElements(openModal)[0]) ||
      ["emptyPullLatestData", "emptyImportPackage", "pullLatestData", "workspaceSettingsButton"]
        .map((id) => document.getElementById(id)).find(isVisible) ||
      focusableElements(document.querySelector(".app-shell"))[0];
    fallback?.focus({ preventScroll: true });
  }

  function protectBackground() {
    for (const element of document.querySelectorAll(".app-shell, .modal-backdrop")) {
      if (element === dialog) continue;
      if (!inertSnapshot.has(element)) inertSnapshot.set(element, element.getAttribute("inert"));
      if (!element.inert) element.inert = true;
    }
  }

  const backgroundObserver = new MutationObserver(() => {
    if (current) protectBackground();
  });

  function showNext() {
    if (current || !queue.length) return;
    current = queue.shift();
    current.returnFocus = document.activeElement;
    const options = current.options;
    const isConfirm = current.kind === "confirm";
    title.textContent = String(options.title || (isConfirm ? "Confirm action" : "Notice"));
    message.textContent = current.message;
    cancel.classList.toggle("hidden", !isConfirm);
    accept.textContent = String((isConfirm ? options.confirmLabel : options.buttonLabel) || (isConfirm ? "Confirm" : "OK"));
    accept.classList.toggle("app-message-danger", isConfirm && Boolean(options.danger));
    dialog.setAttribute("role", isConfirm ? "dialog" : "alertdialog");
    dialog.setAttribute("aria-hidden", "false");
    dialog.classList.remove("hidden");
    inertSnapshot = new Map();
    protectBackground();
    backgroundObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["inert"] });
    (isConfirm ? cancel : accept).focus({ preventScroll: true });
  }

  function finish(accepted) {
    if (!current) return;
    const completed = current;
    current = null;
    backgroundObserver.disconnect();
    dialog.classList.add("hidden");
    dialog.setAttribute("aria-hidden", "true");
    for (const [element, attribute] of inertSnapshot) {
      if (attribute === null) element.removeAttribute("inert");
      else element.setAttribute("inert", attribute);
    }
    inertSnapshot.clear();
    restoreFocus(completed.returnFocus);
    completed.resolve(completed.kind === "confirm" ? accepted : undefined);
    // Let the caller finish its action before opening a queued message.
    queueMicrotask(showNext);
    requestAnimationFrame(() => {
      if (!current && (document.activeElement === document.body || !isVisible(document.activeElement))) restoreFocus(completed.returnFocus);
    });
  }

  function enqueue(kind, value, options = {}) {
    return new Promise((resolve) => {
      queue.push({ kind, message: String(value ?? ""), options: options || {}, resolve });
      showNext();
    });
  }

  cancel.addEventListener("click", () => finish(false));
  accept.addEventListener("click", () => finish(true));
  // Existing workspace listeners must not close the modal underneath this one.
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
  dialog.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === dialog) finish(false);
  });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  document.addEventListener("keydown", (event) => {
    if (!current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(false);
    } else if (event.key === "Tab") {
      const controls = focusableElements(dialog);
      const first = controls[0], last = controls.at(-1);
      if (!first || (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement)))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (last || dialog).focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (first || dialog).focus({ preventScroll: true });
      }
    }
  }, true);
  document.addEventListener("focusin", (event) => {
    if (current && !dialog.contains(event.target)) (current.kind === "confirm" ? cancel : accept).focus({ preventScroll: true });
  }, true);

  window.PortfolioDialogs = Object.freeze({
    alert: (value, options) => enqueue("alert", value, options),
    confirm: (value, options) => enqueue("confirm", value, options),
    isOpen: () => Boolean(current),
  });
})();
