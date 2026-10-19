import { Readable } from "node:stream";
import { mandatoCompilatoPdf } from "../lib/mandato-compilato";
import { chiaveFirmaPratica, leggiPdfFirmato } from "../lib/firma-mandato";
import { NOME_STATO_PAGATA, aggiornaMaturazione, estrattoDellaPratica } from "../lib/compensi";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import express, { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  CambiaStatoPraticaBody,
  CambiaPrioritaPraticaBody,
  CambiaPrioritaPraticaParams,
  CambiaStatoPraticaParams,
  CreateCommentoPraticaBackofficeBody,
  CreateCommentoPraticaBackofficeParams,
  DeletePraticaBackofficeParams,
  GetPraticaBackofficeParams,
  ListPraticheBackofficeQueryParams,
  PrendiInCaricoPraticaParams,
} from "@workspace/api-zod";
import {
  assistitiTable,
  allegatiTipoTable,
  collaboratoriTable,
  commentiPraticaTable,
  db,
  documentiPraticaTable,
  eventiPraticaTable,
  personeTable,
  praticheTable,
  statiPraticaTable,
  tipiPraticaTable,
  utentiTable,
} from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { contaPerStatoBackoffice, contaPraticheBackoffice, mandatoDellaPratica, selezionaPratiche, MAX_MESSAGGIO } from "../lib/pratiche";
import {
  aggiornataSql,
  caricaPraticaInviata,
  dettaglioBackoffice,
  descrizionePraticaBo,
  ETICHETTA_CANALE,
  mappaRiepilogoBackoffice,
  NOME_STATO_BOZZA,
} from "../lib/pratiche-backoffice";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { notificaCommentoUfficio } from "../lib/notifiche-eventi";
import { recapitaInBackground } from "../lib/notifiche";
import { scadenzeInCarico } from "../lib/scadenze";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/backoffice/pratiche", richiediRuolo("super_admin", "admin", "operatore"));
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });

const PER_PAGINA_DEFAULT = 25;
const ETICHETTA_PRIORITA = { urgente: "Urgente", media: "Media", bassa: "Bassa" } as const;
const nomeCollaboratore = (c: { nome: string; cognome: string; denominazione?: string | null }) => `${c.nome} ${c.cognome}${c.denominazione ? ` (${c.denominazione})` : ""}`;

