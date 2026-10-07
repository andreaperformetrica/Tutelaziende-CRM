/**
 * Unico punto di accesso ai file (App Storage). Il database conserva solo la chiave restituita da `salvaFile`.
 * I file stanno nella cartella privata del bucket e si leggono solo tramite endpoint che controllano i permessi.
 */
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import { HttpError } from "./errori";

const SIDECAR = "http://127.0.0.1:1106";

const client = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  } as never,
  projectId: "",
});

export const DIMENSIONE_MASSIMA_FILE = 15 * 1024 * 1024;

/** Estensioni ammesse e relativo tipo di contenuto. */
const TIPI_AMMESSI: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** Per i documenti delle pratiche: solo PDF e immagini. */
const ESTENSIONI_DOCUMENTI = new Set(["pdf", "png", "jpg", "jpeg"]);

function posizione(chiave: string): { bucket: string; oggetto: string } {
  const dir = process.env["PRIVATE_OBJECT_DIR"];
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR non configurata: l'App Storage non e' attivo.");
  const pulito = dir.replace(/^\/+/, "").replace(/\/+$/, "");
  const [bucket, ...resto] = pulito.split("/");
  return { bucket: bucket!, oggetto: [...resto, chiave].join("/") };
}

export interface FileValidato {
  nome: string;
  tipo: string;
  dimensione: number;
}

/** Controlla nome, estensione e dimensione del file caricato; risponde 400/413 con messaggi in italiano. */
export function validaFile(
  nomeGrezzo: unknown,
  corpo: unknown,
  opzioni: { soloPdfEImmagini?: boolean } = {},
): FileValidato & { buffer: Buffer } {
  if (!Buffer.isBuffer(corpo) || corpo.length === 0) {
    throw new HttpError(400, "Seleziona un file da caricare.", "FILE_MANCANTE");
  }
  if (corpo.length > DIMENSIONE_MASSIMA_FILE) {
    throw new HttpError(413, "Il file supera la dimensione massima di 15 MB.", "FILE_TROPPO_GRANDE");
  }
  const nome = String(nomeGrezzo ?? "")
    .replace(/[\\/\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 200);
  if (!nome) throw new HttpError(400, "Nome del file mancante.", "FILE_MANCANTE");
  const estensione = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  const tipo = opzioni.soloPdfEImmagini && !ESTENSIONI_DOCUMENTI.has(estensione) ? undefined : TIPI_AMMESSI[estensione];
  if (!tipo) {
    throw new HttpError(
      400,
      opzioni.soloPdfEImmagini
        ? "Formato non ammesso. Sono accettati solo PDF e immagini PNG o JPG."
        : "Formato non ammesso. Sono accettati PDF, documenti Word, Excel, OpenDocument, RTF, TXT e immagini PNG o JPG.",
      "FILE_FORMATO_NON_AMMESSO",
    );
  }
  if (opzioni.soloPdfEImmagini) {
    const inizio = corpo.subarray(0, 4);
    const png = estensione === "png" && inizio.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpg = (estensione === "jpg" || estensione === "jpeg") && inizio[0] === 0xff && inizio[1] === 0xd8 && inizio[2] === 0xff;
    if (estensione !== "pdf" && !png && !jpg) throw new HttpError(400, "Il file non è un'immagine valida.", "FILE_NON_VALIDO");
  }
  if (estensione === "pdf" && corpo.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new HttpError(400, "Il file non è un PDF valido.", "FILE_NON_VALIDO");
  }
  return { nome, tipo, dimensione: corpo.length, buffer: corpo };
}

/** Salva i byte nello storage e restituisce la chiave da registrare nel database. */
export async function salvaFile(buffer: Buffer, tipo: string): Promise<string> {
  const chiave = `documenti/${randomUUID()}`;
  const { bucket, oggetto } = posizione(chiave);
  await client.bucket(bucket).file(oggetto).save(buffer, { contentType: tipo, resumable: false });
  return chiave;
}

export async function leggiFile(chiave: string): Promise<{ stream: Readable }> {
  const { bucket, oggetto } = posizione(chiave);
  const file = client.bucket(bucket).file(oggetto);
  const [esiste] = await file.exists();
  if (!esiste) throw new HttpError(404, "Il file non è più disponibile nello storage.", "FILE_NON_TROVATO");
  return { stream: file.createReadStream() };
}

/** Elimina un file; un errore non blocca l'operazione gia' registrata (resta un file orfano, non un dato errato). */
export async function eliminaFile(chiave: string, log: { warn: (o: unknown, m: string) => void }): Promise<void> {
  try {
    const { bucket, oggetto } = posizione(chiave);
    await client.bucket(bucket).file(oggetto).delete({ ignoreNotFound: true });
  } catch (err) {
    log.warn({ err, chiave }, "Eliminazione del file dallo storage non riuscita");
  }
}
