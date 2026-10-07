# Feature Index

Source inventory: 2026-10-07. This index describes implemented behavior in the checked-in application. Function names identify the code responsible for each feature; they are search anchors that remain useful when line numbers change. Runtime/browser verification is tracked separately in [Continuation Guide](CONTINUATION-GUIDE.md).

The browser application lives in `public/`; the local server and Pages workflow serve that directory's contents as the site root. Application modules are under `public/js/`, styles under `public/css/`, and development checks under `scripts/checks/`. The root README is the short public introduction.

## Workspace and navigation

| Feature | Behavior | Implementation |
| --- | --- | --- |
| Category workspaces | Maintain an independent board, lanes, products, title, and roadmap labels per known catalog category. A category dropdown stays in the top toolbar; the selection summary shows the active category's count. Changing category selects its first product, clears searches and transient editing, and keeps the active category in saved data. | `activateCategory`, `activeCategoryRecord`, `PortfolioWorkspaceUI.refresh` |
| One settings home | Workspace settings groups Display, Timeline, Category, and Data & export. The timeline range shortcut opens the same settings panel. Edit product stays beside the selection; manual Add product is available as a Category admin action while the workspace header is visible. | `public/js/workspace-ui.js`, `workspaceSettingsDialog` |
| Settings keyboard access | Settings tabs support arrows/Home/End; Tab stays inside the modal; Escape/backdrop/Done close it and restore focus. The main app is inert while the modal is open. | `PortfolioWorkspaceUI.openSettings/closeSettings` |
| Empty portfolio/category | First launch and a portfolio with zero products hide the entire top header, view tabs, search/sort/zoom controls, selection row, and bottom status bar; the empty-state actions retain Pull latest data and Import package across the full viewport. Loading products restores the header and status bar automatically. An empty active category keeps navigation and status when another category has products, and a zero-match search keeps its controls. Manual Add product remains in Settings → Category while the header is available. Package import replaces the whole workspace; advanced ASCM import is available only in Settings → Data & export as a reviewed additive update. | `workspaceEmpty`, `emptyPullLatestData`, `emptyImportPackage`, `importAscm`, `PortfolioWorkspaceUI.refresh` |
| Two primary views | Products and Roadmap are the only main tabs. Category navigation remains in the toolbar; there is no category sidebar. | `public/index.html`, `setView` |
| Prominent PowerPoint export | Export PPTX is a primary toolbar action in both views. Choose Product Portfolio, Roadmap, or Both and one, multiple, or all categories. All are selected initially; Current category only selects the active category, and Select all/Clear selection changes the checklist. | `exportPptx`, `openPptxExportDialog`, `renderPptxExportCategories`, `setPptxCategorySelection` |
| Product cards | Compare products in ordered horizontal rows within category lanes. | `productCardLayout`, `drawBoardTo`, `drawCard`, `renderBoard` |
| Roadmap | Display launch-to-lifecycle-end bars grouped by family with a compact year/quarter/month header. Large years lead; quarter/month text uses sparse separators rather than boxed bands. There is no half-year header row. | `roadmapGroupsForProducts`, `roadmapDimensions`, `drawRoadmapTo` |
| Optional Roadmap details | Show/hide a selected-product hero and shared read-only details beside the category roadmap. Overview opens first; selecting a bar changes the product. This is a Roadmap option rather than a third main view. | `toggleRoadmapDetails`, `roadmapDetailsOpen`, `setView`, `renderSplitProduct`, `PortfolioDetails.render`, `renderRoadmaps` |
| Linked selection | Product, roadmap details, editor, and the information drawer use the same product selection. A product double-click opens Roadmap; a double-click on the plain Roadmap opens its details pane. The linked-view button switches between Products and Roadmap. | `selectedProduct`, `setView`, `updateLinkedViewButton`, canvas pointer/double-click handlers |
| Quiet selection | Card borders remain neutral charcoal. A selected card gets a thin `#6e7973` line and a small Selected marker beside Details/Close; a selected Roadmap bar gets a fine outline and leading mark. Neither surface uses a white selection glow. Status accents remain in primary card banners and roadmap fills; secondary platform badges stay neutral. | `UI_PALETTE.selection`, `drawCard`, `drawRoadmapTo` |
| Protected editing | Product data, card reordering, and roadmap date dragging require explicit edit controls. Selecting or panning in ordinary viewing does not change product data. | `openInspector`, `productLayoutEditing`, `roadmapSlotEditingActive` |
| Clear/close | Clicking empty canvas space clears selection. Escape closes overlays, then exits card layout mode or slot mode, closes the editor, or clears selection. | `clearSelection`, global `keydown` handler |
| Responsive layout | Canvases scroll on narrower screens. The inline pane matches its parent card's rendered height and can extend horizontally beyond the viewport. Its dates/lifecycle and specifications occupy separate, keyboard-focusable scroll regions. Shared Roadmap details adapt the same content to a narrower panel. | `public/css/styles.css` breakpoints, canvas scroll containers, `viewerInfoVisualHeight`, `setViewerInfoSize` |
| Status footer | Shows category product/lane counts, active view, latest ASCM import, storage description, and interaction guidance. | `renderStatus` |

The default catalog has **11 categories, 16 lanes, 18 specification templates, and no products**. Import a workspace/package or add products to populate it. Asset files by themselves do not create cards.

## Product comparison features

