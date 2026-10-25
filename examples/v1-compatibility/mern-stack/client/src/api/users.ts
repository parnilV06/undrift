// React consumer API client using fetch and Axios
import axios from "axios";

export async function fetchUsers() {
  const response = await fetch("/api/users");
  return response.json();
}

export async function fetchPostById(id: string) {
  const response = await axios.get(`/api/posts/${id}`);
  return response.data;
}

export async function fetchPostsPaged(page: number) {
  const response = await axios.get(`/api/posts?page=${page}&limit=10`);
  return response.data;
}

const registrationData = {
  name: "Alice",
  email: "alice@example.com"
};

export async function registerUser() {
  const response = await axios.post("/api/users", registrationData);
  return response.data;
}

const loginCredentials = {
  user: "alice",
  pass: "secret"
};

// Deliberate contract mismatch: consumer expects POST, server declares GET
export async function loginUser() {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(loginCredentials)
  });
  return response.json();
}
