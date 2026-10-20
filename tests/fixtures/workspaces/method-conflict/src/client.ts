import axios from "axios";

export async function createOrder() {
  return axios.get("/api/orders");
}
