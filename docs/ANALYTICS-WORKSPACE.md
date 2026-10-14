# PPC Analytics workspace

PPC keeps one **Analytics** entry alongside its portfolio tools. Inside that workspace, **Retail** and **Portfolio plan** group the two analysis purposes. A module's analysis views appear within the workspace instead of adding another button to the main PPC toolbar.

## Retail

The Retail module retains the existing report importer, filters, weekly timeline, product and retailer analysis, Data view, price mappings, encrypted exports and saved work. Its database remains `ppc-retail-analytics-v1`; changing the workspace navigation does not migrate or replace saved retail data.

The existing explicit Analytics click from PPC can still connect the minimal local USD pricing projection. That capability remains separate from module selection. The connection does not transfer the portfolio master, credentials or lifecycle data.

## Portfolio plan

The Portfolio plan module contains the HX Blueprint analysis: Overview, Performance, Products & NPI, Investment, Scenarios, and Source & quality. Its category choices and year timeline share the Portfolio Explorer pane. These views retain source evidence and separate saved historical results, planning assumptions and scenario sensitivity.

Category choices support multiple selections. Each selected category keeps the same color in its tile, timeline and analytical charts. All categories returns to the combined portfolio view; individual toggles add or remove a category. Summary figures, product scope and scenarios use the combined selection. Gross margin uses the applicable revenue-weighted source definition, with raw product gross profit divided by revenue retained separately; percentages are never summed or averaged indiscriminately.

When multiple categories are selected, **Trend** is the default chart scale. Every category starts at 100 in the earliest common year with a positive source value for all selected categories. An index of 120 means a 20% increase from that base year. This allows a smaller category to remain visible beside Headsets. The legends retain actual USD amounts. **Values** restores a shared absolute-value scale and source category targets. Margin charts keep their percentage scale. Missing observations remain gaps; when no valid common baseline exists, the view explains why it is showing source values instead. Changing scale does not alter source totals or scenario baselines.

The timeline plot has 156px of vertical room on desktop and 125px on small screens. Its marker and overlaid traces use the same geometry. Contextual source dialogs are positioned within the visible host viewport even when the embedded analysis is long.

The published module contains the interface and local workbook reader. It does not contain the populated HX workbook snapshot, audit rows or a bundled `data.js` payload. Choose the workbook on the device to load an imported source. The browser reads saved formula results and does not run Excel, VBA or Power Query, or recalculate changed workbook formulas.

Portfolio plan stores its own imported source locally and remains independent of the Retail workspace and PPC master. A failed import leaves the prior source available. Workbook import and analysis navigation do not write portfolio products, roadmap dates or shared backend facts.

Scenario controls show the effect of stated revenue, margin and spend assumptions. They do not establish a fitted prediction or a statistically validated forecast. Source and quality views explain the limits that apply to each result.

## Module lifecycle and messages

`public/analytics.html` is the shared entry and retains the existing Retail DOM and script order. `js/analytics-workspace.js` controls the outer module tabs and contextual analysis navigation. Portfolio plan runs in a retained same-origin frame, which isolates its identifiers, styles and workbook state from Retail. Switching modules does not recreate the frame or discard its current selection.

The parent accepts only messages from the expected frame window and the current origin, with supported message types and allowlisted analysis views. It sends commands to that same origin. Navigation messages carry view and lifecycle information; they do not carry workbook rows or pricing credentials. Unsupported views, unexpected senders and unrelated origins do not change the active analysis.

Hiding a module is distinct from hiding the browser tab. Playback must stop when its module is deactivated. When Retail becomes visible again, it redraws charts against the visible surface while retaining its source, filters and current analysis. Its global file-drop handlers must apply only while Retail is active so a Blueprint import cannot replace the Retail workspace.

## Local review and deployment boundary

The shared interface can be reviewed locally without contacting Supabase. Imported sources remain on the device; the integration adds no live backend polling or data publication. The populated standalone Blueprint review under `outputs/` remains outside the published site.

Site preparation must include the hub stylesheet, hub controller and complete data-free Blueprint asset directory. Deployment versioning includes the Blueprint entry page so its scripts and styles receive the same release version as the shared workspace.

Run `node scripts/checks/analytics-workspace.mjs` for the integration contract. Existing Retail checks continue to cover source calculation, independent storage, importer behavior, pricing projection, private packages and deployed asset closure. The integration check additionally covers module routing, retained frame state, message trust and publication boundaries. These checks use local code and isolated fixtures; they do not call a live backend.
