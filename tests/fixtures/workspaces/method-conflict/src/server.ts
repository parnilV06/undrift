import express from "express";

const app = express();

app.post("/api/orders", (req, res) => {
  res.json({ orderId: "ord-123", status: "confirmed" });
});
