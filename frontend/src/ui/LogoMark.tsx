export function LogoMark({ className = "brand__mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 28 9.5v13L16 29 4 22.5v-13Z" fill="#dbe8fb" />
      <path d="M16 3 28 9.5 16 16 4 9.5Z" fill="#9fc0ee" />
      <path d="M16 16v13L4 22.5v-13Z" fill="#5d8fdb" />
      <path d="M16 16v13l12-6.5v-13Z" fill="#2463d8" />
    </svg>
  );
}