| Feature | Behavior / limits | Implementation |
| --- | --- | --- |
| Product search | Case-insensitive substring search across name, codename, tier, card status/banner, HP SKUs, variant-group labels/codes/colors/layout names, and specification labels/values. Does not delete hidden products. | `visibleProducts` |
| Sorting | Apply Name A–Z, price low–high/high–low, status, or most variant SKUs. Writes persistent order independently within each lane. Custom order leaves the existing order unchanged. | `applySort`, `normalizeLaneOrders` |
| Card MSRP | Shared saved MSRP is formatted in USD with two decimals; a meaningful text label is the fallback only when no valid numeric amount exists. Blank/invalid amounts and unknown/TBD placeholder labels show no price. Active-category card visibility does not change saved price or Roadmap visibility. | `PortfolioModel.msrpText`, `productPriceText`, `drawCard`, `board.settings.showPrices` |
| Specification display | Compact cards share a content-based category height between 300–552 logical pixels and show a specification subset. A muted `+N specifications` note reports overflow; all specs open through the single Details action. Filtering retains the same card height. Full-spec cards expand without a height cap for supported categories; categories without specs use compact cards. Values can wrap and related matrix values share rows. | `productCardLayout`, `detailedSpecRows`, `drawDetailedSpecs`, `drawCard`, `openViewerInfo` |
| SKU footer | Color and layout groups appear in compact footers. The footer display can be disabled per category. Overflow uses a `+` chip and popover. | `variantFooterLayout`, `drawVariantFooter`, `openVariantPopover` |
| Hero previews | Hover a color variant with an assigned image to preview it; click to pin/unpin that comparison. Featured variant image is the saved default when assigned; main image is the fallback. | `activeHeroVariant`, `setHoveredHeroVariant`, `togglePinnedHeroVariant`, `productDisplayImageAssetId` |
| Unified Details action | One compact charcoal Details button per card opens the adjacent read-only pane; its label changes to Close while open. Enter on the focused Products canvas toggles the selected card's details. Overview places six dates/lifecycle beside every specification with independent keyboard-focusable overflow; HP SKUs and More match Roadmap details. A compact header keeps the name, tabs, and close control together. The pane retargets with selection. | `drawProductInfoButton`, `hitInfoButton`, `openViewerInfo`, `renderViewerInfo`, `PortfolioDetails.render`, canvas `keydown` handler |
| Parent-height inline pane | The pane's top and bottom align exactly with its rendered parent card at 20–150% zoom, including full-spec cards. Content never increases the frame, lane height, canvas height, or lower-row positions. Width is 540 px normally, 680 px for a parent at most 280 px tall, and 720 px for a parent at most 180 px tall. Short parents use two specification columns only when every normalized value is at most 80 characters; long values retain one column and wrap. Opening reserves horizontal space and shifts only later cards in the same lane; closing/filtering removes that reserve. | `viewerInfoVisualWidth`, `viewerInfoVisualHeight`, `setViewerInfoSize`, `viewerInfoReserveLogical`, `productLaneGeometry`, `getCanvasDimensions`, `positionViewerInfo` |
| HP SKU identity and copy | Both detail surfaces use Color / HP SKU / Copy rows with explicit names and one/two-tone swatches. Color comes from a manually assigned variant or the exact ASCM Base PN record. Unmapped SKUs say Not assigned. Copy is also available in the editor with success/failure feedback. | `PortfolioModel.resolveSkuColors`, `PortfolioDetails.render/bind`, `copyTextToClipboard` |
| Zoom | Product zoom is session state, bounded to 20–150%; `+`/`−` steps by 10%, reset returns to 100%. Automatic category fit stays at 65–100% for readable labels; extra lanes scroll vertically. Switching category recalculates this fit. | `fitProductLanesVertically`, product zoom handlers |
| Fit products | Fits the longest visible lane horizontally, bounded by product zoom limits. | `fitProductBoard` |
| Reset layout | Returns zoom to 100%, removes legacy manual-position data, normalizes lane order, and retains the current relative order. | `resetLayout` handler |
| Reorder cards | Explicit layout mode enables lane-aware dragging, insertion into the target row/order, and edge auto-scroll. Free-position layout is not supported; schema normalization disables legacy free move. | `reorderProduct`, `finishDrag`, `ensureBoardSchema` |
| Horizontal navigation | Pointer drag pans; horizontal wheel/Shift-wheel navigates; slider, left/right steps, and Show selected provide direct navigation. Product canvas ArrowLeft/ArrowRight scroll by 180 px. | `syncBoardNavigator`, `scrollSelectedIntoView`, pointer/wheel/keydown handlers |

## Product editing

Edits in the product editor take effect immediately and use the debounced workspace save. Category structural settings use a separate draft with Save/Cancel.

The editor groups its controls into **Details**, **Images**, **Specs**, **Variants**, and **Timeline** tabs through `setupEditorNavigation`. Details contains product identity/pricing/status, the six key dates, and HP part numbers; Images collects the main/colorway assets; Specs contains the editable field list/common sets; Variants contains color/layout groups; Timeline contains lifecycle context and relationships, with an Edit dates in Details shortcut to the general-availability field. Adding specification fields reads the current selected product, so changes made earlier in the open editor are retained.

