# เขียน Runtime Adapter ตัวใหม่

adapter คือสิ่งเดียวที่รู้จัก runtime หนึ่ง ๆ ทุกอย่างเหนือมันเป็น runtime-neutral

## interface

```ts
interface AgentRuntime {
  readonly id: string;
  unsupported(compiled: CompiledAgent): string[];
  createAgent(compiled: CompiledAgent): Promise<AgentHandle>;
  run(agent: AgentHandle, input: string, ctx: RunContext): Promise<AgentResult>;
  resume(compiled: CompiledAgent, sessionId: string): Promise<AgentHandle>;
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
3. ใส่ชื่อใน `OFFLINE_RUNTIMES` — conformance ยก endpoint ปลอมบน 127.0.0.1 แล้วชี้
   `LLM_GATEWAY_BASE_URL` ไปที่นั่นให้เอง ดังนั้น "ต้องใช้ key" ไม่ใช่เหตุผลที่จะข้าม
   **runtime ที่ไม่อยู่ในลิสต์นี้ คือ runtime ที่ไม่มีใครทดสอบ** และมันหน้าตาเหมือนผ่าน
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
จึงแปลงเป็น `github_read` ตอนส่ง แล้ว map กลับตอนเรียก — manifest ยังอ่านง่ายเหมือนเดิม
การแปลงอยู่ที่ `builder/tool-names.ts` **ไม่ใช่ในตัว adapter** เพราะ `policy.forbidden`
กับ `approvalRequired` เขียนด้วยชื่อใน manifest — adapter ที่แปลงคนละแบบจะเลิกตรงกับ policy ของตัวเอง

## ตัวอย่างที่สอง: Pi — เมื่อ vendor เป็นเจ้าของ loop

`runtimes/pi/adapter.ts` ต่างจาก `dsh` ตรงที่ **เราไม่ได้เป็นเจ้าของ loop** Pi เป็นคนวน
สิ่งที่ adapter ยังเป็นเจ้าของเต็ม ๆ คือ **พื้นผิวของ tool** และสัญญาทั้งหมดอยู่ตรงนั้น

| ข้อผูกพัน | ทำที่ไหนใน `dsh` | ทำที่ไหนใน `pi` |
|---|---|---|
| ยื่นเฉพาะ `compiled.tools` | สร้าง `tools` array เอง | `noTools: "all"` + allowlist ตอน `createAgentSession` |
| ขออนุมัติก่อน tool ที่ gated | ก่อน dispatch ใน loop ตัวเอง | ใน `execute` ของ tool ที่ adapter เขียนเอง |
| model ที่ Builder เลือก | ใส่ใน body ของ request | `registerProvider()` จาก `ModelBinding` |

ข้อสองคือข้อที่คนมักคิดว่าทำไม่ได้ Pi ไม่มี permission system เป็นของตัวเอง — แต่ adapter
เป็นคนเขียน `execute` ของทุก tool จึงดักก่อน side effect ได้ **การปฏิเสธจึงหมายความว่า
tool ไม่เคยทำงาน** ไม่ใช่แค่บอก model ว่าไม่ควรทำ

ข้อสามคือจุดที่ predecessor พลาด: มันเรียก catalog ของ pi-ai แล้ว `.catch(() => undefined)`
ซึ่งแปลว่า manifest ระบุ model ตัวหนึ่งแต่รันด้วยอีกตัวโดยไม่มีใครรู้ adapter นี้ไม่แตะ catalog
ของ Pi เลย — `ModelBinding` เป็นแหล่งเดียว ไม่มีอะไรให้ fallback ไปหา

## ตัวอย่างที่สาม: ACP — เมื่อ agent เป็นของคนอื่นทั้งตัว

`runtimes/acp/adapter.ts` ไม่ได้รัน agent แต่เป็น client ของ agent ที่พูด Agent Client Protocol
adapter จึงไม่ได้เป็นเจ้าของทั้ง loop และ **พื้นผิว tool** — ต่างจาก `pi` ตรงนี้

| | `dsh` | `pi` | `acp` |
|---|---|---|---|
| เจ้าของ loop | เรา | vendor | vendor |
| เจ้าของพื้นผิว tool | เรา | **เรา** | vendor |
| บังคับ `tools.allowed` | ✅ | ✅ | ❌ |
| บังคับ `policy.forbidden` | ✅ | ✅ | ❌ |
| บังคับ `humanApproval` | ✅ | ✅ | ✅ (ผ่าน `session/request_permission`) |
| `resume()` | ❌ | ❌ | ✅ |

เส้นแบ่งจริงคือ **ใครเป็นเจ้าของพื้นผิว tool** ไม่ใช่ใครเป็นเจ้าของ loop
`pi` บังคับ policy ได้ทั้งที่ Pi ไม่มี permission system เพราะ adapter เขียน `execute` เอง
`acp` บังคับไม่ได้เพราะ tool มาจาก agent ปลายทาง adapter ไม่มีอะไรให้ห่อ

สิ่งที่ทำได้คือ **ประกาศ** ผ่าน `unsupported()` — `tools.local` และ `policy.forbidden`
adapter ที่เงียบจะทำให้ manifest ดูเหมือนถูกบังคับใช้ทั้งที่ไม่ได้

### ทำไม `resume()` ต้องรับ CompiledAgent

session id ไม่ได้พก policy มาด้วย ถ้า resume จาก id อย่างเดียว handle ที่ได้จะมี approval rule
มาจากที่ที่ runtime บังเอิญเก็บไว้ ซึ่งเป็นสิ่งที่ Builder ตั้งใจเป็นเจ้าของตั้งแต่ต้น
signature จึงเป็น `resume(compiled, sessionId)` — manifest ถูก compile ใหม่และบังคับใหม่ทุกครั้ง

## เรื่องชื่อ `dsh`

`dsh` ตอนนี้ **ไม่ได้ต่อกับ DeepSeek Harness** มันคือ agent loop ที่เราเขียนเองบน
OpenAI-compatible API ซึ่งใช้งานได้ดีและครอบคลุม gateway ทุกตัว แต่ชื่อไม่ตรงของ

DeepSeek Harness ตัวจริงมีอยู่ (`deepseek-ai/deepseek-harness`) และต่อได้ผ่าน ACP —
ทดสอบแล้วใน [`../spikes/acp/`](../spikes/acp/) ผลและข้อจำกัดอยู่ใน
[`poc-review-2026-09-02.md` หัวข้อ 9](poc-review-2026-09-02.md)

ข้อเสนอคือแยกเป็น `openai-compatible` / `acp` / `dsh` — เหตุผลอยู่ในหัวข้อ 5.6 ของบันทึกเดียวกัน
