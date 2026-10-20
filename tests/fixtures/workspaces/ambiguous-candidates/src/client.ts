import axios from "axios";

export async function getItems() {
  return axios.get("/api/items");
}
