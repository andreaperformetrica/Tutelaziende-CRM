import express, { Router, type IRouter } from "express";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { CollegaMandatoProvinciaBody, CollegaMandatoProvinciaParams, DeleteMandatoParams } from "@workspace/api-zod";
import { nomeProvincia, PROVINCE, provinciaValida } from "@workspace/anagrafica";
import { assegnazioniMandatoTable, collaboratoriTable, db, mandatiTable, tipiPraticaTable, utentiTable } from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { CAMPI_MANDATO, controllaModello } from "../lib/mandato-compilato";
import { codiceErrorePg } from "../lib/postgres";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use(["/mandati", "/province"], richiediRuolo("super_admin", "admin"));
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });

/** Sedi che ricevono il mandato: quelle della provincia (mandati per provincia) oppure i collaboratori a cui era stato assegnato (mandati precedenti). */
const assegnati = sql<number>`case when ${mandatiTable.provincia} is not null
  then (select count(*)::int from collaboratori c join utenti u on u.id = c.utente_id where c.sede_provincia = ${mandatiTable.provincia} and u.attivo)
  else (select count(*)::int from assegnazioni_mandato a where a.mandato_id = ${mandatiTable.id}) end`;

function selezione() {
  return db
    .select({
      id: mandatiTable.id,
      nome: mandatiTable.nome,
      provincia: mandatiTable.provincia,
      tipoPraticaId: mandatiTable.tipoPraticaId,
      tipoPraticaNome: tipiPraticaTable.nome,
      fileNome: mandatiTable.fileNome,
      fileTipo: mandatiTable.fileTipo,
      fileDimensione: mandatiTable.fileDimensione,
      caricatoIl: mandatiTable.caricatoIl,
      utenteNome: utentiTable.nome,
      utenteCognome: utentiTable.cognome,
      assegnati,
    })
    .from(mandatiTable)
    .leftJoin(utentiTable, eq(utentiTable.id, mandatiTable.caricatoDaUtenteId))
    .leftJoin(tipiPraticaTable, eq(tipiPraticaTable.id, mandatiTable.tipoPraticaId));
}

type Riga = Awaited<ReturnType<typeof selezione>>[number];
const mappa = (r: Riga) => ({
  id: r.id,
  nome: r.nome,
  provincia: r.provincia,
  tipoPraticaId: r.tipoPraticaId,
  tipoPraticaNome: r.tipoPraticaNome,
  fileNome: r.fileNome,
  fileTipo: r.fileTipo,
  dimensione: r.fileDimensione,
  caricatoIl: r.caricatoIl.toISOString(),
  caricatoDa: r.utenteCognome ? `${r.utenteCognome} ${r.utenteNome}` : null,
  collaboratoriAssegnati: r.assegnati,
});

