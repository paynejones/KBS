
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <AppShell>
      <div className="space-y-8">
        <section>
          <p className="text-sm text-muted-foreground">
            YOUR WORKSPACE
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Your knowledge base
          </h1>
          <p className="mt-3 text-muted-foreground">
            A place for your notes, projects, and ideas.
          </p>
        </section>

        <section id="pages" className="space-y-3">
          <h2 className="text-lg font-medium">Pages</h2>
          <div className="rounded-lg border p-6">
            <p className="font-medium">No pages yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your notes will appear here once page creation is implemented.
            </p>
          </div>
        </section>

        <section id="databases" className="space-y-3">
          <h2 className="text-lg font-medium">Databases</h2>
          <div className="rounded-lg border p-6">
            <p className="font-medium">No databases yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Custom collections will be added in a later phase.
            </p>
          </div>
        </section>

        <section id="favorites" className="space-y-3">
          <h2 className="text-lg font-medium">Favorites</h2>
          <p className="text-sm text-muted-foreground">
            Your favorite pages will appear here.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
