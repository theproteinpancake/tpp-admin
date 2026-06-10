export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 h-7 w-44 rounded-lg bg-gray-200" />
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-gray-100" />)}
      </div>
      <div className="h-72 rounded-xl bg-gray-100" />
    </div>
  );
}
