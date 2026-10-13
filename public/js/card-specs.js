/* Purchase summaries for both canvas cards and their editable PowerPoint copy. */
(function registerCardSpecifications(root) {
  "use strict";
  const MAX_ROWS = 5;
  const text = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  const key = value => text(value).normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").toLowerCase()
    .replace(/\((?:facet|filter|info|metric|imperial)\)/g, "").replace(/[‐‑–—-]/g, " ").replace(/\s+/g, " ").trim();
  // Label hyphens are cosmetic; value signs and technical conditions are not.
  const comparable = value => text(value).normalize("NFKC").replace(/[\u200b-\u200d\ufeff®™]/g, "").toLowerCase()
    .replace(/\busb(?:\s+type)?[ -]+([abc])\b/g, "usb $1").replace(/\s+/g, " ")
    .replace(/(\d)\s+(mm|cm|kg|g|khz|hz|mah)\b/g, "$1$2").replace(/[.;]+$/, "").trim();
  const placeholder = value => !text(value) || /^(?:[—–-]|n\/?a|not applicable|not set|unknown|tbd|tbc|to be (?:confirmed|determined)|yes\s*\/\s*no|internal\s*\/\s*external)$/i.test(text(value))
    || /^add\s+/i.test(text(value));
  const administrative = label => /\b(?:warranty|operating system|box contents|what is in the box|copyright|legal|footnote|disclaimer|sku|upc|barcode|launch|tracker|source|msrp|manufacturer|gross weight|packag(?:e|ing)|carton)\b/.test(key(label));
  const r = (role, label, names, options = {}) => ({ role, label, names: names.map(key), ...options });
  const connection = r("connection", "Connection", ["Connection", "Connection type", "Wireless", "Wireless modes", "Connectivity", "Host connection"]);
  const battery = r("battery", "Battery", ["Battery life", "Battery", "Battery duration"]);
  const weight = r("weight", "Weight", ["Weight", "Mouse weight", "Product weight"]);
  const size = r("size", "Size", ["Dimensions (W × L × thickness)", "Dimensions (W × D × thickness)", "Dimension", "Dimensions", "Product Dimensions W x D x H", "Size", "Size and fit"], { maxLength: 125 });
  const material = r("material", "Material", ["Material", "Product material", "Housing material", "Shell material", "Shell", "Construction"], { reject: /printed by|easy assembly/i });
  const controls = r("controls", "Controls", ["Controls", "Microphone gain control", "Headphone volume control", "Tap-to-mute", "Microphone mute control", "Mute control"], { reject: /^on[ -]board controls?$/i });
  const lighting = r("lighting", "Lighting", ["Lighting", "Light effects", "Lighting effects", "Keyboard backlight", "Backlighting", "Lighting zones", "Lighting zone", "Per-key lighting", "RGB support", "RGB"], { reject: /^(?:no|none|false|not supported)$/i });
  const features = r("features", "Features", ["Features", "Feature", "Technical features"], { maxLength: 115 });
  // Physical fit belongs on replaceable accessories; OS/platform lists do not.
  const fit = r("fit", "Fits", ["Keyboard compatibility", "HyperX keyboard compatibility", "Supported keyboards", "Headset compatibility", "Compatibility", "Attachment"], { reject: /^(?:PC|Mac|Windows|iOS|Android|Universal)(?:[;, ·]|$)|software compatibility/i });
  const consoleFit = r("fit", "Works with", ["Platform", "Platform compatibility", "Compatible platforms", "Compatibility"], { accept: /xbox|playstation|ps[45]|nintendo|switch|steam deck/i, maxLength: 150 });
  const attachment = r("attachment", "Attachment", ["Attachment", "Attachment type", "Mounting", "Mount type", "Mounting type", "Connection type"], { reject: /^(?:wired|wireless|usb(?:\s|$))/i });
  const surface = r("surface", "Surface", ["Surface material", "Surface", "Material", "Product material"]);
  const microphone = r("microphone", "Microphone", ["Microphone", "Microphone configuration", "Boom microphone type", "Microphone type", "Capsule type"]);
  const driver = r("driver", "Drivers", ["Drivers", "Driver", "Driver size", "Driver diameter", "Driver type"]);
  const comfort = r("comfort", "Comfort", ["Cushions", "Ear cushions", "Ear cushion material", "Earpad material", "Ear tips / Cushions", "Ear tips"]);
  const audio = r("audio", "Audio", ["Audio", "Spatial audio", "Audio features", "Noise cancellation", "Active noise cancellation"]);
  const switchType = r("switch", "Switches", ["Switch technology", "Switch feel", "Switch type", "Switch", "Switch model", "Switches"], { combine: true });
  const polling = r("polling", "Polling", ["Polling rate", "USB polling rate", "Report rate"]);
  const profiles = {
    microphone: [connection, r("recording", "Recording", ["Record quality", "Recording quality", "Bit depth", "Recording sample rates", "Recording sampling rates", "Sampling rates", "Sample rate"], { combine: true }),
      r("capsule-pattern", "Microphone", ["Capsule type", "Microphone type", "Polar pattern", "Microphone polar pattern"], { combine: true }),
      r("monitor", "Headphone monitoring", ["Monitor", "Direct monitoring", "Headphone monitoring", "Headphone output", "Monitoring"]), controls,
      r("mount", "Mounting", ["Shock mount", "Pop filter", "Base stand", "Mounting"], { combine: true }), lighting],
    headsetWired: [connection, driver, microphone, comfort, audio, controls, weight],
    headsetWireless: [battery, connection, driver, microphone, comfort, audio, weight, controls],
    consoleWired: [consoleFit, connection, driver, microphone, comfort, audio, controls],
    consoleWireless: [consoleFit, battery, connection, driver, microphone, comfort, audio],
    earbuds: [audio, battery, connection, r("fit", "Fit", ["Ear tips", "Ear tips / Cushions", "Fit", "Form factor"]), driver, microphone, controls],
    keyboard: [r("format", "Format", ["Keyboard form factor", "Form factor", "Keyboard size"]), switchType, connection,
      r("customization", "Customization", ["Rapid trigger", "Adjustable actuation", "Hot-swap switch", "Hot swappable", "Customization"]), polling,
      r("keycaps", "Keycaps", ["Keycap type", "Keycap material"]), r("keycaps", "Material", ["Product material"], { accept: /\b(?:PBT|ABS)\b/i }), r("mount", "Mount", ["Mount style", "Mounting style"]), lighting, battery],
    keyboardWireless: [r("format", "Format", ["Keyboard form factor", "Form factor", "Keyboard size"]), switchType, connection, battery,
      r("customization", "Customization", ["Rapid trigger", "Adjustable actuation", "Hot-swap switch", "Hot swappable", "Customization"]), polling, lighting],
    mouse: [weight, connection, r("shape", "Shape", ["Shape", "Mouse shape", "Frame shape", "Grip type", "Size and fit"]),
      r("sensor", "Sensor", ["Sensor", "Sensor model", "DPI", "Resolution"]), polling, battery, r("buttons", "Buttons", ["Buttons", "Button count", "Programmable buttons"]), switchType],
    mouseWireless: [weight, connection, battery, r("sensor", "Sensor", ["Sensor", "Sensor model", "DPI", "Resolution"]), polling,
      r("shape", "Shape", ["Shape", "Mouse shape", "Frame shape", "Grip type"]), r("buttons", "Buttons", ["Buttons", "Button count", "Programmable buttons"])],
    mat: [size, surface, r("base", "Base / edges", ["Base material", "Non-slip base", "Stitched edges", "Features", "Feature"], { maxLength: 130 }), lighting],
    wrist: [size, r("padding", "Padding", ["Padding material", "Cushion material", "Material", "Product material"]), features, weight],
    switch: [r("feel", "Feel", ["Switch feel", "Switch type", "Keyboard type"]), r("force", "Actuation", ["Switch actuation force", "Actuation force", "Actuation point"]),
      r("travel", "Travel", ["Key travel distance", "Switch key travel", "Switch total travel", "Total travel"]),
      r("pins", "Mount", ["Switch pin count", "Pin count", "Attachment"]), fit, r("model", "Switch", ["Switch model", "Switch"]),
      r("quantity", "Pack size", ["Switch count", "Quantity", "Pack quantity"])],
    housing: [fit, material, r("assembly", "Assembly", ["Assembly", "Attachment"]), r("lighting", "Finish", ["Light transmission", "Finish", "Surface"]), size, weight],
    plate: [fit, material, attachment, r("finish", "Finish", ["Finish", "Surface", "Color"]), size],
    keycap: [fit, r("material", "Keycaps", ["Keycap material", "Keycap type", "Product material", "Material"], { reject: /printed by/i }),
      r("profile", "Profile", ["Key profile", "Profile", "Keycap profile"]), r("lighting", "Finish", ["Light transmission", "Finish", "Surface"]), attachment, size],
    skates: [fit, r("material", "Skates", ["Skate material", "Material", "Product material"]), attachment, features, size],
    decoration: [fit, attachment, r("design", "Design", ["Badge design", "Design", "Features", "Feature"], { maxLength: 100 }), material, size],
    figurine: [r("size", "Size", ["Size", "Dimension", "Dimensions"]), material, r("design", "Design", ["Design", "Features", "Feature"], { maxLength: 100 })],
    webcam: [r("video", "Video", ["Video resolution", "Camera resolution", "Maximum resolution", "Resolution", "Video frame rate", "Frame rate"], { combine: true }),
      r("view", "Field of view", ["Diagonal field of view", "Diagonal Field of View (dFoV)", "Field of view"]), r("focus", "Focus", ["Focus", "Focus type"]),
      r("camera", "Camera", ["Camera capabilities", "Camera sensor", "Sensor", "Camera megapixels", "Total camera megapixels"], { maxLength: 130 }),
      connection, r("position", "Positioning", ["Camera swivel range", "Camera tilt range"], { combine: true }), r("privacy", "Privacy", ["Privacy shutter", "Privacy cover"])],
    controller: [connection, r("sticks", "Sticks", ["Stick technology", "Thumbstick technology", "Thumbstick switches"]), r("switch", "Switches", ["Switches", "Switch technology"]),
      consoleFit, r("controls", "Controls", ["Remappable buttons", "Programmable buttons", "Trigger locks", "Controls", "Features", "Feature"], { maxLength: 125 }), battery,
      r("shape", "Size / grip", ["Form factor", "Shape", "Dimensions", "Product Dimensions W x D x H"]), weight, lighting],
    arcade: [r("format", "Format", ["Form factor", "Controller type"]), connection, consoleFit,
      r("actuation", "Actuation", ["Actuation adjustment resolution", "Adjustable actuation", "Control travel"]),
      r("feel", "Input feel", ["Control switch feel"]), lighting, weight],
    dock: [r("capacity", "Charges", ["Controller charging capacity", "Supported controller count", "Supported controllers", "Simultaneous charging", "Charging capacity", "Supported device count"]),
      r("fit", "Fits", ["Controller compatibility", "Supported controllers", "Compatibility"], { reject: /^(?:PC|Windows|Mac)(?:[;, ·]|$)/i }),
      r("charging", "Charging", ["Charging time", "Charge time", "Charging", "Charging method"]), r("connection", "Connection", ["USB specification", "Connection type", "Connection"]),
      r("status", "Indicators", ["Charge indicators", "Charging indicators", "Charging indicator count", "LED indicators", "Features", "Feature"], { maxLength: 115 })],
    mixer: [r("inputs", "Inputs", ["Microphone input ports", "Microphone inputs", "Microphone input", "Audio input", "Inputs", "Input connectors"]),
      r("outputs", "Line / headphones", ["Line and headphone ports", "Audio outputs", "Audio output", "Headphone output", "Outputs", "Output connectors"]), connection,
      r("mixing", "Mixing", ["Controls", "Mixing controls", "Audio routing", "Features", "Feature"], { maxLength: 125 }),
      r("recording", "Audio quality", ["Recording quality", "Bit depth", "Sampling rates", "Recording sample rates", "USB audio format", "Audio resolution"], { combine: true }),
      r("power", "Mic power", ["Phantom power", "Power supply"])],
    arm: [r("fit", "Supports", ["Load capacity", "Supported weight", "Maximum load capacity", "Compatibility"]),
      r("reach", "Reach", ["Arm reach", "Reach", "Maximum reach"]), r("mount", "Mount", ["Mounting", "Mounting type", "Connection type", "Attachment"]),
      r("desk", "Desk fit", ["Clamp range", "Clamp opening", "Clamp size"]), features],
    filter: [attachment, fit, r("size", "Screen size", ["Filter screen dimensions", "Dimensions", "Dimension"]),
      r("material", "Screen", ["Filter screen material", "Material", "Product material"]), r("reach", "Gooseneck", ["Gooseneck length"]), features],
    cable: [r("connectors", "Connectors", ["Cable connectors", "Connectors", "Connector type", "Connection type", "Connection", "Microphone input", "Audio output"]),
      r("length", "Length", ["Cable length", "Length"]), r("construction", "Cable", ["Cable jacket and insulation", "Cable type", "Construction", "Material", "Features"], { maxLength: 110 }),
      r("gauge", "Wire gauge", ["Conductor wire gauge"]), r("conductors", "Conductors", ["Cable conductors"])],
    soundCard: [r("host", "Host", ["Host connection", "Connection type", "Connection"]),
      r("headset", "Headset input", ["Headset input", "Audio input", "Compatibility"], { accept: /3\.5\s*mm|headset|headphone/i }), audio, controls, features],
    microphoneAccessory: [attachment, fit, features, size, material],
    backpack: [r("capacity", "Capacity", ["Capacity", "Backpack capacity", "Volume", "Size"]),
      r("laptop", "Laptop fit", ["Supported laptop size", "Laptop size", "Maximum laptop size"]), size,
      r("storage", "Storage", ["Compartments", "Pockets", "Features", "Feature"], { maxLength: 125 }),
      r("carry", "Carry", ["Straps", "Luggage pass-through", "Form factor", "Form Factor"]), r("protection", "Protection", ["Water resistance", "Water resistant"]), weight],
  };

  function profileFor(product, categoryId, specifications = product?.specs) {
    const name = key(product?.name), entries = Array.isArray(specifications) ? specifications : [];
    const type = entries.filter(item => /^(?:type|accessory type)$/.test(key(item?.label))).map(item => key(item.value)).join(" ");
    const kind = `${name} ${type}`;
    const wireless = /wireless/.test(key(product?.laneId)) || entries.some(item => connection.names.includes(key(item?.label)) && /wireless|bluetooth|2\.4\s*ghz/i.test(text(item.value)));
    if (categoryId === "microphones") return "microphone";
    if (categoryId === "console-gaming-audio") return wireless ? "consoleWireless" : "consoleWired";
    if (["pc-gaming-audio", "lifestyle-audio", "audio"].includes(categoryId)) return /earbuds?|earphones?|in ear/.test(kind) ? "earbuds" : wireless ? "headsetWireless" : "headsetWired";
    if (categoryId === "keyboards") return wireless ? "keyboardWireless" : "keyboard";
    if (categoryId === "mice") return wireless ? "mouseWireless" : "mouse";
    if (categoryId === "backpacks") return "backpack";
    if (categoryId === "controllers") return /chargeplay|charging (?:station|dock)|controller dock/.test(kind) ? "dock" : /tachi|leverless|arcade/.test(kind + " " + entries.filter(item => key(item.label) === "form factor").map(item => key(item.value)).join(" ")) ? "arcade" : /thumbsticks?|3d/.test(kind) ? "decoration" : "controller";
    if (categoryId === "microphone-accessories") {
      if (/caster|boom arm|microphone arm/.test(kind)) return "arm";
      if (/xlr.*cable|cable.*xlr|microphone cable/.test(kind)) return "cable";
      if (/shield|pop filter|windscreen/.test(kind)) return "filter";
      return /mixer|interface/.test(kind) ? "mixer" : "microphoneAccessory";
    }
    if (categoryId === "audio-accessories") return /sound card|soundcard/.test(kind) ? "soundCard" : "decoration";
    if (categoryId !== "accessories") return null;
    if (/webcam/.test(kind)) return "webcam";
    if (/wrist rest/.test(kind)) return "wrist";
    if (/mouse ?pad|pulsefire mat/.test(kind)) return "mat";
    if (/switch/.test(kind)) return "switch";
    if (/skate/.test(kind)) return "skates";
    if (/housing/.test(kind) || entries.some(item => key(item.label) === "housing material")) return "housing";
    if (/top plates?/.test(kind)) return "plate";
    if (/keycap|pudding|spacebar/.test(kind)) return "keycap";
    if (/figurine/.test(kind)) return "figurine";
    if (/badge|headband|hdbnd|headset plate|headset topper|\bhsp\b|\bhsa\b/.test(kind)) return "decoration";
    if (entries.some(item => /^(?:feature|features|surface)$/.test(key(item.label)) && /cloth surface|foam base|mouse ?pad/i.test(text(item.value)))) return "mat";
    return null;
  }

  function scopedValue(value, product, rule) {
    const codes = new Set((product?.partSkus || []).map(item => text(item.code).toUpperCase()));
    const matches = [...value.matchAll(/(?:^|;\s*)([A-Z0-9]{7}):\s*/g)];
    if (matches.length < 2 || matches[0].index !== 0 || matches.some(match => !codes.has(match[1]))) return value;
    const represented = new Set(matches.map(match => match[1]));
    if (represented.size !== codes.size || [...codes].some(code => !represented.has(code))) return value;
    const values = matches.map((match, index) => value.slice(match.index + match[0].length, matches[index + 1]?.index ?? value.length).trim());
    const equivalent = item => rule.role === "capsule-pattern" && /cardioid|omnidirectional|bidirectional|stereo/i.test(item)
      ? item.split(/[,;·]/).map(comparable).sort().join("|") : comparable(item);
    return values.every(item => equivalent(item) === equivalent(values[0])) ? values[0] : value;
  }

  function numericList(value, unit) {
    const pattern = unit === "bit" ? /(\d+(?:\.\d+)?)\s*[- ]?bit\b/gi : /(\d+(?:\.\d+)?)\s*(k?hz)\b/gi;
    const matches = [...value.matchAll(pattern)];
    if (!matches.length || value.replace(pattern, "").replace(/[,;·/\s]/g, "")) return null;
    const numbers = [...new Set(matches.map(match => Number(match[1]) * (unit !== "bit" && match[2].toLowerCase() === "khz" ? 1000 : 1)))];
    const maximum = Math.max(...numbers);
    return `${numbers.length > 1 ? "up to " : ""}${unit === "bit" ? maximum + "-bit" : maximum >= 1000 ? maximum / 1000 + " kHz" : maximum + " Hz"}`;
  }

  function displayValue(item, rule, profile, product) {
    let value = text(item.value);
    value = scopedValue(value, product, rule);
    if (rule.role === "recording") {
      const halves = value.split(/\s*\/\s*/);
      const depth = numericList(halves[0], "bit"), rate = numericList(halves.length === 2 ? halves[1] : value, "hz");
      if (halves.length > 1) return halves.length === 2 && depth && rate ? `Depth ${depth} · Rate ${rate}` : value;
      if (depth) return `Depth ${depth}`;
      if (rate) return `Rate ${rate}`;
    }
    if (rule.role === "capsule-pattern") value = value.replace(/\b\d+(?:\.\d+)?\s*mm\s*/gi, "").replace(/\bomnidirectional\b/gi, "Omni");
    if (profile === "arm" && rule.role === "fit") value = value.replace(/^PC\.\s*/i, "");
    if (rule.role === "fit" && /^Cloud /i.test(value)) {
      const parts = value.replace(/\s+headsets?\.?$/i, "").split(/,\s*|\s+and\s+/);
      if (parts.length > 2 && parts.every(part => /^Cloud /i.test(part))) value = `Cloud: ${parts.map(part => part.replace(/^Cloud /i, "")).join(", ")}`;
    }
    if (rule.role === "fit") value = value.replace(/(?:[.;]\s*)?(?:Software|System) compatibility:\s*.*$/i, "").trim();
    if (profile === "dock" && rule.role === "fit") value = value.replace(/^PS5\. Controller Compatibility:.*?Gaming Platform:\s*/i, "");
    if (profile === "mixer" && rule.role === "inputs") value = value.match(/^Microphone input\(s\):\s*([^;]+)/i)?.[1] || value;
    if (profile === "controller" && rule.role === "controls" && /^(?:features?|technical features)$/.test(key(item.label))) value = value.split(/\s*[·;]\s*/).filter(part => /trigger|programmable|reprogrammable|remap|paddle|rear button|back button|rumble|vibration|impulse|hall effect|interchangeable|haptic/i.test(part)).join(" · ");
    return value;
  }

  function select(product, { categoryId = "", specs = product?.specs } = {}) {
    const source = (Array.isArray(specs) ? specs : []).filter(item => item && !placeholder(item.value) && !administrative(item.label));
    const profileName = profileFor(product, categoryId, source), profile = profiles[profileName] || [];
    const selected = [], usedIds = new Set(), usedRoles = new Set();
    for (const rule of profile) {
      if (selected.length === MAX_ROWS) break;
      if (usedRoles.has(rule.role)) continue;
      const candidates = rule.names.flatMap(label => source.filter(item => key(item.label) === label && !usedIds.has(item))
        .map(item => ({ item, value: displayValue(item, rule, profileName, product) }))
        .filter(({ value }) => !placeholder(value) && (!rule.accept || rule.accept.test(value)) && (!rule.reject || !rule.reject.test(value)) && value.length <= (rule.maxLength || 160)));
      if (!candidates.length) continue;
      let items = rule.combine ? candidates : candidates.slice(0, 1);
      if (rule.role === "recording" && /^(?:record|recording) quality$/.test(key(items[0].item.label))) items = items.slice(0, 1);
      if (rule.role === "switch" && items.length > 1) items = items.filter(({ value }) => !/^HyperX Switch(?:es)?$/i.test(value));
      if (rule.role === "switch" && items.length > 1) items = items.filter(candidate => !/^(?:linear|tactile|clicky)$/i.test(candidate.value)
        || !items.some(other => other !== candidate && /^(?:switch model|switch)$/.test(key(other.item.label)) && new RegExp(`\\b${candidate.value}\\b`, "i").test(other.value)));
      const pieces = [], sources = [];
      for (const { item, value } of items) {
        const qualified = /^(?:yes|true|supported)$/i.test(value) ? rule.role === "monitor" ? "Yes" : text(item.label)
          : /^(?:no|false|not supported)$/i.test(value) ? rule.role === "monitor" ? "No" : `${text(item.label)}: No` : value;
        if (pieces.some(piece => comparable(piece) === comparable(qualified))) continue;
        if (pieces.join(" · ").length + qualified.length > 160 && pieces.length) continue;
        pieces.push(qualified); sources.push(item);
        usedIds.add(item);
      }
      if (!pieces.length) continue;
      const value = pieces.join(" · ");
      if (selected.some(item => comparable(item.value) === comparable(value) && item.role === rule.role)) continue;
      // A selected source is a projection. Saved rows, IDs, metadata and order
      // remain untouched and continue to be passed to the complete Details view.
      selected.push({ ...sources[0], label: rule.label, value, role: rule.role, sourceSpecIds: sources.map(item => item.id).filter(Boolean) });
      usedRoles.add(rule.role);
    }
    return selected;
  }
  root.PortfolioCardSpecs = Object.freeze({ MAX_ROWS, select, profileFor });
})(globalThis);
