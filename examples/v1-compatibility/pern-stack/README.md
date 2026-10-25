# PERN Compatibility Fixture

## Structure

- `src/frontend/items-client.ts`: React client source using Axios.
  - `axios.get("/api/items")`
  - Parameterized delete call: `axios.delete(\`/api/items/\${itemId}\`)`.
- `src/backend/routes/items.ts`: Express routes for PostgreSQL-backed resources.
  - `app.get("/api/items", ...)`
  - **Deliberate Mismatch**: `app.post("/api/items/:id", ...)` for deleting an item instead of `DELETE`!
- `src/backend/db/pool.ts`: PostgreSQL connection pool setup (not required to run for static analysis).

## Expected Outcomes

- **Status**: Complete coverage (`complete: true`).
- **Active Drift Findings**: Exactly 1 `UND120` method conflict on `/api/items/:id` (expected `DELETE`, observed `POST`).
- **Coverage Limitations**: Zero completeness-affecting warnings.
