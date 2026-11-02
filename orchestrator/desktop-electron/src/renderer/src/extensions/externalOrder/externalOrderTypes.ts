export type ExternalOrderRole = { id: string; label: string }

export type ExternalOrderSimplifiedStep = {
  id: string
  title: string
  detail: string
  form: string
  file: string
  prompt: string
}

export type ExternalOrderMeta = {
  role: string
  role_label: string
  can_switch: boolean
  roles: ExternalOrderRole[]
  desk: { title: string; sees: string[]; denied: string[] }
  integrations: { system: string; state: string; note: string }[]
  routes: ExternalOrderRole[]
  simplified_path?: ExternalOrderSimplifiedStep[]
}

export type ExternalOrderBrief = {
  id: string
  code: string
  customer: string
  product: string
  stage_label: string
  status: string
  status_label: string
  blocks: string[]
  payment_note: string
  onec_number?: string
  onec_key?: string
  onec_tkp_key?: string
  path_label?: string
  route?: string
  route_label?: string
  stage?: string
  payment_percent?: number
  open_checks_count?: number
  open_diffs_count?: number
  draft_findings_count?: number
  waiting_roles?: string[]
}

export type ExternalOrderCheck = {
  id: string
  gate: string
  text: string
  owner_role: string
  owner_label: string
  status: string
  status_label?: string
  due_at?: string
  blocking?: boolean
  evidence: string
}

export type ExternalOrderDiff = {
  id: string
  code: string
  area: string
  title: string
  owner_role: string
  owner_label: string
  level: string
  status: string
  left_value: string
  right_value: string
  note: string
}

export type ExternalOrderFinding = {
  id: string
  field: string
  value: string
  source_ref: string
  location?: string
  trace?: {
    document: string
    version: string
    clause: string
    fragment: string
    rule: string
    author: string
  }
  status: string
  owner_role: string
  owner_label?: string
  proposed_by?: string
  /** 'ai' — черновик подготовила модель Cursor. */
  filled_by?: string
  confidence?: string
  kind?: string
  label?: string
  prefill?: Record<string, unknown>
}

/** Поле, заполненное ИИ: черновик ждёт владельца или принятое значение не переписано вручную. */
export type ExternalOrderAiMark = {
  status: 'draft' | 'accepted'
  finding_id: string
  value: string
  source: string
  quote: string
  confidence: string
  trace?: {
    document: string
    version: string
    clause: string
    fragment: string
    rule: string
    author: string
  }
}

export type CopilotAiResult = {
  used: boolean
  ok: boolean
  error: string
  filled: string[]
  answer_checks: Record<string, { ok: boolean; note: string; followup: string }>
}

export type ExternalOrderDecision = {
  id: string
  protocol: string
  decision: string
  conditions: string
  conditions_closed: boolean
  base_version: string
}

export type StagePassportOpenCheck = {
  id: string
  gate: string
  text: string
  owner_role: string
  owner_label: string
  blocking: boolean
}

export type StagePassportDoc = {
  kind: string
  label: string
  present: boolean
  approved: boolean
  version: string
}

export type StagePassport = {
  id: string
  label: string
  hint: string
  statuses: string[]
  state: 'done' | 'current' | 'blocked' | 'upcoming'
  owner_roles: string[]
  owner_labels: string[]
  gates: string[]
  checks_done: number
  checks_total: number
  open_checks: StagePassportOpenCheck[]
  required_docs: StagePassportDoc[]
  blocker: string
  completed_by: string
}

export type CopilotQuestion = {
  id: string
  field: string
  section?: string
  key?: string
  check_id?: string
  gap_id?: string
  prompt: string
  placeholder: string
  current_value?: string
  owner_role: string
  owner_label: string
  /** Подсказки ИИ к вопросу: формулировка, зачем спрашиваем, догадка из дела и её источник. */
  ai_question?: string
  ai_why?: string
  ai_suggestion?: string
  ai_suggestion_source?: string
}

export type ExternalOrderMatrix = {
  counts: { done: number; gap: number; wait: number; out: number }
  rows: {
    id: string
    module: string
    requirement: string
    priority: string
    owner: string
    acceptance: string
    state: string
    state_label: string
    note: string
  }[]
}

export type ExternalOrderReview = {
  summary: string
  prompt: string
  checks: { id: string; gate: string; text: string; owner_label: string; verdict: string; note: string }[]
  diffs: { code: string; area: string; title: string; owner_label: string; level: string; verdict: string; note: string }[]
}

