# Daily portfolio workflows

## Load the right source

Use **Load data** in Portfolio or Analytics, including the empty Portfolio welcome screen. Choose a local file, then confirm what you want to do. A likely destination is highlighted when the workbook structure is recognizable; an uncertain file never chooses a destination for you.

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

## Understand save status

The status below the Portfolio toolbar opens the existing team and package details. It distinguishes local saving, a local save failure, products ready to share, the last team check, and preparation or failure of the downloadable encrypted copy. **Save changes** remains the explicit review for sharing normal portfolio edits and planning decisions. A local save is not a team receipt. No new background health checks are added.

Use **Needs review** for outstanding warnings, saved PLC exceptions and current planning decisions. Separate filters show missing FFS timing, stale evidence, missing main artwork and locally deferred items. There is no combined quality score. Each item opens its existing editor or source review. The source diagnostics action opens Portfolio plan **Source & quality**. Counts only reflect the current browser's loaded portfolio and review state.

Deferring hides that exact issue on this browser; a changed issue reappears. Errors and mandatory warnings cannot be deferred. The preference store is bounded, so the oldest deferrals can be removed when capacity is reached.

## Reuse a view and export setup

Open **More → Saved views** in Portfolio, or **Saved views** near the Analytics tabs. Save, open, rename or delete a named view. Each browser stores up to 25 views. A view retains filters, category scope, dates and supported display settings. Opening it uses the current data. It does not restore products, images, credentials or workbook contents. Missing product or category selections are handled against current IDs rather than silently expanding to all records.

The PowerPoint dialog restores reusable options from the last successful export. **Use this view** copies the visible view's category scope and date range into the export controls for review. Those options do not retain a previous consent to export different reporting cutoffs. Review the displayed scope before exporting.

On narrow screens, **View options** groups secondary roadmap controls. Search, category/type selection, range and Fit remain available. **Next 24 months**, **Selected product** and **Full range** adjust the visible timeline only. Quarter precision is retained when fitting date ranges.

## Review date evidence and protect a date

Open **Needs review → Date evidence & protection**, select a product and inspect all six milestones. The panel shows the accepted date or calendar quarter, recorded source, observation age and superseded evidence where available.

**Protect from automatic replacement** is an opt-in setting for this browser. It follows the product across category moves and applies to future PLC, ASCM and planning date updates. Protection does not change the accepted date. An automatic proposal is held for review; planning requires a separate explicit override. Manual editing remains available. Teammates have independent browser settings.

The protection store is separate from product evidence. If it cannot be read safely, automatic date replacement is held. When a verified previous copy exists, the panel offers an explicit restore action. Releasing protection resumes the existing import rules for that date.

## Scope and data preservation

Installing these workflows does not accept planning candidates, invent missing dates, change accepted product facts, rewrite the encrypted master, or require a database migration. Actual candidate matching and business choices remain explicit review actions. SharePoint workbooks can still be downloaded and loaded locally; direct Microsoft access retains its existing approved connection requirements.

The implementation is covered by local fixture checks, stale-state and storage-failure cases, mandatory local PGlite checks, and isolated desktop/mobile browser journeys. Source publication uses the existing Pages deployment and encrypted package flow.
