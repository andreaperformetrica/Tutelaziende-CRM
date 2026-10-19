---
name: Aggiornamento 1 (sede, mandati per provincia, firma OTP, assistiti)
description: Decisions from the update touching collaboratori, anagrafiche and mandati; supersedes the per-sede mandato note and "back-office editing not built"
---
- Collaboratore has sede data (denominazione, ragione sociale, tipo soggetto PARTITA_IVA|ASSOCIAZIONE, indirizzo + comune with auto provincia/CAP, IBAN, CF associazione). Tipologia can be ENTRAMBI (affects enums/labels/filters only; eventi tipoCorso stays CAF|PATRONATO). Sportello is stored uppercase.
- Collaboratore names are shown as "Nome Cognome (denominazione)" via `nomeCollaboratore` in the frontend; assistiti names and server-built compensi strings are not changed.
- Mandati are docx templates per provincia and per tipo pratica (tipo null = all tipi). Resolution: exact tipo, then all-tipi, legacy per-collaboratore assignment only for sedi without provincia. Legacy mandati must be linked to a provincia in the admin UI (cannot be unlinked afterwards).
- Firma: collaboratore owner of the pratica signs with a 6-digit SMS code (Twilio secrets TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_DA; without them the code is only in the API server log). Signed PDF (date, time, cellulare, CF of signer) replaces the download. Not required to send the pratica. A new request invalidates the previous code; 429 if asked again within seconds.
- Assistiti: text fields uppercased on save and on display (no DML on old data). Only super_admin, admin and operatore edit an anagrafica; collaboratore gets 403 (flag `anagraficaModificabile`).
- Capogruppo group add/remove from the scheda, admin/super_admin only, logged (`collaboratore.rimosso_dal_gruppo`).

**Why:** user's "Aggiornamento 1" request ("non toccare altre aree").
**How to apply:** new columns/tables need Publish; dev mandati files were missing from dev storage (re-upload to test downloads).
