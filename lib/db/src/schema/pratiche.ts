import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assistitiTable } from "./assistiti";
import { collaboratoriTable } from "./collaboratori";
import { documentiTipoTable, mandatiTable, statiPraticaTable, tipiPraticaTable } from "./configurazione-pratiche";
import { utentiTable } from "./utenti";

/**
 * Pratica aperta da un collaboratore per un proprio assistito.
 * Finche' `inviataIl` e' vuoto e' una bozza (senza numero e senza stato); all'invio riceve numero progressivo e stato.
 */
export const praticheTable = pgTable(
  "pratiche",
  {
    id: serial("id").primaryKey(),
    /** Numero progressivo assegnato all'invio, senza buchi. */
    numero: integer("numero"),
    assistitoId: integer("assistito_id")
      .notNull()
      .references(() => assistitiTable.id),
    /** Collaboratore che ha aperto la pratica (non cambia se l'assistito viene riassegnato). */
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id),
    statoId: integer("stato_id").references(() => statiPraticaTable.id, { onDelete: "restrict" }),
    /** Mandato usato, fissato all'invio. */
    mandatoId: integer("mandato_id").references(() => mandatiTable.id, { onDelete: "restrict" }),
    /** Messaggio scritto durante la bozza; all'invio diventa il primo commento. */
    messaggio: text("messaggio").notNull().default(""),
    gestitaDaUtenteId: integer("gestita_da_utente_id").references(() => utentiTable.id),
    creataDaUtenteId: integer("creata_da_utente_id").references(() => utentiTable.id),
    creataIl: timestamp("creata_il", { withTimezone: true }).notNull().defaultNow(),
    modificataIl: timestamp("modificata_il", { withTimezone: true }).notNull().defaultNow(),
    inviataIl: timestamp("inviata_il", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("pratiche_numero_uq").on(t.numero),
    index("pratiche_collaboratore_idx").on(t.collaboratoreId),
    index("pratiche_assistito_idx").on(t.assistitoId),
    index("pratiche_stato_idx").on(t.statoId),
  ],
);

/** Documento caricato in una pratica: uno per ogni documento obbligatorio, piu' eventuali allegati aggiuntivi. */
export const documentiPraticaTable = pgTable(
  "documenti_pratica",
  {
    id: serial("id").primaryKey(),
    praticaId: integer("pratica_id")
      .notNull()
      .references(() => praticheTable.id, { onDelete: "cascade" }),
    /** Vuoto per gli allegati aggiuntivi (o se il documento obbligatorio e' stato tolto dal tipo). */
    documentoTipoId: integer("documento_tipo_id").references(() => documentiTipoTable.id, { onDelete: "set null" }),
    nome: text("nome").notNull(),
    fileChiave: text("file_chiave").notNull(),
    fileNome: text("file_nome").notNull(),
    fileTipo: text("file_tipo").notNull(),
    fileDimensione: integer("file_dimensione").notNull(),
    caricatoIl: timestamp("caricato_il", { withTimezone: true }).notNull().defaultNow(),
    caricatoDaUtenteId: integer("caricato_da_utente_id").references(() => utentiTable.id),
    /** Vero se caricato dopo l'invio della pratica. */
    dopoInvio: boolean("dopo_invio").notNull().default(false),
  },
  (t) => [
    index("documenti_pratica_pratica_idx").on(t.praticaId),
    uniqueIndex("documenti_pratica_richiesto_uq").on(t.praticaId, t.documentoTipoId).where(sql`${t.documentoTipoId} is not null`),
  ],
);

/** Chat della pratica tra collaboratore e back office (nessun commento interno). */
export const commentiPraticaTable = pgTable(
  "commenti_pratica",
  {
    id: serial("id").primaryKey(),
    praticaId: integer("pratica_id")
      .notNull()
      .references(() => praticheTable.id, { onDelete: "cascade" }),
    utenteId: integer("utente_id")
      .notNull()
      .references(() => utentiTable.id),
    testo: text("testo").notNull(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("commenti_pratica_pratica_idx").on(t.praticaId)],
);
