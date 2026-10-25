// Next.js App Router dynamic route handler for /api/products/[id]
// Deliberate method conflict: exports DELETE, whereas consumer calls PUT
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return Response.json({ deleted: params.id });
}