/** Mesi (AAAA-MM, fuso Roma) in cui c'e' almeno una pratica inviata, dal piu' recente: si cerca per intervalli, senza leggere tutta la tabella. */
async function mesiConPratiche(): Promise<string[]> {
  const r = await db.execute<{ mese: string }>(sql`
    select to_char(m, 'YYYY-MM') as mese
    from (
      select generate_series(
        date_trunc('month', min(inviata_il) at time zone 'Europe/Rome'),
        date_trunc('month', max(inviata_il) at time zone 'Europe/Rome'),
        interval '1 month') as m
      from pratiche where inviata_il is not null
    ) mesi
    where exists (
      select 1 from pratiche
      where inviata_il >= (m at time zone 'Europe/Rome')
        and inviata_il < ((m + interval '1 month') at time zone 'Europe/Rome'))
    order by m desc`);
  return r.rows.map((x) => x.mese);
}
const intero = (v: unknown, nome: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parametro "${nome}" non valido.`, "DATI_NON_VALIDI", nome);
  return n;
};

function controllaData(valore: string | undefined, campo: string): string | undefined {
  if (!valore) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore) || Number.isNaN(Date.parse(valore))) {
    throw new HttpError(400, "Data non valida (formato AAAA-MM-GG).", "DATA_NON_VALIDA", campo);
  }
  return valore;
}

// Filtri sulle date come intervalli sulla colonna `inviata_il` (fuso Europe/Rome): cosi' il database usa gli indici.
// Confrontare `(inviata_il at time zone ...)::date` obbligava invece a calcolare la data di ogni riga della tabella.
const dalRoma = (data: string) => sql`(${data}::date)::timestamp at time zone 'Europe/Rome'`;
const finoAlRoma = (data: string) => sql`((${data}::date) + 1)::timestamp at time zone 'Europe/Rome'`;

type ParametriElenco = ReturnType<typeof ListPraticheBackofficeQueryParams.parse>;

/** Filtri e ordinamento dell'elenco; li usano sia l'elenco a pagine sia l'esportazione in Excel. */
function filtriElenco(p: ParametriElenco) {
  const dal = controllaData(p.dal, "dal");
  const al = controllaData(p.al, "al");
  if (dal && al && dal > al) throw new HttpError(400, "La data iniziale è successiva a quella finale.", "DATA_NON_VALIDA", "dal");
  if (p.mese && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.mese)) throw new HttpError(400, "Mese non valido.", "DATI_NON_VALIDI", "mese");
  const inizioMese = p.mese ? `${p.mese}-01` : null;

  // Il riepilogo per stato rispetta tutti i filtri tranne lo stato, cosi' resta completo quando se ne sceglie uno.
  const senzaStato = and(
    isNotNull(praticheTable.inviataIl),
    p.collaboratoreId ? eq(praticheTable.collaboratoreId, p.collaboratoreId) : undefined,
    p.tipoPraticaId ? eq(praticheTable.tipoPraticaId, p.tipoPraticaId) : undefined,
    p.gestitaDaUtenteId ? eq(praticheTable.gestitaDaUtenteId, p.gestitaDaUtenteId) : undefined,
    p.nonAssegnate === true ? isNull(praticheTable.gestitaDaUtenteId) : undefined,
    p.soloLavorate === true ? isNotNull(praticheTable.gestitaDaUtenteId) : undefined,
    p.priorita ? eq(praticheTable.priorita, p.priorita) : undefined,
    inizioMese ? sql`${praticheTable.inviataIl} >= ${dalRoma(inizioMese)} and ${praticheTable.inviataIl} < ((${inizioMese}::date + interval '1 month')::timestamp at time zone 'Europe/Rome')` : undefined,
    dal ? sql`${praticheTable.inviataIl} >= ${dalRoma(dal)}` : undefined,
    al ? sql`${praticheTable.inviataIl} < ${finoAlRoma(al)}` : undefined,
    p.soloAggiornate === true ? aggiornataSql : undefined,
  );
  const where = and(senzaStato, p.statoId ? eq(praticheTable.statoId, p.statoId) : undefined);

  const ordina = p.ordina ?? "data";
  const direzione = p.direzione ?? (ordina === "data" || ordina === "numero" ? "desc" : "asc");
  const dir = direzione === "asc" ? asc : desc;
  const colonna: Record<typeof ordina, SQL> = {
    data: sql`${praticheTable.inviataIl}`,
    citta: sql`lower(${assistitiTable.citta})`,
    numero: sql`${praticheTable.numero}`,
    stato: sql`${statiPraticaTable.ordine}`,
    tipo: sql`lower(${tipiPraticaTable.nome})`,
    // In ordine crescente: urgente, media, bassa.
    priorita: sql`(case ${praticheTable.priorita} when 'urgente' then 0 when 'media' then 1 else 2 end)`,
  };
  const ordine: SQL[] = [
    ...(p.aggiornatePrima === true ? [desc(aggiornataSql)] : []),
    dir(colonna[ordina]),
    ...(ordina === "stato" ? [dir(statiPraticaTable.nome)] : []),
    desc(praticheTable.inviataIl),
    desc(praticheTable.id),
  ];
  return { senzaStato, where, ordine };
}

// ---------------------------------------------------------------------------------------------
// Elenco e filtri
// ---------------------------------------------------------------------------------------------

router.get("/backoffice/pratiche", async (req, res) => {
  const p = valida(ListPraticheBackofficeQueryParams, req.query);
  const { senzaStato, where, ordine } = filtriElenco(p);
  const pagina = p.pagina ?? 1;
  const perPagina = p.perPagina ?? PER_PAGINA_DEFAULT;

  const [totale, riepilogoStati, righe] = await Promise.all([
    contaPraticheBackoffice(where),
    contaPerStatoBackoffice(senzaStato),
    selezionaPratiche(where, ordine)
      .limit(perPagina)
      .offset((pagina - 1) * perPagina),
  ]);
  res.json({ elementi: righe.map(mappaRiepilogoBackoffice), totale, riepilogoStati, pagina, perPagina });
});

const MAX_RIGHE_EXCEL = 50000;

/** Istante come ora di Roma "scritta" in UTC: Excel non ha fusi orari, cosi' mostra la stessa ora che si vede nella piattaforma. */
function istanteRomaPerExcel(d: Date): Date {
  const parti = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return new Date(Date.UTC(Number(parti["year"]), Number(parti["month"]) - 1, Number(parti["day"]), Number(parti["hour"]), Number(parti["minute"])));
}

/** Excel dell'elenco con gli stessi filtri e lo stesso ordinamento applicati a video, tutte le colonne dell'elenco. */
router.get("/backoffice/pratiche/esporta", async (req, res) => {
  const p = valida(ListPraticheBackofficeQueryParams, req.query);
  const { where, ordine } = filtriElenco(p);
  const totale = await contaPraticheBackoffice(where);
  if (totale > MAX_RIGHE_EXCEL) {
    throw new HttpError(400, `Le pratiche trovate sono ${totale}: troppe per un solo file (massimo ${MAX_RIGHE_EXCEL}). Restringi i filtri e riprova.`, "TROPPE_RIGHE");
  }
  const righe = await selezionaPratiche(where, ordine);
  const wb = new ExcelJS.Workbook();
  const foglio = wb.addWorksheet("Pratiche");
  foglio.columns = [
    { header: "Assistito", key: "assistito", width: 30 },
    { header: "Numero", key: "numero", width: 10 },
    { header: "Collaboratore", key: "collaboratore", width: 30 },
    { header: "Città", key: "citta", width: 20 },
    { header: "Richiesta pratica", key: "richiesta", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Stato", key: "stato", width: 20 },
    { header: "Tipo", key: "tipo", width: 28 },
    { header: "Gestita da", key: "gestita", width: 26 },
    { header: "Priorità", key: "priorita", width: 12 },
    { header: "Scadenza", key: "scadenza", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Aggiornata", key: "aggiornata", width: 12 },
  ];
  foglio.getRow(1).font = { bold: true };
  foglio.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of righe) {
    const m = mappaRiepilogoBackoffice(r);
    foglio.addRow({
      assistito: `${m.assistito.cognome} ${m.assistito.nome}`,
      numero: m.numero,
      collaboratore: nomeCollaboratore(m.collaboratore),
      citta: m.citta,
      richiesta: istanteRomaPerExcel(new Date(m.dataRichiesta)),
      stato: m.stato.nome,
      tipo: m.tipo.nome,
      gestita: m.gestitaDa ? `${m.gestitaDa.cognome} ${m.gestitaDa.nome}` : "Non assegnata",
      priorita: ETICHETTA_PRIORITA[m.priorita],
      scadenza: m.scadenza ? istanteRomaPerExcel(new Date(m.scadenza.scadenzaIl)) : null,
      aggiornata: m.aggiornata ? "Sì" : "No",
    });
  }
  foglio.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await registraLog(db, contestoDa(req), {
    azione: "pratica.esporta",
    entita: "pratica",
    descrizione: `Esportazione in Excel dell'elenco pratiche (${righe.length} pratiche)`,
    dettagli: { righe: righe.length, filtri: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "pagina" && k !== "perPagina")) },
  });
  const oggi = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date()).replace(/\//g, "-");
  inviaFile(res, Readable.from(buffer), `Pratiche ${oggi}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer.length);
});

/** Pratiche in gestione all'utente con scadenza vicina o superata (per il popup). */
router.get("/backoffice/pratiche/scadenze", async (req, res) => {
  res.json(await scadenzeInCarico(req.utente!.id));
});

router.get("/backoffice/pratiche/filtri", async (_req, res) => {
  const [collaboratori, tipi, stati, operatori, mesi] = await Promise.all([
    db
      .select({ id: collaboratoriTable.id, nome: personeTable.nome, cognome: personeTable.cognome, numeroSportello: collaboratoriTable.numeroSportello })
      .from(collaboratoriTable)
      .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
      .orderBy(asc(personeTable.cognome), asc(personeTable.nome)),
    db.select({ id: tipiPraticaTable.id, nome: tipiPraticaTable.nome }).from(tipiPraticaTable).orderBy(asc(tipiPraticaTable.nome)),
    db
      .select({ id: statiPraticaTable.id, nome: statiPraticaTable.nome, chiuso: statiPraticaTable.chiuso })
      .from(statiPraticaTable)
      .where(sql`lower(trim(${statiPraticaTable.nome})) <> ${NOME_STATO_BOZZA}`)
      .orderBy(asc(statiPraticaTable.ordine), asc(statiPraticaTable.id)),
    db
      .select({ id: utentiTable.id, nome: utentiTable.nome, cognome: utentiTable.cognome, ruolo: utentiTable.ruolo, colore: utentiTable.colore })
      .from(utentiTable)
      .where(ne(utentiTable.ruolo, "collaboratore"))
      .orderBy(asc(utentiTable.cognome), asc(utentiTable.nome)),
    mesiConPratiche(),
  ]);
  res.json({ collaboratori, tipi, stati, operatori, mesi });
});

router.get("/backoffice/pratiche/:id", async (req, res) => {
  const { id } = valida(GetPraticaBackofficeParams, req.params);
  res.json(await dettaglioBackoffice(req, id));
});

// ---------------------------------------------------------------------------------------------
// Gestione: presa in carico, stato, commenti, allegati
// ---------------------------------------------------------------------------------------------

router.post("/backoffice/pratiche/:id/presa-in-carico", async (req, res) => {
  const { id } = valida(PrendiInCaricoPraticaParams, req.params);
  const p = await caricaPraticaInviata(id);
  const u = req.utente!;
  const io = `${u.cognome} ${u.nome}`;
  await db.transaction(async (tx) => {
    const [corrente] = await tx
      .select({ gestita: praticheTable.gestitaDaUtenteId })
      .from(praticheTable)
      .where(eq(praticheTable.id, id))
      .for("update");
    if (!corrente) throw nonTrovato("Pratica non trovata.");
    if (corrente.gestita === u.id) throw new HttpError(409, "La pratica è già in carico a te.", "GIA_IN_CARICO");
    const prima = p.gestoreCognome && corrente.gestita === p.gestitaDaUtenteId ? `${p.gestoreCognome} ${p.gestoreNome}` : null;
    let precedente = prima;
    if (corrente.gestita && !precedente) {
      const [g] = await tx.select({ nome: utentiTable.nome, cognome: utentiTable.cognome }).from(utentiTable).where(eq(utentiTable.id, corrente.gestita));
      precedente = g ? `${g.cognome} ${g.nome}` : null;
    }
    const ora = new Date();
    // Chi prende in carico riceve i propri solleciti di scadenza: si riparte da zero.
    await tx.update(praticheTable).set({ gestitaDaUtenteId: u.id, modificataIl: ora, ultimaAttivitaBackofficeIl: ora, sollecitoVicinaIl: null, sollecitoSuperataIl: null }).where(eq(praticheTable.id, id));
    await tx.insert(eventiPraticaTable).values({ praticaId: id, tipo: "presa_in_carico", utenteId: u.id, da: precedente, a: io });
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.presa_in_carico",
      entita: "pratica",
      entitaId: id,
      descrizione: precedente
        ? `Presa in carico della pratica ${descrizionePraticaBo(p)} (era di ${precedente})`
        : `Presa in carico della pratica ${descrizionePraticaBo(p)}`,
      dettagli: { precedente, nuovo: io },
    });
  });
  res.json(await dettaglioBackoffice(req, id));
});

router.put("/backoffice/pratiche/:id/priorita", async (req, res) => {
  const { id } = valida(CambiaPrioritaPraticaParams, req.params);
  const { priorita } = valida(CambiaPrioritaPraticaBody, req.body);
  const p = await caricaPraticaInviata(id);
  if (p.priorita === priorita) throw new HttpError(409, "La pratica ha già questa priorità.", "PRIORITA_INVARIATA", "priorita");
  await db.transaction(async (tx) => {
    await tx.update(praticheTable).set({ priorita, modificataIl: new Date() }).where(eq(praticheTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.priorita",
      entita: "pratica",
      entitaId: id,
      descrizione: `Pratica ${descrizionePraticaBo(p)}: priorità cambiata da "${ETICHETTA_PRIORITA[p.priorita]}" a "${ETICHETTA_PRIORITA[priorita]}"`,
      dettagli: { da: p.priorita, a: priorita },
    });
  });
  res.json(await dettaglioBackoffice(req, id));
});

router.put("/backoffice/pratiche/:id/stato", async (req, res) => {
  const { id } = valida(CambiaStatoPraticaParams, req.params);
  const { statoId } = valida(CambiaStatoPraticaBody, req.body);
  const p = await caricaPraticaInviata(id);
  const [nuovo] = await db.select().from(statiPraticaTable).where(eq(statiPraticaTable.id, statoId));
  if (!nuovo) throw new HttpError(400, "Stato non trovato.", "DATI_NON_VALIDI", "statoId");
  if (nuovo.nome.trim().toLowerCase() === NOME_STATO_BOZZA) {
    throw new HttpError(400, "Una pratica inviata non può tornare in bozza.", "DATI_NON_VALIDI", "statoId");
  }
  if (nuovo.nome.trim().toLowerCase() === NOME_STATO_PAGATA) {
    throw new HttpError(409, "Lo stato Pagata si imposta registrando il pagamento di un estratto in Compensi.", "STATO_PAGATA_RISERVATO", "statoId");
  }
  await db.transaction(async (tx) => {
    const [corrente] = await tx
      .select({ statoId: praticheTable.statoId, tipoPraticaId: praticheTable.tipoPraticaId, collaboratoreId: praticheTable.collaboratoreId, chiusaIl: praticheTable.chiusaIl })
      .from(praticheTable)
      .where(eq(praticheTable.id, id))
      .for("update");
    if (!corrente) throw nonTrovato("Pratica non trovata.");
    if (corrente.statoId === nuovo.id) throw new HttpError(409, "La pratica è già in questo stato.", "STATO_INVARIATO", "statoId");
    const estrattoId = await estrattoDellaPratica(tx, id);
    if (estrattoId) {
      throw new HttpError(409, `La pratica è nell'estratto n. ${estrattoId}: il suo stato non si può più cambiare. Per riaprirla elimina prima l'estratto (se non è ancora pagato).`, "PRATICA_IN_ESTRATTO");
    }
    const [prec] = corrente.statoId ? await tx.select({ nome: statiPraticaTable.nome }).from(statiPraticaTable).where(eq(statiPraticaTable.id, corrente.statoId)) : [];
    const ora = new Date();
    await tx.update(praticheTable).set({ statoId: nuovo.id, modificataIl: ora, ultimaAttivitaBackofficeIl: ora }).where(eq(praticheTable.id, id));
    const compenso = await aggiornaMaturazione(tx, { id, tipoPraticaId: corrente.tipoPraticaId, collaboratoreId: corrente.collaboratoreId, chiusaIl: corrente.chiusaIl }, nuovo, ora);
    await tx.insert(eventiPraticaTable).values({ praticaId: id, tipo: "cambio_stato", utenteId: req.utente!.id, da: prec?.nome ?? null, a: nuovo.nome });
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.cambio_stato",
      entita: "pratica",
      entitaId: id,
      descrizione: `Pratica ${descrizionePraticaBo(p)}: stato cambiato da "${prec?.nome ?? "—"}" a "${nuovo.nome}"${
        compenso ? `; compenso maturato: ${compenso.punti} punti, € ${(compenso.valoreCentesimi / 100).toFixed(2).replace(".", ",")}` : ""
      }`,
      dettagli: {
        da: prec?.nome ?? null,
        a: nuovo.nome,
        statoId: nuovo.id,
        ...(compenso ? { compensoMaturato: { punti: compenso.punti, valoreCentesimi: compenso.valoreCentesimi } } : {}),
      },
    });
  });
  res.json(await dettaglioBackoffice(req, id));
});

router.post("/backoffice/pratiche/:id/commenti", async (req, res) => {
  const { id } = valida(CreateCommentoPraticaBackofficeParams, req.params);
  const { testo, canale } = valida(CreateCommentoPraticaBackofficeBody, req.body);
  const p = await caricaPraticaInviata(id);
  const pulito = testo.replace(/\r\n/g, "\n").trim();
  if (!pulito) throw new HttpError(400, "Scrivi un messaggio.", "DATI_NON_VALIDI", "testo");
  if (pulito.length > MAX_MESSAGGIO) throw new HttpError(400, `Il messaggio può avere al massimo ${MAX_MESSAGGIO} caratteri.`, "DATI_NON_VALIDI", "testo");
  const notifiche = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(commentiPraticaTable)
      .values({ praticaId: id, utenteId: req.utente!.id, testo: pulito, canaleAvviso: canale })
      .returning({ id: commentiPraticaTable.id });
    const ora = new Date();
    await tx.update(praticheTable).set({ modificataIl: ora, ultimaAttivitaBackofficeIl: ora }).where(eq(praticheTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.commento_backoffice",
      entita: "pratica",
      entitaId: id,
      descrizione: `Commento sulla pratica ${descrizionePraticaBo(p)} (avviso alla sede: ${ETICHETTA_CANALE[canale]})`,
      dettagli: { commentoId: c!.id, canale },
    });
    return notificaCommentoUfficio(tx, { id, numero: p.numero!, collaboratoreId: p.collaboratoreId }, canale);
  });
  recapitaInBackground(notifiche);
  res.status(201).json(await dettaglioBackoffice(req, id));
});

/**
 * Allegato dell'operatore: o una voce dell'elenco del tipo di pratica (`allegatoTipoId`) oppure "Altro" con un nome libero (`descrizione`).
 */
router.post("/backoffice/pratiche/:id/allegati/file", corpoFile, async (req, res) => {
  const id = intero(req.params["id"], "id");
  const p = await caricaPraticaInviata(id);
  const file = validaFile(req.query["nomeFile"], req.body, { soloPdfEImmagini: true });
  let nomeAllegato: string;
  const scelta = req.query["allegatoTipoId"];
  if (scelta !== undefined && scelta !== "") {
    const [voce] = await db
      .select()
      .from(allegatiTipoTable)
      .where(and(eq(allegatiTipoTable.id, intero(scelta, "allegatoTipoId")), eq(allegatiTipoTable.tipoPraticaId, p.tipoPraticaId)));
    if (!voce) throw new HttpError(400, "Documento non previsto per questo tipo di pratica.", "DATI_NON_VALIDI", "allegatoTipoId");
    nomeAllegato = voce.nome;
  } else {
    nomeAllegato = String(req.query["descrizione"] ?? "").replace(/\s+/g, " ").trim();
    if (!nomeAllegato) throw new HttpError(400, "Scrivi il nome dell'allegato.", "DATI_NON_VALIDI", "descrizione");
    if (nomeAllegato.length > 200) throw new HttpError(400, "Il nome può avere al massimo 200 caratteri.", "DATI_NON_VALIDI", "descrizione");
  }

  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      const ora = new Date();
      const [d] = await tx
        .insert(documentiPraticaTable)
        .values({
          praticaId: id,
          documentoTipoId: null,
          nome: nomeAllegato,
          fileChiave: chiave,
          fileNome: file.nome,
          fileTipo: file.tipo,
          fileDimensione: file.dimensione,
          caricatoIl: ora,
          caricatoDaUtenteId: req.utente!.id,
          dopoInvio: true,
          daBackoffice: true,
        })
        .returning({ id: documentiPraticaTable.id });
      await tx.update(praticheTable).set({ modificataIl: ora, ultimaAttivitaBackofficeIl: ora }).where(eq(praticheTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "pratica.allegato_backoffice",
        entita: "pratica",
        entitaId: id,
        descrizione: `Aggiunto l'allegato "${nomeAllegato}" (${file.nome}) alla pratica ${descrizionePraticaBo(p)}`,
        dettagli: { documentoId: d!.id, fileNome: file.nome, dimensione: file.dimensione },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  res.status(201).json(await dettaglioBackoffice(req, id));
});

