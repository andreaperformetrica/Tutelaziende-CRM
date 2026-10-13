---
name: Mandati per sede
description: Mandato is a Word template per sede, assigned one per collaboratore, downloaded as compiled PDF inside the pratica
---
- Mandato = .docx template per sede (fields like @cliente.cognome, @richiesta.tipo, @polizza.tipo), NOT per tipo di pratica. Admin assigns one mandato per collaboratore; it is valid for every tipo.
- Download is inside the pratica (collaboratore and back-office): fields are filled and the docx is converted to PDF with LibreOffice on demand (no cache; system dependency, also needed in production).
- Upload rejects non-docx and unknown @cliente/@richiesta/@polizza fields with a 400 listing them. Matching is per paragraph; a known field may be followed by text with no space (e.g. @cliente.cognomePunto).
- No CAP, civico or residence provincia are stored: cap/provincia fields stay empty, civico is split heuristically from the indirizzo, polizza.tipo is empty, richiesta.tipo = tipo pratica name.
**Why:** the user's screenshot of the template and their answers (one mandato per collaboratore, compiled PDF in the pratica).
**How to apply:** the "e il mandato" flag on required documents still means satisfied by the assigned mandato; mandatoId is frozen at send. First conversion is slow (~15 s, LibreOffice profile init), later ~2 s.
