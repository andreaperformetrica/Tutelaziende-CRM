import express, { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  CreateAllegatoTipoBody,
  CreateAllegatoTipoParams,
  CreateDocumentoNotoBody,
  CreateNormativaTipoBody,
  CreateNormativaTipoParams,
  DeleteAllegatoTipoParams,
  DeleteCompensoCollaboratoreParams,
  DeleteNormativaTipoParams,
  SaveCompensoCollaboratoreBody,
  SaveCompensoCollaboratoreParams,
  UpdateNormativaTipoBody,
  UpdateNormativaTipoParams,
  CreateDocumentoTipoBody,
  CreateDocumentoTipoParams,
  CreateTipoPraticaBody,
  DeleteDocumentoTipoParams,
  DeleteModuloTipoParams,
  GetTipoPraticaParams,
  OrdinaDocumentiTipoBody,
  OrdinaDocumentiTipoParams,
  RenameModuloTipoBody,
  RenameModuloTipoParams,
  UpdateDocumentoTipoBody,
  UpdateDocumentoTipoParams,
  UpdateTipoPraticaBody,
  UpdateTipoPraticaParams,
} from "@workspace/api-zod";
import {
  allegatiTipoTable,
  collaboratoriTable,
  compensiCollaboratoreTable,
  db,
  documentiNotiTable,
  documentiTipoTable,
  moduliTipoTable,
  normativeTipoTable,
  personeTable,
  tipiPraticaTable,
} from "@workspace/db";
import { controllaModuloCompilabile } from "../lib/mandato-compilato";
import { caricaTipoMappato, controllaOrdine, elencoTipi, pulisciNome } from "../lib/configurazione-pratiche";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, differenze, registraLog } from "../lib/log";
import { codiceErrorePg } from "../lib/postgres";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });

/** Il file di un modulo puo essere scaricato da qualunque utente autenticato (lo usera il collaboratore). */
router.get("/moduli-tipo/:id/file", async (req, res) => {
  const { id } = valida(DeleteModuloTipoParams, req.params);
  const [m] = await db.select().from(moduliTipoTable).where(eq(moduliTipoTable.id, id));
  if (!m) throw nonTrovato("Modulo non trovato.");
  const { stream } = await leggiFile(m.fileChiave);
  inviaFile(res, stream, m.fileNome, m.fileTipo, m.fileDimensione);
});

/** Con `inline` il file si apre nel browser (anteprima) invece di essere scaricato. */
export function inviaFile(res: express.Response, stream: NodeJS.ReadableStream, nome: string, tipo: string, dimensione: number, inline = false) {
  res.setHeader("Content-Type", tipo);
  res.setHeader("Content-Length", String(dimensione));
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

// Da qui in poi solo admin e super admin.
router.use(["/tipi-pratica", "/documenti-tipo", "/moduli-tipo", "/documenti-noti", "/compensi-tipo", "/normative-tipo", "/allegati-tipo"], richiediRuolo("super_admin", "admin"));

const NOME_DUPLICATO = new HttpError(409, "Esiste già un tipo di pratica con questo nome.", "NOME_DUPLICATO", "nome");
const DOC_DUPLICATO = new HttpError(409, "Questo documento è già nell'elenco del tipo di pratica.", "NOME_DUPLICATO", "nome");

function importi(b: { pagabile: boolean; punti: number; valoreEuro: number }) {
  if (!b.pagabile) return { punti: 0, valoreCentesimi: 0 };
  const centesimi = Math.round(b.valoreEuro * 100);
  if (Math.abs(b.valoreEuro * 100 - centesimi) > 1e-6) {
    throw new HttpError(400, "Il valore in euro può avere al massimo due decimali.", "DATI_NON_VALIDI", "valoreEuro");
  }
  if (!Number.isInteger(b.punti) || b.punti < 0 || b.punti > 1000) {
    throw new HttpError(400, "I punti devono essere un numero intero tra 0 e 1000.", "DATI_NON_VALIDI", "punti");
  }
  if (centesimi < 0 || centesimi > 10_000_000) {
    throw new HttpError(400, "Il valore in euro non è valido.", "DATI_NON_VALIDI", "valoreEuro");
  }
  return { punti: b.punti, valoreCentesimi: centesimi };
}

const euro = (c: number) => (c / 100).toFixed(2).replace(".", ",");

router.get("/tipi-pratica", async (_req, res) => {
  res.json(await elencoTipi());
});

router.get("/tipi-pratica/:id", async (req, res) => {
  const { id } = valida(GetTipoPraticaParams, req.params);
  res.json(await caricaTipoMappato(id));
});

router.post("/tipi-pratica", async (req, res) => {
  const b = valida(CreateTipoPraticaBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome del tipo di pratica");
  const valori = importi(b);
  try {
    const id = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tipiPraticaTable)
        .values({ nome, attivo: b.attivo ?? true, pagabile: b.pagabile, ...valori })
        .returning({ id: tipiPraticaTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "tipo_pratica.crea",
        entita: "tipo_pratica",
        entitaId: t!.id,
        descrizione: `Creato il tipo di pratica "${nome}"${b.pagabile ? ` (pagabile, ${valori.punti} punti, ${euro(valori.valoreCentesimi)} euro)` : " (non pagabile)"}`,
        dettagli: { nome, pagabile: b.pagabile, punti: valori.punti, valoreEuro: valori.valoreCentesimi / 100 },
      });
      return t!.id;
    });
    res.status(201).json(await caricaTipoMappato(id));
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw NOME_DUPLICATO;
    throw err;
  }
});

