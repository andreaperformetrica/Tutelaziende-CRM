import { boolean, date, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { collaboratoriTable } from "./collaboratori";
import { utentiTable } from "./utenti";

export interface DomandaQuestionario {
  testo: string;
  tipo: "scelta" | "aperta";
  /** Solo per "scelta": le caselle da spuntare. */
  opzioni: string[];
  /** Solo per "aperta": quante righe lasciare per scrivere. */
  righe: number;
}

/**
 * Evento o corso di formazione. Data e orari sono quelli del calendario italiano (Europe/Rome).
 * I file (questionario e layout dell'attestato) stanno nello storage: qui solo la chiave.
 */
export const eventiTable = pgTable("eventi", {
  id: serial("id").primaryKey(),
  titolo: text("titolo").notNull(),
  data: date("data", { mode: "string" }).notNull(),
  oraInizio: text("ora_inizio").notNull(),
  oraFine: text("ora_fine"),
  luogo: text("luogo").notNull(),
  descrizione: text("descrizione").notNull().default(""),
  /** Tipo di corso ("CAF" o "PATRONATO") e argomento trattato: si scrivono sull'attestato. Vuoti solo per gli eventi creati prima. */
  tipoCorso: text("tipo_corso"),
  argomento: text("argomento"),
  questionarioChiave: text("questionario_chiave"),
  questionarioNome: text("questionario_nome"),
  questionarioTipo: text("questionario_tipo"),
  questionarioDimensione: integer("questionario_dimensione"),
  questionarioCaricatoIl: timestamp("questionario_caricato_il", { withTimezone: true }),
  /** Domande del questionario creato nel sistema (il PDF generato sta nei campi questionario*); null se il questionario e' un file caricato. */
  questionarioDomande: jsonb("questionario_domande").$type<DomandaQuestionario[]>(),
  /** Ore minime di presenza (da entrata a uscita) per avere l'attestato. Modificabile per ogni corso. */
  oreMinimeAttestato: real("ore_minime_attestato").notNull().default(3),
  layoutChiave: text("layout_chiave"),
  layoutNome: text("layout_nome"),
  layoutTipo: text("layout_tipo"),
  layoutDimensione: integer("layout_dimensione"),
  /** Posizione del nome sull'attestato: centro del nome in percentuale da sinistra e dall'alto, e dimensione in punti. */
  nomeX: real("nome_x").notNull().default(50),
  nomeY: real("nome_y").notNull().default(50),
  nomeDimensione: integer("nome_dimensione").notNull().default(32),
  creatoDaUtenteId: integer("creato_da_utente_id").references(() => utentiTable.id, { onDelete: "set null" }),
  creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  modificatoIl: timestamp("modificato_il", { withTimezone: true }).notNull().defaultNow(),
});

/** Invito di una sede (collaboratore) a un evento, con l'eventuale conferma di partecipazione. */
export const eventiInvitiTable = pgTable(
  "eventi_inviti",
  {
    id: serial("id").primaryKey(),
    eventoId: integer("evento_id")
      .notNull()
      .references(() => eventiTable.id, { onDelete: "cascade" }),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    invitatoIl: timestamp("invitato_il", { withTimezone: true }).notNull().defaultNow(),
    confermatoIl: timestamp("confermato_il", { withTimezone: true }),
    confermatoDaUtenteId: integer("confermato_da_utente_id").references(() => utentiTable.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("eventi_inviti_uq").on(t.eventoId, t.collaboratoreId), index("eventi_inviti_collaboratore_idx").on(t.collaboratoreId)],
);

/** Partecipante inserito dalla sede. `codiceQr` e' il contenuto del QR personale (casuale, non indovinabile). */
export const eventiPartecipantiTable = pgTable(
  "eventi_partecipanti",
  {
    id: serial("id").primaryKey(),
    eventoId: integer("evento_id")
      .notNull()
      .references(() => eventiTable.id, { onDelete: "cascade" }),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    nome: text("nome").notNull(),
    cognome: text("cognome").notNull(),
    codiceQr: text("codice_qr").notNull(),
    /** Indirizzo a cui arrivano QR code, documenti e questionario. Vuoto solo per i partecipanti inseriti prima. */
    email: text("email"),
    entrataIl: timestamp("entrata_il", { withTimezone: true }),
    uscitaIl: timestamp("uscita_il", { withTimezone: true }),
    creatoDaUtenteId: integer("creato_da_utente_id").references(() => utentiTable.id, { onDelete: "set null" }),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("eventi_partecipanti_codice_uq").on(t.codiceQr), index("eventi_partecipanti_evento_idx").on(t.eventoId, t.collaboratoreId)],
);

export type EventoRow = typeof eventiTable.$inferSelect;
export type PartecipanteEventoRow = typeof eventiPartecipantiTable.$inferSelect;

/** Documento caricato dopo il corso (slide, dispense...): si invia per email a chi risulta presente. */
export const eventiDocumentiTable = pgTable(
  "eventi_documenti",
  {
    id: serial("id").primaryKey(),
    eventoId: integer("evento_id")
      .notNull()
      .references(() => eventiTable.id, { onDelete: "cascade" }),
    chiave: text("chiave").notNull(),
    nome: text("nome").notNull(),
    tipo: text("tipo").notNull(),
    dimensione: integer("dimensione").notNull(),
    caricatoDaUtenteId: integer("caricato_da_utente_id").references(() => utentiTable.id, { onDelete: "set null" }),
    caricatoIl: timestamp("caricato_il", { withTimezone: true }).notNull().defaultNow(),
    /** Ultimo invio ai presenti e a quanti partecipanti e' stato inviato. */
    inviatoIl: timestamp("inviato_il", { withTimezone: true }),
    inviatoA: integer("inviato_a"),
  },
  (t) => [index("eventi_documenti_evento_idx").on(t.eventoId)],
);

export interface DomandaQuiz {
  testo: string;
  opzioni: string[];
  /** Posizione (da 0) della risposta esatta. */
  corretta: number;
}

/** Questionario online di verifica: domande a scelta multipla con una risposta esatta. Una riga per evento. */
export const eventiQuizTable = pgTable("eventi_quiz", {
  id: serial("id").primaryKey(),
  eventoId: integer("evento_id")
    .notNull()
    .references(() => eventiTable.id, { onDelete: "cascade" })
    .unique(),
  domande: jsonb("domande").$type<DomandaQuiz[]>().notNull(),
  /** Punteggio minimo per passare: ogni risposta esatta vale un punto. */
  punteggioMinimo: integer("punteggio_minimo").notNull(),
  creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  modificatoIl: timestamp("modificato_il", { withTimezone: true }).notNull().defaultNow(),
});

/** Link personale al questionario di un partecipante. Si compila una sola volta. */
export const eventiQuizInvitiTable = pgTable(
  "eventi_quiz_inviti",
  {
    id: serial("id").primaryKey(),
    eventoId: integer("evento_id")
      .notNull()
      .references(() => eventiTable.id, { onDelete: "cascade" }),
    partecipanteId: integer("partecipante_id")
      .notNull()
      .references(() => eventiPartecipantiTable.id, { onDelete: "cascade" })
      .unique(),
    token: text("token").notNull(),
    inviatoIl: timestamp("inviato_il", { withTimezone: true }).notNull().defaultNow(),
    compilatoIl: timestamp("compilato_il", { withTimezone: true }),
    punteggio: integer("punteggio"),
    punteggioMassimo: integer("punteggio_massimo"),
    superato: boolean("superato"),
    /** Risposta scelta per ogni domanda (posizione), nell'ordine delle domande al momento della compilazione. */
    risposte: jsonb("risposte").$type<number[]>(),
  },
  (t) => [uniqueIndex("eventi_quiz_inviti_token_uq").on(t.token), index("eventi_quiz_inviti_evento_idx").on(t.eventoId)],
);

export type EventoDocumentoRow = typeof eventiDocumentiTable.$inferSelect;
export type EventoQuizRow = typeof eventiQuizTable.$inferSelect;
export type EventoQuizInvitoRow = typeof eventiQuizInvitiTable.$inferSelect;
