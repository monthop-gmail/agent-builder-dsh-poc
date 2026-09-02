# Capability Matrix

> **สร้างจากโค้ด อย่าแก้ด้วยมือ** — `npm run docs:capabilities`
> `capability-matrix.test.ts` จะล้มถ้าไฟล์นี้ไม่ตรงกับสิ่งที่ adapter รายงานจริง

ตารางนี้ตอบคำถามเดียว: **ถ้า manifest ขอสิ่งนี้ target ไหน honour ได้บ้าง**

ทุกช่องมาจากการเรียก `unsupported()` ของ adapter จริงด้วย manifest ตัวเดียว
([`tests/fixtures/capability-probe.yaml`](../tests/fixtures/capability-probe.yaml))
ที่ขอทุกอย่างพร้อมกัน — ✅ คือ honour ได้ ❌ คือ adapter ประกาศเองว่าทำไม่ได้

| capability | ถ้าทำไม่ได้ | acp | dsh | mock | openai-compatible | pi |
|---|---|---|---|---|---|---|
| `mcp.connect` | ⚠ degrades | ✅ | ✅ | ❌ | ✅ | ✅ |
| `model.fallback` | ⚠ degrades | ✅ | ✅ | ✅ | ✅ | ❌ |
| `policy.forbidden` | ⛔ blocks | ❌ | ❌ | ✅ | ✅ | ✅ |
| `policy.humanApproval` | ⛔ blocks | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tools.local` | ⚠ degrades | ❌ | ❌ | ✅ | ✅ | ✅ |
| `trace.model_step` | ⚠ degrades | ✅ | ✅ | ✅ | ✅ | ❌ |

## ช่องว่างแต่ละอันแปลว่าอะไร

- `mcp.connect` — MCP servers are listed but never dialled, so their tools are absent
- `model.fallback` — only the first entry of spec.model.preferred is reachable
- `policy.forbidden` — the manifest forbids tools this target cannot withhold — the agent can reach them anyway
- `policy.humanApproval` — this target cannot ask a human before a gated tool runs
- `tools.local` — granted tools defined here cannot cross into this target; only MCP capability does
- `trace.model_step` — the audit trail records the turn and its tool calls, but not each model step

## ⛔ กับ ⚠ ต่างกันอย่างไร

> ช่องว่างที่ทำให้**ข้อจำกัด**หายไป → ปฏิเสธไม่ให้รัน
> ช่องว่างที่ทำให้**ความสามารถ**หายไป → เตือนแล้วรันต่อ

กติกาเต็มอยู่ใน [`runtime-adapter.md`](runtime-adapter.md) และ
[`poc-review-2026-09-02.md` §13](poc-review-2026-09-02.md)
