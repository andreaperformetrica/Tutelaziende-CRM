import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  ArchiviaSegnalazioneBody,
  ArchiviaSegnalazioneParams,
  AssociaSegnalazioneBody,
  AssociaSegnalazioneParams,
  ListSegnalazioniDuplicatiQueryParams,
} from "@workspace/api-zod";
import {
  assistitiTable,
  collaboratoriTable,
  db,
  personeTable,
  segnalazioniDuplicatiTable,
  utentiTable,
} from "@workspace/db";
import { controllaDestinazione, riassegnaInTransazione } from "../lib/assistiti";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
// Le segnalazioni contengono dati di altri collaboratori: solo admin e super admin.
router.use("/segnalazioni-duplicati", richiediRuolo("super_admin", "admin"));

const richiedente = alias(collaboratoriTable, "richiedente");
const personaRichiedente = alias(personeTable, "persona_richiedente");
const esistente = alias(personeTable, "esistente");
const comeCollaboratore = alias(collaboratoriTable, "come_collaboratore");
const proprietario = alias(collaboratoriTable, "proprietario");
const personaProprietario = alias(personeTable, "persona_proprietario");
const gestore = alias(utentiTable, "gestore");

const colonne = {
  id: segnalazioniDuplicatiTable.id,
  creataIl: segnalazioniDuplicatiTable.creataIl,
  ultimoTentativoIl: segnalazioniDuplicatiTable.ultimoTentativoIl,
  tentativi: segnalazioniDuplicatiTable.tentativi,
  campi: segnalazioniDuplicatiTable.campi,
  datiTentati: segnalazioniDuplicatiTable.datiTentati,
  stato: segnalazioniDuplicatiTable.stato,
  esito: segnalazioniDuplicatiTable.esito,
  nota: segnalazioniDuplicatiTable.nota,
  gestitaIl: segnalazioniDuplicatiTable.gestitaIl,
  tipo: segnalazioniDuplicatiTable.tipoCorrispondenza,
  richId: richiedente.id,
  richNome: personaRichiedente.nome,
  richCognome: personaRichiedente.cognome,
  richSportello: richiedente.numeroSportello,
  richTipologia: richiedente.tipologia,
  esiPersonaId: esistente.id,
  esiNome: esistente.nome,
  esiCognome: esistente.cognome,
  esiCf: esistente.codiceFiscale,
  esiCellulare: esistente.cellulare,
  assistitoId: assistitiTable.id,
  colEsiId: comeCollaboratore.id,
  colEsiSportello: comeCollaboratore.numeroSportello,
  colEsiTipologia: comeCollaboratore.tipologia,
  propId: proprietario.id,
  propNome: personaProprietario.nome,
  propCognome: personaProprietario.cognome,
  propSportello: proprietario.numeroSportello,
  propDenominazione: proprietario.denominazione,
  richDenominazione: richiedente.denominazione,
  propTipologia: proprietario.tipologia,
  gestoreNome: gestore.nome,
  gestoreCognome: gestore.cognome,
};

function selezione() {
  return db
    .select(colonne)
    .from(segnalazioniDuplicatiTable)
    .innerJoin(richiedente, eq(richiedente.id, segnalazioniDuplicatiTable.richiedenteCollaboratoreId))
    .innerJoin(personaRichiedente, eq(personaRichiedente.id, richiedente.personaId))
    .innerJoin(esistente, eq(esistente.id, segnalazioniDuplicatiTable.personaEsistenteId))
    .leftJoin(assistitiTable, eq(assistitiTable.personaId, esistente.id))
    .leftJoin(comeCollaboratore, eq(comeCollaboratore.personaId, esistente.id))
    .leftJoin(proprietario, eq(proprietario.id, assistitiTable.collaboratoreId))
    .leftJoin(personaProprietario, eq(personaProprietario.id, proprietario.personaId))
    .leftJoin(gestore, eq(gestore.id, segnalazioniDuplicatiTable.gestitaDaUtenteId));
}

type Riga = Awaited<ReturnType<typeof selezione>>[number];

function mappa(r: Riga) {
  const collaboratore =
    r.tipo === "assistito" && r.propId !== null
      ? { id: r.propId, nome: r.propNome!, cognome: r.propCognome!, numeroSportello: r.propSportello!, denominazione: r.propDenominazione, tipologia: r.propTipologia! }
      : r.tipo === "collaboratore" && r.colEsiId !== null
        ? { id: r.colEsiId, nome: r.esiNome, cognome: r.esiCognome, numeroSportello: r.colEsiSportello!, tipologia: r.colEsiTipologia! }
        : null;
  return {
    id: r.id,
    creataIl: r.creataIl.toISOString(),
    ultimoTentativoIl: r.ultimoTentativoIl.toISOString(),
    tentativi: r.tentativi,
    richiedente: {
      id: r.richId,
      nome: r.richNome,
      cognome: r.richCognome,
      numeroSportello: r.richSportello,
      denominazione: r.richDenominazione,
      tipologia: r.richTipologia,
    },
    esistente: {
      personaId: r.esiPersonaId,
      tipo: r.tipo,
      nome: r.esiNome,
      cognome: r.esiCognome,
      codiceFiscale: r.esiCf,
      cellulare: r.esiCellulare,
      assistitoId: r.assistitoId,
      collaboratore,
    },
    campi: r.campi,
    datiTentati: r.datiTentati,
    stato: r.stato,
    esito: r.esito,
    nota: r.nota,
    gestitaIl: r.gestitaIl ? r.gestitaIl.toISOString() : null,
    gestitaDa: r.gestoreCognome ? `${r.gestoreCognome} ${r.gestoreNome}` : null,
  };
}

