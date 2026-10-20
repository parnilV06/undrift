import axios from "axios";

export async function getReports() {
  return axios.get("/api/reports");
}
