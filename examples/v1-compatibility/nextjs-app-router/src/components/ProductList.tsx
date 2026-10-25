// React component consuming Next.js App Router API endpoints
import axios from "axios";

export async function loadProducts() {
  const response = await fetch("/api/products");
  return response.json();
}

const defaultProductPayload = {
  name: "Keyboard",
  price: 99
};

// Deliberate method conflict: consumer calls PUT /api/products/${id}, while provider exports DELETE
export async function updateProduct(id: string) {
  const response = await axios.put(`/api/products/${id}`, defaultProductPayload);
  return response.data;
}
