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
- AWS SSM Parameter Store를 통한 토큰 보안 저장 (`/cafe24/{name}` 경로, SecureString 타입)
- HTTP-only 쿠키 기반 클라이언트 토큰 관리
- 만료 60초 전 자동 토큰 갱신 로직 (`src/lib/cafe24Auth.ts`)
- 이중 저장 전략: SSM이 source of truth, 쿠키는 편의성 복사본

### API 라우트 구조
```
src/app/api/
├── admin/
│   ├── customers/       # Cafe24 고객 조회 (member_id, cellphone 쿼리)
│   └── products/        # 상품 관리 스텁
├── customer/
│   ├── info/            # 단일 고객 상세 정보 + 주문 내역 (3개월/1년)
│   ├── bulk/            # 대량 고객 검증 (동시성 제어)
│   ├── exists/          # 고객 존재 여부 확인
│   ├── all-orders/      # 전체 주문 조회 스텁
│   └── carbon/          # 탄소 크레딧 추적 스텁
├── oauth/
│   ├── callback/        # OAuth 콜백 핸들러 (토큰 교환 및 저장)
│   └── refresh/         # 토큰 갱신 엔드포인트
├── sheets/
│   └── verify-members/
│       └── start/       # Google Sheets 회원 검증 작업 시작
├── github-sync/         # 외부 동기화 기능
├── health/              # 헬스체크 엔드포인트 (AWS ALB용)
├── tokens/              # 토큰 관리
├── trigger-sync/        # 비동기 작업 트리거
└── sync-status/         # 동기화 진행 상황 모니터링
```

### 고객 정보 검색 전략 (Multi-Strategy)
`/api/customer/info`는 다음 순서로 고객을 검색합니다:
1. **Member ID 우선**: `user_id` 파라미터로 검색
   - 숫자만 있고 `guess=true`인 경우: `[raw, "${raw}@k", "${raw}@n"]` 시도
2. **전화번호 폴백**: `phone_hint` 파라미터 사용
   - 한국 휴대폰 번호 정규화 (82-접두사 → 0-접두사 변환)
   - `cellphone` 파라미터로 Cafe24 API 쿼리
3. **주문 내역 계산**:
   - **3개월**: 단일 3개월 창 (Cafe24 최대 제약)
   - **1년**: 4개의 연속된 3개월 창으로 분할 (API 제약 우회)
   - 시간대: KST (UTC+9) 변환 유틸리티 사용

### Rate Limiting 및 동시성 제어
- **Token Bucket Algorithm** (`src/lib/rate-limit.ts`):
  - `RateLimiter(tokensPerSecond, maxTokens)`: 토큰 버킷 구현
  - `cafe24Get/Post()`: Rate-limited wrapper with 429 retry
  - 기본값: 0.8 RPS, burst 2 (보수적 설정)
- **Concurrency Management** (`src/lib/pool.ts`):
  - `mapPool()`: 동시성 제한이 있는 병렬 실행
  - `mapPoolSimple()`: 배치 기반 처리
  - `mapSequential()`: 순차 실행 (지연 옵션)
- **대량 처리**:
  - 50개 이상 아이템: 50개 청크로 분할
  - 청크 간 2초 대기 (타임아웃 방지)
  - 아이템별 에러 핸들링 (continue-on-error)

### 보안 및 토큰 관리
- AWS SSM Parameter Store를 통한 자격증명 보안 저장
- 이중 쿠키 전략:
  - `access_token`: Secure, HttpOnly, Path=/, maxAge=expires_in
  - `refresh_token`: Secure, HttpOnly, Path=/api/oauth/refresh, maxAge=14일
- 401 응답 시 자동 토큰 갱신 및 재시도
- 429 응답 시 Retry-After 헤더 기반 exponential backoff

## 필수 환경변수

```
CAFE24_MALL_ID / NEXT_PUBLIC_CAFE24_MALL_ID
CAFE24_CLIENT_ID / NEXT_PUBLIC_CAFE24_CLIENT_ID
CAFE24_CLIENT_SECRET
NEXT_PUBLIC_BASE_URL
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
GOOGLE_CRED_JSON                  # (Optional) Google Sheets 자격증명
```

## 주요 유틸리티

- `src/lib/cafe24Auth.ts` - 토큰 관리: `getAccessToken()`, `forceRefresh()`
- `src/lib/ssm.ts` - AWS SSM 작업: `saveParam()`, `loadParams()`
- `src/lib/rate-limit.ts` - Rate limiter: `RateLimiter` 클래스, `cafe24Get/Post()`
- `src/lib/pool.ts` - 동시성 제어: `mapPool()`, `mapPoolSimple()`, `mapSequential()`
- `src/lib/job-store.ts` - 비동기 작업 추적
- `src/lib/async-job-client.ts` - 클라이언트 측 비동기 작업 헬퍼
- `src/utils/cafe24.ts` - 인증 인터셉터가 포함된 Axios 인스턴스

## 설정 파일

- `eslint.config.mjs` - Next.js core-web-vitals + TypeScript 규칙
- `tsconfig.json` - 경로 별칭 설정 (`@/*` → `src/*`), Target: ES2017
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

## Cafe24 API 제약사항

- **API 버전**: `X-Cafe24-Api-Version: 2025-06-01` 헤더 필수
- **베이스 엔드포인트**: `https://{mallId}.cafe24api.com/api/v2`
- **인증**: `Authorization: Bearer {token}` 헤더
- **기간 조회 제한**: 최대 3개월 (1년 조회 시 4개 창으로 분할)
- **페이지네이션**: limit/offset 파라미터 (기본 limit=100)
- **타임아웃**: 요청당 8000-10000ms

## 구현 패턴

1. **우아한 에러 처리**: 모든 API 라우트에 포괄적인 try-catch 블록
2. **토큰 지속성**: 이중 저장 전략 (SSM + HTTP-only 쿠키)
3. **환경 유연성**: public/private 환경변수 폴백 지원
4. **보안 우선**: HTTP-only 쿠키, 보안 플래그, 경로 제한
5. **AWS 통합**: 프로덕션 배포를 위한 AWS 서비스 활용
6. **보수적 Rate Limiting**: Cafe24 API 제한 준수 (기본 0.8 RPS)
7. **전화번호 정규화**: 82-접두사 → 0-접두사 변환, 한국 휴대폰 형식 검증
8. **청크 처리**: 대량 요청(50개 이상)을 50개 청크로 분할, 청크 간 2초 대기
9. **Continue-on-Error**: 배치 처리 시 아이템별 에러가 전체 배치를 실패시키지 않음
10. **KST 시간대 처리**: 날짜 경계 계산 시 UTC+9 고려