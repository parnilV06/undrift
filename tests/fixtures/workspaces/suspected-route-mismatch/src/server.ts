import express from "express";

const app = express();

app.get("/api/user", (req, res) => {
  res.json({ id: 1, name: "Alice" });
});
