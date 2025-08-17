import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Header() {
  return (
    <header role="banner" className="header">
      <div className="wallet-btn">
        <WalletMultiButton
          className="wallet-adapter-button"
          aria-label="Connect or Disconnect Wallet"
        />
      </div>
    </header>
  );
}