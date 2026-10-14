(function () {
  "use strict";
  // The dedicated MSAL bridge handles and clears the response URL. Never log it.
  globalThis.msalRedirectBridge.broadcastResponseToMainFrame().catch(() => {
    document.getElementById("authReturnStatus").textContent = "Return to PPC and try Sign in & load again. This window can be closed.";
  });
})();
