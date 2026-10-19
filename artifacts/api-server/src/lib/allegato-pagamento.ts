/** Documento allegato a un pagamento (esempio: contabile del bonifico): salvataggio e sostituzione nello storage. */
import type { Request } from "express";
import { db } from "@workspace/db";
import type { Executor } from "./log";
import { eliminaFile, salvaFile, validaFile } from "./storage";

export interface AllegatoNuovo {
  chiave: string;
  nome: string;
  tipo: string;
  dimensione: number;
}

/**
 * Controlla e salva il file ricevuto, poi esegue `aggiorna` dentro una transazione: la funzione registra l'allegato e il log e
 * restituisce la chiave dell'allegato precedente, che viene tolto dallo storage solo a operazione riuscita.
 */
export async function salvaAllegatoPagamento(req: Request, aggiorna: (tx: Executor, allegato: AllegatoNuovo) => Promise<string | null>): Promise<void> {
  // Contabile: solo PDF e immagini.
  const file = validaFile(req.query["nomeFile"], req.body, { soloPdfEImmagini: true });
  const chiave = await salvaFile(file.buffer, file.tipo);
  let vecchia: string | null = null;
  try {
    await db.transaction(async (tx) => {
      vecchia = await aggiorna(tx, { chiave, nome: file.nome, tipo: file.tipo, dimensione: file.dimensione });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  if (vecchia) await eliminaFile(vecchia, req.log);
}
