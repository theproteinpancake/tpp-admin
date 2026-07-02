# TPP Control — Security Incident Response Plan

**Owner:** Luke (Owner/Incident Commander) · **Last reviewed:** 2026-07 · **Next review due:** 2027-01 (6-monthly)

## Scope

Any suspected or confirmed security incident touching TPP Control (the admin dashboard, its
Supabase databases, or any connected third-party integration), specifically including — but not
limited to — anything that could expose or affect **Amazon Information** accessed via the SP-API
integration (Amazon order data, SP-API credentials/refresh tokens, marketplace data for AU/UK).

Examples of a reportable incident: a leaked or compromised credential/token (Supabase service key,
Amazon SP-API refresh token, Google OAuth token, admin/staff password), unauthorized account
access, a bug that exposes one customer's/partner's data to another, malware or unauthorized code
in the deployed app, or a lost/stolen device with an active session.

## Roles

TPP is a small team; one person can hold more than one role below. This will be re-split as the
team grows.

| Role | Who | Responsibility |
|---|---|---|
| **Incident Commander** | Luke (Owner) | Declares the incident, owns the response end-to-end, makes the call on containment/disclosure, is the point of contact for external notifications (including Amazon). |
| **Technical Lead** | Luke (Owner) | Contains the issue (revoke/rotate credentials, disable accounts, patch the bug), investigates root cause and blast radius. |
| **Communications** | Luke (Owner) | Notifies affected external parties (Amazon, other integration partners, customers if required) and internal staff (Reece, Kate). |

## Severity

- **Critical** — active exploitation, credential/token compromise, customer or partner data
  exposed, or Amazon Information affected. Triggers the full procedure below immediately.
- **Moderate** — a vulnerability or misconfiguration found with no evidence of exploitation.
  Contained and fixed on the same priority, external notification only if scope later escalates.
- **Low** — a near-miss or hardening opportunity with no data or access impact. Logged and fixed,
  no notification required.

## Response procedure

1. **Detect & declare.** Anyone (Luke, Reece, Kate) who notices something suspicious flags it to
   Luke immediately. Luke confirms severity and declares an incident if it's Critical or Moderate.
2. **Contain (within hours of detection).** Rotate/revoke any compromised credential or token
   immediately (Supabase service keys, SP-API refresh token, Google OAuth tokens, the affected
   user's password — the app already supports forced password resets and mandatory MFA for this).
   Disable the affected account if applicable.
3. **Assess.** Determine what was accessed, by whom, and whether Amazon Information was involved.
4. **Notify — within 24 hours of detection:**
   - If Amazon Information is affected (or the incident touches the SP-API integration at all):
     email **security@amazon.com** with a description of the incident, systems/data affected, and
     containment steps already taken.
   - Notify internal staff (Reece/Kate) if their accounts or data are involved.
   - Notify any other affected external party (e.g. Shopify, Xero, ShipBob) if their data or
     integration was involved.
5. **Remediate.** Fix the root cause (code fix, config change, revoked access), not just the
   symptom. Verify the fix before closing the incident.
6. **Document.** Record what happened, timeline, root cause, and fix in this repo (append to a
   dated log below) so it feeds into the next review.

## Review cadence

This plan — and the controls it depends on (password policy, mandatory MFA, credential storage
practices) — is reviewed at least every **6 months**, or immediately after any real incident,
whichever comes first.

## Incident log

_None recorded as of 2026-07._
