export interface NlmNotebook {
  id: string;
  nlm_notebook_id: string;
  title: string;
  description: string | null;
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NlmSource {
  id: string;
  nlm_source_id: string;
  title: string;
  source_type: "file" | "url" | "text";
  created_at: string;
}

export interface ChatMessage {
  id: string;
  notebook_id: string;
  user_email: string;
  conversation_id: string | null;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  created_at: string;
}

export interface Citation {
  source_id: string;
  citation_number: number;
  cited_text: string;
}

export interface ChatResponse {
  answer: string;
  conversation_id: string;
  turn_number: number;
  references: Citation[];
}
