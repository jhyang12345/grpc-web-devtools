// Screenshot fake data — only used on the fake-data-screenshots branch.
// Inject realistic gRPC call history so the extension looks populated for store screenshots.

import { logNetworkEntry, selectLogEntry } from './state/network';

const T = 0; // base timing offset

const ENTRIES = [
  // 1 ─ Authenticate
  {
    requestId: 1,
    method: '/workspace.auth.AuthService/Authenticate',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      email: 'sarah.kim@techcorp.io',
      password: '••••••••',
      mfaCode: '482901',
    },
    response: {
      userId: 'usr_7fK2mNpQ',
      accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfN2ZLMm1OcFEiLCJpYXQiOjE3MTE5NjAwMDB9.sig',
      refreshToken: 'rf_29kJmP8xNqL4wR7vT3yZ',
      expiresIn: 3600,
      workspaceId: 'ws_pL8xQ9nR',
    },
    timing: { startTime: T, endTime: T + 145, duration: 145 },
  },

  // 2 ─ GetProfile
  {
    requestId: 2,
    method: '/workspace.user.UserService/GetProfile',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: { userId: 'usr_7fK2mNpQ' },
    response: {
      userId: 'usr_7fK2mNpQ',
      email: 'sarah.kim@techcorp.io',
      displayName: 'Sarah Kim',
      role: 'admin',
      jobTitle: 'Engineering Manager',
      department: 'Platform',
      avatarUrl: 'https://cdn.workspace.io/avatars/usr_7fK2mNpQ.jpg',
      teams: [
        { teamId: 'team_2jP5kN', name: 'Platform Core', role: 'lead' },
        { teamId: 'team_8mQ3pR', name: 'Infrastructure', role: 'member' },
      ],
      timezone: 'America/Los_Angeles',
      createdAt: '2023-04-12T10:30:00Z',
      lastActiveAt: '2024-03-25T09:14:32Z',
    },
    timing: { startTime: T, endTime: T + 67, duration: 67 },
  },

  // 3 ─ ListProjects
  {
    requestId: 3,
    method: '/workspace.project.ProjectService/ListProjects',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      workspaceId: 'ws_pL8xQ9nR',
      pageSize: 20,
      sortBy: 'lastUpdated',
      filter: { status: 'active' },
    },
    response: {
      projects: [
        { projectId: 'proj_4nR7xY', name: 'API Gateway Redesign', status: 'active', taskCount: 34, completedCount: 12, ownerId: 'usr_7fK2mNpQ', dueDate: '2024-04-30' },
        { projectId: 'proj_2mK8pL', name: 'Mobile App v3.0', status: 'active', taskCount: 67, completedCount: 41, ownerId: 'usr_3pQ9mR', dueDate: '2024-05-15' },
        { projectId: 'proj_9qT3nZ', name: 'Data Pipeline Migration', status: 'active', taskCount: 28, completedCount: 9, ownerId: 'usr_8kN2xP', dueDate: '2024-06-01' },
        { projectId: 'proj_5vW2kM', name: 'Security Audit 2024', status: 'active', taskCount: 15, completedCount: 15, ownerId: 'usr_7fK2mNpQ', dueDate: '2024-03-31' },
        { projectId: 'proj_1xB6pR', name: 'Customer Portal Refresh', status: 'active', taskCount: 52, completedCount: 38, ownerId: 'usr_2nL5qT', dueDate: '2024-07-15' },
      ],
      nextPageToken: '',
      totalCount: 12,
    },
    timing: { startTime: T, endTime: T + 234, duration: 234 },
  },

  // 4 ─ GetTask
  {
    requestId: 4,
    method: '/workspace.task.TaskService/GetTask',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: { taskId: 'task_3kP9mW' },
    response: {
      taskId: 'task_3kP9mW',
      projectId: 'proj_4nR7xY',
      title: 'Implement rate limiting middleware',
      description: 'Add token-bucket rate limiting to all public API endpoints. Target: 1000 req/min per API key.',
      status: 'in_progress',
      priority: 'high',
      assigneeId: 'usr_7fK2mNpQ',
      reporterId: 'usr_3pQ9mR',
      labels: ['backend', 'performance', 'api'],
      dueDate: '2024-04-05',
      estimateHours: 8,
      loggedHours: 3.5,
      createdAt: '2024-03-18T11:00:00Z',
      updatedAt: '2024-03-25T08:45:00Z',
    },
    timing: { startTime: T, endTime: T + 89, duration: 89 },
  },

  // 5 ─ CreateTask
  {
    requestId: 5,
    method: '/workspace.task.TaskService/CreateTask',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      projectId: 'proj_4nR7xY',
      title: 'Add OpenTelemetry instrumentation',
      description: 'Instrument all service-to-service calls with OTEL traces and spans.',
      priority: 'medium',
      assigneeId: 'usr_8kN2xP',
      labels: ['observability', 'backend'],
      dueDate: '2024-04-15',
      estimateHours: 12,
    },
    response: {
      taskId: 'task_8mQ2kL',
      projectId: 'proj_4nR7xY',
      status: 'open',
      createdAt: '2024-03-25T09:15:44Z',
    },
    timing: { startTime: T, endTime: T + 312, duration: 312 },
  },

  // 6 ─ ListMembers
  {
    requestId: 6,
    method: '/workspace.team.TeamService/ListMembers',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: { teamId: 'team_2jP5kN', includePermissions: true },
    response: {
      members: [
        { userId: 'usr_7fK2mNpQ', displayName: 'Sarah Kim', role: 'lead', joinedAt: '2023-04-12T10:30:00Z' },
        { userId: 'usr_3pQ9mR', displayName: 'Marcus Chen', role: 'member', joinedAt: '2023-06-01T09:00:00Z' },
        { userId: 'usr_8kN2xP', displayName: 'Priya Patel', role: 'member', joinedAt: '2023-07-15T14:00:00Z' },
        { userId: 'usr_2nL5qT', displayName: 'Alex Rivera', role: 'member', joinedAt: '2024-01-08T11:30:00Z' },
      ],
      totalCount: 4,
    },
    timing: { startTime: T, endTime: T + 178, duration: 178 },
  },

  // 7 ─ Subscribe (server streaming)
  {
    requestId: 7,
    method: '/workspace.notification.NotificationService/Subscribe',
    methodType: 'server_streaming',
    transport: 'grpc-web',
    canReplay: true,
    request: {
      userId: 'usr_7fK2mNpQ',
      topics: ['task.assigned', 'task.status_changed', 'comment.created', 'mention'],
    },
    response: {
      notificationId: 'notif_9kM3pR',
      topic: 'task.assigned',
      payload: { taskId: 'task_8mQ2kL', assignedBy: 'usr_3pQ9mR' },
      createdAt: '2024-03-25T09:15:45Z',
    },
    timing: {
      startTime: T,
      endTime: T + 4231,
      duration: 4231,
      messageCount: 5,
      firstMessageTime: T + 312,
      lastMessageTime: T + 4231,
    },
  },

  // 8 ─ GetUsage (error: PERMISSION_DENIED)
  {
    requestId: 8,
    method: '/workspace.billing.BillingService/GetUsage',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      workspaceId: 'ws_pL8xQ9nR',
      period: '2024-03',
      breakdown: ['seats', 'storage', 'api_calls'],
    },
    error: {
      code: 7,
      message: "Permission denied: 'billing.usage.read' scope is required. Current role: admin. Required role: owner.",
    },
    timing: { startTime: T, endTime: T + 34, duration: 34 },
  },

  // 9 ─ GlobalSearch
  {
    requestId: 9,
    method: '/workspace.search.SearchService/GlobalSearch',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      query: 'rate limiting',
      workspaceId: 'ws_pL8xQ9nR',
      types: ['task', 'comment', 'file', 'project'],
      limit: 10,
    },
    response: {
      results: [
        { type: 'task', id: 'task_3kP9mW', title: 'Implement rate limiting middleware', projectName: 'API Gateway Redesign', score: 0.98 },
        { type: 'task', id: 'task_7pN2xL', title: 'Document rate limiting behaviour', projectName: 'API Gateway Redesign', score: 0.91 },
        { type: 'comment', id: 'cmt_4mK9pQ', excerpt: '...the rate limiting should apply per API key, not per IP...', taskId: 'task_3kP9mW', score: 0.87 },
        { type: 'file', id: 'file_2nR6xT', name: 'rate-limiting-spec.md', projectName: 'API Gateway Redesign', score: 0.82 },
      ],
      totalCount: 4,
      took: 812,
    },
    timing: { startTime: T, endTime: T + 891, duration: 891 },
  },

  // 10 ─ ListIntegrations
  {
    requestId: 10,
    method: '/workspace.integration.IntegrationService/ListIntegrations',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: { workspaceId: 'ws_pL8xQ9nR', status: 'active' },
    response: {
      integrations: [
        { integrationId: 'int_1', provider: 'github', status: 'active', connectedAt: '2023-05-01T10:00:00Z', syncedRepos: 14 },
        { integrationId: 'int_2', provider: 'slack', status: 'active', connectedAt: '2023-05-02T11:00:00Z', channels: 8 },
        { integrationId: 'int_3', provider: 'jira', status: 'active', connectedAt: '2023-06-10T09:00:00Z', syncedProjects: 3 },
        { integrationId: 'int_4', provider: 'datadog', status: 'active', connectedAt: '2023-08-15T14:30:00Z' },
      ],
      totalCount: 4,
    },
    timing: { startTime: T, endTime: T + 145, duration: 145 },
  },

  // 11 ─ CreateWebhook
  {
    requestId: 11,
    method: '/workspace.webhook.WebhookService/CreateWebhook',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: {
      workspaceId: 'ws_pL8xQ9nR',
      url: 'https://hooks.app.techcorp.io/workspace/events',
      events: ['task.created', 'task.status_changed', 'comment.created'],
      signingSecret: 'whsec_k29fj3kMnP8xQrL',
    },
    response: {
      webhookId: 'wh_9kM2nPqL',
      status: 'active',
      createdAt: '2024-03-25T09:15:50Z',
      deliveryUrl: 'https://hooks.app.techcorp.io/workspace/events',
    },
    timing: { startTime: T, endTime: T + 223, duration: 223 },
  },

  // 12 ─ GetProjectMetrics
  {
    requestId: 12,
    method: '/workspace.analytics.AnalyticsService/GetProjectMetrics',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      projectId: 'proj_4nR7xY',
      period: 'last_30_days',
      metrics: ['velocity', 'burndown', 'cycle_time', 'throughput'],
    },
    response: {
      projectId: 'proj_4nR7xY',
      period: { start: '2024-02-24', end: '2024-03-25' },
      metrics: {
        velocity: { value: 38, unit: 'story_points', trend: '+12%' },
        cycleTimeDays: { p50: 2.4, p90: 6.1, p99: 11.2 },
        throughput: { tasksCompleted: 22, trend: '+8%' },
        openTasks: 22,
        inProgressTasks: 7,
        completedTasks: 12,
      },
    },
    timing: { startTime: T, endTime: T + 567, duration: 567 },
  },

  // 13 ─ ListComments
  {
    requestId: 13,
    method: '/workspace.comment.CommentService/ListComments',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: { taskId: 'task_3kP9mW', limit: 10, sortBy: 'createdAt' },
    response: {
      comments: [
        { commentId: 'cmt_1', authorId: 'usr_3pQ9mR', body: 'Went with token-bucket algo. Should handle burst traffic gracefully.', createdAt: '2024-03-20T10:15:00Z', reactions: { thumbsUp: 3 } },
        { commentId: 'cmt_2', authorId: 'usr_7fK2mNpQ', body: 'Looks good! Make sure to also set headers (X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After).', createdAt: '2024-03-20T11:02:00Z', reactions: { thumbsUp: 2 } },
        { commentId: 'cmt_3', authorId: 'usr_8kN2xP', body: 'Will the limits be configurable per API key tier?', createdAt: '2024-03-21T09:30:00Z', reactions: {} },
        { commentId: 'cmt_4', authorId: 'usr_3pQ9mR', body: 'Yes — free: 100/min, pro: 1000/min, enterprise: unlimited. Stored in Redis.', createdAt: '2024-03-21T10:00:00Z', reactions: { thumbsUp: 4 } },
      ],
      totalCount: 4,
    },
    timing: { startTime: T, endTime: T + 134, duration: 134 },
  },

  // 14 ─ UpdateTaskStatus
  {
    requestId: 14,
    method: '/workspace.task.TaskService/UpdateTaskStatus',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      taskId: 'task_8mQ2kL',
      status: 'in_progress',
      assigneeId: 'usr_8kN2xP',
      comment: 'Starting this sprint.',
    },
    response: {
      taskId: 'task_8mQ2kL',
      status: 'in_progress',
      assigneeId: 'usr_8kN2xP',
      updatedAt: '2024-03-25T09:16:01Z',
    },
    timing: { startTime: T, endTime: T + 89, duration: 89 },
  },

  // 15 ─ GetTask (error: NOT_FOUND)
  {
    requestId: 15,
    method: '/workspace.task.TaskService/GetTask',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: { taskId: 'task_archived_7f2k' },
    error: {
      code: 5,
      message: "Task 'task_archived_7f2k' not found. It may have been deleted or you may not have access.",
    },
    timing: { startTime: T, endTime: T + 41, duration: 41 },
  },

  // 16 ─ ListFiles
  {
    requestId: 16,
    method: '/workspace.file.FileService/ListFiles',
    methodType: 'unary',
    transport: 'connect-web',
    canReplay: true,
    request: {
      projectId: 'proj_4nR7xY',
      fileTypes: ['document', 'spreadsheet', 'image'],
      sortBy: 'updatedAt',
      pageSize: 20,
    },
    response: {
      files: [
        { fileId: 'file_1', name: 'rate-limiting-spec.md', type: 'document', sizeBytes: 14320, uploadedBy: 'usr_3pQ9mR', updatedAt: '2024-03-22T15:30:00Z' },
        { fileId: 'file_2', name: 'api-architecture-diagram.png', type: 'image', sizeBytes: 892043, uploadedBy: 'usr_7fK2mNpQ', updatedAt: '2024-03-20T11:00:00Z' },
        { fileId: 'file_3', name: 'Q1-sprint-planning.xlsx', type: 'spreadsheet', sizeBytes: 38912, uploadedBy: 'usr_7fK2mNpQ', updatedAt: '2024-03-15T09:00:00Z' },
        { fileId: 'file_4', name: 'load-test-results.pdf', type: 'document', sizeBytes: 1204891, uploadedBy: 'usr_8kN2xP', updatedAt: '2024-03-18T16:45:00Z' },
      ],
      nextPageToken: '',
      totalCount: 4,
    },
    timing: { startTime: T, endTime: T + 267, duration: 267 },
  },

  // 17 ─ StreamActivity (server streaming)
  {
    requestId: 17,
    method: '/workspace.activity.ActivityService/StreamActivity',
    methodType: 'server_streaming',
    transport: 'connect-web',
    canReplay: true,
    request: {
      workspaceId: 'ws_pL8xQ9nR',
      since: '2024-03-25T00:00:00Z',
      types: ['task', 'comment', 'file', 'member'],
    },
    response: {
      activityId: 'act_k29mN7pQ',
      type: 'task',
      actorId: 'usr_8kN2xP',
      action: 'status_changed',
      entityId: 'task_8mQ2kL',
      metadata: { from: 'open', to: 'in_progress' },
      timestamp: '2024-03-25T09:16:01Z',
    },
    timing: {
      startTime: T,
      endTime: T + 8923,
      duration: 8923,
      messageCount: 12,
      firstMessageTime: T + 230,
      lastMessageTime: T + 8923,
    },
  },

  // 18 ─ InviteUser
  {
    requestId: 18,
    method: '/workspace.user.UserService/InviteUser',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: {
      workspaceId: 'ws_pL8xQ9nR',
      email: 'james.lee@techcorp.io',
      role: 'member',
      teams: ['team_2jP5kN'],
      personalMessage: 'Hi James, welcome to the Platform workspace!',
    },
    response: {
      inviteId: 'inv_3mK9pLqR',
      status: 'sent',
      email: 'james.lee@techcorp.io',
      expiresAt: '2024-04-01T09:16:10Z',
    },
    timing: { startTime: T, endTime: T + 445, duration: 445 },
  },

  // 19 ─ GenerateReport
  {
    requestId: 19,
    method: '/workspace.report.ReportService/GenerateReport',
    methodType: 'unary',
    transport: 'grpc-web',
    canReplay: true,
    request: {
      reportType: 'sprint_summary',
      projectId: 'proj_4nR7xY',
      sprintId: 'sprint_14',
      format: 'pdf',
      includeCharts: true,
      recipients: ['sarah.kim@techcorp.io', 'marcus.chen@techcorp.io'],
    },
    response: {
      reportId: 'rpt_7nK2mPqL',
      status: 'completed',
      format: 'pdf',
      sizeBytes: 2189432,
      pages: 12,
      downloadUrl: 'https://reports.workspace.io/rpt_7nK2mPqL?token=tmp_8f2j',
      expiresAt: '2024-03-26T09:16:22Z',
      emailedTo: ['sarah.kim@techcorp.io', 'marcus.chen@techcorp.io'],
    },
    timing: { startTime: T, endTime: T + 1245, duration: 1245 },
  },

  // 20 ─ SyncWorkspace (server streaming)
  {
    requestId: 20,
    method: '/workspace.sync.SyncService/SyncWorkspace',
    methodType: 'server_streaming',
    transport: 'grpc-web',
    canReplay: true,
    request: {
      workspaceId: 'ws_pL8xQ9nR',
      fullSync: false,
      lastSyncAt: '2024-03-24T22:00:00Z',
      entities: ['tasks', 'comments', 'files', 'members'],
    },
    response: {
      entity: 'tasks',
      syncedCount: 47,
      updatedCount: 8,
      deletedCount: 1,
      checksum: 'sha256:a3f8b2c1d9e4f7a0b5c2d8e3f1a6b9c4',
    },
    timing: {
      startTime: T,
      endTime: T + 3421,
      duration: 3421,
      messageCount: 8,
      firstMessageTime: T + 189,
      lastMessageTime: T + 3421,
    },
  },
];

export function injectFakeData(store) {
  ENTRIES.forEach((entry) => store.dispatch(logNetworkEntry(entry)));
  // Pre-select GetProfile (index 1) — rich nested response, good for screenshots
  store.dispatch(selectLogEntry(1));
}
