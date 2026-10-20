import axios from "axios";

export async function getDynamic(endpointUrl: string) {
  return axios.get(endpointUrl);
}
