---
name: Aggiornamento 2 - configurazione tipi di pratica
description: documenti noti, moduli auto-compilati, eccezioni compenso per collaboratore, normative, allegati operatore per tipo; removal of categorie allegato
---
- Admin tipo-pratica page now has: documents picked from a known-documents dropdown (create-on-the-fly), per-modulo "compila in automatico", compensi exceptions per collaboratore, normative links, operator attachment list (+ always "Altro").
- Known documents = catalog table unioned at read time with names already in documenti_tipo/allegati_tipo (case-insensitive), so no data migration in production.
- Compenso exception (pagabile/punti/euro) per tipo+collaboratore WINS over tipo default, including when tipo is non-pagabile; snapshot taken at chiusura. Resoconto includes pratica if tipo pagabile OR a pagabile exception exists.
- Auto-fill works only for .docx (@cliente.* placeholders) and PDF with AcroForm text fields named like the fields (with or without "cliente." prefix); output always PDF; flag refused otherwise.
- categorie_allegato table and documento categoria column were REMOVED (replaced by per-tipo allegati list); no "categorie di pratica" ever existed. Production loses them via Publish schema sync.
- Operator upload: either allegatoTipoId of the pratica's tipo or free name (Altro).
**Why:** user request "Aggiornamento 2" (tipi di pratica config only; do not touch other areas).
**How to apply:** supersedes categorie-allegato parts of earlier phase notes.
