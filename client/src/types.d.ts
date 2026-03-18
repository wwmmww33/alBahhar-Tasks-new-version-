// Task related types
export type Subtask = {
  SubtaskID: number;
  TaskID: number;
  Title: string;
  Description: string;
  IsCompleted: boolean;
  AssignedTo: string;
  AssignedToVacancyID?: number | string | null;
  AssignedToName?: string;
  CreatedBy: string;
  CreatedByVacancyID?: number | string | null;
  CreatedByName?: string;
  ActedBy?: string;
  LastActedByVacancyID?: number | string | null;
  ActedByName?: string;
  DueDate?: string;
  CreatedAt: string;
  UpdatedAt: string;
  ShowInCalendar?: boolean;
};

export type Task = {
  TaskID: number;
  Title: string;
  Description: string;
  Status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'external' | 'approved-in-progress' | 'open';
  Priority: 'low' | 'medium' | 'high';
  AssignedTo: string;
  AssignedToVacancyID?: number | string | null;
  CreatedBy: string;
  CreatedByVacancyID?: number | string | null;
  ActedBy?: string;
  LastActedByVacancyID?: number | string | null;
  DepartmentID: number;
  CategoryID?: number | null;
  URL?: string | null;
  CreatedAt: string;
  UpdatedAt: string;
  DueDate: string | null;
  CompletedAt: string | null;
  AssignedToName?: string;
  CreatedByName?: string;
  ActedByName?: string;
  DepartmentName?: string;
  CategoryName?: string;
  Subtasks?: Subtask[];
};

// Category related types
export type Category = {
  CategoryID: number;
  Name: string;
  Description: string;
  DepartmentID: number;
  CreatedBy: string;
  CreatedByName?: string;
  DepartmentName?: string;
  CreatedAt: string;
  UpdatedAt: string;
  IsActive: boolean;
};

// User related types
export type User = {
  UserID: string;
  VacancyID?: number | string | null;
  CurrentVacancyID?: number | string | null;
  ActiveVacancyID?: number | string | null;
  FullName: string;
  Email: string;
  DepartmentID: number | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string;
  DepartmentName?: string;
  IsAdmin: boolean;
};

export type Comment = {
  CommentID: number;
  TaskID: number;
  UserID: string;
  CommentedByVacancyID?: number | string | null;
  ActedBy?: string;
  LastActedByVacancyID?: number | string | null;
  Content: string;
  CreatedAt: string;
  UserName?: string;
  ActedByName?: string;
};

export type CurrentUser = {
  UserID: string;
  VacancyID?: number | string | null;
  CurrentVacancyID?: number | string | null;
  ActiveVacancyID?: number | string | null;
  FullName: string;
  DepartmentID: number | null;
  DepartmentName: string | null;
  IsAdmin: boolean;
};

export type CategoryInformation = {
  InformationID: number;
  CategoryID: number;
  Title: string;
  Content: string;
  OrderIndex: number;
  CreatedBy: string;
  CreatedAt: string;
  UpdatedAt: string;
  IsActive: boolean;
  CreatedByName?: string;
};

export type CategoriesResponse = {
  Categories: Category[];
  Count: number;
};