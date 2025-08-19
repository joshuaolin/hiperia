import React, { useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import MatrixBackground from "./components/MatrixBackground";
import ParticleCanvas from "./components/ParticleCanvas";
import Header from "./components/Header";
import GameCarousel from "./components/GameCarousel";
import Dodos from "./games/dodos/Dodos";
import Footer from "./components/Footer";
import "./styles/global.css";
import "./styles/header.css";

function LandingPage() {
  return (
    <div className="header-container">
      <div className="header-content">
        <div className="ticker">
          <span className="ticker-text hiperia-ticker-text">HIPERIA</span>
        </div>
        <p className="header-description">
          A decentralized micro-gaming ecosystem designed to be
          self-sustaining for retailers, featuring transparent and
          open-source verified draw.
        </p>
        <div className="wallet-btn">
          <WalletMultiButton
            className="start-game-button wallet-adapter-button matrix-button"
            aria-label="Connect Wallet to Start Game"
          >
            START GAME
          </WalletMultiButton>
        </div>
      </div>
    </div>
  );
}

function ContentWrapper() {
  const { connected } = useWallet();
  const [currentView, setCurrentView] = useState(null);

  const handleEnterGame = (gameName) => {
    setCurrentView(gameName);
  };

  const handleBack = () => {
    setCurrentView(null);
  };

  return (
    <>
      {!connected ? (
        <LandingPage />
      ) : currentView === "Dodos" ? (
        <Dodos onBack={handleBack} />
      ) : (
        <GameCarousel onEnterGame={handleEnterGame} />
      )}
    </>
  );
}

export default function App() {
  const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

  return (
    <div className="app">
      <MatrixBackground />
      <ParticleCanvas />
      <ConnectionProvider endpoint="https://your-custom-rpc.quicknode.com">
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <Header />
            <main>
              <ContentWrapper />
            </main>
            <Footer />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </div>
  );
}