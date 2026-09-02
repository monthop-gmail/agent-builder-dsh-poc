# Contract Stability

> **สถานะ: `agent/v1alpha2` freeze แล้ว** — ตัดสินโดยทีมเมื่อ 2026-09-02
> ([`ref/2026-09-02-review-03-contract-freeze-decisions.md`](../ref/2026-09-02-review-03-contract-freeze-decisions.md))

Agent Builder มี contract สามชั้นที่คนอื่นพึ่งพาได้ ทั้งสามชั้นนิ่งแล้วภายใต้กติกาข้างล่างนี้

```text
Agent Manifest      agent/v1alpha2      ← สิ่งที่คนเขียน
      ▼
CompiledAgent       contract กลาง       ← สิ่งที่ runtime ได้รับ
      ▼
AgentRuntime        interface           ← สิ่งที่ adapter ต้องทำ
```

## 1. Manifest — freeze ที่ `v1alpha2` ไม่ bump เป็น `v1`

> `v1alpha2` is the frozen contract for the current Agent Builder PoC.
> Promotion to `agent/v1` is a separate compatibility milestone and is not
> required for integration with `agent-platform`.

การ freeze กับการย้ายเข้า `agent-platform` เป็นคนละเรื่อง — ผูกสองอย่างนี้เข้าด้วยกัน
จะได้ version bump ที่เกิดจากเหตุการณ์ทางองค์กร ไม่ใช่จากการที่ contract เปลี่ยนจริง

ตอนโปรโมตเป็น `agent/v1` ต้องมี migration guide และ compatibility test รองรับ

## 2. อะไรคือ breaking

**ไม่ได้วัดจากการเพิ่ม symbol แต่วัดจาก observable behavior ของ manifest ที่มีอยู่แล้ว**

```text
Manifest A  →  build สำเร็จ          (เมื่อวาน)
Manifest A  →  build ไม่ผ่าน          (วันนี้)     = breaking
```

แม้ TypeScript API จะไม่ขยับเลยแม้แต่บรรทัดเดียว

### CompiledAgent

| การเปลี่ยน | breaking? |
|---|---|
| เพิ่ม optional field | ❌ |
| เพิ่ม required field | ✅ |
| เปลี่ยนความหมายของ field เดิม | ✅ |
| เปลี่ยน type ของ field | ✅ |
| ลบ field | ✅ |
| เปลี่ยน allowed value ให้ consumer เดิมใช้ไม่ได้ | ✅ |
| เพิ่มค่า enum ที่ consumer ต้อง handle ให้ครบ | ⚠️ ถือเป็น breaking |

### AgentRuntime

| การเปลี่ยน | breaking? |
|---|---|
| เพิ่ม capability ใหม่แบบ optional | ❌ |
| เพิ่ม `unsupported()` case สำหรับ capability ใหม่ที่เดิมไม่เคยรองรับ | ❌ |
| เพิ่ม `unsupported()` case ที่ทำให้ manifest เดิม build/run ไม่ได้ | ✅ |
| เปลี่ยน severity จาก warning → error | ✅ |
| เปลี่ยน policy ให้ restrictive ขึ้น | ✅ |

**ห้าม bump version เพียงเพราะเพิ่ม field หรือ capability แบบ backward-compatible**

## 3. บังคับด้วยอะไร

```text
tests/compatibility/manifests/    manifest ที่ freeze ไว้ — ห้ามแก้
tests/compatibility/baseline.json สิ่งที่ Builder ทำกับมัน ณ วันที่ freeze
tests/contract-stability.test.ts  เทียบของวันนี้กับ baseline
```

`baseline.json` บันทึกต่อ manifest หนึ่งไฟล์:

- `manifestChecksum` — ล็อกไว้ ถ้า fixture ถูกแก้ test จะฟ้องว่า **แก้ fixture** ไม่ใช่ **แก้ compiler**
- ผลของ Builder ทั้งชุด — tools, approval, policy, autonomy, model route, audit
- ต่อ runtime: `unsupported()` คืออะไร และมันทำให้ **ปฏิเสธการรัน** หรือไม่

test ถามสี่คำถาม:

1. manifest ที่เคย compile ได้ ยัง compile ได้ไหม
2. ได้ `CompiledAgent` เหมือนเดิมไหม
3. runtime ไหนเริ่มปฏิเสธ manifest ที่เคยรับได้ไหม
4. runtime ไหนเพิ่ม gap ที่กระทบ manifest เดิมไหม

ข้อ 3 กับ 4 คือที่ที่ "behavioral compatibility" ถูกบังคับจริง — เปลี่ยน severity ของ
capability gap หนึ่งตัวจาก `degrades` เป็น `blocks` โดยไม่แตะ API เลย test จะล้มทันที
พร้อมข้อความว่า:

```
'acp' now refuses 'v1alpha2-mcp.yaml', which it used to run — that is a breaking change
```

### conformance vectors เป็น regression baseline อีกชั้น

[`tests/conformance/`](../tests/conformance/) ต้องผ่านทุก runtime เสมอ
vector **ปรับได้**เมื่อเข้าใจเรื่องที่มันทดสอบดีขึ้น ส่วน compatibility fixture **ปรับไม่ได้**
— ของเก่าที่ยังต้องใช้ได้ คือทั้งหมดของความหมายมัน

## 4. เมื่อ test ล้ม

มีสองความเป็นไปได้ และต้องการคำตอบคนละแบบ:

```text
การเปลี่ยนที่ไม่ได้ตั้งใจให้ break แต่ break   →  แก้การเปลี่ยนนั้น
contract เปลี่ยนจริง                          →  bump version, เขียนเหตุผล,
                                                 แล้วค่อย npm run compat:baseline
```

**การ regenerate baseline เพื่อให้ test เขียว เป็นคำตอบเดียวที่ผิดเสมอ**

## อ่านต่อ

- [`manifest.md`](manifest.md) — Agent Manifest `agent/v1alpha2`
- [`compiled-agent-contract.md`](compiled-agent-contract.md) — CompiledAgent
- [`runtime-adapter.md`](runtime-adapter.md) — AgentRuntime
- [`capability-matrix.md`](capability-matrix.md) — target ไหน honour อะไรได้
