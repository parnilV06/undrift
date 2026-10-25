// Next.js App Router route handler for /api/products
export async function GET(request: Request) {
  return Response.json([{ id: "p1", name: "Keyboard", price: 99 }]);
}
