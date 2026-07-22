## v2.14 viewer-first colorway heroes and softer roadmap grid

- Products with multiple Color SKU variants can assign a separate hero image to each colorway from **Data → Edit selected product → Colorway hero images**.
- Hover an assigned color SKU to preview that hero image; click the SKU to pin or unpin it. The main product image remains the fallback.
- Colorway image assets use the existing image library and full-project package, so product JSON continues to store only lightweight image IDs.
- Product Cards are viewer-first: double-click opens the selected product on the Roadmap instead of opening an editor.
- Product editing, roadmap-slot editing, card reordering, category settings, and product creation are consolidated under **Data**.
- Product cards cannot be reordered unless the protected Data action explicitly enables layout editing.
- Roadmap month and quarter grid lines are reduced to approximately 10–20% visual strength while year boundaries remain prominent.
- Calendar-year month bands alternate subtly between darker and lighter neutral surfaces for clearer year grouping.

## v2.11 aesthetic and layout tuning

- Product lane surfaces now extend across the complete visible browser workspace, including when the product view is zoomed out.
- Lane surfaces use a quieter solid tone so they separate rows without looking like disconnected panels.
- Removed the dotted Product Cards workspace and PNG export texture.
- Removed lane-rail borders, fills, gradients, and shadow; only the vertical lane wording remains.
- The `+N` variant popover is now a compact, view-only preview with no instructional copy or edit action.

# Product Portfolio Canvas — v2.9

A no-dependency static browser application for product comparison, roadmap planning, and synchronized product review. It can run locally or deploy directly to GitHub Pages.

## Shared three-view framework

- **Product cards**: compare images, prices, category-specific specifications, variant/SKU groups, and product lanes.
- **Roadmap**: place launch-to-lifecycle slots, compare overlap, and review launched, in-development, or in-planning products.
- **Split view**: inspect one selected product next to the synchronized roadmap.

All views share the same product records, selection, variants, image assets, and roadmap dates.


## Filter-aware roadmap headers

Roadmap filtering now keeps the filtered result fully oriented:

- Changing the roadmap search resets only vertical position, while preserving the horizontal timeline position.
- The vertical portfolio/category label is centered within the actual filtered result height.
- Long category labels automatically reduce font size so the complete label remains visible instead of being clipped.
- Family rows and the sticky calendar header continue to use the same filtered dataset.

## Reusable catalog architecture

The category and sample-product catalog is isolated in `catalog-data.js`. The renderer, editor, roadmap, import/export, and image library remain in `app.js`.

Each catalog definition contains:

- Category name and protected titles
- Category-specific lanes
- Family ordering for roadmap grouping
- Reusable specification sets
- Default variant type
- Product records and static sample image references

A new category can be added or swapped without creating another rendering path.

## Included reference categories

The supplied reference images were built into eight complete category workspaces:

1. PC Gaming Audio — 14 products
2. Console Gaming Audio — 11 products
3. Lifestyle Audio — 7 products
4. Audio Accessories — 3 products
5. Microphones — 8 products
6. Microphone Interfaces & Accessories — 4 products
7. Keyboards — 7 products
8. Mice — 13 products

The default catalog contains **67 products** with category-specific lanes, specifications, variants, roadmap families, statuses, prices, and separated static image assets.



## Adaptive single-lane full-spec cards

Categories with one product lane now use a dedicated full-specification presentation by default:

- A taller image and product header area
- Every specification shown directly on the card
- Visible specification labels instead of icon-only rows
- Automatic two-column pairing for short fields
- Compact feature matrices for related capability fields
- Consistent card height based on the most detailed product in the category
- Family headings above contiguous product groups
- No `View +N specifications` control in full-spec mode

This applies automatically to Audio Accessories, Microphones, Microphone Interfaces & Accessories, and Keyboards. Multi-lane categories keep the compact comparison layout. The behavior can be enabled or disabled under **Product Cards → Settings → Full specifications for single-lane categories**.

## Category-specific lane editor

Open **Data → Category settings** to manage lanes safely:

- Rename lane labels and subtitles
- Add or remove lanes
- Reorder lanes
- Automatically move products from a removed lane into the first remaining lane

The board header remains protected from accidental edits.

## Category common specification sets

The product editor offers **Category common set → Add missing fields**. Each category owns its own reusable sets, so headset, keyboard, mouse, microphone, and accessory fields are not mixed together.

Examples include:

- Wired and wireless headset sets
- Lifestyle audio sets
- Sound-card and headset-customization sets
- Full gaming microphone set
- Interface and microphone-accessory sets
- Complete keyboard comparison set
- Complete gaming-mouse comparison set

Adding a set only inserts missing fields and does not overwrite existing values.

## Product status and variant banners

Product state and product variant are separate:

- **New Product** uses a protected green label and theme color.
- **Upcoming Under Embargo** uses a protected pink label and theme color.
- **Variant banner** is the only customizable banner label and color. It supports uses such as PlayStation, Xbox, Sunsetting, or regional availability.

A product can have both a standardized status and a custom variant banner. The variant occupies the main banner while the standardized state appears as a compact secondary badge.

## Roadmap timing model

