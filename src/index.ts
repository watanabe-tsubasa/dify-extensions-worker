import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { generateSchema } from "@anatine/zod-openapi";

type Bindings = {
    TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const schema = z.object({
    // Dify の Moderation API 拡張から送られる point を受け付ける
    point: z.union([
        z.literal("ping"),
        z.literal("app.moderation.input"),
        z.literal("app.moderation.output"),
    ]),
    params: z
        .object({
            app_id: z.string().optional(),
            inputs: z.record(z.any()).optional(),
            query: z.any().optional(), // moderation.input の対象テキスト
            text: z.any().optional(), // moderation.output の対象テキスト
        })
        .optional(),
});

// Generate OpenAPI schema
app.get("/", (c) => {
    return c.json(generateSchema(schema));
});

// 区切り文字（不明なため一般的なものを許容）:
// 半角/全角スペース・各種ハイフン/ダッシュ・マイナス・長音記号・スラッシュ・ドット・中黒
const SEP =
    "[\\s\\u2010-\\u2015\\u2212\\u30fc\\-\\uff0d/\\uff0f.\\uff0e\\u30fb]";

// 12桁の数字（日本のマイナンバーを想定）。連続12桁、または「4桁 区切り 4桁 区切り 4桁」。
// 前後に「(区切り)+数字」が続く場合は、より長い数字列（例: 16桁のカード番号）の
// 一部とみなして除外する。
const myNumberPattern = new RegExp(
    `(?<!\\d)(?<!\\d${SEP})\\d{4}${SEP}?\\d{4}${SEP}?\\d{4}(?!\\d)(?!${SEP}\\d)`,
    "g",
);

const maskMyNumber = (text: string): string =>
    text.replace(myNumberPattern, "************");

// inputs（入力変数）の文字列値をマスクする。文字列以外の値はそのまま保持する。
const maskInputs = (
    inputs: Record<string, unknown>,
): Record<string, unknown> => {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputs)) {
        masked[key] =
            typeof value === "string" ? maskMyNumber(value) : value;
    }
    return masked;
};

app.post(
    "/endpoint",
    (c, next) => {
        const auth = bearerAuth({ token: c.env.TOKEN });
        return auth(c, next);
    },
    zValidator("json", schema),
    async (c) => {
        const { point, params } = c.req.valid("json");

        if (point === "ping") {
            return c.json({ result: "pong" });
        }

        // 入力モデレーション: query と inputs 中のマイナンバーをマスクして処理を続行する
        if (point === "app.moderation.input") {
            const query = typeof params?.query === "string" ? params.query : "";
            const inputs = params?.inputs ?? {};

            const maskedQuery = maskMyNumber(query);
            const maskedInputs = maskInputs(inputs);

            // query・inputs のどちらにも番号が無ければそのまま通す
            const changed =
                maskedQuery !== query ||
                JSON.stringify(maskedInputs) !== JSON.stringify(inputs);
            if (!changed) {
                return c.json({
                    flagged: false,
                    action: "direct_output",
                    preset_response: "",
                });
            }

            // 番号があれば query / inputs を上書きして処理を続行（ブロックではなく置換）
            return c.json({
                flagged: true,
                action: "overridden",
                inputs: maskedInputs,
                query: maskedQuery,
            });
        }

        // 出力モデレーション: 生成結果 text 中のマイナンバーをマスクして表示する
        if (point === "app.moderation.output") {
            const text = typeof params?.text === "string" ? params.text : "";
            const maskedText = maskMyNumber(text);

            if (maskedText === text) {
                return c.json({
                    flagged: false,
                    action: "direct_output",
                    preset_response: "",
                });
            }

            return c.json({
                flagged: true,
                action: "overridden",
                text: maskedText,
            });
        }

        return c.json({ error: "Unsupported point" }, 400);
    },
);

export default app;
