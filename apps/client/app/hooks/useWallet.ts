'use client';

import { useState, useEffect, useCallback } from 'react';
import { Address } from 'viem';

interface WalletState {
    address: Address | null;
    isConnected: boolean;
    chainId: number | null;
    balance: string;
    chainName: string;
    provider: string | null;
}

declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: any[] }) => Promise<any>;
            on: (event: string, handler: (...args: any[]) => void) => void;
            removeListener: (event: string, handler: (...args: any[]) => void) => void;
            isMetaMask?: boolean;
            isCoinbaseWallet?: boolean;
            isBraveWallet?: boolean;
            selectedAddress?: string;
            chainId?: string;
        } | undefined;
    }
}

const CHAIN_NAMES: Record<string, string> = {
    '0x1': 'Ethereum Mainnet',
    '0x5': 'Goerli Testnet',
    '0xaa36a7': 'Sepolia Testnet',
    '0x89': 'Polygon Mainnet',
    '0x13881': 'Polygon Mumbai',
    '0xa4b1': 'Arbitrum One',
    '0x66eee': 'Arbitrum Sepolia',
    '0xa': 'Optimism',
    '0xaa37dc': 'Optimism Sepolia',
    '0x2105': 'Base',
    '0x14a34': 'Base Sepolia',
    '0x38': 'BNB Chain',
    '0x61': 'BNB Testnet',
    '0xa4ec': 'Celo Mainnet',
    '0x515': 'Unichain Sepolia',
};

export interface SupportedChain {
    chainIdHex: string;
    chainId: number;
    name: string;
}

export const SUPPORTED_CHAINS: SupportedChain[] = [
    { chainIdHex: '0x1', chainId: 1, name: 'Ethereum Mainnet' },
    { chainIdHex: '0xaa36a7', chainId: 11155111, name: 'Sepolia Testnet' },
    { chainIdHex: '0x89', chainId: 137, name: 'Polygon Mainnet' },
    { chainIdHex: '0xa4b1', chainId: 42161, name: 'Arbitrum One' },
    { chainIdHex: '0xa', chainId: 10, name: 'Optimism' },
    { chainIdHex: '0x2105', chainId: 8453, name: 'Base' },
    { chainIdHex: '0x14a34', chainId: 84532, name: 'Base Sepolia' },
    { chainIdHex: '0x38', chainId: 56, name: 'BNB Chain' },
    { chainIdHex: '0xa4ec', chainId: 42220, name: 'Celo Mainnet' },
    { chainIdHex: '0x515', chainId: 9991301, name: 'Unichain Sepolia' },
];

const CHAIN_RPC_URLS: Record<string, string> = {
    '0x1': 'https://eth.llamarpc.com',
    '0xaa36a7': 'https://rpc.sepolia.org',
    '0x89': 'https://polygon-rpc.com',
    '0xa4b1': 'https://arb1.arbitrum.io/rpc',
    '0xa': 'https://mainnet.optimism.io',
    '0x2105': 'https://mainnet.base.org',
    '0x14a34': 'https://sepolia.base.org',
    '0x38': 'https://bsc-dataseed.binance.org',
    '0xa4ec': 'https://forno.celo.org',
    '0x515': 'https://sepolia.unichain.org',
};

