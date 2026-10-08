---
name: Phase 6 notifications decisions
description: Providers, secrets, recipients, privacy rules and delivery model chosen for email/WhatsApp notifications
---
- Providers: Resend (email) and Twilio WhatsApp with an approved Content template (variables 1 nome, 2 numero pratica, 3 link). User allowed either of each; chosen by the agent.
- Secrets names: RESEND_API_KEY, NOTIFICHE_EMAIL_MITTENTE, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_DA, TWILIO_WHATSAPP_TEMPLATE_SID, optional URL_PIATTAFORMA (link base). Missing keys = message recorded as "non_inviata", never an error.
- Privacy (user rule): no tipo di pratica and no assistito data in any message; WhatsApp is always the same generic template. Emails (agent choice) are equally minimal and do not carry the comment text.
- Back-office users have no phone, so WhatsApp only goes to sedi; BO/admin get email only.
- Recipients (agent choice, user not asked): "pratica inviata" email goes to ALL active BO users; duplicate-anagrafica email goes to admin + super_admin, only on a NEW segnalazione (not on repeated attempts); collaboratore reply goes only to the assigned operatore (nobody if unassigned).
- Delivery model: rows are inserted "in_coda" inside the operation's transaction, sent after commit in background, and leftovers are swept at server start.
- Registro notifiche page is admin/super_admin only.
**Why:** choices made where the brief was silent; the user was told in the phase 6 summary.
**How to apply:** new events must go through lib/notifiche-eventi and keep the privacy rule.
- Third channel "chiamata": Twilio Voice with a synthetic Italian voice reading a fixed text (only pratica number, never tipo/assistito). Secrets: same Twilio SID/token plus TWILIO_CHIAMATA_DA. Operator comment channel options: email, whatsapp, chiamata, entrambi (email+WhatsApp), tutti (all three). User plans a real AI voice agent later ("tool esterno da impostare"); swap the provider inside lib/notifiche.ts only.