export type ExternalOnecTkp = {
  key: string
  number: string
  date: string
  amount: string
  status?: string
  client?: string
  counterparty?: string
  end_customer?: string
  deal?: string
  contract?: string
  order_number?: string
  organization?: string
  manager?: string
  agreement?: string
  currency?: string
  valid_until?: string
  delivery_days?: string
  payment_form?: string
  delivery?: string
  vat?: string
  approved?: string
  agreed?: string
  operation?: string
  has_order?: string
  kind?: 'tkp' | 'order'
  comment?: string
  product?: string
  order_subject?: string
}

export type ExternalOnecSearch = {
  configured: boolean
  counterparties: { key: string; name: string; inn: string }[]
  orders: ExternalOnecTkp[]
  skip?: number
  top?: number
  has_more?: boolean
  statuses?: string[]
  managers?: string[]
}

export type ExternalOnecFilters = {
  q?: string
  status?: string
  manager?: string
  date_from?: string
  date_to?: string
  has_order?: '' | 'yes' | 'no'
}

export type ExternalOrder = ExternalOrderBrief & {
  inn: string
  contact: string
  route: string
  order_type?: string
  priority?: string
  project_note: string
  owners: Record<string, string>
  sections: Record<string, Record<string, string>>
  /** Ключ section.key. */
  ai_fields?: Record<string, ExternalOrderAiMark>
  checks: ExternalOrderCheck[]
  diffs: ExternalOrderDiff[]
  risks: { id: string; title: string; impact: string; measure?: string; status: string; source?: string }[]
  decisions: ExternalOrderDecision[]
  findings: ExternalOrderFinding[]
  documents: {
    id: string
    kind: string
    title: string
    version: string
    note: string
    file_name?: string
    approved?: boolean
    owner_role?: string
  }[]
  gaps?: {
    id: string
    field: string
    owner_role: string
    owner_label: string
    due_at: string
    detail: string
    status: string
  }[]
  baselines?: {
    id: string
    code: string
    composition: string
    cost: string
    mcr?: string
    margin: string
    bdds?: string
    deadlines?: string
    immutable: boolean
    reason: string
  }[]
  tasks?: {
    id: string
    title: string
    kind: string
    critical: boolean
    approved: boolean
    published: boolean
    source_ref?: string
    depends_on: string
    owner_role?: string
  }[]
  lines?: { id: string; name: string; qty: string; amount: string; change: string }[]
  notices?: { id: string; title: string; body: string; mail_status: string; role: string; kind?: string }[]
  audit: {
    id: string
    actor_fio: string
    actor_role: string
    action: string
    detail: string
    before_value?: string
    after_value?: string
    created_at?: string
  }[]
  stage_passports?: StagePassport[]
  role_questions?: Record<string, CopilotQuestion[]>
  questions?: CopilotQuestion[]
  copilot_summary?: string
}

export type PlanTask = {
  uid: number
  key: string
  wbs: string
  name: string
  level: number
  summary: boolean
  milestone: boolean
  duration_days: number
  start: string
  finish: string
  predecessors: number[]
  resource: string
  resource_name: string
  source: 'дело' | 'норматив' | 'вручную' | ''
  group: 'root' | 'work' | 'conditions'
  notes: string
  editable: boolean
}

export type PlanWarning = { code: string; level: 'stop' | 'warn'; text: string; key?: string }

export type PlanModel = {
  ok: boolean
  order_id: string
  code: string
  title: string
  start: string
  finish: string
  contract_number: string
  template_path: string
  outline_source: 'template' | 'builtin'
  calendar: { holidays: string[]; working_weekends: string[] }
  resources: { key: string; name: string }[]
  all_resources?: { key: string; name: string }[]
  tasks: PlanTask[]
  conditions: { key: string; label: string; value: string; missing: boolean }[]
  warnings: PlanWarning[]
  summary: string
}

export type PlanOverrides = Record<string, { duration_days?: number; resource?: string }>

export type PlanRequest = { overrides: PlanOverrides; start?: string }

export type PlanFileResult = {
  ok: boolean
  summary: string
  file_name: string
  document_id: string
  missing: string[]
  model: PlanModel
}

export type PlanOutlineTask = {
  name: string
  level: number
  duration_days: number
  milestone: boolean
  summary: boolean
  predecessors: number[]
  resource: string
}

export type ExternalOrderCopilotResponse = ExternalOrder & {
  order?: ExternalOrder
  summary?: string
  copilot_summary?: string
  log?: string[]
  questions?: CopilotQuestion[]
  stage_passport?: StagePassport
  review?: ExternalOrderReview
  ai?: CopilotAiResult
}
