import { LogoutButton } from "@/app/components/logout-button";
import { NewProjectForm } from "@/app/components/new-project-form";

export const dynamic = "force-dynamic";

export default function NewProjectPage() {
  return (
    <main className="page-shell space-y-6">
      <header className="panel flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Instructional Design Designer AI</h1>
          <p className="mt-1 text-sm text-slate-600">
            Genera diseños instruccionales reutilizables para producción y LMS.
          </p>
        </div>
        <LogoutButton />
      </header>

      <NewProjectForm />
    </main>
  );
}
