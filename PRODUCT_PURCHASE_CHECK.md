# 특정 상품 구매 확인 기능 사용 가이드

Google Sheets의 회원 아이디 목록을 조회하여 특정 기간 동안 특정 상품들을 구매했는지 확인하는 기능입니다.

## 기능 개요

- Google Sheets에 있는 회원 아이디 목록을 읽어서
- 각 회원이 지정한 기간 동안
- 지정한 상품들을 구매했는지 확인하고
- 결과를 다시 Google Sheets에 기록합니다

## API 엔드포인트

### 1. `/api/customer/check-products` (단일 회원 조회)

특정 회원 1명의 상품 구매 내역을 확인합니다.

**Method**: `GET`

**Query Parameters**:
```
member_id (required)     : 회원 로그인 아이디
product_nos (required)   : 확인할 상품 번호들 (쉼표로 구분, 예: "123,456,789")
start_date (optional)    : 시작일 (YYYY-MM-DD, 기본: 3개월 전)
end_date (optional)      : 종료일 (YYYY-MM-DD, 기본: 오늘)
shop_no (optional)       : 쇼핑몰 번호 (기본: 1)
order_status (optional)  : 주문 상태 필터 (기본: "N40,N50" - 배송완료/구매확정)
```

**예시 요청**:
```bash
GET /api/customer/check-products?member_id=sda0125&product_nos=123,456&start_date=2024-01-01&end_date=2024-12-31
```

**응답 예시**:
```json
{
  "memberId": "sda0125",
  "hasPurchased": true,
  "purchasedProducts": [
    {
      "productNo": 123,
      "productCode": "P001",
      "productName": "상품명",
      "orderId": "20241201-0001234",
      "orderDate": "2024-12-01T10:30:00+09:00",
      "quantity": 2
    }
  ],
  "totalQuantity": 2,
  "orderIds": ["20241201-0001234"],
  "searchParams": {
    "memberId": "sda0125",
    "productNos": [123, 456],
    "startDate": "2024-01-01",
    "endDate": "2024-12-31",
    "shopNo": 1,
    "orderStatus": "N40,N50"
  },
  "processingTime": 1523
}
```

---

### 2. `/api/sheets/check-product-purchases` (Google Sheets 통합)

Google Sheets에서 회원 목록을 읽어 일괄 처리합니다.

**Method**: `POST`

**Request Body**:
```json
{
  "spreadsheetId": "1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg",
  "sheetName": "Sheet1",
  "memberIdColumn": "AC",
  "outputStartColumn": "AH",
  "productNos": "123,456,789",
  "startRow": 2,
  "limit": 100,
  "concurrency": 2,
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "shopNo": 1,
  "orderStatus": "N40,N50",
  "useEnvCredentials": true
}
```

**파라미터 설명**:
- `spreadsheetId` (required): Google Sheets 문서 ID
- `sheetName` (optional): 시트 이름 (기본: "Sheet1")
- `memberIdColumn` (required): 회원 ID가 있는 열 (예: "A", "AC")
- `outputStartColumn` (required): 결과를 쓸 시작 열 (예: "AH")
  - AH: 구매 여부 (⭕/❌)
  - AI: 총 구매 수량
  - AJ: 주문 건수
  - AK: 상품 상세 정보
- `productNos` (required): 확인할 상품 번호들 (쉼표로 구분)
- `startRow` (optional): 시작 행 (기본: 2, 헤더 다음)
- `limit` (optional): 배치 크기 (기본: 100, 최대: 200)
- `concurrency` (optional): 동시 처리 수 (기본: 2, 최대: 5)
- `startDate` (optional): 시작일 (YYYY-MM-DD)
- `endDate` (optional): 종료일 (YYYY-MM-DD)
- `shopNo` (optional): 쇼핑몰 번호 (기본: 1)
- `orderStatus` (optional): 주문 상태 필터 (기본: "N40,N50")
- `useEnvCredentials` (optional): 환경변수 사용 여부 (기본: true)
- `serviceAccountKey` (optional): Google 서비스 계정 키 (JSON 문자열)

**응답 예시**:
```json
{
  "success": true,
  "message": "100개 회원 처리 완료 (구매: 45, 미구매: 52, 오류: 3)",
  "statistics": {
    "total": 100,
    "hasPurchased": 45,
    "notPurchased": 52,
    "errors": 3
  },
  "nextStartRow": 102,
  "processedRange": {
    "startRow": 2,
    "endRow": 101
  },
  "used": {
    "limit": 100,
    "concurrency": 2
  }
}
```

---

## Google Sheets 설정 방법

### 1. 시트 구조 예시

| A (이름) | B (전화번호) | ... | AC (회원ID) | ... | AH (구매여부) | AI (총수량) | AJ (주문수) | AK (상품상세) |
|----------|--------------|-----|-------------|-----|---------------|-------------|-------------|---------------|
| 홍길동   | 010-1234-5678| ... | hong123     | ... | ⭕            | 5           | 2           | 상품A(x2), 상품B(x3) |
| 김철수   | 010-9876-5432| ... | kim456      | ... | ❌            | 0           | 0           |               |

### 2. Google Service Account 설정