// ---------------------------------------------------------------------------------------------
// File (scaricamento e anteprima)
// ---------------------------------------------------------------------------------------------

router.get("/backoffice/pratiche/:id/documenti/:docId/file", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const docId = intero(req.params["docId"], "docId");
  await caricaPraticaInviata(id);
  const [d] = await db.select().from(documentiPraticaTable).where(and(eq(documentiPraticaTable.id, docId), eq(documentiPraticaTable.praticaId, id)));
  if (!d) throw nonTrovato("Documento non trovato.");
  const { stream } = await leggiFile(d.fileChiave);
  inviaFile(res, stream, d.fileNome, d.fileTipo, d.fileDimensione, req.query["anteprima"] === "1");
});

const nomeSicuro = (t: string) => t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

/** Tutti i documenti caricati dal collaboratore in un unico file zip, con nomi leggibili ("Carta d'identità - ROSSI MARIO.pdf"). */
router.get("/backoffice/pratiche/:id/documenti.zip", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const p = await caricaPraticaInviata(id);
  const docs = await db
    .select()
    .from(documentiPraticaTable)
    .where(and(eq(documentiPraticaTable.praticaId, id), eq(documentiPraticaTable.daBackoffice, false)))
    .orderBy(asc(documentiPraticaTable.id));
  if (!docs.length) throw nonTrovato("Il collaboratore non ha caricato nessun documento per questa pratica.");
  const assistito = `${p.assCognome} ${p.assNome}`.toUpperCase();
  const zip = new JSZip();
  const usati = new Set<string>();
  for (const d of docs) {
    const ext = /\.[A-Za-z0-9]{1,8}$/.exec(d.fileNome)?.[0].toLowerCase() ?? "";
    const base = `${nomeSicuro(d.nome) || "Documento"} - ${assistito}`;
    let nome = `${base}${ext}`;
    for (let n = 2; usati.has(nome.toLowerCase()); n++) nome = `${base} (${n})${ext}`;
    usati.add(nome.toLowerCase());
    const { stream } = await leggiFile(d.fileChiave);
    const pezzi: Buffer[] = [];
    for await (const c of stream) pezzi.push(Buffer.from(c as Buffer));
    zip.file(nome, Buffer.concat(pezzi));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  await registraLog(db, contestoDa(req), {
    azione: "pratica.documenti_scarica",
    entita: "pratica",
    entitaId: id,
    descrizione: `Scaricati tutti i documenti della pratica ${descrizionePraticaBo(p)} (${docs.length} file)`,
    dettagli: { file: docs.length },
  });
  inviaFile(res, Readable.from(buffer), `Pratica ${p.numero} - ${nomeSicuro(assistito)}.zip`, "application/zip", buffer.length);
});

