---
name: Colori degli stati pratica
description: How stato colors work (optional chosen color + frontend automatic fallback) and where they are shown
---
`stati_pratica.colore` is nullable (#rrggbb). Null = automatic color computed in the frontend by `coloreStato()` (recognises the default stati by name, otherwise palette by id, green if chiuso). Admin picks it in Stati pratica via the dot popover.
**Why:** the user asked for colored stato labels and a per-stato summary strip; stati are admin-editable so colors must be too, without seeding data.
**How to apply:** new places showing a stato should use `StatoBadge`; API returns the raw `colore` (and `statoId/statoColore` on pratiche). Production needs the new column via Publish; no deploy-time DDL.
