import { describe, expect, test } from "bun:test";
import { MAX_SKIN_ART_WIDTH, resolveSkin, validateSkin } from "./custom-art.ts";

const line = "     {E}    ";
const good = () => ({
  name: "fox-cat",
  species: "cat",
  art: [0, 1, 2].map(() => ["", line, "", "", ""]),
  face: "({E}v{E})",
});

describe("validateSkin", () => {
  test("accepts a well-formed skin", () => {
    const r = validateSkin(good());
    expect(r.errors).toEqual([]);
    expect(r.skin?.species).toBe("cat");
  });
  test("max width matches built-in art (12)", () => {
    expect(MAX_SKIN_ART_WIDTH).toBe(12);
  });
  test("rejects names that collide with built-in species", () => {
    expect(validateSkin({ ...good(), name: "cat" }).skin).toBeNull();
  });
  test("rejects unknown species", () => {
    expect(validateSkin({ ...good(), species: "fox" }).skin).toBeNull();
  });
  test("rejects ANSI escapes", () => {
    const s = good();
    s.art[1][1] = "\x1b[31m{E}\x1b[0m";
    expect(validateSkin(s).errors.join()).toContain("ANSI");
  });
  test("rejects over-wide lines", () => {
    const s = good();
    s.art[0][0] = "x".repeat(MAX_SKIN_ART_WIDTH + 1);
    expect(validateSkin(s).errors.join()).toContain("exceeds");
  });
  test("rejects wrong frame shape", () => {
    expect(validateSkin({ ...good(), art: [["a"]] }).skin).toBeNull();
  });
});

describe("resolveSkin", () => {
  const skin = validateSkin(good()).skin!;
  const skins = { [skin.name]: skin };
  test("applies only when opted in and species matches", () => {
    expect(resolveSkin(skins, { species: "cat", skin: "fox-cat" })).toBe(skin);
    expect(resolveSkin(skins, { species: "cat" })).toBeNull();
    expect(resolveSkin(skins, { species: "duck", skin: "fox-cat" })).toBeNull();
  });
});
