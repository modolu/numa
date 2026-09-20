/**
 * ENS adapter — the first live onchain source (NUMA_ARCHITECTURE.md §35,
 * IMPLEMENTATION_PLAN.md Phase 4).
 *
 * Data source: standard Ethereum JSON-RPC + the official ENS contracts, read
 * through viem. No API key; a public RPC is used unless `rpcUrl` is given.
 *
 * Discovery path (read-only):
 *   1. reverse record  → the wallet's primary ENS name (viem verifies the
 *      forward resolution matches, so a spoofed reverse record is ignored);
 *   2. BaseRegistrar   → `nameExpires(labelhash)` and `ownerOf(labelhash)`
 *      for `.eth` second-level names;
 *   3. NameWrapper     → `ownerOf(namehash)` when the registration is wrapped.
 *
 * Ownership semantics: the *registrant* is the BaseRegistrar NFT owner (or
 * the NameWrapper owner for wrapped names). A wallet whose reverse record
 * points at a name it does not hold is recorded as `primary_name` — the
 * relationship is stored on the payload, never assumed.
 *
 * Limitation: pure RPC cannot enumerate every name an address holds; only
 * the primary name is discoverable. Names that are not `.eth` second-level
 * names (subnames, DNS names) have no BaseRegistrar expiry and are skipped.
 */
import { createPublicClient, http, labelhash, namehash, type Address } from "viem";
import { mainnet } from "viem/chains";
import { getEnsName } from "viem/ens";
import type { EnsExpiryPayload, RawEventInput } from "../events/raw";
import {
  ProviderError,
  toProviderError,
  type DiscoveryResult,
  type OnchainAdapter,
  type SkippedRecord,
  type WalletContext,
} from "./provider";

export const ENS_SOURCE = "ens";
export const ENS_CHAIN_ID = 1;
export const ENS_PROTOCOL_SLUG = "ens";
export const ENS_BASE_REGISTRAR: Address =
  "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85";
export const ENS_NAME_WRAPPER: Address =
  "0xd4416b13d2b3a9abae7acd5d6c2bbdbe25686401";
/** .eth registrations stay renewable for 90 days after expiry. */
export const ENS_GRACE_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;
export const ENS_APP_URL = "https://app.ens.domains";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const BASE_REGISTRAR_ABI = [
  {
    name: "nameExpires",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

const NAME_WRAPPER_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Reader boundary: the only part that talks to the network. Tests supply a
// fake reader; production uses the viem implementation below.
// ---------------------------------------------------------------------------

export type EnsRegistration = {
  /** Expiry in seconds since epoch, as returned by the registrar. */
  expiresAtSeconds: bigint;
  /** BaseRegistrar NFT owner; zero address when unregistered/released. */
  registrant: string;
  /** NameWrapper owner when the registration is wrapped. */
  wrappedOwner?: string;
  blockNumber?: bigint;
};

export interface EnsReader {
  readonly label: string;
  getPrimaryName(address: string): Promise<string | null>;
  getRegistration(label: string, name: string): Promise<EnsRegistration>;
}

export function createViemEnsReader(rpcUrl?: string): EnsReader {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { retryCount: 1, timeout: 15_000 }),
  });
  return {
    label: rpcUrl ? "Ethereum RPC (configured) + ENS contracts" : "Ethereum public RPC + ENS contracts",
    async getPrimaryName(address) {
      return await getEnsName(client, { address: address as Address });
    },
    async getRegistration(label, name) {
      const tokenId = BigInt(labelhash(label));
      const [expiresAtSeconds, registrant, blockNumber] = await Promise.all([
        client.readContract({
          address: ENS_BASE_REGISTRAR,
          abi: BASE_REGISTRAR_ABI,
          functionName: "nameExpires",
          args: [tokenId],
        }),
        client
          .readContract({
            address: ENS_BASE_REGISTRAR,
            abi: BASE_REGISTRAR_ABI,
            functionName: "ownerOf",
            args: [tokenId],
          })
          // ownerOf reverts for expired-and-released tokens.
          .catch(() => ZERO_ADDRESS as Address),
        client.getBlockNumber(),
      ]);
      let wrappedOwner: string | undefined;
      if (registrant.toLowerCase() === ENS_NAME_WRAPPER) {
        wrappedOwner = await client.readContract({
          address: ENS_NAME_WRAPPER,
          abi: NAME_WRAPPER_ABI,
          functionName: "ownerOf",
          args: [BigInt(namehash(name))],
        });
      }
      return { expiresAtSeconds, registrant, wrappedOwner, blockNumber };
    },
  };
}

