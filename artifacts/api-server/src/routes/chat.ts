/**
 * Chat interna del back office: canale generale e messaggi diretti tra utenti interni.
 * Solo super admin, admin e operatori: i collaboratori non vi accedono mai. Nel log non finisce il testo dei messaggi.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { SegnaLettaChatBody, SendMessaggioChatBody } from "@workspace/api-zod";
import { chatLettureTable, chatMessaggiTable, db, utentiTable } from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/backoffice/chat", richiediRuolo("super_admin", "admin", "operatore"));

const MAX_MESSAGGIO = 2000;
const colonneUtente = { id: utentiTable.id, nome: utentiTable.nome, cognome: utentiTable.cognome, ruolo: utentiTable.ruolo, colore: utentiTable.colore };
type RigaUtente = { id: number; nome: string; cognome: string; ruolo: string; colore: string | null };
const utenteChat = (u: RigaUtente) => ({ id: u.id, nome: u.nome, cognome: u.cognome, ruolo: u.ruolo, colore: u.colore });

type Conversazione = { tipo: "generale" } | { tipo: "diretta"; altroId: number };

/** "generale" oppure "u" + id di un altro utente interno attivo. */
async function leggiChiave(chiave: string, io: number): Promise<Conversazione> {
  if (chiave === "generale") return { tipo: "generale" };
  const m = /^u(\d{1,9})$/.exec(chiave);
  if (!m) throw nonTrovato("Conversazione non trovata.");
  const altroId = Number(m[1]);
  if (altroId === io) throw new HttpError(400, "Non puoi scrivere a te stesso.", "DATI_NON_VALIDI", "chiave");
  const [u] = await db.select({ id: utentiTable.id }).from(utentiTable).where(and(eq(utentiTable.id, altroId), eq(utentiTable.attivo, true), ne(utentiTable.ruolo, "collaboratore")));
  if (!u) throw nonTrovato("Conversazione non trovata.");
  return { tipo: "diretta", altroId };
}

/** Messaggi non letti per conversazione: la chiave e' "generale" oppure "u<id mittente>". */
async function nonLettiPerConversazione(io: number): Promise<Map<string, number>> {
  const mappa = new Map<string, number>();
  const generale = await db.execute(sql`
    select count(*)::int as n
    from chat_messaggi m
    join utenti me on me.id = ${io}
    left join chat_letture l on l.utente_id = ${io} and l.conversazione = 'generale'
    where m.destinatario_utente_id is null and m.mittente_utente_id <> ${io}
      and m.creato_il >= me.creato_il and m.id > coalesce(l.ultimo_messaggio_id, 0)`);
  const n = Number((generale.rows[0] as { n: number } | undefined)?.n ?? 0);
  if (n > 0) mappa.set("generale", n);
  const dirette = await db.execute(sql`
    select m.mittente_utente_id as altro, count(*)::int as n
    from chat_messaggi m
    left join chat_letture l on l.utente_id = ${io} and l.conversazione = 'u' || m.mittente_utente_id
    where m.destinatario_utente_id = ${io} and m.id > coalesce(l.ultimo_messaggio_id, 0)
    group by m.mittente_utente_id`);
  for (const r of dirette.rows as { altro: number; n: number }[]) mappa.set(`u${r.altro}`, Number(r.n));
  return mappa;
}

router.get("/backoffice/chat/non-letti", async (req, res) => {
  const mappa = await nonLettiPerConversazione(req.utente!.id);
  res.json({ totale: [...mappa.values()].reduce((a, b) => a + b, 0) });
});

router.get("/backoffice/chat/conversazioni", async (req, res) => {
  const io = req.utente!.id;
  const persone = await db
    .select(colonneUtente)
    .from(utentiTable)
    .where(and(eq(utentiTable.attivo, true), ne(utentiTable.ruolo, "collaboratore"), ne(utentiTable.id, io)));
  const nonLetti = await nonLettiPerConversazione(io);
  const ultimi = await db.execute(sql`
    select distinct on (conv) conv, testo, creato_il, mio from (
      select case when m.destinatario_utente_id is null then 'generale'
                  when m.mittente_utente_id = ${io} then 'u' || m.destinatario_utente_id
                  else 'u' || m.mittente_utente_id end as conv,
             m.id, m.testo, m.creato_il, (m.mittente_utente_id = ${io}) as mio
      from chat_messaggi m
      where m.destinatario_utente_id is null or m.mittente_utente_id = ${io} or m.destinatario_utente_id = ${io}
      order by m.id desc
    ) x order by conv, id desc`);
  const ultimoDi = new Map((ultimi.rows as { conv: string; testo: string; creato_il: Date | string; mio: boolean }[]).map((r) => [r.conv, r]));
  const ultimoMessaggio = (chiave: string) => {
    const u = ultimoDi.get(chiave);
    return u ? { testo: u.testo.length > 120 ? `${u.testo.slice(0, 117)}...` : u.testo, creatoIl: new Date(u.creato_il).toISOString(), mio: u.mio } : null;
  };
  const dirette = persone
    .map((u) => ({ chiave: `u${u.id}`, tipo: "diretta" as const, utente: utenteChat(u), nonLetti: nonLetti.get(`u${u.id}`) ?? 0, ultimoMessaggio: ultimoMessaggio(`u${u.id}`) }))
    .sort((a, b) => {
      const ta = a.ultimoMessaggio?.creatoIl ?? "";
      const tb = b.ultimoMessaggio?.creatoIl ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return `${a.utente.cognome} ${a.utente.nome}`.localeCompare(`${b.utente.cognome} ${b.utente.nome}`, "it");
    });
  res.json([{ chiave: "generale", tipo: "generale" as const, utente: null, nonLetti: nonLetti.get("generale") ?? 0, ultimoMessaggio: ultimoMessaggio("generale") }, ...dirette]);
});

