/* Shared presentation theme. Product data and merchandise color swatches stay independent. */
(function registerReferenceTheme(root) {
  "use strict";

  const colors = Object.freeze({
    page: "#1A1B1C", surface: "#242527", header: "#333538", input: "#4D5054",
    label: "#BBBCC0", text: "#D5D7DC", placeholder: "#D5D7DC", border: "#333538", borderStrong: "#676A70", controlBorder: "#83858B",
    alert: "#FF2525", alertSurface: "#331D1D", alertText: "#FF8A8A",
  });
  const stageColors = Object.freeze({
    launched: colors.input, "in-development": "#56595E", "in-planning": colors.header,
  });
  const accents = Object.freeze({
    newProduct: colors.label, embargo: colors.alert,
    inDevelopment: stageColors["in-development"], sunsetting: colors.input,
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
  // Secondary chart tones sampled from the owner's supplied palette image.
  // Keep these separate from semantic UI, lifecycle and merchandise colors.
  const chartPalette = Object.freeze({
    purple: Object.freeze({ 20: "#D5C9FA", 40: "#AA8DF9", 80: "#6338E0", 100: "#433276" }),
    indigo: Object.freeze({ 20: "#C4CEF9", 40: "#879DF1", 80: "#4362D4", 100: "#313E9C" }),
    blue: Object.freeze({ 20: "#A3E0FC", 40: "#63C0F9", 80: "#3C8AEC", 100: "#2B5AAC" }),
    teal: Object.freeze({ 20: "#B9F4F2", 40: "#82EBF1", 80: "#0391A9", 100: "#005D6F" }),
    green: Object.freeze({ 20: "#B9F8DD", 40: "#85F0B8", 80: "#5BC794", 100: "#508D7B" }),
    yellow: Object.freeze({ 20: "#FFEAB5", 40: "#FFD569", 80: "#FFB420", 100: "#CE8C4F" }),
  });
  // The larger reference cards provide brighter series colors for dark charts.
  // Order is fixed: purple, indigo, blue, teal, green, yellow.
  const chartSeries = Object.freeze(["#895EF6", "#6984ED", "#4DA1F7", "#20CBDD", "#7AE3A9", "#FFC63B"]);
  // Product card palettes stay independent of timeline stage colors and saved
  // merchandise swatches. These opaque shades also export to PowerPoint.
  const productCardStyles = Object.freeze({
    "in-planning": Object.freeze({ accent: chartSeries[5], surface: "#3E3829", footer: "#4B412D", outline: "#8A6E32", muted: chartPalette.yellow[40] }),
    "in-development": Object.freeze({ accent: chartSeries[2], surface: "#293440", footer: "#2C3F54", outline: "#3E6A98", muted: chartPalette.blue[40] }),
    embargo: Object.freeze({ accent: "#A52F3F", surface: "#3D282D", footer: "#4C2C33", outline: "#9E4B5A", muted: "#FFB8C2", label: "#FFFFFF", selection: "#FFB8C2" }),
  });
  function productCardStage(product) {
    if (product?.statusType === "embargo" || product?.roadmap?.status === "embargo") return "embargo";
    if (product?.statusType === "in-development") return "in-development";
    const stage = product?.roadmap?.status;
    return Object.hasOwn(productCardStyles, stage) ? stage : "";
  }
  // Utilities follow the card's hue while remaining quieter than its banner.
  const neutralActions = { name: "neutral", surface: "#2B2D30", ink: "#8B8E94", hover: colors.header, hoverInk: colors.text, active: "#404246", focus: colors.text, divider: "#44464A" };
  const productActionStyles = Object.freeze({
    neutral: Object.freeze(neutralActions),
    "in-planning": Object.freeze({ name: "in-planning", surface: productCardStyles["in-planning"].footer, ink: "#BFA45F", hover: "#564A31", hoverInk: chartPalette.yellow[40], active: "#625334", focus: chartPalette.yellow[40], divider: "#78663D" }),
    "in-development": Object.freeze({ name: "in-development", surface: productCardStyles["in-development"].footer, ink: "#65A4CE", hover: "#304D6B", hoverInk: chartPalette.blue[20], active: "#365A7D", focus: chartPalette.blue[40], divider: "#406384" }),
    embargo: Object.freeze({ name: "embargo", surface: "#33282A", ink: "#AC7E7E", hover: "#403033", hoverInk: colors.alertText, active: "#493537", focus: colors.alertText, divider: "#664345" }),
    discontinued: Object.freeze({ ...neutralActions, name: "discontinued", ink: "#FFFFFF", hoverInk: "#FFFFFF", focus: "#FFFFFF" }),
  });
  function productActionStyle(product, discontinued = false) {
    if (discontinued) return productActionStyles.discontinued;
    if (product?.statusType === "embargo" || product?.roadmap?.status === "embargo") return productActionStyles.embargo;
    return productActionStyles[productCardStage(product)] || productActionStyles.neutral;
  }
  const chartCssVariables = Object.freeze(Object.fromEntries([
    ...Object.entries(chartPalette).flatMap(([name, tones]) => Object.entries(tones)
      .map(([tone, value]) => [`--chart-${name}-${tone}`, value])),
    ...chartSeries.map((value, index) => [`--chart-series-${index + 1}`, value]),
  ]));
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
    ...chartCssVariables,
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
    chartPalette, chartSeries, productCardStyles, productCardStage, productActionStyles, productActionStyle, cssVariables, get fontFace() { return fontFace; }, get cssFontFamily() { return fontFace === "Arial" ? "Arial, sans-serif" : cssVariables["--font-ui"]; }, alpha, apply, fontsReady });
  apply();
})(globalThis);
