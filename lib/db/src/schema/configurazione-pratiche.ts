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
    /** Scadenza in giorni dall'invio della pratica; vuoto = nessuna scadenza (e nessun avviso). */
    scadenzaGiorni: integer("scadenza_giorni"),
    /** Giorni di anticipo, prima della scadenza, da cui parte l'avviso e il sollecito all'operatore. */
    anticipoGiorni: integer("anticipo_giorni").notNull().default(2),
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
    /** Se vero, quando il collaboratore lo scarica dalla pratica viene compilato con i dati dell'assistito (.docx o .pdf). */
    compilazioneAutomatica: boolean("compilazione_automatica").notNull().default(false),
    caricatoIl: timestamp("caricato_il", { withTimezone: true }).notNull().defaultNow(),
    caricatoDaUtenteId: integer("caricato_da_utente_id").references(() => utentiTable.id),
  },
  (t) => [index("moduli_tipo_tipo_idx").on(t.tipoPraticaId)],
);

/**
 * Mandato: modello Word con campi da compilare. Quelli caricati per provincia hanno `provincia` (sigla) e, se valgono
 * per un solo tipo di pratica, `tipoPraticaId` (vuoto = tutti i tipi di quella provincia). I mandati senza provincia sono
 * quelli caricati prima (per sede): restano disponibili, assegnati ai collaboratori con `assegnazioni_mandato`, finche'
 * l'amministratore non li collega a una provincia.
 */
export const mandatiTable = pgTable(
  "mandati",
  {
  id: serial("id").primaryKey(),
  provincia: text("provincia"),
  tipoPraticaId: integer("tipo_pratica_id").references(() => tipiPraticaTable.id),
  nome: text("nome").notNull(),
  fileChiave: text("file_chiave").notNull(),
  fileNome: text("file_nome").notNull(),
  fileTipo: text("file_tipo").notNull(),
  fileDimensione: integer("file_dimensione").notNull(),
  caricatoIl: timestamp("caricato_il", { withTimezone: true }).notNull().defaultNow(),
  caricatoDaUtenteId: integer("caricato_da_utente_id").references(() => utentiTable.id),
  },
  (t) => [
    uniqueIndex("mandati_provincia_tipo_uq")
      .on(t.provincia, sql`coalesce(${t.tipoPraticaId}, 0)`)
      .where(sql`${t.provincia} is not null`),
  ],
);

/** Assegnazione per collaboratore del sistema precedente: oggi usata solo come ripiego per chi non ha ancora la provincia della sede. */
export const assegnazioniMandatoTable = pgTable(
  "assegnazioni_mandato",
  {
    id: serial("id").primaryKey(),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    mandatoId: integer("mandato_id")
      .notNull()
      .references(() => mandatiTable.id, { onDelete: "restrict" }),
    assegnatoIl: timestamp("assegnato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assegnazioni_mandato_collaboratore_uq").on(t.collaboratoreId), index("assegnazioni_mandato_mandato_idx").on(t.mandatoId)],
);

/** Stato di una pratica: creato, rinominato e ordinato dall'admin. `chiuso` indica se conta come chiusa. */
export const statiPraticaTable = pgTable(
  "stati_pratica",
  {
    id: serial("id").primaryKey(),
    nome: text("nome").notNull(),
    ordine: integer("ordine").notNull().default(0),
    chiuso: boolean("chiuso").notNull().default(false),
    /** Colore dell'etichetta (#rrggbb); null = colore automatico scelto dal frontend. */
    colore: text("colore"),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stati_pratica_nome_uq").on(sql`lower(${t.nome})`)],
);

/** Catalogo dei documenti noti: elenco da cui l'admin sceglie i documenti obbligatori e gli allegati dell'operatore. */
export const documentiNotiTable = pgTable(
  "documenti_noti",
  {
    id: serial("id").primaryKey(),
    nome: text("nome").notNull(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("documenti_noti_nome_uq").on(sql`lower(${t.nome})`)],
);

/** Documento che l'operatore puo' allegare alla pratica durante la lavorazione (non obbligatorio). */
export const allegatiTipoTable = pgTable(
  "allegati_tipo",
  {
    id: serial("id").primaryKey(),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    ordine: integer("ordine").notNull().default(0),
  },
  (t) => [uniqueIndex("allegati_tipo_nome_uq").on(t.tipoPraticaId, sql`lower(${t.nome})`)],
);

/** Link alle normative mostrati al collaboratore in fondo alla pratica. */
export const normativeTipoTable = pgTable(
  "normative_tipo",
  {
    id: serial("id").primaryKey(),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
    titolo: text("titolo").notNull(),
    url: text("url").notNull(),
    ordine: integer("ordine").notNull().default(0),
  },
  (t) => [index("normative_tipo_tipo_idx").on(t.tipoPraticaId)],
);

/** Eccezione ai compensi di default del tipo per un collaboratore: vince sul default. Importi in centesimi. */
export const compensiCollaboratoreTable = pgTable(
  "compensi_collaboratore",
  {
    id: serial("id").primaryKey(),
    tipoPraticaId: integer("tipo_pratica_id")
      .notNull()
      .references(() => tipiPraticaTable.id, { onDelete: "cascade" }),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    pagabile: boolean("pagabile").notNull().default(false),
    punti: integer("punti").notNull().default(0),
    valoreCentesimi: integer("valore_centesimi").notNull().default(0),
  },
  (t) => [uniqueIndex("compensi_collaboratore_uq").on(t.tipoPraticaId, t.collaboratoreId)],
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
