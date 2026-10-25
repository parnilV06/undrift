// Express backend route handlers
import express from "express";

export function configureRoutes(app: express.Application) {
  app.get("/api/users", (req, res) => {
    res.json([{ id: 1, name: "Alice" }]);
  });

  app.get("/api/posts", (req, res) => {
    res.json([{ id: 1, title: "Post Title" }]);
  });

  app.get("/api/posts/:id", (req, res) => {
    res.json({ id: req.params.id, title: "Post Title" });
  });

  app.post("/api/users", (req, res) => {
    res.status(201).json({ success: true });
  });

  // Deliberate method conflict: provider declares GET on /api/auth/login, but consumer calls POST
  app.get("/api/auth/login", (req, res) => {
    res.json({ token: "sample-token" });
  });
}