| Section | Editable fields and actions | Data |
| --- | --- | --- |
| Product | Name, MSRP (USD), price label used only when numeric MSRP is blank/invalid, lane, image URL, uploaded image, clear image/use placeholder. Clearing MSRP saves null; zero remains a valid saved amount. | `name`, `price`, `priceLabel`, `laneId`, `imageAssetId` |
| Portfolio identity | Category move, codename, product tier: Not set, Core, Core+, Hero, Star, Star+. Moving transfers the same product to the destination's first ordered lane and opens it there. | `moveProductToCategory`, `codename`, `tier` |
| Key dates | Details is the single editor for general availability, end of manufacturing, FFS, global announcement, web readiness, and final assets. A populated GA/EM edit updates its corresponding roadmap month. Blank/TBD clears the exact date and retains the planned month; it does not invent a day. Other milestones retain their separate meaning. Existing saved date/month differences are preserved at load. | `generalAvailabilityDate`, `endManufacturingDate`, `ffsDate`, `globalAnnouncementDate`, `webReadinessDate`, `finalAssetsDate`, `PortfolioModel.mergeProductUpdate` |
| HP part numbers | Add, edit, copy, remove, and explicitly assign a color variant to individual HP SKU records. A manual variant link takes precedence over source color codes. | `partSkus[]`, `variantId`, `colorCode`, `PortfolioModel.resolveSkuColors` |
| Colorway hero images | With at least two color variants, assign URL/uploaded images per colorway, remove assignments, and choose a featured default image. | variant `imageAssetId`, `featuredVariantId` |
| Card status | Standard None, New product, Upcoming under embargo labels. A saved status label takes priority as the main banner, including Console products with platform labels. New product uses teal `#5fd6c1`; embargo status or stage uses red `#ef5b5b` and takes precedence. Otherwise banner tone follows manual lifecycle stage. Card borders remain neutral. | `statusType`, `statusLabel`, `STANDARD_CARD_STATUSES`, `productPresentation`, `PortfolioModel.productTone` |
| Variant/platform label | Enable/disable a custom label. When a standard status is present, a distinct variant/platform label becomes a quiet secondary badge in cards and Roadmap details; otherwise it is the main banner. Duplicate status/variant labels do not add another badge. Saved labels/statuses remain unchanged; legacy custom-color fields are retained but ignored by display. Merchandise colorways keep separate real colors. | `variantLabel`, `productPresentation.primaryLabel/secondaryLabel`, `drawCard`, `renderSplitProduct` |
| Roadmap slot | Family, stage, confidence, predecessor, successor; date synchronization guidance and Edit dates in Details replace duplicate month inputs. Protected roadmap dragging still adjusts the planned months and synchronizes known GA/EM dates. Launch/start remain the same month; lifecycle end is clamped to launch or later. | `roadmap`, `updateRoadmap`, `editProductDates`, `PortfolioModel.mergeProductUpdate` |
| Roadmap stages | Launched, In development, In planning, Under embargo, End of life. Legacy statuses normalize into these values. | `normalizeRoadmapStatus` |
| Confidence / relationships | Low/medium/high confidence; predecessor and successor reference other products in the same category. Stored relationships are not reciprocal automatically. | `roadmap.confidence`, `predecessorId`, `successorId` |
| Specifications | Add a field, edit its label/value, remove a field, or add only the missing labels from a category common set. Common sets do not overwrite existing labels/values. | `specs[]`, `categorySpecSets`, `renderInspector` |
| Variant groups | Add/remove groups; change type between color and layout; edit footer label; add/remove variant items. Type conversion retains code and transforms display attributes. | `variantGroups[]`, `updateProductVariantGroups` |
| Color variants | SKU code, primary merchandise color, optional secondary color, custom color names and hex values. Supports two-tone colorways. | `normalizeColorVariant`, `STANDARD_PRODUCT_COLORS` |
| Layout variants | Locale code and optional display name; preset selector and Add common set append missing presets. | `normalizeLayoutVariant`, `COMMON_KEYBOARD_LAYOUTS` |
| Add product | Settings → Category admin action, available for empty and populated categories while the portfolio has products. A wholly empty portfolio starts through its pull/import actions. Create a product in the first ordered lane with New product status, category default specification fields, a default variant group, and a current-month planning roadmap. | `addProduct`, `makeProduct` |
| Delete product | Explicit confirmation removes the selected card and unused main/variant image assets; selects the first remaining product. There is no undo history. | `deleteSelected`, `removeImageAssetIfUnused` |

**Merchandise color presets (18):** Black, White, Gray, Silver, Red, Orange, Yellow, Green, Blue, Navy, Cyan, Teal, Purple, Lavender, Pink, Brown, Beige, Gold. Preset codes and swatches describe products and remain independent of the charcoal interface theme.

**Keyboard locale presets (16):** US, UK, FR, GR, SP, PORT, IT, JPN2, KOR, TW, TURK, THAI, LTNA, NRL, SWIS2, SAU. Custom codes are accepted.

## Compact read-only details

Product cards' information drawer and the optional Roadmap details pane share `public/js/product-details.js`, which renders one structured model from `productDetailsModel()`:

| Tab | Content and paging |
| --- | --- |
| Overview (first/default) | All six dates—GA, EM, FFS, global announcement, web readiness, final assets—plus stage/confidence and the entire specification label/value list together. Empty exact dates display TBD. Planned launch/end appear only when the exact date is missing or its month differs; matching month duplicates are omitted. Specifications have no separate tab or paging controls. |
| HP SKUs | Color / SKU / Copy table, five part numbers per page. |
| More → Identity | Category, lane, codename, tier, family. |
| More → Variants | Color/layout codes and labels, eight variants per page. |
| More → Source | ASCM category/import date plus exact per-PN description/GA/EM, two source records per page. |

Each surface remembers its selected tab/subtab for the session; changing product resets secondary-list page positions. Tab arrows/Home/End support keyboard navigation. Previous/next controls show page and entry counts for SKUs, variants, and source records. Overview keeps every specification in one continuous list. The information drawer has a complete border and a 10 px gap from the card; its height always matches the rendered parent. Dates/lifecycle and specifications scroll independently inside that frame. Its compact widths are 540/680/720 px at the height thresholds above; the optional Roadmap panel adapts the same content to its narrower space.

Date labels reserve two text lines so paired date values share a baseline even when one label wraps. General availability, FFS, and planned launch use the shared teal `#5fd6c1`; end of manufacturing and planned end use the embargo red `#ef5b5b`. Whitelisted date/lifecycle keys provide semantic style hooks. Overview shows each known milestone once, retaining explicitly labeled planned context when no exact date exists or saved months differ. Specification labels and values sit closer together, with wrapping for long text across all categories.

The open drawer reserves horizontal space throughout its reveal animation. Only later cards in the selected lane shift aside; lane heights, lower-row positions, and canvas height stay fixed. The derived spacing is session state, not a saved lane/schema change. There is no second all-specifications popup.

## Roadmap features