// ---------------------------------------------------------------------------
// Pure mapping: reader output → raw payload. Fully unit-testable.
// ---------------------------------------------------------------------------

/** `label.eth` second-level names only; returns null otherwise. */
export function ethSecondLevelLabel(name: string): string | null {
  const parts = name.toLowerCase().split(".");
  if (parts.length !== 2 || parts[1] !== "eth" || parts[0].length === 0) {
    return null;
  }
  return parts[0];
}

export function ensSourceEventId(wallet: string, name: string): string {
  return `ens:${ENS_CHAIN_ID}:${wallet.toLowerCase()}:${name.toLowerCase()}`;
}

export function mapEnsRegistrationToPayload(
  wallet: string,
  name: string,
  registration: EnsRegistration,
): EnsExpiryPayload {
  const walletLower = wallet.toLowerCase();
  const label = ethSecondLevelLabel(name);
  if (!label) {
    throw new ProviderError(`Unsupported ENS name: ${name}`, "permanent", ENS_SOURCE);
  }
  if (
    typeof registration.expiresAtSeconds !== "bigint" ||
    registration.expiresAtSeconds <= 0n
  ) {
    throw new ProviderError(
      `No registration expiry returned for ${name}`,
      "malformed",
      ENS_SOURCE,
    );
  }
  if (typeof registration.registrant !== "string" || !registration.registrant.startsWith("0x")) {
    throw new ProviderError(`Malformed registrant for ${name}`, "malformed", ENS_SOURCE);
  }

  const registrant = registration.registrant.toLowerCase();
  const wrappedOwner = registration.wrappedOwner?.toLowerCase();
  let relationship: EnsExpiryPayload["relationship"];
  let holder: string;
  if (registrant === walletLower) {
    relationship = "registrant";
    holder = registrant;
  } else if (registrant === ENS_NAME_WRAPPER && wrappedOwner === walletLower) {
    relationship = "wrapped_owner";
    holder = wrappedOwner;
  } else {
    relationship = "primary_name";
    holder = wrappedOwner ?? registrant;
  }

  const expiresAt = Number(registration.expiresAtSeconds) * 1000;
  if (!Number.isFinite(expiresAt)) {
    throw new ProviderError(`Expiry out of range for ${name}`, "malformed", ENS_SOURCE);
  }

  return {
    kind: "ens_expiry",
    wallet: walletLower,
    protocol: ENS_PROTOCOL_SLUG,
    chainId: ENS_CHAIN_ID,
    name: name.toLowerCase(),
    expiresAt,
    gracePeriodEndsAt: expiresAt + ENS_GRACE_PERIOD_MS,
    relationship,
    registrant: holder === walletLower ? undefined : holder,
    tokenId: BigInt(labelhash(label)).toString(),
    renewUrl: `${ENS_APP_URL}/${name.toLowerCase()}`,
    registrarContract: ENS_BASE_REGISTRAR,
    observedBlock:
      registration.blockNumber !== undefined
        ? Number(registration.blockNumber)
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export type EnsAdapterOptions = {
  reader: EnsReader;
  now?: () => number;
};

export function createEnsAdapter(options: EnsAdapterOptions): OnchainAdapter {
  const { reader } = options;
  const now = options.now ?? (() => Date.now());
  return {
    source: ENS_SOURCE,
    providerLabel: reader.label,
    async discover(wallet: WalletContext): Promise<DiscoveryResult> {
      if (wallet.chainFamily !== "evm") {
        return { rawEvents: [], skipped: [{ subject: wallet.address, reason: "Not an EVM wallet" }] };
      }
      const skipped: SkippedRecord[] = [];
      let name: string | null;
      try {
        name = await reader.getPrimaryName(wallet.address);
      } catch (error) {
        throw toProviderError(error, ENS_SOURCE);
      }
      if (!name) {
        return { rawEvents: [], skipped: [{ subject: wallet.address, reason: "No primary ENS name set" }] };
      }
      const label = ethSecondLevelLabel(name);
      if (!label) {
        skipped.push({ subject: name, reason: "Only .eth second-level names have a registrar expiry" });
        return { rawEvents: [], skipped };
      }
      let registration: EnsRegistration;
      try {
        registration = await reader.getRegistration(label, name);
      } catch (error) {
        throw toProviderError(error, ENS_SOURCE);
      }
      const payload = mapEnsRegistrationToPayload(wallet.address, name, registration);
      const rawEvent: RawEventInput = {
        source: ENS_SOURCE,
        sourceEventId: ensSourceEventId(wallet.address, name),
        observedAt: now(),
        payload,
        isDemo: false,
      };
      return { rawEvents: [rawEvent], skipped };
    },
  };
}
