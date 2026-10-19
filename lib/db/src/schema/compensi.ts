import { date, index, integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { collaboratoriTable } from "./collaboratori";
import { praticheTable } from "./pratiche";
import { utentiTable } from "./utenti";

export const METODI_PAGAMENTO = ["bonifico", "contanti", "assegno", "altro"] as const;
export const SEZIONI_DARE_AVERE = ["naspi", "pensionati", "patronato", "caf", "crediti", "debiti"] as const;

/**
 * Estratto delle pratiche chiuse di un collaboratore. Gli importi sono in centesimi. Le righe sono una copia
 * dei dati al momento della creazione, cosi' lo stampato non cambia se poi cambiano assistito o tipo di pratica.
 */
export const estrattiTable = pgTable(
  "estratti",
  {
    id: serial("id").primaryKey(),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    /** Data dello stampato (giorno di creazione, fuso Europe/Rome). */
    dataEstratto: date("data_estratto", { mode: "string" }).notNull(),
    totalePunti: integer("totale_punti").notNull(),
    totaleCentesimi: integer("totale_centesimi").notNull(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    creatoDaUtenteId: integer("creato_da_utente_id").references(() => utentiTable.id),
    /** Pagamento: tutti vuoti finche' l'estratto non e' pagato. */
    pagatoIl: date("pagato_il", { mode: "string" }),
    pagamentoCentesimi: integer("pagamento_centesimi"),
    pagamentoMetodo: text("pagamento_metodo", { enum: METODI_PAGAMENTO }),
    pagamentoRegistratoIl: timestamp("pagamento_registrato_il", { withTimezone: true }),
    pagamentoUtenteId: integer("pagamento_utente_id").references(() => utentiTable.id),
    /** Documento allegato al pagamento (esempio: contabile del bonifico). */
    allegatoChiave: text("allegato_chiave"),
    allegatoNome: text("allegato_nome"),
    allegatoTipo: text("allegato_tipo"),
    allegatoDimensione: integer("allegato_dimensione"),
    allegatoCaricatoIl: timestamp("allegato_caricato_il", { withTimezone: true }),
  },
  (t) => [index("estratti_collaboratore_idx").on(t.collaboratoreId)],
);

/**
 * Pratica lasciata fuori da un estratto al momento della creazione, con il motivo. La pratica resta disponibile nel
 * resoconto per un estratto futuro: qui rimane solo la traccia dell'esclusione.
 */
export const estrattiEsclusioniTable = pgTable(
  "estratti_esclusioni",
  {
    id: serial("id").primaryKey(),
    estrattoId: integer("estratto_id")
      .notNull()
      .references(() => estrattiTable.id, { onDelete: "cascade" }),
    praticaId: integer("pratica_id")
      .notNull()
      .references(() => praticheTable.id, { onDelete: "cascade" }),
    numeroPratica: integer("numero_pratica").notNull(),
    assistito: text("assistito").notNull(),
    tipoPratica: text("tipo_pratica").notNull(),
    motivo: text("motivo").notNull(),
  },
  (t) => [index("estratti_esclusioni_estratto_idx").on(t.estrattoId)],
);

/** Pratica inclusa in un estratto. Una pratica puo' stare in un solo estratto (indice univoco). */
export const estrattiRigheTable = pgTable(
  "estratti_righe",
  {
    id: serial("id").primaryKey(),
    estrattoId: integer("estratto_id")
      .notNull()
      .references(() => estrattiTable.id, { onDelete: "cascade" }),
    praticaId: integer("pratica_id")
      .notNull()
      .references(() => praticheTable.id, { onDelete: "restrict" }),
    ordine: integer("ordine").notNull(),
    assistito: text("assistito").notNull(),
    numeroPratica: integer("numero_pratica").notNull(),
    tipoPratica: text("tipo_pratica").notNull(),
    dataPratica: date("data_pratica", { mode: "string" }),
    punti: integer("punti").notNull(),
    valoreCentesimi: integer("valore_centesimi").notNull(),
  },
  (t) => [uniqueIndex("estratti_righe_pratica_uq").on(t.praticaId), index("estratti_righe_estratto_idx").on(t.estrattoId)],
);

/** Riga inserita a mano nel dare/avere di un collaboratore (la sezione Patronato si alimenta dagli estratti, senza righe qui). */
export const compensiRigheTable = pgTable(
  "compensi_righe",
  {
    id: serial("id").primaryKey(),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    anno: integer("anno").notNull(),
    sezione: text("sezione", { enum: SEZIONI_DARE_AVERE }).notNull(),
    descrizione: text("descrizione").notNull(),
    importoCentesimi: integer("importo_centesimi").notNull(),
    dataPagamento: date("data_pagamento", { mode: "string" }),
    nota: text("nota").notNull().default(""),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    modificatoIl: timestamp("modificato_il", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("compensi_righe_coll_anno_idx").on(t.collaboratoreId, t.anno)],
);

export const SERVIZI_IMPORT = ["mod730", "isee", "naspi", "pensionati"] as const;
export const STATI_IMPORT = ["anteprima", "confermata"] as const;

/**
 * File Excel importato per un servizio (730, ISEE, NASPI, Pensionati). Resta in "anteprima" finche' l'admin non
 * conferma; l'indice univoco parziale impedisce di confermare due volte lo stesso file per lo stesso servizio.
 */
export const importazioniTable = pgTable(
  "importazioni",
  {
    id: serial("id").primaryKey(),
    servizio: text("servizio", { enum: SERVIZI_IMPORT }).notNull(),
    anno: integer("anno").notNull(),
    nomeFile: text("nome_file").notNull(),
    /** SHA-256 del contenuto del file. */
    hashFile: text("hash_file").notNull(),
    chiaveFile: text("chiave_file").notNull(),
    stato: text("stato", { enum: STATI_IMPORT }).notNull().default("anteprima"),
    /** Regola e colonne usate alla conferma (JSON), cosi' resta tracciabile anche se poi cambiano. */
    configurazione: text("configurazione"),
    righeLette: integer("righe_lette").notNull().default(0),
    righeImportate: integer("righe_importate").notNull().default(0),
    totaleCentesimi: integer("totale_centesimi").notNull().default(0),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    creatoDaUtenteId: integer("creato_da_utente_id").references(() => utentiTable.id),
    confermatoIl: timestamp("confermato_il", { withTimezone: true }),
    confermatoDaUtenteId: integer("confermato_da_utente_id").references(() => utentiTable.id),
  },
  (t) => [
    uniqueIndex("importazioni_servizio_hash_uq").on(t.servizio, t.hashFile).where(sql`${t.stato} = 'confermata'`),
    index("importazioni_servizio_anno_idx").on(t.servizio, t.anno),
  ],
);

/** Riga valida di un'importazione confermata, abbinata a un collaboratore. */
export const importazioniRigheTable = pgTable(
  "importazioni_righe",
  {
    id: serial("id").primaryKey(),
    importazioneId: integer("importazione_id")
      .notNull()
      .references(() => importazioniTable.id, { onDelete: "cascade" }),
    numeroRiga: integer("numero_riga").notNull(),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    /** Valore della colonna chiave, come letto nel file. */
    riferimento: text("riferimento").notNull(),
    /** Importo di base (colonna importo), solo con la regola a percentuale. */
    baseCentesimi: integer("base_centesimi"),
    compensoCentesimi: integer("compenso_centesimi").notNull(),
  },
  (t) => [index("importazioni_righe_imp_idx").on(t.importazioneId), index("importazioni_righe_coll_idx").on(t.collaboratoreId)],
);

export const ORIGINI_RICEVUTA = ["riga", "estratto", "importazione"] as const;

/**
 * Ricevuta emessa a nome di un collaboratore, a partire da una riga del suo dare/avere. I dati stampati (denominazione,
 * indirizzo, banca, patronato, causale...) sono copiati in "dati" al momento della creazione, cosi' il PDF resta uguale
 * anche se poi cambiano le anagrafiche o le impostazioni. Importi in centesimi.
 */
export const ricevuteTable = pgTable(
  "ricevute",
  {
    id: serial("id").primaryKey(),
    anno: integer("anno").notNull(),
    /** Progressivo dentro l'anno. */
    numero: integer("numero").notNull(),
    dataRicevuta: date("data_ricevuta", { mode: "string" }).notNull(),
    collaboratoreId: integer("collaboratore_id")
      .notNull()
      .references(() => collaboratoriTable.id),
    /** Anno del dare/avere da cui nasce. */
    annoDareAvere: integer("anno_dare_avere").notNull(),
    origineTipo: text("origine_tipo", { enum: ORIGINI_RICEVUTA }).notNull(),
    origineId: integer("origine_id").notNull(),
    origineDescrizione: text("origine_descrizione").notNull(),
    imponibileCentesimi: integer("imponibile_centesimi").notNull(),
    aliquotaIva: real("aliquota_iva"),
    ivaCentesimi: integer("iva_centesimi").notNull().default(0),
    totaleCentesimi: integer("totale_centesimi").notNull(),
    /** Testi stampati, in JSON. */
    dati: text("dati").notNull(),
    creatoIl: timestamp("creato_il", { withTimezone: true }).notNull().defaultNow(),
    creatoDaUtenteId: integer("creato_da_utente_id").references(() => utentiTable.id),
    pagatoIl: date("pagato_il", { mode: "string" }),
    pagamentoMetodo: text("pagamento_metodo", { enum: METODI_PAGAMENTO }),
    pagamentoRegistratoIl: timestamp("pagamento_registrato_il", { withTimezone: true }),
    pagamentoUtenteId: integer("pagamento_utente_id").references(() => utentiTable.id),
    allegatoChiave: text("allegato_chiave"),
    allegatoNome: text("allegato_nome"),
    allegatoTipo: text("allegato_tipo"),
    allegatoDimensione: integer("allegato_dimensione"),
    allegatoCaricatoIl: timestamp("allegato_caricato_il", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ricevute_anno_numero_uq").on(t.anno, t.numero),
    uniqueIndex("ricevute_origine_uq").on(t.collaboratoreId, t.origineTipo, t.origineId),
    index("ricevute_collaboratore_idx").on(t.collaboratoreId),
    index("ricevute_data_idx").on(t.dataRicevuta),
  ],
);
