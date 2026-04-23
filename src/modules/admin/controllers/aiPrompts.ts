import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';
import { invalidateTemplateCache } from '../../../services/templateResolver';

/**
 * PATCH /api/v1/admin/ai-prompts/:id
 */
export const updateAIPrompt = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const {
      systemPrompt,
      userPromptTemplate,
      model,
      temperature,
      maxTokens,
      responseFormat,
      description,
      variables,
    } = req.body as {
      systemPrompt?: string | null;
      userPromptTemplate?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number | null;
      responseFormat?: string | null;
      description?: string;
      variables?: unknown;
    };

    const existing = await prisma.aIPromptTemplate.findUnique({ where: { id } });
    if (!existing) {
      ApiResponse.notFound(res, 'AI prompt template not found');
      return;
    }

    const data: any = {};
    if (typeof systemPrompt === 'string' || systemPrompt === null) data.systemPrompt = systemPrompt;
    if (typeof userPromptTemplate === 'string') data.userPromptTemplate = userPromptTemplate;
    if (typeof model === 'string') data.model = model;
    if (typeof temperature === 'number' && temperature >= 0 && temperature <= 2) {
      data.temperature = temperature;
    }
    if (typeof maxTokens === 'number' || maxTokens === null) data.maxTokens = maxTokens;
    if (typeof responseFormat === 'string' || responseFormat === null) {
      data.responseFormat = responseFormat;
    }
    if (typeof description === 'string') data.description = description;
    if (Array.isArray(variables) && variables.every((v) => typeof v === 'string')) {
      data.variables = variables;
    }

    if (Object.keys(data).length === 0) {
      ApiResponse.badRequest(res, 'Nothing to update');
      return;
    }

    const template = await prisma.aIPromptTemplate.update({ where: { id }, data });
    invalidateTemplateCache('ai');

    auditLogFromRequest(req, 'AI_PROMPT_UPDATE', {
      targetType: 'ai_prompt' as any,
      targetId: id,
      metadata: { name: existing.name, changedFields: Object.keys(data) },
    });

    ApiResponse.success(res, template, 'Prompt updated');
  } catch (error) {
    next(error);
  }
};
