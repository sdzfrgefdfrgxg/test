// protDeob discord bot
// commands: .obf  .ib2  .prom  .luraph  .l/.dump  .msec  .decomp  .get  .bf  .min/.minify  .luar  .run  .wl  .bl

const {
  Client,
  GatewayIntentBits,
  Partials,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs").promises;
const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");

// load oracle key from the existing IB2Deobf/.env
require("dotenv").config({
  path: require("path").join(__dirname, "IB2Deobf", ".env"),
});

// ── config ────────────────────────────────────────────────────────────────────
const TOKEN =
  "token";
const OWNER_ID = "812341395804127302";

// full path to lua 5.1 executable on this machine
const LUA_EXE = "C:\\Program Files (x86)\\Lua\\5.1\\lua.exe";

// ── whitelist / blacklist ─────────────────────────────────────────────────────
const WL_PATH = path.join(__dirname, "whitelist.json");

// In-memory store: { userId: { expires: number|null, blacklisted: boolean } }
// expires = null  → never expires
// expires = unix ms timestamp → expires at that time
let _wlData = {};

async function wlLoad() {
  try {
    const raw = await fs.readFile(WL_PATH, "utf8");
    _wlData = JSON.parse(raw);
  } catch {
    _wlData = {};
  }
}

async function wlSave() {
  await fs.writeFile(WL_PATH, JSON.stringify(_wlData, null, 2), "utf8");
}

/** Returns true if the user is allowed to use the bot. Owner always passes. */
function wlCheck(userId) {
  if (userId === OWNER_ID) return true;
  const entry = _wlData[userId];
  if (!entry) return false;
  if (entry.blacklisted) return false;
  if (entry.expires !== null && Date.now() > entry.expires) return false;
  return true;
}

/**
 * Parses a duration string like "1hr", "2h", "3d", "30m", "inf", "1day"
 * Returns milliseconds, or null for infinite.
 */
function parseDuration(str) {
  if (!str || str === "inf" || str === "infinite" || str === "forever")
    return null;
  const m = str.match(
    /^(\d+(?:\.\d+)?)\s*(hr?s?|hours?|d(?:ays?)?|m(?:ins?|inutes?)?)$/i,
  );
  if (!m) return undefined; // invalid
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("m")) return Math.round(n * 60 * 1000);
  if (unit.startsWith("h")) return Math.round(n * 60 * 60 * 1000);
  if (unit.startsWith("d")) return Math.round(n * 24 * 60 * 60 * 1000);
  return undefined;
}

