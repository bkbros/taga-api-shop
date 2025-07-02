import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { testOffset = "0", testLimit = "0" } = body;

    console.log("🚀 GitHub Actions 호출 시작...", { testOffset, testLimit });

    // GitHub API를 통해 워크플로우 실행
    const response = await axios.post(
      `https://api.github.com/repos/bkbros-dev/google-to-notion-automation/dispatches`,
      {
        event_type: "run-sync",
        client_payload: {
          test_offset: testOffset,
          test_limit: testLimit,
        },
      },
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ GitHub API 성공:", response.status);

    return NextResponse.json({
      success: true,
      message: "Google to Notion 동기화가 GitHub Actions에서 시작되었습니다!",
      githubResponse: response.status,
    });
  } catch (error: unknown) {
    console.error("❌ GitHub API 오류:", error);

    return NextResponse.json(
      {
        success: false,
        message: `GitHub API 오류: ${error}`,
        error: error || "UNKNOWN",
      },
      { status: 500 },
    );
  }
}

// CORS 처리
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