| Feature | Behavior / limits | Implementation |
| --- | --- | --- |
| Family grouping | Category default or saved family order precedes unknown alphabetical families. Within a family products sort by launch month, then name. | `roadmapFamilyOrder`, `roadmapGroupsForProducts` |
| Roadmap search | Search name, codename, tier, family, stage, confidence, status/banner, HP SKUs, and variant metadata. Specification fields are not included. | `visibleRoadmapProducts` |
| Timeline presets | Global 3-, 5-, and 10-year ranges begin in January of the selected start year and end in December of the last year. Every category uses the chosen range, including exports. Fit runs after selecting a preset. | `setRoadmapYearSpan`, `updateTimelineSettings` |
| Custom range | Global month-level From/To range with an invalid end adjusted after start. Viewing-range changes do not modify product launch/lifecycle dates. | `roadmapRange`, `PortfolioModel.syncTimelineSettings` |
| Snap interval | Global Month, quarter, half-year options map to 1, 3, and 6-month drag increments. | `roadmapSnapIncrement`, `settings.timeline.snap` |
| Product/stage presentation | Primary card banners and timeline fills share fixed tones with contrast-aware text. Embargo status or stage uses red `#ef5b5b` first; New product uses teal `#5fd6c1`; other products follow their manually selected stage's subtle tone. Settings show a legend instead of editable colors. Card borders, secondary platform badges, rails, header, row surfaces, and bottom padding remain charcoal; merchandise swatches preserve their real colors. Selection uses a fine neutral outline/mark without a white glow. | `PortfolioModel.THEME_ACCENTS`, `PortfolioModel.productTone/lifecycleTone`, `roadmapStatusColor`, `drawRoadmapTo` |
| Roadmap MSRP | Portfolio-wide option controls both bar labels and the optional details pane. Both use the same saved MSRP as product cards; unknown prices leave no TBD placeholder or empty separator. Card visibility is independent. Both switches are grouped in Settings → Display. | `PortfolioModel.msrpText`, `roadmapProductBarLabel`, `renderSplitProduct`, `settings.showRoadmapMsrp` |
| Sticky context | Family/category rail and 88 px calendar header remain visible while scrolling. Family headings and whitespace separate groups; year seams provide strong calendar boundaries. The selected bar has an outline and a quiet launch-month underline; no lifecycle box overlays the month labels. | `drawRoadmapTo`, `ROADMAP_HEADER_HEIGHT` |
| Adaptive calendar labels | Wide months use full/abbreviated names; medium widths use numeric months. At the narrowest fit, quarter-start month names remain readable while intermediate labels are omitted. | `drawRoadmapTo` |
| Today | The current date marker appears when inside the range; Go to today centers the current month. The control does not change the configured range. | `scrollRoadmapToday`, `drawRoadmapTo` |
| Fit / selected navigation | Fit scales month width to the selected range (8–112 px per month); Show selected centers its launch slot. | `fitRoadmapTimeline`, `scrollRoadmapSelected` |
| Protected drag editing | Enable editing for the selected product; edge handles adjust launch/end and center grip moves the complete duration. Moving a known GA/EM into another month preserves its day where possible and clamps to the month's last day when needed. A blank/TBD exact date stays unknown. Ordinary bar-body drag still pans. Another selection, Escape, or category change exits the slot mode. | `bindRoadmapCanvas`, `roadmapDraft`, `updateRoadmap`, `PortfolioModel.mergeProductUpdate` |
| Drag boundaries | End never precedes start. Edge auto-scroll supports dates outside the immediate viewport. Drag completion saves drafted months together with any synchronized known GA/EM dates. | roadmap pointer handlers, `PortfolioModel.mergeProductUpdate` |
| Shared details-mode roadmap | Roadmap with its optional details pane uses the same renderer, selection, and protected editing behavior. Its second canvas and `split` internal state names are retained implementation details, not a third main view. | `bindRoadmapCanvas`, `renderRoadmaps`, `splitRoadmapCanvas` |

## Settings ownership map

Settings should be changed according to their scope. View state such as zoom, search, selection, hover preview, pan/scroll, and temporary edit modes is held in memory and is not part of the saved portfolio.

| Settings section | Controls / scope |
| --- | --- |
| Display | Grouped MSRP switches: active-category product cards and portfolio-wide Roadmap bars/details, plus saved-price availability count/help. Active-category SKU footer/full specifications; Fit products and Reset layout actions. |
| Timeline | Portfolio-wide 3/5/10-year preset, From/To, snap interval, fixed stage/status legend; Go to today, Fit timeline, Show selected actions. |
| Category | Active-category Add product admin action (always available), Edit selected product, Edit selected roadmap slot, Reorder product cards, and Category settings (names/title/side label/lane draft). |
| Data & export | Separate Import (bring files into this workspace) and Export (save copies to your device) panels. Import contains additive ASCM preview/update, replacement package/data imports, Pull latest data, and Restore previous workspace. Export contains keyed encrypted master packages, optional unprotected private backups, lightweight data, and active-category PNG. Clear all products is a separate row below both panels; PPTX remains the prominent toolbar action in both views. |

The Data & export layout uses `dataImportTitle`, `dataExportTitle`, `.data-direction-grid`, and `.data-reset-row`. Panels sit side by side on desktop and stack on narrow screens. ASCM offers an additive preview; package imports and pulls validate and stage a complete replacement. Export project package opens the key dialog: reuse the current key or Create new key, then Export package downloads `master_ppc.pkg`; copy the key before Done. Protection is selected by default; an unprotected package is an explicit private-backup choice. Package exports include all available uploaded images and URL references; missing saved local binaries block a complete export. Lightweight data exports include references without image binaries.

PPTX scope/category choices are session UI state, not portfolio metadata. The checklist preserves portfolio order, shows each category's product count, and remembers its choice until reload. The summary recomputes category/slide counts from the chosen content and selected boards; Export is disabled with no selected category, while Cancel still works.

| Setting | Saved scope/key | Purpose |
| --- | --- | --- |
| Active category | `portfolio.activeCategoryId` | Category opened on reload. |
| Roadmap MSRP | `portfolio.settings.showRoadmapMsrp` | Saved-price display on bars and details across all categories, independent of card visibility; edited in Display. |
| Roadmap range | `portfolio.settings.timeline.startMonth/endMonth` | Authoritative viewport bounds for every category. |
| Roadmap snap | `portfolio.settings.timeline.snap` | Slot drag increments for every category. |
| Legacy stage-tone data | `portfolio.settings.timeline.statusColors` | Kept for schema/import compatibility; display uses fixed `PortfolioModel.productTone` status/stage rules rather than an editable palette. |
| Category name | `categories[].name` | Display name in category navigation/exports/details. |
| Board title | `categories[].board.title` | Product board header. |
| Lanes | `board.lanes[]` | ID, label, subtitle, and order for this category. |
| Show card MSRP | `board.settings.showPrices` | Saved-price display on this category's cards only; independent of Roadmap visibility and price data. |
| Show SKU footer | `board.settings.showSkus` | Variant footer on product cards. |
| Full specifications | `board.settings.fullSingleLaneSpecs` | Expanded product specifications where supported. |
| Roadmap compatibility copies | `board.settings.roadmap.startMonth/endMonth/snap/statusColors` | Synchronized copies of the global timeline for render/export compatibility. |
| Roadmap side label | `board.settings.roadmap.categoryLabel` | Vertical category label. |
| Family order | `board.settings.roadmap.familyOrder` | Family grouping order; defined by catalog/imported data, without a dedicated reorder editor. |
| Legacy free move | `board.settings.freeMove` | Normalized to false; saved compatibility field. |

