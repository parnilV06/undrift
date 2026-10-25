// React client for PERN stack application
import axios from "axios";

export async function getItems() {
  const response = await axios.get("/api/items");
  return response.data;
}

// Deliberate method conflict: consumer calls DELETE /api/items/${itemId}, but server declares POST
export async function removeItem(itemId: string) {
  const response = await axios.delete(`/api/items/${itemId}`);
  return response.data;
}
