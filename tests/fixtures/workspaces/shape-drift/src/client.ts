import axios from "axios";

export async function getStatus() {
  return axios.get<string>("/api/status");
}
