import { SSMClient, PutParameterCommand, GetParameterCommand } from "@aws-sdk/client-ssm";

const client = new SSMClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function saveParam(name: string, value: string): Promise<void> {
  await client.send(
    new PutParameterCommand({
      Name: `/cafe24/${name}`,
      Value: value,
      Type: "SecureString",
      Overwrite: true,
    }),
  );
}

// ✅ 여러 개 키를 병렬 저장하는 헬퍼 추가
export async function saveParams(kv: Record<string, string>): Promise<void> {
  await Promise.all(Object.entries(kv).map(([k, v]) => saveParam(k, v)));
}

export async function loadParams(names: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  await Promise.all(
    names.map(async n => {
      const resp = await client.send(
        new GetParameterCommand({
          Name: `/cafe24/${n}`,
          WithDecryption: true,
        }),
      );
      result[n] = resp.Parameter!.Value!;
    }),
  );
  return result;
}
