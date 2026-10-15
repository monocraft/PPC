# Daily portfolio workflows

## Load the right source

In Portfolio, open **Settings → Data & export → Load data**. The empty welcome screen also offers **Load data** for initial setup. In Analytics, use its **Load data** button. Choose a local file, then confirm what you want to do. A likely destination is highlighted when the workbook structure is recognizable; an uncertain file never chooses a destination for you.

| Purpose | Destination and review |
| --- | --- |
| Update project milestones | Existing PLC importer, with source matching and uncertain date review |
| Update the product catalog | Existing ASCM preview for additions and updates |
| Review planning candidates | Explicit match, create or ignore decisions; see [Planning intake](PLANNING-INTAKE.md) |
| Analyze retail performance | Separate local Retail source, workbook review or encrypted backup unlock |
| Analyze the portfolio plan | Separate local Blueprint workbook and its existing validation |
| Open a complete portfolio backup | Existing protected package review; can replace products, images and workspace settings |
| Open a portfolio data backup | Explicit confirmation before replacing portfolio data; image files remain separate |

Portfolio can send the selected file directly to its Analytics tab. The file stays in memory during that handoff. Review or unlock still happens in the destination. A cancelled or invalid load retains the existing source. Selecting an Analytics source does not import it as portfolio product records.

## Save and resolve local copies

Portfolio saves local edits automatically without a separate status bar. A save failure shows an actionable notification and remains in **Needs review** until resolved. **Save changes** remains the explicit review for sharing normal portfolio edits and planning decisions. Team and downloadable-copy details remain in that review and **Other review tools → All messages**.

Portfolio and Analytics navigation stays in the current tab and completes any pending local save before leaving Portfolio. Each tab remembers its own selected view and roadmap type. Harmless differences in Hashout labels, scope, viewport and other allowlisted display preferences reconcile automatically while preserving newer product and source data. Atomic imports retain strict conflict protection.

Autosave and navigation wait for the same in-progress local save. Edits made during that save are saved before navigation continues; an obsolete snapshot cannot leave a false blocked status after a successful save.

If two tabs contain different product or source edits, **Resolve local save** shows their differences. Choose **Keep my open copy** or **Use the latest saved copy**; either action preserves both complete originals under **Saved local copies** before saving the chosen copy. Those copies remain available after reload and can be opened or downloaded. A later change by another tab refreshes the comparison instead of overwriting newer work. Browser storage failures show their actual error and a save retry/backup action.

Use **Needs review** for outstanding warnings, saved PLC exceptions and current planning decisions. It opens on required actions with search cleared. A blocked local save stays visible above every filter. Each card has a named action; optional missing-date, source-age and image checks are separate. Additional source/evidence tools and saved local copies are under **Other review tools**. Counts reflect the current browser's loaded portfolio and review state.

Deferring hides that exact issue on this browser; a changed issue reappears. Errors and mandatory warnings cannot be deferred. The preference store is bounded, so the oldest deferrals can be removed when capacity is reached.

## Reuse a view and export setup

Open **Saved views** beside the zoom controls in Portfolio, or near the Analytics tabs. It stays on the same row as **100%** when switching Products, Lifecycle and Hashout views, including narrow screens. **Settings** opens directly from the main toolbar. Save, open, rename or delete a named view. Each browser stores up to 25 views. A view retains filters, category scope, dates and supported display settings. Opening it uses the current data. It does not restore products, images, credentials or workbook contents. Missing product or category selections are handled against current IDs rather than silently expanding to all records.

The PowerPoint dialog restores reusable options from the last successful export. **Use this view** copies the visible view's category scope and date range into the export controls for review. Those options do not retain a previous consent to export different reporting cutoffs. Review the displayed scope before exporting.

Roadmap controls use consistent groups for search, roadmap type and date range; product editing; and view navigation. Zoom, Saved views, Fit and Today stay together, with timeline range presets alongside in the same navigation group. The GA-to-EM explanatory line is removed. On narrow screens, **View options** groups secondary roadmap controls while zoom and Saved views stay directly available. **Next 24 months**, **Zoom to selected product** and **Full range** adjust the visible timeline only. Quarter precision is retained when fitting date ranges.

## Review date evidence and protect a date

Open **Needs review → Date evidence & protection**, select a product and inspect all six milestones. The panel shows the accepted date or calendar quarter, recorded source, observation age and superseded evidence where available.

**Protect from automatic replacement** is an opt-in setting for this browser. It follows the product across category moves and applies to future PLC, ASCM and planning date updates. Protection does not change the accepted date. An automatic proposal is held for review; planning requires a separate explicit override. Manual editing remains available. Teammates have independent browser settings.

The protection store is separate from product evidence. If it cannot be read safely, automatic date replacement is held. When a verified previous copy exists, the panel offers an explicit restore action. Releasing protection resumes the existing import rules for that date.

## Scope and data preservation

Installing these workflows does not accept planning candidates, invent missing dates, change accepted product facts, rewrite the encrypted master, or require a database migration. Actual candidate matching and business choices remain explicit review actions. SharePoint workbooks can still be downloaded and loaded locally; direct Microsoft access retains its existing approved connection requirements.

The implementation is covered by local fixture checks, stale-state and storage-failure cases, mandatory local PGlite checks, and isolated desktop/mobile browser journeys. Source publication uses the existing Pages deployment and encrypted package flow.
