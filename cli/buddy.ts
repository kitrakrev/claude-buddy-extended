#!/usr/bin/env bun
/**
 * coding-buddy — LLM-free command dispatcher.
 *
 * Typed `/buddy` commands are pure state/config operations, so the skill runs
 * them here as plain bun instead of a model round-trip. This file only maps
 * argv onto the shared command handlers in `server/commands/` and prints the
 * result; every state write, event, XP award, achievement check and
 * fresh-install hatch happens inside the same `.execute` the MCP server calls.
 *
 * Proactive, conversation-aware calls (buddy_react on a name mention,
 * buddy_suggest, the end-of-turn comment) stay on the model and are not
 * exposed here.
 *
 * Usage:
 *   bun run cli/buddy.ts <command> [args]
 *   bun run buddy <command> [args]
 */

import { buddyCommands } from "../server/commands/index.ts";

type CommandName = keyof typeof buddyCommands;

export interface Dispatch {
  tool: CommandName;
  args: Record<string, unknown>;
}

export class UsageError extends Error {}

function toInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new UsageError(`${label} must be an integer, got "${value}"`);
  return n;
}

function onOff(value: string, label: string): boolean {
  const v = value.toLowerCase();
  if (v === "on" || v === "true") return true;
  if (v === "off" || v === "false") return false;
  throw new UsageError(`${label} expects on|off, got "${value}"`);
}

/** Drop undefined keys so zod sees the same shape an MCP client would send. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Translate CLI argv (without the bun/script prefix) into a shared command
 * call. Argument validation itself is left to the command's zod schema.
 */
export function parseCommand(argv: string[]): Dispatch {
  const [rawCmd, ...rest] = argv;
  const cmd = (rawCmd ?? "show").toLowerCase();
  const first = rest[0];
  const text = rest.join(" ").trim();

  switch (cmd) {
    case "show":
      return { tool: "buddy_show", args: {} };
    case "pet":
      return { tool: "buddy_pet", args: {} };
    case "stats":
      return { tool: "buddy_stats", args: {} };
    case "help":
      return { tool: "buddy_help", args: {} };
    case "off":
    case "mute":
      return { tool: "buddy_mute", args: {} };
    case "on":
    case "unmute":
      return { tool: "buddy_unmute", args: {} };
    case "rename":
      if (!text) throw new UsageError("usage: rename <name>");
      return { tool: "buddy_rename", args: { name: text } };
    case "personality":
      if (!text) throw new UsageError("usage: personality <text>");
      return { tool: "buddy_set_personality", args: { personality: text } };
    case "achievements":
      return { tool: "buddy_achievements", args: {} };
    case "xp":
      return { tool: "buddy_xp", args: {} };
    case "upgrades":
      return { tool: "buddy_upgrades", args: compact({ apply: first }) };
    case "mood":
      return { tool: "buddy_mood", args: {} };
    case "memory":
      return { tool: "buddy_memory", args: parseMemoryFlags(rest) };
    case "summon":
      return { tool: "buddy_summon", args: compact({ slot: first }) };
    case "save":
      return { tool: "buddy_save", args: compact({ slot: first }) };
    case "list":
      return { tool: "buddy_list", args: {} };
    case "dismiss":
      if (!first) throw new UsageError("usage: dismiss <slot>");
      return { tool: "buddy_dismiss", args: { slot: first } };
    case "pick":
      return {
        tool: "buddy_pick",
        args: compact({ species: rest[0], rarity: rest[1], name: rest[2] }),
      };
    case "frequency":
      return { tool: "buddy_frequency", args: compact({ cooldown: toInt(first, "frequency") }) };
    case "style":
      return { tool: "buddy_style", args: compact({ style: first }) };
    case "position":
      return { tool: "buddy_style", args: compact({ position: first }) };
    case "rarity":
      return {
        tool: "buddy_style",
        args: compact({ showRarity: first === undefined ? undefined : onOff(first, "rarity") }),
      };
    case "width":
      return { tool: "buddy_style", args: compact({ width: toInt(first, "width") }) };
    case "margin":
      return { tool: "buddy_style", args: compact({ margin: toInt(first, "margin") }) };
    case "rainbow":
      // No args shows current settings. `reset` sends [] exactly like the
      // skill's MCP routing did, so both paths share the same validation.
      if (first === undefined) return { tool: "buddy_style", args: {} };
      if (first.toLowerCase() === "reset") return { tool: "buddy_style", args: { rainbow: [] } };
      return { tool: "buddy_style", args: { rainbow: rest } };
    case "theme":
      return { tool: "buddy_theme", args: compact({ theme: first }) };
    case "statusline":
      return { tool: "buddy_statusline", args: parseStatusline(first) };
    default:
      throw new UsageError(`Unknown command: ${cmd}\nRun "bun run cli/buddy.ts help" for the list.`);
  }
}

function parseStatusline(arg: string | undefined): Record<string, unknown> {
  if (arg === undefined) return {};
  switch (arg.toLowerCase()) {
    case "on":
      return { enabled: true };
    case "off":
      return { enabled: false };
    case "combined":
      return { combined: true };
    case "basic":
      return { combined: false };
    default:
      throw new UsageError(`statusline expects on|off|combined|basic, got "${arg}"`);
  }
}

function parseMemoryFlags(args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = () => {
      const v = args[++i];
      if (v === undefined) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--project":
        out.project = next();
        break;
      case "--type":
        out.type = next();
        break;
      case "--resolved":
        out.resolved = true;
        break;
      case "--unresolved":
        out.resolved = false;
        break;
      case "--resolve-bug":
        out.resolveBug = next();
        break;
      default:
        throw new UsageError(`Unknown memory flag: ${flag}`);
    }
  }
  return out;
}

/** Run one dispatch through the shared handler and return its text output. */
export async function run(dispatch: Dispatch): Promise<{ text: string; isError: boolean }> {
  const command = buddyCommands[dispatch.tool] as {
    execute: (input: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    }>;
  };
  const result = await command.execute(dispatch.args);
  const text = result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  return { text, isError: result.isError === true };
}

if (import.meta.main) {
  try {
    const { text, isError } = await run(parseCommand(process.argv.slice(2)));
    if (text) console.log(text);
    process.exit(isError ? 1 : 0);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
    } else if (err && typeof err === "object" && "issues" in err) {
      // zod validation failure — same schema the MCP transport enforces.
      const issues = (err as { issues: Array<{ path: unknown[]; message: string }> }).issues;
      console.error(issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("\n"));
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}
