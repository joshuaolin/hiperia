import { useEffect, useRef } from "react";

export default function useLinkedDisclosure(hash) {
  const disclosure = useRef(null);

  useEffect(() => {
    const open = () => {
      if (window.location.hash !== hash || !disclosure.current) return;
      disclosure.current.open = true;
      disclosure.current.scrollIntoView({ block: "start" });
    };
    const followLink = (event) => {
      const link = event.target.closest?.("a[href]");
      if (link?.getAttribute("href") === hash) {
        if (disclosure.current) disclosure.current.open = true;
      }
    };
    open();
    window.addEventListener("hashchange", open);
    document.addEventListener("click", followLink);
    return () => {
      window.removeEventListener("hashchange", open);
      document.removeEventListener("click", followLink);
    };
  }, [hash]);

  return disclosure;
}
