// The board is force-dynamic (live data, no cache), so the browser otherwise sits on a blank
// screen for the whole server render — worst on a cold serverless start. This skeleton paints
// instantly and matches the real layout, so the page feels immediate instead of stuck.
export default function LoadingBoard() {
  const columns = ['To Do', 'In Progress', 'Backlogged', 'Done'];
  return (
    <div className="flex h-full flex-col animate-pulse">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="h-5 w-16 rounded bg-line" />
        <div className="flex gap-2">
          <div className="h-9 w-44 rounded-lg bg-line" />
          <div className="h-9 w-24 rounded-lg bg-line" />
        </div>
      </div>

      <div className="flex gap-2 px-4 pb-3 sm:px-6">
        {[64, 56, 72, 60, 88].map((w, i) => (
          <div key={i} className="h-8 rounded-lg bg-line" style={{ width: w }} />
        ))}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 px-4 pb-6 sm:px-6 lg:grid-cols-4">
        {columns.map((label) => (
          <div key={label} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-line-strong" />
              <div className="h-4 w-24 rounded bg-line" />
            </div>
            <div className="h-24 rounded-xl bg-surface card-shadow" />
            <div className="h-24 rounded-xl border border-dashed border-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
