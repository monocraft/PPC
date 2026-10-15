# Product Portfolio Canvas

A browser-based workspace for organizing product portfolios and planning product roadmaps.

[Open Product Portfolio Canvas](https://monocraft.github.io/PPC/)

## Features

- Organize products in visual portfolio boards.
- Plan launches and lifecycle milestones on a roadmap.
- Switch between Lifecycle roadmap and Hashout roadmap. Hashout plots working products by estimated FFS timing in category lanes, with selectable categories, compact expandable product groups, and full names and dates on hover. Working names and timing remain planning estimates.
- View product details, specifications, and variants.
- Share product additions, removals, dates, specifications and SKUs through one master, with explicit choices when teammates change the same detail.
- See connected teammates' current portfolio and selected product, with optional display names.
- Use Load data to choose a validated source, see local/team/package save status, and open actionable warnings through Needs review. See [Daily portfolio workflows](docs/WORKFLOW-UPGRADE.md).
- Reuse named local views across Portfolio and Analytics, and restore the settings from a successful PowerPoint export.
- Review planning candidates explicitly, preserving exact dates, calendar quarters and unknown timing; inspect milestone evidence and optionally protect dates on this browser.
- Locate duplicate SKU assignments within a portfolio and open the field to correct them. The same name or SKU can appear in different portfolios, including PC Gaming Audio and Console Gaming Audio.
- Import and export project packages.
- Drop biweekly HyperX PLC workbooks into PPC to collect evidence and update reliable milestones automatically. Track independent timestamps and aging for all six dates, resolve saved exceptions when needed, and automatically share importer changes when connected with editing access. See [PLC import module](docs/PLC-IMPORT-MODULE.md).
- Create PowerPoint presentations from portfolios and roadmaps.
- Open one Analytics workspace for retail performance and portfolio planning, with local Blueprint workbook imports, category comparison, investment, NPI and growth scenarios. See [Analytics workspace](docs/ANALYTICS-WORKSPACE.md) and [Retail Analytics module](docs/RETAIL-ANALYTICS-MODULE.md).

## Getting started

Open the app and use **Load data** to choose a saved package, catalog, milestone or planning source, or create your portfolio through **More → Settings**.

Your workspace is saved in your browser. Export a project package to keep a backup or move your work to another browser or device.

For the private team connection that requires no personal GitHub tokens, see [Shared master setup](docs/SUPABASE-SETUP.md). Accepted updates become available to connected teammates immediately, and GitHub Actions publishes the complete encrypted master package automatically. [Team master plan](docs/team-master-plan.md) explains the editing workflow.
