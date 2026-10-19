/**
 * Firma del mandato con codice monouso (OTP) inviato per SMS al cellulare del collaboratore.
 *
 * Chiavi per l'invio SMS (Twilio): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_SMS_DA (numero o nome mittente).
 * Senza queste chiavi il codice non parte: viene scritto nel log del server (solo per prove in sviluppo).
 * Del codice si conserva solo l'impronta (HMAC con SESSION_SECRET); vale 10 minuti e 5 tentativi.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { Request } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { collaboratoriTable, db, mandatiFirmeTable, mandatiOtpTable, personeTable } from "@workspace/db";
import { HttpError } from "./errori";
import { logger } from "./logger";
import { contestoDa, registraLog } from "./log";
import { mandatoCompilatoPdf } from "./mandato-compilato";
import { firmaDellaPratica, mappaFirma } from "./mandati-sede";
import { caricaPraticaPropria, mandatoDellaPratica, type RigaPratica } from "./pratiche";
import { eliminaFile, leggiFile, salvaFile } from "./storage";

const VALIDITA_MS = 10 * 60 * 1000;
const ATTESA_NUOVO_CODICE_MS = 30 * 1000;
const TENTATIVI_MASSIMI = 5;

const valore = (n: string) => process.env[n]?.trim() || null;

const impronta = (codice: string, otpPratica: number) =>
  createHmac("sha256", process.env["SESSION_SECRET"] ?? "").update(`${otpPratica}:${codice}`).digest("hex");

/** +39 333 1234567 -> +39 33•••••67 */
export function cellulareMascherato(n: string): string {
  return n.length <= 6 ? n : `${n.slice(0, 5)}${"•".repeat(Math.max(n.length - 7, 1))}${n.slice(-2)}`;
}

async function firmatario(req: Request) {
  const [c] = await db
    .select({ id: collaboratoriTable.id, nome: personeTable.nome, cognome: personeTable.cognome, cf: personeTable.codiceFiscale, cellulare: personeTable.cellulare })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, req.utente!.collaboratoreId ?? -1));
  if (!c) throw new HttpError(403, "Solo un collaboratore può firmare il mandato.", "NON_AUTORIZZATO");
  return c;
}

async function inviaSms(a: string, testo: string): Promise<boolean> {
  const sid = valore("TWILIO_ACCOUNT_SID");
  const token = valore("TWILIO_AUTH_TOKEN");
  const da = valore("TWILIO_SMS_DA");
  if (!sid || !token || !da) return false;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: da, To: a, Body: testo }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    logger.error({ stato: r.status }, "Invio SMS del codice di firma non riuscito");
    throw new HttpError(502, "Non è stato possibile inviare l'SMS con il codice. Riprova tra poco.", "SMS_NON_INVIATO");
  }
  return true;
}

async function controllaFirmabile(p: RigaPratica) {
  if (await firmaDellaPratica(p.id)) throw new HttpError(409, "Il mandato di questa pratica è già stato firmato.", "MANDATO_GIA_FIRMATO");
  const mandato = await mandatoDellaPratica(p);
  if (!mandato) throw new HttpError(409, "Per questa pratica non c'è un mandato da firmare: contatta l'amministrazione.", "MANDATO_MANCANTE");
  return mandato;
}

