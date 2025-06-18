// src/lib/ssm.ts
import { SSMClient, PutParameterCommand, GetParametersCommand, GetParameterCommand } from "@aws-sdk/client-ssm";

const client = new SSMClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function saveParam(name: string, value: string): Promise<void> {
  try {
    await client.send(
      new PutParameterCommand({
        Name: `/cafe24/${name}`,
        Value: value,
        Type: "SecureString",
        Overwrite: true,
      }),
    );
    console.log(`✅ Saved SSM parameter /cafe24/${name}`);
  } catch (e) {
    console.error(`❌ Failed to save SSM parameter /cafe24/${name}`, e);
    throw e;
  }
}

export async function loadParams(names: string[]): Promise<Record<string, string>> {
  try {
    const resp = await client.send(
      new GetParametersCommand({
        Names: names.map(n => `/cafe24/${n}`),
        WithDecryption: true,
      }),
    );
    const result: Record<string, string> = {};
    (resp.Parameters ?? []).forEach(p => {
      const key = p.Name!.split("/").pop()!;
      result[key] = p.Value!;
    });
    console.log("✅ Loaded SSM parameters:", Object.keys(result));
    return result;
  } catch (e) {
    console.error("❌ Failed to load SSM parameters", names, e);
    throw e;
  }
}
