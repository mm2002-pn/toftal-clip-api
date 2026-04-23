import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';
import { invalidateTemplateCache } from '../../../services/templateResolver';

/**
 * GET /api/v1/admin/email-templates/:id/preview?sample=<jsonified>
 *
 * Renders the template with provided sample variables. Used by the admin
 * UI to show a live preview as the template is edited.
 */
export const previewEmailTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { subject: rawSubject, htmlBody: rawHtml, sample } = req.body as {
      subject?: string;
      htmlBody?: string;
      sample?: Record<string, unknown>;
    };

    // If subject+htmlBody are provided in the body, preview uses those
    // (unsaved changes). Otherwise fetch the stored template.
    let subject = rawSubject;
    let htmlBody = rawHtml;

    if (!subject || !htmlBody) {
      const template = await prisma.emailTemplate.findUnique({ where: { id } });
      if (!template) {
        ApiResponse.notFound(res, 'Email template not found');
        return;
      }
      subject = subject ?? template.subject;
      htmlBody = htmlBody ?? template.htmlBody;
    }

    const vars = sample && typeof sample === 'object' ? sample : {};
    const rendered = {
      subject: interpolate(subject, vars),
      htmlBody: interpolate(htmlBody, vars),
    };

    ApiResponse.success(res, rendered);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/email-templates/:id
 * Body: { subject?, htmlBody?, textBody?, description?, variables? }
 */
export const updateEmailTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { subject, htmlBody, textBody, description, variables } = req.body as {
      subject?: string;
      htmlBody?: string;
      textBody?: string;
      description?: string;
      variables?: unknown;
    };

    const existing = await prisma.emailTemplate.findUnique({ where: { id } });
    if (!existing) {
      ApiResponse.notFound(res, 'Email template not found');
      return;
    }

    const data: any = {};
    if (typeof subject === 'string') data.subject = subject;
    if (typeof htmlBody === 'string') data.htmlBody = htmlBody;
    if (typeof textBody === 'string') data.textBody = textBody;
    if (typeof description === 'string') data.description = description;
    if (Array.isArray(variables) && variables.every((v) => typeof v === 'string')) {
      data.variables = variables;
    }

    if (Object.keys(data).length === 0) {
      ApiResponse.badRequest(res, 'Nothing to update');
      return;
    }

    const template = await prisma.emailTemplate.update({ where: { id }, data });
    invalidateTemplateCache('email');

    auditLogFromRequest(req, 'EMAIL_TEMPLATE_UPDATE', {
      targetType: 'email_template' as any,
      targetId: id,
      metadata: { name: existing.name, changedFields: Object.keys(data) },
    });

    ApiResponse.success(res, template, 'Template updated');
  } catch (error) {
    next(error);
  }
};

/**
 * Simple {{variable}} interpolation. Supports nested paths like {{user.name}}.
 */
const interpolate = (template: string, vars: Record<string, unknown>): string => {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split('.');
    let value: any = vars;
    for (const p of parts) {
      if (value == null || typeof value !== 'object') return `{{${path}}}`;
      value = value[p];
    }
    return value == null ? `{{${path}}}` : String(value);
  });
};