`PortfolioModel.msrpText(product)` accepts a nonblank finite numeric amount at or above zero, including numeric strings, and formats USD to two decimals, including a real zero as `$0.00`. Numeric MSRP takes precedence over `priceLabel`. Otherwise a meaningful trimmed label such as `$ Varies` or `Contact sales` can display; unknown labels such as Price TBD, Not set, N/A, or a dash produce no text. `pricingAvailability` counts products with displayable saved prices across all categories. Visibility changes never overwrite `price` or `priceLabel`; the current ASCM importer does not import MSRP.

Version 4 remains the storage schema. A fresh workspace starts at January 2026 through December 2030. An older workspace without `settings.timeline` inherits its saved active category's range/snap once; the new root timeline then becomes authoritative and is copied into every category. Presentation uses fixed subtle stage tones plus the New product/embargo theme accents; merchandise color choices remain business data.

## Category and common-specification inventory

Lane labels, specification fields, and family defaults are catalog templates; users can change saved category labels/lanes independently. Only keyboards default to layout variants; all other categories default to color variants. Gaming Accessories explicitly supports full-spec cards across multiple lanes; single-lane categories support full-spec cards automatically.

| Category ID | Default lanes | Common sets (default first) | Default family order |
| --- | --- | --- | --- |
| `pc-gaming-audio` | WIRED; WIRELESS | wired-headset; wireless-headset | Jet, Stinger, Flight, Cloud, Alpha, Openback, Other |
| `console-gaming-audio` | WIRED; WIRELESS | console-headset | Stinger, Flight, Cloud, Other |
| `lifestyle-audio` | WIRED; WIRELESS | wired-lifestyle; wireless-lifestyle | Cloud Mini, Earbuds, MIX, Other |
| `audio-accessories` | ACCESSORIES | sound-card; headset-customization | Sound Card, Headset Customization, Other |
| `microphones` | MICROPHONE | gaming-microphone | SoloCast, DuoCast, QuadCast, FlipCast, Other |
| `microphone-accessories` | INTERFACE / ACCESSORIES | audio-interface; microphone-accessory | Interface, Accessories, Other |
| `keyboards` | KEYBOARD | gaming-keyboard | Eve, Origins 2, Rise, Other |
| `mice` | WIRED; WIRELESS | gaming-mouse | Pulsefire Core, Fuse, Haste, Saga, Other |
| `accessories` | ACCESSORIES; PARTS | desk-accessory; keyboard-switch; keyboard-cosmetic; mouse-skates | Desk Accessories, Keyboard Accessories, Mouse Accessories, Other |
| `controllers` | CONTROLLER | gaming-controller | Traditional, Leverless, Other |
| `backpacks` | BACKPACK | gaming-backpack | Backpack, Other |

| Specification set ID | Fields |
| --- | --- |
| `wired-headset` | Connection, Microphone, Drivers, Audio, Cushions, Frame, Controls |
| `wireless-headset` | Wireless, Battery, Microphone, Drivers, Audio, Cushions, Frame, Controls |
| `console-headset` | Platform, Connection, Battery, Microphone, Drivers, Audio, Cushions, Frame, Controls |
| `wired-lifestyle` | Connection, Battery, Microphone, Drivers, Audio, Ear tips / Cushions, Frame, Controls |
| `wireless-lifestyle` | Wireless, Battery, Microphone, Drivers, Audio, Ear tips / Cushions, Frame, Controls |
| `sound-card` | Type, Connection type, Compatibility, Features |
| `headset-customization` | Type, Attachment, Color, Compatibility, Features |
| `gaming-microphone` | Connection, Capsule type, Polar pattern, Record quality, Tap-to-mute, Monitor, Pop filter, Shock mount, Base stand, Lighting zone, Controls, Compatibility |
| `audio-interface` | Type, Connection type, Compatibility, Attachment, Features |
| `microphone-accessory` | Type, Connection type, Compatibility, Attachment, Features |
| `gaming-keyboard` | Form factor, Profile, Connection, Switch, Switch type, Battery, Polling rate, Dedicated media key, Keycap type, Per-key lighting, Mount style, Hot-swap switch, Top plate, Housing |
| `gaming-mouse` | Shape, Grip type, Connection, Buttons, Weight, Battery, Sensor, DPI, Polling rate, RGB, Switches, Shell, Skate |
| `desk-accessory` | Dimension, Material, Compatibility, Feature |
| `keyboard-switch` | Type, Attachment, Color, Compatibility, HyperX keyboard compatibility |
| `keyboard-cosmetic` | Type, Attachment, Color, Compatibility, HyperX keyboard compatibility |
| `mouse-skates` | Type, Connection type, Compatibility, Features |
| `gaming-controller` | Connection, Compatibility, Battery, Switches, RGB, Feature |
| `gaming-backpack` | Type, Size, Feature, Form Factor |

Category settings support rename/title/roadmap side label plus lane add, rename, subtitle, move up/down, and remove. At least one lane remains. Saving moves products from removed lanes into the first remaining lane and normalizes order; Cancel leaves the board unchanged. Category IDs and category count come from the catalog; there is no runtime add/remove-category editor.

## ASCM update workflow

The `.xlsx` workflow reads local files in the browser, previews the plan, and applies selected actions only after the user chooses Apply. It does not send the workbook to a backend.

