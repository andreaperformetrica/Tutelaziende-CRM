/**
 * Servizio notifiche unico, con due canali: email (Resend) e WhatsApp (Twilio, template approvati).
 *
 * Ogni notifica e' una riga del registro (`notifiche`). La riga nasce "in_coda" nella stessa transazione
 * dell'operazione che la genera (`accodaNotifiche`) e viene recapitata dopo il commit (`recapitaNotifiche`),
 * senza mai far fallire l'operazione principale. Se le chiavi del servizio mancano il messaggio viene
 * registrato con esito "non_inviata", cosi' si puo' provare tutto senza inviare nulla.
 *
 * Variabili d'ambiente (Secrets):
 *  - email:    RESEND_API_KEY, NOTIFICHE_EMAIL_MITTENTE (es. "Tutela <notifiche@tuodominio.it>")
 *  - WhatsApp: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_DA (numero mittente),
 *              TWILIO_WHATSAPP_TEMPLATE_SID (Content SID del template approvato)
 *  - link:     URL_PIATTAFORMA (indirizzo pubblico della piattaforma; in sviluppo si usa il dominio dell'ambiente)
 */
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, notificheTable, type NotificaRow } from "@workspace/db";
import type { Executor } from "./log";
import { logger } from "./logger";

export type CanaleNotifica = "email" | "whatsapp";

export const EVENTI_NOTIFICA = {
  pratica_inviata_sede: "Pratica inviata (alla sede)",
  pratica_inviata_backoffice: "Pratica inviata (al back office)",
  commento_ufficio: "Commento dell'ufficio (alla sede)",
  risposta_sede: "Risposta della sede (all'operatore)",
  assistito_duplicato: "Anagrafica già registrata (agli admin)",
} as const;
export type EventoNotifica = keyof typeof EVENTI_NOTIFICA;

export const ESITI_NOTIFICA = {
  in_coda: "In coda",
  inviata: "Inviata",
  non_inviata: "Registrata, non inviata",
  errore: "Errore",
} as const;

/**
 * Testo del template WhatsApp approvato, usato quando il messaggio viene solo registrato.
 * Il template vero sta in Twilio con le variabili {{1}} nome, {{2}} numero pratica, {{3}} link.
 * Mai tipo di pratica ne' dati dell'assistito.
 */
export const TESTO_TEMPLATE_WHATSAPP = "Buongiorno {{nome}}, c'è un aggiornamento sulla pratica n. {{numero}}. Accedi alla piattaforma: {{link}}";

const TIMEOUT_MS = 10_000;

export interface DestinatarioNotifica {
  utenteId: number | null;
  nome: string;
  email: string | null;
  cellulare: string | null;
}

export interface RichiestaNotifica {
  evento: EventoNotifica;
  destinatari: DestinatarioNotifica[];
  canali: CanaleNotifica[];
  pratica?: { id: number; numero: number };
  /** Percorso della piattaforma a cui punta il link (es. /admin/pratiche/3). */
  percorso: string;
  oggetto: string;
  /** Testo dell'email: deve contenere solo informazioni non sensibili (mai tipo di pratica o dati dell'assistito). */
  testoEmail: (destinatario: DestinatarioNotifica, link: string) => string;
}

// ---------------------------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------------------------

const valore = (nome: string): string | null => {
  const v = process.env[nome]?.trim();
  return v ? v : null;
};

const CHIAVI_EMAIL = ["RESEND_API_KEY", "NOTIFICHE_EMAIL_MITTENTE"] as const;
const CHIAVI_WHATSAPP = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_DA", "TWILIO_WHATSAPP_TEMPLATE_SID"] as const;

export function statoCanali(): Record<CanaleNotifica, { attivo: boolean; mancanti: string[] }> {
  const mancanti = (chiavi: readonly string[]) => chiavi.filter((k) => !valore(k));
  const e = mancanti(CHIAVI_EMAIL);
  const w = mancanti(CHIAVI_WHATSAPP);
  return { email: { attivo: e.length === 0, mancanti: e }, whatsapp: { attivo: w.length === 0, mancanti: w } };
}

