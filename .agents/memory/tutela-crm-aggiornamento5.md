---
name: Aggiornamento 5 eventi e formazione
description: partecipanti con email + QR per email, check-in con uscita/ore, soglia attestato, documenti ai presenti, questionario online one-shot
---
- Presente = entrata registrata. Ore = uscita - entrata (minuti interi); senza uscita nessuna ora e nessun attestato. Soglia ore per evento, default 3, modificabile solo dall'admin.
- Il testo fisso "della durata di : 8 ORE" è stato tolto dal modello PDF attestato (originale in generated-artifacts/att, git-ignored); ora si disegna "con una partecipazione effettiva di : X ORE E Y MINUTI". Wording scelto da noi.
- Questionario online è SEPARATO da quello cartaceo (PDF). 1 punto per risposta esatta, punteggio minimo <= n domande. Domande bloccate dopo il primo invio. Token personale monouso: una sola compilazione (update condizionato), nessun retry; reinvio solo a chi non ha compilato (stesso link). Risposte esatte mai esposte alla pagina pubblica.
- Route pubbliche /questionari/:token sono montate prima di richiediLogin; log anonimo (utente null).
- Partecipanti inseriti prima dell'aggiornamento hanno email null: non ricevono QR/documenti/questionario.
- Documenti corso: max 25 MB totali per evento (vanno per email), accettano anche ppt/pptx/odp solo qui. "Invia ai presenti" manda i non ancora inviati (o tutti se già tutti inviati).
- Email con allegati non verificabili in dev (Resend rifiuta @example.com): la generazione allegati si vede dall'errore 422 di Resend.

**Why:** richieste utente (Aggiornamento 5). **How to apply:** coerenza se si toccano eventi/attestati/questionari.