router.get("/backoffice/pratiche/:id/mandato/file", async (req, res) => {
  const p = await caricaPraticaInviata(intero(req.params["id"], "id"));
  const firmato = await leggiPdfFirmato(p.id);
  if (firmato) return inviaFile(res, Readable.from(firmato.pdf), firmato.fileNome, "application/pdf", firmato.pdf.length, req.query["anteprima"] === "1");
  const m = await mandatoDellaPratica(p);
  if (!m) throw nonTrovato("Nessun mandato assegnato per questa pratica.");
  const { pdf, nomeFile } = await mandatoCompilatoPdf(p, m.fileChiave);
  inviaFile(res, Readable.from(pdf), nomeFile, "application/pdf", pdf.length, req.query["anteprima"] === "1");
});

// ---------------------------------------------------------------------------------------------
// Cancellazione (solo super admin)
// ---------------------------------------------------------------------------------------------

router.delete("/backoffice/pratiche/:id", richiediRuolo("super_admin"), async (req, res) => {
  const { id } = valida(DeletePraticaBackofficeParams, req.params);
  const p = await caricaPraticaInviata(id);
  const inEstratto = await estrattoDellaPratica(db, id);
  if (inEstratto) throw new HttpError(409, `La pratica è nell'estratto n. ${inEstratto} e non si può cancellare.`, "PRATICA_IN_ESTRATTO");
  const file = await db.select({ chiave: documentiPraticaTable.fileChiave }).from(documentiPraticaTable).where(eq(documentiPraticaTable.praticaId, id));
  const chiaveFirma = await chiaveFirmaPratica(id);
  if (chiaveFirma) file.push({ chiave: chiaveFirma });
  await db.transaction(async (tx) => {
    const [commenti] = await tx.select({ n: sql<number>`count(*)::int` }).from(commentiPraticaTable).where(eq(commentiPraticaTable.praticaId, id));
    const [r] = await tx.delete(praticheTable).where(eq(praticheTable.id, id)).returning({ id: praticheTable.id });
    if (!r) throw nonTrovato("Pratica non trovata.");
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.elimina",
      entita: "pratica",
      entitaId: id,
      descrizione: `Cancellata la pratica ${descrizionePraticaBo(p)} (stato "${p.statoNome}", collaboratore ${p.collCognome} ${p.collNome})`,
      dettagli: {
        numero: p.numero,
        stato: p.statoNome,
        assistitoId: p.assistitoId,
        collaboratoreId: p.collaboratoreId,
        tipoPraticaId: p.tipoPraticaId,
        documentiEliminati: file.length,
        commentiEliminati: commenti?.n ?? 0,
      },
    });
  });
  for (const f of file) await eliminaFile(f.chiave, req.log);
  res.status(204).end();
});

export default router;
