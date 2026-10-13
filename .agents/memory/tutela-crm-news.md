---
name: News nella home collaboratore
description: Who manages the news shown on the collaboratore home and how visibility works
---
News (titolo, testo, pubblicata, inEvidenza) are written in the back office page "News" by super admin, admin and operatore (all three can create, edit and delete); collaboratori only read published ones, featured first. Plain text with line breaks, no images or links, no scheduled publish date.
**Why:** the user asked for a news section on the collaboratore home "updated from the admin or operator backend"; the choices on fields and permissions were made by the agent, not confirmed.
**How to apply:** if the user asks for images, attachments, scheduling or per-group targeting, extend the `news` table; production needs the new table via Publish.
