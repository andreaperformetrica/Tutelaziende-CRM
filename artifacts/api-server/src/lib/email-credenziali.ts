/**
 * Email di benvenuto con le credenziali, inviata alla creazione di un collaboratore.
 * La password provvisoria compare solo nell'email: nel registro delle notifiche il testo viene salvato senza.
 * Link: URL_PIATTAFORMA (accesso), URL_APP_APPLE e URL_APP_ANDROID (facoltativi, scaricamento dell'app).
 */
import { eq } from "drizzle-orm";
import { db, notificheTable } from "@workspace/db";
import { LOGO_BIANCO_BASE64 } from "./logo-email";
import { escapeHtml, spedisciEmail, urlPiattaforma } from "./notifiche";
import { logger } from "./logger";

const SFONDO = "#6f87a3";
const PIEDE = "#a7bcd6";
const TESTO = "#444444";

const url = (nome: string) => process.env[nome]?.trim() || null;

interface Credenziali {
  utenteId: number;
  nome: string;
  cognome: string;
  email: string;
  password: string;
}

function costruisci(c: Credenziali, mostraPassword: boolean) {
  const apple = url("URL_APP_APPLE");
  const android = url("URL_APP_ANDROID");
  const piattaforma = urlPiattaforma("/");
  const nomeCompleto = `${c.nome} ${c.cognome}`.trim().toUpperCase();
  const password = mostraPassword ? c.password : "(la password provvisoria indicata dall'amministratore)";
  const haApp = !!(apple || android);
  const introduzione = haApp
    ? "Per potervi accedere è necessario scaricare l'applicazione TUTELAZIENDE dal Play Store o dall'Apple Store."
    : "Per accedere alla piattaforma usi il link qui sotto.";
  const note = "Al primo accesso le verrà chiesto di scegliere una nuova password.";

  const link = (href: string, etichetta: string) => `<a href="${escapeHtml(href)}" style="color:#1a56c4;text-decoration:underline">${escapeHtml(etichetta)}</a>`;
  const celle = [apple && link(apple, "Apple"), android && link(android, "Android")].filter(Boolean) as string[];
  const righeLink = `${
    celle.length
      ? `<tr><td align="center" style="padding:14px 0 6px 0"><table role="presentation" width="100%"><tr>${celle.map((x) => `<td align="center" style="font-size:14px">${x}</td>`).join("")}</tr></table></td></tr>`
      : ""
  }<tr><td align="center" style="padding:10px 0;font-size:14px">${link(piattaforma, "Link Accesso alla piattaforma")}</td></tr>`;

  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:0;background:${SFONDO}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SFONDO}"><tr><td align="center" style="padding:28px 12px 0 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font-family:Arial,Helvetica,sans-serif">
<tr><td align="center" style="padding:10px 0 30px 0"><img src="cid:logo-tutelaziende" alt="Tutelaziende" width="320" style="display:block;width:320px;max-width:80%;height:auto;border:0"></td></tr>
<tr><td style="background:#ffffff;padding:26px 28px 34px 28px;color:${TESTO};font-size:16px;line-height:1.45">
<p style="margin:0;text-align:center;font-size:26px;font-style:italic">Ciao</p>
<p style="margin:6px 0 22px 0;text-align:center;font-size:26px;font-weight:bold;font-style:italic">${escapeHtml(nomeCompleto)}</p>
<p style="margin:0 0 16px 0">Abbiamo attivato per lei l'accesso all'applicazione.</p>
<p style="margin:0 0 6px 0">${escapeHtml(introduzione)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${righeLink}</table>
<p style="margin:26px 0 12px 0;font-size:18px">Ecco le credenziali</p>
<p style="margin:0;font-size:18px">Username: ${link(`mailto:${c.email}`, c.email.toUpperCase())}</p>
<p style="margin:2px 0 0 0;font-size:18px">Password: ${escapeHtml(password)}</p>
<p style="margin:22px 0 0 0;font-size:14px">${escapeHtml(note)}</p>
</td></tr>
<tr><td align="center" style="background:${PIEDE};color:#ffffff;padding:22px 12px;font-size:15px">Tutelaziende s.r.l.</td></tr>
</table></td></tr></table></body></html>`;

  const testo = [
    `Ciao ${nomeCompleto}`,
    "",
    "Abbiamo attivato per lei l'accesso all'applicazione.",
    introduzione,
    ...(apple ? [`Apple: ${apple}`] : []),
    ...(android ? [`Android: ${android}`] : []),
    `Link Accesso alla piattaforma: ${piattaforma}`,
    "",
    "Ecco le credenziali",
    `Username: ${c.email}`,
    `Password: ${password}`,
    "",
    note,
    "",
    "Tutelaziende s.r.l.",
  ].join("\n");
  return { html, testo };
}

/** Invia l'email delle credenziali e ne registra l'esito. Non lancia mai errori: l'operazione che la richiede non dipende dall'invio. */
export async function inviaCredenzialiCollaboratore(c: Credenziali): Promise<{ esito: "inviata" | "non_inviata" | "errore"; dettaglio: string | null }> {
  try {
    const oggetto = "Accesso a Tutelaziende: le sue credenziali";
    const [riga] = await db
      .insert(notificheTable)
      .values({
        evento: "credenziali_collaboratore",
        canale: "email",
        destinatarioUtenteId: c.utenteId,
        destinatarioNome: `${c.nome} ${c.cognome}`.trim(),
        destinatarioContatto: c.email,
        oggetto,
        testo: costruisci(c, false).testo,
        elaboratoIl: new Date(),
      })
      .returning({ id: notificheTable.id });
    const vera = costruisci(c, true);
    const e = await spedisciEmail({
      a: c.email,
      oggetto,
      testo: vera.testo,
      html: vera.html,
      allegati: [{ filename: "logo.png", content: LOGO_BIANCO_BASE64, content_id: "logo-tutelaziende" }],
    });
    if (e.esito === "errore") logger.warn({ notificaId: riga!.id, dettaglio: e.dettaglio }, "Email delle credenziali non inviata");
    await db
      .update(notificheTable)
      .set({ esito: e.esito, dettaglioEsito: e.dettaglio, idEsterno: e.idEsterno ?? null, elaboratoIl: new Date() })
      .where(eq(notificheTable.id, riga!.id));
    return { esito: e.esito, dettaglio: e.dettaglio };
  } catch (err) {
    logger.error({ err }, "Errore nell'invio dell'email delle credenziali");
    return { esito: "errore", dettaglio: "Errore interno nell'invio dell'email." };
  }
}
