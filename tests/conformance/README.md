# tests/conformance/

ชุด **test vector กลาง** ที่ runtime ทุกตัวถูกทดสอบด้วยชุดเดียวกัน — เพื่อให้
"ผ่านบน Pi" กับ "ผ่านบน DSH" แปลว่าเรื่องเดียวกัน

```text
                    vectors/*.yaml
                          │
        ┌────────┬────────┼────────┬────────┐
        ▼        ▼        ▼        ▼        ▼
      mock  openai-compat  pi      acp      dsh
        └────────┴────────┼────────┴────────┘
                          ▼
                  conformance.test.ts
```

## ทำไมไม่ใช้ `manifests/`

`manifests/` คือ **ตัวอย่างให้คนก๊อป** — มันถูกแก้เพื่อให้อ่านง่ายขึ้น เพิ่ม comment
เปลี่ยนชื่อ tool ให้สื่อความ ซึ่งทั้งหมดนั้นเปลี่ยนสิ่งที่ suite พิสูจน์โดยไม่มีใครตั้งใจ

fixture ที่ทำหน้าที่เป็นเอกสารไปด้วย จะถูกแก้ในฐานะเอกสารเสมอ

## แต่ละ vector แยกเรื่องเดียว

| vector | แยกอะไร |
|---|---|
| `minimal` | manifest ที่ไม่ขออะไรนอกจาก model |
| `observer` | autonomy 0 — แม้ tool ที่ read ก็ต้องขออนุมัติ |
| `reader` | autonomy 1 — read ทำเองได้ |
| `proposer` | autonomy 2 — write ทำเองได้ irreversible ต้องถาม |
| `actor` | autonomy 3 — ไม่มีอะไรต้องถาม |
| `approval` | `humanApproval` เหนือกว่า autonomy |
| `forbidden` | `policy.forbidden` ไม่มีวันไปถึง runtime |
| `fallback` | `spec.model.preferred` เป็น chain ไม่ใช่ตัวเลือก |
| `audit-on` / `audit-off` | สองด้านของสวิตช์เดียวกัน |
| `mcp` | MCP server ที่ต้อง connect จริง |

## vector ก็ถูกทดสอบเหมือนกัน

[`vectors.ts`](vectors.ts) ประกาศไว้ว่าแต่ละ vector ต้อง compile ออกมาเป็นอะไร
และ [`vectors.test.ts`](vectors.test.ts) ตรวจก่อนที่ runtime ไหนจะได้เห็น

เพราะ fixture ที่เลิกทดสอบสิ่งที่ชื่อมันบอก **จะไม่ล้ม** — มันจะผ่านทุกที่ด้วยเหตุผลที่ผิด
แล้วพา coverage หายไปเงียบ ๆ

`vectors.test.ts` ยังตรวจชุดโดยรวมด้วยว่า autonomy ครบทั้ง 4 ระดับ และทุกสวิตช์
มีทั้งด้านเปิดและปิด — suite ที่เห็นแต่ `audit: true` จับ runtime ที่ trace ตลอดเวลาไม่ได้

## เพิ่ม vector ใหม่

1. เขียน `.yaml` ใน `vectors/` แยกเรื่องเดียว
2. ลงทะเบียนใน `VECTORS` พร้อม `expected` ว่า Builder ต้องได้อะไรออกมา
3. `npm test` — ทั้ง `vectors.test.ts` และ `conformance.test.ts` หยิบไปใช้เอง

## fixture ที่ไม่ได้อยู่ที่นี่

`tests/fixtures/` ยังมี fixture เฉพาะทางอยู่ ไม่ใช่ทุกอย่างควรเป็น vector กลาง:

| | |
|---|---|
| `gated-observer.yaml` | autonomy 0 **+ audit เปิด** — เทสต์ของ pi และ resilience ต้องการทั้งคู่พร้อมกัน ซึ่งไม่ใช่การแยกเรื่องเดียว |
| `capability-probe.yaml` | ขอทุกอย่างพร้อมกัน เพื่อให้ `unsupported()` ตอบครบในครั้งเดียว — ตรงข้ามกับหลักของ vector โดยตั้งใจ |