function wlExpireStr(entry) {
  if (!entry) return "—";
  if (entry.expires === null) return "never";
  const remaining = entry.expires - Date.now();
  if (remaining <= 0) return "expired";
  const days = Math.floor(remaining / 86400000);
  const hrs = Math.floor((remaining % 86400000) / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── .wl ───────────────────────────────────────────────────────────────────────
async function cmdWl(msg) {
  if (msg.author.id !== OWNER_ID) return; // silently ignore

  // Parse:  .wl <@user|id> [duration]
  const args = msg.content.trim().split(/\s+/);
  // args[0] = ".wl"
  const rawTarget = args[1];
  const durationStr = args[2]; // optional

  if (!rawTarget || rawTarget === "list") {
    const entries = Object.entries(_wlData).filter(([, e]) => !e.blacklisted);
    if (entries.length === 0) return msg.reply("whitelist is empty.");
    const lines = entries.map(([id, e]) => {
      const exp = e.expires === null ? "permanent" : wlExpireStr(e);
      return `  ${id}  expires: ${exp}`;
    });
    return msg.reply(
      "whitelist (" + entries.length + "):\n```\n" + lines.join("\n") + "\n```",
    );
  }

  const userId = rawTarget.replace(/[<@!>]/g, "");
  if (!/^\d+$/.test(userId))
    return msg.reply("invalid user — mention them or paste their ID.");

  const durMs = durationStr ? parseDuration(durationStr) : null;
  if (durMs === undefined)
    return msg.reply(
      `invalid duration \`${durationStr}\`. Examples: \`1hr\`, \`2d\`, \`30m\`, \`inf\``,
    );

  _wlData[userId] = {
    expires: durMs === null ? null : Date.now() + durMs,
    blacklisted: false,
  };
  await wlSave();

  const expStr = durMs === null ? "permanent" : wlExpireStr(_wlData[userId]);
  return msg.reply(`<@${userId}> whitelisted — expires: ${expStr}`);
}

// ── .bl ───────────────────────────────────────────────────────────────────────
async function cmdBl(msg) {
  if (msg.author.id !== OWNER_ID) return; // silently ignore

  const args = msg.content.trim().split(/\s+/);
  const rawTarget = args[1];
  const durationStr = args[2];

  if (!rawTarget || rawTarget === "list") {
    const entries = Object.entries(_wlData).filter(([, e]) => e.blacklisted);
    if (entries.length === 0) return msg.reply("blacklist is empty.");
    const lines = entries.map(([id, e]) => {
      const exp = e.expires === null ? "permanent" : wlExpireStr(e);
      return `  ${id}  until: ${exp}`;
    });
    return msg.reply(
      "blacklist (" + entries.length + "):\n```\n" + lines.join("\n") + "\n```",
    );
  }

  const userId = rawTarget.replace(/[<@!>]/g, "");
  if (!/^\d+$/.test(userId))
    return msg.reply("invalid user — mention them or paste their ID.");

  // Toggle off if already blacklisted
  if (_wlData[userId]?.blacklisted) {
    _wlData[userId].blacklisted = false;
    _wlData[userId].expires = null;
    await wlSave();
    return msg.reply(`<@${userId}> un-blacklisted, whitelisted permanently.`);
  }

  const durMs = durationStr ? parseDuration(durationStr) : null;
  if (durMs === undefined)
    return msg.reply(
      `invalid duration \`${durationStr}\`. Examples: \`1hr\`, \`2d\`, \`30m\`, \`inf\``,
    );

  _wlData[userId] = {
    expires: durMs === null ? null : Date.now() + durMs,
    blacklisted: true,
  };
  await wlSave();

  const expStr = durMs === null ? "permanent" : wlExpireStr(_wlData[userId]);
  return msg.reply(`<@${userId}> blacklisted — until: ${expStr}`);
}

// ── oracle client (ib2 decompilation) ───────────────────────────────────────
const OracleClient = require("./IB2Deobf/OracleClient");
const ORACLE_KEY = process.env.ORACLE || "";
if (ORACLE_KEY) {
  OracleClient.setKey(ORACLE_KEY);
  console.log("oracle key loaded from IB2Deobf/.env");
} else {
  console.log("no oracle key found — ib2 will return raw bytecode");
}

// ── paths ─────────────────────────────────────────────────────────────────────
const ROOT = __dirname;
const OBF_DIR = path.join(ROOT, "25ms-obf");
const IB2_DIR = path.join(ROOT, "IB2Deobf", "ib2deobf");
const PROM_DIR = path.join(ROOT, "unveilr-promdeobf");

// 25ms_fixed_source paths
const FIXED_DIR = path.join(ROOT, "25ms_fixed_source");
const FIXED_ORIGINAL = path.join(FIXED_DIR, "dumps", "original");
const FIXED_DUMPED = path.join(FIXED_DIR, "dumps", "dumped");
const LUNE_EXE = path.join(FIXED_DIR, "lune.exe");

// MoonsecDeobfuscator
const MSEC_CWD = path.join(
  ROOT,
  "MoonsecDeobfuscator",
  "bin",
  "Release",
  "net9.0",
);
const MSEC_EXE = path.join(MSEC_CWD, "MoonsecDeobfuscator.exe");

// shiny (medal) decompiler paths
const SHINY_DIR = path.join(ROOT, "shiny");
const MEDAL_EXE = path.join(SHINY_DIR, "medal.exe");

// unluac-rs — cross-platform Lua decompiler (https://github.com/x3zvawq/unluac-rs)
const UNLUAC_CLI = path.join(ROOT, "unluac-1.2.5-windows-x86_64.exe");

// unveilr modules — beautifier + minifier pulled from unveilr_v3_source
const UNVEILR_DIR = path.join(ROOT, "modules");
const beautify = (() => {
  try {
    return require(path.join(UNVEILR_DIR, "lua_beautifier"));
  } catch {
    return null;
  }
})();
const minify = (() => {
  try {
    return require(path.join(UNVEILR_DIR, "minify"));
  } catch {
    return null;
  }
})();

// ensure dump dirs exist at startup
fs.mkdir(FIXED_ORIGINAL, { recursive: true }).catch(() => {});
fs.mkdir(FIXED_DUMPED, { recursive: true }).catch(() => {});
fs.mkdir(SHINY_DIR, { recursive: true }).catch(() => {});

// ── helpers ───────────────────────────────────────────────────────────────────
const genId = () => crypto.randomBytes(8).toString("hex");

/**
 * Resolves the code to process from a Discord message.
 * Priority: codeblock > file attachment > url > reply chain
 */
const getContent = async (msg, depth = 0) => {
  if (depth > 10) return [false, "too many chained replies"];

  const text = msg.content;

  // multiline codeblock  ```...```
  const multi = text.match(/```(?:\w*\n)?([\s\S]*?)```/);
  if (multi?.[1]?.trim()) return [true, multi[1].trim()];

  // inline codeblock  `...`
  const inline = text.match(/`([^`\n]+)`/);
  if (inline?.[1]?.trim()) return [true, inline[1].trim()];

  // file attachment
  const att = msg.attachments.first();
  if (att) {
    try {
      const res = await fetch(att.url);
      if (!res.ok)
        return [false, `failed to download attachment (http ${res.status})`];
      return [true, await res.text()];
    } catch (e) {
      return [false, `failed to download attachment: ${e.message}`];
    }
  }

  // url in message body
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch) {
    try {
      const res = await fetch(urlMatch[0]);
      if (!res.ok) return [false, `failed to fetch url (http ${res.status})`];
      return [true, await res.text()];
    } catch (e) {
      return [false, `failed to fetch url: ${e.message}`];
    }
  }

  // replied-to message
  if (msg.reference) {
    try {
      const ref = await msg.fetchReference();
      return getContent(ref, depth + 1);
    } catch {
      return [false, "failed to fetch the replied message"];
    }
  }

  return [
    false,
    "no content found — use a codeblock, file, url, or reply to a message containing code",
  ];
};

/**
 * Spawns a subprocess and resolves when it exits with code 0.
 */
const run = (exe, args, cwd, timeoutMs = 120_000) =>
  new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("process timed out (120s)"));
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const firstLine =
          (stderr + "\n" + stdout)
            .split("\n")
            .map((l) => l.replace(/\r/g, "").trim())
            .find((l) => l.length > 0) || `exited with code ${code}`;
        reject(new Error(firstLine));
      }
    });
  });

/** Safely deletes a file, ignoring errors. */
const unlink = (f) => fs.unlink(f).catch(() => {});

// ── moonsec bytecode stripper ─────────────────────────────────────────────────
/**
 * stripMsecBytecode(source)
 *
 * When all decompilers fail on MoonsecDeobfuscator output, this function
 * strips raw Lua 5.1 bytecode junk from the source, keeping only printable
 * Lua-looking tokens and string literals that are clearly real code.
 *
 * Heuristics used:
 *   - Keep lines that contain identifiers matching known Lua patterns
 *     (function names, strings, keywords, http/github URLs, etc.)
 *   - Drop lines that are >50% non-printable or high-byte characters
 *   - Preserve any string literal that looks like a URL or API endpoint
 *   - Re-indent based on do/end/function/if/else/elseif/then depth
 *
 * The output is NOT valid Lua — it is a best-effort readable skeleton
 * to help understand what the script does, with the raw bytecode still
 * attached as a separate file.
 */
function stripMsecBytecode(source) {
  // Patterns for lines worth keeping
  const KEEP_PATTERNS = [
    /https?:\/\/[^\s\x00-\x1f]+/, // URLs
    /[A-Za-z_]\w*\s*[(:=,{]/, // function calls / assignments
    /["'][^"'\x00-\x1f]{3,}["']/, // string literals (3+ printable chars)
    /\b(function|local|return|if|then|else|elseif|end|for|while|do|repeat|until|break|and|or|not|true|false|nil)\b/,
    /SendNotification|pcall|xpcall|require|loadstring|rawget|rawset|setmetatable|getmetatable/,
    /game\.|workspace\.|script\.|Players\.|RunService\.|HttpService\./,
  ];

  const lines = source.split(/\r?\n/);
  const kept = [];

  for (const raw of lines) {
    // Skip lines that are mostly binary garbage
    const nonPrint = (raw.match(/[\x00-\x08\x0e-\x1f\x80-\xff]/g) || []).length;
    if (nonPrint / Math.max(raw.length, 1) > 0.3) continue;

    const trimmed = raw.trim();
    if (!trimmed) {
      kept.push("");
      continue;
    }

    if (KEEP_PATTERNS.some((p) => p.test(trimmed))) {
      kept.push(trimmed);
    }
  }

  if (kept.length === 0) return null; // nothing survived

  // Re-indent based on block depth
  let depth = 0;
  const indented = kept.map((line) => {
    if (!line) return "";

    // Decrease indent before these keywords
    if (/^\s*(end|else|elseif|until)\b/.test(line))
      depth = Math.max(0, depth - 1);

    const out = "    ".repeat(depth) + line.replace(/^\s+/, "");

    // Increase indent after these keywords
    if (
      /\b(do|then|else|function|repeat)\b/.test(line) &&
      !/\bend\b/.test(line)
    )
      depth++;

    return out;
  });

  return [
    "-- [[ MoonsecDeobfuscator output — decompilers failed ]]",
    "-- [[ bytecode stripped; only readable tokens kept    ]]",
    "-- [[ this is NOT valid Lua — raw .luac also attached  ]]",
    "",
    ...indented,
  ].join("\n");
}

// ── command handlers ──────────────────────────────────────────────────────────

/**
 * .obf — obfuscate lua with prometheus (25ms-obf)
 */
async function cmdObf(msg) {
  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const id = genId();
  const inFile = path.join(OBF_DIR, `${id}_in.lua`);
  const outFile = path.join(OBF_DIR, `${id}_out.lua`);

  const m = await msg.reply("processing...");

  try {
    await fs.writeFile(inFile, content, "utf8");
    await run(
      LUA_EXE,
      ["./cli.lua", "--p", "Normal", "--o", outFile, inFile],
      OBF_DIR,
    );
    const result = await fs.readFile(outFile, "utf8");
    await m.edit({
      content: "done.",
      files: [
        new AttachmentBuilder(Buffer.from(result, "utf8"), {
          name: "obfuscated.lua",
        }),
      ],
    });
  } catch (e) {
    console.error("[obf]", e);
    let errText = e.message
      .split("\n")[0]
      .replace(/^.*?[/\\][^/\\]+\.exe:\s*/i, "")
      .replace(/^\.\//g, "")
      .replace(/^[^:]+:\d+:\s*/, "");
    if (
      errText.toLowerCase().includes("lexing error") ||
      errText.includes("Unexpected char")
    ) {
      const ch = (errText.match(/Unexpected char "(.+?)"/) || [])[1] || "?";
      errText = `parse error (unexpected char '${ch}') — the file likely uses luau type annotations (e.g. string?) which prometheus doesn't support`;
    }
    await m.edit(`error: ${errText}`).catch(() => {});
  } finally {
    unlink(inFile);
    unlink(outFile);
  }
}

