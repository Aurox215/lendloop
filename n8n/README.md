# Connect LendLoop to n8n Cloud

Instance: **https://aurox.app.n8n.cloud/**

Your browser application talks to Convex. Convex sends signed request events to
n8n Cloud, and n8n calls secured Convex HTTP endpoints to record delivery and
fetch overdue loans. Cloud-to-cloud calls need no Docker, localhost proxy, or tunnel.
The assignment uses logged mock delivery plus persistent in-app alarms; it does
not send email to real addresses.

## 1. Check the Convex HTTP origin

There are two different Convex URLs:

| URL | Used by |
| --- | --- |
| `https://scintillating-shepherd-249.eu-west-1.convex.cloud` | Next.js data/auth client (`NEXT_PUBLIC_CONVEX_URL`). |
| `https://scintillating-shepherd-249.eu-west-1.convex.site` | n8n HTTP requests (`CONVEX_SITE_URL`). |

Use `.convex.site` for automation. Keep the region in the URL. Generate exports
from the repository root:

```sh
node n8n/build-workflows.mjs
```

The generator reads the public Convex origin from local configuration and embeds
only that public URL. For another deployment, use:

```sh
node n8n/build-workflows.mjs --site-url https://YOUR-DEPLOYMENT.convex.site
```

Never generate production workflows accidentally against your development backend.

## 2. Prepare the shared secret

A shared HMAC secret must match in **two places**:

- Convex deployment environment variable `AUTOMATION_SHARED_SECRET`.
- The **Hmac Secret** field of an n8n **Crypto** credential.

This workspace has an ignored `n8n/.env` created by `node n8n/setup.mjs`.
Copy only its `AUTOMATION_SHARED_SECRET` value into the credential. Do not paste
it into this chat, a workflow node parameter, `$vars`, a Set node, or exported JSON.
The setup script generates random values on a fresh clone and preserves an
existing file. If you generate a new key, also set the same value on Convex through
its dashboard Environment Variables page or a secret piped to `convex env set`.
Local `.env` files alone do not configure cloud Convex.

In n8n Cloud, create a credential:

1. Open **Credentials → Add credential** and search for **Crypto**.
2. Name it **LendLoop HMAC**.
3. Set **Hmac Secret** to the matching shared secret and save.
4. Do not fill unrelated encryption/private-key fields unless the UI requires it
   for another operation; this integration uses only Hmac.

Use **Crypto node version 2**, which reads its HMAC secret from a credential. If
an old instance only offers a legacy Crypto node with an inline Secret parameter,
update the node/instance rather than putting the secret into workflow parameters.
Code nodes deliberately use no `$env`, external crypto imports, or secret values,
so the workflows also work with Cloud's restricted Code runtime.

## 3. Import the three JSON workflows

In the n8n editor, choose **Import from File** and import in this order:

1. `n8n/workflows/errors.json` — **LendLoop · Automation errors**.
2. `n8n/workflows/requests.json` — **LendLoop · Request notifications**.
3. `n8n/workflows/overdue.json` — **LendLoop · Daily overdue reminders**.

If you imported the earlier environment-based exports, replace those definitions
with these credential-based versions. Only one published workflow should own the
`lendloop-requests` webhook path.

Select **LendLoop HMAC** in each of these four Crypto nodes:

| Workflow | Crypto nodes |
| --- | --- |
| Request notifications | **Verify webhook HMAC**, **Sign completion** |
| Daily overdue reminders | **Sign overdue request**, **Sign reminders** |

Each node uses **Hmac**, **SHA256**, **HEX**, and the credential. Leave the
Value expressions and Property Name fields from the import unchanged. The
expected incoming signature is computed before the **Verify and notify** Code
node, which rejects mismatches before mock delivery or write-back.

The Webhook node's built-in Authentication stays **None** because the following
HMAC nodes implement authentication. Do not bypass those nodes or connect the
webhook directly to a delivery step. Cloud execution-history retention depends on
your n8n plan; Docker is configured to prune history after seven days.

