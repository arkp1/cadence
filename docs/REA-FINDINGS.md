# What I learned about Calendly using REA

**Purpose:** a clean-room feature study. I used REA (`rea-agents` 6.7.0, https://github.com/morluto/rea) to look at the
**public** booking page bundle and work out *what Calendly does*. Cadence is my own implementation of that behavior.
No Calendly code, styles, or assets went into Cadence.

## Method

| Step | Command / action | Result |
|---|---|---|
| 1 | `curl https://calendly.com/<public-page>` | Found the entry script `assets/booking/js/booking-*.js` (6.8 MB webpack bundle) |
| 2 | `rea analyze-javascript-application ./bundle --json` | The analyzer was **SIGKILLed** (killed for using too much memory) inside the 1 GB sandbox. REA reported this as `execution_failure` and kept a partial Evidence record |
| 3 | Split the webpack module table into 3,002 per-module files (acorn) | Inputs small enough to analyze |
| 4 | `rea analyze-javascript-application ./app` (121 booking-domain modules, 732 KB) | Completed: 121 files parsed, 0 parse failures, 65,317 AST nodes, 111 findings. The semantic graph flagged 30+ `JSON.parse` boundaries, which turned out to be embedded locale dictionaries |
| 5 | Pulled the `en` dictionaries out of those boundaries, then grepped the bundle for `/api/booking/*` literals | 423 UI strings and 41 endpoint templates (listed below) |

Limitations reported by REA: the semantic analysis of some modules was capped by "remaining result capacity". There is
no runtime/browser capture (no Chrome in this sandbox), so the findings are static only.

## Public booking API surface (endpoint templates found in the bundle)

```
GET  /api/booking/profiles/:slug                      -> profile (name, avatar, timezone, locale)
GET  /api/booking/profiles/:slug/event_types          -> public event types
GET  /api/booking/event_types/:uuid/calendar/range    -> slots. params: timezone, range_start, range_end,
                                                         duration_override, scheduling_link_uuid, rescheduling{invitee_uuid}
GET  /api/booking/event_types/:uuid/calendar_tracings/range  (diagnostics=true; host-only troubleshooting)
POST /api/booking/invitees                            -> book (header Booking-Request-ID = idempotency key)
GET  /api/booking/invitees/:uuid  · /api/booking/cancellations/:uuid · /api/booking/invitee_confirmations/:uuid
GET  /api/booking/scheduling_links/:uid               -> single-use links
GET  /api/booking/routing_forms/:id · /api/booking/routes/:id
POST /api/booking/poll_votes                          -> meeting polls
     /api/booking/packages, /invoices, /stripe_payment_intents, /paypal_orders   -> payments
     /api/booking/booking_codes/apply, /landing_pages/:id, /calendar_accounts
```

## Availability rules (from the `booking_kit.diagnostics.codes.*` strings)

| Code | Meaning | Implemented in Cadence (`server/slots.js`) |
|---|---|---|
| PAST | slot is in the past | ✅ |
| TOOSOON | inside the minimum scheduling notice | ✅ |
| RANGE | outside the bookable date range | ✅ (rolling days / fixed range / indefinite) |
| BUFFER | before/after buffer of this event or another event blocks it | ✅ (both directions) |
| CALENDAR | busy event on a connected calendar | ✅ (ICS-feed calendars) |
| EVENT / OVERLAP | already booked / overlaps another scheduled meeting | ✅ |
| DAYMAX / WEEKMAX / MONTHMAX | per-event-type booking limits | ✅ |
| GROUP | group event is at capacity ("N spots left") | ✅ |
| BLOCK_OUT_DATE | host time off | ✅ |
| HOSTS | collective event: not all hosts are free | ✅ |
| ROUNDROBIN | no round-robin host is available | ✅ |
| UNFAIR | equal-distribution round robin skips hosts who are ahead | ✅ |
| USER_EVENT_LIMITS | host-level meeting limit | ✅ (max meetings/day) |
| RESERVED | time held for a one-off meeting or poll | ✅ (meeting polls with "reserve times") |
| no_rules / blackout | weekday not in the schedule / date override marked unavailable | ✅ |

Other behavior seen in the strings: 12h/24h time format, a searchable time zone picker with an option to lock times to
the host's zone, "Former Time" shown on reschedule, "spots left" on group events, "Web conferencing details provided
upon confirmation", inbound vs outbound phone call locations, routing-form landing pages, and the "Troubleshoot your
availability" view that invitees never see.
