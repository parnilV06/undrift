# MERN Compatibility Fixture

## Structure

- `client/src/api/users.ts`: React client code using native `fetch` and Axios.
  - Native `fetch("/api/users")` (GET).
  - Parameterized Axios call: `axios.get(\`/api/posts/\${id}\`)`.
  - Static URL with dynamic query parameter: `axios.get(\`/api/posts?page=\${page}&limit=10\`)`.
  - Object payload resolution: `axios.post("/api/users", registrationData)` with local const object.
  - **Deliberate Mismatch**: `fetch("/api/auth/login", { method: "POST" })` calls POST, while server declares GET.
- `server/src/routes.ts`: Express backend routes.
  - `app.get("/api/users", ...)`
  - `app.get("/api/posts/:id", ...)`
  - `app.get("/api/auth/login", ...)` (Method conflict with consumer POST).

## Expected Outcomes

- **Status**: Complete coverage (`complete: true`).
- **Active Drift Findings**: Exactly 1 `UND120` method conflict on `/api/auth/login` (expected `POST`, observed `GET`).
- **Coverage Limitations**: Zero completeness-affecting warnings.
