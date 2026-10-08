---
name: Phase 5 back-office pratiche decisions
description: Choices made for the back-office ticketing of pratiche (list, scheda, presa in carico, allegati ufficio, chat, delete)
---
- Bozze are hidden from the BO list. List "Città" = the assistito's città (collaboratori have no city field; the mock may mean the sede's city, offer to switch).
- "Aggiornata" = collaboratore's last activity is later than the BO's last activity (so every freshly sent pratica is "aggiornata" until the BO acts). "Solo lavorate" = has an assigned operator.
- Sort by stato follows the admin's stato `ordine`. Mese filter lists months present in the data. Dal/Al are native date inputs (browser shows mm/dd/yyyy by locale).
- All BO roles can take charge, change stato, comment, attach; taking over someone else's pratica needs a confirm and is logged. Stato "Bozza" cannot be chosen. Only super_admin deletes pratiche.
- Comment channel (email/whatsapp/entrambi) is required and only saved, visible to BO only; the collaboratore sees the BO role as "Ufficio". Sending is phase 6.
- Cronologia is merged at read time, not stored as a single table.
- Query booleans must be sent only when true (zod.coerce.boolean turns "false" into true).
**Why:** choices made by the agent where the brief was silent; the user was told in the phase 5 summary.
**How to apply:** keep consistent in phase 6+ (notifications use the saved canale).
