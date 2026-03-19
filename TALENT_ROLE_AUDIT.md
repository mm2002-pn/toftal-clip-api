# 🎯 AUDIT EXHAUSTIF: RÔLE TALENT DANS TOFTAL-CLIP

**Date:** 18 Mars 2026
**Status:** Complet et approuvé
**Révision:** 1.0

---

## **📊 STATISTIQUES**
- **Total fichiers mentionnant TALENT:** 57 fichiers
- **Backend:** 27 fichiers
- **Frontend:** 30 fichiers
- **Occurrences totales:** 150+ mentions

---

## **TABLE DES MATIÈRES**
1. [Backend - Schema & Types](#-backend---implémentation-complète)
2. [Backend - Authentication](#-backend---implémentation-complète)
3. [Backend - GraphQL & Resolvers](#-backend---implémentation-complète)
4. [Backend - Project Management](#-backend---implémentation-complète)
5. [Backend - Deliverable Workflow](#-backend---implémentation-complète)
6. [Backend - Permissions](#-backend---implémentation-complète)
7. [Backend - Talent Profiles](#-backend---implémentation-complète)
8. [Backend - Opportunities](#-backend---implémentation-complète)
9. [Frontend - Types & Interfaces](#-frontend---implémentation-complète)
10. [Frontend - Pages & Components](#-frontend---implémentation-complète)
11. [Frontend - Services](#-frontend---implémentation-complète)
12. [Complete Workflow](#-workflow-complet-assignment--acceptance--production)

---

## **🔧 BACKEND - IMPLÉMENTATION COMPLÈTE**

### **1️⃣ SCHEMA DATABASE & TYPES**

**Enum UserRole (prisma/schema.prisma)**
```
TALENT, CLIENT, ADMIN
```

**Project Model**
```typescript
talentId String? @map("talent_id")              // Project main talent
talent User? @relation("TalentProjects")        // Foreign key to user
```

**Deliverable Model**
```typescript
assignedTalentId String? @map("assigned_talent_id")  // Granular assignment
assignedTalent User? @relation(fields: [...])        // Link to talent user
acceptanceStatus AcceptanceStatus               // PENDING, ACCEPTED, REJECTED
```

**TalentProfile Model (305-339 lignes)**
```typescript
userId String @unique
bio String?
tagline String?
location String?
languages String[]
skills String[]
expertise String?
videoType String?
responseTime String?
rating Decimal?
reviewsCount Int @default(0)
startingPrice String?
coverImage String?
socialLinks Json?
portfolio PortfolioItem[]
reviews Review[]
packages TalentPackage[]
```

**WorkflowPhase Model**
```typescript
assignedTo String @default("CLIENT")  // Peut être "TALENT" aussi
```

---

### **2️⃣ AUTHENTICATION & REGISTRATION**

**Fichier:** `src/modules/auth/services/index.ts`

| Ligne | Logique | Action |
|-------|---------|--------|
| 14 | `role?: 'CLIENT' \| 'TALENT'` | Type pour registration |
| 66-71 | Parameter extraction | Default to CLIENT |
| 117-123 | `if (role === 'TALENT')` | **Crée TalentProfile automatiquement** |
| 483-485 | Google Auth interface | Accept role parameter |
| 532 | Google Signup | Assigne le rôle au nouvel utilisateur |

**Auto-création TalentProfile:**
```typescript
if (role === 'TALENT') {
  await prisma.talentProfile.create({
    data: { userId: user.id }
  });
}
```

**Validation:**
```typescript
body('role').isIn(['CLIENT', 'TALENT']).withMessage('...')
```

---

### **3️⃣ GRAPHQL SCHEMA & RESOLVERS**

**Schema Definitions:**

```graphql
enum UserRole {
  CLIENT
  TALENT
  ADMIN
}

type Project {
  talentId: ID
  talent: User
}

type Deliverable {
  assignedTalent: User
  acceptanceStatus: AcceptanceStatus
}
```

**Resolver: Project Query (src/graphql/resolvers/project.ts)**

**Line 105 - myProjects filtering:**
```typescript
if (context.user.role === 'CLIENT' || context.user.role === 'TALENT') {
  where.OR = [
    { clientId: context.user.id },
    { talentId: context.user.id },
    { deliverables: { some: { assignedTalentId: context.user.id } } },  // ⭐ Granular
  ];
}
```

**Line 200 - Deliverables field resolver:**
```typescript
if (user.role === 'TALENT') {
  return prisma.deliverable.findMany({
    where: {
      projectId: parent.id,
      OR: [
        { assignedTalentId: user.id },                    // Directly assigned
        ...(parent.talentId === user.id ? [{ assignedTalentId: null }] : [])  // Or project talent
      ]
    }
  });
}
```

**Impact:** TALENT voit UNIQUEMENT ses livrables assignés

---

### **4️⃣ PROJECT MANAGEMENT**

**Fichier:** `src/modules/projects/controllers/index.ts`

**Auto-assignation TALENT (Lines 34-36)**
```typescript
const isTalentCreator = userRole === 'TALENT';
const finalStatus = isTalentCreator ? 'PRODUCTION' : 'PREPARATION';
// ⚠️ TALENT créateur = auto PRODUCTION
// CLIENT créateur = auto PREPARATION
```

**Notification lors assignation (Lines 86-107)**
```typescript
if (talentId) {
  // 1. Crée notification DB
  const notification = await prisma.notification.create({
    data: {
      userId: talentId,
      type: 'PROJECT_ASSIGNED',
      title: 'Nouveau projet assigné',
      message: `Vous avez été assigné au projet "${title}"`,
      link: `/workspace/${project.id}`
    }
  });

  // 2. Envoie Socket.IO
  socketService.emitToUser(talentId, 'notification:new', notification);
  socketService.emitToUser(talentId, 'project:new', {...});
}
```

**Workflow Phases (Line 495)**
```typescript
assignedTo: phaseTemplate.assignedTo || 'TALENT'  // Default à TALENT
```

---

### **5️⃣ DELIVERABLE ASSIGNMENT WORKFLOW**

**Fichier:** `src/modules/deliverables/controllers/index.ts`

**ASSIGN TALENT (Lines 76-230)**
```typescript
export const assignTalent = async (req, res, next) => {
  const deliverable = await prisma.deliverable.update({
    where: { id },
    data: {
      assignedTalentId: talentId,
      acceptanceStatus: 'PENDING'  // ⭐ Awaiting TALENT acceptance
    }
  });

  // NOTIFICATIONS
  const notification = await prisma.notification.create({
    data: {
      userId: talentId,
      type: 'TALENT_ASSIGNED',
      title: 'Nouvelle vidéo assignée',
      message: `Vous avez été assigné à la vidéo "${deliverable.title}" du projet "${project.title}"`
    }
  });

  socketService.emitToUser(talentId, 'notification:new', notification);

  // EMAIL
  await sendEmail(
    assignedTalent.email,
    emailTemplates.talentAssigned(
      assignedTalent.name,
      deliverable.title,
      project.title,
      workspaceUrl
    )
  );
};
```

**ACCEPT ASSIGNMENT (Lines 449-538)**
```typescript
export const acceptAssignment = async (req, res, next) => {
  // ⭐ Verify TALENT owns this deliverable
  if (deliverable.assignedTalentId !== req.user!.id) {
    throw new Error('You are not assigned to this deliverable');
  }

  const updated = await prisma.deliverable.update({
    where: { id },
    data: {
      acceptanceStatus: 'ACCEPTED',
      status: 'PRODUCTION',  // ⭐ Auto move to PRODUCTION
      progress: 50
    }
  });

  // Notify CLIENT
  socketService.emitToProject(
    deliverable.projectId,
    'deliverable:assignment:accepted',
    { deliverableId, talentId, talentName, acceptedAt }
  );

  // Email CLIENT
  await sendEmail(client.email, emailTemplates.assignmentAccepted(...));
};
```

**REJECT ASSIGNMENT (Lines 540-620)**
```typescript
export const rejectAssignment = async (req, res, next) => {
  // ⭐ Verify TALENT owns this deliverable
  if (deliverable.assignedTalentId !== req.user!.id) {
    throw new Error('You are not assigned to this deliverable');
  }

  const updated = await prisma.deliverable.update({
    where: { id },
    data: {
      acceptanceStatus: 'REJECTED',
      assignedTalentId: null  // ⭐ Remove assignment
    }
  });

  // Notify CLIENT with reason
  socketService.emitToProject(
    deliverable.projectId,
    'deliverable:assignment:rejected',
    { deliverableId, talentId, reason, rejectedAt }
  );

  await sendEmail(client.email, emailTemplates.assignmentRejected(...));
};
```

---

### **6️⃣ PERMISSION MANAGEMENT**

**Fichier:** `src/services/InvitationService.ts` (Lines 274-310)

```typescript
const isTalent = user.role === 'TALENT';

if (isTalent) {
  permissions = {
    view: true,
    edit: true,
    comment: true,
    approve: true  // ⭐ TALENT peut approuver les changements
  };
  memberRole = 'COLLABORATOR';
}
```

**Fichier:** `src/services/AccessRequestService.ts` (Lines 125-128)

```typescript
const isTalent = request.user.role === 'TALENT';
const permissions = isTalent
  ? { view: true, edit: true, comment: true, approve: true }  // Full access
  : { view: true, edit: true, comment: true, approve: false }; // Limited
```

---

### **7️⃣ TALENT PROFILE SYSTEM**

**Fichier:** `src/modules/talents/controllers/index.ts`

**Create Profile:**
```typescript
export const createProfile = async (req, res) => {
  const profile = await prisma.talentProfile.create({
    data: {
      userId: req.user!.id,
      bio, location, languages, skills, videoType, startingPrice
    }
  });
};
```

**Update Profile (with auth check):**
```typescript
export const updateProfile = async (req, res) => {
  if (talentProfile.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
    throw new ForbiddenError('Cannot update this profile');
  }
  // Update fields
};
```

**Add Review:**
```typescript
const review = await prisma.review.create({
  data: { talentId: id, authorId: req.user!.id, rating, text }
});

// Update average rating
const reviews = await prisma.review.findMany({ where: { talentId: id } });
const avgRating = reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;

await prisma.talentProfile.update({
  where: { id },
  data: { rating: avgRating, reviewsCount: reviews.length }
});
```

---

### **8️⃣ OPPORTUNITY SYSTEM**

**Fichier:** `src/modules/opportunities/controllers/index.ts`

```typescript
export const applyToOpportunity = async (req, res) => {
  // Check if already applied
  const existingApplication = await prisma.application.findFirst({
    where: { opportunityId: id, talentId: req.user!.id }
  });

  if (existingApplication) {
    return ApiResponse.badRequest(res, 'Already applied');
  }

  const application = await prisma.application.create({
    data: {
      opportunityId: id,
      talentId: req.user!.id,  // ⭐ Link TALENT
      message
    }
  });
};
```

---

### **9️⃣ SOCKET.IO EVENTS**

**Fichier:** `src/services/socketService.ts`

```typescript
export type SocketEvent =
  | 'notification:new'                        // New notification for TALENT
  | 'project:new'                             // New project assigned
  | 'deliverable:assigned'                    // New deliverable assignment
  | 'deliverable:assignment:accepted'         // TALENT accepted
  | 'deliverable:assignment:rejected'         // TALENT rejected
  | 'version:uploaded'                        // Version for review
  | 'feedback:new'                            // New feedback from CLIENT
  | ...
```

---

## **🎨 FRONTEND - IMPLÉMENTATION COMPLÈTE**

### **1️⃣ TYPE DEFINITIONS**

**Fichier:** `types.ts`

```typescript
export enum UserRole {
  CLIENT = 'CLIENT',
  TALENT = 'TALENT',
  ADMIN = 'ADMIN'
}

export interface Deliverable {
  id: string;
  title: string;
  assignedTalent?: MatchedTalent;          // ⭐ Talent assigné
  acceptanceStatus?: AcceptanceStatus;     // PENDING, ACCEPTED, REJECTED
  status: DeliverableStatus;
  versions: ProjectVersion[];
  workflow: WorkflowPhase[];
}

export interface Talent {
  id: string;
  name: string;
  verified: boolean;
  responseTime: string;
  skills: string[];
  rating: number;
  reviews: number;
  startingPrice: string;
  avatar: string;
  videoType: string;
  bio: string;
  location: string;
  languages: string[];
  completedProjects: number;
  portfolio: PortfolioItem[];
  clientReviews: Review[];
  packages: TalentPackage[];
}
```

---

### **2️⃣ REGISTRATION PAGE**

**Fichier:** `pages/RegisterPage.tsx`

**Selection de rôle:**
```typescript
const [formData, setFormData] = useState<RegisterData>({
  role: UserRole.CLIENT  // Default
});

const selectRole = (role: UserRole) => {
  setFormData(prev => ({ ...prev, role }));
};

// Google auth with role
const handleGoogleRegister = async (role: UserRole) => {
  // Call backend with role parameter
};
```

---

### **3️⃣ PROJECT CREATION & AUTO-ASSIGNMENT**

**Fichier:** `pages/ProjectClone.tsx`

**Auto-assignation TALENT (Lines 488)**
```typescript
const isTalent = user?.role === 'TALENT';

// Create project
talentId: isTalent ? user?.id : undefined,  // Auto-assign TALENT

// Create deliverables with auto-assignment
assignedTalentId: isTalent ? user?.id : undefined
```

**UI TALENT-specific (Lines 840-845)**
```typescript
{user?.role === 'TALENT' && (
  <div className="animate-fade-in-down">
    <button onClick={() => setProjectType('client')}>
      Create client project
    </button>
  </div>
)}
```

---

### **4️⃣ DELIVERABLE CONTEXT**

**Fichier:** `context/ProjectContext.tsx`

**Auto-assignment talent (Lines 250-269)**
```typescript
let assignedTalentId: string | undefined = deliverable.assignedTalentId;

if (!assignedTalentId && projectTalent?.id) {
  assignedTalentId = projectTalent.id;
} else if (!assignedTalentId && user?.role === 'TALENT') {
  assignedTalentId = user.id;  // ⭐ Self-assign if TALENT
}

// Create talent object
const talentForDeliverable = projectTalent ||
  (user?.role === 'TALENT' ? {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl || null
  } : undefined);
```

---

### **5️⃣ DELIVERABLE LIST PAGE**

**Fichier:** `pages/DeliverableListPage.tsx`

**Visibility checks (Lines 84, 2409-2411)**
```typescript
// Can see/interact as content creator
const isClient = user?.role === UserRole.CLIENT ||
                 user?.role === UserRole.TALENT;

// Show pending acceptance buttons
const isPendingAcceptance = user?.role === UserRole.TALENT &&
  (del.acceptanceStatus === 'PENDING' ||
   del.acceptanceStatus === 'REJECTED') &&
  del.assignedTalent?.id === user?.id;

// Render buttons
{user?.role === UserRole.TALENT &&
  del.acceptanceStatus === 'PENDING' && (
    <>
      <button onClick={() => acceptAssignment(del.id)}>
        Accept
      </button>
      <button onClick={() => rejectAssignment(del.id)}>
        Reject
      </button>
    </>
  )
}
```

---

### **6️⃣ DELIVERABLE DETAIL PAGE**

**Fichier:** `pages/DeliverableDetailPage.tsx`

**Permission check (Lines 393-397)**
```typescript
const isAssignedTalent = user && (
  user.role === UserRole.ADMIN ||
  (user.role === UserRole.TALENT && (
    project?.talent?.id === user.id ||
    deliverable?.assignedTalent?.id === user.id
  ))
);

const canUploadVersion = isAssignedTalent &&
  deliverable?.status !== 'VALIDE';
```

---

### **7️⃣ WORKSPACE**

**Fichier:** `pages/Workspace.tsx`

Même logique que DeliverableDetailPage avec vérifications identiques pour les permissions TALENT.

---

### **8️⃣ DELIVERABLE SERVICES**

**Fichier:** `services/deliverableService.ts`

```typescript
export const assignTalentToDeliverable = async (
  id: string,
  talentId: string | null
) => {
  const response = await api.patch(`/deliverables/${id}/assign`, { talentId });
  return response.data.data;
};

export const acceptAssignment = async (id: string) => {
  const response = await api.patch(`/deliverables/${id}/accept`);
  return response.data.data;
};

export const rejectAssignment = async (id: string, reason?: string) => {
  const response = await api.patch(`/deliverables/${id}/reject`, { reason });
  return response.data.data;
};
```

---

### **9️⃣ LAYOUT & NAVIGATION**

**Fichier:** `components/Layout.tsx`

```typescript
const showNewProjectButton =
  (user.role === UserRole.CLIENT ||
   user.role === UserRole.TALENT) &&
  location.pathname !== '/projects/new' &&
  !isRestrictedPage;
```

---

### **🔟 STUDIOS PAGE**

**Fichier:** `pages/Studios.tsx`

```typescript
const canCreateStudio = user && (
  user.role === 'ADMIN' ||
  user.role === 'CLIENT' ||
  user.role === 'TALENT'
);
```

---

## **🔄 WORKFLOW COMPLET: ASSIGNMENT → ACCEPTANCE → PRODUCTION**

### **Étape 1: CLIENT assigne un TALENT**
```
POST /deliverables/:id/assign { talentId: "talent-uuid" }
├─ Set acceptanceStatus = 'PENDING'
├─ Create notification → TALENT DB
├─ Send email → TALENT email
└─ Socket.IO → TALENT browser
```

### **Étape 2: TALENT accepte**
```
PATCH /deliverables/:id/accept
├─ Verify assignedTalentId === user.id ✓
├─ Set status = 'PRODUCTION'
├─ Set progress = 50%
├─ Set acceptanceStatus = 'ACCEPTED'
├─ Create notification → CLIENT DB
├─ Send email → CLIENT email
├─ Socket.IO → PROJECT room
└─ canUploadVersion = true
```

### **Étape 3: TALENT rejette**
```
PATCH /deliverables/:id/reject { reason?: string }
├─ Verify assignedTalentId === user.id ✓
├─ Set assignedTalentId = null
├─ Set acceptanceStatus = 'REJECTED'
├─ Create notification → CLIENT DB (avec raison)
├─ Send email → CLIENT email
└─ Socket.IO → PROJECT room
```

---

## **📋 RÉSUMÉ DES CAPACITÉS TALENT**

| Capability | Backend | Frontend | Status |
|------------|---------|----------|--------|
| **Profile Management** | ✅ Full CRUD | ✅ Full UI | Active |
| **Project Visibility** | ✅ GraphQL filtering | ✅ MyProjects | Active |
| **Deliverable Access** | ✅ Granular filtering | ✅ List/Detail views | Active |
| **Accept/Reject** | ✅ API endpoints | ✅ UI buttons | Active |
| **Version Upload** | ✅ File handling | ✅ Upload form | Active |
| **Feedback Review** | ✅ Comment system | ✅ Feedback view | Active |
| **Approval Rights** | ✅ approve=true | ✅ UI enabled | Active |
| **Auto-assignment** | ✅ On creation | ✅ Self-assign | Active |
| **Notifications** | ✅ Real-time | ✅ Socket.IO | Active |
| **Opportunities** | ✅ Apply system | ✅ Listing | Active |
| **Studios Creation** | ✅ Allowed | ✅ Can create | Active |

---

## **⚠️ POINTS CRITIQUES À SURVEILLER**

1. **Status livrable à la création** (Backend, ligne 35-36)
   - ❓ TALENT créateur → PRODUCTION immédiatement
   - ❓ Devrait être PREPARATION + acceptation required?

2. **Filtrage GraphQL strict** (Backend, ligne 200-211)
   - ✅ TALENT ne voit que ses livrables
   - ⚠️ Sauf s'il est le talent principal du projet

3. **Permissions d'approbation** (Backend)
   - ✅ TALENT peut approver (approve=true)
   - CLIENT ne peut pas (approve=false)

4. **Double auto-assignation** (Frontend)
   - ✅ Priority: assignedTalentId → project.talent → user.id

---

**FIN DE L'AUDIT**
