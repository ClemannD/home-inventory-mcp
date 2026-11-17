/**
 * Server-rendered pages: sign-in and the OAuth consent screen. They are
 * served before a session exists, so they can't load the SPA bundle. Styles
 * and scripts are inline and match the app's tokens (src/index.css).
 */
import { escapeHtml } from "./http";

/** Applies the theme saved by the SPA (localStorage "theme": light, dark or system). */
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const STYLE = `
:root{--bg:#fafaf9;--surface:#fff;--text:#232322;--muted:#72726d;--subtle:#888882;--line:#eaeae6;--hover:#ededea;--blue:#3268bf;--danger:#c4432b;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#181818;--surface:#1f1f1f;--text:#efefec;--muted:#adada7;--subtle:#999992;--line:#313131;--hover:#313131;--blue:#8cb7fa;--danger:#f08a74;color-scheme:dark}}
:root[data-theme=dark]{--bg:#181818;--surface:#1f1f1f;--text:#efefec;--muted:#adada7;--subtle:#999992;--line:#313131;--hover:#313131;--blue:#8cb7fa;--danger:#f08a74;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:14px/20px system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;padding:24px 16px}
main{width:100%;max-width:360px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:28px 24px}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:-0.3px;margin-bottom:20px}
.mark{width:24px;height:24px;color:var(--text)}
h1{font-size:18px;line-height:24px;font-weight:600;margin:0 0 4px;letter-spacing:-0.2px}
p{margin:0;color:var(--muted)}
label{display:block;font-size:12px;color:var(--muted);margin:16px 0 6px}
input{width:100%;padding:9px 12px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--text);font:inherit;font-size:16px}
input:focus{outline:2px solid var(--blue);outline-offset:-1px;border-color:transparent}
button{width:100%;margin-top:12px;padding:9px 12px;min-height:40px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--text);font:inherit;font-weight:500;cursor:pointer}
button.primary{background:var(--text);color:var(--surface);border-color:var(--text)}
button.link{border:0;background:none;color:var(--muted);text-decoration:underline;min-height:0;padding:4px;margin-top:8px}
button:disabled{opacity:.55;cursor:default}
button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.or{display:flex;align-items:center;gap:12px;color:var(--subtle);font-size:12px;margin:20px 0 4px}
.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
.msg{min-height:20px;margin-top:12px;font-size:13px;color:var(--muted)}
.msg.error{color:var(--danger)}
.facts{margin:16px 0 0;padding:12px;border:1px solid var(--line);border-radius:8px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px}
.facts dt{color:var(--subtle)}.facts dd{margin:0;overflow-wrap:anywhere}
.warn{margin-top:12px;font-size:13px;color:var(--danger)}
.row{display:flex;gap:8px}.row button{flex:1}
.files{list-style:none;padding:0;margin:12px 0 0;font-size:13px}
.files li{padding:6px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}
a.button{display:block;text-align:center;margin-top:16px;padding:9px 12px;border-radius:6px;background:var(--text);color:var(--surface);text-decoration:none;font-weight:500}
[hidden]{display:none!important}
`;

export const page = (title: string, body: string, script = ""): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="manifest" href="/manifest.webmanifest" />
<title>${escapeHtml(title)}</title>
<script>${THEME_SCRIPT}</script>
<style>${STYLE}</style>
</head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body>
</html>`;

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="currentColor"/><path d="M18 30 32 18l14 12v15a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2Z" fill="none" stroke="var(--bg)" stroke-width="4" stroke-linejoin="round"/><path d="M27 47V36h10v11" fill="none" stroke="var(--bg)" stroke-width="4" stroke-linejoin="round"/></svg>`;

const brand = (appName: string): string => `<div class="brand">${MARK}${escapeHtml(appName)}</div>`;

export interface LoginPageContext {
  readonly appName: string;
  /** Where to go after signing in. Already checked to be a local path. */
  readonly next: string;
  /** False when neither the email binding nor DEV_LOG_CODES is configured. */
  readonly emailCodes: boolean;
}

export const loginPage = (ctx: LoginPageContext): string =>
  page(
    `Sign in · ${ctx.appName}`,
    `${brand(ctx.appName)}
<h1>Sign in</h1>
<p>Use a passkey, or get a code by email.</p>
<button id="passkey" class="primary" type="button">Sign in with a passkey</button>
<div class="or"${ctx.emailCodes ? "" : " hidden"}>or</div>
<form id="email-form"${ctx.emailCodes ? "" : " hidden"}>
  <label for="email">Email</label>
  <input id="email" type="email" autocomplete="email" required />
  <button id="send" type="submit">Email me a code</button>
</form>
<form id="code-form" hidden>
  <label for="code">Code from the email</label>
  <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
  <button id="verify" class="primary" type="submit">Sign in</button>
  <button id="back" class="link" type="button">Use a different email</button>
</form>
<p id="msg" class="msg" role="status"></p>`,
    `const NEXT = ${JSON.stringify(ctx.next)};
const $ = (id) => document.getElementById(id);
const say = (text, error) => { const m = $("msg"); m.textContent = text || ""; m.className = error ? "msg error" : "msg"; };
const post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
};
const b64uToBuf = (s) => { const b = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer; };
const bufToB64u = (buf) => { let bin = ""; for (const x of new Uint8Array(buf)) bin += String.fromCharCode(x); return btoa(bin).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
const done = () => location.replace(NEXT);

$("passkey").onclick = async () => {
  const btn = $("passkey"); say(); btn.disabled = true;
  try {
    if (!window.PublicKeyCredential) throw new Error("This browser doesn't support passkeys.");
    const { challengeId, options } = await post("/auth/passkey/login/options", {});
    const cred = await navigator.credentials.get({ publicKey: {
      challenge: b64uToBuf(options.challenge), rpId: options.rpId, timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) }))
    } });
    const r = cred.response;
    await post("/auth/passkey/login/verify", { challengeId, response: {
      id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: { clientDataJSON: bufToB64u(r.clientDataJSON), authenticatorData: bufToB64u(r.authenticatorData),
        signature: bufToB64u(r.signature), userHandle: r.userHandle ? bufToB64u(r.userHandle) : undefined }
    } });
    done();
  } catch (e) {
    say(e.name === "NotAllowedError" ? "Passkey sign-in was cancelled." : e.message, true);
  } finally { btn.disabled = false; }
};

$("email-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const btn = $("send"); say(); btn.disabled = true;
  try {
    const email = $("email").value.trim();
    await post("/auth/code/send", { email });
    $("email-form").hidden = true; $("code-form").hidden = false; $("code").focus();
    say("If " + email + " belongs to a member, a code is on its way.");
  } catch (e) { say(e.message, true); } finally { btn.disabled = false; }
};

$("code-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const btn = $("verify"); say(); btn.disabled = true;
  try {
    await post("/auth/code/verify", { email: $("email").value.trim(), code: $("code").value.trim() });
    done();
  } catch (e) { say(e.message, true); } finally { btn.disabled = false; }
};

$("back").onclick = () => { $("code-form").hidden = true; $("email-form").hidden = false; $("code").value = ""; say(); $("email").focus(); };`
  );

