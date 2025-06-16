import axios from "axios";
import fs from "fs";
import path from "path";

function loadTokens() {
  const dataPath = path.join(process.cwd(), "data", "tokens.json");
  return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
}

export const cafe24Api = axios.create();

cafe24Api.interceptors.request.use(config => {
  const tokens = loadTokens();
  config.headers = config.headers || {};
  config.headers.Authorization = `Bearer ${tokens.access_token}`;
  return config;
});
