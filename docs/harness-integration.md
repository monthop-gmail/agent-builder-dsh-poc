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
| **DeepSeek Harness** | `dsh` (preset) หรือ `acp` | `dsh --profile acp` | 🟢 **รันจบวง** — prompt · tool · resume ข้าม process |
| **opencode** | `acp` | `opencode acp` | 🟢 **รันจบวง** — prompt · **resume ข้าม process** |
| **Pi** | `pi` (library) | — | 🟢 รันจบวง |
| **Claude Code** | `acp` | `claude-code-acp` ([`@zed-industries/claude-code-acp`](https://www.npmjs.com/package/@zed-industries/claude-code-acp)) | 🟡 initialize · session/new · session/update ผ่าน · `session/prompt` ต้องใช้ credential ของ Anthropic ซึ่งไม่มี |
| **Gemini CLI** | `acp` | `gemini --acp` | 🟡 initialize + session/new ผ่านใน 4 วินาที · **`session/prompt` ไม่ตอบเลย** ทั้งที่ API key ใช้ได้จริง — ดูข้างล่าง |
| **Kimi Code CLI** | `acp` | `kimi acp` | ⚪ อ่านจาก [`docs/en/reference/kimi-acp.md`](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/kimi-acp.md) — ประกาศว่า implement core 3/3 · session 11/11 |
| **OpenAI Codex** | ยังไม่มีทางตรง | — | ⚪ ไม่พูด ACP · DSH ห่อมันเป็น subagent (`dsh-subagent-codex`) |
| **Qwen Code** | ⚠️ **ยังไม่ได้** | `qwen serve` = ACP บน **HTTP+SSE** | ⚪ client ของเรารองรับแค่ **stdio** |
| **Antigravity CLI** (Google) | ⚠️ **ต้องเขียน adapter** | `agy -p --output-format stream-json` | ⚪ **ไม่พูด ACP** — มี headless NDJSON ของตัวเอง ดูข้างล่าง |

> เทียบกับรายชื่อ [best AI coding agent](https://www.kimi.ai/resources/best-ai-coding-agent):
> ในนั้นมี CLI จริง 5 ตัว — Claude Code · Codex · Gemini CLI · Kimi Code · opencode
> **4 ใน 5 เข้าทาง `acp` ได้** เหลือ Codex ตัวเดียวที่ไม่พูด ACP
> ที่เหลือในหน้านั้น (Cursor · Windsurf · Replit · Grok Build · Devin) เป็น IDE หรือ web app
> ไม่ใช่ harness ที่ขับจาก stdio ได้

## opencode: vendor ที่สาม รันจบวงจริง

```
$ run --target acp --input "ตอบสั้น ๆ ว่าคุณคือ agent อะไร"
  ฉันคือ opencode — AI coding agent ที่ช่วยทำงาน software engineering ...
  (target: acp · session: ses_f9dcaef56ffeiuLUNRof5aVgRL)

$ run --target acp --resume ses_f9dcaef56ffeiuLUNRof5aVgRL \
      --input "เมื่อกี้ผมถามอะไรไป"
  · resumed session ses_f9dcaef56ffeiuLUNRof5aVgRL
  คุณถามว่าฉันคือ agent อะไร
```

process ที่สองไม่มีอะไรร่วมกับตัวแรกนอกจาก session id กับ manifest —
**`resume()` จึงไม่ใช่ของเฉพาะ DSH แต่เป็นคุณสมบัติของโปรโตคอล** ซึ่งเป็นสิ่งที่ §12 อ้างไว้
และเพิ่งได้หลักฐานจาก implementation ที่สอง

### ข้อควรรู้ตอนติดตั้ง

`opencode-ai` มี postinstall ที่ดึง binary จริงลงมา ถ้าติดตั้งด้วย `--ignore-scripts`
(หรือ pnpm ซึ่งไม่รัน postinstall โดยปริยาย) ตัว agent จะขึ้น error แล้วค้าง — ไม่ตอบ ACP
รันเองหนึ่งครั้ง:

```bash
cd node_modules/opencode-ai && node postinstall.mjs
```

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


---

## Antigravity CLI — ตัวแรกที่ต้องเขียน adapter จริง

> **หมายเหตุเรื่อง credential:** Gemini API key (`generativelanguage.googleapis.com`)
> **ใช้กับ Antigravity CLI ไม่ได้** — คนละระบบ Antigravity auth เข้าบัญชี Google
> ผ่าน installer ของตัวเอง ส่วน Gemini API key ใช้กับ Gemini CLI และกับ Gemini
> ในฐานะ model provider

ทุกตัวก่อนหน้านี้เข้าทาง `acp` ได้ด้วยการตั้งค่า [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
ของ Google **ไม่พูด ACP** แต่มี headless protocol ของตัวเอง

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash     # ติดตั้ง
agy                                                             # โหมด TUI
agy -p "prompt" --output-format stream-json                     # headless
```

ติดตั้งแล้วรันจริงเพื่อดู flag ที่มี — **หน้า docs บอกไม่ครบ** ของจริงจาก `agy --help` (v1.1.24):

| สิ่งที่มันมี | รายละเอียด |
|---|---|
| headless | `-p` / `--print` / `--prompt` · `--print-timeout` (default 5m) |
| output | `text` · `json` (envelope ตอนจบ) · `stream-json` = **NDJSON** events `init` `step_update` `result` |
| input | `--input-format stream-json` — หนึ่ง JSON object ต่อบรรทัดบน stdin คุยได้หลายเทิร์นใน process เดียว |
| resume | `--continue` / `--conversation <ID>` |
| model | `--model` · `--effort low\|medium\|high` |
| permission | `--dangerously-skip-permissions` — **อนุมัติทุกอย่างหรือไม่อนุมัติเลย** ไม่มีระดับกลาง · `--mode accept-edits\|plan` |
| sandbox | `--sandbox` |
| MCP | **`agy mcp add/remove/list/enable/disable`** — สั่งจาก CLI ได้ ไม่ใช่แค่แผง TUI อย่างที่หน้า docs บอก |
| อื่น ๆ | `--add-dir` · `--json-schema` (บังคับ structured output) · `--agent` · `--project` |

### ถ้าจะทำ adapter จะได้หน้าตาแบบนี้

รูปเดียวกับ `dsh` เป๊ะ — **compile config ก่อน แล้วค่อยขับ**

```text
CompiledAgent
    ├─ autonomy  →  settings.json: toolPermission + enableTerminalSandbox
    └─ prompt    →  agy -p --output-format stream-json --input-format stream-json
                    resume ผ่าน --conversation <ID>
```

### แต่ `unsupported()` จะยาว และสองข้อเป็น blocking

| gap | ระดับ | เพราะ |
|---|---|---|
| `tools.local` | ⚠ degrades | tool ของเราเป็น TypeScript ในรีโปนี้ ส่งข้าม process ไม่ได้ |
| `policy.forbidden` | ⛔ **blocks** | ไม่มี flag ไหนหัก tool รายตัวได้ — `--dangerously-skip-permissions` เป็นแบบเปิดหมดหรือปิดหมด |
| `policy.humanApproval` | ⛔ **blocks** | ไม่มีทางส่งคำขออนุมัติออกมาที่ `ctx.requestApproval` ของเรา มีแต่ข้ามทั้งหมดหรือถามในเทอร์มินัล |

ตามกติกาข้อ 13 → **manifest ที่มี `policy.forbidden` หรือ `humanApproval` จะถูกปฏิเสธ**
เหลือใช้ได้เฉพาะ manifest ทรงเดียวกับ vector `minimal`

### ติดตั้งแล้ว แต่รันไม่ได้ — และเหตุผลชัดเจน

ติดตั้งสำเร็จ (`agy 1.1.24`) แต่ **auth ด้วย API key ไม่ได้** — ยืนยันด้วยการรัน ไม่ใช่การเดา:

```
$ GEMINI_API_KEY=... GOOGLE_API_KEY=... agy -p "say KEY-OK" --output-format json
Authentication required. Please visit the URL to log in:
  https://accounts.google.com/o/oauth2/auth?...&scope=cloud-platform+userinfo.email+aicode+openid
Waiting for authentication (timeout 60s)...
Error: authentication timed out.
```

มันบังคับ **Google OAuth แบบ interactive** (scope: `cloud-platform` · `aicode` · `openid` ฯลฯ)
ไม่สนใจ `GEMINI_API_KEY` หรือ `GOOGLE_API_KEY` เลย — คนละระบบกับ Gemini API
`agy models` ก็ตอบว่า *"Please sign in to view available models"*

**ผลคือ target นี้จะรันอัตโนมัติไม่ได้จนกว่าจะมีคน login ด้วยบัญชี Google หนึ่งครั้ง**
ซึ่งเป็นข้อจำกัดที่ต้องรู้ก่อนตัดสินใจ ไม่ใช่หลังเขียน adapter เสร็จ

ตัดสินใจได้สองทาง:

1. **ทำ** — ต้อง login ก่อน แล้วยอมรับว่ารองรับได้แค่ manifest ที่ไม่มี policy
2. **ไม่ทำ** — รอดูว่าเขาจะเพิ่ม ACP ไหม เหมือนที่ Gemini CLI, Kimi, opencode ทำไปแล้ว

### ข้อควรระวังตอนติดตั้ง

installer เขียน `export PATH=...` ต่อท้าย **`~/.bashrc` และ `~/.profile`** โดยไม่ถาม
แม้จะสั่ง `--dir` ให้ลงที่อื่นก็ตาม ถ้าลงในไดเรกทอรีชั่วคราว บรรทัดพวกนั้นจะชี้ไปที่ที่ไม่มีอยู่จริง

## ผล interop จริง 4 เจ้า

ทดสอบด้วย client ตัวเดียวกัน manifest เดียวกัน

| harness | initialize | session/new | session/prompt |
|---|---|---|---|
| DeepSeek Harness | ✅ | ✅ | ✅ + resume |
| opencode | ✅ | ✅ | ✅ + resume |
| Claude Code | ✅ | ✅ | ✗ ไม่มี credential ของ Anthropic — **สาเหตุชัด** |
| Gemini CLI | ✅ 4.0s | ✅ 4.1s | ✗ **สาเหตุยังไม่ทราบ** |

**4/4 ผ่าน handshake** — ซึ่งเป็นจุดที่ interop พังจริงในทางปฏิบัติ request shape ของเรา
ถูกต้องกับ implementation ทุกเจ้าที่ทดสอบ

**2/4 เท่านั้นที่ prompt จบ** — และเคสของ Gemini ไม่ใช่เรื่อง credential

### Gemini CLI: สิ่งที่สังเกตได้ ไม่ใช่ข้อสรุป

```
4.0s initialize OK
4.1s session/new OK
      (ไม่มี stderr · ไม่มี request กลับมาหา client · ไม่มี session/update)
150s TIMEOUT
```

ตัดออกไปแล้ว:

- **API key ใช้ได้** — `gemini-2.5-flash:generateContent` ตอบ HTTP 200 ด้วย key เดียวกัน
- **ไม่ใช่ client capabilities** — ลองทั้ง `fs`/`terminal` เป็น `false` และ `true` ผลเท่ากัน
- **ไม่ใช่ auth type ที่ยังไม่ได้เลือก** — ตั้ง `selectedAuthType: gemini-api-key` ใน settings แล้ว

ยังไม่ได้ตัด: เวอร์ชันของ `@agentclientprotocol/sdk` ที่ทั้งสองฝั่งใช้ · การต่อรอง
`protocolVersion` · หรือ gemini-cli อาจรอ client method ที่ spec ไม่ได้บังคับ

**บันทึกไว้เท่าที่สังเกตได้ ไม่ใส่สาเหตุที่ยังไม่ได้พิสูจน์**

### ข้อสรุปที่ใช้ได้จริงจากตรงนี้

ACP ทำให้ **ต่อติด** ได้ทุกเจ้า แต่ไม่ได้แปลว่า **ใช้งานได้จบวง** ทุกเจ้า —
ซึ่งเป็นเหตุผลที่ตารางนี้แยกคอลัมน์ handshake กับ prompt ออกจากกัน และเป็นเหตุผลที่
conformance กับ stub ตัวเดียวไม่พอ stub ของเรายอมรับทุกอย่างที่เราส่ง agent จริงไม่ใช่

## สรุปรูปแบบการเชื่อมทั้งหมดที่เจอ

| รูปแบบ | ตัวอย่าง | ต้องเขียนอะไร |
|---|---|---|
| **Protocol** (ACP stdio) | DSH · opencode · Claude Code · Gemini CLI · Kimi Code | ไม่ต้อง — ตั้งค่าอย่างเดียว |
| **Protocol + config compiler** | `dsh` (preset) | `AcpLauncher` ตัวเดียว |
| **Library** | Pi | adapter เต็ม |
| **OpenAI-compatible endpoint** | zen · DeepSeek API · llm-gateway | adapter เต็ม (มีแล้ว) |
| **Vendor headless protocol** | **Antigravity CLI** | adapter เต็ม + config compiler |
| Protocol คนละ transport | Qwen Code (HTTP+SSE) | เพิ่ม transport ใน client เดิม |
