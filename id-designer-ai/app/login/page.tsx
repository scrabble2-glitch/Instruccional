import { Suspense } from "react";
import { LoginForm } from "@/app/components/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <Suspense fallback={<div className="mt-16 text-center text-sm text-slate-600">Cargando...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