async function carica(id: number) {
  const [r] = await selezione().where(eq(segnalazioniDuplicatiTable.id, id));
  if (!r) throw nonTrovato("Segnalazione non trovata.");
  return r;
}

const pulisciNota = (v: string | null | undefined) => (v && v.trim() ? v.trim().slice(0, 1000) : null);

router.get("/segnalazioni-duplicati", async (req, res) => {
  const p = valida(ListSegnalazioniDuplicatiQueryParams, req.query);
  const stato = p.stato ?? "aperte";
  const righe = await selezione()
    .where(
      stato === "tutte"
        ? undefined
        : eq(segnalazioniDuplicatiTable.stato, stato === "aperte" ? "aperta" : "gestita"),
    )
    .orderBy(desc(segnalazioniDuplicatiTable.ultimoTentativoIl), desc(segnalazioniDuplicatiTable.id));
  res.json(righe.map(mappa));
});

router.get("/segnalazioni-duplicati/conteggio", async (_req, res) => {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(segnalazioniDuplicatiTable)
    .where(eq(segnalazioniDuplicatiTable.stato, "aperta"));
  res.json({ aperte: r?.n ?? 0 });
});

router.post("/segnalazioni-duplicati/:id/associa", async (req, res) => {
  const { id } = valida(AssociaSegnalazioneParams, req.params);
  const { collaboratoreId, nota } = valida(AssociaSegnalazioneBody, req.body);
  const s = await carica(id);
  if (s.stato !== "aperta") throw new HttpError(409, "La segnalazione è già stata gestita.", "SEGNALAZIONE_GIA_GESTITA");
  if (s.tipo !== "assistito" || s.assistitoId === null || s.propId === null) {
    throw new HttpError(
      400,
      "La segnalazione riguarda un collaboratore, non un assistito: non si può associare. Puoi archiviarla.",
      "SEGNALAZIONE_NON_ASSOCIABILE",
    );
  }
  await controllaDestinazione(collaboratoreId);
  const u = req.utente!;
  await db.transaction(async (tx) => {
    if (s.propId !== collaboratoreId) {
      await riassegnaInTransazione(
        tx,
        req,
        { id: s.assistitoId!, nome: s.esiNome, cognome: s.esiCognome, collaboratoreId: s.propId! },
        collaboratoreId,
      );
    }
    await tx
      .update(segnalazioniDuplicatiTable)
      .set({ stato: "gestita", esito: "associata", nota: pulisciNota(nota), gestitaIl: sql`now()`, gestitaDaUtenteId: u.id })
      .where(eq(segnalazioniDuplicatiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "segnalazione.associa",
      entita: "segnalazione",
      entitaId: id,
      descrizione: `Segnalazione n. ${id} chiusa: l'assistito ${s.esiCognome} ${s.esiNome} è associato al collaboratore n. ${collaboratoreId}`,
      dettagli: { assistitoId: s.assistitoId, collaboratoreId, richiedenteId: s.richId },
    });
  });
  res.json(mappa(await carica(id)));
});

router.post("/segnalazioni-duplicati/:id/archivia", async (req, res) => {
  const { id } = valida(ArchiviaSegnalazioneParams, req.params);
  const corpo = req.body && Object.keys(req.body).length ? valida(ArchiviaSegnalazioneBody, req.body) : {};
  const s = await carica(id);
  if (s.stato !== "aperta") throw new HttpError(409, "La segnalazione è già stata gestita.", "SEGNALAZIONE_GIA_GESTITA");
  const u = req.utente!;
  await db.transaction(async (tx) => {
    await tx
      .update(segnalazioniDuplicatiTable)
      .set({ stato: "gestita", esito: "archiviata", nota: pulisciNota(corpo.nota), gestitaIl: sql`now()`, gestitaDaUtenteId: u.id })
      .where(eq(segnalazioniDuplicatiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "segnalazione.archivia",
      entita: "segnalazione",
      entitaId: id,
      descrizione: `Segnalazione n. ${id} archiviata senza modificare le associazioni`,
    });
  });
  res.json(mappa(await carica(id)));
});

export default router;
