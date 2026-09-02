# Agent Manifest — `agent/v1alpha2`

Manifest คือ **specification ของ agent** ไม่ใช่ config ของ runtime ใดตัวหนึ่ง

> ทำไมเป็น `v1alpha2` ไม่ใช่ `v1` — `agent-builder-pi-poc` ใช้ `agent/v1` ไปแล้ว
> และรูปทรงของ `model` / `tools` / `mcp` ในเวอร์ชันนี้ **ไม่เข้ากันย้อนหลัง**
> เปลี่ยนความหมายใต้ชื่อเดิมจะทำให้ manifest เก่าพังเงียบ ๆ
> **`v1alpha2` คือ contract ที่ freeze แล้วของ Agent Builder PoC ตัวนี้**
> การโปรโมตเป็น `agent/v1` เป็น compatibility milestone แยกต่างหาก
> และ **ไม่ใช่เงื่อนไข** ของการ integrate กับ `agent-platform`
> — กติกาเต็มอยู่ใน [`contract-stability.md`](contract-stability.md)

## โครงเต็ม

```yaml
apiVersion: agent/v1alpha2     # บังคับ
kind: Agent                    # บังคับ

metadata:
  name: github-code-reviewer   # บังคับ · kebab-case
  version: 0.1.0               # บังคับ · semver
  description: ...             # ไม่บังคับ

spec:
  purpose:
    primary: review_pull_request   # บังคับ · agent นี้มีไว้ทำอะไร

  model:
    preferred: [deepseek, glm]     # บังคับ · เรียงตามลำดับความชอบ
                                   # Model Registry เลือกตัวแรกที่ catalog รู้จัก

  autonomy:
    level: 2                       # บังคับ · ดูตารางด้านล่าง

  system:
    instructions: |                # ไม่บังคับ
      ...                          # ถ้าไม่ใส่ prompt จะประกอบจาก purpose + skills

  skills: [code-review]            # ไม่บังคับ · instruction pack ใช้ซ้ำได้

  tools:
    allowed: [github.read]         # ไม่บังคับ

  mcp:
    servers: [collaboration]       # ไม่บังคับ

  policy:
    forbidden: [github.merge]      # ไม่บังคับ · Builder หักออกก่อนถึง runtime

  humanApproval:
    required: [github.comment]     # ไม่บังคับ · ต้องมีคนกดอนุมัติทุกครั้ง

  audit:
    required: true                 # ไม่บังคับ · เปิด trace event

  subagents:                       # ไม่บังคับ · schema รับแล้ว แต่ยังไม่ compile (P5)
    - name: reviewer
      role: review
```

## สิ่งที่ manifest **ห้าม**มี

| ห้าม | เพราะ |
|---|---|
| `spec.runtime` | runtime คือ build target ใช้ `--target` แทน |
| field ใด ๆ ที่ขึ้นต้นด้วยชื่อ runtime | validator ใช้ `strictObject` — reject ทันที |
| secret / token | มาจาก environment เสมอ |
| model id ดิบ เช่น `deepseek-chat` | ใช้ชื่อใน catalog แล้วให้ Model Registry แปลง |

## Autonomy

| level | ชื่อ | ทำเองได้โดยไม่ต้องขอ |
|---|---|---|
| 0 | observe | — |
| 1 | read | tool ที่ `effect: read` |
| 2 | propose | `read` + `write` |
| 3 | act | ทุก effect |

tool ที่ level ไม่อนุญาต **ยังถูกมอบให้ agent** แต่ทุกครั้งที่เรียกจะกลายเป็น approval request
ต่างจาก `policy.forbidden` ที่ถูกหักทิ้งไปเลยและ agent ไม่มีทางเรียกได้

## อ้างถึง MCP tool ใน policy

ใช้ชื่อเต็ม `<server>.<tool>` เช่น `collaboration.resolve_decision`
tool ของ MCP ถูก namespace ด้วยชื่อ server เสมอ จะได้ forbid ของ server หนึ่งโดยไม่โดนอีก server
ที่บังเอิญมี tool ชื่อเดียวกัน

validator ตรวจชื่อพวกนี้กับ registry ไม่ได้ (server ยังไม่ได้ connect ตอน validate)
จึงยอมรับถ้า server นั้นถูกประกาศใน `spec.mcp.servers` แล้ว — การกรองจริงเกิดตอน connect
ผ่าน `admitLateTools()` ด้วยกฎชุดเดียวกัน

## ตรวจ manifest

```bash
agent-builder validate manifests/code-reviewer.yaml
```

`schema/agent-manifest.schema.json` generate มาจาก `builder/validator.ts` ด้วย `npm run schema`
— zod คือ source of truth ตัวเดียว ไฟล์ JSON มีไว้ให้ editor และ consumer ที่ไม่ใช่ TypeScript
CI ควรรัน `npm run schema && git diff --exit-code schema/` เพื่อกันไม่ให้ค้าง
