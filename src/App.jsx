import React from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";

import MatrixBackground from "./components/MatrixBackground";
import ParticleCanvas from "./components/ParticleCanvas";
import "./index.css";
import "@solana/wallet-adapter-react-ui/styles.css";

// Wallets config
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

const Header = () => (
  <header role="banner" className="header">
    <h1>Provably Fair Fun</h1>
    <div className="wallet-btn">
      <WalletMultiButton
        className="wallet-adapter-button"
        aria-label="Connect or Disconnect Wallet"
      />
    </div>
  </header>
);

const Ticker = () => (
  <main role="main" className="main">
    <div className="ticker" aria-live="polite">
      <span className="ticker-text">COMING SOON... (12.12.25)</span>
    </div>
  </main>
);

const Footer = () => (
  <footer role="contentinfo" className="footer">
    <p>
      Powered by: HiperiaFoundation, and{" "}
      <a href="https://switchboard.xyz" target="_blank" rel="noopener noreferrer">
        Switchboard VRF
      </a>
    </p>
  </footer>
);

function App() {
  return (
    <div className="app">
      {/* Background effects */}
      <MatrixBackground />
      <ParticleCanvas />

      {/* Foreground UI */}
      <Header />

      {/* 
        CRITICAL: Replace with a valid Mainnet RPC from QuickNode, Alchemy, or Helius.
        Example: https://your-custom-rpc.quicknode.com or https://solana-mainnet.g.alchemy.com/v2/your-api-key
        Sign up at https://www.quicknode.com/, https://www.alchemy.com/, or https://www.helius.dev/
      */}
      <ConnectionProvider endpoint="https://your-custom-rpc.quicknode.com">
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            {/* Wallet button is now in Header */}
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>

      <Ticker />
      <Footer />
    </div>
  );
}

export default App;