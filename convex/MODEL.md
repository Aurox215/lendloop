# LendLoop data model

`schema.ts` defines the domain tables, `automationEvents`, and `auditLogs`. Convex supplies
`_id` and `_creationTime`; `updatedAt` and all `*At` fields are UTC Unix timestamps
in milliseconds. IDs are typed references, not copies of Clerk IDs.

| Table | Purpose |
| --- | --- |
| `roles` | Two allowed names: `user` and `admin`. Each user references one role. |
| `users` | Clerk identity, display name, optional email, role, and trusted lender audit fields. |
| `categories` | Category name, display order, active state, and update timestamp. |
| `tools` | Owner, category, condition, description, and listing visibility/removal audit. |
| `borrowRequests` | Requested interval, borrower and lender, decision/cancellation audit, notification version. |
| `loans` | Active approved booking and owner-confirmed return tracking, reminder summary. |
| `automationEvents` | Notification delivery status, retries, errors, and idempotency keys. |
| `auditLogs` | Transactional audit trail for account, listing, category, and permission changes. |
| `alarms` | Durable participant-only request/reminder alarms with read state and navigation targets. |

Suggested categories: power tools, garden, kitchen, camping, hand tools, cleaning,
and other. Defining a schema does not insert role or category records, or sync
Clerk users. No public read or write functions are introduced by this schema.

## Rules for the function layer

Schema validators enforce field types and allowed enum values. Convex indexes do
not enforce uniqueness or foreign-key existence. Mutations enforce
these business rules transactionally:

- Maintain one role per name, one category per name, and one user per
  `tokenIdentifier`. Derive identity from `ctx.auth.getUserIdentity()`; assign new
  users the `user` role on the server. Only an admin can change roles or trust flags.
- Resolve all referenced documents and require active users/categories. Accept
  only nonempty, bounded names/descriptions and valid finite timestamps.
- Only owners can edit their tools; owners or admins can remove them. Use
  `removed` status to preserve request/loan references. Public tool queries must
  explicitly project only name/category (plus the tool ID),
  excluding owner and contact data.
- Derive the request lender from the tool owner. Refuse self-borrowing. Require
  `startAt < endAt` and future booking dates. Only the lender may approve/decline;
  cancellation is not exposed. Increment `statusVersion` on transitions.
- Approve a pending request and insert its single loan in one mutation. Check
  `by_requestId` before inserting; prevent overlapping scheduled/active loans for
  the same tool (`existing.startAt < new.endAt && existing.dueAt > new.startAt`).
  Booking intervals are half-open: `[startAt, endAt)`.
- Approval immediately creates an active loan; the owner alone can confirm physical
  receipt and atomically mark it returned. Repeated returns preserve returnedAt.
  Overdue is derived from active status and dueAt < now, not a persisted flag.
  Legacy scheduled/cancelled enum values remain readable for safe data migration;
  maintenance converts scheduled rows to active. There is no handover mutation/UI.
- Listing identity is owner + category + normalized name. Nonremoved duplicates
  are rejected transactionally. A stable owner-scoped createKey makes retries
  idempotent. Titles/categories/descriptions are limited to 80/40/500 characters.
- Notification events use one deterministic key per logical transition,
  e.g. request:<id>:<statusVersion>. Alarm keys append the recipient ID. An event
  may fan out to several recipients without creating several event rows.
  Look up by_idempotencyKey and insert/update in the same transaction. Reminder
  keys include loan and UTC day; successful write-backs update counters once.
  Keep errors sanitized and secrets out of records.
- Expected borrow/listing validation returns a typed result. Auth and unexpected
  failures still throw; all expected checks run before the first business write.

Borrow creation/decisions and owner-confirmed return enforce these rules in
`borrowing.ts`. `alarms.ts` writes participant alarms and the outbox in the same
transaction. `automation.ts` implements signed webhook dispatch, delivery leases,
retry recovery, daily reminder keys, and idempotent write-backs via `http.ts`.
The n8n workflows and local runtime setup live in `n8n/`. Transport failures do
not undo a saved request or remove its alarm. Obsolete overdue deliveries are
marked skipped when the loan is no longer overdue.

## Active views and alarm retention

Declined/cancelled requests and returned/cancelled loans are excluded from both
participants? active request views. Records are retained for audit and admin loan
history. Returning a loan releases its availability check; other active loans,
pending requests, listing/category status, and ownership still apply.

Approval is immediately Borrowed, with no Reserved display state. Reading alarms
only sets readAt and adjusts the unread counter once; it does not dismiss history.
Loan overdueAlarmCreatedAt tracks initial alert creation, not delivery success.
The initial deadline job and daily n8n workflow share a deterministic UTC-day key.
A paginated recovery cron handles missing initial alerts, and overdue:inspect
checks that the corresponding alarm really exists in the database.
