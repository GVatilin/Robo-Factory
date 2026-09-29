import { useState } from "react";
import { Avatar } from "./Controls";
import "./CompanyLogo.css";

export function CompanyLogo({ name, url, size = 52 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || url === failed) return <Avatar name={name} size={size} />;
  return <span className="company-logo" style={{ width: Math.round(size * 1.45), height: size }}>
    <img src={url} alt={`Логотип ${name}`} loading="lazy" decoding="async" onError={() => setFailed(url)} />
  </span>;
}
