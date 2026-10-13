---
name: Tutela CRM phase 2 (assistiti) decisions
description: Duplicate-handling, visibility and permission choices made for assistiti and segnalazioni
---

- Duplicate messages shown to a collaboratore are always generic ("risulta già presente"), never revealing name, role, sportello, or whether the match is an assistito or a collaboratore. Only back-office segnalazioni show detail.
- Matches on CF or cellulare against another collaboratore's assistito OR against a collaboratore create/update an open segnalazione (deduped per requester + existing person, `tentativi` incremented). Notification to admin is in-app only (sidebar badge); email is deferred.
- If the match is an assistito already in the user's own or group elenco, a distinct message with a link is returned and no segnalazione is created.
- Collaboratore edits only own assistiti; capogruppo sees group assistiti read-only. Non-visible assistito returns 404. Only admin/super_admin reassign assistiti and handle segnalazioni; operatore reads assistiti only.
- "Associare una pratica" to another collaboratore is NOT implemented (pratiche do not exist yet): add it when pratiche arrive.
- Back-office editing of an assistito's anagrafica is not built.

**Why:** choices made by the agent from the phase 2 brief; user to confirm.
**How to apply:** keep later phases (pratiche) consistent with these visibility and leak-free duplicate rules.

## Residenza dell'assistito (aggiornamento)
- Città, provincia (sigla), CAP (5 cifre) e indirizzo (via + civico in un campo) sono obbligatori in creazione/modifica. Gli assistiti vecchi hanno provincia/CAP vuoti nel DB e vanno completati alla prima modifica.
- Ricerca automatica: suggerimenti comuni dalla ricerca luoghi esistente; il dataset CAP (da comuni-json, per codice catastale) è in `api-server/src/data/cap.json`. Comuni con più CAP: il CAP non viene precompilato, si sceglie da elenco. Nessun servizio esterno di geocoding.
- Provincia e CAP alimentano anche i segnaposto del mandato compilato (cliente.cap, cliente.provincia).

**Why:** richiesta utente; i dati servono per i mandati.
**How to apply:** la creazione di assistiti da importazione Excel (se mai aggiunta) deve fornire anche provincia/CAP/indirizzo.
