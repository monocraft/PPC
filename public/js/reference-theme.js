/* Shared presentation theme. Product data and merchandise color swatches stay independent. */
(function registerReferenceTheme(root) {
  "use strict";

  const colors = Object.freeze({
    page: "#1A1B1C", surface: "#242527", header: "#333538", input: "#4D5054",
    label: "#BBBCC0", text: "#F2F4F8", placeholder: "#D5D7DC", border: "#333538", borderStrong: "#676A70", controlBorder: "#83858B",
    alert: "#FF2525", alertSurface: "#331D1D", alertText: "#FF8A8A",
  });
  const stageColors = Object.freeze({
    launched: colors.input, "in-development": colors.borderStrong, "in-planning": colors.header,
  });
  const accents = Object.freeze({
    newProduct: colors.label, embargo: colors.alert,
    inDevelopment: colors.borderStrong, sunsetting: colors.input,
  });
  const lifecycleTones = Object.freeze({ ...stageColors, embargo: colors.alert, "end-of-life": colors.surface });
  // Compatibility names refer only to presentation colors. Saved color choices
  // use their own palette so adopting a theme never rewrites product metadata.
  const uiPalette = Object.freeze({
    trueBlack: colors.page, inkBlack: colors.page, carbon: colors.surface, jetBlack: colors.header,
    gunmetal: colors.input, greyOlive: colors.label, silver: colors.label, whiteSmoke: colors.text,
    amaranth: colors.alert, charcoal900: colors.page, charcoal800: colors.page,
    charcoal700: colors.header, charcoal600: colors.header, charcoal500: colors.input,
    indigoDark: colors.surface, indigo: colors.header, steelTeal: colors.borderStrong,
    steelTealLight: colors.label, midGrey: colors.label, foggyDark: colors.header,
    foggy: colors.label, starDust: colors.text, selection: colors.text,
  });
  const cssVariables = Object.freeze({
    "--color-page": colors.page, "--color-shell": colors.surface, "--color-surface": colors.surface,
    "--color-surface-raised": colors.header, "--color-header": colors.header, "--color-input": colors.input,
    "--color-surface-hover": colors.header, "--color-border": colors.border, "--color-border-strong": colors.borderStrong,
    "--color-control-border": colors.controlBorder, "--color-placeholder": colors.placeholder,
    "--color-text": colors.text, "--color-text-secondary": colors.label, "--color-text-muted": colors.label,
    "--color-accent": colors.text, "--color-on-accent": colors.page, "--color-emphasis": colors.label,
    "--color-emphasis-deep": colors.borderStrong, "--color-selection": colors.text,
    "--color-new-product": accents.newProduct, "--color-embargo": colors.alert,
    "--color-danger": colors.alert, "--color-danger-surface": colors.alertSurface,
    "--color-danger-border": colors.alert, "--color-danger-text": colors.alertText,
    "--color-planning": colors.label, "--workspace-surface": colors.page,
    "--color-stage-launched": stageColors.launched, "--color-stage-development": stageColors["in-development"],
    "--color-stage-planning": stageColors["in-planning"], "--color-status-sunsetting": accents.sunsetting,
    "--font-ui": '"Jost", Arial, sans-serif',
  });

  function apply(documentObject = root.document) {
    const style = documentObject?.documentElement?.style;
    if (!style?.setProperty) return;
    for (const [name, value] of Object.entries(cssVariables)) style.setProperty(name,
      name === "--font-ui" && fontFace === "Arial" ? "Arial, sans-serif" : value);
  }

  function alpha(color, opacity) {
    const hex = String(color).replace(/^#/, "");
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(",")},${Math.max(0, Math.min(1, Number(opacity)))})`;
  }

  let fontFace = "Jost";
  let fontReadyPromise;
  async function fontsReady(documentObject = root.document) {
    if (!documentObject?.fonts?.load) return false;
    // Load the weights used by DOM, canvas and editable PowerPoint recording
    // before measuring cards. Both font files are local, licensed site assets.
    if (!fontReadyPromise) fontReadyPromise = (async () => {
      try {
        const loaded = await Promise.all([400, 500, 600, 700, 800].map((weight) => documentObject.fonts.load(`${weight} 16px Jost`)));
        if (loaded.some((faces) => !faces.length)) throw new Error("The local presentation font is unavailable.");
        await documentObject.fonts.ready;
        return true;
      } catch (_) {
        // A font failure must never prevent opening or saving product data.
        // Canvas and native PowerPoint recording use the same resolved face.
        fontFace = "Arial";
        documentObject.documentElement?.style?.setProperty?.("--font-ui", "Arial, sans-serif");
        return false;
      }
    })();
    return fontReadyPromise;
  }

  root.PortfolioTheme = Object.freeze({ colors, stageColors, accents, lifecycleTones, uiPalette,
    cssVariables, get fontFace() { return fontFace; }, get cssFontFamily() { return fontFace === "Arial" ? "Arial, sans-serif" : cssVariables["--font-ui"]; }, alpha, apply, fontsReady });
  apply();
})(globalThis);
