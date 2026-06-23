import { describe, expect, it } from "vitest";
import { isAllowedAdmin } from "../../src/lib/admin-allowlist";

const cfg = { domain: "creativegrowth.org", allowlist: "marc.cull@gmail.com" };

describe("isAllowedAdmin — domain match", () => {
  it("allows an email on the configured domain", () => {
    expect(isAllowedAdmin("quinn@creativegrowth.org", cfg)).toBe(true);
  });

  it("is case-insensitive on both email and domain", () => {
    expect(isAllowedAdmin("Quinn@CreativeGrowth.ORG", cfg)).toBe(true);
    expect(isAllowedAdmin("a@creativegrowth.org", { domain: "CreativeGrowth.org", allowlist: "" })).toBe(true);
  });

  it("rejects a look-alike domain (suffix/substring spoof)", () => {
    expect(isAllowedAdmin("evil@notcreativegrowth.org", cfg)).toBe(false);
    expect(isAllowedAdmin("evil@creativegrowth.org.attacker.com", cfg)).toBe(false);
  });

  it("rejects a subdomain of the allowed domain", () => {
    expect(isAllowedAdmin("a@mail.creativegrowth.org", cfg)).toBe(false);
  });
});

describe("isAllowedAdmin — explicit allowlist", () => {
  it("allows an exact allowlisted address off-domain", () => {
    expect(isAllowedAdmin("marc.cull@gmail.com", cfg)).toBe(true);
  });

  it("is case-insensitive and tolerant of spaces in the allowlist", () => {
    expect(isAllowedAdmin("MARC.CULL@gmail.com", cfg)).toBe(true);
    expect(isAllowedAdmin("b@x.com", { domain: "", allowlist: " a@x.com , b@x.com " })).toBe(true);
  });

  it("rejects an address neither on-domain nor allowlisted", () => {
    expect(isAllowedAdmin("stranger@gmail.com", cfg)).toBe(false);
  });
});

describe("isAllowedAdmin — invalid / empty input", () => {
  it("rejects null, undefined, empty, and malformed", () => {
    expect(isAllowedAdmin(null, cfg)).toBe(false);
    expect(isAllowedAdmin(undefined, cfg)).toBe(false);
    expect(isAllowedAdmin("", cfg)).toBe(false);
    expect(isAllowedAdmin("no-at-sign", cfg)).toBe(false);
  });

  it("rejects everything when neither domain nor allowlist is configured", () => {
    expect(isAllowedAdmin("anyone@creativegrowth.org", { domain: "", allowlist: "" })).toBe(false);
  });
});
