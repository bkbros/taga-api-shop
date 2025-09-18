import { NextResponse } from "next/server";

/**
 * 새로운 비동기 회원 검증 API 사용법 데모
 */
export async function GET() {
  const usageExample = {
    title: "비동기 회원 검증 API 사용법",
    description: "Vercel 타임아웃 문제를 해결한 새로운 비동기 방식",

    "1. 작업 시작": {
      method: "POST",
      url: "/api/sheets/verify-members/start",
      body: {
        spreadsheetId: "1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg",
        sheetName: "Smore-5pURyYjo8l-HRG",
        useEnvCredentials: true
      },
      response: {
        success: true,
        jobId: "job_1758174517327_abc123",
        message: "165명의 회원 검증 작업이 시작되었습니다",
        totalMembers: 165
      }
    },

    "2. 진행률 조회": {
      method: "GET",
      url: "/api/sheets/verify-members/status?jobId=job_1758174517327_abc123",
      response: {
        jobId: "job_1758174517327_abc123",
        status: "running",
        progress: 45,
        current: 75,
        total: 165,
        message: "김철수 검증 완료",
        elapsedTime: 120,
        estimatedRemainingTime: 148,
        result: null,
        error: null
      }
    },

    "3. 완료 시 응답": {
      status: "completed",
      progress: 100,
      result: {
        total: 165,
        registered: 142,
        unregistered: 23,
        errors: 0
      }
    },

    "클라이언트 JavaScript 예시": `
// 작업 시작
const startResponse = await fetch('/api/sheets/verify-members/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    spreadsheetId: '1i4zNovtQXwTz0wBUN6chhlqHe3yM_gVRwtC0H73stIg',
    sheetName: 'Smore-5pURyYjo8l-HRG',
    useEnvCredentials: true
  })
});

const { jobId } = await startResponse.json();

// 진행률 폴링
const pollProgress = async () => {
  const statusResponse = await fetch(\`/api/sheets/verify-members/status?jobId=\${jobId}\`);
  const status = await statusResponse.json();

  console.log(\`진행률: \${status.progress}% (\${status.current}/\${status.total})\`);
  console.log(\`메시지: \${status.message}\`);

  if (status.status === 'completed') {
    console.log('완료!', status.result);
    return;
  } else if (status.status === 'failed') {
    console.error('실패:', status.error);
    return;
  }

  // 2초 후 다시 조회
  setTimeout(pollProgress, 2000);
};

pollProgress();
`,

    advantages: [
      "✅ Vercel 타임아웃 제한 없음 (60초 → 무제한)",
      "✅ 실시간 진행률 확인 가능",
      "✅ 800명 이상 대량 처리 안정성",
      "✅ 작업 실패 시 구체적인 오류 정보",
      "✅ 배치 처리로 서버 부하 분산",
      "✅ 클라이언트 측에서 취소/재시작 가능"
    ],

    notes: [
      "작업은 백그라운드에서 실행되므로 브라우저를 닫아도 계속 진행됩니다",
      "jobId는 1시간 동안 유효하며, 그 후 자동으로 정리됩니다",
      "진행률 조회는 2-5초 간격으로 하는 것을 권장합니다",
      "대량 처리 시 5명씩 배치로 나누어 안정성을 보장합니다"
    ]
  };

  return NextResponse.json(usageExample, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}