/**
 * .ib2 — deobfuscate ironbrew 2 scripts
 */
async function cmdIb2(msg) {
  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const id = genId();
  const inFile = `${id}_in`;
  const outFile = `${id}_out.luac`;
  const absOut = path.join(IB2_DIR, outFile);

  const m = await msg.reply("processing...");

  try {
    await fs.writeFile(path.join(IB2_DIR, inFile), content, "utf8");
    await run(
      path.join(IB2_DIR, "LuaAnalysis.Ironbrew2.exe"),
      [inFile, outFile],
      IB2_DIR,
    );
    const rawBytes = await fs.readFile(absOut);

    await m.edit("deobfuscated. decompiling...");

    // ── attempt 1: unluac-rs (same as msec) ──
    const dcFile = path.join(SHINY_DIR, `${id}.luac`);
    try {
      await fs.writeFile(dcFile, rawBytes);
      const source = await decompileLua51(dcFile);
      return await m.edit({
        content: "done.",
        files: [
          new AttachmentBuilder(Buffer.from(source, "utf8"), {
            name: "deobfuscated.lua",
          }),
        ],
      });
    } catch (unluacRsErr) {
      console.error("[ib2/unluac-rs]", unluacRsErr.message);
    } finally {
      unlink(dcFile);
    }

    // ── attempt 2: oracle ──
    if (ORACLE_KEY) {
      try {
        const response = await OracleClient.decompile(
          rawBytes.toString("base64"),
        );
        if (response.ok) {
          const source = await response.text();
          return await m.edit({
            content: "done. (oracle)",
            files: [
              new AttachmentBuilder(Buffer.from(source, "utf8"), {
                name: "deobfuscated.lua",
              }),
            ],
          });
        }
        const errText = await response
          .text()
          .catch(() => `http ${response.status}`);
        await m.edit({
          content: `deobfuscated, but decompile failed: ${errText}\nraw bytecode attached.`,
          files: [
            new AttachmentBuilder(rawBytes, { name: "deobfuscated.luac" }),
          ],
        });
      } catch (oracleErr) {
        console.error("[ib2/oracle]", oracleErr);
        await m.edit({
          content: `deobfuscated, but decompile failed: ${oracleErr.message}\nraw bytecode attached.`,
          files: [
            new AttachmentBuilder(rawBytes, { name: "deobfuscated.luac" }),
          ],
        });
      }
    } else {
      // ── no oracle key: send raw ──
      const isBytecode = rawBytes[0] === 0x1b;
      await m.edit({
        content: isBytecode
          ? "all decompilers failed. raw bytecode attached — try `.decomp` on it."
          : "done.",
        files: [
          new AttachmentBuilder(rawBytes, {
            name: isBytecode ? "deobfuscated.luac" : "deobfuscated.lua",
          }),
        ],
      });
    }
  } catch (e) {
    console.error("[ib2]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  } finally {
    unlink(path.join(IB2_DIR, inFile));
    unlink(absOut);
  }
}

/**
 * .prom — deobfuscate prometheus-obfuscated scripts
 */
async function cmdProm(msg) {
  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const id = genId();
  const inFile = path.join(PROM_DIR, `${id}_in.lua`);
  const outFile = path.join(PROM_DIR, `${id}_out.lua`);

  const m = await msg.reply("processing...");

  try {
    await fs.writeFile(inFile, content, "utf8");
    await run("node", ["main.js", inFile, outFile], PROM_DIR, 180_000);
    const result = await fs.readFile(outFile, "utf8");
    await m.edit({
      content: "done.",
      files: [
        new AttachmentBuilder(Buffer.from(result, "utf8"), {
          name: "deobfuscated.lua",
        }),
      ],
    });
  } catch (e) {
    console.error("[prom]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  } finally {
    unlink(inFile);
    unlink(outFile);
  }
}

// ── shared lua 5.1 decompiler ─────────────────────────────────────────────────

async function runUnluacRs(inputFile, dialect = "lua5.1") {
  const { stdout, stderr } = await run(
    UNLUAC_CLI,
    ["-i", inputFile, "-D", dialect],
    ROOT,
    30_000,
  );
  if (!stdout.trim())
    throw new Error(
      "unluac-rs produced no output" + (stderr ? ": " + stderr.trim() : ""),
    );
  return stdout;
}

async function decompileLua51(inputFile) {
  return runUnluacRs(inputFile, "lua5.1");
}

// ── .msec — deobfuscate moonsec v3 ────────────────────────────────────────────
/**
 * Pipeline:
 *   1. MoonsecDeobfuscator.exe  → raw Lua 5.1 bytecode
 *   2. unluac-rs                 → decompiled lua source
 *   3. oracle                   → fallback decompile
 *   4. stripMsecBytecode()      → last-resort readable skeleton
 *                                 (raw .luac always attached alongside)
 */
async function cmdMsec(msg) {
  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const id = genId();
  const inFile = path.join(FIXED_ORIGINAL, `${id}.lua`);
  const outFile = path.join(FIXED_DUMPED, `${id}.luac`);

  const m = await msg.reply("processing...");

  try {
    await fs.writeFile(inFile, content, "utf8");
    await run(
      MSEC_EXE,
      ["-dev", "-i", inFile, "-o", outFile],
      MSEC_CWD,
      60_000,
    );
    const rawBytes = await fs.readFile(outFile);

    await m.edit("deobfuscated. decompiling...");

    const dcFile = path.join(SHINY_DIR, `${id}.luac`);

    // ── attempt 1: unluac-rs ──
    try {
      await fs.writeFile(dcFile, rawBytes);
      const source = await decompileLua51(dcFile);
      return await m.edit({
        content: "done.",
        files: [
          new AttachmentBuilder(Buffer.from(source, "utf8"), {
            name: "deobfuscated.lua",
          }),
        ],
      });
    } catch (unluacRsErr) {
      console.error("[msec/decomp]", unluacRsErr.message);
    } finally {
      unlink(dcFile);
    }

    // ── attempt 2: oracle ──
    if (ORACLE_KEY) {
      try {
        const response = await OracleClient.decompile(
          rawBytes.toString("base64"),
        );
        if (response.ok) {
          const source = await response.text();
          return await m.edit({
            content: "done. (oracle)",
            files: [
              new AttachmentBuilder(Buffer.from(source, "utf8"), {
                name: "deobfuscated.lua",
              }),
            ],
          });
        }
      } catch (oracleErr) {
        console.error("[msec/oracle]", oracleErr.message);
      }
    }

    // ── attempt 3: manual bytecode stripper ──
    // Convert rawBytes to a string representation so we can try to pull out
    // readable tokens (strings, identifiers, URLs, etc.) from the bytecode.
    await m.edit("decompilers failed. attempting bytecode extraction...");

    const rawString = rawBytes.toString("latin1"); // preserve bytes as chars
    const stripped = stripMsecBytecode(rawString);

    if (stripped) {
      return await m.edit({
        content: [
          "decompilers failed — extracted readable tokens from bytecode.",
          "this is NOT valid lua; it's a best-effort skeleton.",
          "raw .luac also attached.",
        ].join("\n"),
        files: [
          new AttachmentBuilder(Buffer.from(stripped, "utf8"), {
            name: "extracted.lua",
          }),
          new AttachmentBuilder(rawBytes, { name: "deobfuscated.luac" }),
        ],
      });
    }

    // ── all methods failed — send raw bytecode ──
    await m.edit({
      content:
        "all decompile methods failed. raw bytecode attached — try `.decomp` on it.",
      files: [new AttachmentBuilder(rawBytes, { name: "deobfuscated.luac" })],
    });
  } catch (e) {
    console.error("[msec]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  } finally {
    unlink(inFile);
    unlink(outFile);
  }
}

// ── .decomp — decompile lua(u) bytecode ───────────────────────────────────────

async function getBinaryContent(msg, depth = 0) {
  if (depth > 5) return null;

  const att = msg.attachments.first();
  if (att) {
    const res = await fetch(att.url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  }

  const url = extractUrl(msg.content);
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {}
  }

  if (msg.reference) {
    try {
      const ref = await msg.fetchReference();
      return getBinaryContent(ref, depth + 1);
    } catch {}
  }
  return null;
}

async function cmdDecomp(msg) {
  const bytes = await getBinaryContent(msg);
  if (!bytes) {
    return msg.reply(
      "no file found. attach a .luac bytecode file, include a url, or reply to a message with one.",
    );
  }

  const isLua51 = bytes.length >= 5 && bytes[4] === 0x51;

  const id = genId();
  const inFile = path.join(SHINY_DIR, `${id}.luac`);
  const m = await msg.reply("decompiling...");

  try {
    await fs.writeFile(inFile, bytes);

    let result;
    if (isLua51) {
      result = await decompileLua51(inFile);
    } else {
      const outFile = inFile + ".lua";
      try {
        await run(
          MEDAL_EXE,
          ["decompile", "-i", inFile, "-o", outFile],
          SHINY_DIR,
          30_000,
        );
        result = await fs.readFile(outFile, "utf8");
      } finally {
        unlink(outFile);
      }
    }

    await m.edit({
      content: `done. (${isLua51 ? "lua 5.1" : "luau"} bytecode)`,
      files: [
        new AttachmentBuilder(Buffer.from(result, "utf8"), {
          name: "decompiled.lua",
        }),
      ],
    });
  } catch (e) {
    console.error("[decomp]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  } finally {
    unlink(inFile);
  }
}

// ── url helpers ────────────────────────────────────────────────────────────────

const KNOWN_PREFIXES = [
  "https://raw.githubusercontent.com/",
  "https://gist.githubusercontent.com/",
  "https://pastebin.com/",
  "https://pastefy.app/",
  "https://paste.ee/r/",
  "https://rawscripts.net/raw/",
  "https://pandadevelopment.net/virtual/file/",
];

const cleanUrl = (raw) => raw.replace(/(?:["']|\]\]).*/, "").trim();

const normalisePastebin = (url) =>
  url.startsWith("https://pastebin.com/") &&
  !url.includes("/raw/") &&
  !url.endsWith(".com/")
    ? url.replace("https://pastebin.com/", "https://pastebin.com/raw/")
    : url;

const fetchUrl = async (url) => {
  url = normalisePastebin(cleanUrl(url));
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Roblox/WinInetRobloxApp/0.673.0.6730711 (GlobalDist; RobloxDirectDownload)",
    },
  });
  if (!res.ok) throw new Error(`http ${res.status} from ${url}`);
  return res.text();
};

const extractUrl = (text) => {
  const m = text.match(/https?:\/\/\S+/);
  return m ? cleanUrl(m[0]) : null;
};

// ── .luraph ────────────────────────────────────────────────────────────────────
const LUARMOR_RE = /https:\/\/api\.luarmor\.net\/files\/v\d+\/(loaders|l)\//;

async function cmdLuraph(msg) {
  const id = genId();
  const inName = `${id}.lua`;
  const inFile = path.join(FIXED_ORIGINAL, inName);
  const outFile = path.join(FIXED_DUMPED, inName);

  const rawUrl = extractUrl(msg.content);
  const isLuarmor = rawUrl && LUARMOR_RE.test(rawUrl);

  let content;
  if (isLuarmor) {
    const fetchTarget = rawUrl.replace(/\/loaders\//, "/l/");
    try {
      const res = await fetch(fetchTarget, {
        headers: { "User-Agent": "Xeno/RobloxApp/V1.0.9" },
      });
      if (!res.ok)
        return msg.reply(`error: luarmor fetch returned http ${res.status}`);
      content = await res.text();
    } catch (e) {
      return msg.reply(`error fetching luarmor url: ${e.message}`);
    }
  } else {
    const [ok, c] = await getContent(msg);
    if (!ok) return msg.reply(c);
    content = c;
  }

  await fs.writeFile(inFile, content, "utf8");
  const m = await msg.reply("processing...");

  try {
    const { stdout, stderr } = await run(
      LUNE_EXE,
      ["run", "./luraphdump.lua", inName],
      FIXED_DIR,
      90_000,
    );

    const outExists = await fs
      .access(outFile)
      .then(() => true)
      .catch(() => false);
    if (!outExists) {
      const hint =
        (stderr || stdout).split("\n").find((l) => l.trim()) ||
        "no output produced";
      return await m.edit(`error: ${hint}`);
    }

    const result = await fs.readFile(outFile, "utf8");
    const isPartial = result.includes("The script errored here");
    await m.edit({
      content: isPartial
        ? "done (partial — the loader errored midway, strings captured before the error are included)."
        : "done.",
      files: [
        new AttachmentBuilder(Buffer.from(result, "utf8"), {
          name: "dumped.lua",
        }),
      ],
    });
  } catch (e) {
    console.error("[luraph]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  } finally {
    unlink(inFile);
    unlink(outFile);
  }
}

// ── .l / .dump — envlogger dump (httplog2.lua) ────────────────────────────────
/**
 * Runs the script through httplog2.lua (the smart envlogger — fake-game env,
 * metatables, loop detection, http interception, variable name cleanup).
 * Accepts: file attachment, codeblock, URL, or a reply to any of those.
 */
async function cmdDump(msg) {
  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const id = genId();
  const inName = `${id}.lua`;
  const inFile = path.join(FIXED_ORIGINAL, inName);
  const outFile = path.join(FIXED_DUMPED, inName);

  await fs.writeFile(inFile, content, "utf8");
  const m = await msg.reply("dumping... (up to 45s)");

  try {
    let stdout = "";
    let stderr = "";

    // run lune with httplog2.lua; pass author id as second arg (user_based mode)
    await new Promise((resolve, reject) => {
      const proc = spawn(
        LUNE_EXE,
        ["run", "./httplog2.lua", inName, msg.author.id],
        { cwd: FIXED_DIR, stdio: ["ignore", "pipe", "pipe"] },
      );

      proc.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      proc.stderr?.on("data", (d) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error("timeout"));
      }, 45_000);

      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // ── output file produced (normal path) ──
    const outExists = await fs
      .access(outFile)
      .then(() => true)
      .catch(() => false);
    if (outExists) {
      const result = await fs.readFile(outFile, "utf8");
      return await m.edit({
        content: "done.",
        files: [
          new AttachmentBuilder(Buffer.from(result, "utf8"), {
            name: "dump.lua",
          }),
        ],
      });
    }

    // ── no file but stdout has content (infinite-loop partial path) ──
    if (stdout.trim()) {
      // httplog2.lua always prepends two comment lines to stdout in bot mode, strip them
      const lines = stdout.split("\n");
      const startIdx = lines.findIndex(
        (l) =>
          !l.startsWith("-- wow this script") && !l.startsWith("-- script id:"),
      );
      const cleaned = (
        startIdx === -1 ? stdout : lines.slice(startIdx).join("\n")
      ).trim();
      const MAX = 4 * 1024 * 1024;
      const data = Buffer.from(cleaned || stdout, "utf8").slice(0, MAX);
      return await m.edit({
        content: "script hit an infinite loop — partial dump attached.",
        files: [new AttachmentBuilder(data, { name: "partial_dump.lua" })],
      });
    }

    // ── complete failure ──
    const hint =
      (stderr + "\n" + stdout)
        .split("\n")
        .map((l) => l.replace(/\r/g, "").trim())
        .find((l) => l.length > 0) || "no output produced";
    await m.edit(`error: ${hint.slice(0, 300)}`);
  } catch (e) {
    console.error("[dump]", e);
    const msg1 =
      e.message === "timeout"
        ? "timed out (>45s) — script may have an infinite loop or be too large"
        : e.message.split("\n")[0];
    await m.edit(`error: ${msg1}`).catch(() => {});
  } finally {
    unlink(inFile);
    unlink(outFile);
  }
}

// unveilr `.l` command integration
const unveilr = require('./unveilr.js');

if (
  text.startsWith('.l') ||
  text.startsWith('.dump') ||
  text.startsWith('.log') ||
  text.startsWith('.envlog') ||
  text.startsWith('.unveilr') ||
  text.startsWith('.d')
) {
  try {
    await unveilr.execute(msg);
  } catch (err) {
    console.error('[unveilr error]', err);
    await msg.reply(`❌ UnveilR failed: ${err.message}`);
  }
  return;
}


// ── .get ───────────────────────────────────────────────────────────────────────
async function cmdGet(msg) {
  const url = extractUrl(msg.content);
  if (!url) return msg.reply("no url found. usage: .get <url>");

  const m = await msg.reply("fetching...");

  try {
    const body = await fetchUrl(url);
    if (!body || !body.trim())
      return await m.edit("url returned an empty response");
    await m.edit({
      content: "done.",
      files: [
        new AttachmentBuilder(Buffer.from(body, "utf8"), {
          name: "soup_get.lua",
        }),
      ],
    });
  } catch (e) {
    console.error("[get]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  }
}

// ── .bf — beautify lua code ────────────────────────────────────────────────────
/**
 * Uses the lua_beautifier module from unveilr_v3_source.
 * Copy  unveilr_v3_source/modules/lua_beautifier.js
 *   and unveilr_v3_source/modules/minify.js
 * into  <bot root>/unveilr_modules/
 * (also needs: npm install luaparse  in that directory)
 */
async function cmdBeautify(msg) {
  if (!beautify) {
    return msg.reply(
      "beautifier not available — copy `lua_beautifier.js` from unveilr_v3_source/modules/ into `unveilr_modules/` and run `npm install luaparse` there.",
    );
  }

  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const m = await msg.reply("beautifying...");

  try {
    const result = beautify(content);
    if (!result || !result.trim()) {
      return await m.edit(
        "beautifier returned empty output — is the input valid lua?",
      );
    }

    await m.edit({
      content: "done.",
      files: [
        new AttachmentBuilder(Buffer.from(result, "utf8"), {
          name: "beautified.lua",
        }),
      ],
    });
  } catch (e) {
    console.error("[bf]", e);
    const msg1 = e.message.split("\n")[0];
    await m.edit(`error: ${msg1}`).catch(() => {});
  }
}

// ── .min / .minify — minify lua code ──────────────────────────────────────────
/**
 * Uses the minify module from unveilr_v3_source.
 * Same setup as beautify above.
 */
async function cmdMinify(msg) {
  if (!minify) {
    return msg.reply(
      "minifier not available — copy `minify.js` from unveilr_v3_source/modules/ into `unveilr_modules/`.",
    );
  }

  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const m = await msg.reply("minifying...");

  try {
    const result = minify(content);
    if (!result || !result.trim()) {
      return await m.edit(
        "minifier returned empty output — is the input valid lua?",
      );
    }

    await m.edit({
      content: "done.",
      files: [
        new AttachmentBuilder(Buffer.from(result, "utf8"), {
          name: "minified.lua",
        }),
      ],
    });
  } catch (e) {
    console.error("[min]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  }
}

// ── .run — execute Lua code via lune ─────────────────────────────────────────
//
// Usage:
//   .run               (with a codeblock, file attachment, URL, or reply)
//
// Runs Lua 5.1 / Luau code through the local lune.exe with a 15s timeout.
// stdout + stderr are returned; output is capped at 1900 chars.
// Lune's built-in globals (task, fs, net, etc.) are available.

async function cmdRun(msg) {
  const [ok, content] = await getContent(msg);
  if (!ok) return msg.reply(content);

  const id = genId();
  const scriptFile = path.join(FIXED_DIR, `run_${id}.lua`);
  await fs.writeFile(scriptFile, content, "utf8");

  const m = await msg.reply(
    "running (up to 15s) — plain Lua/Luau only, not obfuscated Roblox scripts",
  );

  try {
    let stdout = "";
    let stderr = "";

    await new Promise((resolve, reject) => {
      const proc = spawn(LUNE_EXE, ["run", `run_${id}.lua`], {
        cwd: FIXED_DIR,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      proc.stderr?.on("data", (d) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error("timed out (>15s)"));
      }, 15_000);

      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const combined = [stdout, stderr]
      .map((s) => s.replace(/\r/g, "").trimEnd())
      .filter(Boolean)
      .join("\n");

    if (!combined) return await m.edit("done — no output.");

    const display =
      combined.length > 1900
        ? combined.slice(0, 1900) + "\n… (truncated)"
        : combined;

    await m.edit("```\n" + display + "\n```");
  } catch (e) {
    console.error("[run]", e);
    await m.edit(`error: ${e.message.split("\n")[0]}`).catch(() => {});
  } finally {
    unlink(scriptFile);
  }
}

// ── .luar / .luarmor — Luarmor API management ─────────────────────────────────
//
// Usage (OWNER_ID only):
//   .luar set-key <api_key>                  — save your Luarmor API key for this session
//   .luar projects                           — list all projects on your API key
//   .luar users <project_id>                 — list all users in a project
//   .luar get <project_id> <discord|key|hwid> <value>  — look up a specific user
//   .luar add <project_id> [discord=ID] [days=N] [note=text] — create a key
//   .luar remove <project_id> <user_key>     — delete a key
//   .luar reset <project_id> <user_key>      — reset HWID for a key
//   .luar ban <project_id> <user_key> [reason] — ban a key
//   .luar unban <project_id> <unban_token>   — unban by token
//   .luar link <project_id> <user_key> <discord_id> — link Discord ID to key
//   .luar script <project_id> <script_id>    — update script content (attach .lua file)
//   .luar stats <api_key>                    — get key stats
//
// Store your API key with .luar set-key once; subsequent commands use it automatically.

let _luarmorApiKey = "";

const LUARMOR_BASE = "https://api.luarmor.net/v3";

async function luarRequest(method, path, body) {
  const url = `${LUARMOR_BASE}${path}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: _luarmorApiKey,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let json;
  try {
    json = await res.json();
  } catch {
    json = { success: false, message: `HTTP ${res.status}` };
  }
  return { status: res.status, json };
}

function luarFmt(json) {
  return "```json\n" + JSON.stringify(json, null, 2).slice(0, 1900) + "\n```";
}

async function cmdLuar(msg) {
  if (msg.author.id !== OWNER_ID)
    return msg.reply("this command is owner-only.");

  const args = msg.content.trim().split(/\s+/);
  // args[0] = ".luar", args[1] = subcommand
  const sub = (args[1] || "").toLowerCase();

  // ── set-key ──────────────────────────────────────────────────────────────────
  if (sub === "set-key") {
    const key = args[2];
    if (!key) return msg.reply("usage: `.luar set-key <api_key>`");
    _luarmorApiKey = key;
    return msg.reply("Luarmor API key saved for this session.");
  }

  if (!_luarmorApiKey) {
    return msg.reply(
      "no API key set. use `.luar set-key <api_key>` first (get it from luarmor.net/profile).",
    );
  }

  // ── stats ─────────────────────────────────────────────────────────────────────
  if (sub === "stats") {
    const apiKey = args[2] || _luarmorApiKey;
    const { json } = await luarRequest(
      "GET",
      `/keys/${apiKey}/stats?noUsers=false`,
      null,
    );
    return msg.reply(luarFmt(json));
  }

  // ── projects ──────────────────────────────────────────────────────────────────
  if (sub === "projects") {
    const { json } = await luarRequest(
      "GET",
      `/keys/${_luarmorApiKey}/details`,
      null,
    );
    if (!json.success) return msg.reply(luarFmt(json));
    const lines = (json.projects || []).map(
      (p) =>
        `${p.id}  ${p.name}  (${p.platform}) — ${p.scripts?.length ?? 0} script(s)`,
    );
    const embed = new EmbedBuilder()
      .setTitle("Luarmor Projects")
      .setColor(0x5865f2)
      .setDescription(lines.join("\n") || "no projects found.");
    return msg.reply({ embeds: [embed] });
  }

  // ── users <project_id> ───────────────────────────────────────────────────────
  if (sub === "users") {
    const projectId = args[2];
    if (!projectId) return msg.reply("usage: `.luar users <project_id>`");
    const { json } = await luarRequest(
      "GET",
      `/projects/${projectId}/users`,
      null,
    );
    if (!json.success) return msg.reply(luarFmt(json));
    const users = json.users || [];
    if (users.length === 0) return msg.reply("no users in this project.");
    const lines = users.slice(0, 25).map((u) => {
      const expire =
        u.auth_expire === -1
          ? "never"
          : new Date(u.auth_expire * 1000).toISOString().slice(0, 10);
      const status = u.banned ? "banned" : u.status;
      return `${u.user_key}  ${status}  expires: ${expire}  discord: ${u.discord_id || "-"}`;
    });
    if (users.length > 25) lines.push(`…and ${users.length - 25} more`);
    const embed = new EmbedBuilder()
      .setTitle(`Users in ${projectId}`)
      .setColor(0x5865f2)
      .setDescription(lines.join("\n"));
    return msg.reply({ embeds: [embed] });
  }

  // ── get <project_id> <field> <value> ─────────────────────────────────────────
  if (sub === "get") {
    const [, , projectId, field, value] = args;
    if (!projectId || !field || !value)
      return msg.reply(
        "usage: `.luar get <project_id> <discord|key|hwid> <value>`",
      );
    const paramMap = {
      discord: "discord_id",
      key: "user_key",
      hwid: "identifier",
    };
    const param = paramMap[field.toLowerCase()];
    if (!param) return msg.reply("field must be: discord, key, or hwid");
    const { json } = await luarRequest(
      "GET",
      `/projects/${projectId}/users?${param}=${encodeURIComponent(value)}`,
      null,
    );
    return msg.reply(luarFmt(json));
  }

  // ── add <project_id> [discord=ID] [days=N] [note=...] ───────────────────────
  if (sub === "add") {
    const projectId = args[2];
    if (!projectId)
      return msg.reply(
        "usage: `.luar add <project_id> [discord=ID] [days=N] [note=text]`",
      );
    const body = {};
    const rest = args.slice(3).join(" ");
    const discordMatch = rest.match(/discord=(\S+)/);
    const daysMatch = rest.match(/days=(\d+)/);
    const noteMatch = rest.match(/note=(.+)/);
    if (discordMatch) body.discord_id = discordMatch[1];
    if (daysMatch) body.key_days = parseInt(daysMatch[1], 10);
    if (noteMatch) body.note = noteMatch[1].trim();
    const { json } = await luarRequest(
      "POST",
      `/projects/${projectId}/users`,
      body,
    );
    if (!json.success) return msg.reply(luarFmt(json));
    return msg.reply(`key created: ${json.user_key}`);
  }

  // ── remove <project_id> <user_key> ───────────────────────────────────────────
  if (sub === "remove") {
    const [, , projectId, userKey] = args;
    if (!projectId || !userKey)
      return msg.reply("usage: `.luar remove <project_id> <user_key>`");
    const { json } = await luarRequest(
      "DELETE",
      `/projects/${projectId}/users?user_key=${encodeURIComponent(userKey)}`,
      null,
    );
    return msg.reply(json.success ? `key ${userKey} deleted.` : luarFmt(json));
  }

  // ── reset <project_id> <user_key> [force] ────────────────────────────────────
  if (sub === "reset") {
    const [, , projectId, userKey] = args;
    const force = args.includes("force");
    if (!projectId || !userKey)
      return msg.reply("usage: `.luar reset <project_id> <user_key> [force]`");
    const { json } = await luarRequest(
      "POST",
      `/projects/${projectId}/users/resethwid`,
      {
        user_key: userKey,
        force,
      },
    );
    return msg.reply(
      json.success ? `HWID reset for ${userKey}.` : luarFmt(json),
    );
  }

  // ── ban <project_id> <user_key> [reason] ─────────────────────────────────────
  if (sub === "ban") {
    const [, , projectId, userKey, ...reasonParts] = args;
    if (!projectId || !userKey)
      return msg.reply("usage: `.luar ban <project_id> <user_key> [reason]`");
    const { json } = await luarRequest(
      "POST",
      `/projects/${projectId}/users/blacklist`,
      {
        user_key: userKey,
        ban_reason: reasonParts.join(" ") || "Banned by admin",
        ban_expire: -1,
      },
    );
    return msg.reply(json.success ? `key ${userKey} banned.` : luarFmt(json));
  }

  // ── unban <project_id> <unban_token> ─────────────────────────────────────────
  if (sub === "unban") {
    const [, , projectId, unbanToken] = args;
    if (!projectId || !unbanToken)
      return msg.reply("usage: `.luar unban <project_id> <unban_token>`");
    const url = `${LUARMOR_BASE}/projects/${projectId}/users/unban?unban_token=${encodeURIComponent(unbanToken)}`;
    const res = await fetch(url);
    let json;
    try {
      json = await res.json();
    } catch {
      json = { success: false, message: `HTTP ${res.status}` };
    }
    return msg.reply(json.success ? "user unbanned." : luarFmt(json));
  }

  // ── link <project_id> <user_key> <discord_id> ────────────────────────────────
  if (sub === "link") {
    const [, , projectId, userKey, discordId] = args;
    if (!projectId || !userKey || !discordId)
      return msg.reply(
        "usage: `.luar link <project_id> <user_key> <discord_id>`",
      );
    const { json } = await luarRequest(
      "POST",
      `/projects/${projectId}/users/linkdiscord`,
      {
        user_key: userKey,
        discord_id: discordId,
        force: true,
      },
    );
    return msg.reply(
      json.success
        ? `discord ${discordId} linked to key ${userKey}.`
        : luarFmt(json),
    );
  }

  // ── script <project_id> <script_id> ──────────────────────────────────────────
  if (sub === "script") {
    const [, , projectId, scriptId] = args;
    if (!projectId || !scriptId)
      return msg.reply(
        "usage: `.luar script <project_id> <script_id>` (attach a .lua file)",
      );
    const att = msg.attachments.first();
    if (!att)
      return msg.reply("attach a .lua file with the new script content.");
    const m = await msg.reply("uploading script...");
    try {
      const scriptContent = await (await fetch(att.url)).text();
      const { json } = await luarRequest(
        "PUT",
        `/projects/${projectId}/scripts/${scriptId}`,
        { script: scriptContent },
      );
      if (json.success) {
        await m.edit("script updated on Luarmor.");
      } else {
        await m.edit(luarFmt(json));
      }
    } catch (e) {
      await m.edit(`error: ${e.message}`);
    }
    return;
  }

  // ── help ──────────────────────────────────────────────────────────────────────
  const helpEmbed = new EmbedBuilder()
    .setTitle("Luarmor API Commands")
    .setColor(0x5865f2)
    .setDescription(
      "All commands are owner-only. Set your API key once per session with `set-key`.",
    )
    .addFields([
      {
        name: ".luar set-key <api_key>",
        value: "Save your Luarmor API key for this session.",
      },
      { name: ".luar projects", value: "List all projects on your API key." },
      {
        name: ".luar users <project_id>",
        value: "List all users/keys in a project.",
      },
      {
        name: ".luar get <project_id> <discord|key|hwid> <value>",
        value: "Look up a specific user.",
      },
      {
        name: ".luar add <project_id> [discord=ID] [days=N] [note=text]",
        value: "Create a new key.",
      },
      {
        name: ".luar remove <project_id> <user_key>",
        value: "Delete a key permanently.",
      },
      {
        name: ".luar reset <project_id> <user_key> [force]",
        value: "Reset the HWID for a key.",
      },
      {
        name: ".luar ban <project_id> <user_key> [reason]",
        value: "Blacklist/ban a key.",
      },
      {
        name: ".luar unban <project_id> <unban_token>",
        value: "Unban a key by unban token.",
      },
      {
        name: ".luar link <project_id> <user_key> <discord_id>",
        value: "Link a Discord ID to a key.",
      },
      {
        name: ".luar script <project_id> <script_id>",
        value: "Update script content (attach .lua file).",
      },
      { name: ".luar stats", value: "View API key usage stats." },
    ]);
  return msg.reply({ embeds: [helpEmbed] });
}

// ── .cmds / .help — paginated commands list ────────────────────────────────────

const HELP_PAGES = [
  // Page 1
  [
    { names: "isup, test, uptime", desc: "Checks the bots status." },
    { names: "obf", desc: "Obfuscate a lua script with Prometheus." },
    { names: "ib2", desc: "Deobfuscate IronBrew 2 obfuscated scripts." },
    { names: "prom", desc: "Deobfuscate Prometheus-obfuscated scripts." },
    { names: "luraph", desc: "Dump Luraph / Luarmor loader scripts." },
    {
      names: "l, dump",
      desc: "Env-log a Lua script through httplog2 — captures strings, http calls and table keys at runtime. Accepts file, codeblock, URL, or reply.",
    },
    {
      names: "msec, msecdeobf",
      desc: "Deobfuscate MoonSec v3 scripts (4-stage pipeline — falls back to bytecode extraction if all decompilers fail).",
    },
    {
      names: "decomp",
      desc: "Decompile raw .luac bytecode (Lua 5.1 or Luau).",
    },
  ],
  // Page 2
  [
    {
      names: "get, http, wget",
      desc: "Sends an HTTP GET request to a URL and returns the data.",
    },
    {
      names: "bf, beautify",
      desc: "Beautify / pretty-print Lua source code with proper indentation.",
    },
    {
      names: "wl",
      desc: "Whitelist a user: .wl @user [1hr/2d/inf]. No args = list whitelist. Owner only.",
    },
    {
      names: "bl",
      desc: "Blacklist a user: .bl @user [1hr/2d/inf]. Running .bl on an already-blacklisted user un-blacklists them. Owner only.",
    },
    {
      names: "run",
      desc: "Run Lua/Luau code locally through lune. Accepts codeblock, file, URL, or reply. 15s timeout.",
    },
    {
      names: "luar, luarmor",
      desc: "Luarmor API management — add/remove keys, reset HWID, update scripts. Owner only.",
    },
    {
      names: "min, minify",
      desc: "Minify Lua source code — inlines single-use locals and strips whitespace.",
    },
  ],
];

const TOTAL_PAGES = HELP_PAGES.length;

/**
 * Builds the embed + button row for a given page index (0-based).
 */
function buildHelpPage(page) {
  const fields = HELP_PAGES[page].map(({ names, desc }) => ({
    name: `[ ${names} ]`,
    value: `${desc}`,
    inline: false,
  }));

  const embed = new EmbedBuilder()
    .setTitle("Commands List")
    .setColor(0x2b2d31)
    .addFields(fields)
    .setFooter({ text: `Page ${page + 1} / ${TOTAL_PAGES}` });

  const prev = new ButtonBuilder()
    .setCustomId("help_prev")
    .setLabel("Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);

  const next = new ButtonBuilder()
    .setCustomId("help_next")
    .setLabel("Next")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page === TOTAL_PAGES - 1);

  const row = new ActionRowBuilder().addComponents(prev, next);

  return { embeds: [embed], components: [row] };
}

async function cmdHelp(msg) {
  let page = 0;
  const reply = await msg.reply(buildHelpPage(page));

  // Collect button interactions for 2 minutes, only from the original user
  const collector = reply.createMessageComponentCollector({
    filter: (i) => i.user.id === msg.author.id,
    time: 120_000,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId === "help_prev") page = Math.max(0, page - 1);
    if (interaction.customId === "help_next")
      page = Math.min(TOTAL_PAGES - 1, page + 1);
    await interaction.update(buildHelpPage(page));
  });

  collector.on("end", async () => {
    // Disable both buttons when the collector expires
    const disabledPrev = new ButtonBuilder()
      .setCustomId("help_prev")
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
    const disabledNext = new ButtonBuilder()
      .setCustomId("help_next")
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true);
    const row = new ActionRowBuilder().addComponents(
      disabledPrev,
      disabledNext,
    );
    await reply.edit({ components: [row] }).catch(() => {});
  });
}

// ── discord client ─────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const text = msg.content.trim();

  // ── owner-only management commands (always visible) ──────────────────────
  if (text.startsWith(".wl")) return await cmdWl(msg).catch(() => {});
  if (text.startsWith(".bl")) return await cmdBl(msg).catch(() => {});

  // ── whitelist gate — non-whitelisted users see nothing ───────────────────
  if (!wlCheck(msg.author.id)) return; // silently ignore

  try {
    if (text.startsWith(".obf")) return await cmdObf(msg);
    if (text.startsWith(".ib2")) return await cmdIb2(msg);
    if (text.startsWith(".prom")) return await cmdProm(msg);
    if (text.startsWith(".luraph")) return await cmdLuraph(msg);
    if (text.startsWith(".dump") || /^\.l(\s|$)/.test(text))
      return await cmdDump(msg);
    if (text.startsWith(".msec")) return await cmdMsec(msg);
    if (text.startsWith(".decomp")) return await cmdDecomp(msg);

    if (text.startsWith(".get")) return await cmdGet(msg);
    if (text.startsWith(".bf")) return await cmdBeautify(msg);
    if (text.startsWith(".minify") || text.startsWith(".min"))
      return await cmdMinify(msg);
    if (text.startsWith(".run")) return await cmdRun(msg);
    if (text.startsWith(".luar") || text.startsWith(".luarmor"))
      return await cmdLuar(msg);
    if (text.startsWith(".cmds") || text.startsWith(".help"))
      return await cmdHelp(msg);
  } catch (e) {
    console.error("[unhandled]", e);
    msg.reply(`unexpected error: ${e.message}`).catch(() => {});
  }
});

client.once("clientReady", async () => {
  await wlLoad();
  console.log(`whitelist loaded (${Object.keys(_wlData).length} entries)`);
  console.log(`logged in as ${client.user.tag}`);
  console.log(`owner: ${OWNER_ID}`);
  // appear offline to everyone
  client.user.setPresence({ status: "invisible" });
  console.log(
    `beautifier: ${beautify ? "loaded" : "NOT FOUND — copy lua_beautifier.js to unveilr_modules/"}`,
  );
  console.log(
    `minifier:   ${minify ? "loaded" : "NOT FOUND — copy minify.js to unveilr_modules/"}`,
  );
});

client.login(TOKEN);
