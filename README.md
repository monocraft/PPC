# Product Portfolio Canvas

A no-dependency browser application for product comparison and roadmap slotting. It runs as a static site and can be hosted directly on GitHub Pages.

## Included

- **Product cards view** for product-to-product comparison
- **Roadmap view** for lifecycle coverage, launch timing, overlap, and portfolio gaps
- **Split view** with the selected product beside the live roadmap
- One synchronized product record shared by all three views
- Two-way navigation: **View on roadmap**, **View product card**, and **Show selected**
- Monthly roadmap with calendar years, quarters, half-years, month labels, and a current-date marker
- Drag a roadmap bar to shift its full lifecycle
- Drag either bar edge to change the start or end slot
- Independent launch marker for each product
- Month, quarter, or half-year movement snapping
- Roadmap filtering, date-range controls, color modes, Today, and Fit Timeline
- Roadmap family, lifecycle, launch, status, confidence, predecessor, and successor fields in the edit drawer
- Dynamic HTML Canvas product board with wired/wireless lanes
- Drag product cards to reorder or move between lanes
- Horizontal background panning and custom navigation controls
- Add, edit, and delete products, specifications, and color SKUs
- Status banners and product highlights using the same green, embargo-pink, gray, and dark theme
- Product image URL or local image upload
- Browser autosave
- JSON import/export, including roadmap data
- High-resolution PNG export for the active product or roadmap view
- GitHub Pages deployment workflow

## Run locally

No package installation or build step is required.

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

Opening `index.html` directly also works in most browsers, though a local server is preferable.

## Deploy to GitHub Pages

1. Create a GitHub repository.
2. Copy the project files into the repository.
3. Commit and push to the `main` branch.
4. Open **Settings → Pages** in GitHub.
5. Set **Source** to **GitHub Actions**.
6. The included `.github/workflows/deploy.yml` workflow publishes the static application automatically.

## View workflow

### Product cards

Use this view for images, pricing, specifications, SKUs, and direct product comparison. Select a card and choose **View on roadmap** to center the same product in the timeline.

### Roadmap

Use this view to review lifecycle overlap and slot product launches. A diamond marks the launch month. Drag the center of a bar to move the entire lifecycle, or drag either edge to resize it. Double-click a bar to open its roadmap fields.

### Split view

Use this view while actively slotting products. The selected product remains visible on the left while its family and neighboring products remain visible on the roadmap. Selecting another roadmap bar immediately updates the product panel.

## Storage behavior

Changes autosave in the current browser using `localStorage`. Use **Export JSON** for backup or sharing, and **Import JSON** to restore a board on another computer. Existing v1 product-board JSON files are automatically supplemented with roadmap metadata when imported.

Uploaded product images are stored as data URLs inside the board document. A future multi-user version should use external image storage and authentication.

## Large-board navigation

The product and roadmap canvases retain readable fixed-size content rather than shrinking everything until text becomes unusable. When content exceeds the viewport, use:

- Drag empty canvas space left or right
- `Shift + mouse wheel`
- The bottom range slider and arrow buttons
- **Show selected** to center the current product
- **Today** to center the current month in roadmap views
- **Fit timeline** to fit the selected date range into the available width

Native browser page scrollbars remain hidden; scrolling is owned by the application workspace.

## v1.6 interaction safeguards

- Product lanes now use a frozen left rail that remains visible during horizontal panning and appears only in Product Cards mode.
- Roadmap dates are locked by default.
- A user must select a product and choose **Edit selected slot** before any timeline date can change.
- Even in edit mode, dragging the bar body pans the timeline. Only the visible center grip moves the slot and the two edge handles resize it.
- A small movement threshold prevents click jitter from becoming an edit.

## Compact lane rail and roadmap navigation

- Product Cards keeps the Wired/Wireless wording rotated in a dedicated 58 px frozen rail, preserving canvas width without overlapping other views.
- Double-clicking a product bar in Roadmap opens synchronized Split View and focuses that product.
- Double-click no longer opens an editor. Product editing and roadmap slot editing remain explicit button actions.