export function urlPiattaforma(percorso = "/"): string {
  const configurato = valore("URL_PIATTAFORMA");
  const dominio = valore("REPLIT_DEV_DOMAIN") ?? valore("REPLIT_DOMAINS")?.split(",")[0];
  const base = (configurato ?? (dominio ? `https://${dominio}` : "http://localhost")).replace(/\/+$/, "");
  return `${base}${percorso.startsWith("/") ? percorso : `/${percorso}`}`;
}

// ---------------------------------------------------------------------------------------------
// Coda (nella transazione dell'operazione)
// ---------------------------------------------------------------------------------------------

const MOTIVO_SENZA_RECAPITO = { email: "Il destinatario non ha un indirizzo email.", whatsapp: "Il destinatario non ha un numero di cellulare." } as const;

/** Scrive le righe del registro. Restituisce gli id da passare a `recapitaNotifiche` dopo il commit. */
export async function accodaNotifiche(executor: Executor, r: RichiestaNotifica): Promise<number[]> {
  const link = urlPiattaforma(r.percorso);
  const righe: (typeof notificheTable.$inferInsert)[] = [];
  for (const d of r.destinatari) {
    for (const canale of r.canali) {
      const base = {
        evento: r.evento,
        canale,
        destinatarioUtenteId: d.utenteId,
        destinatarioNome: d.nome,
        praticaId: r.pratica?.id ?? null,
        numeroPratica: r.pratica?.numero ?? null,
      };
      const contatto = canale === "email" ? d.email : d.cellulare;
      if (canale === "whatsapp" && !r.pratica) continue; // il template WhatsApp parla sempre di una pratica
      const variabili = canale === "whatsapp" ? { nome: d.nome, numero: String(r.pratica!.numero), link } : null;
      const testo = canale === "email" ? r.testoEmail(d, link) : riempiTemplate(variabili!);
      righe.push({
        ...base,
        destinatarioContatto: contatto ?? "—",
        oggetto: canale === "email" ? r.oggetto : null,
        testo,
        variabili,
        ...(contatto ? {} : { esito: "non_inviata" as const, elaboratoIl: new Date(), dettaglioEsito: MOTIVO_SENZA_RECAPITO[canale] }),
      });
    }
  }
  if (righe.length === 0) return [];
  const inserite = await executor.insert(notificheTable).values(righe).returning({ id: notificheTable.id, esito: notificheTable.esito });
  return inserite.filter((x) => x.esito === "in_coda").map((x) => x.id);
}

function riempiTemplate(v: Record<string, string>): string {
  return TESTO_TEMPLATE_WHATSAPP.replace(/\{\{(\w+)\}\}/g, (_, k: string) => v[k] ?? "");
}

// ---------------------------------------------------------------------------------------------
// Recapito (dopo il commit)
// ---------------------------------------------------------------------------------------------

interface EsitoInvio {
  esito: "inviata" | "non_inviata" | "errore";
  dettaglio: string | null;
  idEsterno?: string | null;
}

const troncato = (s: string) => (s.length > 300 ? `${s.slice(0, 297)}...` : s);

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function htmlDaTesto(testo: string): string {
  const corpo = escapeHtml(testo)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1c1c1c">${corpo}</div>`;
}

async function leggiErrore(risposta: Response): Promise<string> {
  try {
    const j = (await risposta.json()) as { message?: string; error?: string };
    return troncato(`${risposta.status} ${j.message ?? j.error ?? ""}`.trim());
  } catch {
    return `${risposta.status}`;
  }
}