The first roadmap date is always **Launch month**. The application does not track a separate development-start date.

Each roadmap record contains:

- Launch month
- Lifecycle end
- Stage: Launched, In development, or In planning
- Confidence
- Predecessor and successor

The selected product outlines its full launch-to-end period in the month header, with the launch cell highlighted. Duplicate launch lines and body diamonds were removed.

Roadmap bars are locked by default. Explicit **Edit selected slot** handles are required before dragging or resizing dates.

## Product image architecture

- Product records store only an `imageAssetId`.
- The workspace-level image registry stores small metadata records.
- Uploaded images are stored as binary `Blob` files in IndexedDB.
- Built-in catalog images are separate WebP files under `assets/catalog/`.
- Full-project `.pkg` export keeps uploaded images separate from `portfolio.json`. The package remains ZIP-compatible internally for reliable browser import/export.

This prevents large base64 strings from bloating product JSON.

## Inspector behavior

The selected-product title, Delete button, and Close button remain sticky while the editor scrolls vertically.

## Run locally

```bash
python -m http.server 8080
```

Open `http://localhost:8080`.

## Deploy to GitHub Pages

1. Copy the project into a GitHub repository.
2. Push to `main`.
3. Open **Settings → Pages**.
4. Set **Source** to **GitHub Actions**.
5. The included workflow deploys the static application.
## v2.8 unified workspace background

- The Product Cards canvas is transparent and now uses one shared background owned by the view.
- The texture continues through unused space without a solid rectangular canvas layer or a visible bottom edge.
- On-screen rendering and horizontal panning no longer expose a disconnected background surface.
- PNG export still receives an opaque matching background and subtle dot texture.

## v2.9 filter and visual-layer fixes

- Roadmap search now resets the filtered view to the top while preserving horizontal timeline position.
- The vertical category label wraps and scales inside the filtered result height, so long category names remain fully visible even when only one family or product matches.
- Removed the redundant `Timeline locked` toolbar badge and duplicate locked helper copy.
- Product status/variant outlines are redrawn after SKU footers, keeping New Product and Embargo borders fully visible.
- The white selected-product outline remains the absolute top interaction layer.

## v2.11 final catalog categories

Three additional data-driven categories are included without changing the shared visual theme:

- **Gaming Accessories** — Accessories and Parts lanes with desk-accessory, keyboard-switch, keyboard-cosmetic, and mouse-skate specification sets.
- **Controllers** — Traditional and Leverless families with a controller-specific specification set.
- **Backpacks** — Gaming backpacks with a dedicated carrying-capacity specification set.

The catalog now supports a category-level `fullSpecCards` capability. This lets a multi-lane category such as Gaming Accessories use the same detailed card renderer when its reference layout requires complete specifications, while all category content remains defined in `catalog-data.js`.

The new product images are stored separately under:

```text
assets/catalog/accessories/
assets/catalog/controllers/
assets/catalog/backpacks/
```

Initial roadmap dates for these newly added sample products are editable starter placements because the supplied references did not include release dates.

## v2.12 editor-safe product reveal

- Opening the product editor now reserves horizontal canvas space equal to the drawer width.
- The selected product automatically shifts into the unobstructed area to the left of the editor.
- This works for the last product in a lane, where normal scrolling previously had no remaining space to expose the card.
- Closing the editor removes the temporary reserve and restores the normal board width.
- Product order, lane placement, zoom, and the overlay-based editor layout are unchanged.

## v2.13 — Fixed roadmap category header

- The vertical roadmap category label now uses a fixed 13 px type size.
- Filtering to one product or one family no longer shrinks the category label.
- The roadmap keeps a small minimum body height so the fixed label remains fully visible.
- Long category names wrap across up to three vertical lines instead of scaling down.
- Timeline, family rows, filtering, and all existing theme colors remain unchanged.


## v2.15

- Removed the dotted texture from Roadmap and Split View timeline backgrounds.
- Roadmap now uses a clean solid background while preserving the softened grid and year separation.


## v2.16

- Removed the boxed January treatment from the roadmap month row.
- January now uses a subtle theme-matched tint and slightly brighter label.
- Replaced disconnected year outlines with one continuous solid year seam.
- Reduced regular month and quarter grid strength while preserving clear year boundaries.


## v2.17

- Fixed year separators in Roadmap so the January seam renders as one continuous solid line.
- Removed the broken/dashed look caused by the seam being drawn underneath row backgrounds.
- Kept the subtle January tint and the existing theme.


## v2.18

- Moved roadmap year separators behind product bars.
- Year seams remain continuous through empty timeline space and group rows.
- Product bars now naturally cover the seam so the line does not draw over product content.


## v2.19 custom project extensions

- Full projects now export as `product-portfolio-project.pkg`.
- Lightweight records now export as `product-portfolio-data.data`.
- `.pkg` contains the same reliable ZIP-compatible package structure internally, including `portfolio.json` and separate image assets.
- `.data` contains normal JSON internally, but uses a cleaner application-specific filename.
- Import remains backward-compatible with legacy `.zip` and `.json` files.
- Renaming a `.pkg` file to `.zip`, or a `.data` file to `.json`, remains possible for manual inspection.
