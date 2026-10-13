# Reference theme

The workspace adopts the supplied industrial dashboard reference without adding a left sidebar or changing product organization. Existing product artwork, lanes, distinct card panels, category-specific purchase summaries, complete Details and editable PowerPoint groups remain in place.

`public/js/reference-theme.js` defines the semantic presentation colors and resolved font. It applies CSS custom properties before the first paint. CSS contains equivalent fallback values for documents opened without JavaScript. The canvas, lifecycle model, product detail status headers and PowerPoint export consume the shared presentation values.

| Role | Value |
| --- | --- |
| Page | `#1A1B1C` |
| Product and panel surface | `#242527` |
| Headers and raised controls | `#333538` |
| Value inputs | `#4D5054` |
| Labels | `#BBBCC0` |
| Values and headings | `#F2F4F8` |
| Reserved functional boundary cues | `#83858B` |
| Input placeholders | `#D5D7DC` |
| Embargo and alert marker | `#FF2525` |

Bright red fills use dark `#1A1B1C` labels. Longer error messages use pale red `#FF8A8A` on a dark alert surface. Routine new-product and lifecycle indicators use neutral shades and retain explicit text labels. Merchandise swatches, saved user color choices and legacy product-color normalization are independent of these presentation tokens.

Ordinary product cards, controls and specification rows use filled surfaces, bands and spacing instead of perimeter frames or repeated divider rules. Outlines remain for the selected product, keyboard focus and functional drag guides. Product color swatches retain their thin edge so light merchandise colors remain visible. The roadmap uses filled family header bands and quiet calendar alignment marks; product bars and horizontal row grids have no decorative borders. These same borderless card and roadmap shapes are exported as native editable PowerPoint objects.

Jost regular and italic variable font files are local assets, supplied by the [Google Fonts Jost repository](https://github.com/google/fonts/tree/main/ofl/jost) under the SIL Open Font License. The included license is `public/assets/fonts/Jost-OFL.txt`; no external font service is contacted at runtime. Canvas measurement and export wait for the required local font weights. If the assets fail to load, the workspace still opens and DOM, canvas and native PowerPoint recording share an Arial fallback.

Exported cards retain native, editable text, shapes and artwork. Slide theme fonts and text objects specify the same resolved face. PowerPoint needs Jost installed on the viewing or editing device for its exact font metrics; the font is not embedded in the deck. Existing fit-to-box behavior protects the layout if Office substitutes a font. No operating-system font installation is performed by the application.
