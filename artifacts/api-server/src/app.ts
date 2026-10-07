import express, { type ErrorRequestHandler, type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { HttpError } from "./lib/errori";

const app: Express = express();

// L'app e' dietro il proxy di Replit: serve per avere IP e host reali.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Risorsa non trovata.", code: "NON_TROVATO" });
});

const gestoreErrori: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, campo: err.campo, ...err.extra });
    return;
  }
  if (typeof err === "object" && err && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: "Richiesta non valida.", code: "DATI_NON_VALIDI" });
    return;
  }
  req.log.error({ err }, "Errore non gestito");
  res.status(500).json({ error: "Errore interno del server. Riprova piu tardi.", code: "ERRORE_INTERNO" });
};
app.use(gestoreErrori);

export default app;
