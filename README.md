# LendLoop

A neighborhood tool-lending board built with Next.js App Router, TypeScript,
Clerk, and Convex. Borrow what you need. Lend what you don't.

## Getting Started

### Code structure and text handling

- `src/app/`: App Router pages, authentication providers, and the application shell.
- `src/components/board/`: Filters, paginated feeds, and sidebar navigation.
- `src/components/tools/`: Shared tool cards, complete detail views, and listing forms.
- `src/components/forms/` and `src/components/ui/`: Form fields, category editing, and reusable controls.
- `src/app/globals.css`: Shared wrapping and viewport constraints for forms, tables, and dialogs.
- `shared/textLimits.ts`: Shared title (80), category (40), and description (500) limits.
- `convex/tools.ts` and `categories.ts`: Validated writes with server-side ownership/admin checks.
- `convex/accounts.ts`: Authenticated user provisioning and server-side Clerk email synchronization.
- `convex/workspace.ts`: Request, loan, notification queries, and admin listing removal.
- `convex/adminUsers.ts`: Admin user listing and role/trust management.

Cards show two title lines, a one-line category with ellipsis, and three description
lines. Tool titles link to detail pages with the complete stored text. Edit forms
preserve existing values and display character counters; limits are enforced in
the form and again by Convex. Existing long records are never silently truncated.
Listing owners can create, edit, and remove their tools. Creation and editing open
in dismissible modals on My listings. Destructive tool/category actions require
confirmation. Modals support backdrop click, Escape, focus trapping, and focus
restoration. Transient dropdowns close on outside click and Escape; the Admin
navigation group keeps its expanded/collapsed state until its summary is toggled.

Admin Categories lists active and removed categories with create, edit, remove,
and restore actions. Removal preserves existing listing/loan references. Mark a
lender lists every user with role, trusted status, and account status; admins may
edit other users but never their own permissions. Role and trusted-lender selects
save immediately, with rollback/error feedback if a request fails. Category
status is editable in the table and edit form. Convex enforces these rules.

### Notifications, errors, and logs

Sonner shows short success notifications after mutations commit and specific
business errors when a write is refused. Unexpected errors get a safe message
and a reference matching structured browser-console logs. Lucide React supplies
the navigation and action icons.

Successful app writes create `auditLogs` entries in the same transaction as the
change: actor, action, target, timestamp, and relevant role/trust/status changes.
Failed mutations log operation context to Convex runtime logs and rethrow, so
failed writes roll back instead of partially saving. Application logs omit raw
form contents, emails, tokens, and secrets. Inspect durable audit records and
backend failures in the Convex dashboard; frontend error references are available
in the browser console.

Section, route, and root error boundaries keep failures recoverable with retry
controls. A connection banner reports interrupted database connectivity while
Convex reconnects. Pending mutations are not falsely reported as failed merely
because a connection is slow. Closing a pending form does not redirect the user
when its request completes; the outcome still produces a notification.

Run `npm test` for permission, validation, and legacy-value regression checks.
With the app running, `node scripts/check-layout.mjs` checks long unbroken text
at mobile, tablet, and desktop widths using headless Chrome. Set `CHROME_PATH`
if Chrome/Edge is not installed in a standard Windows location.

### Clerk + Convex authentication

Set these variables in `.env.local` (keep this file untracked):

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
CLERK_SECRET_KEY=<Clerk secret key>
CONVEX_DEPLOYMENT=dev:<your development deployment>
NEXT_PUBLIC_CONVEX_URL=https://<your deployment>.convex.cloud
CLERK_FRONTEND_API_URL=https://<your Clerk instance>.clerk.accounts.dev
```

Enable the Convex integration in the Clerk dashboard. An existing Clerk JWT
template named `convex` with audience `convex` is also supported by the client.
Set `CLERK_FRONTEND_API_URL` in the **Convex deployment's environment variables**
as well: `.env.local` alone does not configure the remote backend. Use the Clerk
instance matching the environment (development or production).

Set `CLERK_SECRET_KEY` in the Convex deployment environment too. Account initialization
fetches the authenticated user's primary email from Clerk's Backend API and stores it
in Convex, including for existing accounts whose token has no email claim. The secret
stays server-side; browser clients cannot supply an email or choose another account.
Failures show a retry message without blocking the board. Roles and trusted-lender
settings are preserved. To backfill existing real accounts, run the internal
`accounts:backfillEmails` function; continue with its returned cursor until `isDone`.
The fictional seed lender is skipped. No email addresses or secrets are logged.

Run `npx convex dev` alongside `npm run dev` to sync backend functions and auth
configuration. `ClerkProvider` wraps `ConvexProviderWithClerk`, which forwards and
refreshes Clerk tokens automatically. `/signin` and `/signup` remain local routes.

For components that call authenticated Convex functions, use `Authenticated` or
`useConvexAuth` from `convex/react` so calls wait for Convex to validate the token.
In backend functions, derive identity from `await ctx.auth.getUserIdentity()`;
reject missing identity and enforce ownership there, never trust a caller's user ID.

See the [Convex + Clerk guide](https://docs.convex.dev/auth/clerk) for dashboard
setup and separate development/production configuration.

### Troubleshooting sign-in

`/signin` logs into an existing Clerk account; `/signup` creates a new one.
An "email address is taken" error on sign-up means the Clerk account already
exists, even if no matching row exists in Convex's `users` table. Use sign-in
or Clerk's password recovery flow. Defining or seeding Convex tables does not
create Clerk accounts or automatically copy authenticated users into Convex.

Clerk browser scripts and API requests use the `/__clerk` proxy configured in
`src/proxy.ts` and `ClerkProvider`. Restart Next.js after changing that setup.
If `failed_to_load_clerk_js` persists, inspect the failed script request in the
browser Network tab: `/__clerk` must reach the Next.js server, and that server
must be able to reach your Clerk instance. For production Clerk instances,
also enable proxying in the Clerk dashboard before using this configuration.

For Convex authentication, enable the Convex integration in the matching Clerk
instance (or create a JWT template named `convex` with audience `convex`). The
deployment's `CLERK_FRONTEND_API_URL` must match the publishable key's instance.
Use `useConvexAuth` to check that Convex has accepted the token; Clerk being
signed in alone does not prove backend authentication.

### Run locally

Use Node.js 22.12 or newer. Start Convex in one terminal:

```bash
npx convex dev
```

Start Next.js in another terminal:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). See [convex/SEEDING.md](convex/SEEDING.md)
for sample data and [convex/MODEL.md](convex/MODEL.md) for domain conventions.