export const useWallet = () => {
    const [wallet, setWallet] = useState<WalletState>({
        address: null,
        isConnected: false,
        chainId: null,
        balance: '0',
        chainName: 'Not Connected',
        provider: null,
    });

    const detectProvider = () => {
        if (typeof window === 'undefined' || !window.ethereum) {
            return null;
        }
        return window.ethereum;
    };

    const updateBalance = useCallback(async (address: Address) => {
        try {
            const ethereum = detectProvider();
            if (!ethereum) return '0.0000';

            const balanceHex = await ethereum.request({
                method: 'eth_getBalance',
                params: [address, 'latest'],
            });

            const balanceWei = BigInt(balanceHex);
            const balanceEth = Number(balanceWei) / 1e18;

            return balanceEth.toFixed(4);
        } catch (error) {
            console.error('Error getting balance:', error);
            return '0.0000';
        }
    }, []);

    const updateChainInfo = useCallback(async () => {
        try {
            const ethereum = detectProvider();
            if (!ethereum) return { chainId: null, chainName: 'Unknown' };

            const chainIdHex = await ethereum.request({ method: 'eth_chainId' });
            const chainId = parseInt(chainIdHex, 16);
            const chainName = CHAIN_NAMES[chainIdHex] || `Chain ${chainId}`;

            return { chainId, chainName };
        } catch (error) {
            console.error('Error getting chain info:', error);
            return { chainId: null, chainName: 'Unknown' };
        }
    }, []);

    const detectProviderName = useCallback(() => {
        const ethereum = detectProvider();
        if (!ethereum) return null;

        if (ethereum.isMetaMask) return 'MetaMask';
        if (ethereum.isCoinbaseWallet) return 'Coinbase Wallet';
        if (ethereum.isBraveWallet) return 'Brave Wallet';
        return 'Other Wallet';
    }, []);

    const handleAccountsChanged = useCallback(async (accounts: string[]) => {
        if (accounts.length === 0) {
            setWallet({
                address: null,
                isConnected: false,
                chainId: null,
                balance: '0',
                chainName: 'Not Connected',
                provider: null,
            });
        } else {
            const address = accounts[0] as Address;
            const balance = await updateBalance(address);
            const { chainId, chainName } = await updateChainInfo();
            const provider = detectProviderName();

            setWallet(prev => ({
                ...prev,
                address,
                balance,
                chainId,
                chainName,
                isConnected: true,
                provider,
            }));
        }
    }, [updateBalance, updateChainInfo, detectProviderName]);

    const handleChainChanged = useCallback(async (chainIdHex: string) => {
        const chainId = parseInt(chainIdHex, 16);
        const chainName = CHAIN_NAMES[chainIdHex] || `Chain ${chainId}`;

        if (wallet.address) {
            const balance = await updateBalance(wallet.address);
            setWallet(prev => ({
                ...prev,
                chainId,
                chainName,
                balance,
            }));
        } else {
            setWallet(prev => ({
                ...prev,
                chainId,
                chainName,
            }));
        }
    }, [wallet.address, updateBalance]);

    const connectWallet = async () => {
        const ethereum = detectProvider();

        if (!ethereum) {
            console.error('No Web3 provider detected. Please install MetaMask or another wallet extension.');
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

            if (isMobile) {
                alert('Please install MetaMask or Coinbase Wallet app from your app store');
            } else {
                alert('Please install MetaMask extension from https://metamask.io');
            }
            return;
        }

        try {
            const accounts = await ethereum.request({
                method: 'eth_requestAccounts',
            });

            if (accounts.length === 0) {
                throw new Error('No accounts authorized');
            }

            const address = accounts[0] as Address;
            const balance = await updateBalance(address);
            const { chainId, chainName } = await updateChainInfo();
            const provider = detectProviderName();

            setWallet({
                address,
                isConnected: true,
                chainId,
                balance,
                chainName,
                provider,
            });

            ethereum.on('accountsChanged', handleAccountsChanged);
            ethereum.on('chainChanged', handleChainChanged);

        } catch (error: any) {
            console.error('Error connecting wallet:', error);

            if (error.code === 4001) {
                alert('Connection rejected by user');
            } else if (error.code === -32002) {
                alert('Please check your wallet for pending connection request');
            } else {
                alert(`Connection failed: ${error.message}`);
            }
        }
    };

    const disconnectWallet = () => {
        const ethereum = detectProvider();

        if (ethereum) {
            ethereum.removeListener('accountsChanged', handleAccountsChanged);
            ethereum.removeListener('chainChanged', handleChainChanged);
        }

        setWallet({
            address: null,
            isConnected: false,
            chainId: null,
            balance: '0',
            chainName: 'Not Connected',
            provider: null,
        });
    };

    const switchChain = async (chainIdHex: string) => {
        const ethereum = detectProvider();
        if (!ethereum) return;

        try {
            await ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: chainIdHex }],
            });
        } catch (error: any) {
            if (error.code === 4902) {
                const chain = SUPPORTED_CHAINS.find((c) => c.chainIdHex === chainIdHex);
                const rpcUrl = CHAIN_RPC_URLS[chainIdHex];
                if (chain && rpcUrl) {
                    try {
                        await ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: chainIdHex,
                                chainName: chain.name,
                                rpcUrls: [rpcUrl],
                            }],
                        });
                    } catch (addError: any) {
                        console.error('Failed to add chain:', addError);
                        alert(`Failed to add ${chain.name}: ${addError.message}`);
                    }
                } else {
                    alert(`Please add ${chain?.name ?? 'this network'} manually in your wallet.`);
                }
            } else {
                console.error('Failed to switch chain:', error);
                alert(`Failed to switch network: ${error.message}`);
            }
        }
    };

    useEffect(() => {
        const checkConnection = async () => {
            const ethereum = detectProvider();

            if (!ethereum) return;

            try {
                const accounts = await ethereum.request({
                    method: 'eth_accounts',
                });

                if (accounts.length > 0) {
                    const address = accounts[0] as Address;
                    const balance = await updateBalance(address);
                    const { chainId, chainName } = await updateChainInfo();
                    const provider = detectProviderName();

                    setWallet({
                        address,
                        isConnected: true,
                        chainId,
                        balance,
                        chainName,
                        provider,
                    });

                    ethereum.on('accountsChanged', handleAccountsChanged);
                    ethereum.on('chainChanged', handleChainChanged);
                }
            } catch (error) {
                console.error('Error checking connection:', error);
            }
        };

        checkConnection();

        return () => {
            const ethereum = detectProvider();
            if (ethereum) {
                ethereum.removeListener('accountsChanged', handleAccountsChanged);
                ethereum.removeListener('chainChanged', handleChainChanged);
            }
        };
    }, [handleAccountsChanged, handleChainChanged, updateBalance, updateChainInfo, detectProviderName]);

    return {
        ...wallet,
        connectWallet,
        disconnectWallet,
        switchChain,
        supportedChains: SUPPORTED_CHAINS,
        isMetaMaskAvailable: typeof window !== 'undefined' && !!window.ethereum?.isMetaMask,
        isCoinbaseWalletAvailable: typeof window !== 'undefined' && !!window.ethereum?.isCoinbaseWallet,
        isWalletAvailable: typeof window !== 'undefined' && !!window.ethereum,
    };
};
