import { explorerAccountUrl } from "../lib/explorer.js";

export default function HistoryLink({
  address,
  network,
  href,
  className = "",
  children,
  ...props
}) {
  const destination = href ?? explorerAccountUrl(address, network);
  return destination ? (
    <a
      className={`history-link ${className}`.trim()}
      href={destination}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M11 4h5v5M16 4l-8 8M8 4H4v12h12v-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  ) : null;
}
