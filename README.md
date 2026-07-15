# Product Portfolio Canvas

A no-dependency browser application modeled after the supplied product comparison board. It runs as a static site and can be hosted directly on GitHub Pages.

## Included

- Dynamic HTML Canvas product board
- Wired/wireless lanes
- Drag to reorder cards or move them between lanes
- Optional free-position mode
- Add, edit, and delete products
- Status banners and highlight outlines
- Add, edit, and remove specifications and color SKUs
- Product image URL or local image upload
- Search and sorting
- Browser autosave
- JSON import/export
- High-resolution PNG export
- Built-in visual-reference viewer
- GitHub Pages deployment workflow

## Run locally

No build or package installation is required.

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

Opening `index.html` directly also works in most browsers, though a local server is preferable.

## Deploy to GitHub Pages

1. Create a GitHub repository.
2. Copy these files into the repository.
3. Commit and push to the `main` branch.
4. Open **Settings → Pages** in GitHub.
5. Set **Source** to **GitHub Actions**.
6. The included workflow deploys the static app automatically.

## Storage behavior

Changes autosave in the current browser using `localStorage`. Use **Export JSON** for backup or sharing, and **Import JSON** to restore a board on another computer.

Uploaded product images are stored as data URLs inside the board document. For a large shared image library, a later team version should use external file storage and authentication.