1. Google Cloud Console에서 프로젝트 생성
2. Google Sheets API 활성화
3. 서비스 계정 생성 및 JSON 키 다운로드
4. 서비스 계정 이메일을 Google Sheets에 공유 권한 부여 (편집자)

### 3. 환경변수 설정 (선택)

`.env.local` 파일에 추가:
```env
GOOGLE_CRED_JSON=<base64로 인코딩된 서비스 계정 JSON>
```

**Base64 인코딩 방법**:
```bash
# Linux/Mac
base64 -w 0 service-account-key.json

# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account-key.json"))
```

---

## 사용 예시

### cURL로 단일 회원 조회
```bash
curl "http://localhost:3000/api/customer/check-products?member_id=hong123&product_nos=123,456,789&start_date=2024-01-01"
```

### Postman/Insomnia로 배치 처리
```http
POST http://localhost:3000/api/sheets/check-product-purchases
Content-Type: application/json

{
  "spreadsheetId": "1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg",
  "sheetName": "Sheet1",
  "memberIdColumn": "AC",
  "outputStartColumn": "AH",
  "productNos": "123,456,789",
  "startRow": 2,
  "limit": 100,
  "concurrency": 2,
  "useEnvCredentials": true
}
```

### JavaScript/TypeScript 코드 예시
```typescript
async function checkProductPurchases() {
  const response = await fetch('/api/sheets/check-product-purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spreadsheetId: '1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg',
      sheetName: 'Sheet1',
      memberIdColumn: 'AC',
      outputStartColumn: 'AH',
      productNos: '123,456,789',
      startRow: 2,
      limit: 100,
      concurrency: 2,
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      useEnvCredentials: true,
    }),
  });

  const result = await response.json();
  console.log(result);
}
```

---

## 배치 자동 루프 처리

대량 데이터를 처리하려면 `nextStartRow`를 사용하여 반복 호출합니다:

```typescript
async function processAllRows() {
  let currentRow = 2;

  while (currentRow !== null) {
    const response = await fetch('/api/sheets/check-product-purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spreadsheetId: '1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg',
        sheetName: 'Sheet1',
        memberIdColumn: 'AC',
        outputStartColumn: 'AH',
        productNos: '123,456,789',
        startRow: currentRow,
        limit: 100,
        concurrency: 2,
        useEnvCredentials: true,
      }),
    });

    const result = await response.json();
    console.log(`처리 완료: ${result.message}`);

    currentRow = result.nextStartRow; // null이면 종료

    if (currentRow) {
      await new Promise(r => setTimeout(r, 500)); // API 보호용 대기
    }
  }

  console.log('모든 배치 처리 완료!');
}
```

---

## 주의사항

1. **Rate Limiting**: Cafe24 API 제한을 준수하기 위해 `concurrency`는 2~3 권장
2. **배치 크기**: `limit`는 80~120 권장 (너무 크면 타임아웃 발생 가능)
3. **기간 제한**: Cafe24 API는 3개월 단위로 조회하므로, 긴 기간은 자동으로 분할 처리됩니다
4. **상품 번호**: 정확한 상품 번호(product_no)를 사용해야 합니다
5. **주문 상태**: 기본값은 "N40,N50" (배송완료/구매확정)이며, 다른 상태도 지정 가능합니다

---

## 주문 상태 코드

| 코드 | 의미 |
|------|------|
| N00  | 입금전 |
| N10  | 상품준비중 |
| N20  | 배송준비중 |
| N21  | 배송대기 |
| N22  | 배송보류 |
| N30  | 배송중 |
| N40  | 배송완료 |
| N50  | 구매확정 |
| C**  | 취소 관련 |
| R**  | 반품 관련 |
| E**  | 교환 관련 |

---

## 트러블슈팅

### 1. "401 Unauthorized" 오류
- Cafe24 OAuth 토큰이 만료되었습니다
- `/api/oauth/refresh`를 호출하여 토큰 갱신

### 2. "429 Rate Limited" 오류
- Cafe24 API 호출이 너무 많습니다
- `concurrency` 값을 낮추세요 (1~2)
- 재시도는 자동으로 처리됩니다

### 3. Google Sheets 권한 오류
- 서비스 계정 이메일에 시트 편집 권한이 있는지 확인
- `GOOGLE_CRED_JSON` 환경변수가 올바르게 설정되었는지 확인

### 4. 타임아웃 오류
- `limit` 값을 줄이세요 (50~80)
- 기간을 짧게 조정하세요

---

## 성능 최적화 팁

1. **동시성 조정**: 안정적인 처리를 위해 `concurrency: 2` 권장
2. **배치 크기**: 100개씩 처리하는 것이 안정적
3. **기간 설정**: 필요한 기간만 지정하여 불필요한 조회 방지
4. **중단 후 재개**: `nextStartRow`를 기록해두면 중단 지점부터 재시작 가능

---

## 개발자 노트

- 파일 위치:
  - API 라우트: `src/app/api/customer/check-products/route.ts`
  - Google Sheets 통합: `src/app/api/sheets/check-product-purchases/route.ts`
- KST 시간대 자동 처리
- 3개월 윈도우 자동 분할
- Rate limiting 자동 재시도
- Continue-on-error 패턴 적용
