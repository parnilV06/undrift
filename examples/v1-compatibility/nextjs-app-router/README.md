# Next.js App Router Compatibility Fixture

## Structure

- `src/components/ProductList.tsx`: React consumer using native `fetch` and Axios.
  - Native `fetch("/api/products")` (GET).
  - Parameterized Axios call: `axios.put(\`/api/products/\${id}\`, payload)`.
- `src/app/api/products/route.ts`:
  - `export async function GET(request: Request)` (Matches `fetch("/api/products")`).
- `src/app/api/products/[id]/route.ts`:
  - `export async function DELETE(request: Request)` (Deliberate method conflict with consumer PUT!).

## Expected Outcomes

- **Status**: Complete coverage (`complete: true`).
- **Active Drift Findings**: Exactly 1 `UND120` method conflict on `/api/products/:id` (expected `PUT`, observed `DELETE`).
- **Dynamic Segments**: `[id]` correctly normalized to parameter segment `:id`.
- **Coverage Limitations**: Zero completeness-affecting warnings.
