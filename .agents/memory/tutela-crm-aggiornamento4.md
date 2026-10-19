---
name: Aggiornamento 4
description: notifiche (canale default, base URL, oggetto email), alert collaboratori, dashboard operatore, chat interna, statistiche operatori
---
- Commento operatore: canale predefinito "Email e WhatsApp". Oggetto email pratica aggiornata: "Pratica aggiornata per NOME COGNOME" (assistito ammesso dall'utente); il tipo di pratica non compare mai in oggetto/WhatsApp.
- Base URL dei link: impostazione DB `url_piattaforma` > segreto URL_PIATTAFORMA > primo REPLIT_DOMAINS > REPLIT_DEV_DOMAIN; localhost/indirizzi interni rifiutati. **Why:** il DB di produzione e' diverso da quello di sviluppo, l'indirizzo va reimpostato li' se serve.
- Alert: nessun seed all'avvio (regole create al primo salvataggio, default nel codice: 2 mesi; soglia 3 in 30 giorni). Un'email digest per admin sui nuovi alert; si chiudono da soli. Controllo orario + a ogni salvataggio.
- Dashboard e' la pagina iniziale di tutto il back office (homeFor). Login con `?ritorno=` (solo percorsi interni) per i link nelle email.
- Chat: solo utenti interni, polling (no websocket), niente modifica/cancellazione; generale + DM (chiavi "generale"/"u<id>").
- Statistiche operatori (solo super_admin): lavorate = pratiche distinte con cambio stato/commento/allegato ufficio; chiuse = cambio stato verso stato chiuso; tempo medio dalla prima presa in carico (o invio) alla chiusura.
