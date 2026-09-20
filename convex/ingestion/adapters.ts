/**
 * Registry of live onchain adapters used by wallet scans. Kept in its own
 * module so tests can replace it with fakes and so adding an adapter (Aave,
 * governance, bridges) is a one-line change here.
 *
 * `ONCHAIN_PROVIDER_URL` is an optional Convex deployment env var pointing
 * at an Ethereum JSON-RPC endpoint; without it the public RPC is used.
 */
import type { OnchainAdapter } from "../../lib/onchain/provider";
import { createEnsAdapter, createViemEnsReader } from "../../lib/onchain/ens";

export function createAdapters(): OnchainAdapter[] {
  const rpcUrl = process.env.ONCHAIN_PROVIDER_URL || undefined;
  return [createEnsAdapter({ reader: createViemEnsReader(rpcUrl) })];
}
