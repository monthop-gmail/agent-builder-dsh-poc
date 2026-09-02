# ผลการทดสอบ PoC

รันเมื่อ 2026-09-02 · Node v22.22.2 · commit แรก

## อัตโนมัติ

```
npm run typecheck         exit 0   (src + tests)
npx vitest run            6 files · 45 passed · 5 skipped

  tests/manifest.test.ts       9 passed
  tests/policy.test.ts         6 passed
  tests/portability.test.ts    5 passed
  tests/dsh-runtime.test.ts    8 passed
  tests/mcp-policy.test.ts     8 passed
  tests/conformance.test.ts   14 (9 passed · 5 skipped — ต้องมี credential จริง)
```

`tsconfig.json` เดิม `exclude: ["tests"]` แปลว่า `tsc` ไม่เคยตรวจไฟล์ test เลย
และ vitest ใช้ esbuild ซึ่งไม่สนใจ type — ช่องนี้ปิดแล้วด้วย `tsconfig.test.json`
(ต้อง override `exclude` ด้วย เพราะมัน inherit มาจาก base และชนะ `include`)
พอเปิดใช้ครั้งแรกมันจับ type error ที่ค้างอยู่ได้ทันทีหนึ่งจุด

`dsh-runtime.test.ts` รัน `DshRuntime` ตัวจริงยิงใส่ OpenAI-compatible server จำลองบน
127.0.0.1 ไม่มีการ mock ตัว runtime เลย — fetch เดียวกัน, parse `tool_calls` เดียวกัน,
ต่อ message เดียวกันกับตอนคุยกับ opencode zen หรือ DeepSeek ต่างแค่ปลายทาง
ครอบคลุม: bearer header, tool-call round trip, ชื่อ tool ที่มีจุดถูกแปลงเป็น wire name,
policy หัก tool ไม่ให้ถูกเสนอให้ model, approval deny, tool ที่ไม่มีจริง, tool ที่ error

`describe.each(listRuntimeIds())` ทำให้ conformance suite รันกับทุก runtime ที่ลงทะเบียน
runtime ที่ต้องใช้ key ถูก skip ไม่ใช่ถูกลบ — suite ยังบันทึกไว้ว่ามันติดหนี้อะไรอยู่

## ด้วยมือ

**สลับ target โดย manifest ไม่เปลี่ยน** — DoD ข้อดาว

```
$ build code-reviewer.yaml --target mock  → checksum 49c75878f75b9bed…
$ build code-reviewer.yaml --target dsh   → checksum 49c75878f75b9bed…
$ diff (ตัด target/builtAt ออก)            → ไม่มี diff
```

**policy หัก tool ก่อนถึง runtime**

```
$ inspect code-reviewer.yaml --target dsh
  Tools granted
    ✓ github.read    [read]
    ✓ github.comment [write]  ⚠ needs approval
  # github.merge ไม่ปรากฏ — ถูกหักที่ Builder
```

**approval ทำงานและ deny แล้วหยุดจริง**

```
$ run code-reviewer.yaml --target mock --approve deny --trace
  ↪ auto-denied github.comment (write) — policy.humanApproval
  · approval {"tool":"github.comment","decision":"deny"}
  · finish {"toolCalls":0}
```

**B1 gateway routing**

```
$ inspect researcher.yaml
  ⚠ B1: LLM_GATEWAY_BASE_URL is not set — calling https://api.deepseek.com/v1 directly

$ LLM_GATEWAY_BASE_URL=https://gateway.example/v1 inspect researcher.yaml
  Model  deepseek → deepseek-chat  [gateway] https://gateway.example/v1
```

**`spec.runtime` ถูก reject พร้อมคำอธิบาย**

```
$ validate bad.yaml
  ✗ spec.runtime: a runtime is a build target, not part of the agent.
    Remove it and pass `--target <runtime>` instead.
```

## บั๊กที่เจอและแก้ในรอบนี้

**MCP tool ไม่ผ่าน policy** — `dsh` adapter เดิมทำ
`[...compiled.tools, ...connections.flatMap(c => c.tools)]`
ซึ่งเอา MCP tool ยัดเข้า list ตรง ๆ ไม่ผ่าน `forbidden` filter และไม่เข้า approval gate
(`approvalRequired` มีแต่ชื่อ tool ในเครื่อง) ขัดกับที่ README เคลมว่าใช้เส้นทางเดียวกัน

แก้โดยย้ายการหยิบ MCP tool ไปไว้ที่ `attachMcpServers()` ใน `runtimes/mcp-client.ts`
ที่เดียว แล้วให้มันเรียก `admitLateTools()` เสมอ — adapter ไม่ได้สร้าง MCP tool เองอีกต่อไป
จึงลืมไม่ได้ พิสูจน์ด้วย `mcp-policy.test.ts` ที่ยก MCP server จริง (SDK ฝั่ง server +
Streamable HTTP) ขึ้นมาบน 127.0.0.1 แล้วยืนยันว่า tool ที่ forbid ไม่ปรากฏใน list ที่ adapter ได้

หมายเหตุ implementation: Streamable HTTP โหมด stateless ต้องสร้าง server + transport
**ใหม่ต่อ request** ใช้ตัวเดิมซ้ำจะ 500 ตอน `notifications/initialized`

## opencode zen

`https://opencode.ai/zen/v1` เป็น OpenAI-compatible จึงต่อได้โดยไม่ต้องแก้โค้ด
เพิ่มเข้า catalog แล้วในชื่อ `zen` และใช้เป็น `LLM_GATEWAY_BASE_URL` ได้ตรง ๆ

**ยังยิงจริงไม่ได้จาก sandbox นี้** — network egress policy บล็อก host ไว้:

```
$ agent-builder models --provider zen
could not query https://opencode.ai/zen/v1:
  HTTP 403 — Host not in allowlist: opencode.ai
```

ไม่ใช่ปัญหาของ token — ต้องรันจากเครื่องที่ออกเน็ตหา `opencode.ai` ได้
catalog ไม่ hardcode model id ของ zen ไว้ (รายการที่เสิร์ฟเปลี่ยนได้)
ใช้ `agent-builder models` ถามจาก endpoint แทน

## ยังไม่ได้ทดสอบ

- **DSH กับ model จริงของผู้ให้บริการ** — loop ทดสอบครบแล้วกับ stub server
  เหลือแค่ยืนยันว่า endpoint จริงตอบเหมือนกัน (ต้องมี key + เน็ตที่ไม่ถูกบล็อก)
- **MCP `collaboration` ตัวจริงบน workers.dev** — protocol ทดสอบครบแล้วกับ MCP server จริงบน
  localhost และ tool surface ที่ใช้ตั้ง `toolEffects` ก็อ่านมาจาก server ตัวจริง
  เหลือแค่ยิงข้ามเน็ตไปที่ worker (host โดน egress policy บล็อกจาก sandbox นี้เหมือน opencode.ai)
- **MCP `filesystem`** — ต้องติดตั้ง `@modelcontextprotocol/server-filesystem` เพิ่ม
- **`github.*` tools** — ต้องมี `GITHUB_TOKEN`

สี่ข้อนี้คือรายการที่ต้องเคลียร์ก่อนบอกว่า PoC "รันจริงครบวง"
