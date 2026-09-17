export interface IgAttachment {
  type: string;
  payload: {
    url?: string;
    title?: string;
    reel_video_id?: string;
  };
}

export interface IgMessage {
  mid: string;
  text?: string;
  attachments?: IgAttachment[];
  is_echo?: boolean;
  is_deleted?: boolean;
}

export interface IgMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: IgMessage;
}

export interface IgWebhookEntry {
  id: string;
  time: number;
  messaging?: IgMessagingEvent[];
}

export interface IgWebhookBody {
  object: string;
  entry: IgWebhookEntry[];
}

export interface ReelAnalysis {
  hook: string;
  keyQuote: string;
  itemsIdentified: string[];
  breakdown: string;
  verdict: "true" | "false" | "mixed" | "unverifiable";
  verdictReasoning: string;
  takeaway: string;
}
