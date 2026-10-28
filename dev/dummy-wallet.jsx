import { createRoot } from "react-dom/client";
import {
  ConnectionProvider,
  WalletContext,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import App from "/src/App.jsx";
import "@solana/wallet-adapter-react-ui/styles.css";
import "/src/styles/global.css";
if (!import.meta.env.DEV)
  throw Error("The dummy wallet is only available during development.");
window.Buffer = Buffer;
const publicKey = new PublicKey(new Uint8Array(32).fill(1));
const sign = async () => {
  throw Error("Dummy wallet does not sign");
};
const adapter = {
  name: "Dummy test wallet",
  icon: "",
  publicKey,
  connected: true,
  readyState: "Installed",
};
const wallet = {
  publicKey,
  connected: true,
  connecting: false,
  disconnecting: false,
  autoConnect: false,
  wallet: { adapter, readyState: "Installed" },
  wallets: [],
  select: () => {},
  connect: async () => {},
  disconnect: async () => {},
  signTransaction: undefined,
  signAllTransactions: undefined,
  sendTransaction: sign,
};
createRoot(document.getElementById("root")).render(
  <>
    <p style={{ textAlign: "center" }}>
      DEVELOPMENT TEST WALLET — read-only; transactions are disabled.{" "}
      <a href="/">Use a real wallet</a>
    </p>
    <ConnectionProvider endpoint="https://api.devnet.solana.com">
      <WalletContext.Provider value={wallet}>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletContext.Provider>
    </ConnectionProvider>
  </>,
);
