export type UserRole = 'admin' | 'member';

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  avatar_url?: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export type ClientStatus = 'Active' | 'On Hold' | 'Completed' | 'Archived';

export interface ServiceCategory {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
}

export interface ServiceSubcategory {
  id: string;
  category_id: string;
  name: string;
  description?: string;
  sort_order: number;
  is_archived: boolean;
  default_task_templates: string[];
  created_at: string;
}

export type ClientEngagementStatus = 'Not Started' | 'In Progress' | 'Waiting for Client' | 'Completed' | 'On Hold';

export interface ClientEngagement {
  id: string;
  client_id: string;
  category_id: string;
  subcategory_id: string;
  category_name?: string;
  subcategory_name?: string;
  title: string;
  responsible_member_id?: string;
  responsible_member_name?: string;
  start_date: string; // YYYY-MM-DD
  due_date?: string;  // YYYY-MM-DD
  notes?: string;
  status: ClientEngagementStatus;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  business_name: string;
  contact_person: string;
  phone?: string;
  email?: string;
  services_agreed: string[];
  account_owner_id?: string;
  account_owner_name?: string;
  status: ClientStatus;
  next_update_date?: string; // YYYY-MM-DD
  last_update_sent_at?: string;
  notes?: string;
  shared_links?: string;
  engagements?: ClientEngagement[];
  created_at: string;
  updated_at: string;
}

export type TaskPriority = 'Normal' | 'High' | 'Urgent';
export type TaskStatus = 'To Do' | 'Doing' | 'Review' | 'Done';

export interface Task {
  id: string;
  client_id: string;
  client_name?: string;
  engagement_id?: string;
  engagement_title?: string;
  title: string;
  responsible_member_id?: string;
  responsible_member_name?: string;
  due_date: string; // YYYY-MM-DD (Asia/Kolkata)
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  need_help: boolean;
  help_explanation?: string;
  waiting_for_client: boolean;
  waiting_notes?: string;
  review_feedback?: string;
  completed_at?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TaskChecklist {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  created_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  author_name?: string;
  content: string;
  created_at: string;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  actor_id?: string;
  actor_name?: string;
  action_type: 
    | 'created' 
    | 'status_changed' 
    | 'assigned' 
    | 'deadline_changed' 
    | 'help_requested' 
    | 'waiting_client'
    | 'review_submitted' 
    | 'completed' 
    | 'returned_to_doing' 
    | 'reopened';
  details: string;
  created_at: string;
}

export interface ClientUpdate {
  id: string;
  client_id: string;
  author_id?: string;
  author_name?: string;
  summary_text: string;
  sent_at: string;
  created_at: string;
}

export interface FinancialRecord {
  id: string;
  client_id: string;
  agreed_fee: number;
  next_payment_due_date?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentEntry {
  id: string;
  financial_record_id?: string;
  client_id: string;
  amount: number;
  payment_date: string;
  note?: string;
  created_at: string;
}
