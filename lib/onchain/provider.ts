export type WalletContext = {
  address: `0x${string}`;
  chainFamily: "evm";
};

export type RawEvent = {
  source: string;
  sourceEventId: string;
  observedAt: number;
  payload: unknown;
};

export interface OnchainAdapter {
  discover(wallet: WalletContext): Promise<RawEvent[]>;
}
