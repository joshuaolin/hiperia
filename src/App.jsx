import React from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";

import MatrixBackground from "./components/MatrixBackground";
import ParticleCanvas from "./components/ParticleCanvas";
import Header from "./components/Header";
import Ticker from "./components/Ticker";
import Footer from "./components/Footer";
import "./index.css";
import "@solana/wallet-adapter-react-ui/styles.css";

// Wallets config
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

function App() {
  const { connected } = useWallet();

  return (
    <div className="app">
      {/* Background effects */}
      <MatrixBackground />
      <ParticleCanvas />

      {/* Foreground UI */}
      <Header />
      <main>
        {!connected && (
          <div className="header-container">
            <div className="header-content">
              <div className="ticker">
                <span
                  className="ticker-text"
                  style={{
                    fontSize: "5rem",
                    "@media (max-width: 640px)": {
                      fontSize: "3rem",
                    },
                  }}
                >
                  HIPERIA
                </span>
              </div>
              <p className="header-description">
                A decentralized micro-gaming ecosystem designed to be self-sustaining for
                retailers, featuring transparent, blockchain-verified draw.
              </p>
              <div className="wallet-btn">
                <WalletMultiButton
                  className="start-game-button wallet-adapter-button"
                  aria-label="Connect Wallet to Start Game"
                >
                  START GAME
                </WalletMultiButton>
              </div>
            </div>
          </div>
        )}
        {/* 
          CRITICAL: Replace with a valid Mainnet RPC from QuickNode, Alchemy, or Helius.
          Example: https://your-custom-rpc.quicknode.com or https://solana-mainnet.g.alchemy.com/v2/your-api-key
          Sign up at https://www.quicknode.com/, https://www.alchemy.com/, or https://www.helius.dev/
        */}
        <ConnectionProvider endpoint="https://your-custom-rpc.quicknode.com">
          <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>
              {connected && <Ticker />}
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </main>
      <Footer />
    </div>
  );
}

export default App;