In the request and overdue workflows' **Settings**, select the imported
**LendLoop · Automation errors** workflow as **Error workflow**. Importers can
remap IDs, so check this association manually. Keep failed executions saved.

Publish/activate the **request** and **overdue** workflows. The Error Trigger
workflow is invoked through the error-workflow association; it has no schedule
or public webhook of its own.

## 4. Configure the production webhook URL in Convex

Open the request workflow's **Borrow webhook** node and copy its **Production URL**.
With the supplied path, it should be:

```text
https://aurox.app.n8n.cloud/webhook/lendloop-requests
```

Set `N8N_WEBHOOK_URL` on the intended Convex deployment to that exact URL:

```sh
npx convex env set N8N_WEBHOOK_URL https://aurox.app.n8n.cloud/webhook/lendloop-requests
```

Check the deployment target before running CLI writes. This project's current
personal development target is `scintillating-shepherd-249`. Do not pass `--prod`
without intending a production change. A `/webhook-test/…` URL only works while
listening in the editor; it is not suitable for scheduled/production delivery.

If the backend is not synced yet, run `npx convex dev --once` for development.
Cloud configuration does not require opening any inbound port on your computer.

Check the Convex URL/secret pair without creating a notification:

```sh
node n8n/check-connection.mjs
```

Expected statuses: unsigned **401**, signed **200**, tampered **401**. This sends
empty completion batches and changes no application records. It verifies Convex
authentication; it does not verify the credential selected in your Cloud editor.

## 5. Verify request notification delivery

1. Use two Clerk accounts: one lender with a tool and one borrower.
2. Request the tool as the borrower. The lender receives the incoming-request
   alarm. Both views read the same saved request; the borrower sees My requests
   without receiving an echo alarm for their own submission.
3. Open **Executions** in n8n and inspect the request workflow. The signed event
   should pass verification and the **Record delivery** HTTP node should return
   `{ "delivered": true }`.
4. In Convex, find the corresponding `automationEvents` record. Its state should
   become `sent`, not repeatedly create new alarms.
5. Confirm Accept/Decline as the owner. The borrower receives a new alarm and a
   toast while the app is open. Approval creates one loan; acceptance retries
   cannot create another loan or duplicate the alarm.
6. Open the bell menu. The global unread badge clears for alarms already present;
   later arrivals increment it again. Read alarms remain in the dropdown; clicking
   an individual alarm is idempotent and never deletes it.

If n8n is unavailable, the borrow request and alarms still commit. A failure is
shown on the request card and in Convex logs/outbox state. Once configuration is
fixed, an authorized operator can run:

```sh
npx convex run automation:requeueFailed
```

This requeues up to 25 failed events per call. Do not requeue failures until the
endpoint, credential, and workflow publishing settings have been corrected.

## 6. Verify the daily overdue workflow

The Schedule Trigger runs **once per day at 08:00 UTC**. In Tokyo this is 17:00.
You may change the workflow timezone/schedule in n8n Settings and the trigger.
Use **Execute workflow** to check it manually before relying on the schedule.

The workflow:

1. Signs and calls `POST /automation/overdue` at the Convex `.site` origin.
2. Fetches unreturned, past-due active **and scheduled** loans in pages of 25.
   New approvals are active immediately. Scheduled is legacy compatibility only;
   there is no handover step. Returned loans are excluded.
3. Logs mock borrower delivery and signs `POST /automation/complete`.
4. Records completion exactly once and follows the cursor until `isDone`.
   Empty pages with a continuation cursor are still followed.

A deterministic loan/borrower/UTC-day key prevents duplicate daily alarms and
reminder records. Completion retries do not increment `reminderCount` twice.
Returned loans are excluded and stale retry events are marked skipped.
Convex also schedules the initial persisted alarm when the loan becomes overdue;
a five-minute recovery scan covers older loans and missed jobs. These use the
same UTC-day key as n8n, so a reminder already delivered that day can legitimately
produce no new items when the daily workflow runs. The next UTC day is eligible
for a new reminder while the loan remains unreturned.
For a test loan, use a development deployment/fixture with an expired due date;
never change real production loan dates just to trigger a reminder.

