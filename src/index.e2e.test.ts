import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * デプロイ済み Worker への疎通(E2E)テスト。
 *
 * 秘密情報はコードに書かず、次のいずれかで渡す:
 *   A) 環境変数で直接渡す
 *      WORKER_URL="https://..." TOKEN="xxx" npm run test:e2e
 *   B) プロジェクト直下に .env（gitignore 済み）を置く
 *      WORKER_URL=https://dify-extensions-worker.<subdomain>.workers.dev
 *      TOKEN=xxxxxxxx
 *      → npm run test:e2e
 *
 * WORKER_URL / TOKEN が無い場合はスキップする（CI で秘密情報が無くても落ちない）。
 */

// .env を読み込む（既に process.env にある値は上書きしない）。dotenv 非依存の最小実装。
function loadDotEnv(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch {
    return; // .env が無ければ何もしない
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const key = m[1];
    const value = m[2].replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const WORKER_URL = process.env.WORKER_URL?.replace(/\/$/, "");
const TOKEN = process.env.TOKEN;
const configured = Boolean(WORKER_URL && TOKEN);
const ENDPOINT = `${WORKER_URL}/endpoint`;

function post(body: unknown, token = TOKEN) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!configured)("E2E: デプロイ済み Worker への疎通", () => {
  it("ping -> pong", async () => {
    const res = await post({ point: "ping" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "pong" });
  });

  it("moderation.input: マイナンバーを overridden で上書きする", async () => {
    const res = await post({
      point: "app.moderation.input",
      params: { query: "私のマイナンバーは1234-5678-9012です" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      flagged: true,
      action: "overridden",
      inputs: {},
      query: "私のマイナンバーは************です",
    });
  });

  it("moderation.input: 番号なしは direct_output で素通しする", async () => {
    const res = await post({
      point: "app.moderation.input",
      params: { query: "ただのテキストです" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      flagged: false,
      action: "direct_output",
      preset_response: "",
    });
  });

  it("不正なトークンは 401", async () => {
    const res = await post({ point: "ping" }, "wrong-token");
    expect(res.status).toBe(401);
  });
});

// 未設定時に「黙ってスキップ」されると気づきにくいので、明示的に通知する。
describe.runIf(!configured)("E2E (skipped)", () => {
  it("WORKER_URL / TOKEN 未設定のためスキップ", () => {
    console.warn(
      "[e2e] WORKER_URL / TOKEN が未設定のため E2E をスキップしました。.env か環境変数で指定してください。"
    );
    expect(configured).toBe(false);
  });
});
