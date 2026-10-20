import axios from "axios";

export async function getUsers() {
  return axios.get("/api/users");
}