router.put("/tipi-pratica/:id", async (req, res) => {
  const { id } = valida(UpdateTipoPraticaParams, req.params);
  const b = valida(UpdateTipoPraticaBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome del tipo di pratica");
  const valori = importi(b);
  const prima = await caricaTipoMappato(id);
  const dopo = { nome, attivo: b.attivo ?? prima.attivo, pagabile: b.pagabile, punti: valori.punti, valoreEuro: valori.valoreCentesimi / 100 };
  const diff = differenze(prima as Record<string, unknown>, dopo, {
    nome: "nome", attivo: "stato attivo", pagabile: "pagabile", punti: "punti", valoreEuro: "valore in euro",
  });
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tipiPraticaTable)
        .set({ nome, attivo: dopo.attivo, pagabile: b.pagabile, ...valori, modificatoIl: sql`now()` })
        .where(eq(tipiPraticaTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "tipo_pratica.modifica",
        entita: "tipo_pratica",
        entitaId: id,
        descrizione: diff.elenco.length
          ? `Modificato il tipo di pratica "${prima.nome}": ${diff.elenco.join(", ")}`
          : `Salvato il tipo di pratica "${prima.nome}" senza modifiche`,
        dettagli: { prima: diff.prima, dopo: diff.dopo },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw NOME_DUPLICATO;
    throw err;
  }
  res.json(await caricaTipoMappato(id));
});

// ---- Documenti obbligatori ----

router.post("/tipi-pratica/:id/documenti", async (req, res) => {
  const { id } = valida(CreateDocumentoTipoParams, req.params);
  const b = valida(CreateDocumentoTipoBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome del documento", 100);
  const tipo = await caricaTipoMappato(id);
  try {
    await db.transaction(async (tx) => {
      const [m] = await tx
        .select({ max: sql<number>`coalesce(max(${documentiTipoTable.ordine}), 0)::int` })
        .from(documentiTipoTable)
        .where(eq(documentiTipoTable.tipoPraticaId, id));
      const [d] = await tx
        .insert(documentiTipoTable)
        .values({ tipoPraticaId: id, nome, mandato: b.mandato, ordine: (m?.max ?? 0) + 1 })
        .returning({ id: documentiTipoTable.id });
      await tx.insert(documentiNotiTable).values({ nome }).onConflictDoNothing();
      await registraLog(tx, contestoDa(req), {
        azione: "documento_tipo.crea",
        entita: "documento_tipo",
        entitaId: d!.id,
        descrizione: `Aggiunto il documento obbligatorio "${nome}" al tipo di pratica "${tipo.nome}"${b.mandato ? " (mandato)" : ""}`,
        dettagli: { tipoPraticaId: id, nome, mandato: b.mandato },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DOC_DUPLICATO;
    throw err;
  }
  res.status(201).json(await caricaTipoMappato(id));
});

router.put("/tipi-pratica/:id/documenti-ordine", async (req, res) => {
  const { id } = valida(OrdinaDocumentiTipoParams, req.params);
  const { ids } = valida(OrdinaDocumentiTipoBody, req.body);
  const tipo = await caricaTipoMappato(id);
  controllaOrdine(ids, tipo.documenti.map((d) => d.id));
  await db.transaction(async (tx) => {
    for (const [i, docId] of ids.entries()) {
      await tx.update(documentiTipoTable).set({ ordine: i + 1 }).where(eq(documentiTipoTable.id, docId));
    }
    await registraLog(tx, contestoDa(req), {
      azione: "documento_tipo.ordina",
      entita: "tipo_pratica",
      entitaId: id,
      descrizione: `Riordinati i documenti obbligatori del tipo di pratica "${tipo.nome}"`,
      dettagli: { ordine: ids },
    });
  });
  res.json(await caricaTipoMappato(id));
});

async function caricaDocumento(id: number) {
  const [d] = await db.select().from(documentiTipoTable).where(eq(documentiTipoTable.id, id));
  if (!d) throw nonTrovato("Documento non trovato.");
  return d;
}

router.put("/documenti-tipo/:id", async (req, res) => {
  const { id } = valida(UpdateDocumentoTipoParams, req.params);
  const b = valida(UpdateDocumentoTipoBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome del documento", 100);
  const d = await caricaDocumento(id);
  const tipo = await caricaTipoMappato(d.tipoPraticaId);
  try {
    await db.transaction(async (tx) => {
      await tx.update(documentiTipoTable).set({ nome, mandato: b.mandato }).where(eq(documentiTipoTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "documento_tipo.modifica",
        entita: "documento_tipo",
        entitaId: id,
        descrizione: `Modificato il documento obbligatorio "${d.nome}" del tipo di pratica "${tipo.nome}"${d.nome !== nome ? ` (ora "${nome}")` : ""}${d.mandato !== b.mandato ? `: mandato ${b.mandato ? "sì" : "no"}` : ""}`,
        dettagli: { prima: { nome: d.nome, mandato: d.mandato }, dopo: { nome, mandato: b.mandato } },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DOC_DUPLICATO;
    throw err;
  }
  res.json(await caricaTipoMappato(d.tipoPraticaId));
});

router.delete("/documenti-tipo/:id", async (req, res) => {
  const { id } = valida(DeleteDocumentoTipoParams, req.params);
  const d = await caricaDocumento(id);
  const tipo = await caricaTipoMappato(d.tipoPraticaId);
  await db.transaction(async (tx) => {
    await tx.delete(documentiTipoTable).where(eq(documentiTipoTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "documento_tipo.elimina",
      entita: "documento_tipo",
      entitaId: id,
      descrizione: `Eliminato il documento obbligatorio "${d.nome}" dal tipo di pratica "${tipo.nome}"`,
      dettagli: { nome: d.nome, mandato: d.mandato },
    });
  });
  res.json(await caricaTipoMappato(d.tipoPraticaId));
});

// ---- Moduli scaricabili ----

async function caricaModulo(id: number) {
  const [m] = await db.select().from(moduliTipoTable).where(eq(moduliTipoTable.id, id));
  if (!m) throw nonTrovato("Modulo non trovato.");
  return m;
}

/** Nuovo modulo: corpo = byte del file, nome del modulo in `nome`, nome originale in `nomeFile` (query). */
router.post("/tipi-pratica/:id/moduli/file", corpoFile, async (req, res) => {
  const { id } = valida(GetTipoPraticaParams, req.params);
  const tipo = await caricaTipoMappato(id);
  const file = validaFile(req.query["nomeFile"], req.body);
  const nome = pulisciNome(req.query["nome"] ?? file.nome.replace(/\.[^.]+$/, ""), "Il nome del modulo", 100);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(moduliTipoTable)
        .values({
          tipoPraticaId: id, nome, fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione,
          caricatoDaUtenteId: req.utente!.id,
        })
        .returning({ id: moduliTipoTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "modulo_tipo.carica",
        entita: "modulo_tipo",
        entitaId: m!.id,
        descrizione: `Caricato il modulo "${nome}" (${file.nome}) per il tipo di pratica "${tipo.nome}"`,
        dettagli: { tipoPraticaId: id, nome, fileNome: file.nome, dimensione: file.dimensione },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  res.status(201).json(await caricaTipoMappato(id));
});

router.put("/moduli-tipo/:id/file", corpoFile, async (req, res) => {
  const { id } = valida(DeleteModuloTipoParams, req.params);
  const m = await caricaModulo(id);
  const tipo = await caricaTipoMappato(m.tipoPraticaId);
  const file = validaFile(req.query["nomeFile"], req.body);
  if (m.compilazioneAutomatica) await controllaModuloCompilabile(file.buffer, file.nome);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(moduliTipoTable)
        .set({
          fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione,
          caricatoIl: sql`now()`, caricatoDaUtenteId: req.utente!.id,
        })
        .where(eq(moduliTipoTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "modulo_tipo.sostituisci",
        entita: "modulo_tipo",
        entitaId: id,
        descrizione: `Sostituito il file del modulo "${m.nome}" del tipo di pratica "${tipo.nome}" (${m.fileNome} con ${file.nome})`,
        dettagli: { prima: m.fileNome, dopo: file.nome, dimensione: file.dimensione },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  await eliminaFile(m.fileChiave, req.log);
  res.json(await caricaTipoMappato(m.tipoPraticaId));
});

router.put("/moduli-tipo/:id", async (req, res) => {
  const { id } = valida(RenameModuloTipoParams, req.params);
  const b = valida(RenameModuloTipoBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome del modulo", 100);
  const m = await caricaModulo(id);
  const tipo = await caricaTipoMappato(m.tipoPraticaId);
  const auto = b.compilazioneAutomatica ?? m.compilazioneAutomatica;
  if (auto && !m.compilazioneAutomatica) {
    const { stream } = await leggiFile(m.fileChiave);
    const pezzi: Buffer[] = [];
    for await (const p of stream) pezzi.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
    await controllaModuloCompilabile(Buffer.concat(pezzi), m.fileNome);
  }
  await db.transaction(async (tx) => {
    await tx.update(moduliTipoTable).set({ nome, compilazioneAutomatica: auto }).where(eq(moduliTipoTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "modulo_tipo.rinomina",
      entita: "modulo_tipo",
      entitaId: id,
      descrizione: `Modulo "${m.nome}" del tipo di pratica "${tipo.nome}"${m.nome !== nome ? ` rinominato in "${nome}"` : " modificato"}${
        auto !== m.compilazioneAutomatica ? `: compilazione automatica con i dati dell'assistito ${auto ? "attivata" : "disattivata"}` : ""
      }`,
    });
  });
  res.json(await caricaTipoMappato(m.tipoPraticaId));
});

router.delete("/moduli-tipo/:id", async (req, res) => {
  const { id } = valida(DeleteModuloTipoParams, req.params);
  const m = await caricaModulo(id);
  const tipo = await caricaTipoMappato(m.tipoPraticaId);
  await db.transaction(async (tx) => {
    await tx.delete(moduliTipoTable).where(eq(moduliTipoTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "modulo_tipo.elimina",
      entita: "modulo_tipo",
      entitaId: id,
      descrizione: `Eliminato il modulo "${m.nome}" (${m.fileNome}) dal tipo di pratica "${tipo.nome}"`,
    });
  });
  await eliminaFile(m.fileChiave, req.log);
  res.json(await caricaTipoMappato(m.tipoPraticaId));
});

// ---- Documenti noti (menu a tendina) ----

/** Documenti del catalogo piu' quelli gia' usati nei tipi di pratica, senza doppioni (maiuscole ignorate). */
router.get("/documenti-noti", async (_req, res) => {
  const r = await db.execute<{ nome: string }>(sql`
    select nome from (
      select distinct on (lower(nome)) nome from (
        select nome, 0 as p from documenti_noti
        union all select nome, 1 from documenti_tipo
        union all select nome, 1 from allegati_tipo
      ) t order by lower(nome), p, nome
    ) u order by lower(nome)`);
  res.json(r.rows.map((x) => ({ nome: x.nome })));
});

router.post("/documenti-noti", async (req, res) => {
  const b = valida(CreateDocumentoNotoBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome del documento", 100);
  const esistente = await db.execute<{ nome: string }>(sql`
    select nome from (select nome from documenti_noti union all select nome from documenti_tipo union all select nome from allegati_tipo) t
     where lower(nome) = lower(${nome}) limit 1`);
  if (esistente.rows[0]) return void res.status(201).json({ nome: esistente.rows[0].nome });
  await db.transaction(async (tx) => {
    const [d] = await tx.insert(documentiNotiTable).values({ nome }).returning({ id: documentiNotiTable.id });
    await registraLog(tx, contestoDa(req), {
      azione: "documento_noto.crea",
      entita: "documento_noto",
      entitaId: d!.id,
      descrizione: `Aggiunto "${nome}" all'elenco dei documenti noti`,
    });
  });
  res.status(201).json({ nome });
});

// ---- Compensi per collaboratore ----

router.post("/tipi-pratica/:id/compensi", async (req, res) => {
  const { id } = valida(SaveCompensoCollaboratoreParams, req.params);
  const b = valida(SaveCompensoCollaboratoreBody, req.body);
  const tipo = await caricaTipoMappato(id);
  const [coll] = await db
    .select({ cognome: personeTable.cognome, nome: personeTable.nome, sportello: collaboratoriTable.numeroSportello })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, b.collaboratoreId));
  if (!coll) throw new HttpError(400, "Collaboratore non trovato.", "DATI_NON_VALIDI", "collaboratoreId");
  const valori = importi(b);
  const prima = tipo.compensiCollaboratori.find((c) => c.collaboratoreId === b.collaboratoreId);
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(compensiCollaboratoreTable)
      .values({ tipoPraticaId: id, collaboratoreId: b.collaboratoreId, pagabile: b.pagabile, ...valori })
      .onConflictDoUpdate({
        target: [compensiCollaboratoreTable.tipoPraticaId, compensiCollaboratoreTable.collaboratoreId],
        set: { pagabile: b.pagabile, ...valori },
      })
      .returning({ id: compensiCollaboratoreTable.id });
    await registraLog(tx, contestoDa(req), {
      azione: "compenso_collaboratore.salva",
      entita: "tipo_pratica",
      entitaId: id,
      descrizione: `${prima ? "Modificata" : "Impostata"} l'eccezione di compenso per ${coll.cognome} ${coll.nome} sul tipo di pratica "${tipo.nome}": ${
        b.pagabile ? `pagabile, ${valori.punti} punti, ${euro(valori.valoreCentesimi)} euro` : "non pagabile"
      }`,
      dettagli: { eccezioneId: r!.id, collaboratoreId: b.collaboratoreId, pagabile: b.pagabile, punti: valori.punti, valoreEuro: valori.valoreCentesimi / 100 },
    });
  });
  res.json(await caricaTipoMappato(id));
});

router.delete("/compensi-tipo/:id", async (req, res) => {
  const { id } = valida(DeleteCompensoCollaboratoreParams, req.params);
  const [c] = await db.select().from(compensiCollaboratoreTable).where(eq(compensiCollaboratoreTable.id, id));
  if (!c) throw nonTrovato("Eccezione di compenso non trovata.");
  const tipo = await caricaTipoMappato(c.tipoPraticaId);
  const nomeColl = tipo.compensiCollaboratori.find((x) => x.id === id)?.collaboratoreNome ?? `collaboratore ${c.collaboratoreId}`;
  await db.transaction(async (tx) => {
    await tx.delete(compensiCollaboratoreTable).where(eq(compensiCollaboratoreTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "compenso_collaboratore.elimina",
      entita: "tipo_pratica",
      entitaId: c.tipoPraticaId,
      descrizione: `Tolta l'eccezione di compenso per ${nomeColl} sul tipo di pratica "${tipo.nome}"`,
    });
  });
  res.json(await caricaTipoMappato(c.tipoPraticaId));
});

// ---- Link alle normative ----

function pulisciLink(b: { titolo: string; url: string }) {
  const titolo = pulisciNome(b.titolo, "Il titolo del link", 150);
  const url = b.url.trim();
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    ok = false;
  }
  if (!ok || url.length > 1000) throw new HttpError(400, "Inserisci un indirizzo web valido, che inizi con http:// o https://.", "DATI_NON_VALIDI", "url");
  return { titolo, url };
}

router.post("/tipi-pratica/:id/normative", async (req, res) => {
  const { id } = valida(CreateNormativaTipoParams, req.params);
  const b = valida(CreateNormativaTipoBody, req.body);
  const tipo = await caricaTipoMappato(id);
  const { titolo, url } = pulisciLink(b);
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select({ max: sql<number>`coalesce(max(${normativeTipoTable.ordine}), 0)::int` })
      .from(normativeTipoTable)
      .where(eq(normativeTipoTable.tipoPraticaId, id));
    const [n] = await tx.insert(normativeTipoTable).values({ tipoPraticaId: id, titolo, url, ordine: (m?.max ?? 0) + 1 }).returning({ id: normativeTipoTable.id });
    await registraLog(tx, contestoDa(req), {
      azione: "normativa_tipo.crea",
      entita: "tipo_pratica",
      entitaId: id,
      descrizione: `Aggiunto il link "${titolo}" (${url}) alle normative del tipo di pratica "${tipo.nome}"`,
      dettagli: { normativaId: n!.id, titolo, url },
    });
  });
  res.status(201).json(await caricaTipoMappato(id));
});

router.put("/normative-tipo/:id", async (req, res) => {
  const { id } = valida(UpdateNormativaTipoParams, req.params);
  const b = valida(UpdateNormativaTipoBody, req.body);
  const [n] = await db.select().from(normativeTipoTable).where(eq(normativeTipoTable.id, id));
  if (!n) throw nonTrovato("Link non trovato.");
  const tipo = await caricaTipoMappato(n.tipoPraticaId);
  const { titolo, url } = pulisciLink(b);
  await db.transaction(async (tx) => {
    await tx.update(normativeTipoTable).set({ titolo, url }).where(eq(normativeTipoTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "normativa_tipo.modifica",
      entita: "tipo_pratica",
      entitaId: n.tipoPraticaId,
      descrizione: `Modificato il link "${n.titolo}" delle normative del tipo di pratica "${tipo.nome}"`,
      dettagli: { prima: { titolo: n.titolo, url: n.url }, dopo: { titolo, url } },
    });
  });
  res.json(await caricaTipoMappato(n.tipoPraticaId));
});

router.delete("/normative-tipo/:id", async (req, res) => {
  const { id } = valida(DeleteNormativaTipoParams, req.params);
  const [n] = await db.select().from(normativeTipoTable).where(eq(normativeTipoTable.id, id));
  if (!n) throw nonTrovato("Link non trovato.");
  const tipo = await caricaTipoMappato(n.tipoPraticaId);
  await db.transaction(async (tx) => {
    await tx.delete(normativeTipoTable).where(eq(normativeTipoTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "normativa_tipo.elimina",
      entita: "tipo_pratica",
      entitaId: n.tipoPraticaId,
      descrizione: `Eliminato il link "${n.titolo}" dalle normative del tipo di pratica "${tipo.nome}"`,
    });
  });
  res.json(await caricaTipoMappato(n.tipoPraticaId));
});

// ---- Allegati dell'operatore ----

router.post("/tipi-pratica/:id/allegati-operatore", async (req, res) => {
  const { id } = valida(CreateAllegatoTipoParams, req.params);
  const b = valida(CreateAllegatoTipoBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome del documento", 100);
  if (nome.toLowerCase() === "altro") {
    throw new HttpError(400, "La voce «Altro» è sempre presente: non serve aggiungerla.", "DATI_NON_VALIDI", "nome");
  }
  const tipo = await caricaTipoMappato(id);
  try {
    await db.transaction(async (tx) => {
      const [m] = await tx
        .select({ max: sql<number>`coalesce(max(${allegatiTipoTable.ordine}), 0)::int` })
        .from(allegatiTipoTable)
        .where(eq(allegatiTipoTable.tipoPraticaId, id));
      const [a] = await tx.insert(allegatiTipoTable).values({ tipoPraticaId: id, nome, ordine: (m?.max ?? 0) + 1 }).returning({ id: allegatiTipoTable.id });
      await tx.insert(documentiNotiTable).values({ nome }).onConflictDoNothing();
      await registraLog(tx, contestoDa(req), {
        azione: "allegato_tipo.crea",
        entita: "tipo_pratica",
        entitaId: id,
        descrizione: `Aggiunto "${nome}" agli allegati dell'operatore del tipo di pratica "${tipo.nome}"`,
        dettagli: { allegatoTipoId: a!.id, nome },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw new HttpError(409, "Questo documento è già nell'elenco degli allegati dell'operatore.", "NOME_DUPLICATO", "nome");
    throw err;
  }
  res.status(201).json(await caricaTipoMappato(id));
});

router.delete("/allegati-tipo/:id", async (req, res) => {
  const { id } = valida(DeleteAllegatoTipoParams, req.params);
  const [a] = await db.select().from(allegatiTipoTable).where(eq(allegatiTipoTable.id, id));
  if (!a) throw nonTrovato("Documento non trovato.");
  const tipo = await caricaTipoMappato(a.tipoPraticaId);
  await db.transaction(async (tx) => {
    await tx.delete(allegatiTipoTable).where(eq(allegatiTipoTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "allegato_tipo.elimina",
      entita: "tipo_pratica",
      entitaId: a.tipoPraticaId,
      descrizione: `Tolto "${a.nome}" dagli allegati dell'operatore del tipo di pratica "${tipo.nome}"`,
    });
  });
  res.json(await caricaTipoMappato(a.tipoPraticaId));
});

export default router;
