import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cx } from "./ui";

type Kind = "ok" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-20 z-[2000] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-card border px-4 py-3 text-sm font-medium shadow-pop animate-rise",
              t.kind === "error" && "border-danger/30 bg-surface text-ink",
              t.kind === "ok" && "border-line bg-surface text-ink",
              t.kind === "info" && "border-line bg-surface text-ink",
            )}
          >
            <Icon
              name={t.kind === "error" ? "alert" : t.kind === "ok" ? "check" : "info"}
              size={17}
              className={cx(
                "mt-px",
                t.kind === "error" ? "text-danger" : t.kind === "ok" ? "text-ok" : "text-accent",
              )}
            />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
