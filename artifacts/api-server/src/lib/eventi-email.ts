/** Allegati delle email degli eventi, generati o letti al momento dell'invio. */
import { eq, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import { db, eventiDocumentiTable, eventiPartecipantiTable } from "@workspace/db";
import type { AllegatoEmail } from "./notifiche";
import { leggiFile } from "./storage";

const CID_QR = "qr-partecipante";

export async function leggiBuffer(chiave: string): Promise<Buffer> {
  const { stream } = await leggiFile(chiave);
  const pezzi: Buffer[] = [];
  for await (const p of stream) pezzi.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
  return Buffer.concat(pezzi);
}

/** Immagine PNG del QR personale (il contenuto e' il codice che legge il check-in). */
export const immagineQr = (codice: string) => QRCode.toBuffer(codice, { margin: 2, width: 360, errorCorrectionLevel: "M", type: "png" });

export async function allegatiEventoEmail(r: { qrPartecipanteId?: number; documentiIds?: number[] }): Promise<{ allegati: AllegatoEmail[]; htmlInCoda: string }> {
  const allegati: AllegatoEmail[] = [];
  let htmlInCoda = "";
  if (r.qrPartecipanteId) {
    const [p] = await db.select().from(eventiPartecipantiTable).where(eq(eventiPartecipantiTable.id, r.qrPartecipanteId));
    if (p) {
      const png = await immagineQr(p.codiceQr);
      const nome = `QR-${p.cognome}-${p.nome}`.replace(/[^\p{L}\p{N}-]+/gu, "_");
      allegati.push({ filename: `${nome}.png`, content: png.toString("base64"), content_id: CID_QR });
      htmlInCoda += `<p style="text-align:center"><img src="cid:${CID_QR}" width="240" height="240" alt="QR code personale" style="border:1px solid #d0d7e2"></p>`;
    }
  }
  if (r.documentiIds?.length) {
    const docs = await db.select().from(eventiDocumentiTable).where(inArray(eventiDocumentiTable.id, r.documentiIds));
    for (const d of docs) allegati.push({ filename: d.nome, content: (await leggiBuffer(d.chiave)).toString("base64") });
  }
  return { allegati, htmlInCoda };
}
