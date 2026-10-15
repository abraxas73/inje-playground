import ChatWorkspace from "@/components/chat/ChatWorkspace";
export default async function ChatConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatWorkspace key={id} conversationId={id} />;
}
