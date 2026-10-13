---
name: Avvisi home collaboratore
description: How the "Novità per te" block on the collaboratore home is computed (no notification table)
---
- Novità = calcolate al volo da dati esistenti (GET /avvisi), nessuna tabella di notifiche in-app: inviti a eventi futuri non confermati + aggiornamenti dell'ufficio sulle proprie pratiche (cambio stato, presa in carico, messaggio ufficio, allegato ufficio), ultimi 30 giorni.
- "Letto" = colonna `vista_dal_collaboratore_il` su pratiche, impostata quando il proprietario (non il capogruppo) apre il dettaglio; senza lettura si parte da `inviata_il`. Non viene scritto nel registro log (sarebbe rumore).
- Solo pratiche proprie, non quelle del gruppo.
**Why:** richiesta utente "invito all'evento o aggiornamento pratica"; evitare un nuovo sistema di notifiche.
**How to apply:** nuovi tipi di aggiornamento ufficio devono aggiornare `ultima_attivita_backoffice_il` e, se vanno descritti, essere aggiunti in lib/avvisi.ts.
