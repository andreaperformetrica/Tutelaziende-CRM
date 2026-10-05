---
name: Tutela CRM phase 1 permission decisions
description: Permission and capogruppo rules chosen in phase 1 that later phases must stay consistent with
---

- Super admin manages all internal users; admin manages only Operatori; nobody can deactivate themselves or change their own role.
- Admin and super admin create/edit collaboratori; operatore has read-only access to collaboratori; log page is admin and super admin only.
- A collaboratore sees only itself plus group members if capogruppo (server-side check on GET /collaboratori and /{id}).
- Capogruppo is one level: no self, a capogruppo cannot have a capogruppo, a collaboratore with members cannot join a group, new capogruppo must be active.
- A collaboratore's login email equals persona.email; edits update both.

**Why:** chosen by the agent in phase 1 (not specified by the user); user to confirm during verification.
**How to apply:** reuse the same rules when adding assistiti/pratiche visibility (group-level access for capogruppo).