router.get("/backoffice/chat/conversazioni/:chiave/messaggi", async (req, res) => {
  const io = req.utente!.id;
  const conv = await leggiChiave(String(req.params.chiave), io);
  const dove =
    conv.tipo === "generale"
      ? isNull(chatMessaggiTable.destinatarioUtenteId)
      : or(
          and(eq(chatMessaggiTable.mittenteUtenteId, io), eq(chatMessaggiTable.destinatarioUtenteId, conv.altroId)),
          and(eq(chatMessaggiTable.mittenteUtenteId, conv.altroId), eq(chatMessaggiTable.destinatarioUtenteId, io)),
        );
  const righe = await db
    .select({ id: chatMessaggiTable.id, testo: chatMessaggiTable.testo, creatoIl: chatMessaggiTable.creatoIl, mittente: colonneUtente })
    .from(chatMessaggiTable)
    .innerJoin(utentiTable, eq(utentiTable.id, chatMessaggiTable.mittenteUtenteId))
    .where(dove)
    .orderBy(desc(chatMessaggiTable.id))
    .limit(200);
  res.json(righe.reverse().map((r) => ({ id: r.id, mittente: utenteChat(r.mittente), testo: r.testo, creatoIl: r.creatoIl.toISOString(), mio: r.mittente.id === io })));
});

router.post("/backoffice/chat/conversazioni/:chiave/messaggi", async (req, res) => {
  const io = req.utente!.id;
  const conv = await leggiChiave(String(req.params.chiave), io);
  const b = valida(SendMessaggioChatBody, req.body);
  const testo = b.testo.replace(/\r\n/g, "\n").trim();
  if (!testo) throw new HttpError(400, "Scrivi un messaggio.", "DATI_NON_VALIDI", "testo");
  if (testo.length > MAX_MESSAGGIO) throw new HttpError(400, `Il messaggio può avere al massimo ${MAX_MESSAGGIO} caratteri.`, "DATI_NON_VALIDI", "testo");
  const nuovo = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(chatMessaggiTable)
      .values({ mittenteUtenteId: io, destinatarioUtenteId: conv.tipo === "diretta" ? conv.altroId : null, testo })
      .returning();
    // Quello che scrivo lo considero letto.
    await tx
      .insert(chatLettureTable)
      .values({ utenteId: io, conversazione: conv.tipo === "generale" ? "generale" : `u${conv.altroId}`, ultimoMessaggioId: m!.id })
      .onConflictDoUpdate({ target: [chatLettureTable.utenteId, chatLettureTable.conversazione], set: { ultimoMessaggioId: sql`greatest(${chatLettureTable.ultimoMessaggioId}, ${m!.id})` } });
    await registraLog(tx, contestoDa(req), {
      azione: "chat.messaggio",
      entita: "chat",
      entitaId: m!.id,
      descrizione: conv.tipo === "generale" ? "Messaggio nel canale generale della chat interna" : "Messaggio diretto nella chat interna",
      dettagli: { conversazione: conv.tipo === "generale" ? "generale" : `u${conv.altroId}` },
    });
    return m!;
  });
  const [mittente] = await db.select(colonneUtente).from(utentiTable).where(eq(utentiTable.id, io));
  res.status(201).json({ id: nuovo.id, mittente: utenteChat(mittente!), testo: nuovo.testo, creatoIl: nuovo.creatoIl.toISOString(), mio: true });
});

router.post("/backoffice/chat/conversazioni/:chiave/letti", async (req, res) => {
  const io = req.utente!.id;
  const conv = await leggiChiave(String(req.params.chiave), io);
  const b = valida(SegnaLettaChatBody, req.body);
  await db
    .insert(chatLettureTable)
    .values({ utenteId: io, conversazione: conv.tipo === "generale" ? "generale" : `u${conv.altroId}`, ultimoMessaggioId: b.fino })
    .onConflictDoUpdate({ target: [chatLettureTable.utenteId, chatLettureTable.conversazione], set: { ultimoMessaggioId: sql`greatest(${chatLettureTable.ultimoMessaggioId}, ${b.fino})` } });
  res.status(204).end();
});

export default router;
