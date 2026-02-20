import { config } from './index';
import { logger } from '../utils/logger';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

interface GroqResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface TranscriptionResponse {
  text: string;
}

// Chat completion with Groq
export const chatCompletion = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<string> => {
  const {
    model = config.groq.models.powerful,
    temperature = 0.7,
    maxTokens = 2048,
    jsonMode = false,
  } = options;

  try {
    const response = await fetch(`${config.groq.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.groq.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Groq API error:', error);
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json() as GroqResponse;
    return data.choices[0]?.message?.content || '';
  } catch (error) {
    logger.error('Groq chat completion error:', error);
    throw error;
  }
};

// JSON response helper
export const chatCompletionJSON = async <T>(
  messages: ChatMessage[],
  options: Omit<ChatCompletionOptions, 'jsonMode'> = {}
): Promise<T> => {
  const content = await chatCompletion(messages, { ...options, jsonMode: true });
  try {
    return JSON.parse(content) as T;
  } catch {
    logger.error('Failed to parse JSON response:', content);
    throw new Error('Invalid JSON response from AI');
  }
};

// Transcribe audio with Whisper
export const transcribeAudio = async (
  audioBuffer: Buffer,
  mimeType: string = 'audio/webm'
): Promise<string> => {
  try {
    const formData = new FormData();
    const uint8Array = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8Array], { type: mimeType });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', config.groq.models.whisper);
    formData.append('language', 'fr');

    const response = await fetch(`${config.groq.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.groq.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Groq transcription error:', error);
      throw new Error(`Groq transcription error: ${response.status}`);
    }

    const data = await response.json() as TranscriptionResponse;
    return data.text || '';
  } catch (error) {
    logger.error('Groq transcription error:', error);
    throw error;
  }
};

export default {
  chatCompletion,
  chatCompletionJSON,
  transcribeAudio,
};
