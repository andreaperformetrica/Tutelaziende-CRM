---
name: Colori utenti interni
description: How per-user colors work for internal users (admin/operatore) and where they are shown
---
Each internal user can have a chosen color (`utenti.colore`, #rrggbb, null = automatic). The automatic color is computed in the frontend from the user id (same 12-color palette as the picker), never stored.
**Why:** the user asked for "un colore scelto per ogni utente" shown in utenti list, pratiche (gestita da), log and sidebar avatar.
**How to apply:** API returns raw `colore` (nullable); frontend uses `coloreUtente()` from `components/utenti/colore-utente.tsx`. Collaboratori get no color. Colors are edited only in the Utenti page, so an admin cannot change their own (admins only manage operatori).
