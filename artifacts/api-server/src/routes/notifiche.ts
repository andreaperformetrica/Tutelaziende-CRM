import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { ListNotificheQueryParams, UpdateImpostazioniNotificheBody } from "@workspace/api-zod";
import { db, notificheTable } from "@workspace/db";
import { HttpError } from "../lib/errori";
import { baseUrlPiattaforma, ESITI_NOTIFICA, EVENTI_NOTIFICA, normalizzaUrlPiattaforma, salvaUrlPiattaforma, statoCanali } from "../lib/notifiche";
import { contestoDa, registraLog } from "../lib/log";
import { impostazioniTable } from "@workspace/db";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/notifiche", richiediRuolo("super_admin", "admin"));

function controllaData(valore: string | undefined, campo: string): string | undefined {
  if (!valore) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore) || Number.isNaN(Date.parse(valore))) {
    throw new HttpError(400, "Data non valida (formato AAAA-MM-GG).", "DATA_NON_VALIDA", campo);
  }
  return valore;
}

const etichetta = <T extends Record<string, string>>(mappa: T, codice: string) => (mappa as Record<string, string>)[codice] ?? codice;

router.get("/notifiche/stato", (_req, res) => {
  const s = statoCanali();
  res.json({
    email: s.email,
    whatsapp: s.whatsapp,
    chiamata: s.chiamata,
    eventi: Object.entries(EVENTI_NOTIFICA).map(([codice, e]) => ({ codice, etichetta: e })),
    esiti: Object.entries(ESITI_NOTIFICA).map(([codice, e]) => ({ codice, etichetta: e })),
  });
});

async function impostazioni() {
  const [r] = await db.select({ valore: impostazioniTable.valore }).from(impostazioniTable).where(eq(impostazioniTable.chiave, "url_piattaforma"));
  const effettivo = await baseUrlPiattaforma();
  return { urlPiattaforma: r?.valore ?? null, urlEffettivo: effettivo.url, origine: effettivo.origine };
}

router.get("/notifiche/impostazioni", async (_req, res) => {
  res.json(await impostazioni());
});

router.put("/notifiche/impostazioni", async (req, res) => {
  const b = valida(UpdateImpostazioniNotificheBody, req.body);
  const grezzo = b.urlPiattaforma?.trim() ?? "";
  let url: string | null = null;
  if (grezzo) {
    const n = normalizzaUrlPiattaforma(grezzo);
    if ("errore" in n) throw new HttpError(400, n.errore, "DATI_NON_VALIDI", "urlPiattaforma");
    url = n.url;
  }
  await db.transaction(async (tx) => {
    await salvaUrlPiattaforma(tx, url);
    await registraLog(tx, contestoDa(req), {
      azione: "notifiche.indirizzo_app",
      entita: "impostazione",
      descrizione: url ? `Indirizzo dell'app nei link delle email impostato a ${url}` : "Indirizzo dell'app nei link delle email riportato su quello automatico",
      dettagli: { url },
    });
  });
  res.json(await impostazioni());
});

router.get("/notifiche", async (req, res) => {
  const p = valida(ListNotificheQueryParams, req.query);
  const da = controllaData(p.da, "da");
  const a = controllaData(p.a, "a");
  const pagina = p.pagina ?? 1;
  const perPagina = p.perPagina ?? 50;
  const where = and(
    p.canale ? eq(notificheTable.canale, p.canale) : undefined,
    p.esito ? eq(notificheTable.esito, p.esito) : undefined,
    p.evento ? eq(notificheTable.evento, p.evento) : undefined,
    da ? gte(notificheTable.creatoIl, sql`(${da}::date)::timestamp AT TIME ZONE 'Europe/Rome'`) : undefined,
    a ? lt(notificheTable.creatoIl, sql`((${a}::date + 1))::timestamp AT TIME ZONE 'Europe/Rome'`) : undefined,
  );
  const [totale] = await db.select({ n: count() }).from(notificheTable).where(where);
  const righe = await db
    .select()
    .from(notificheTable)
    .where(where)
    .orderBy(desc(notificheTable.creatoIl), desc(notificheTable.id))
    .limit(perPagina)
    .offset((pagina - 1) * perPagina);
  res.json({
    righe: righe.map((n) => ({
      id: n.id,
      creatoIl: n.creatoIl.toISOString(),
      elaboratoIl: n.elaboratoIl?.toISOString() ?? null,
      evento: n.evento,
      eventoEtichetta: etichetta(EVENTI_NOTIFICA, n.evento),
      canale: n.canale,
      destinatarioNome: n.destinatarioNome,
      destinatarioContatto: n.destinatarioContatto,
      praticaId: n.praticaId,
      numeroPratica: n.numeroPratica,
      oggetto: n.oggetto,
      testo: n.testo,
      esito: n.esito,
      esitoEtichetta: etichetta(ESITI_NOTIFICA, n.esito),
      dettaglioEsito: n.dettaglioEsito,
    })),
    totale: totale?.n ?? 0,
    pagina,
    perPagina,
  });
});

export default router;
