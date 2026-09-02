# เขียน Runtime Adapter ตัวใหม่

adapter คือสิ่งเดียวที่รู้จัก runtime หนึ่ง ๆ ทุกอย่างเหนือมันเป็น runtime-neutral

## interface

```ts
interface AgentRuntime {
  readonly id: string;
  unsupported(compiled: CompiledAgent): string[];
  createAgent(compiled: CompiledAgent): Promise<AgentHandle>;
  run(agent: AgentHandle, input: string, ctx: RunContext): Promise<AgentResult>;
  resume(sessionId: string): Promise<AgentHandle>;
}
```

**สังเกตสิ่งที่ไม่มี:** ไม่มี `validate(manifest)` และไม่มี `compile(manifest)`
adapter รับ `CompiledAgent` เท่านั้น จึงไม่มีทางงอกพฤติกรรมที่ผูกกับ manifest
ถ้า adapter ทำบางอย่างไม่ได้ ให้คืนชื่อความสามารถนั้นจาก `unsupported()`
เช่น `MockRuntime` คืน `["mcp.connect"]` เพราะมันแค่ list MCP server ไม่ได้ต่อจริง

## สัญญาที่ adapter ต้องรักษา

1. **มอบให้ model เฉพาะ `compiled.tools`** — tool ที่ policy หักไปแล้วไม่มีในนั้น ห้ามเติมเอง
   และห้ามปล่อยให้ built-in tool ของ runtime หลุดเข้ามา
2. **เรียก `ctx.requestApproval` ก่อนทุก tool ที่อยู่ใน `compiled.approvalRequired`**
   ถ้าได้ `deny` ให้บอก model ว่าถูกปฏิเสธ อย่าเงียบ อย่า retry
3. **ส่ง `ctx.onTrace` ทุก event เมื่อ `compiled.audit === true`** และไม่ส่งเลยเมื่อเป็น `false`
4. **`dispose()` ต้องปิด MCP connection ทุกตัว** และไม่ throw

## ขั้นตอน

1. `runtimes/<id>/adapter.ts` — implement interface
2. เพิ่มลง `LOADERS` ใน `builder/registry/runtimes.ts` — **ไฟล์เดียว**
   (validator อ่านรายชื่อจากที่นี่ ไม่มี list ที่สอง)
3. ถ้ารันได้โดยไม่ต้องมี credential ให้ใส่ชื่อใน `OFFLINE_RUNTIMES` ด้วย CI จะได้รันเทสต์
4. `npm test` — `conformance.test.ts` และ `portability.test.ts` จะหยิบ runtime ใหม่ไปทดสอบเอง

## ตัวอย่าง: DSH ทำงานยังไง

`runtimes/dsh/adapter.ts` ขับ OpenAI-compatible chat completions endpoint แล้ววน loop เอง:

```text
system + user
     ↓
POST {baseUrl}/chat/completions  (tools = compiled.tools + MCP tools)
     ↓
มี tool_calls?  ── ไม่ ──→ คืน content
     │ ใช่
     ▼
ต้องขออนุมัติ? ── ใช่ ──→ ctx.requestApproval() ── deny ──→ บอก model แล้วไปต่อ
     │ ไม่ / allow
     ▼
execute → ต่อผลลัพธ์เข้า messages → วนใหม่ (สูงสุด 12 รอบ)
```

ชื่อ tool มีจุด (`github.read`) แต่ OpenAI function name รับแค่ `[A-Za-z0-9_-]`
adapter จึงแปลงเป็น `github_read` ตอนส่ง แล้ว map กลับตอนเรียก — manifest ยังอ่านง่ายเหมือนเดิม

## ถ้ามี DSH SDK จริงในอนาคต

ตอนนี้ `dsh` เป็น agent loop ที่เราเขียนเองบน OpenAI-compatible API เพราะยังไม่มี SDK
วันที่มี SDK จริง **แก้แค่ `runtimes/dsh/adapter.ts` ไฟล์เดียว** manifest, Builder, test ไม่ต้องแตะ
— ซึ่งก็คือสิ่งที่ PoC นี้ตั้งใจพิสูจน์ตั้งแต่ต้น
