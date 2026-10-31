import { useEffect, useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import "../styles/back-to-top.css";

export default function BackToTop() {
  const { visible: walletModalVisible } = useWalletModal();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const editing = document.activeElement?.matches(
          'input, select, textarea, [contenteditable="true"]',
        );
        setVisible(window.scrollY > 600 && !editing);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  function returnToTop() {
    if (window.location.hash !== "#dodos") {
      window.history.replaceState(window.history.state, "", "#dodos");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    document.getElementById("dodos-heading")?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  if (!visible || walletModalVisible) return null;

  return (
    <button
      type="button"
      className="back-to-top"
      aria-label="Back to top"
      onClick={returnToTop}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="m5 9 5-5 5 5M10 4v12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Back to top</span>
    </button>
  );
}
