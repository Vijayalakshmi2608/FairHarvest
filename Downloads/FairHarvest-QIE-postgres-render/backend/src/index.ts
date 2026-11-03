import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json({ service: "fairharvest-backend", status: "ok" }));
app.listen(process.env.PORT || 4000, () => console.log("FairHarvest backend scaffold listening"));
