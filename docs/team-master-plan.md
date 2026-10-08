# Team master plan

Use a managed shared database, such as Supabase Postgres, for accepted product information. Keep GitHub Pages for the portfolio app and keep encrypted project packages as exports and backups. This is the recommended next setup; it is not configured or deployed by this interface release.

## Everyday use

Each team member opens the portfolio, unlocks team access once on their device, and can optionally enter or change their name. They do not create GitHub tokens. Product details, specifications, SKUs, and dates become draft changes until they choose Save to master.

Different fields can save together. When two people change the same field, the first accepted save becomes the current master value. The next person sees both values and chooses which to keep. That choice is checked again if another person saves while the decision is open. No later submission silently overwrites someone else's edit.

Messages provides detailed warnings and actions without stretching the toolbar. Duplicate review lists the affected products, categories, lanes, and rows. Matching product names and HP SKUs across different portfolios, including PC Gaming Audio and Console Gaming Audio, are valid and do not trigger duplicate warnings. Within a portfolio, matching names are possible matches; repeated generic color codes across different products remain valid.

## Shared data design

- Store product facts, spec and SKU rows, field revisions, and history in the database. Keep images separately so a date edit does not upload every image again.
- Save changes, revisions, history, and a request receipt in one transaction. Lock affected products in stable order and preserve unsaved drafts if any validation or conflict fails.
- Compare field revisions as well as original values. This detects a value that changed and later changed back while another user was editing.
- Use request receipts to prevent a retry from applying the same save twice when a connection drops after acceptance.
- Keep normalized SKU checks within the appropriate portfolio or product scope; a SKU can be sold in multiple portfolios. Duplicate failures should return existing product and row locations for review.
- Keep one writable master. Generate encrypted package snapshots from accepted database values and include the snapshot timestamp; a downloaded package can be older than the online master.

## Private access and optional names

An anonymous authenticated browser session can avoid email/password sign-in. It does not, by itself, authorize team access. Require a private team join/unlock key, validate it through a restricted server function, and create membership for the session. Restrict database reads, writes, history, image storage, and presence to authorized membership.

Only the project address and public publishable API key belong in the browser. Administrative credentials and the team-key hash stay private. Apply rate limits and abuse protection to joining. Names are self-reported; connected circles represent browser sessions rather than verified people. A new device or cleared browser storage requires joining again.

## Owner setup and transition

The owner creates one managed database project. Configure anonymous sessions, membership policies, a restricted join endpoint, and the transactional save function. Import and verify the current package, including images. Test concurrent same-field and independent-field changes, duplicate SKU races, cancelled conflict choices, failed connections, and package backup round trips before switching the live app.

The current live connection remains in place until the new service is seeded and verified. The prepared private GitHub gateway remains an interim option, but it still rewrites the whole encrypted package for each save. GitHub Pages alone cannot privately store a shared write credential or execute the live save service.

## References

- [GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Supabase anonymous sessions](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase membership access with Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing database functions](https://supabase.com/docs/guides/database/functions)
- [PostgREST transactions](https://docs.postgrest.org/en/stable/references/transactions.html)
- [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html)
