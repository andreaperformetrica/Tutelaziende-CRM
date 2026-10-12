import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { ListLogOperazioniQueryParams } from "@workspace/api-zod";
import { db, logOperazioniTable, utentiTable } from "@workspace/db";
import { HttpError } from "../lib/errori";
import { AZIONI_LOG, etichettaAzione } from "../lib/log";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/log-operazioni", richiediRuolo("super_admin", "admin"));

function controllaData(valore: string | undefined, campo: string): string | undefined {
  if (!valore) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore) || Number.isNaN(Date.parse(valore))) {
    throw new HttpError(400, "Data non valida (formato AAAA-MM-GG).", "DATA_NON_VALIDA", campo);
  }
  return valore;
}

router.get("/log-operazioni", async (req, res) => {
  const p = valida(ListLogOperazioniQueryParams, req.query);
  const da = controllaData(p.da, "da");
  const a = controllaData(p.a, "a");
  const pagina = p.pagina ?? 1;
  const perPagina = p.perPagina ?? 50;

  const condizioni = [
    p.utenteId !== undefined ? eq(logOperazioniTable.utenteId, p.utenteId) : undefined,
    p.azione ? eq(logOperazioniTable.azione, p.azione) : undefined,
    // Gli estremi dell'intervallo sono giorni di calendario in Europe/Rome.
    da ? gte(logOperazioniTable.creatoIl, sql`(${da}::date)::timestamp AT TIME ZONE 'Europe/Rome'`) : undefined,
    a ? lt(logOperazioniTable.creatoIl, sql`((${a}::date + 1))::timestamp AT TIME ZONE 'Europe/Rome'`) : undefined,
  ];
  const where = and(...condizioni);

  const [totale] = await db.select({ n: count() }).from(logOperazioniTable).where(where);
  const righe = await db
    .select({ riga: logOperazioniTable, colore: utentiTable.colore })
    .from(logOperazioniTable)
    .leftJoin(utentiTable, eq(utentiTable.id, logOperazioniTable.utenteId))
    .where(where)
    .orderBy(desc(logOperazioniTable.creatoIl), desc(logOperazioniTable.id))
    .limit(perPagina)
    .offset((pagina - 1) * perPagina);

  res.json({
    righe: righe.map(({ riga: r, colore }) => ({
      id: r.id,
      creatoIl: r.creatoIl.toISOString(),
      utenteId: r.utenteId,
      utenteNome: r.utenteNome,
      utenteColore: colore,
      ruolo: r.ruolo,
      azione: r.azione,
      azioneEtichetta: etichettaAzione(r.azione),
      entita: r.entita,
      entitaId: r.entitaId,
      descrizione: r.descrizione,
      ip: r.ip,
    })),
    totale: totale?.n ?? 0,
    pagina,
    perPagina,
  });
});

router.get("/log-operazioni/filtri", async (_req, res) => {
  const utenti = await db
    .select({ id: utentiTable.id, nome: utentiTable.nome, cognome: utentiTable.cognome, ruolo: utentiTable.ruolo })
    .from(utentiTable)
    .orderBy(utentiTable.cognome, utentiTable.nome);
  res.json({
    utenti: utenti.map((u) => ({ id: u.id, nome: `${u.cognome} ${u.nome}`, ruolo: u.ruolo })),
    azioni: Object.entries(AZIONI_LOG).map(([codice, etichetta]) => ({ codice, etichetta })),
  });
});

export default router;
