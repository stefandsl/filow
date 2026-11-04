import { useEffect, useRef } from "react";
import { useT } from "@filow/ui";

export function ImportError({ error }: { error: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  return <div ref={ref} className="chip err banner" role="alert">{t("import.failed", { error })}</div>;
}
