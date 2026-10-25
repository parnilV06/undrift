# Next.js Pages Router Compatibility Fixture

## Structure

- `src/components/TodoView.tsx`: Consumer client using `fetch`.
  - `fetch("/api/todos")` (Default GET).
  - `fetch("/api/todos", { method: "POST" })` (Consumer expects POST).
- `src/pages/api/todos.ts`: Supported Pages Router API route using structured `switch (req.method)` dispatch.
  - Case `'GET'`: Returns todos array.
  - Case `'PUT'`: Returns update status.
  - **Deliberate Mismatch**: Consumer called `POST /api/todos`, but provider only implements `GET` and `PUT` (UND120 method conflict: consumer expected POST, provider observed PUT/GET).
- `src/pages/api/ambiguous.ts`: Negative pattern example showing an API handler without identifiable `req.method` checks. UNDRIFT safely flags this with an `UNSUPPORTED_PATTERN` limitation and does not invent hypothetical methods.

## Expected Outcomes

- **todos.ts**: Provider methods `GET` and `PUT` are reliably extracted and matched.
- **Active Drift Findings**: Exactly 1 `UND120` method conflict on `/api/todos` (consumer expected `POST`, provider declared `PUT`).
- **ambiguous.ts**: Produces documented `UNSUPPORTED_PATTERN` coverage warning without fabricating false endpoints.
