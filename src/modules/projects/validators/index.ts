import { body } from 'express-validator';

const PROJECT_STATUSES = ['DRAFT', 'PENDING', 'MATCHING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'ARCHIVED'] as const;
const PROJECT_TYPES = ['PERSONAL', 'CLIENT'] as const;

// Petite tolérance pour les deadlines légèrement dans le passé
// (décalage timezone, formulaire rempli après minuit, etc.)
const PAST_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000;

const parseISODate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Vérifie que la deadline n'est pas dans un passé lointain et,
// si startDate est aussi fournie dans la requête, que deadline >= startDate.
const deadlineLogicCheck = (value: unknown, { req }: { req: any }) => {
  const deadline = parseISODate(value);
  if (!deadline) throw new Error("La deadline doit etre une date valide (ISO 8601)");

  const now = Date.now();
  if (deadline.getTime() < now - PAST_TOLERANCE_MS) {
    throw new Error("La deadline ne peut pas etre anterieure a plus de 7 jours");
  }

  const startRaw = req.body?.startDate;
  if (startRaw !== undefined && startRaw !== null && startRaw !== '') {
    const startDate = parseISODate(startRaw);
    if (startDate && deadline < startDate) {
      throw new Error("La deadline doit etre postee au plus tot le jour de debut");
    }
  }
  return true;
};

// startDate ne peut pas etre posterieure a la deadline presente dans la requete.
const startDateLogicCheck = (value: unknown, { req }: { req: any }) => {
  const startDate = parseISODate(value);
  if (!startDate) throw new Error("La date de debut doit etre une date valide (ISO 8601)");

  const deadlineRaw = req.body?.deadline;
  if (deadlineRaw !== undefined && deadlineRaw !== null && deadlineRaw !== '') {
    const deadline = parseISODate(deadlineRaw);
    if (deadline && startDate > deadline) {
      throw new Error("La date de debut doit etre anterieure ou egale a la deadline");
    }
  }
  return true;
};

export const createProjectValidation = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage("Le titre doit contenir entre 3 et 200 caracteres"),

  body('type')
    .optional()
    .isIn(PROJECT_TYPES as unknown as string[])
    .withMessage(`Le type doit etre l'un de: ${PROJECT_TYPES.join(', ')}`),

  body('status')
    .optional()
    .isIn(PROJECT_STATUSES as unknown as string[])
    .withMessage(`Le statut doit etre l'un de: ${PROJECT_STATUSES.join(', ')}`),

  body('startDate')
    .optional({ nullable: true, checkFalsy: true })
    .custom(startDateLogicCheck),

  body('deadline')
    .optional({ nullable: true, checkFalsy: true })
    .custom(deadlineLogicCheck),

  body('talentId')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true;
      if (typeof value !== 'string') throw new Error("L'identifiant talent doit etre un UUID valide");
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(value)) throw new Error("L'identifiant talent doit etre un UUID valide");
      return true;
    }),

  body('collaboratorIds')
    .optional()
    .isArray()
    .withMessage("collaboratorIds doit etre un tableau"),
  body('collaboratorIds.*')
    .isUUID()
    .withMessage("Chaque identifiant collaborateur doit etre un UUID valide"),

  body('deliverables')
    .optional()
    .isArray()
    .withMessage("deliverables doit etre un tableau"),
  body('deliverables.*.title')
    .if(body('deliverables').exists())
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Le titre de chaque livrable doit contenir entre 1 et 200 caracteres"),
  body('deliverables.*.type')
    .if(body('deliverables').exists())
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage("Le type de chaque livrable est requis (1-100 caracteres)"),
  body('deliverables.*.assignedTalentId')
    .optional({ nullable: true })
    .isUUID()
    .withMessage("L'identifiant talent d'un livrable doit etre un UUID valide"),

  body('brief').optional().isObject().withMessage("Le brief doit etre un objet"),
  body('brief.contentType').optional().isString(),
  body('brief.objective').optional().isString(),
  body('brief.targetAudience').optional().isString(),
  body('brief.tone').optional().isString(),
  body('brief.budget').optional().isString(),
];

export const updateProjectValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage("Le titre doit contenir entre 3 et 200 caracteres"),

  body('startDate')
    .optional({ nullable: true, checkFalsy: true })
    .custom(startDateLogicCheck),

  body('deadline')
    .optional({ nullable: true, checkFalsy: true })
    .custom(deadlineLogicCheck),

  body('talentId')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (typeof value !== 'string' || !uuidRegex.test(value)) {
        throw new Error("L'identifiant talent doit etre un UUID valide");
      }
      return true;
    }),

  body('brief')
    .optional()
    .isObject()
    .withMessage("Le brief doit etre un objet"),
];

export const updateStatusValidation = [
  body('status')
    .isIn(PROJECT_STATUSES as unknown as string[])
    .withMessage(`Statut invalide. Valeurs acceptees: ${PROJECT_STATUSES.join(', ')}`),
];
