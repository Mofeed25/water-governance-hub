import { useEffect } from "react";

export function PwaBootstrap() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    }
  }, []);
  return null;
}
