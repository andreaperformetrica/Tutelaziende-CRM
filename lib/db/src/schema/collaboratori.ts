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
  tipologia: text("tipologia", { enum: ["CAF", "PATRONATO", "ENTRAMBI"] }).notNull(),
  /** Capogruppo del gruppo a cui appartiene (un solo livello). */
  capogruppoId: integer("capogruppo_id").references((): AnyPgColumn => collaboratoriTable.id),
  /** Segnato come capogruppo anche prima di avere collaboratori nel gruppo. */
  eCapogruppo: boolean("e_capogruppo").notNull().default(false),
  /** Dati della sede (tutti facoltativi: i collaboratori inseriti prima non li hanno). */
  denominazione: text("denominazione"),
  ragioneSociale: text("ragione_sociale"),
  tipoSoggetto: text("tipo_soggetto", { enum: ["PARTITA_IVA", "ASSOCIAZIONE"] }),
  sedeIndirizzo: text("sede_indirizzo"),
  sedeComuneCodice: text("sede_comune_codice"),
  sedeComune: text("sede_comune"),
  sedeProvincia: text("sede_provincia"),
  sedeCap: text("sede_cap"),
  iban: text("iban"),
  banca: text("banca"),
  filiale: text("filiale"),
  codiceFiscaleAssociazione: text("codice_fiscale_associazione"),
  creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
});

export type CollaboratoreRow = typeof collaboratoriTable.$inferSelect;
