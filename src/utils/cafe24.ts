// src/lib/cafe24Api.ts
import axios from "axios";

export const cafe24Api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_BASE_URL,
  withCredentials: true, // 쿠키 전송 허용
});

// 요청 전에 HTTP-only 쿠키에 담긴 access_token을 헤더에 붙입니다.
cafe24Api.interceptors.request.use(config => {
  const m = document.cookie.match(/access_token=([^;]+)/);
  if (m && config.headers) {
    config.headers.Authorization = `Bearer ${m[1]}`;
  }
  return config;
});

// 401 Unauthorized 가 뜨면 리프레시 엔드포인트를 호출하고, 성공 시 토큰을 다시 세팅 후 재시도합니다.
cafe24Api.interceptors.response.use(
  res => res,
  async err => {
    const status = err.response?.status;
    // 토큰 만료라고 판단되는 경우
    if (status === 401) {
      // 1) /api/oauth/refresh 호출
      const refreshRes = await fetch("/api/oauth/refresh", {
        method: "GET",
        credentials: "include",
      });
      if (refreshRes.ok) {
        const { access_token } = await refreshRes.json();
        // 2) 새 토큰을 쿠키에 자동으로 Set-Cookie 헤더로 내려줬다면,
        //    다음 요청부터는 request 인터셉터가 쿠키에서 꺼내 씁니다.
        //    만약 직접 헤더 세팅을 원하시면:
        err.config.headers.Authorization = `Bearer ${access_token}`;
        // 3) 원래 요청 재시도
        return cafe24Api(err.config);
      }
      // 리프레시 실패 시 로그인 화면으로 이동
      window.location.href = "/";
    }
    return Promise.reject(err);
  },
);
