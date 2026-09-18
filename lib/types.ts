export interface IgAttachment {
  type: string;
  payload: {
    url?: string;
    title?: string;
    reel_video_id?: string;
    ig_post_media_id?: string;
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

export interface ToolMention {
  name: string;
  description: string;
  whereToFind: string;
}

export interface ReelAnalysis {
  summary: string;
  tools: ToolMention[];
  verdict: "real" | "fake" | "uncertain";
  confidence: number;
  source: string;
}
