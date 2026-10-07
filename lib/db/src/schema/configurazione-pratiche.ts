import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { collaboratoriTable } from "./collaboratori";
import { utentiTable } from "./utenti";

/** Tipo di pratica (es. Assegno familiare). Gli importi sono in centesimi per evitare errori di arrotondamento. */
export const tipiPraticaTable = pgTable(
  "tipi_pratica",
  {
    id: serial("id").primaryKey(),
    nome: text("nome").notNull(),
    attivo: boolean("attivo").notNull().default(true),
    pagabile: boolean("pagabile").notNull().default(false),
    /** Punti e valore valgono solo per i tipi pagabili: per gli altri sono sempre 0. */
    punti: integer("punti").notNull().default(0),
    valoreCentesimi: integer("valore_centesimi").notNull().default(0),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    modificatoIl: timestamp("modificato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tipi_pratica_nome_uq").on(sql`lower(${t.nome})`)],
);

/** Documento obbligatorio di un tipo di pratica. Se `mandato` e' true e' il mandato del collaboratore (sede). */
export const documentiTipoTable = pgTable(
  "documenti_tipo",
  {
    id: serial("id").primaryKey(),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    mandato: boolean("mandato").notNull().default(false),
    ordine: integer("ordine").notNull().default(0),
  },
  (t) => [uniqueIndex("documenti_tipo_nome_uq").on(t.tipoPraticaId, sql`lower(${t.nome})`)],
);

/** Modulo da compilare che il collaboratore puo scaricare. Il file e' nello storage: qui solo la chiave. */
export const moduliTipoTable = pgTable(
  "moduli_tipo",
  {
    id: serial("id").primaryKey(),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    fileChiave: text("file_chiave").notNull(),
    fileNome: text("file_nome").notNull(),
    fileTipo: text("file_tipo").notNull(),
    fileDimensione: integer("file_dimensione").notNull(),
    caricatoIl: timestamp("caricato_il", { withTimezone: true }).notNull().defaultNow(),
    caricatoDaUtenteId: integer("caricato_da_utente_id").references(() => utentiTable.id),
  },
  (t) => [index("moduli_tipo_tipo_idx").on(t.tipoPraticaId)],
);

/** Mandato: documento caricato dall'admin per ogni coppia (collaboratore, tipo di pratica). */
export const mandatiTable = pgTable(
  "mandati",
  {
    id: serial("id").primaryKey(),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
    fileChiave: text("file_chiave").notNull(),
    fileNome: text("file_nome").notNull(),
    fileTipo: text("file_tipo").notNull(),
    fileDimensione: integer("file_dimensione").notNull(),
    caricatoIl: timestamp("caricato_il", { withTimezone: true }).notNull().defaultNow(),
    caricatoDaUtenteId: integer("caricato_da_utente_id").references(() => utentiTable.id),
  },
  (t) => [uniqueIndex("mandati_collaboratore_tipo_uq").on(t.collaboratoreId, t.tipoPraticaId)],
);

/** Stato di una pratica: creato, rinominato e ordinato dall'admin. `chiuso` indica se conta come chiusa. */
export const statiPraticaTable = pgTable(
  "stati_pratica",
  {
    id: serial("id").primaryKey(),
    nome: text("nome").notNull(),
    ordine: integer("ordine").notNull().default(0),
    chiuso: boolean("chiuso").notNull().default(false),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stati_pratica_nome_uq").on(sql`lower(${t.nome})`)],
);

/**
 * Fascia settimanale in cui NON si possono inviare pratiche. Giorni ISO (1 = lunedi, 7 = domenica),
 * orari in minuti dalla mezzanotte (fuso Europe/Rome). Se la fine precede l'inizio la fascia attraversa
 * il fine settimana (es. venerdi 18:00 - lunedi 09:00). L'inizio e' incluso, la fine e' esclusa.
 */
export const finestreBloccoTable = pgTable("finestre_blocco", {
  id: serial("id").primaryKey(),
  giornoInizio: integer("giorno_inizio").notNull(),
  minutoInizio: integer("minuto_inizio").notNull(),
  giornoFine: integer("giorno_fine").notNull(),
  minutoFine: integer("minuto_fine").notNull(),
  attiva: boolean("attiva").notNull().default(true),
});

/** Impostazioni di sistema chiave/valore (es. marcatore della configurazione iniziale). */
export const impostazioniTable = pgTable("impostazioni", {
  chiave: text("chiave").primaryKey(),
  valore: text("valore").notNull(),
});
