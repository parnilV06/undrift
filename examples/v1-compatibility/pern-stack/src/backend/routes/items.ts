// Express routes for items resource
import express from "express";

export function registerItemRoutes(app: express.Application) {
  app.get("/api/items", (req, res) => {
    res.json([{ id: "1", name: "Item One" }]);
  });

  // Deliberate method conflict: provider declares POST /api/items/:id for deletion
  app.post("/api/items/:id", (req, res) => {
    res.json({ deleted: true });
  });
}