export async function richiediFirma(req: Request, praticaId: number) {
  const p = await caricaPraticaPropria(req, praticaId);
  await controllaFirmabile(p);
  const f = await firmatario(req);
  const ora = new Date();
  const [ultimo] = await db
    .select({ creatoIl: mandatiOtpTable.creatoIl })
    .from(mandatiOtpTable)
    .where(and(eq(mandatiOtpTable.praticaId, praticaId), eq(mandatiOtpTable.utenteId, req.utente!.id)))
    .orderBy(desc(mandatiOtpTable.id))
    .limit(1);
  if (ultimo && ora.getTime() - ultimo.creatoIl.getTime() < ATTESA_NUOVO_CODICE_MS) {
    throw new HttpError(429, "Hai appena richiesto un codice: attendi qualche secondo prima di chiederne un altro.", "TROPPE_RICHIESTE");
  }
  const codice = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const scadeIl = new Date(ora.getTime() + VALIDITA_MS);
  const otp = await db.transaction(async (tx) => {
    // Un solo codice valido per volta: i precedenti non servono piu'.
    await tx
      .update(mandatiOtpTable)
      .set({ usatoIl: ora })
      .where(and(eq(mandatiOtpTable.praticaId, praticaId), eq(mandatiOtpTable.utenteId, req.utente!.id), isNull(mandatiOtpTable.usatoIl)));
    const [r] = await tx
      .insert(mandatiOtpTable)
      .values({ praticaId, utenteId: req.utente!.id, codiceHash: "", cellulare: f.cellulare, scadeIl })
      .returning({ id: mandatiOtpTable.id });
    await tx.update(mandatiOtpTable).set({ codiceHash: impronta(codice, r!.id) }).where(eq(mandatiOtpTable.id, r!.id));
    await registraLog(tx, contestoDa(req), {
      azione: "mandato.firma_richiesta",
      entita: "pratica",
      entitaId: praticaId,
      descrizione: `Richiesto il codice SMS per firmare il mandato della pratica (invio a ${cellulareMascherato(f.cellulare)})`,
    });
    return r!;
  });
  let inviato: boolean;
  try {
    inviato = await inviaSms(f.cellulare, `Tutelaziende: il tuo codice per firmare il mandato è ${codice}. Vale 10 minuti. Non comunicarlo a nessuno.`);
  } catch (err) {
    await db.update(mandatiOtpTable).set({ usatoIl: new Date() }).where(eq(mandatiOtpTable.id, otp.id));
    throw err;
  }
  if (!inviato) {
    logger.warn({ praticaId, cellulare: f.cellulare, codice }, "SMS non configurato: codice di firma del mandato (solo per prove)");
  }
  return { cellulare: cellulareMascherato(f.cellulare), scadeIl: scadeIl.toISOString(), inviato };
}

const chiaro = (t: string) => t.normalize("NFC");

/** Aggiunge al PDF compilato una pagina con i dati della firma elettronica. */
async function conPaginaFirma(pdf: Buffer, d: { nome: string; cf: string; cellulare: string; quando: Date; pratica: string }): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const pagina = doc.addPage([595.28, 841.89]);
  const normale = await doc.embedFont(StandardFonts.Helvetica);
  const grassetto = await doc.embedFont(StandardFonts.HelveticaBold);
  const blu = rgb(0.06, 0.3, 0.6);
  pagina.drawText("Firma del mandato con codice SMS", { x: 56, y: 770, size: 18, font: grassetto, color: blu });
  pagina.drawLine({ start: { x: 56, y: 758 }, end: { x: 539, y: 758 }, thickness: 1, color: blu });
  const quando = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" }).format(d.quando);
  const ora = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d.quando);
  const righe: [string, string][] = [
    ["Pratica", d.pratica],
    ["Firmatario", d.nome],
    ["Codice fiscale", d.cf],
    ["Cellulare di verifica", d.cellulare],
    ["Data della firma", quando],
    ["Ora della firma", ora],
  ];
  let y = 725;
  for (const [etichetta, testo] of righe) {
    pagina.drawText(chiaro(etichetta), { x: 56, y, size: 11, font: grassetto });
    pagina.drawText(chiaro(testo), { x: 200, y, size: 11, font: normale });
    y -= 24;
  }
  const nota = "Il mandato è stato firmato con un codice monouso inviato per SMS al cellulare indicato. Il firmatario ha confermato la firma inserendo il codice nella propria area riservata.";
  const parole = nota.split(" ");
  let riga = "";
  y -= 10;
  for (const parola of parole) {
    if (normale.widthOfTextAtSize(`${riga} ${parola}`, 10) > 483) {
      pagina.drawText(riga.trim(), { x: 56, y, size: 10, font: normale, color: rgb(0.3, 0.3, 0.3) });
      y -= 15;
      riga = "";
    }
    riga += ` ${parola}`;
  }
  if (riga.trim()) pagina.drawText(riga.trim(), { x: 56, y, size: 10, font: normale, color: rgb(0.3, 0.3, 0.3) });
  return Buffer.from(await doc.save());
}

async function inBuffer(stream: Readable): Promise<Buffer> {
  const pezzi: Buffer[] = [];
  for await (const p of stream) pezzi.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
  return Buffer.concat(pezzi);
}

