# ต่อกับ `agent-platform` — ช่องว่างที่มีจริง

> **สถานะ: ยังไม่ conform และยังไม่ควรอ้างว่า conform**
> repo นี้ยังไม่มี `platform-contract.yaml` โดยตั้งใจ — เหตุผลอยู่ท้ายหน้า

[`agent-platform`](https://github.com/monthop-gmail/agent-platform) เป็นเจ้าของ contract
ของ ecosystem (L3) และ **มี contract ชื่อ `agent/v1` อยู่แล้ว** ก่อนที่ repo นี้จะเขียน
`agent/v1alpha2` ของตัวเอง — ต้องเทียบก่อนว่าชนกันไหม

## ไม่ได้ชนกัน เพราะอยู่คนละชั้น

```text
agent/v1alpha2  (repo นี้)          agent/v1  (agent-platform)
  manifest ที่คนเขียนเป็นไฟล์          ทะเบียน agent ในแพลตฟอร์ม
  build-time source                  runtime record
        │                                   ▲
        ▼                                   │
   CompiledAgent  ───────────────────────────
   สิ่งที่ platform จะ consume
```

ของเขามี `agent_id` · `tenant_id` · `workspace_id` · `status` · `budget` — ทั้งหมดเป็นของ
**instance ที่ deploy แล้ว** ส่วนของเราไม่มีเลยสักตัว เพราะ manifest คือ **แบบ** ไม่ใช่ **ตัว**

## เทียบทีละ field

| `agent-platform` `agent/v1` | เรามีไหม | หมายเหตุ |
|---|---|---|
| `agent_id` `tenant_id` `workspace_id` | ❌ | เป็นของ platform ที่ deploy — manifest ไม่ควรมี |
| `name` | ✅ `metadata.name` | |
| `role` | ➖ | ของเราใกล้สุดคือ `purpose.primary` แต่คนละความหมาย — role ผูกกับ policy profile |
| `instructions` | ✅ `system.instructions` | |
| **`capability_requirement`** | ⚠️ **ชนกัน** | ดูข้างล่าง |
| `tools` | ✅ `tools.allowed` | ความหมายตรงกัน — "ขอ" ไม่ใช่ "ได้" |
| `mcp_servers` | ✅ `mcp.servers` | |
| **`policy_profile`** | ⚠️ **ชนกัน** | ของเราเขียน policy ในไฟล์ ของเขาอ้างชื่อ profile |
| `delegation` | ❌ | เรายังไม่มี sub-agent (P5) — ของเขามี `max_depth` แล้ว |
| `budget` | ❌ | ไม่มีเลย |
| `status` | ❌ | เป็นของ instance |

## สองเรื่องที่ชนกันจริง

### 1. `capability_requirement` ปะทะ `model.preferred`

ADR-0009 ของเขาเขียนไว้ตรง ๆ:

> agent บอกว่า**ต้องการอะไร** ไม่ใช่ระบุ provider
> ถ้าจำเป็นต้อง pin provider จริง ให้ใช้ `constraints.pin_provider` และเขียนเหตุผลกำกับ

manifest ของเราทำตรงข้าม — `model.preferred: [deepseek, glm]` **ระบุ provider ตรง ๆ**

แต่เรามีชั้นที่แก้เรื่องนี้อยู่แล้วครึ่งทาง: **Model Registry** แปลงชื่อใน manifest เป็น
`ModelBinding` และ `FREE_LLM_REGISTRY_URL` ทำให้ catalog มาจาก `free-llm-registry` ไม่ใช่จากโค้ด
สิ่งที่ยังขาดคือ **manifest ยังพูดภาษา provider ไม่ใช่ภาษา capability**

ทางที่เป็นไปได้ — **ต้องให้เจ้าของ contract ตัดสิน ไม่ใช่เราตัดสินเอง**:

| ทาง | ผล |
|---|---|
| manifest รับ `capability_requirement` เพิ่ม แล้วให้ Model Registry resolve | ตรงกับ ADR-0009 · เป็น additive ไม่ breaking ตาม §13 |
| ถือว่า `model.preferred` = `constraints.pin_provider` ที่มีเหตุผลกำกับ | ง่ายกว่า แต่ทำให้ทุก manifest เป็น pinned provider ซึ่งน่าจะผิดเจตนา ADR |

### 2. `policy_profile` ปะทะ `policy.forbidden` + `humanApproval`

ของเขาอ้าง **ชื่อ profile** (ดู `profiles/` ของเขา) ของเราเขียนกฎลงในไฟล์ manifest ตรง ๆ

ข้อดีของแบบเรา: อ่าน manifest ใบเดียวก็รู้ว่าถูกจำกัดอะไร — และ Builder หักสิทธิ์ได้ตั้งแต่
compile time (§5.4)
ข้อดีของแบบเขา: เปลี่ยน policy ทั้ง fleet ได้โดยไม่ต้องแก้ manifest ทีละใบ

**ไม่ใช่เรื่องถูกผิด แต่ต้องเลือกอย่างใดอย่างหนึ่งก่อนจะ integrate** ไม่งั้นจะมี policy
สองที่ที่ขัดกันได้เงียบ ๆ ซึ่งเป็นอาการที่ ADR-0006 ตั้งใจกันตั้งแต่ต้น

## แล้ว `CompiledAgent` อยู่ตรงไหน

นี่คือส่วนที่เข้ากันดีที่สุด — [`compiled-agent-contract.md`](compiled-agent-contract.md)
คือสิ่งที่ **runtime plane** ของเขาจะ consume ตรง ๆ

| `planes/` ของ agent-platform | ของเราที่ตรงกับมัน |
|---|---|
| `runtime` — agent loop, lifecycle, external provider | `AgentRuntime` + 5 target |
| `harness` — บังคับลำดับขั้นภายในหนึ่งงาน | `autonomy` + approval gate |
| `policy` — ทำได้ไหม ต้องให้ใครอนุมัติ | `policy.forbidden` + `humanApproval` |
| `tools` — catalog + MCP registration | Tool/MCP Registry |
| `observability` — trace, audit, replay | `--audit-log` + `manifestChecksum` |

ห้าใน 11 plane มีของจริงอยู่แล้วในรีโปนี้

## ทำไมยังไม่ใส่ `platform-contract.yaml`

ADR-0006 บังคับ consumer สามข้อ:

```
1. manifest       platform-contract.yaml ที่ root
2. conformance    test ใน CI ที่ validate payload จริงกับ schema ที่ pin ไว้
3. release gate   test ไม่ผ่าน = ปล่อยไม่ได้
```

ข้อ 2 คือของจริง — consumer ที่ผ่านแล้วอย่าง `devfactory-core` validate event **56 ใบต่อรอบ**
ที่ระบบผลิตออกมาจริง ไม่ใช่ fixture ที่เขียนให้ผ่าน

**ใส่ไฟล์ manifest โดยไม่มีข้อ 2 คือการประกาศ conformance ที่ไม่มีอะไรรองรับ** —
เป็นความผิดพลาดแบบเดียวกับ `npm test ผ่าน 45 test` ที่ค้างมา 9 merge และเป็นเหตุผลที่
เอกสารในรีโปนี้ถึงต้องมี test คุมตัวเอง

### สิ่งที่ต้องทำก่อนถึงจะใส่ได้

- [ ] ตัดสินเรื่อง `capability_requirement` — **ต้องเปิด issue ที่ `agent-platform`** ตาม
      ADR-0006 ข้อ 2 (repo ลูกที่อยากเปลี่ยน contract ต้องเปิด issue ที่นั่น ไม่ใช่แก้บ้านตัวเอง)
- [ ] ตัดสินเรื่อง `policy_profile` เช่นกัน
- [ ] แมป trace event ของเราเข้ากับ `event/v1` — vocabulary ของเขาเป็นของ `devfactory-core`
      (`EXECUTION_STARTED` · `EXECUTION_FAILED` · `JOB_COMPLETED` · `GOVERNANCE_DECISION` …)
      ซึ่งหยาบกว่าของเรา (`model_call` · `tool_call` · `approval` …) — **ไม่ใช่การแปลงชื่อ
      แต่คือการเลือกว่าอะไรควรถูกบันทึกเป็น audit ของ ecosystem**
- [ ] แมป approval decision เข้ากับ `approval/v1`
- [ ] เขียน `conformance/payload_check` ที่ validate payload จริง แล้วต่อเข้า CI

### เรื่องที่ต้องระวังเป็นพิเศษ

การเปลี่ยน audit format เพื่อให้ conform **จะกระทบ contract ที่เพิ่ง freeze ไปใน §13** —
`baseline.json` บันทึกพฤติกรรมปัจจุบันไว้แล้ว ถ้าเปลี่ยนต้อง bump contract version
พร้อมเหตุผล ไม่ใช่ regenerate baseline เงียบ ๆ

## สรุป

| | |
|---|---|
| ชนกันไหม | ไม่ชน — คนละชั้น |
| ต่อได้เลยไหม | ยัง — มี 2 เรื่องที่ต้องให้เจ้าของ contract ตัดสินก่อน |
| ใครตัดสิน | `agent-platform` ผ่าน issue ตาม ADR-0006 ข้อ 2 **ไม่ใช่รีโปนี้** |
| ของเราพร้อมแค่ไหน | `CompiledAgent` เข้ากับ runtime plane ได้ตรง ๆ · 5 ใน 11 plane มีของจริงแล้ว |

**ข้อเสนอ: เปิด issue ที่ `agent-platform` สองใบ** (capability · policy) แล้วรอคำตอบ
ก่อนแตะ manifest — เพราะ `agent/v1` ของเขายังไม่มี consumer เลยสักราย
(`agent` `provider` `model` `tool` `mcp` = *ยังไม่มีใคร pin*) เราจะเป็นรายแรก
และรายแรกเป็นคนที่ตั้งบรรทัดฐานให้คนหลัง

**สถานะ (2026-09-02):** ร่าง issue ทั้งสองใบเขียนแล้วที่ [`proposals/`](../proposals/)
— **ยังไม่เปิด** รอตรวจ wording ตาม [รีวิวรอบ 4](../ref/2026-09-02-review-04-open-issues-before-pinning.md)
