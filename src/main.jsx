import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";

import { Buffer } from "buffer";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles/global.css";

if (!window.Buffer) window.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: {} };

const endpoint = import.meta?.env?.VITE_SOLANA_RPC || "https://api.devnet.solana.com";
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new BackpackWalletAdapter()];

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
