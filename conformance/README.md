# conformance/

ทำตาม [ADR-0006](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0006-contract-versioning.md)
ข้อ 2 — **validate payload จริงกับ schema ที่ pin ไว้**

| ไฟล์ | |
|---|---|
| [`pinned.yaml`](pinned.yaml) | commit ของ `agent-platform` ที่ schema ถูกคัดลอกมา |
| [`schemas/`](schemas/) | สำเนา schema ตามตัวอักษร **ห้ามแก้** |
| [`payload-check.ts`](payload-check.ts) | `npm run conformance` — รันใน CI ทุก PR |
| [`drift-check.ts`](drift-check.ts) | `npm run conformance:drift` — ออกเน็ต **ไม่อยู่ใน gate** |

## payload มาจากการรัน ไม่ใช่จากไฟล์ที่เขียนให้ผ่าน

execution record ที่ถูก validate มาจากการรัน `openai-compatible` runtime จริงกับ stub
ที่ถูกบังคับให้ตอบ 503 — **การย้าย provider ที่ถูกบันทึกจึงเป็นการย้ายที่เกิดขึ้นจริง**
ไม่ใช่ object ที่พิมพ์ขึ้นมาให้ตรง schema

ตรวจสองทางเสมอ: run ที่ไม่ย้ายต้อง **ไม่มี** `provider_switches` เลย (ฝั่ง platform ตั้ง
`minItems: 1` ไว้เพื่อไม่ให้ *"ไม่ได้เกิด"* กับ *"ไม่ได้บันทึก"* เขียนออกมาเหมือนกัน)

## ทำไม vendor แทนที่จะดึงสด

conformance ต้องได้ผลเดิมทุกครั้งและรันได้แม้ออฟไลน์ ถ้าดึงสดทุกรอบ CI จะแดงเพราะเน็ตล่ม
ซึ่ง**สอนคนให้เลิกเชื่อสีแดง** — บทเรียนเดียวกับที่ `agent-platform` เพิ่งแก้ในเครื่องมือ
ของตัวเอง (#49 แยก 404 ออกจาก "ตรวจไม่ได้")

`drift-check.ts` แยกกฎเดียวกันสามทาง:

| | |
|---|---|
| 404 | **drift จริง** — pin ชี้ไปที่ไฟล์ที่ไม่มีแล้ว · exit 1 |
| เนื้อหาต่าง | **drift จริง** — ต้อง re-vendor โดยตั้งใจและอ่าน diff · exit 1 |
| ต่อไม่ได้ | **ไม่ได้ตรวจ** — บอกออกมาแล้ว exit 0 เพราะ *"ยังไม่ได้ตรวจ"* ไม่เท่ากับ *"ตรวจแล้วผ่าน"* |

## สิ่งที่วัดแต่ยังไม่ pin

`agent/v1` ถูกทดสอบทุกรอบทั้งที่ไม่ได้ pin — เพราะ record ของเรายัง validate ไม่ผ่าน
(`tool/v1` `ToolId` บังคับชื่อที่มีจุด ส่วน registry ของเรามีชื่อเปล่า)

**และ check จะ fail ถ้าวันหนึ่งมันผ่าน** เพื่อบังคับให้กลับมา pin แทนที่จะปล่อยให้
`known_gaps` ใน [`../platform-contract.yaml`](../platform-contract.yaml) ค้างอยู่หลังจาก
ช่องว่างถูกปิดไปแล้ว
