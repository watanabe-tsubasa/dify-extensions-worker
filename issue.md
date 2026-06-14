なるほど、原因かなり見えました。
今の実装は **外部データツール用の API 拡張** の形になっていて、**moderation 用の API 拡張レスポンス形式になっていない**です。

今のコードだとここがポイントです。

```ts
point: z.union([z.literal("ping"), z.literal("app.external_data_tool.query")]);
```

この schema では、Dify から moderation 用に送られてくる

```txt
app.moderation.input
app.moderation.output
```

を受け付けられません。

そのため、Dify から `app.moderation.input` が来た時点で `zValidator` が弾いて、400 になっている可能性が高いです。

さらに、返却も今はこうなっています。

```ts
return c.json({
    result,
});
```

これは `app.external_data_tool.query` 用の返し方です。
moderation の場合は、`result` ではなく、たとえば **マスクして通す** ならこう返す必要があります。

```json
{
    "flagged": true,
    "action": "overridden",
    "inputs": {},
    "query": "マスク後の入力文"
}
```

つまり今回やりたいことは、Dify 的にはこうです。

```txt
入力に12桁番号がある
↓
API拡張で検知
↓
query をマスク済み文字列に差し替える
↓
そのままフロー継続
```

なので `action: "overridden"` を使います。

---

## 修正版イメージ

入力 moderation 用に寄せるなら、まずはこんな感じが良いです。

```ts
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
    point: z.union([
        z.literal("ping"),
        z.literal("app.external_data_tool.query"),
        z.literal("app.moderation.input"),
        z.literal("app.moderation.output"),
    ]),
    params: z
        .object({
            app_id: z.string().optional(),
            tool_variable: z.string().optional(),
            inputs: z.record(z.any()).optional(),
            query: z.any().optional(),
            text: z.any().optional(),
        })
        .optional(),
});

app.get("/", (c) => {
    return c.json(generateSchema(schema));
});

const SEP =
    "[\\s\\u2010-\\u2015\\u2212\\u30fc\\-\\uff0d/\\uff0f.\\uff0e\\u30fb]";

const myNumberPattern = new RegExp(
    `(?<!\\d)(?<!\\d${SEP})\\d{4}${SEP}?\\d{4}${SEP}?\\d{4}(?!\\d)(?!${SEP}\\d)`,
    "g",
);

const maskMyNumber = (text: string) => {
    return text.replace(myNumberPattern, "************");
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
            return c.json({
                result: "pong",
            });
        }

        if (point === "app.moderation.input") {
            const query = typeof params?.query === "string" ? params.query : "";
            const maskedQuery = maskMyNumber(query);
            const flagged = maskedQuery !== query;

            if (!flagged) {
                return c.json({
                    flagged: false,
                    action: "direct_output",
                    preset_response: "",
                });
            }

            return c.json({
                flagged: true,
                action: "overridden",
                inputs: params?.inputs ?? {},
                query: maskedQuery,
            });
        }

        if (point === "app.moderation.output") {
            const text = typeof params?.text === "string" ? params.text : "";
            const maskedText = maskMyNumber(text);
            const flagged = maskedText !== text;

            if (!flagged) {
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

        if (point === "app.external_data_tool.query") {
            const source =
                typeof params?.query === "string" ? params.query : "";
            const result = maskMyNumber(source);

            return c.json({
                result,
            });
        }

        return c.json(
            {
                error: "Unsupported point",
            },
            400,
        );
    },
);

export default app;
```

---

## 今回の用途だけなら、もっとシンプルでOK

今回やりたいのが **入力されたマイナンバーっぽい番号をマスクして通す** だけなら、`external_data_tool.query` は一旦いらないです。

```ts
point: z.union([z.literal("ping"), z.literal("app.moderation.input")]);
```

だけでよいです。

返却もこの 2 パターンだけでOKです。

### 番号がなかった場合

```ts
return c.json({
    flagged: false,
    action: "direct_output",
    preset_response: "",
});
```

### 番号があった場合

```ts
return c.json({
    flagged: true,
    action: "overridden",
    inputs: params?.inputs ?? {},
    query: maskedQuery,
});
```

---

## `direct_output` と `overridden` の使い分け

ここが教材的にも大事です。

| やりたいこと                     | action          | 返す内容          |
| -------------------------------- | --------------- | ----------------- |
| ブロックして代替メッセージを表示 | `direct_output` | `preset_response` |
| 入力を書き換えて処理を続ける     | `overridden`    | `query`, `inputs` |
| 出力を書き換えて表示する         | `overridden`    | `text`            |

今回の「マスクしてそのまま通す」は、**ブロックではなく上書き**なので、

```txt
action: "overridden"
```

が合っています。

---

## 研修デモとしての見せ方

入力：

```txt
マイナンバーは 1234-5678-9012 です。この内容を要約してください。
```

API拡張後に Dify へ渡る query：

```txt
マイナンバーは ************ です。この内容を要約してください。
```

これなら、

> キーワード検閲では「マイナンバー」という単語を止められる
> API拡張では、12桁の番号形式を検知してマスキングできる

という違いがかなり綺麗に見せられます。

今のコードは **マスク処理自体はかなり良い**です。
直すべき本丸は、`point` の追加と、moderation 用レスポンス形式への変更ですね。
