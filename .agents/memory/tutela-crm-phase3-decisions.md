---
name: Phase 3 pratiche configuration decisions
description: Choices made for tipi pratica, mandati, stati, orari di caricamento and file storage; what phase 4 must hook into
---
- Config endpoints are admin and super_admin only. Operatore and collaboratore get 403. Only the modulo file download is open to any logged-in user (collaboratori will download forms). Mandato download is admin only for now.
- Files go through lib/storage.ts (GCS via the Replit sidecar, keys under PRIVATE_OBJECT_DIR). Uploads are raw-body requests (15 MB, extension whitelist, PDFs must start with %PDF-) handled outside the OpenAPI spec; the frontend uses a plain fetch (lib/upload.ts). The skill template storage routes use Replit Auth and are not used.
- Not pagabile means punti and valore are forced to 0 server-side. Money is stored in cents.
- A required document flagged "mandato" means it is satisfied by the collaboratore's mandato for that tipo. Mandati can be replaced per (collaboratore, tipo) but not deleted.
- Orari are weekly recurring BLOCK windows [start, end), Rome time, may wrap the week. Phase 4 must call statoInvioPratiche() (lib/orari.ts) before accepting a pratica submission; login stays allowed.
- Default stati and the default window are inserted once, guarded by a marker row in impostazioni, so admin deletions are not resurrected. Chiuso by default: Chiusa positivamente, Da pagare, Pagata.
- Stati can be deleted now; phase 4 must block deleting a stato used by a pratica. Tipi are deactivated (attivo), never deleted.

**Why:** keeps config stable and auditable; phase 4 depends on these hooks.
**How to apply:** when building pratiche, reuse statoInvioPratiche, the stati list, mandati and storage module rather than new mechanisms.
