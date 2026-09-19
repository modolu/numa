import { describe, expect, test } from "vitest";
import {
  isEvmAddress,
  normalizeEvmAddress,
  shortenAddress,
  validateWalletAddress,
} from "../../lib/validation/wallet";

const CHECKSUMMED = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LOWER = CHECKSUMMED.toLowerCase();

describe("wallet validation", () => {
  test("accepts a checksummed address and normalizes casing", () => {
    const result = validateWalletAddress(`  ${CHECKSUMMED}  `);
    expect(result).toEqual({ ok: true, address: LOWER });
  });

  test("accepts an all-uppercase hex body", () => {
    const upper = "0x" + CHECKSUMMED.slice(2).toUpperCase();
    expect(validateWalletAddress(upper)).toEqual({ ok: true, address: LOWER });
  });

  test("rejects empty input with guidance", () => {
    expect(validateWalletAddress("   ")).toMatchObject({ ok: false });
  });

  test("rejects a missing 0x prefix", () => {
    const result = validateWalletAddress(CHECKSUMMED.slice(2));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/0x/);
  });

  test("rejects wrong length", () => {
    expect(validateWalletAddress("0x1234").ok).toBe(false);
    expect(validateWalletAddress(CHECKSUMMED + "a").ok).toBe(false);
  });

  test("rejects non-hex characters", () => {
    const bad = "0x" + "g".repeat(40);
    const result = validateWalletAddress(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/hexadecimal/);
  });

  test("rejects ENS names — only raw addresses are monitored for now", () => {
    expect(validateWalletAddress("vitalik.eth").ok).toBe(false);
  });

  test("isEvmAddress / normalizeEvmAddress agree with validateWalletAddress", () => {
    expect(isEvmAddress(CHECKSUMMED)).toBe(true);
    expect(isEvmAddress("0x123")).toBe(false);
    expect(normalizeEvmAddress(CHECKSUMMED)).toBe(LOWER);
    expect(() => normalizeEvmAddress("nope")).toThrow();
  });

  test("shortenAddress keeps the prefix and suffix", () => {
    expect(shortenAddress(LOWER)).toBe("0xd8da…6045");
    expect(shortenAddress("0x1234", 4)).toBe("0x1234");
  });
});
