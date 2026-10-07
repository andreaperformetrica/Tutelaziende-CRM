import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { collaboratoriTable } from "./collaboratori";
import { personeTable } from "./persone";
import { utentiTable } from "./utenti";

/**
 * Assistito: persona (anagrafica nella tabella condivisa `persone`) seguita da un collaboratore.
 * Codice fiscale e cellulare sono unici sull'intera piattaforma grazie ai vincoli di `persone`.
 */
export const assistitiTable = pgTable(
  "assistiti",
  {
    id: serial("id").primaryKey(),
    personaId: integer("persona_id")
      .notNull()
      .unique()
      .references(() => personeTable.id),
    /** Collaboratore a cui l'assistito e' associato; modificabile solo dal back office. */
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    citta: text("citta").notNull(),
    indirizzo: text("indirizzo"),
    creatoDaUtenteId: integer("creato_da_utente_id").references(() => utentiTable.id),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    modificatoIl: timestamp("modificato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assistiti_collaboratore_idx").on(t.collaboratoreId)],
);

export type AssistitoRow = typeof assistitiTable.$inferSelect;
