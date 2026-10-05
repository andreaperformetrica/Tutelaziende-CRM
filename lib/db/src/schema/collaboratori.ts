import { type AnyPgColumn, boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { personeTable } from "./persone";
import { utentiTable } from "./utenti";

export const collaboratoriTable = pgTable("collaboratori", {
  id: serial("id").primaryKey(),
  utenteId: integer("utente_id")
    .notNull()
    .unique()
    .references(() => utentiTable.id),
  personaId: integer("persona_id")
    .notNull()
    .unique()
    .references(() => personeTable.id),
  numeroSportello: text("numero_sportello").notNull().unique(),
  tipologia: text("tipologia", { enum: ["CAF", "PATRONATO"] }).notNull(),
  /** Capogruppo del gruppo a cui appartiene (un solo livello). */
  capogruppoId: integer("capogruppo_id").references((): AnyPgColumn => collaboratoriTable.id),
  creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
});

export type CollaboratoreRow = typeof collaboratoriTable.$inferSelect;
