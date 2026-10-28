import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { getNetworkStatus } from "../lib/network.js";

export default function useNetworkStatus() {
  const { connection } = useConnection();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let active = true;

    getNetworkStatus(connection).then(
      (network) => {
        if (active) setStatus({ connection, network, error: null });
      },
      (error) => {
        if (active) setStatus({ connection, network: null, error });
      },
    );

    return () => {
      active = false;
    };
  }, [connection]);

  if (status?.connection !== connection) {
    return { network: null, isLoading: true, error: null };
  }

  return { network: status.network, isLoading: false, error: status.error };
}