## Security, retries, and diagnostics

- Convex signs `<timestamp>.<original-payload-string>` using HMAC SHA-256.
  n8n validates timestamp/format, recomputes the HMAC using Crypto credentials,
  compares signatures without an early exit, then parses the authenticated payload.
- n8n signs `<timestamp>.POST.<path>.<raw-body>` before every Convex HTTP call.
  Convex verifies the signature, a five-minute window, payload size, IDs, and keys.
- Only narrow event-completion/reminder endpoints are exposed. n8n has no database
  admin credential or Clerk secret, and receives no borrower email/contact data.
- HTTP nodes retry three times; Convex delivery attempts use exponential backoff,
  a processing lease, and a five-minute interrupted-delivery recovery sweep.
  After six attempts an event stays visibly failed until an operator requeues it.
- Delivery is at least once. Database effects are idempotent; mock log lines may
  repeat after retries. Alarms are created with the original request transaction,
  rather than relying on an external system to reconstruct the request later.
- The Error Trigger workflow retains/logs sanitized execution and workflow IDs.
  Inspect n8n **Executions**, Convex `automationEvents`, and structured logs.

| Symptom | Check |
| --- | --- |
| n8n 404 | Workflow is published; URL uses `/webhook/`, not `/webhook-test/`. |
| Signature failure | Same Hmac Secret on both sides; Crypto v2 credential selected in all four nodes; timestamps are fresh. |
| Convex HTTP 401 | Correct `.site` URL, raw-body HMAC expressions, and matching shared secret. |
| Wrong backend | Regenerate exports with the intended public `.site` origin. |
| No overdue results | A scheduled/active loan must be past due and unreturned; follow both pagination phases. |
| A saved request but failed delivery | Fix n8n settings, then requeue; do not recreate the request. |

## Docker alternative

Cloud is the primary setup for this project. Docker remains optional:

```sh
node n8n/setup.mjs
node n8n/build-workflows.mjs
# Requires Docker Desktop / Docker Engine with Compose:
docker compose --env-file n8n/.env -f n8n/compose.yaml up -d
```

Open http://localhost:5678, create the owner account, and follow the same credential
and workflow import steps. Code runners receive no HMAC secret. Images are pinned
to n8n 2.46.6 with a matching external JavaScript runner. Cloud Convex cannot reach
localhost: expose local n8n through an HTTPS tunnel, then set that tunnel's
production webhook URL in Convex. Do not use a localhost URL in `N8N_WEBHOOK_URL`.

## Verified scope and references

`npm test` checks request permissions, duplicates/overlaps, booking conflicts,
alarm counts, owner returns, HMAC freshness/tampering, reminder deduplication,
and the Cloud Code/Crypto-node contracts. These are not a claim that your Cloud
credential is configured or your workflows are published. A live end-to-end run
requires your account access and the manual verification above. No Cloud workflow
has been imported or published merely by adding its instance URL to this repo.

Official references: [Crypto node and credential-based HMAC](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.crypto/),
[Webhook production URLs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/),
[error handling](https://docs.n8n.io/flow-logic/error-handling/).

## One event, multiple views

One borrow creates one borrowRequests record and one request.created automation
row. My Requests and Incoming Requests read that same request. The lender receives
the creation alarm; only the borrower receives approval/decline results. An event's
notifications array supports recipient fan-out inside a single workflow invocation.
Retries can produce additional executions or mock log lines, with no duplicate
alarms or reminder counters. Reimport the latest request workflow after upgrading
from the former per-recipient exports; keep only one published webhook owner.

The app displays the latest recorded automation state on each loan card, including
failed deliveries. A saved request remains usable during an n8n outage. These
in-app alarms commit in Convex before delivery; n8n performs the allowed logged
mock notification and signed acknowledgment, rather than being a prerequisite
for saving or viewing requests.

Initial overdue alarms now persist independently of Cloud execution. The n8n
workflow payload and credentials have not changed for this update; reimport is
not required solely for these alarm fixes. Failed external delivery remains
visible in automationEvents, while the in-app alarm remains readable.