export async function confermaFirma(req: Request, praticaId: number, codiceInserito: string) {
  const p = await caricaPraticaPropria(req, praticaId);
  const mandato = await controllaFirmabile(p);
  const f = await firmatario(req);
  const codice = codiceInserito.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(codice)) throw new HttpError(400, "Il codice è di 6 cifre.", "CODICE_NON_VALIDO", "codice");

  const [otp] = await db
    .select()
    .from(mandatiOtpTable)
    .where(and(eq(mandatiOtpTable.praticaId, praticaId), eq(mandatiOtpTable.utenteId, req.utente!.id), isNull(mandatiOtpTable.usatoIl)))
    .orderBy(desc(mandatiOtpTable.id))
    .limit(1);
  if (!otp) throw new HttpError(409, "Richiedi prima un codice con \"Firma mandato\".", "CODICE_NON_RICHIESTO");
  if (otp.scadeIl.getTime() < Date.now()) throw new HttpError(409, "Il codice è scaduto: richiedine uno nuovo.", "CODICE_SCADUTO");
  if (otp.tentativi >= TENTATIVI_MASSIMI) throw new HttpError(409, "Troppi tentativi errati: richiedi un nuovo codice.", "CODICE_BLOCCATO");

  const atteso = Buffer.from(otp.codiceHash, "hex");
  const dato = Buffer.from(impronta(codice, otp.id), "hex");
  if (atteso.length !== dato.length || !timingSafeEqual(atteso, dato)) {
    await db.update(mandatiOtpTable).set({ tentativi: sql`${mandatiOtpTable.tentativi} + 1` }).where(eq(mandatiOtpTable.id, otp.id));
    throw new HttpError(400, "Il codice non è corretto.", "CODICE_ERRATO", "codice");
  }

  const quando = new Date();
  const { pdf } = await mandatoCompilatoPdf(p, mandato.fileChiave);
  const nomeCompleto = `${f.nome} ${f.cognome}`;
  const firmato = await conPaginaFirma(pdf, {
    nome: nomeCompleto,
    cf: f.cf,
    cellulare: otp.cellulare,
    quando,
    pratica: `${p.assCognome} ${p.assNome}${p.numero ? ` (n. ${p.numero})` : ""}`,
  });
  const chiave = await salvaFile(firmato, "application/pdf");
  const fileNome = `Mandato firmato - ${p.assCognome} ${p.assNome}.pdf`.replace(/[\\/:*?"<>|]/g, "_");
  try {
    const riga = await db.transaction(async (tx) => {
      const usato = await tx
        .update(mandatiOtpTable)
        .set({ usatoIl: quando })
        .where(and(eq(mandatiOtpTable.id, otp.id), isNull(mandatiOtpTable.usatoIl)))
        .returning({ id: mandatiOtpTable.id });
      if (usato.length === 0) throw new HttpError(409, "Il codice è già stato usato.", "CODICE_SCADUTO");
      const [r] = await tx
        .insert(mandatiFirmeTable)
        .values({
          praticaId, mandatoId: mandato.id, collaboratoreId: f.id, utenteId: req.utente!.id,
          firmatarioNome: nomeCompleto, firmatarioCodiceFiscale: f.cf, firmatarioCellulare: otp.cellulare, firmatoIl: quando,
          fileChiave: chiave, fileNome, fileTipo: "application/pdf", fileDimensione: firmato.length,
        })
        .returning();
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.firma",
        entita: "pratica",
        entitaId: praticaId,
        descrizione: `Firmato il mandato della pratica ${p.assCognome} ${p.assNome} con codice SMS (${nomeCompleto}, ${f.cf}, cell. ${otp.cellulare})`,
        dettagli: { mandatoId: mandato.id, firmatario: nomeCompleto, codiceFiscale: f.cf, cellulare: otp.cellulare, firmatoIl: quando.toISOString() },
      });
      return r!;
    });
    return mappaFirma(riga);
  } catch (err) {
    await eliminaFile(chiave, logger);
    throw err;
  }
}

/** Contenuto del PDF firmato di una pratica, se esiste. */
export async function leggiPdfFirmato(praticaId: number): Promise<{ pdf: Buffer; fileNome: string } | null> {
  const f = await firmaDellaPratica(praticaId);
  if (!f) return null;
  const { stream } = await leggiFile(f.fileChiave);
  return { pdf: await inBuffer(stream), fileNome: f.fileNome };
}

/** Chiave del file firmato (da eliminare dallo storage quando si cancella la pratica). */
export async function chiaveFirmaPratica(praticaId: number): Promise<string | null> {
  return (await firmaDellaPratica(praticaId))?.fileChiave ?? null;
}
