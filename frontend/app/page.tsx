export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <section className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-zinc-900">Clean.</h1>
        <p className="mt-3 text-lg text-zinc-600">Know what you eat.</p>
      </section>

      <section className="mt-12">
        <div className="flex h-12 w-full items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
          Search coming soon
        </div>
      </section>

      <section className="mt-10">
        <div className="grid h-32 w-full place-items-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-500">
          Categories coming soon
        </div>
      </section>
    </div>
  );
}
