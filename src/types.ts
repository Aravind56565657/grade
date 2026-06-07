export interface RubricCriteria {
  label: string;
  description: string;
  points: number;
}

export interface RubricItem {
  questionNumber: string;
  questionText: string;
  maxScore: number;
  criteria: RubricCriteria[];
  exemplaryResponse?: string;
}

export interface RubricSection {
  id: string;
  title: string;
  description?: string;
  questionsToAttempt: number;
  questionNumbers: string[];
  maxMarksPerQuestion?: number;
}

export interface Rubric {
  items: RubricItem[];
  sections?: RubricSection[];
}

export interface Exam {
  id: string;
  title: string;
  description: string;
  rubric?: Rubric;
  createdAt: any;
  creatorId: string;
}

export interface Script {
  id: string;
  examId: string;
  studentId: string;
  studentName: string;
  status: 'pending' | 'processing' | 'completed';
  imageUrls: string[];
  createdAt: any;
  updatedAt: any;
}

export interface AIResult {
  score: number;
  confidence: number;
  feedback: string;
}

export interface HumanResult {
  score: number;
  feedback: string;
}

export interface Segment {
  id: string;
  scriptId: string;
  examId: string;
  questionNumber: string;
  questionText: string;
  modelAnswer?: string;
  studentAnswer: string;
  isHandwritten?: boolean;
  aiResult?: AIResult;
  humanResult?: HumanResult;
  status: 'pending' | 'reviewed';
  createdAt: any;
  updatedAt: any;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}
