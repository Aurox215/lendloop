# Seed data

From the project root, sync the functions to your development deployment, then run:

```sh
npx convex dev --once
npx convex run seed:run
```

The internal mutation returns counts of newly created records. On an empty database
it creates two roles (`user`, `admin`), eight categories in the requested order,
one fictional demo lender, and sixteen active listings (two per category).
Running it again returns zero counts and preserves existing records, edits,
paused listings, and removed listings. Roles and categories match by name,
the demo lender by its reserved token identifier, and tools by owner and name.
Renaming a sample tool allows the original sample name to be inserted again.

To initialize only roles and categories without demo users or listings:

```sh
npx convex run seed:run '{"includeDemoTools":false}'
```

In Windows PowerShell, use `npx.cmd` if execution policy blocks `npx.ps1`.
For JSON arguments that your shell rewrites, run `seed:run` through the Convex
dashboard function runner with `{ "includeDemoTools": false }`.

The demo owner is explicitly fictional, has the standard user role and the sample
email `test@gmail.com`, and has no Clerk account or sign-in ability. Rerunning the
seeder updates this reserved demo account's email without replacing its ID or permissions.
The seeder never assigns admin access
to a person or modifies an existing user's role. Sample listings belong to the
demo owner, so they are not personal listings for a signed-in Clerk user.
Inactive existing demo owners/categories do not receive new sample listings.
No requests, loans, or automation events are seeded; availability should be
derived from bookings when that feature is implemented.

This function is internal and cannot be called by browser clients. Use a
development deployment for demo data; check your deployment target before running.

Categories store only `name`, `isActive`, `sortOrder`, and `updatedAt` in addition
to Convex system fields. Name is the seeder lookup key; renaming a seeded category
allows the original name to be inserted on the next run. Custom categories and
existing IDs/statuses are preserved. `categoryMigration:removeLegacyFields` is an
internal, paginated cleanup for old `slug`/`description` properties. Deploy a
transitional schema allowing those fields, run all cleanup pages, verify, then
deploy the schema without them. It replaces category values in place and keeps
IDs, timestamps, and tool references intact.

## Dashboard

The homepage reads categories and the paginated publicTools projection before
sign-in: cards contain only name/category. Signed-in users use memberTools,
which adds description, condition, availability, and isOwner/canBorrow flags.
Private detail pages preserve complete text. Public cards exclude unavailable
listings; member cards replace Borrow with a pending/borrowed/overdue status badge while
a tool is held or awaiting approval. Titles are plain text rather than links.
No periodic timer resets queries or scroll position; database changes remain reactive.
An overdue tool stays unavailable until its owner records return.

Search prioritizes name (weight 3), description (2), then condition (1), using
the highest matching field. Convex relevance orders matches within each tier.
Each tier uses an indexed, paginated query with category/status/owner filters;
the cursor tracks the tier, so later pages retain priority and avoid duplicates.

All lists use infinite scrolling with batches of twelve. Private listing/request
views derive the user from the verified identity; admin functions resolve the
role from the database. Signing in provisions a missing local user with the
standard user role and never replaces existing role assignments. Admin access
requires an explicit role assignment by an authorized operator.

After seeding, run this read-only smoke check from the project root:

```sh
node --env-file=.env.local scripts/verify-catalog.mjs
```

It checks the eight seed categories, sample tools, pagination, search, category
filtering, public field projection, and refusal of anonymous access to private
views. Run the isolated permission and availability tests with `npm test`.
