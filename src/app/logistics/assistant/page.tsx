import Chat from '@/components/assistant/Chat';

export const dynamic = 'force-dynamic';

export default function AssistantPage() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 pb-3 pt-4 sm:px-6 sm:pb-5">
      <Chat />
    </div>
  );
}
