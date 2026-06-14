import { describe, it, expect } from "vitest";
import app from "./index";

const TOKEN = "test-token";
const env = { TOKEN };

/** /endpoint に認証付きで POST するヘルパー */
function post(body: unknown, token: string = TOKEN) {
  return app.request(
    "/endpoint",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    env
  );
}

describe("auth", () => {
  it("トークン無しは 401", async () => {
    const res = await app.request(
      "/endpoint",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ point: "ping" }),
      },
      env
    );
    expect(res.status).toBe(401);
  });

  it("不正なトークンは 401", async () => {
    const res = await post({ point: "ping" }, "wrong-token");
    expect(res.status).toBe(401);
  });
});

describe("ping", () => {
  it("pong を返す", async () => {
    const res = await post({ point: "ping" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "pong" });
  });
});

describe("validation", () => {
  it("未知の point は 400", async () => {
    const res = await post({ point: "unknown.point" });
    expect(res.status).toBe(400);
  });
});

describe("app.moderation.input — マイナンバーのマスク", () => {
  async function moderate(
    query: string,
    inputs?: Record<string, unknown>
  ): Promise<any> {
    const res = await post({
      point: "app.moderation.input",
      params: { query, inputs },
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("連続12桁を検出し overridden で query を上書きする", async () => {
    const body = await moderate("私のマイナンバーは123456789012です");
    expect(body).toEqual({
      flagged: true,
      action: "overridden",
      inputs: {},
      query: "私のマイナンバーは************です",
    });
  });

  it("番号を含まない inputs はそのまま引き継ぐ", async () => {
    const body = await moderate("番号は1234-5678-9012です", { name: "太郎" });
    expect(body.flagged).toBe(true);
    expect(body.action).toBe("overridden");
    expect(body.inputs).toEqual({ name: "太郎" });
    expect(body.query).toBe("番号は************です");
  });

  it("inputs 内のマイナンバーもマスクする", async () => {
    const body = await moderate("特になし", {
      my_number: "123456789012",
      memo: "区切りは1234-5678-9012",
      age: 30,
    });
    expect(body.flagged).toBe(true);
    expect(body.action).toBe("overridden");
    expect(body.inputs).toEqual({
      my_number: "************",
      memo: "区切りは************",
      age: 30, // 文字列以外はそのまま
    });
  });

  it("query が綺麗でも inputs に番号があれば overridden になる", async () => {
    const body = await moderate("普通の質問です", {
      doc_id: "123456789012",
    });
    expect(body.flagged).toBe(true);
    expect(body.action).toBe("overridden");
    expect(body.query).toBe("普通の質問です");
    expect(body.inputs).toEqual({ doc_id: "************" });
  });

  it.each([
    ["スラッシュ", "1234/5678/9012", "************"],
    ["スペース", "1234 5678 9012", "************"],
    ["中黒", "1234・5678・9012", "************"],
  ])("4桁区切り(%s)を検出する", async (_label, input, expected) => {
    const body = await moderate(input);
    expect(body.query).toBe(expected);
  });

  it("複数のマイナンバーをすべて検出する", async () => {
    const body = await moderate("123456789012と000011112222");
    expect(body.query).toBe("************と************");
  });

  it.each([
    ["番号なし", "ただのテキストです"],
    ["カード番号(4-4-4-4)", "カード番号1234 5678 9012 3456"],
    ["電話番号(3-4-4)", "電話090-1234-5678"],
    ["13桁", "1234567890123"],
  ])("%s は direct_output でそのまま通す", async (_label, input) => {
    const body = await moderate(input);
    expect(body).toEqual({
      flagged: false,
      action: "direct_output",
      preset_response: "",
    });
  });

  it("query が無い場合はそのまま通す", async () => {
    const res = await post({ point: "app.moderation.input", params: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      flagged: false,
      action: "direct_output",
      preset_response: "",
    });
  });
});

describe("app.moderation.output — 出力のマスク", () => {
  async function moderate(text: string): Promise<any> {
    const res = await post({
      point: "app.moderation.output",
      params: { text },
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("検出時は overridden で text を上書きする", async () => {
    const body = await moderate("結果: 1234-5678-9012");
    expect(body).toEqual({
      flagged: true,
      action: "overridden",
      text: "結果: ************",
    });
  });

  it("番号なしは direct_output でそのまま通す", async () => {
    const body = await moderate("普通の出力テキスト");
    expect(body).toEqual({
      flagged: false,
      action: "direct_output",
      preset_response: "",
    });
  });
});
