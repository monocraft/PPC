/*
 * Tiny, independently drawn interface characters. The reference direction is
 * expressive faces sharing one visual family, with identity carried by small
 * differences in posture and eyes rather than by initials or extra colors.
 * This module only draws: it never tracks people, starts timers, or sends data.
 */
(function (root) {
  "use strict";

  const svgNamespace = "http://www.w3.org/2000/svg";
  const moods = Object.freeze(["browsing", "editing", "frustrated", "angry", "roadmap", "focused", "idle", "playful", "recent", "offline"]);
  const editingBeats = Object.freeze(["editing", "frustrated", "editing", "angry", "editing"]);
  const quirks = Object.freeze(["wink", "wonky", "wide", "sleepy"]);
  const labels = Object.freeze({
    browsing: "Looking around", editing: "Making changes", frustrated: "A frustrated face", angry: "An angry face", roadmap: "Exploring the roadmap",
    focused: "Taking a closer look", idle: "Taking a breather", playful: "A little playful",
    recent: "Recently here", offline: "Not connected",
  });

  function seedFor(user) {
    const identity = String(user?.sessionId || user?.login || user?.id || "portfolio-guest");
    let seed = 2166136261;
    for (let index = 0; index < identity.length; index += 1) {
      seed ^= identity.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
  }

  function moodFor(user, context, seed) {
    // Explicit moods are for the isolated expression studio; normal presence
    // supplies observed context. Historical GitHub authors are never live.
    if (moods.includes(context.mood)) return context.mood;
    if (context.recent === true) return "recent";
    if (context.offline === true) return "offline";
    if (context.playful === true) return "playful";
    if (user?.editing === true) {
      // These are little theatrical editing beats, never an assessment of the
      // person's feelings. The caller supplies observed duration; no clock,
      // tracking or additional presence request belongs in the drawing engine.
      if (Number.isFinite(context.editingForMs) && context.editingForMs >= 60000) {
        const beat = Math.floor((context.editingForMs - 60000) / 12000);
        return editingBeats[(beat + ((seed >>> 18) % editingBeats.length)) % editingBeats.length];
      }
      return "editing";
    }
    if (context.idle === true) return "idle";
    if (context.view === "roadmap") return "roadmap";
    if (context.focused === true || context.view === "focus" || context.view === "focused") return "focused";
    return "browsing";
  }

  function profile(user = {}, context = {}) {
    context = context || {};
    const seed = seedFor(user), mood = moodFor(user, context, seed);
    return Object.freeze({
      seed, tone: seed % 5, mood, quirk: quirks[(seed >>> 6) % quirks.length], label: labels[mood],
      delay: `-${((seed % 57) / 10).toFixed(1)}s`,
      duration: `${(6.4 + ((seed >>> 9) % 37) / 10).toFixed(1)}s`,
    });
  }

  function createAvatar(user = {}, context = {}, documentObject = root.document) {
    if (!documentObject?.createElement || !documentObject?.createElementNS) throw new TypeError("Presence characters need a document.");
    const character = profile(user, context), { seed, mood, quirk } = character;
    const span = documentObject.createElement("span");
    span.className = `master-presence-avatar presence-character master-presence-tone-${character.tone}`;
    span.setAttribute("aria-hidden", "true");
    span.setAttribute("data-mood", mood);
    span.setAttribute("data-quirk", quirk);
    span.style.setProperty("--presence-delay", character.delay);
    span.style.setProperty("--presence-duration", character.duration);
    span.style.setProperty("--presence-tilt", `${[-5, -2, 2, 5][(seed >>> 12) % 4]}deg`);

    const svg = (tag, attributes = {}) => {
      const element = documentObject.createElementNS(svgNamespace, tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
      return element;
    };
    const face = svg("svg", { class: "presence-face", viewBox: "0 0 32 32", width: 32, height: 32, fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" });

    // A subtly different contour and orbit belong to the person, so changing
    // activity never swaps their silhouette or creates a new random identity.
    const silhouettes = [
      "M26.4 11.7A11.8 11.8 0 1 1 21.5 5.5",
      "M26.1 11.5C30.1 19.7 23.4 28.8 15 28.2C5.4 27.6 1.6 17.6 6.4 10.1C9.6 5.1 16.2 2.8 21.6 5.7",
      "M26.5 12C29.8 20 23.5 28.2 15.8 28.2C7.4 28.2 2.7 21.5 4.5 13.2C6 6.2 14.7 2.1 21.6 5.4",
      "M26.6 11.6C29.2 18.9 25.4 27 17.4 28.1C8.5 29.4 2 22.1 4.1 13.6C5.8 6.6 13.2 2.7 21.4 5.3",
    ];
    face.append(svg("path", { class: "presence-ring", d: silhouettes[(seed >>> 3) % silhouettes.length], "stroke-width": 2.1 }));
    face.append(svg("path", { class: "presence-orbit", d: "M24.1 4.3L24.7 6.5L27 7.2L24.7 7.9L24.1 10.1L23.4 7.9L21.2 7.2L23.4 6.5Z", "stroke-width": 1.2 }));

    const features = svg("g", { class: "presence-features" });
    const eyes = svg("g", { class: "presence-eyes", "stroke-width": 2.25 });
    const spacing = [3.4, 3.9, 4.2][(seed >>> 15) % 3];
    const center = 15.8, left = center - spacing, right = center + spacing;
    const eyeTop = 12.7, eyeBottom = quirk === "wide" ? 16.6 : 15.7;
    const pill = (x, y = eyeTop, bottom = eyeBottom) => `M${x} ${y}V${bottom}`;
    const shut = (x, y = 14.5) => `M${x - 1.4} ${y + .4}Q${x} ${y - 1.1} ${x + 1.4} ${y + .4}`;
    let leftEye = pill(left), rightEye = pill(right), mouth = "M12.9 20Q16 22.8 19.1 20";
    let flair = null;

    if (mood === "editing") {
      leftEye = `M${left - .7} 12.6L${left + .5} 13.4V15.9`;
      rightEye = `M${right + .7} 12.6L${right - .5} 13.4V15.9`;
      mouth = quirk === "wonky" ? "M13.1 21Q16.2 18.5 19.3 20.9L18.6 22.3" : "M13.1 21Q16 19.2 18.9 21";
      flair = { class: "presence-flair presence-edit-mark", d: "M23 17.5L25.7 14.8M24.7 13.8L26.7 15.8", "stroke-width": 1.25 };
    } else if (mood === "frustrated") {
      leftEye = pill(left, 14.2, 16.1); rightEye = pill(right, 13.7, 15.6);
      mouth = "M12.3 21.1Q14.4 18.9 16.2 21.1Q18 23.3 20 20.7";
      flair = { class: "presence-flair presence-frustrated-mark", d: `M${left - 1.9} 11.5Q${left} 10.2 ${left + 1.8} 11.8M${right - 1.7} 11.9L${right + 1.8} 10.8M22.5 19.2Q25 18.6 24.2 20.1M22.9 21.4H24.8`, "stroke-width": 1.35 };
    } else if (mood === "angry") {
      leftEye = pill(left, 14.4, 16); rightEye = pill(right, 14.4, 16);
      mouth = "M12.3 20.4H19.7V22.9H12.3ZM14.8 20.6V22.6M17.2 20.6V22.6";
      flair = { class: "presence-flair presence-angry-mark", d: `M${left - 2} 10.9L${left + 1.5} 12.5M${right - 1.5} 12.5L${right + 2} 10.9`, "stroke-width": 1.65 };
    } else if (mood === "roadmap") {
      leftEye = pill(left - .6, 11.9, 14.9); rightEye = pill(right - .6, 11.9, 14.9);
      mouth = "M13.3 20.1Q16.1 23.1 19.2 19.7";
      flair = { class: "presence-flair presence-roadmap-mark", d: "M20.9 10.2L23.2 8M21.3 8H23.3V10", "stroke-width": 1.1 };
    } else if (mood === "focused") {
      leftEye = pill(left, 13.4, 15.8); rightEye = pill(right, 13.4, 15.8);
      mouth = "M14.4 21H17.6";
      flair = { class: "presence-flair presence-focus-mark", d: `M${left - 1.9} 11.4H${left + 1.8}M${right - 1.8} 11.4H${right + 1.9}`, "stroke-width": 1.15 };
    } else if (mood === "idle") {
      leftEye = shut(left, 14.3); rightEye = shut(right, 14.3);
      mouth = quirk === "wide" ? "M14.9 20.1C14.9 18.5 17.3 18.5 17.3 20.1C17.3 21.7 14.9 21.7 14.9 20.1Z" : "M13.7 20.1Q16 21.6 18.3 20.1";
      flair = { class: "presence-flair presence-idle-mark", d: "M23 11.2H25L23 13.3H25", "stroke-width": 1.1 };
    } else if (mood === "playful") {
      leftEye = quirk === "sleepy" ? shut(left, 14) : pill(left, 12.3, 15.9);
      rightEye = quirk === "wide" ? pill(right, 11.5, 16) : `M${right - 1.6} 13.4L${right + .1} 14.2L${right - 1.5} 15.4`;
      mouth = quirk === "wide" ? "M14 20C14 17.5 18.3 17.5 18.3 20C18.3 23.2 14 23.2 14 20Z" : quirk === "wonky" ? "M12 19.8Q17.4 24.8 20 18.5M17.2 21.1L18.1 23" : "M12.7 19.7Q16.7 24.6 19.7 19.3M16.3 21.8V23.2";
      flair = { class: "presence-flair presence-play-mark", d: "M7.4 18.2L8.2 18.9M23.5 18.2L24.3 17.5", "stroke-width": 1.2 };
    } else if (mood === "recent") {
      // Calm, static expression: the person edited before; no live activity is known.
      leftEye = pill(left, 13.3, 15.8); rightEye = pill(right, 13.3, 15.8);
      mouth = "M13.7 20.4Q16 21.8 18.3 20.4";
    } else if (mood === "offline") {
      leftEye = `M${left - 1.2} 14.8H${left + 1.2}`; rightEye = `M${right - 1.2} 14.8H${right + 1.2}`;
      mouth = "M14.1 21H17.9";
    } else {
      // The same four little mannerisms recur across people and moods.
      if (quirk === "wink") rightEye = shut(right);
      if (quirk === "sleepy") { leftEye = pill(left, 14, 16); rightEye = pill(right, 14, 16); }
      if (quirk === "wonky") { rightEye = pill(right, 11.9, 15.6); mouth = "M12.7 20.5Q16.6 23 19.5 19.4"; }
      if (quirk === "wide") mouth = "M14.6 20C14.6 18.3 17.4 18.3 17.4 20C17.4 22 14.6 22 14.6 20Z";
    }

    eyes.append(svg("path", { class: "presence-eye-left", d: leftEye }), svg("path", { class: "presence-eye-right", d: rightEye }));
    features.append(eyes, svg("path", { class: "presence-mouth", d: mouth, "stroke-width": 1.55 }));
    if (flair) features.append(svg("path", flair));
    face.append(features); span.append(face);
    return span;
  }

  root.PortfolioPresenceExpressions = Object.freeze({ profile, createAvatar, moods });
})(globalThis);