1. Parse the workbook and find a sheet/header containing Category, Base PN, GPG 40 char AMO Description, GA - General Availability, and EM - End of Manufacturing. Local flag/code, Feature ID, and Code Name are optional.
2. Prefer canonical Base PN rows over localized duplicates. Preserve the exact source description, row provenance, and per-PN GA/EM dates in ASCM metadata.
3. Map source categories into the known portfolio categories; headsets route by description/platform, with an inferred wired/wireless lane. Derive merchandising names and explicit single/two-tone color variants.
4. Group source PNs into product families. Group GA uses the earliest known source date; group EM uses the latest.
5. Match across the portfolio by saved ASCM key, then Base PN. With no exact identifier, use a unique normalized name in the mapped category; console families have a platform-aware fallback. Conflicting/duplicate identifiers, duplicate names, unmapped categories, or multiple incoming groups matching one product require review and are skipped.
6. Preview New product, Update existing, Already current, or Needs review actions, counts, added PNs, and missing PNs. Choose Update matched products and/or Add new products independently.
7. Apply to a cloned portfolio, normalize it, replace the in-memory workspace, save, and return to the previous category. New products have no saved MSRP to display and receive category/lane-specific baseline specification fields containing editable placeholders. These are templates, not facts supplied by the workbook.

Matched records use conservative, additive merging:

| Field family | Matched update behavior |
| --- | --- |
| Specifications, price/price label, product/hero images, featured hero, curated name, tier/codename, card status/banner, milestone dates, unrelated product fields | Retained. The ASCM workbook does not own or replace these fields. |
| HP SKU records | Append new Base PNs and retain existing/manual/previously imported PNs, IDs, and manual color links even when the latest report omits them. |
| Color/layout groups | Retain all groups and existing color choices/image assignments; fill missing color attributes and append new explicitly sourced color variants. |
| Exact GA/EM dates | Nonempty valid source dates update the matching product; blank/invalid source dates retain saved dates. |
| Source records/provenance | Merge by Base PN, refresh populated source fields, retain missing PNs/values, and record source file/export/import time. |
| Roadmap | Preserve curated family, stage, confidence, and relationships. Normalized valid day-level GA/EM determine launch/end months ahead of group month hints; omitted dates retain existing placement. |
| Category | A safely matched source category change transfers the same product to its mapped category/lane without rebuilding its curated content. |

No ASCM update deletes missing products, PNs, specifications, image assignments, or variants. Reapplying the same report is idempotent for product facts. When the source report omits previous facts, retention is deliberate; removal requires a separate manual edit.

`defaultSpecificationsForCategory(categoryId, laneId)` chooses a matching wired/wireless common set when available, otherwise the category default/first set. It runs **only when adding a new ASCM product**. A matched product's existing specs—including an intentionally empty array—remain untouched; use the Specs editor's Add missing fields action to apply a template manually.

New ASCM products initialize their stage from the report dates at creation: a past EM means End of life, a future GA means In planning, otherwise Launched. Thereafter, the stage is an explicit product choice. Matched imports retain it; there is no As of control or recurring date-driven reclassification. Primary card banners and roadmap fills share `productTone(product)`, including the status accent precedence described above; borders, secondary badges, and selection remain separately neutral.

Responsible code: `public/js/ascm-import.js` exposes `globalThis.ASCMImporter`. `parseAscmWorkbook`, `buildProductGroups`, and `matchProductGroup` handle parsing/matching; pure `mergeProductGroup` owns the conservative update contract. `buildAscmImportPlan`, `renderAscmImportPreview`, `applyAscmGroupToProduct`, and `applyAscmImportPlan` in `public/js/app.js` handle preview, roadmap/date synchronization, and workspace application.

The reader does not evaluate formulas, macros, external links, or workbook code. It accepts stored/deflated XLSX ZIP entries with CRC and path/size checks. Default limits include 25 MiB file size, 2,048 entries, 64 MiB per expanded entry, 128 MiB total expanded bytes, 128 sheets, 100,000 rows, 4,096 columns, and 32,768 characters per cell. See `ASCMImporter.DEFAULT_LIMITS` for the complete contract.

## Data, images, backups, and exports

| Action | Scope / effect | Binary image handling |
| --- | --- | --- |
| Autosave | Save the entire version 4 portfolio metadata after a 120 ms debounce. Last active category is persisted. | Uploaded binaries remain in IndexedDB. |
| Export data | Download `product-portfolio-data.data` JSON metadata. | Asset IDs/metadata/URLs included; local image blobs excluded. |
| Import data | Replace active metadata using supported `.data`/`.json`/catalog assignment. Workspace versions 4/3/2 normalize; legacy version 1 board migrates; categories-only catalogs create empty boards. | Does not contain local blobs; references work only where the matching binary already exists. Legacy data URI images are migrated. |
| Export project package | By default download encrypted `master_ppc.pkg`, wrapping the complete stored ZIP with `portfolio.json` using an entered or generated package key. An explicit unprotected private backup downloads `product-portfolio-project.pkg`. | Include saved local binaries under `images/`; URL images remain references. Missing saved local binaries block the complete export. |
| Import project package | Accept a legacy stored ZIP or a keyed encrypted package; validate and stage before replacing the full workspace. Unsupported formats, invalid keys, and missing images fail before commit. | Stage images under new IDs; retain the prior workspace's images for one recovery copy rather than clearing the library first. |
| Pull latest data | Use the deployment's approved relay endpoint and a package key to retrieve one encrypted master containing Portfolio and Roadmap. No user Microsoft sign-in is part of this application flow. | Same staged import path as manual package import; raw unencrypted shared masters are rejected. |
| Restore previous workspace | Restore the single previous package workspace on the same browser origin. Each successful package import or restore replaces the recovery slot. | Prior image references remain available; this is a local recovery slot, not a cloud backup or full undo history. |
| Clear all products | Confirm removal of products from every category, the image registry, and ASCM snapshot. Preserve categories, custom names/titles/labels, lanes/order, global/display settings, active category, and catalog templates. | Clears the current browser image library. |
| PNG | Export active Product board or Roadmap at 2× logical dimensions without selection. Product exports omit Details controls and temporary horizontal pane gaps. Roadmap with product details exports the roadmap only. Current search filters affect the visible export. | Rasterized current loaded image content; external-image CORS can prevent canvas export. |
| PPTX | Primary toolbar action in both views. Choose Product Portfolio, Roadmap, or Both plus one/multiple/all category checkboxes. Export receives the selected IDs, retains portfolio order, and rejects an empty selection. Product export is one slide per selected category; Roadmap has at most 22 products/slide with continued family headers. Summary counts depend on selected content/categories. Dedicated slide-number folios and numeric page-title counters are removed; later page titles use `(continued)`. | Each roadmap product is one native rounded rectangle with editable text and formatting. Each portfolio card is one named group containing editable names/prices/specifications/SKUs and native frames/banners/separators, with separate artwork/icons. Calendar/family/lane context remains a background image. Products can be selected, moved, resized, and deleted independently; cards can be ungrouped to edit individual parts. |

