---
name: Aggiornamento 3 (gestione pratiche back office)
description: priorità, scadenze per tipo con solleciti email, Scarica tutto, export Excel, filtri date veloci
---
- Priorità urgente/media/bassa (default media) modificabile da tutti i ruoli back office; il collaboratore non la vede.
- Scadenza per tipo di pratica: giorni dall'invio + un solo valore di anticipo per tipo; popup solo in "Le mie pratiche" (pratiche in carico all'utente), banner nella scheda. Nessuna scadenza = nessun avviso.
- Solleciti email (vicina / superata) una sola volta per pratica, controllo all'avvio e ogni ora; i flag si azzerano alla presa in carico e quando l'admin cambia scadenza/anticipo del tipo. Testi senza tipo né dati assistito.
- Filtri date dell'elenco = intervalli su `inviata_il` (mai `(inviata_il at time zone)::date`, non usa gli indici); conteggi BO senza join inutili.
**Why:** con 200k pratiche il filtro per date impiegava 0,2-0,5 s (scansione completa); ora 15-50 ms.
- Data+ora applicata a elenco pratiche e importazioni; "Data pratica" di Compensi (resoconto/estratti, date senza ora) lasciata invariata di proposito (altra area).
- Export Excel: massimo 50.000 righe, errore chiaro oltre; date scritte come ora di Roma.
- Per misure di prestazioni: seed temporaneo di pratiche con marker nel messaggio, poi cancellato.
