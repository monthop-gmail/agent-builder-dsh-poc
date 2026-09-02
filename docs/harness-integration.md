# Harness Integration

รายชื่อ harness ที่เข้าถึงได้ และ **เข้าทางไหน** — พร้อมระบุว่าแต่ละข้อ *พิสูจน์ด้วยการรัน*
หรือ *อ่านจากเอกสารของเขา* เพราะสองอย่างนี้ไม่เท่ากัน

## ข้อค้นพบหลัก: P3 ส่วนใหญ่ไม่ต้องเขียน adapter เพิ่ม

harness สมัยใหม่หลายตัวพูด **Agent Client Protocol** เป็น stdio JSON-RPC ซึ่งคือสิ่งที่
`--target acp` ขับอยู่แล้ว การเพิ่ม harness จึงมักเป็นเรื่อง **ตั้งค่า** ไม่ใช่เรื่อง **เขียนโค้ด**

```text
                 --target acp
                      │
    ┌─────────┬───────┼────────┬──────────────┐
    ▼         ▼       ▼        ▼              ▼
DeepSeek   Gemini   Claude   agent อื่น    (ตัวที่ยังไม่มี)
 Harness    CLI      Code     ที่พูด ACP
```

## harness แต่ละตัว

| harness | เข้าทาง | คำสั่ง | ยืนยันถึงไหน |
|---|---|---|---|
| **DeepSeek Harness** | `dsh` (preset) หรือ `acp` | `dsh --profile acp` | 🟢 **รันจบวง** — prompt, tool, resume ข้าม process |
| **Claude Code** | `acp` | `claude-code-acp` ([`@zed-industries/claude-code-acp`](https://www.npmjs.com/package/@zed-industries/claude-code-acp)) | 🟡 **initialize + session/new + session/update ผ่าน** · `session/prompt` ต้องใช้ credential ของ Anthropic ซึ่งไม่มี |
| **Gemini CLI** | `acp` | `gemini --acp` | ⚪ อ่านจาก [`docs/cli/acp-mode.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md) ของเขา ยังไม่ได้รัน |
| **Pi** | `pi` (library) | — | 🟢 รันจบวง |
| **OpenAI Codex** | ยังไม่มีทางตรง | — | ⚪ ไม่พูด ACP · DSH ห่อมันเป็น subagent (`dsh-subagent-codex`) |
| **Qwen Code** | ⚠️ **ยังไม่ได้** | `qwen serve` = ACP บน **HTTP+SSE** | ⚪ client ของเรารองรับแค่ **stdio** |

## สิ่งที่การต่อ Claude Code พิสูจน์

interop ที่ทดสอบไม่ได้ด้วย stub คือ **request shape ของเราถูกต้องตาม spec จริงหรือเปล่า** —
stub ที่เราเขียนเองจะยอมรับทุกอย่างที่เราส่ง

```
initialize    : OK    ← agentInfo: @zed-industries/claude-code-acp 0.16.2
session/new   : OK 41d7b366
  update      : available_commands_update      ← notification path ทำงาน
session/prompt: (ไม่มีคำตอบใน 45 วินาที — ต้องใช้ credential ของ Anthropic)
```

`initialize` กับ `session/new` คือจุดที่ interop พังจริงในทางปฏิบัติ และมันผ่านกับ
implementation ของ vendor ที่ไม่เกี่ยวอะไรกับเราเลย — **ยืนยันการตัดสินใจใน §9.6
ที่เขียน client ตาม wire ไม่ใช่ตาม SDK ของ harness เจ้าใดเจ้าหนึ่ง**

## บั๊กของเราที่เจอเพราะต่อของจริง

Claude Code ปฏิเสธที่จะเริ่มทำงาน:

```
Error: Claude Code cannot be launched inside another Claude Code session.
To bypass this check, unset the CLAUDECODE environment variable.
```

**ตัวแปรนั้นไม่เกี่ยวกับ adapter เราเลย** — มันแค่ติดมากับ environment ที่เราส่งต่อไป
agent จึงต้องมีทางให้ operator บอกว่าอะไรไม่ควรส่ง:

```bash
ACP_AGENT_ENV_UNSET=CLAUDECODE,CLAUDE_CODE_ENTRYPOINT
```

**ไม่ scrub อัตโนมัติ** — agent ส่วนใหญ่ต้องใช้ environment เกือบทั้งหมด และการเดาว่าอะไรตัดได้
คือวิธีที่ target จะเลิกทำงานด้วยเหตุผลที่ไม่มีใครหาเจอ

## ช่องว่างที่มีชื่อแล้ว

**ACP over HTTP+SSE** — `runtimes/acp/client.ts` รองรับ stdio อย่างเดียว Qwen Code
เสิร์ฟ ACP ผ่าน `qwen serve` เป็น HTTP+SSE จึงยังต่อไม่ได้ ต้องเพิ่ม transport
(spec เดียวกัน คนละสาย) ไม่ใช่เขียน adapter ใหม่

## เพิ่ม harness ตัวใหม่

1. เขามี ACP stdio ไหม → ถ้ามี **ไม่ต้องเขียนโค้ด**

   ```bash
   ACP_AGENT_COMMAND=<bin> ACP_AGENT_ARGS="<flags>" \
     agent-builder run <manifest> --target acp
   ```

2. ถ้าเขาปฏิเสธเพราะ environment → ใส่ชื่อตัวแปรใน `ACP_AGENT_ENV_UNSET`
3. ถ้าต้อง compile manifest เป็น config ของเขาก่อน (แบบ DSH preset) → เขียน `AcpLauncher`
   แล้ว extend `AcpRuntime` — ไม่ต้องแตะ protocol เลย ดู `runtimes/dsh/adapter.ts`
4. ถ้าเขาไม่พูด ACP → เขียน adapter เต็มตัว ดู [`runtime-adapter.md`](runtime-adapter.md)

**ไม่ว่าทางไหน manifest ไม่ต้องแก้** ซึ่งเป็นเงื่อนไขที่ P3 ตั้งไว้ตั้งแต่ต้น
