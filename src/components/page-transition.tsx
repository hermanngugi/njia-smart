import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [entering, setEntering] = useState(false);
  const initialPath = useRef(pathname);

  const cleanupTimer = useRef<number | null>(null);

  useEffect(() => {
    if (pathname === initialPath.current) return;
    initialPath.current = pathname;
    setEntering(true);
    const frame = requestAnimationFrame(() => {
      const timer = window.setTimeout(() => setEntering(false), 220);
      // The timeout is cleared by the cleanup below when another route wins.
      cleanupTimer.current = timer;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (cleanupTimer.current !== null) window.clearTimeout(cleanupTimer.current);
    };
  }, [pathname]);

  return <div className={entering ? "page-enter-motion" : ""}>{children}</div>;
}
