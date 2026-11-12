import { useSearchParams } from "react-router-dom";
export function useAssetPath() {
  const [params] = useSearchParams();
  return (path: string) => {
    const [base, query] = path.split("?");
    const next = new URLSearchParams(query);
    if (params.get("mode")) next.set("mode", params.get("mode")!);
    return `${base}${next.size ? `?${next}` : ""}`;
  };
}
