---
name: Tutela CRM domain rules
description: Confirmed business rules and working agreement for the Tutela CRM (patronato/CAF) project
---

Working agreement: the user sends phases 1-9 one at a time; stop at the end of each phase for their verification. Do not build ahead.

Stack choices: single web app with /admin and /collaboratore areas; email+password login managed by the app (NOT Replit Auth, explicit user request); Postgres via DATABASE_URL only; all files via one storage module on App Storage (DB keeps only the key); permissions enforced server-side; every operator/collaborator action goes to the operations log.

Domain rules (user-confirmed):
- "Sede" = collaboratore; no separate Sede entity. Sportello number and tipologia (CAF/Patronato) live on the collaboratore. Capogruppo sees group members' data (one level).
- Codice fiscale and cellulare are unique across collaboratori AND assistiti together (a person cannot be both).
- Mandato = a file the admin uploads per (collaboratore, tipo pratica); collaboratore downloads it when opening a pratica of that type; admin can replace it for a single collaboratore. All collaboratori can open all pratica types.
- Tipo pratica: required documents, downloadable forms (moduli), pagabile yes/no, punti, valore euro. Attachment categories are admin-managed (operator dropdown).
- Impostazioni orari = windows when collaboratori may submit pratiche; blocked server-side outside them. Initial: blocked Friday 18:00 to Monday 09:00 Europe/Rome. Login always allowed.
- Estratto = list of closed, payable pratiche of one collaboratore (assistito, numero, tipo, data, punti, ristorno), with total punti, total ristorno, print date. A pratica belongs to at most one estratto. Payment is recorded on the estratto (date, amount, method) and moves its pratiche to state Pagata. Collaboratore receives the estratto by email (no compensation view in the web area).
- Dare/avere = per collaboratore per year, fixed sections Naspi, Pensionati, Patronato, CAF, Debiti; rows have description, amount, payment date, note. Patronato section is fed by estratto totals. Total avere = sum of amounts minus debiti.
- Event participants are entered by the collaboratore (nome, cognome); each has a personal QR code; entry/exit times recorded at check-in, editable by admin.
- Comments = pratica chat between collaboratore and back office; both see all messages with author and timestamp; no internal comments.
- Log archiving: super admin exports a period (CSV in storage); rows are flagged archived, not deleted.
