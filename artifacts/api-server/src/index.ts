import app from "./app";
import { logger } from "./lib/logger";
import { inizializzaConfigurazionePratiche } from "./lib/configurazione-iniziale";
import { recapitaNotificheRimaste } from "./lib/notifiche";

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

recapitaNotificheRimaste().catch((err) => logger.error({ err }, "Impossibile recapitare le notifiche rimaste in coda"));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
