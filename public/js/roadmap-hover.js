/* A viewport-only lane guide. CSS handles motion without repainting the canvas. */
(function (root) {
  "use strict";

  function create(canvas, scroll, { headerHeight, railWidth = 48, getRows, getOwner, isSuspended, onChange }) {
    const clip = document.createElement("div");
    const frame = document.createElement("div");
    clip.className = "roadmap-lane-hover-clip";
    clip.setAttribute("aria-hidden", "true");
    frame.className = "roadmap-lane-hover-frame";
    clip.append(frame);
    scroll.parentElement.append(clip);
    let pointer = null;
    let productId = null;
    let owner = getOwner();
    let releaseFrame = null;
    let previousScrollLeft = scroll.scrollLeft;
    let previousScrollTop = scroll.scrollTop;

    function immediatePosition() {
      if (releaseFrame !== null) cancelAnimationFrame(releaseFrame);
      frame.classList.add("is-immediate");
      releaseFrame = requestAnimationFrame(() => {
        releaseFrame = null;
        frame.classList.remove("is-immediate");
      });
    }

    function setProduct(nextId) {
      if (productId === nextId) return;
      productId = nextId;
      frame.dataset.productId = nextId || "";
      onChange(nextId);
    }

    function clear({ immediate = false } = {}) {
      pointer = null;
      if (immediate && productId) immediatePosition();
      frame.style.opacity = "0";
      setProduct(null);
    }

    function sync({ immediate = false } = {}) {
      const nextOwner = getOwner();
      if (owner !== nextOwner) {
        owner = nextOwner;
        clear({ immediate: true });
      }
      const scrolled = previousScrollLeft !== scroll.scrollLeft || previousScrollTop !== scroll.scrollTop;
      previousScrollLeft = scroll.scrollLeft;
      previousScrollTop = scroll.scrollTop;
      const viewport = scroll.getBoundingClientRect();
      clip.style.left = `${scroll.offsetLeft + railWidth}px`;
      clip.style.top = `${scroll.offsetTop + headerHeight}px`;
      clip.style.width = `${Math.max(0, scroll.clientWidth - railWidth - 8)}px`;
      clip.style.height = `${Math.max(0, scroll.clientHeight - headerHeight)}px`;
      if (!pointer || isSuspended()) { clear({ immediate: true }); return; }
      const x = pointer.clientX - viewport.left - scroll.clientLeft;
      const y = pointer.clientY - viewport.top - scroll.clientTop;
      const row = x >= railWidth && x < scroll.clientWidth && y >= headerHeight && y < scroll.clientHeight
        ? getRows().find((item) => y + scroll.scrollTop >= item.y && y + scroll.scrollTop < item.y + item.height)
        : null;
      if (!row) {
        frame.style.opacity = "0";
        setProduct(null);
        return;
      }
      // Enter at the pointer's lane; only movement between visible lanes glides.
      const placeImmediately = immediate || scrolled || !productId;
      if (placeImmediately) immediatePosition();
      frame.style.transform = `translateY(${row.y - scroll.scrollTop - headerHeight + 1}px)`;
      frame.style.height = `${Math.max(0, row.height - 2)}px`;
      // Commit the new placement with motion disabled before the next frame.
      if (placeImmediately) void frame.offsetHeight;
      frame.style.opacity = "1";
      setProduct(row.productId);
    }

    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || event.isPrimary === false) { clear({ immediate: true }); return; }
      pointer = { clientX: event.clientX, clientY: event.clientY };
      sync();
    });
    canvas.addEventListener("pointerleave", () => clear());
    ["pointerdown", "pointercancel", "lostpointercapture"].forEach((name) => {
      canvas.addEventListener(name, () => clear({ immediate: true }));
    });
    window.addEventListener("blur", () => clear({ immediate: true }));
    return Object.freeze({ sync, clear });
  }

  root.RoadmapLaneHover = Object.freeze({ create });
})(globalThis);
