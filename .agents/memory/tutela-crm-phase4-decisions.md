---
name: Phase 4 apertura pratica decisions
description: Rules chosen for pratiche opened by collaboratori (ownership, mandato, stato iniziale, locks after send)
---
- Only the owning collaboratore creates/edits/sends/attaches/comments; the capogruppo sees the group's pratiche read-only (404 if not visible, 403 on writes if visible but not own). Capogruppo opens pratiche only for own assistiti.
- The mandato is not an upload slot: it is satisfied by the collaboratore's `assegnazioni_mandato` for that tipo; sending is blocked when the tipo has a mandato-flagged doc and none is assigned. mandatoId is frozen at send. [SUPERSEDED: mandati are now per sede, one per collaboratore, not per tipo - see tutela-crm-mandati-per-sede.md]
- Initial stato on send = first stato by ordine whose name is not "Bozza"; bozza has no statoId (shown as "Bozza").
- Orari check on send is server-side and runs before the completeness check (code INVIO_FUORI_ORARIO).
- Progressive numero assigned under pg_advisory_xact_lock(4001); first comment = bozza message at send.
- After send: no delete, no replace/delete of documents; only extra attachments (max 30) and comments. Files: PDF/PNG/JPG only, 15 MB.
- Deleting a stato in use -> 409; deleting a mandato assigned/used -> 409.
**Why:** choices made by the agent where the brief was silent; keep consistent in phase 5 (backoffice handling of pratiche).
**How to apply:** backoffice phases must reuse lib/pratiche.ts and keep these locks.
