# ผลการทดสอบ PoC

รันเมื่อ 2026-09-02 · Node v22.22.2 · commit แรก

## อัตโนมัติ

```
npx tsc --noEmit          exit 0
npx vitest run            4 files · 29 passed · 5 skipped

  tests/manifest.test.ts       9 passed
  tests/policy.test.ts         6 passed
  tests/portability.test.ts    5 passed
  tests/conformance.test.ts   14 (9 passed · 5 skipped — dsh ต้องมี credential)
```

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

## ยังไม่ได้ทดสอบ

- **DSH runtime กับ model จริง** — ต้องมี `DEEPSEEK_API_KEY` หรือ gateway ที่เข้าถึงได้
  โค้ด path ทั้งหมดเขียนแล้วและ typecheck ผ่าน แต่ยังไม่มีใครยิงจริง
- **MCP `collaboration`** — ต้องมี `AI_COLLAB_MCP_TOKEN`
- **MCP `filesystem`** — ต้องติดตั้ง `@modelcontextprotocol/server-filesystem` เพิ่ม
- **`github.*` tools** — ต้องมี `GITHUB_TOKEN`

สี่ข้อนี้คือรายการที่ต้องเคลียร์ก่อนบอกว่า PoC "รันจริงครบวง"
