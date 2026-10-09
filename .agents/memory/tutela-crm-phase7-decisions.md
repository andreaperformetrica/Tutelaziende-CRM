---
name: Phase 7 eventi e corsi decisions
description: Permissions, locks and design choices for eventi, QR, check-in, attestati, questionario
---
- Only admin/super_admin manage eventi and check-in; a sede sees only events it is invited to (no group visibility).
- A sede must confirm before adding participants; it can edit/delete a participant only while no entrata/uscita exists.
- An invito can be removed only if the sede has no participants; an evento can be deleted, or its date changed, only while no orari are recorded.
- "Presente" = entrataIl not null (used for the "all presenti" attestati). Uscita without entrata is accepted with a warning.
- QR content is the `codiceQr` token, generated client-side; only the sede response exposes it, never the admin one.
- Attestato: layout PDF/PNG/JPG, name centred at x/y % with auto-shrink; admin-only. Questionario: any allowed file type, downloadable by invited sedi.
- WhatsApp invite uses a second Twilio template (secret `TWILIO_WHATSAPP_TEMPLATE_EVENTO_SID`), deliberately not part of the general channel status.
**Why:** privacy habit from phase 6 (invites carry only titolo, data, orario, luogo, link) and the user's rule of locking data once real-world events are recorded.
**How to apply:** keep these locks when adding features (e.g. notifying sedi on event changes is not built yet).
