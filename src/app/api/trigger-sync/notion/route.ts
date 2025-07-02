import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { testOffset = "0", testLimit = "0" } = body;

    const response = await axios.post(
      `https://api.github.com/repos/bkbros/google-to-notion-automation/dispatches`,
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

    if (response.status === 204) {
      return NextResponse.json({
        success: true,
        message: "GitHub Actions 워크플로우가 시작되었습니다!",
      });
    } else {
      throw new Error(`GitHub API 오류: ${response.status}`);
    }
  } catch (error: unknown) {
    console.error("Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: `오류 발생: ${error}`,
      },
      { status: 500 },
    );
  }
}

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
