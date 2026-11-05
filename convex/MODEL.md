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
| `loans` | Approved booking, handover and return tracking, reminder summary. |
| `automationEvents` | Notification delivery status, retries, errors, and idempotency keys. |
| `auditLogs` | Transactional audit trail for account, listing, category, and permission changes. |

Suggested categories: power tools, garden, kitchen, camping, hand tools, cleaning,
and other. Defining a schema does not insert role or category records, or sync
Clerk users. No public read or write functions are introduced by this schema.

## Rules for the function layer

Schema validators enforce field types and allowed enum values. Convex indexes do
not enforce uniqueness or foreign-key existence. Future mutations must enforce
these business rules transactionally:

- Maintain one role per name, one category per name, and one user per
  `tokenIdentifier`. Derive identity from `ctx.auth.getUserIdentity()`; assign new
  users the `user` role on the server. Only an admin can change roles or trust flags.
- Resolve all referenced documents and require active users/categories. Accept
  only nonempty, bounded names/descriptions and valid finite timestamps.
- Only owners can edit their tools; owners or admins can remove them. Use
  `removed` status to preserve request/loan references. Public tool queries must
  explicitly project card fields (name, category, description, and condition),
  excluding owner and contact data.
- Derive the request lender from the tool owner. Refuse self-borrowing. Require
  `startAt < endAt` and future booking dates. Only the lender may approve/decline;
  only permitted participants may cancel. Increment `statusVersion` on transitions.
- Approve a pending request and insert its single loan in one mutation. Check
  `by_requestId` before inserting; prevent overlapping scheduled/active loans for
  the same tool (`existing.startAt < new.endAt && existing.dueAt > new.startAt`).
  Booking intervals are half-open: `[startAt, endAt)`.
- `scheduled` means approved but not handed over; `active` means handed over.
  A loan is overdue when `status === 'active' && dueAt < now`. Do not persist an
  `overdue` boolean that becomes stale. Availability derives from listing status
  and overlapping bookings. Only authorized participants can record returns;
  admin access to all loans does not implicitly grant return permission.
- For notifications, use a deterministic key per recipient and logical event,
  e.g. `request:<id>:<statusVersion>:<recipientId>` or
  `overdue:<loanId>:<UTC-date>:<recipientId>`. Look up `by_idempotencyKey` and
  insert/update in one mutation. Update loan reminder counters only on the first
  successful write-back. Keep errors sanitized and secrets out of these records.

These are model conventions, not implemented authorization or automation. The
n8n webhook signing, retries, and write-back endpoints belong in subsequent
backend/workflow implementation.
