---
name: Aggiornamento 6 — compensi, estratti, ricevute
description: Decisioni su ricevute/pagamenti e fatture, crediti, esclusioni estratti, invio massivo, allegato pagamento
---
- Ricevute: una per riga dare/avere (indice unico), numerazione annuale senza buchi, eliminabile solo l'ultima non pagata; riga/estratto con ricevuta non modificabile; non dai debiti.
- Dati della ricevuta sono una copia fissata alla creazione (cambiare impostazioni non tocca le vecchie).
- P.IVA: importo digitato = imponibile, IVA aggiunta (aliquota default dalle impostazioni, 22); associazioni senza IVA. IBAN del collaboratore obbligatorio (409 IBAN_MANCANTE); banca/filiale sono campi nuovi opzionali.
- Operatore: solo GET dare/avere, crea ricevute, usa Pagamenti e fatture; impostazioni ricevute solo admin/super_admin. **Why:** il testo diceva "super admin e operatori"; scelta da confermare con l'utente.
- Esclusione pratiche in estratto: praticaIds = incluse, escluse = separate con motivo; restano nel resoconto, traccia sull'estratto.
- "Ultimo invio" e registro invii derivano dalle notifiche evento estratto_inviato. Allegato pagamento (estratto e ricevuta) solo dopo registrato il pagamento, PDF/immagini.
- Test via curl: upload binari richiede Content-Type application/octet-stream (con altri tipi il body viene consumato dal parser globale).
