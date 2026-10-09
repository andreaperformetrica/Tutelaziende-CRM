/**
 * Attestati di partecipazione: il layout caricato dall'admin (PDF, prima pagina, oppure immagine) resta
 * identico e su ogni copia viene scritto solo il nome del partecipante.
 */
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { HttpError } from "./errori";

export interface LayoutAttestato {
  buffer: Buffer;
  tipo: string;
}
export interface PosizioneNome {
  /** Centro del nome, percentuale da sinistra. */
  x: number;
  /** Centro del nome, percentuale dall'alto. */
  y: number;
  /** Dimensione massima del carattere in punti (si riduce se il nome non entra). */
  dimensione: number;
}

const LATO_LUNGO_A4 = 841.89;

/** Helvetica codifica solo il latino di base: per altri caratteri si toglie l'accento o si usa "?". */
export function testoStampabile(font: PDFFont, testo: string): string {
  try {
    font.widthOfTextAtSize(testo, 10);
    return testo;
  } catch {
    return testo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
  }
}

export async function generaAttestati(layout: LayoutAttestato, pos: PosizioneNome, nomi: string[]): Promise<Buffer> {
  if (nomi.length === 0) throw new HttpError(400, "Non ci sono partecipanti per cui stampare l'attestato.", "NESSUN_PARTECIPANTE");
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.HelveticaBold);
  let sorgente: PDFDocument | null = null;
  let immagine: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  try {
    if (layout.tipo === "application/pdf") {
      sorgente = await PDFDocument.load(layout.buffer, { ignoreEncryption: false });
      if (sorgente.getPageCount() === 0) throw new Error("vuoto");
    } else if (layout.tipo === "image/png") {
      immagine = await out.embedPng(layout.buffer);
    } else {
      immagine = await out.embedJpg(layout.buffer);
    }
  } catch {
    throw new HttpError(400, "Il layout dell'attestato non può essere letto. Carica un PDF senza password o un'immagine PNG/JPG.", "LAYOUT_NON_VALIDO");
  }
  for (const nome of nomi) {
    let pagina;
    if (sorgente) {
      [pagina] = await out.copyPages(sorgente, [0]);
      out.addPage(pagina);
    } else {
      const img = immagine!;
      const scala = LATO_LUNGO_A4 / Math.max(img.width, img.height);
      pagina = out.addPage([img.width * scala, img.height * scala]);
      pagina.drawImage(img, { x: 0, y: 0, width: pagina.getWidth(), height: pagina.getHeight() });
    }
    const { width, height } = pagina.getSize();
    const testo = testoStampabile(font, nome);
    let dim = pos.dimensione;
    const larghezza = font.widthOfTextAtSize(testo, dim);
    const massima = width * 0.9;
    if (larghezza > massima) dim = Math.max(6, (dim * massima) / larghezza);
    const w = font.widthOfTextAtSize(testo, dim);
    pagina.drawText(testo, {
      x: (width * pos.x) / 100 - w / 2,
      // y e' il centro verticale del nome: la linea di base sta circa un terzo del corpo sotto.
      y: height * (1 - pos.y / 100) - dim * 0.35,
      size: dim,
      font,
    });
  }
  return Buffer.from(await out.save());
}
