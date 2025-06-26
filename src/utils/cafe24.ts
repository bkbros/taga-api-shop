// src/lib/cafe24Api.ts
import axios from "axios";
import { loadParams } from "@/lib/ssm";
import type { InternalAxiosRequestConfig, AxiosRequestHeaders } from "axios";

export const cafe24Api = axios.create();

// Request interceptor: SSM에서 access_token을 꺼내와 Authorization 헤더에 설정
cafe24Api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const { access_token } = await loadParams(["access_token"]);
  const headers: AxiosRequestHeaders = config.headers ?? {};
  if (access_token) {
    headers.Authorization = `Bearer ${access_token}`;
  }
  config.headers = headers;
  return config;
});

// Response interceptor: 401 Unauthorized 발생 시 /api/oauth/refresh 호출 -> 토큰 갱신 후 재시도 또는 홈 리다이렉트
cafe24Api.interceptors.response.use(
  response => response,
  async error => {
    const status = error.response?.status;
    if (status === 401) {
      try {
        const refreshRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth/refresh`);
        if (!refreshRes.ok) throw new Error("Refresh failed");
        // 갱신 완료되면 원래 요청 재시도
        return cafe24Api(error.config as InternalAxiosRequestConfig);
      } catch {
        // 갱신 실패 시 홈으로 리다이렉트
        if (typeof window !== "undefined") window.location.href = "/";
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);
