/**
 * EVM wallet address validation and normalization.
 *
 * Numa stores addresses lowercased so equality checks and the `by_address`
 * index behave consistently regardless of how the user pasted the address
 * (EIP-55 checksum casing is a display concern, not a storage concern).
 */

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export type WalletValidation =
  | { ok: true; address: string }
  | { ok: false; reason: string };

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS_PATTERN.test(value);
}

/** Lowercase a syntactically valid address. Throws on invalid input. */
export function normalizeEvmAddress(value: string): string {
  const trimmed = value.trim();
  if (!isEvmAddress(trimmed)) {
    throw new Error("Invalid EVM address");
  }
  return trimmed.toLowerCase();
}

/** Validate user input and return the normalized address or a human reason. */
export function validateWalletAddress(input: string): WalletValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Paste a wallet address to get started." };
  }
  if (!trimmed.startsWith("0x")) {
    return { ok: false, reason: "EVM addresses start with 0x." };
  }
  if (trimmed.length !== 42) {
    return {
      ok: false,
      reason: "An EVM address is 42 characters long (0x + 40 hex characters).",
    };
  }
  if (!isEvmAddress(trimmed)) {
    return {
      ok: false,
      reason: "That address contains characters that are not hexadecimal.",
    };
  }
  return { ok: true, address: trimmed.toLowerCase() };
}

/** `0x1234…abcd` style shortening for UI. */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}