Product PNG/PPTX render with `getCanvasDimensions({ includeViewer: false })` and noninteractive cards. Opening Details therefore does not introduce an empty horizontal pane gap into the exported product board; live and exported lane heights remain identical.

PPTX source anchors: `PPTXPagination.selectExportCategories` filters selected IDs without reordering or mutating input categories; null means all, an empty array means none. `pptxExportCategories`, `syncPptxExportSummary`, `buildPptxExportPlan`, and `exportPptx(scope, selectedCategoryIds)` connect the checklist, estimates, and actual export. `addPptxPortfolioSlide` has no number/total folio; its header rule uses `#2B2E2B`, 0.4 pt, and 25% transparency. Pagination still repeats family context, and `pptxPlanSlideTitle` uses `(continued)` after the first roadmap page.

`renderCategoryImageForPptx` and `renderCategoryRoadmapImageForPptx` return a product-free background plus individual product records in that background's pixel coordinates. `recordCardElementsForPptx` captures the existing card drawing as native text/shape and isolated picture records. `addPptxPortfolioSlide` applies the same containment transform to the background and each product object. `PPTXEditable.addCard/registerSlide/serialize/writeFile` groups native card parts in the delivered OOXML, retaining original rounded geometry and image relationships. `roadmapProductBarRect` shares date clipping between the live canvas and native export, omitting invalid or entirely off-range bars. Renderers normalize copied category data and restore temporary view/hit-region state through `finally`.

Image registry metadata contains `id`, source type (`url`/`local`), name, MIME type, size, URL, and update timestamp. Product and colorway images reference IDs. Local images load via temporary object URLs; missing files use category placeholders. Replacing/removing a product/variant image removes an unused prior asset only after scanning references across every category. Package export includes available binaries and cannot recover a binary absent from the current browser library.

Storage names:

| Concern | Name |
| --- | --- |
| Current metadata | `localStorage`: `product-portfolio-canvas-v4` |
| Migration sources | `product-portfolio-canvas-v3`, legacy `product-portfolio-canvas-v1` |
| Uploaded image database | IndexedDB: `product-portfolio-image-assets-v1`, version 1 |
| Image object store | `images`, keyed by `id` |
| Previous package workspace | `localStorage`: `product-portfolio-canvas-v4-package-recovery`; one metadata snapshot with its local image binaries retained in IndexedDB |

Storage is tied to browser origin/profile. Different ports, hostnames, protocols, browsers, or private sessions do not share the workspace. Shared package pulls are explicit replacements from a separately deployed relay, not automatic synchronization or collaborative editing. The app has no account system, general undo history, or background backup. The relay serves the latest complete local mirror; the approved owner synchronization process can lag SharePoint.

`public/js/package-source.js` has an empty endpoint by default. The Pages workflow injects the approved public HTTPS service address from repository variable `PPC_PACKAGE_ENDPOINT` with `scripts/configure-package-source.mjs`; keys and the private SharePoint link do not belong in that value. Local serving accepts `--package-endpoint http://127.0.0.1:8787/api/package/latest`. See [Shared package setup](SHARED-PACKAGE-SETUP.md) for the portable Node relay, owner sync, and HTTPS deployment requirements. An implemented pull button does not establish that a live relay is connected.

## Architecture and source ownership