export interface ConsentPageContext {
  readonly appName: string;
  readonly handle: string;
  readonly clientName: string;
  readonly clientDomain?: string;
  readonly redirectHost: string;
  readonly redirectIsLoopback: boolean;
  readonly userEmail: string;
}

export const consentPage = (ctx: ConsentPageContext): string =>
  page(
    `Connect · ${ctx.appName}`,
    `${brand(ctx.appName)}
<h1>Connect ${escapeHtml(ctx.clientName)}?</h1>
<p>It will be able to read and change everything in ${escapeHtml(ctx.appName)}, as ${escapeHtml(ctx.userEmail)}.</p>
<dl class="facts">
  <dt>App</dt><dd>${escapeHtml(ctx.clientName)}${ctx.clientDomain ? ` (${escapeHtml(ctx.clientDomain)})` : " (name not verified)"}</dd>
  <dt>Sends you to</dt><dd>${escapeHtml(ctx.redirectHost)}</dd>
</dl>
${ctx.redirectIsLoopback ? `<p class="warn">This app runs on your own computer. Only continue if you started this connection yourself.</p>` : ""}
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escapeHtml(ctx.handle)}" />
  <div class="row">
    <button type="submit" name="decision" value="deny">Cancel</button>
    <button type="submit" name="decision" value="approve" class="primary">Allow</button>
  </div>
</form>`
  );

export const messagePage = (appName: string, heading: string, text: string): string =>
  page(appName, `${brand(appName)}<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p>`);

export interface UploadPageContext {
  readonly appName: string;
  readonly targetTitle: string;
  /** "item" or the entry type's singular name, lower case. */
  readonly targetLabel: string;
  readonly expiresAt: number;
}

/** The page behind a one-time upload link. A plain multipart form, so it works without the SPA. */
export const uploadPage = (ctx: UploadPageContext): string =>
  page(
    `Add files · ${ctx.appName}`,
    `${brand(ctx.appName)}
<h1>Add files</h1>
<p>To <strong style="color:var(--text)">${escapeHtml(ctx.targetTitle)}</strong> (${escapeHtml(ctx.targetLabel)}).</p>
<form id="form" method="post" enctype="multipart/form-data">
  <input id="pick" name="file" type="file" multiple accept="application/pdf,image/*,text/plain" hidden />
  <input id="camera" name="file" type="file" accept="image/*" capture="environment" hidden />
  <div class="row">
    <button type="button" id="pick-btn">Choose files</button>
    <button type="button" id="camera-btn">Take a photo</button>
  </div>
  <ul id="files" class="files"></ul>
  <button id="upload" class="primary" type="submit" disabled>Upload</button>
</form>
<p class="msg">This link works once and expires at <span id="expires"></span>.</p>`,
    `const $ = (id) => document.getElementById(id);
$("expires").textContent = new Date(${ctx.expiresAt}).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const render = () => {
  const files = [...$("pick").files, ...$("camera").files];
  $("files").replaceChildren(...files.map((f) => { const li = document.createElement("li"); li.textContent = f.name + " · " + Math.max(1, Math.round(f.size / 1024)) + " KB"; return li; }));
  $("upload").disabled = files.length === 0;
  $("upload").textContent = files.length > 1 ? "Upload " + files.length + " files" : "Upload";
};
$("pick-btn").onclick = () => $("pick").click();
$("camera-btn").onclick = () => $("camera").click();
$("pick").onchange = render;
$("camera").onchange = render;
$("form").onsubmit = () => { $("upload").disabled = true; $("upload").textContent = "Uploading…"; };`
  );

export const uploadDonePage = (appName: string, count: number, targetTitle: string, openHref: string): string =>
  page(
    `Saved · ${appName}`,
    `${brand(appName)}<h1>Saved ${count} file${count === 1 ? "" : "s"}</h1>
<p>Attached to ${escapeHtml(targetTitle)}. You can close this page; your assistant can see the files now. This link can't be used again.</p>
<a class="button" href="${escapeHtml(openHref)}">Open in ${escapeHtml(appName)}</a>`
  );
