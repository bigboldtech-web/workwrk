export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="relative w-full max-w-md">
        {/* Background glow */}
        <div className="absolute -top-32 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-purple-600/10 blur-3xl" />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
