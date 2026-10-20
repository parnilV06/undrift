import express from "express";

const app = express();

app.get("/api/items", (req, res) => {
  res.json({ version: "v2" });
});
