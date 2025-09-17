# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Cafe24 API Shop Integration - Cafe24 전자상거래 플랫폼과 연동하는 Next.js 애플리케이션입니다. 관리자 인터페이스와 API 브릿지 역할을 하며, AWS 클라우드 인프라를 활용합니다.

## 개발 명령어

```bash
npm run dev     # 개발 서버 시작
npm run build   # 프로덕션 빌드
npm run start   # 프로덕션 서버 시작 ($PORT 환경변수 사용)
npm run lint    # ESLint 실행 (Next.js + TypeScript 규칙)
```

## 아키텍처 및 기술 스택

- **프레임워크**: Next.js 15.3.3 with App Router (`src/app` 디렉터리 구조)
- **언어**: TypeScript 5 (strict mode)
- **런타임**: Node.js 22
- **스타일링**: Tailwind CSS 4
- **배포**: AWS Elastic Beanstalk (ap-northeast-2 리전)

## 핵심 아키텍처 패턴

### OAuth 인증 플로우
- Cafe24 OAuth 2.0 인증 구현
- AWS SSM Parameter Store를 통한 토큰 보안 저장
- HTTP-only 쿠키 기반 클라이언트 토큰 관리
- 만료 60초 전 자동 토큰 갱신 로직

### API 라우트 구조
```
src/app/api/
├── admin/           # Cafe24 관리자 API 작업
├── customer/        # 고객 관련 작업
├── oauth/           # 인증 엔드포인트
├── github-sync/     # 외부 동기화 기능
└── health/          # 헬스체크 엔드포인트
```

### 보안 및 토큰 관리
- AWS SSM Parameter Store를 통한 자격증명 보안 저장
- 이중 쿠키 전략: access_token (전역), refresh_token (경로 제한)
- 401 응답 시 자동 재시도 기능이 있는 에러 핸들링

## 필수 환경변수

```
CAFE24_MALL_ID / NEXT_PUBLIC_CAFE24_MALL_ID
CAFE24_CLIENT_ID / NEXT_PUBLIC_CAFE24_CLIENT_ID
CAFE24_CLIENT_SECRET
NEXT_PUBLIC_BASE_URL
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

## 주요 유틸리티

- `src/lib/cafe24Auth.ts` - 자동 갱신 기능이 있는 토큰 관리
- `src/lib/ssm.ts` - AWS SSM Parameter Store 작업
- `src/utils/cafe24.ts` - 인증 인터셉터가 포함된 Axios 인스턴스

## 설정 파일

- `eslint.config.mjs` - Next.js core-web-vitals + TypeScript 규칙
- `tsconfig.json` - 경로 별칭 설정 (`@/*` → `src/*`)
- `postcss.config.mjs` - Tailwind CSS 플러그인
- `next.config.ts` - 기본 Next.js 설정

## AWS 배포 설정

- **애플리케이션**: my-cafe24-app
- **환경**: my-cafe24-env
- **플랫폼**: Node.js 22
- **리전**: ap-northeast-2

## Cafe24 API 권한 범위

포괄적인 권한을 요청하며 다음을 포함합니다:
- 애플리케이션 관리, 카테고리, 상품, 주문
- 고객 데이터, 프로모션, 개인정보, 배송
- 각 범위에 대한 읽기/쓰기 권한

## 구현 패턴

1. **우아한 에러 처리**: 모든 API 라우트에 포괄적인 try-catch 블록
2. **토큰 지속성**: 이중 저장 전략 (SSM + HTTP-only 쿠키)
3. **환경 유연성**: public/private 환경변수 폴백 지원
4. **보안 우선**: HTTP-only 쿠키, 보안 플래그, 경로 제한
5. **AWS 통합**: 프로덕션 배포를 위한 AWS 서비스 활용