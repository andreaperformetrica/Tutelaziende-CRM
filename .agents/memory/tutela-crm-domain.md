---
name: Tutela CRM domain rules
description: Confirmed business rules and working agreement for the Tutela CRM (patronato/CAF) project
---

Working agreement: the user sends phases 1-9 one at a time; stop at the end of each phase for their verification. Do not build ahead.

Stack choices: single web app with /admin and /collaboratore areas; email+password login managed by the app (NOT Replit Auth, explicit user request); Postgres via DATABASE_URL only; all files via one storage module on App Storage (DB keeps only the key); permissions enforced server-side; every operator/collaborator action goes to the operations log.

Domain rules (user-confirmed):
- "Sede" = collaboratore; no separate Sede entity. Sportello number and tipologia (CAF/Patronato) live on the collaboratore. Capogruppo sees group members' data (one level).
- Codice fiscale and cellulare are unique across collaboratori AND assistiti together (a person cannot be both).
- Mandato = a named file in a library per tipo pratica (e.g. one per city, uploaded once, user-confirmed); the admin assigns one to each collaboratore per tipo; collaboratore downloads it when opening a pratica of that type; changing a single collaboratore means assigning a different mandato. All collaboratori can open all pratica types. [SUPERSEDED: mandati are now per sede, one per collaboratore, not per tipo - see tutela-crm-mandati-per-sede.md]
- Tipo pratica: required documents, downloadable forms (moduli), pagabile yes/no, punti, valore euro. Attachment categories are admin-managed (operator dropdown).
- Impostazioni orari = windows when collaboratori may submit pratiche; blocked server-side outside them. Initial: blocked Friday 18:00 to Monday 09:00 Europe/Rome. Login always allowed.
- Estratto = list of closed, payable pratiche of one collaboratore (assistito, numero, tipo, data, punti, ristorno), with total punti, total ristorno, print date. A pratica belongs to at most one estratto. Payment is recorded on the estratto (date, amount, method) and moves its pratiche to state Pagata. Collaboratore receives the estratto by email (no compensation view in the web area).
- Dare/avere = per collaboratore per year, fixed sections Naspi, Pensionati, Patronato, CAF, Debiti; rows have description, amount, payment date, note. Patronato section is fed by estratto totals. Total avere = sum of amounts minus debiti.
- Event participants are entered by the collaboratore (nome, cognome); each has a personal QR code; entry/exit times recorded at check-in, editable by admin.
- Comments = pratica chat between collaboratore and back office; both see all messages with author and timestamp; no internal comments.
- Log archiving: super admin exports a period (CSV in storage); rows are flagged archived, not deleted.

Test users rule (user request): seeded and reset test users must NOT be forced to change password at login ("otherwise I can never test everything"). Keep deve_cambiare_password=false for them; the forced change stays in the app only for users created from the UI. Never re-force it when resetting test data. **Why:** the user asked. **How to apply:** any seed or reset script.

## Mobile (collaboratore area)
- Collaboratore shell: below `lg` it uses a fixed bottom tab bar (5 voci) and a compact header; lists (pratiche, assistiti) show cards below `md` and tables from `md` up. Shared UI inputs/buttons/selects are taller on mobile (h-11), normal from `md`. The backoffice shell is NOT yet mobile-optimized (sidebar).
- To check logged-in pages visually: headless chromium over CDP via `generated-artifacts/shot/shot.mjs <email> <path> <out.png>` (logs in with the test password through the proxy on port 80).
