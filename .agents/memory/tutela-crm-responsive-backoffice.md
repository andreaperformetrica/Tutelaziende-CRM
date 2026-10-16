---
name: Back-office responsive pattern
description: How the admin area adapts to phones (drawer menu, tables as cards)
---
- Back-office on < md: top bar + hamburger drawer (Sheet) instead of the fixed sidebar; desktop sidebar unchanged.
- Tables become cards on phones by adding `className="tabella-schede"` to `<Table>` and `data-label="..."` on each `<TableCell>` (CSS in index.css); first cell is the card title (no label). Sorting headers are hidden on phones.
- Tables not yet converted (mandati, estratto-dettaglio, dare-avere, importazioni) just scroll horizontally.
**Why:** user asked for the back-office to be usable on mobile.
**How to apply:** new list tables in the back-office should use the same pattern.
