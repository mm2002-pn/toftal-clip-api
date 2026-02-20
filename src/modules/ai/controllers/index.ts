import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../../utils/apiResponse';
import * as aiService from '../services';

export const debugConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    ApiResponse.success(res, {
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      nodeEnv: process.env.NODE_ENV,
    }, 'Debug config');
  } catch (error) {
    next(error);
  }
};

export const optimizeBrief = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { brief } = req.body;
    const result = await aiService.optimizeBrief(brief);
    ApiResponse.success(res, result, 'Brief optimized');
  } catch (error) {
    next(error);
  }
};

export const matchTalents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { brief } = req.body;
    const result = await aiService.matchTalents(brief);
    ApiResponse.success(res, result, 'Talents matched');
  } catch (error) {
    next(error);
  }
};

export const analyzeVideo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { description } = req.body;
    const result = await aiService.analyzeVideo(description);
    ApiResponse.success(res, result, 'Video analyzed');
  } catch (error) {
    next(error);
  }
};

export const transcribeAudio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { audioBase64, mimeType } = req.body;
    const result = await aiService.transcribeAudio(audioBase64, mimeType);
    ApiResponse.success(res, { transcription: result }, 'Audio transcribed');
  } catch (error) {
    next(error);
  }
};

export const generateTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { feedbackText } = req.body;
    const result = await aiService.generateTasks(feedbackText);
    ApiResponse.success(res, result, 'Tasks generated');
  } catch (error) {
    next(error);
  }
};

export const rephraseContent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { text } = req.body;
    const options = await aiService.rephraseContent(text);
    ApiResponse.success(res, { options }, 'Content rephrased');
  } catch (error) {
    next(error);
  }
};
