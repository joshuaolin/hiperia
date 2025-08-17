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
import WalletBalance from "./components/WalletBalance";
import "./index.css";
import "@solana/wallet-adapter-react-ui/styles.css";

// Wallets config
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

const Header = () => (
  <header role="banner" className="header">
    <h2>Provably Fair Fun.</h2>
  </header>
);

const WalletConnect = () => (
  <div className="wallet-btn flex flex-col items-center gap-2">
    <WalletMultiButton className="bg-green-500 hover:bg-green-400 text-black px-5 py-2 rounded-xl text-lg font-semibold shadow-lg" />
    <WalletBalance />
  </div>
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
    Powered by: HiperiaFoundation, and{" "}
    <a href="https://switchboard.xyz" target="_blank" rel="noopener noreferrer">
      Switchboard VRF
    </a>
  </footer>
);

function App() {
  return (
    <div className="app relative w-full h-screen overflow-hidden bg-black text-green-400">
      {/* Background effects */}
      <MatrixBackground />
      <ParticleCanvas />

      {/* Foreground UI */}
      <Header />

      {/* Use a custom RPC endpoint or Devnet for testing */}
      <ConnectionProvider endpoint="https://api.devnet.solana.com">
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <WalletConnect />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>

      <Ticker />
      <Footer />
    </div>
  );
}

export default App;