import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import {
  ConnectionProvider,
  ConnectionContext,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

import { Buffer } from "buffer";
import { UatConnection } from "./lib/uatConnection.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles/global.css";

if (!window.Buffer) window.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: {} };

const endpoint =
  import.meta.env.VITE_SOLANA_RPC || "https://api.devnet.solana.com";
const useDevnetProxy =
  ["uat", "testnet-demo"].includes(import.meta.env.VITE_APP_ENV) &&
  endpoint === "https://api.devnet.solana.com" &&
  window.location.protocol === "https:";
const proxyConnection = useDevnetProxy ? new UatConnection(endpoint) : null;
const ConnectionBoundary = useDevnetProxy
  ? ({ children }) => (
      <ConnectionContext.Provider value={{ connection: proxyConnection }}>
        {children}
      </ConnectionContext.Provider>
    )
  : ({ children }) => (
      <ConnectionProvider endpoint={endpoint}>{children}</ConnectionProvider>
    );

const wallets = [
  new PhantomWalletAdapter({ network: "devnet" }),
  new SolflareWalletAdapter({ network: "devnet" }),
];

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ConnectionBoundary>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionBoundary>
  </StrictMode>,
);
