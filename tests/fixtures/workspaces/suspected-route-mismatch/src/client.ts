import axios from "axios";

export async function getProfile() {
  return axios.get("/api/users");
}
