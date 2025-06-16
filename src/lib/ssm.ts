// src/lib/ssm.ts
import { SSMClient, PutParameterCommand, GetParametersCommand } from "@aws-sdk/client-ssm";

const client = new SSMClient({ region: process.env.AWS_REGION });

export async function saveParam(name: string, value: string) {
  await client.send(
    new PutParameterCommand({
      Name: `/cafe24/${name}`,
      Value: value,
      Type: "SecureString",
      Overwrite: true,
    }),
  );
}

export async function loadParams(names: string[]) {
  const resp = await client.send(
    new GetParametersCommand({
      Names: names.map(n => `/cafe24/${n}`),
      WithDecryption: true,
    }),
  );
  return (
    resp.Parameters?.reduce<Record<string, string>>((acc, p) => {
      const key = p.Name!.split("/").pop()!;
      acc[key] = p.Value!;
      return acc;
    }, {}) || {}
  );
}