async function inviaEmail(n: NotificaRow): Promise<EsitoInvio> {
  const { attivo, mancanti } = statoCanali().email;
  if (!attivo) return { esito: "non_inviata", dettaglio: `Chiavi email mancanti: ${mancanti.join(", ")}.` };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${valore("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: valore("NOTIFICHE_EMAIL_MITTENTE"), to: [n.destinatarioContatto], subject: n.oggetto ?? "Aggiornamento", text: n.testo, html: htmlDaTesto(n.testo) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) return { esito: "errore", dettaglio: await leggiErrore(r) };
  const j = (await r.json().catch(() => ({}))) as { id?: string };
  return { esito: "inviata", dettaglio: null, idEsterno: j.id ?? null };
}

const comeWhatsapp = (numero: string) => (numero.startsWith("whatsapp:") ? numero : `whatsapp:${numero}`);

async function inviaWhatsapp(n: NotificaRow): Promise<EsitoInvio> {
  const { attivo, mancanti } = statoCanali().whatsapp;
  if (!attivo) return { esito: "non_inviata", dettaglio: `Chiavi WhatsApp mancanti: ${mancanti.join(", ")}.` };
  const v = n.variabili ?? {};
  const sid = valore("TWILIO_ACCOUNT_SID")!;
  const corpo = new URLSearchParams({
    From: comeWhatsapp(valore("TWILIO_WHATSAPP_DA")!),
    To: comeWhatsapp(n.destinatarioContatto),
    ContentSid: valore("TWILIO_WHATSAPP_TEMPLATE_SID")!,
    // Variabili del template approvato: 1 = nome, 2 = numero pratica, 3 = link alla piattaforma.
    ContentVariables: JSON.stringify({ "1": v["nome"] ?? "", "2": v["numero"] ?? "", "3": v["link"] ?? "" }),
  });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${valore("TWILIO_AUTH_TOKEN")}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: corpo,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) return { esito: "errore", dettaglio: await leggiErrore(r) };
  const j = (await r.json().catch(() => ({}))) as { sid?: string };
  return { esito: "inviata", dettaglio: null, idEsterno: j.sid ?? null };
}

/** Recapita le notifiche in coda. Non lancia mai errori: l'esito di ognuna finisce nel registro. */
export async function recapitaNotifiche(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    // "Prenota" le righe: se partono due recapiti insieme, ognuna viene inviata una volta sola.
    const righe = await db
      .update(notificheTable)
      .set({ elaboratoIl: new Date() })
      .where(and(inArray(notificheTable.id, ids), eq(notificheTable.esito, "in_coda"), isNull(notificheTable.elaboratoIl)))
      .returning();
    for (const n of righe) {
      let e: EsitoInvio;
      try {
        e = n.canale === "email" ? await inviaEmail(n) : await inviaWhatsapp(n);
      } catch (err) {
        e = { esito: "errore", dettaglio: troncato(err instanceof Error ? err.message : "Errore di rete") };
      }
      if (e.esito === "errore") logger.warn({ notificaId: n.id, canale: n.canale, dettaglio: e.dettaglio }, "Notifica non inviata");
      else logger.info({ notificaId: n.id, canale: n.canale, evento: n.evento, esito: e.esito }, "Notifica elaborata");
      await db
        .update(notificheTable)
        .set({ esito: e.esito, dettaglioEsito: e.dettaglio, idEsterno: e.idEsterno ?? null, elaboratoIl: new Date() })
        .where(eq(notificheTable.id, n.id));
    }
  } catch (err) {
    logger.error({ err }, "Errore nel recapito delle notifiche");
  }
}

/** Avvia il recapito senza far attendere la risposta HTTP. */
export function recapitaInBackground(ids: number[]): void {
  void recapitaNotifiche(ids);
}

/** All'avvio: recapita le notifiche rimaste in coda (ad esempio se il server si e' fermato prima dell'invio). */
export async function recapitaNotificheRimaste(): Promise<number> {
  const rimaste = await db
    .select({ id: notificheTable.id })
    .from(notificheTable)
    .where(and(eq(notificheTable.esito, "in_coda"), isNull(notificheTable.elaboratoIl), lt(notificheTable.creatoIl, sql`now() - interval '1 minute'`)));
  await recapitaNotifiche(rimaste.map((x) => x.id));
  return rimaste.length;
}