const intero = (v: unknown, nome: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parametro "${nome}" non valido.`, "DATI_NON_VALIDI", nome);
  return n;
};

async function caricaMandato(id: number) {
  const [m] = await db.select().from(mandatiTable).where(eq(mandatiTable.id, id));
  if (!m) throw nonTrovato("Mandato non trovato.");
  return m;
}

async function mandatoMappato(id: number) {
  const [r] = await selezione().where(eq(mandatiTable.id, id));
  return mappa(r!);
}

function siglaProvincia(v: unknown): string {
  const sigla = String(v ?? "").trim().toUpperCase();
  if (!provinciaValida(sigla)) throw new HttpError(400, "Provincia non valida.", "DATI_NON_VALIDI", "provincia");
  return sigla;
}

async function tipoPratica(id: number | null | undefined): Promise<{ id: number; nome: string } | null> {
  if (id === null || id === undefined) return null;
  const [t] = await db.select({ id: tipiPraticaTable.id, nome: tipiPraticaTable.nome }).from(tipiPraticaTable).where(eq(tipiPraticaTable.id, id));
  if (!t) throw new HttpError(400, "Tipo di pratica non valido.", "DATI_NON_VALIDI", "tipoPraticaId");
  return t;
}

const nomeMandato = (provincia: string, tipo: { nome: string } | null) =>
  `Mandato ${nomeProvincia(provincia)} (${provincia}) - ${tipo ? tipo.nome : "tutti i tipi di pratica"}`;

const descriviDestinazione = (provincia: string, tipo: { nome: string } | null) =>
  `${nomeProvincia(provincia)} (${provincia}), ${tipo ? `tipo di pratica "${tipo.nome}"` : "tutti i tipi di pratica"}`;

async function mandatoEsistente(provincia: string, tipoId: number | null, escludiId?: number) {
  const [m] = await db
    .select()
    .from(mandatiTable)
    .where(
      and(
        eq(mandatiTable.provincia, provincia),
        tipoId === null ? isNull(mandatiTable.tipoPraticaId) : eq(mandatiTable.tipoPraticaId, tipoId),
        escludiId ? ne(mandatiTable.id, escludiId) : undefined,
      ),
    );
  return m ?? null;
}

router.get("/province", async (_req, res) => {
  const righe = await db
    .select({ sigla: collaboratoriTable.sedeProvincia, sedi: count() })
    .from(collaboratoriTable)
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(eq(utentiTable.attivo, true))
    .groupBy(collaboratoriTable.sedeProvincia);
  const sedi = new Map(righe.map((r) => [r.sigla, r.sedi]));
  res.json(PROVINCE.map(([sigla, nome]) => ({ sigla, nome, sedi: sedi.get(sigla) ?? 0 })));
});

router.get("/mandati", async (_req, res) => {
  const righe = await selezione().orderBy(sql`${mandatiTable.provincia} nulls first`, sql`${mandatiTable.tipoPraticaId} nulls first`, sql`lower(${mandatiTable.nome})`);
  res.json(righe.map(mappa));
});

/** Il modello deve essere un Word e i campi @gruppo.nome devono essere tra quelli che il sistema sa compilare. */
async function validaModello(file: { nome: string; buffer: Buffer }) {
  if (!/\.docx$/i.test(file.nome)) {
    throw new HttpError(400, "Il mandato deve essere un documento Word (.docx) con i campi da compilare.", "FILE_FORMATO_NON_AMMESSO");
  }
  const { trovati, sconosciuti } = await controllaModello(file.buffer);
  if (sconosciuti.length) {
    throw new HttpError(400, `Il modello contiene campi che non conosco: ${sconosciuti.join(", ")}. Campi ammessi: ${CAMPI_MANDATO.map((c) => `@${c}`).join(", ")}.`, "FILE_NON_VALIDO");
  }
  if (!trovati.length) {
    throw new HttpError(400, "Nel modello non c'è nessun campo da compilare (per esempio @cliente.cognome).", "FILE_NON_VALIDO");
  }
}

router.get("/mandati/:id/file", async (req, res) => {
  const m = await caricaMandato(intero(req.params["id"], "id"));
  const { stream } = await leggiFile(m.fileChiave);
  inviaFile(res, stream, m.fileNome, m.fileTipo, m.fileDimensione);
});

/**
 * Carica il mandato di una provincia (query: nomeFile, provincia, tipoPraticaId facoltativo = tutti i tipi).
 * Se per quella provincia e quel tipo c'è già un mandato ne sostituisce il file.
 */
router.post("/mandati/file", corpoFile, async (req, res) => {
  const file = validaFile(req.query["nomeFile"], req.body);
  const provincia = siglaProvincia(req.query["provincia"]);
  const tipoId = req.query["tipoPraticaId"] ? intero(req.query["tipoPraticaId"], "tipoPraticaId") : null;
  const tipo = await tipoPratica(tipoId);
  await validaModello(file);
  const chiave = await salvaFile(file.buffer, file.tipo);
  let vecchiaChiave: string | null = null;
  try {
    const { id, creato } = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4002)`);
      const esiste = await mandatoEsistente(provincia, tipoId);
      const dove = descriviDestinazione(provincia, tipo);
      if (esiste) {
        vecchiaChiave = esiste.fileChiave;
        await tx
          .update(mandatiTable)
          .set({ fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione, caricatoIl: new Date(), caricatoDaUtenteId: req.utente!.id })
          .where(eq(mandatiTable.id, esiste.id));
        await registraLog(tx, contestoDa(req), {
          azione: "mandato.sostituisci",
          entita: "mandato",
          entitaId: esiste.id,
          descrizione: `Sostituito il mandato di ${dove}: ${esiste.fileNome} con ${file.nome}`,
          dettagli: { provincia, tipoPraticaId: tipoId, precedente: esiste.fileNome, fileNome: file.nome, dimensione: file.dimensione },
        });
        return { id: esiste.id, creato: false };
      }
      const [m] = await tx
        .insert(mandatiTable)
        .values({
          provincia, tipoPraticaId: tipoId, nome: nomeMandato(provincia, tipo),
          fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione, caricatoDaUtenteId: req.utente!.id,
        })
        .returning({ id: mandatiTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.carica",
        entita: "mandato",
        entitaId: m!.id,
        descrizione: `Caricato il mandato di ${dove} (${file.nome})`,
        dettagli: { provincia, tipoPraticaId: tipoId, fileNome: file.nome, dimensione: file.dimensione },
      });
      return { id: m!.id, creato: true };
    });
    if (vecchiaChiave) await eliminaFile(vecchiaChiave, req.log);
    res.status(creato ? 201 : 200).json(await mandatoMappato(id));
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
});

