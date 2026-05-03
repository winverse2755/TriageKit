import { type Chain, defineChain } from "viem";

export const baseSepolia: Chain = defineChain({
  id: 84532,
  name: "Base Sepolia",
  network: "base-sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://virtual.base-sepolia.eu.rpc.tenderly.co/eda241e6-2aa8-4abe-9db9-784bd0ceb88d"] },
    public: { http: ["https://virtual.base-sepolia.eu.rpc.tenderly.co/eda241e6-2aa8-4abe-9db9-784bd0ceb88d"] },
  },
  blockExplorers: {
    default: { name: "BaseTest", url: "https://dashboard.tenderly.co/explorer/vnet/d64dbd1d-9664-445b-b168-b90bdf7af8db/transactions" },
  },
  testnet: true,
});

export const arcTestnet: Chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const unichainSepolia: Chain = defineChain({
  id: 9991301,
  name: "Unichain Sepolia",
  network: "unichain-sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://virtual.astrochain-sepolia.eu.rpc.tenderly.co/988a84e2-3652-4013-aa50-a563ec925736"] },
    public: { http: ["https://virtual.astrochain-sepolia.eu.rpc.tenderly.co/988a84e2-3652-4013-aa50-a563ec925736"] },
  },
  blockExplorers: {
    default: { name: "UniSepoliaTest", url: "https://dashboard.tenderly.co/explorer/vnet/cf254021-0a4e-427f-b35e-907c08cfc532/transactions" },
  },
  testnet: true,
});

export const CHAINS = {
  baseSepolia,
  arcTestnet,
  unichainSepolia,
} as const;

export type ChainKey = keyof typeof CHAINS;
