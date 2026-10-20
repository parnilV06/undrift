import express from "express";

const app = express();

app.get("/api/constant", (req, res) => {
  res.json({ ok: true });
});
