// Consumer component for Next.js Pages Router API routes
// Deliberate method conflict: consumer expects POST /api/todos, but provider implements PUT
export async function createTodo() {
  const response = await fetch("/api/todos", {
    method: "POST",
    body: JSON.stringify({ title: "New Task" })
  });
  return response.json();
}
