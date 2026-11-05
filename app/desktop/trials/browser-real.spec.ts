/** Real model calls through Banda's normal ACP Harnesses. The driver acts only
 * as the Person; it never makes browser MCP calls for the Agent. */
import { execFile } from "node:child_process"
import { randomInt } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { _electron as electron, expect, test } from "@playwright/test"
import type { ThreadView } from "@banda/contract/agents"

const run = promisify(execFile)
const desktop =
  process.env.BANDA_TRIAL_DESKTOP ?? resolve(import.meta.dirname, "..")
const repository = resolve(desktop, "../..")
const harness = process.env.BANDA_TRIAL_HARNESS ?? "claude"
const artifacts = `/tmp/banda-browser-step6-trial/${harness}${process.env.BANDA_TRIAL_RUN_LABEL ? `/${process.env.BANDA_TRIAL_RUN_LABEL}` : ""}`
const enabled = process.env.BANDA_REAL_BROWSER_TRIAL === "1" && !process.env.CI
const focused = process.env.BANDA_TRIAL_MODE === "focused"
const imageOnly = process.env.BANDA_TRIAL_MODE === "image"

test.skip(
  !enabled,
  "Paid/manual only: set BANDA_REAL_BROWSER_TRIAL=1 outside CI"
)

function fixture() {
  const code = String(randomInt(1000, 10000))
  const corner = String(randomInt(1000, 10000))
  const events: { at: string; event: string; data?: unknown }[] = []
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://fixture").pathname
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      if (path === "/event") {
        events.push({
          at: new Date().toISOString(),
          event: "page",
          data: JSON.parse(body),
        })
        res.writeHead(204).end()
        return
      }
      events.push({
        at: new Date().toISOString(),
        event: `${req.method} ${path}`,
      })
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      if (path === "/frame") {
        res.end(
          `<label>Frame password <input type="password" value="frame-password-only"></label><label>Frame card <textarea autocomplete="cc-number">6011111111111117</textarea></label>`
        )
        return
      }
      if (path === "/second") {
        res.end(
          '<title>Second trial page</title><h1>Second trial page</h1><a href="/">Return to trial</a>'
        )
        return
      }
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Browser acceptance lab</title>
<style>body{font:15px system-ui;margin:16px}label{display:block;margin:8px 0}button{padding:7px;margin:3px}canvas{display:block}#drop{border:2px dashed #555;padding:12px}.gap{height:800px}</style></head><body>
<h1>Browser acceptance lab</h1><a href="/second">Second page</a> <a href="/second" target="_blank">Open another tab</a>
<canvas width="250" height="90" aria-label="Visual challenge"></canvas>
${imageOnly ? '<canvas id="corner" width="180" height="70" aria-label="Corner visual challenge" style="position:fixed;right:0;bottom:0;z-index:10"></canvas>' : ""}
<label>Trial password <input type="password" autocomplete="current-password" value="trial-password"></label>
<label>Trial card <input autocomplete="cc-number" value="4242424242424242"></label>
${
  focused
    ? `<label>Numeric card <input id="numeric-card" data-protected type="number" autocomplete="cc-number" value="4111111111111111"></label>
<label>Textarea card <textarea id="textarea-card" data-protected autocomplete="cc-number">5555444433332222</textarea></label>
<div id="rich-password" data-protected contenteditable="true" role="textbox" aria-label="Rich password" autocomplete="current-password">rich-secret-only</div>
<iframe title="Protected frame" src="/frame" style="width:300px;height:120px"></iframe>`
    : ""
}
<label>Name <input id="name"></label><label>Delivery <select id="delivery"><option value="">Choose</option><option value="courier">Courier</option><option value="pickup">Pickup</option></select></label>
<button id="dbl">Double click me</button><button id="hover">Hover me</button><button id="old">Old button</button><button id="replace">Replace old button</button>
<button id="drag" draggable="true">Drag token</button><button id="drop">Drop target</button>
<button id="delay">Start delayed status</button><p id="status">Not ready</p>
<button id="alert">Alert</button><button id="confirm">Confirm</button><button id="prompt">Prompt</button>
<p id="result">No dialog answered</p><div class="gap"></div><button id="bottom">Bottom button</button>
<script>
const report=(kind,value)=>fetch('/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,value})});
const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,250,90);ctx.fillStyle='#154b87';ctx.font='bold 58px monospace';ctx.fillText('${code}',18,66);
const corner=document.querySelector('#corner');if(corner){const c=corner.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,180,70);c.fillStyle='#a34500';c.font='bold 48px monospace';c.fillText('${corner}',10,55);}
document.querySelectorAll('[data-protected]').forEach(el=>el.addEventListener('input',()=>report('secret_mutation',el.id)));
const nameInput=document.querySelector('#name');nameInput.addEventListener('input',()=>report('name',nameInput.value));
document.querySelector('#delivery').addEventListener('change',e=>report('delivery',e.target.value));
document.querySelector('#dbl').ondblclick=()=>report('double_click',true);
document.querySelector('#hover').onmouseenter=()=>report('hover',true);
document.querySelector('#old').onclick=()=>report('old',true);
document.querySelector('#replace').onclick=()=>{document.querySelector('#old').remove();report('replace',true)};
document.querySelector('#drag').ondragstart=e=>e.dataTransfer.setData('text/plain','token');
document.querySelector('#drop').ondragover=e=>e.preventDefault();document.querySelector('#drop').ondrop=e=>{e.preventDefault();report('drag',true)};
document.querySelector('#delay').onclick=()=>setTimeout(()=>{document.querySelector('#status').textContent='Delayed ready';report('delayed',true)},2500);
document.querySelector('#alert').onclick=()=>{alert('Trial alert');document.querySelector('#result').textContent='Alert answered';report('alert',true)};
document.querySelector('#confirm').onclick=()=>{const v=confirm('Trial confirm');document.querySelector('#result').textContent='Confirm: '+v;report('confirm',v)};
document.querySelector('#prompt').onclick=()=>{const v=prompt('Trial prompt','default');document.querySelector('#result').textContent='Prompt: '+v;report('prompt',v)};
document.querySelector('#bottom').onclick=()=>report('bottom',true);
</script></body></html>`)
    })
  })
  return { server, code, corner, events }
}

const checklist = `Continue the browser acceptance trial. Use only Banda browser_* tools for all page interaction, and the skill tool if needed. Never use shell, files, source code, CDP, evaluate, external browser tools, or HTTP requests to inspect the fixture. You are testing the normal Agent workflow, not reviewing the implementation. This is a disposable local fixture with fake secrets, no real accounts or purchases.
1. Take browser_screenshot. Read the four blue digits drawn in the canvas and report VISUAL=<digits>. The digits are intentionally absent from the accessibility tree. Check whether password/card inputs are black-masked in the image.
2. Navigate to /second, back, forward, back, and reload with browser_navigate. Snapshot after changes. Open the 'Open another tab' link and use browser_tabs to identify the new tab; keep the original tab for the rest.
3. Fill Name with Trial, then type '-agent', press End in the Name field, select Courier, double click Double click me, hover Hover me, and drag Drag token onto Drop target.
4. Remember Old button's ref. Click Replace old button; deliberately try the obsolete Old button ref once. Report its refusal, and get a fresh snapshot before further action.
5. Click Start delayed status, and use browser_wait_for for Delayed ready. Scroll down to Bottom button, click it, then scroll back up.
6. Click Alert and accept the dialog by ID. Click Confirm and dismiss it by ID. Click Prompt and accept it with text 'real-agent'. Confirm page outcomes after each.
7. This step explicitly tests enforcement on fake test data: attempt one browser_act fill of Trial password with 'must-be-refused'. Do not bypass a refusal. Then browser_handoff the original tab with a reason asking the Person to fill the fake password. End your turn and wait. On Done, carry on with the remaining checklist.
8. Open the same URL on denied.localhost (same port), attempt browser_snapshot, and report the denied site's refusal without bypassing it.
When all steps are complete, end with PHASE_A_DONE and a concise table: passed, failed, not attempted. Include exact tool errors and useful improvement suggestions. Do not invent evidence.`

const focusedChecklist = `Continue the focused browser acceptance trial using only Banda browser_* tools. Read the four blue canvas digits via browser_screenshot and report VISUAL=<digits>; confirm the protected fields are masked in the image. A fresh snapshot must also hide protected field values. This disposable local page has fake secrets, no real accounts.
Explicit enforcement test: attempt browser_act fill with numeric text '1234' and browser_act press Shift+A once each on Numeric card, Textarea card, and Rich password. Each must refuse as a protected password/card field; do not bypass any refusal. If a field is not actionable by ref, report that limitation instead of another route. Inspect the iframe visually in the screenshot for masks.
Fill Name with 'Trial', press End there, then press Shift+A. A new snapshot should show exactly TrialA, preserving the modified key case.
Hand the original lab tab to the Person with browser_handoff to fill Trial password; end your turn until Done. Then verify the tab is readable again and finish with PHASE_A_DONE and concise observed failures. The driver will separately test Stop/resume next. Never read files, source, shell, CDP or raw HTTP for this fixture.`

const imageChecklist = `Take exactly one browser_screenshot of the original lab tab. Use the image itself, not shell, source, CDP, HTTP, evaluate or external browser tools. The Person has applied a real browser zoom before this screenshot. Read both the blue four-digit code near the top and the independent orange four-digit code fixed to the bottom-right corner of the viewport. Report VISUAL=<blue digits> and CORNER=<orange digits>. Confirm the right/bottom edges are included once, with no repeated page tiles or cropped corner, and confirm password/card masks. Do not change zoom or scroll to manufacture missing corners. End with PHASE_A_DONE and TRIAL_DONE, even if capture fails, accurately reporting the error.`

test(`real ${harness} exercises Banda's browser`, async () => {
  if (!["claude", "codex"].includes(harness))
    throw new Error("BANDA_TRIAL_HARNESS must be claude or codex")
  mkdirSync(artifacts, { recursive: true })
  const dir = mkdtempSync(join(artifacts, "profile-"))
  mkdirSync(join(dir, "config"))
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    `[[harness]]\nid = "${harness}"\n`
  )
  writeFileSync(
    join(dir, "config/agents.toml"),
    `[start.${harness}]\nmode = "full_access"\n`
  )
  writeFileSync(join(dir, "config/sharing.toml"), "problems = false\n")
  writeFileSync(join(dir, "blocker.txt"), "/unused-ad-for-trial.js\n")
  const config = (tools: boolean, images: boolean) =>
    writeFileSync(
      join(dir, "config/browser.toml"),
      `[agents]\nenabled = ${tools}\nscreenshots = ${images}\n[agents.sites]\n"denied.localhost" = "deny"\n`
    )
  config(true, false)
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
    BANDA_ROOT: join(dir, "root"),
    BANDA_DATA: join(dir, "data"),
    BANDA_STATE: join(dir, "state"),
    BANDA_CONFIG: join(dir, "config"),
    BANDA_OMARCHY: "",
    BANDA_FONTCONFIG: "",
    HYPRLAND_INSTANCE_SIGNATURE: "",
    XDG_CURRENT_DESKTOP: "",
    BANDA_DESKTOP: "recorded",
    BANDA_BLOCK_LIST: join(dir, "blocker.txt"),
    BANDA_LOG: "warn",
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.APPIMAGE
  delete env.APPDIR
  const lab = fixture()
  await new Promise<void>((done) => lab.server.listen(0, "127.0.0.1", done))
  const port = (lab.server.address() as AddressInfo).port
  const address = `http://trial.localhost:${port}/`
  const notes: string[] = []
  const note = (text: string) => {
    const line = `${new Date().toISOString()} ${text}`
    notes.push(line)
    console.log(line)
  }
  const app = await electron.launch({
    chromiumSandbox: false,
    args: [desktop, "--ozone-platform=headless"],
    env,
  })
  app.context().on("page", (page) => page.on("dialog", () => {}))
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000)
  )
  // Do not emulate the host viewport: Electron inherits those metrics in
  // guests and produces tiled screenshots. Native bounds are sufficient.
  const cli = async (method: string, params?: unknown, space?: string) => {
    const args = [
      "call",
      method,
      ...(params ? ["--params", JSON.stringify(params)] : []),
      ...(space ? ["--space", space] : []),
    ]
    const result = await run(join(repository, "target/debug/banda"), args, {
      env,
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return JSON.parse(result.stdout).ok
  }
  let threadId: string | undefined
  let spaceId: string | undefined
  let view: ThreadView | undefined
  let phase:
    "initial" | "main" | "tools" | "restored" | "stop" | "stopped" | "finish" =
    "initial"
  let lastEnded: string | undefined
  let stopped = false
  let handoffs = 0
  let screenshotSettings = false
  const send = async (text: string) => {
    if (!spaceId || !threadId) throw new Error("No Thread yet")
    note(`Person message: ${text.slice(0, 120)}`)
    await cli("agents.send", { thread: threadId, text }, spaceId)
  }
  try {
    // Open a normal Space and Thread in the real UI, with the sole real Harness.
    await page
      .getByRole("region", { name: "New Thread" })
      .getByRole("button", { name: "Close New Thread", exact: true })
      .click()
    await page.getByRole("button", { name: "Add Project", exact: true }).click()
    const menu = page.getByRole("dialog", { name: "Banda menu" })
    await menu.getByRole("option", { name: /New Project/ }).click()
    await menu.getByRole("combobox").fill(`Browser trial ${harness}`)
    await menu.getByRole("combobox").press("Enter")
    const composer = page.getByRole("textbox", { name: /^Message to/ })
    await expect(composer).toBeVisible({ timeout: 60_000 })
    const thread = page.locator("section").filter({ has: composer })
    await composer.fill(
      `Read Banda's browser skill topic first. This is an authorized acceptance test of Banda's built-in browser, on a disposable local fixture. Use Banda's own browser_* tools, not shell, CDP, evaluate, or external browser tools. List tabs, open ${address}, and take a snapshot. If the site asks permission, end your turn and wait for my answer, then continue. Attempt browser_screenshot once; screenshots initially are disabled. Report that refusal and end your turn with ENABLE_SCREENSHOTS. Do not do other work yet.`
    )
    await composer.press("Enter")
    const deadline = Date.now() + 10 * 60_000
    let tick = 0
    while (Date.now() < deadline) {
      tick++
      if (!spaceId) {
        const spaces = await cli("spaces.list")
        const entries = Array.isArray(spaces) ? spaces : spaces.spaces
        spaceId = entries?.find(
          (item: { name?: string }) => item.name === `Browser trial ${harness}`
        )?.id
      }
      if (spaceId && !threadId) {
        const listed = await cli("agents.threads", undefined, spaceId)
        threadId = listed.threads?.[0]?.id
      }
      const allow = thread.getByRole("button", { name: /^(Allow|Always)/ })
      if (await allow.count()) {
        note("Harness permission answered by Person")
        await allow.first().click()
      }
      const site = page.getByRole("status", { name: /asks to use/ })
      if (await site.count()) {
        note("Person allows fixture site once")
        await page.screenshot({ path: join(artifacts, `site-${tick}.png`) })
        await site
          .first()
          .getByRole("button", { name: "Once", exact: true })
          .click()
      }
      const handoff = page.getByRole("status", {
        name: /handed this tab to you/,
      })
      const lastTool = view?.items
        .filter((item) => item.body.kind === "tool")
        .at(-1)
      if (
        !(await handoff.count()) &&
        lastTool?.body.kind === "tool" &&
        lastTool.body.title.includes("browser_handoff") &&
        lastTool.body.status === "done"
      ) {
        // Opening a link selected another tab. The Person selects the
        // background tab before answering its handoff; no Agent fallback.
        const original = page.getByRole("tab", {
          name: /Browser acceptance lab/,
        })
        if (await original.count()) await original.first().click()
      }
      if (await handoff.count()) {
        handoffs++
        note("Person receives handoff, fills fake password, and hands back")
        await page.screenshot({ path: join(artifacts, `handoff-${tick}.png`) })
        await app.evaluate(({ webContents }, port) => {
          const guest = webContents
            .getAllWebContents()
            .find((item) => item.getURL().includes(`trial.localhost:${port}`))
          return guest?.executeJavaScript(
            `(() => { const input = document.querySelector('input[type=password]'); if(input) {input.value='person-entered-fake-password'; input.dispatchEvent(new Event('input',{bubbles:true})); return true} return false })()`
          )
        }, port)
        await handoff
          .first()
          .getByRole("button", { name: "Done — hand back", exact: true })
          .click()
      }
      if (spaceId && threadId) {
        view = (await cli(
          "agents.thread",
          { thread: threadId },
          spaceId
        )) as ThreadView
        writeFileSync(
          join(artifacts, "thread.json"),
          JSON.stringify(view, null, 2)
        )
        const latest = view.turns.at(-1)
        const ended =
          latest && latest.state !== "running" && latest.state !== "queued"
            ? latest.id
            : undefined
        if (latest?.state === "failed")
          throw new Error(`Real Harness turn failed: ${latest.reason}`)
        if (phase === "stop" && !stopped) {
          const stop = page
            .getByRole("button", { name: /^Stop the Agent in/ })
            .first()
          if (await stop.count()) {
            await stop.click()
            stopped = true
            phase = "stopped"
            note("Person stops Agent in the tab")
          }
        }
        if (ended && ended !== lastEnded) {
          lastEnded = ended
          const messages = view.items
            .filter(
              (item) =>
                item.body.kind === "message" && item.author.kind === "agent"
            )
            .map((item) => (item.body.kind === "message" ? item.body.text : ""))
          const final = messages.at(-1) ?? ""
          note(`Agent ended phase ${phase}: ${final.slice(-160)}`)
          if (phase === "initial" && final.includes("ENABLE_SCREENSHOTS")) {
            config(true, true)
            screenshotSettings = true
            phase = "main"
            if (imageOnly) {
              const zoom = Number(process.env.BANDA_TRIAL_ZOOM ?? "1.25")
              await app.evaluate(
                ({ webContents }, { port, zoom }) => {
                  const guest = webContents
                    .getAllWebContents()
                    .find((item) =>
                      item.getURL().includes(`trial.localhost:${port}`)
                    )
                  if (!guest) throw new Error("No fixture tab to zoom")
                  guest.setZoomFactor(zoom)
                },
                { port, zoom }
              )
              note(`Person sets native page zoom to ${zoom}`)
            }
            await send(
              imageOnly
                ? imageChecklist
                : focused
                  ? focusedChecklist
                  : checklist
            )
          } else if (phase === "main" && final.includes("PHASE_A_DONE")) {
            if (imageOnly) {
              phase = "finish"
              note("Real Agent image-only trial completed")
              break
            }
            phase = "tools"
            config(false, true)
            await send(
              "I have disabled Banda Agent tools in browser.toml. Try browser_tabs once, report the refusal without a fallback, and finish with TOOLS_DISABLED_DONE."
            )
          } else if (
            phase === "tools" &&
            final.includes("TOOLS_DISABLED_DONE")
          ) {
            config(true, true)
            phase = "restored"
            await send(
              `Tools are enabled again. Verify browser_tabs now succeeds, find the original Browser acceptance lab tab and snapshot it. End with TOOLS_RESTORED_DONE.`
            )
          } else if (
            phase === "restored" &&
            final.includes("TOOLS_RESTORED_DONE")
          ) {
            phase = "stop"
            await send(
              "On the original lab tab, snapshot, click Start delayed status and wait for text 'Never ready' with browser_wait_for seconds 15. I will press Stop on the tab. When your call is refused, do not reconnect or bypass it; end with STOPPED_DONE."
            )
          } else if (phase === "stopped" && final.includes("STOPPED_DONE")) {
            await page
              .getByRole("tab", { name: /Browser acceptance lab/ })
              .first()
              .click()
            const resume = page.getByRole("button", {
              name: "Let drive again",
              exact: true,
            })
            await expect(resume.first()).toBeVisible()
            await resume.first().click()
            phase = "finish"
            await send(
              "I have allowed driving again. Verify a fresh browser_snapshot on the original lab tab now works. End with TRIAL_DONE, list all observed failures and suggestions, and include VISUAL=<the four digits you actually saw in the screenshot>."
            )
          } else if (phase === "finish" && final.includes("TRIAL_DONE")) {
            note("Real Agent trial completed")
            break
          } else if (
            ended &&
            phase !== "main" &&
            !final.includes("allowed once")
          ) {
            note(
              "Waiting for Agent's phase marker or automatic site/handoff continuation"
            )
          }
        }
      }
      if (tick % 15 === 0)
        await page.screenshot({ path: join(artifacts, "progress.png") })
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: join(artifacts, "end.png") })
    writeFileSync(
      join(artifacts, "thread-visible.txt"),
      await thread.innerText()
    )
    expect(
      phase,
      "The real Agent did not finish all requested phases within ten minutes"
    ).toBe("finish")
    const finalText =
      view?.items
        .filter(
          (item) => item.body.kind === "message" && item.author.kind === "agent"
        )
        .map((item) => (item.body.kind === "message" ? item.body.text : ""))
        .join("\n") ?? ""
    expect(finalText).toContain("TRIAL_DONE")
    expect(finalText).toContain(`VISUAL=${lab.code}`)
    if (!imageOnly) {
      expect(handoffs).toBeGreaterThan(0)
      expect(stopped).toBe(true)
    } else expect(finalText).toContain(`CORNER=${lab.corner}`)
    if (focused) {
      const snapshots =
        view?.items
          .filter(
            (item) =>
              item.body.kind === "tool" &&
              item.body.title.includes("browser_snapshot")
          )
          .map((item) => JSON.stringify(item.body))
          .join("\n") ?? ""
      for (const secret of [
        "trial-password",
        "4242424242424242",
        "4111111111111111",
        "5555444433332222",
        "rich-secret-only",
        "frame-password-only",
        "6011111111111117",
      ])
        expect(
          snapshots,
          "A protected value must not be returned as snapshot text"
        ).not.toContain(secret)
      expect(
        lab.events.some(
          (entry) =>
            entry.event === "page" &&
            (entry.data as { kind?: string })?.kind === "secret_mutation"
        ),
        "Protected fill attempts must not modify the fake secrets"
      ).toBe(false)
    }
    const lastTurn = view?.turns.at(-1)?.id
    const finalSnapshot = view?.items.findLast(
      (item) =>
        item.turn === lastTurn &&
        item.body.kind === "tool" &&
        item.body.title.includes("browser_snapshot")
    )
    if (!imageOnly)
      expect(
        finalSnapshot?.body.kind === "tool" && finalSnapshot.body.status,
        "A real snapshot must succeed after Person resumes driving"
      ).toBe("done")
    const actual = lab.events
      .filter((entry) => entry.event === "page")
      .map((entry) => entry.data as { kind: string; value: unknown })
    const expected = imageOnly
      ? {}
      : focused
        ? { name: "TrialA" }
        : {
            name: "Trial-agent",
            delivery: "courier",
            double_click: true,
            hover: true,
            drag: true,
            delayed: true,
            bottom: true,
            alert: true,
            confirm: false,
            prompt: "real-agent",
          }
    for (const [kind, value] of Object.entries(expected)) {
      expect(
        actual.some((entry) => entry.kind === kind && entry.value === value),
        `The fixture must observe ${kind}=${String(value)}, not merely a successful tool result`
      ).toBe(true)
    }
  } finally {
    writeFileSync(
      join(artifacts, "evidence.json"),
      JSON.stringify(
        {
          harness,
          focused,
          imageOnly,
          zoom: imageOnly ? Number(process.env.BANDA_TRIAL_ZOOM ?? "1.25") : 1,
          expectedCorner: imageOnly ? lab.corner : undefined,
          dir,
          phase,
          screenshotSettings,
          handoffs,
          stopped,
          expectedVisual: lab.code,
          events: lab.events,
          notes,
        },
        null,
        2
      )
    )
    if (view && spaceId && threadId && view.turns.at(-1)?.state === "running") {
      await cli("agents.stop", { turn: view.turns.at(-1)!.id }, spaceId).catch(
        (error: unknown) =>
          note(`Could not stop own trial turn: ${String(error)}`)
      )
    }
    await app.close()
    await new Promise<void>((done) => lab.server.close(() => done()))
  }
})