| Source | Responsibilities / stable search anchors |
| --- | --- |
| `public/index.html` | Shell, view switching/navigation, static controls, three canvases, information/editor panels, ASCM/PPTX/category dialogs, hidden file inputs, runtime script order. |
| `public/css/styles.css` | DOM layout, charcoal tokens, control/panel/menu/modal styles, focused/selected/hover/disabled states, responsive rules. |
| `public/js/catalog-data.js` | Version 1 templates, category IDs/names, default titles/labels, lanes, spec sets, family order, variant defaults, optional product blueprints/image paths. |
| `public/js/portfolio-model.js` | Pure `normalizeTimelineSettings`/`syncTimelineSettings` and `layoutProductLanes`, date-aware `mergeProductUpdate` for explicit edits, loss-aware `normalizeSpecifications`, explicit `resolveSkuColors`, shared `msrpText` and `productTone`/theme accents/lifecycle tones, and settings-preserving `clearAllProducts`; exposed as `PortfolioModel`. |
| `public/js/product-details.js` | Shared Overview/SKU/More renderer, complete unpaged Overview specifications, tab/subtab/secondary-list page session state, keyboard navigation, and copy feedback; exposed as `PortfolioDetails`. |
| `public/js/workspace-ui.js` | Toolbar category switching/summary, quick actions, settings section navigation, modal focus/inert/keyboard management, and `portfolio:render` event bridge; exposed as `PortfolioWorkspaceUI`. |
| `public/js/app.js`: schema | `ensureBoardSchema`, `ensurePortfolioSchema`, normalizers, `makeProduct`, default-board factories and legacy migrations; delegates timeline/specification/SKU rules to `PortfolioModel`. |
| `public/js/app.js`: images/storage | `openImageDatabase`, image-store functions, asset registry/reference scanning, URL loading/caching, image setters, `loadPortfolio`, `scheduleSave`. |
| `public/js/app.js`: product rendering | Card/spec/footer/layout calculations, image draw helpers, hit regions, information drawer/popovers, selection, drag/pan/navigation. |
| `public/js/app.js`: roadmap rendering | Range/groups/dimensions, stage fills, calendar/rail/bar drawing, selected guides, roadmap pointer draft/commit. |
| `public/js/app.js`: editors/UI | Product inspector, category/lane drafts, optional Roadmap details, preset bindings, event wiring and synchronization. |
| `public/js/app.js`: interchange | JSON parsing/normalization, package export/import and previous-workspace recovery, image staging, PNG, PPTX plan/image/deck rendering, ASCM plan/application. |
| `public/js/package-codec.js` | Bounded stored-ZIP parsing/writing, canonical random package keys, and authenticated encrypted package envelopes; exposed as `PortfolioPackage`. |
| `public/js/package-source.js` | Empty default relay endpoint; deployment supplies an approved public service address without keys or private SharePoint URLs. |
| `public/js/package-client.js` | Validate the approved endpoint, submit an ephemeral key, download within the 64 MiB limit with progress/cancellation, and reject raw shared packages; exposed as `PortfolioPackageClient`. |
| `public/js/package-ui.js` | Unified pull/import/export/restore dialog, protected-export default, key creation/copy/show controls, setup/error/completion states, modal focus, and clearing keys on close; exposed as `PortfolioPackageUI`. |
| `server/package-relay.mjs` | Portable fixed-file relay: authenticate the encrypted local mirror with the submitted key, return encrypted bytes, exact CORS, bounded requests/source, rate/concurrency limits, no cached plaintext/keys. Requires approved hosting and HTTPS for remote use. |
| `public/js/ascm-import.js` | Standalone defensive XLSX parser, category/color/name normalization, canonical source records, family grouping, safe portfolio matching, and pure additive product merging. |
| `public/js/pptx-pagination.js` | Pure ordered category selection via `selectExportCategories`, roadmap family pagination, and the 22-product limit. |
| `public/js/pptx-editable.js` | Native card composition, named per-product OOXML groups, original rounded-corner geometry, and grouped PowerPoint delivery through the vendored ZIP runtime. |
| `public/vendor/pptxgen.bundle.js` | Vendored PptxGenJS runtime required for PPTX generation. |
| `scripts/serve.mjs` | Dependency-free static development server rooted at `public/`, with an optional local package endpoint override. |
| `scripts/configure-package-source.mjs` | Validate and generate endpoint-only deployment configuration from `PPC_PACKAGE_ENDPOINT`. |
| `scripts/checks/package-codec.mjs` | Key/encryption round trips and bounded ZIP/envelope corruption, integrity, traversal, duplication, size, and format checks. |
| `scripts/checks/package-client.mjs` | Approved endpoint/configuration validation, key-only requests, response size/progress/cancellation, authorization failures, and rejection of raw shared packages. |
| `scripts/checks/package-workspace.mjs` | Actual application complete export, encrypted/legacy import, isolated image staging, storage/image failure recovery, prior-workspace restore, and bounded cleanup; optional local legacy fixture input. |
| `scripts/checks/package-relay.mjs` | Isolated HTTP checks for encrypted authorization, same-size updates/key rotation, fixed-source isolation, limits, CORS, forwarding-header rate controls, and safe errors. |
| `scripts/checks/project.mjs` | Source syntax, runtime reference/DOM contract, catalog/assets, deployment closure, and private-data guards. |
| `scripts/checks/ascm-import.mjs` | Regression coverage for parser/color/grouping/category/date/matching plus additive merges, curated data/image retention, omissions/blanks, and repeated updates. |
| `scripts/checks/pptx-pagination.mjs` | Page limits/order/continuation, category selection, actual picker/summary/export decisions, and one named object per product. Checks shared date clipping, product-free roadmap backgrounds, status outlines, state restoration on failure, and background/object alignment. Bundled-library serialization verifies native rounded rectangles with editable text/fill/dash, ZIP integrity, title/divider styling, and intact image relationships. |
| `scripts/checks/pptx-products.mjs` | Actual portfolio recorder/renderer: editable name/price/spec/SKU text, native frames/separators, isolated artwork, lane/display order, product-free family-header backgrounds, scaled placement, copied data, and view/hit-region restoration on success/failure. |
| `scripts/checks/portfolio-model.mjs` | Global timeline/lifecycle/spec/SKU/status/MSRP rules and retained generic model expansion coverage. Actual application dimensions/drawing/backgrounds/rails/hit tests/drop/export consumers keep first/middle/last-lane positions and total height unchanged at 20/65/100/150% zoom; horizontal reserve, close/filter guards, and saved lane data are covered. |
| `scripts/checks/product-details.mjs` | Complete Overview dates/lifecycle/specs and focusable calendar/specification overflow; secondary-list paging/tab/copy, escaping, independent surfaces, real app adapters, and settings-preserving clearing. Actual compact/full-spec pane geometry is tested at 20/50/65/100/150% zoom throughout opening: exact rendered-parent height, unchanged lanes/canvas height, 540/680/720 px widths, safe specification columns, horizontal reserve, missing-card suppression, and export exclusion. |

The static browser loads scripts in this order: PptxGenJS, catalog, ASCM importer, PPTX pagination/editable composition, portfolio model, product details, package codec/source/client, application, package UI, workspace UI. Required globals must exist before the application initializes; both UI controllers run after the core. The site needs no framework, bundler, or runtime package installation. Pages generates its endpoint-only configuration during publication; the optional package API runs separately and is excluded from the static artifact.

## Verification boundaries and known limitations

- Source inspection verifies feature availability and data paths; it does not prove complete keyboard/screen-reader usability. Primary comparison and timeline surfaces use canvas hit regions; DOM details/editors offer a structured subset.
- Autosave currently catches `localStorage` write failures. A footer saying autosaved does not establish that a failed quota/browser-policy write succeeded.
- Package replacement now validates and stages incoming content, preserves previous images, and keeps one local recovery copy. Keep a downloaded backup as well: browser quotas, storage loss, and absent recovery binaries still limit recovery. Lightweight data import remains a separate metadata-only replacement flow.
- Schema normalization adds known categories and removes unknown category IDs; legacy free-position/highlight fields and legacy SKU representation are migrated. Specification records support label/value objects, tuples, object maps, JSON strings, and plain strings without treating recognized non-array content as empty. Import is not arbitrary-field-preserving interchange.
- Product moves/deletion do not repair every other product's predecessor/successor reference. Relationships need manual review after structural edits.
- URL images depend on availability and browser CORS policy; full packages preserve URL references rather than fetching remote files.
- See [Project Audit](PROJECT-AUDIT.md) for risks and [Continuation Guide](CONTINUATION-GUIDE.md) for the runnable checks and browser matrix.
