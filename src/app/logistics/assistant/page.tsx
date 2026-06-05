import Chat from '@/components/assistant/Chat';

export const dynamic = 'force-dynamic';

export default function AssistantPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Chat />
    </div>
  );
}
