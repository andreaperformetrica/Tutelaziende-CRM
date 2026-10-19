import app from "./app";
import { logger } from "./lib/logger";
import { inizializzaConfigurazionePratiche } from "./lib/configurazione-iniziale";
import { maturaPraticheGiaChiuse } from "./lib/compensi";
import { recapitaNotificheRimaste } from "./lib/notifiche";
import { avviaSolleciti } from "./lib/scadenze";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  const creata = await inizializzaConfigurazionePratiche();
  if (creata) logger.info("Configurazione iniziale delle pratiche creata (stati e orari di caricamento)");
} catch (err) {
  logger.error({ err }, "Impossibile inizializzare la configurazione delle pratiche");
}

try {
  const maturate = await maturaPraticheGiaChiuse();
  if (maturate > 0) logger.info({ maturate }, "Compensi maturati per le pratiche già chiuse");
} catch (err) {
  logger.error({ err }, "Impossibile calcolare i compensi delle pratiche già chiuse");
}

recapitaNotificheRimaste().catch((err) => logger.error({ err }, "Impossibile recapitare le notifiche rimaste in coda"));

avviaSolleciti();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