/** Sostituisce il file di un mandato: il cambio vale per tutte le sedi che lo ricevono. */
router.put("/mandati/:id/file", corpoFile, async (req, res) => {
  const m = await caricaMandato(intero(req.params["id"], "id"));
  const file = validaFile(req.query["nomeFile"], req.body);
  await validaModello(file);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(mandatiTable)
        .set({ fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione, caricatoIl: new Date(), caricatoDaUtenteId: req.utente!.id })
        .where(eq(mandatiTable.id, m.id));
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.sostituisci",
        entita: "mandato",
        entitaId: m.id,
        descrizione: `Sostituito il file del mandato "${m.nome}": ${m.fileNome} con ${file.nome}`,
        dettagli: { precedente: m.fileNome, fileNome: file.nome, dimensione: file.dimensione },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  await eliminaFile(m.fileChiave, req.log);
  res.json(await mandatoMappato(m.id));
});

/** Collega un mandato (tipicamente uno caricato prima per sede) a una provincia e a un tipo di pratica. */
router.patch("/mandati/:id", async (req, res) => {
  const { id } = valida(CollegaMandatoProvinciaParams, req.params);
  const b = valida(CollegaMandatoProvinciaBody, req.body);
  const m = await caricaMandato(id);
  const provincia = siglaProvincia(b.provincia);
  const tipo = await tipoPratica(b.tipoPraticaId);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4002)`);
    const altro = await mandatoEsistente(provincia, tipo?.id ?? null, id);
    if (altro) {
      throw new HttpError(409, `Per ${descriviDestinazione(provincia, tipo)} c'è già un mandato (${altro.fileNome}): sostituiscilo da lì oppure eliminalo prima.`, "MANDATO_DUPLICATO");
    }
    await tx.update(mandatiTable).set({ provincia, tipoPraticaId: tipo?.id ?? null }).where(eq(mandatiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "mandato.collega_provincia",
      entita: "mandato",
      entitaId: id,
      descrizione: `Il mandato "${m.nome}" (${m.fileNome}) vale ora per ${descriviDestinazione(provincia, tipo)}`,
      dettagli: { prima: { provincia: m.provincia, tipoPraticaId: m.tipoPraticaId }, dopo: { provincia, tipoPraticaId: tipo?.id ?? null } },
    });
  });
  res.json(await mandatoMappato(id));
});

router.delete("/mandati/:id", async (req, res) => {
  const { id } = valida(DeleteMandatoParams, req.params);
  const m = await caricaMandato(id);
  const [n] = await db.select({ n: count() }).from(assegnazioniMandatoTable).where(eq(assegnazioniMandatoTable.mandatoId, id));
  if ((n?.n ?? 0) > 0) {
    throw new HttpError(
      409,
      `Il mandato è ancora usato da ${n?.n} ${n?.n === 1 ? "collaboratore" : "collaboratori"} senza provincia della sede: collegalo a una provincia oppure indica la provincia nella scheda dei collaboratori.`,
      "MANDATO_IN_USO",
    );
  }
  try {
    await db.transaction(async (tx) => {
      await tx.delete(mandatiTable).where(eq(mandatiTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.elimina",
        entita: "mandato",
        entitaId: id,
        descrizione: `Eliminato il mandato "${m.nome}" (${m.fileNome})`,
        dettagli: { nome: m.nome, fileNome: m.fileNome, provincia: m.provincia, tipoPraticaId: m.tipoPraticaId },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23503") {
      throw new HttpError(409, "Il mandato è stato usato in pratiche già inviate e non può essere eliminato: puoi sostituirne il file.", "MANDATO_IN_USO");
    }
    throw err;
  }
  await eliminaFile(m.fileChiave, req.log);
  res.status(204).end();
});

export default router;
