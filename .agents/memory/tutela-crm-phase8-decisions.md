---
name: Phase 8 compensi decisions
description: Rules chosen for compensi/estratti/dare-avere where the brief was silent
---
- Punti and valore are snapshotted on the pratica when it first enters a closed stato (tipo changes later do not alter them); closed->closed keeps the first chiusaIl; reopening clears the maturation.
- "Data Pratica" on the estratto = inviataIl date; "Stampato in data" = the estratto's own date (stable on reprint). Notes/header come from current settings at PDF time.
- A pratica belongs to at most one estratto (unique index). Unpaid estratto can be deleted (releases pratiche); paid estratto and its pratiche are locked (no stato change, no delete).
- Stato "Pagata" is reserved: only set by registering an estratto payment (409 on manual change). Payment is registered once, amount typed by admin (prefilled with total).
- Dare/avere: Patronato rows are read-only, derived from the year's estratti (I°, II° Acconto...); Debiti entered positive and subtracted. Totale euro avere = sections - debiti.
- Estratto email = notifiche row with estrattoId; PDF is generated at send time and attached (Resend attachments). With no keys it is only recorded as non_inviata.
**Why:** brief did not specify these; the user should be told of them in the phase summary.
**How to apply:** keep consistent in phase 9 and any later compensi changes. Compensi features are admin/super_admin only; collaboratore gets the estratto by email only.
