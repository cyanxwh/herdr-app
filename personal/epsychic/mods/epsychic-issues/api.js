export const CACHE = 'epsychic.linear.cache.v1';
export const DETAIL_CACHE = 'epsychic.linear.details.v1';
export const AGENT = 'epsychic.linear.agent.v1';
const ENDPOINT = 'https://api.linear.app/graphql';

export class LinearError extends Error {
  constructor(message, auth = false) { super(message); this.auth = auth; }
}

export async function query(key, document, variables = {}) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query: document, variables })
    });
  } catch { throw new LinearError('Cannot reach Linear. Check your connection and try again.'); }
  if (response.status === 401 || response.status === 403) throw new LinearError('Linear access was denied. Check your API key and its read permissions.', true);
  if (response.status === 429) throw new LinearError('Linear rate limit reached. Please try again later.');
  if (!response.ok) throw new LinearError('Linear is unavailable. Please try again later.');
  const result = await response.json();
  if (result.errors?.length) {
    const auth = result.errors.some(e => /AUTHENTICATION|FORBIDDEN|UNAUTHENTICATED/.test(e.extensions?.code ?? '') || /not authenticated|authentication required/i.test(e.message ?? ''));
    throw new LinearError(auth ? 'Linear access expired. Reconnect your account.' : 'Linear could not load these issues. Please refresh and try again.', auth);
  }
  if (!result.data) throw new LinearError('Linear returned an incomplete response.');
  return result.data;
}

export const IDENTITY = `query HerdrIdentity { viewer { id name displayName } organization { id name } }`;
export const LIST = `query HerdrMyCurrentIssues($after: String) {
  issues(first: 100, after: $after, includeArchived: false,
    filter: { assignee: { isMe: { eq: true } }, cycle: { isActive: { eq: true } } }) {
    nodes {
      id identifier title url priority updatedAt archivedAt
      parent { id identifier title }
      assignee { id }
      state { name type color }
      project { name }
      team { id name key }
      cycle { id number name startsAt endsAt isActive }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const PARENTS = `query HerdrIssueParents($ids: [ID!]!) {
  issues(first: 100, includeArchived: true, filter: { id: { in: $ids } }) {
    nodes { id identifier title url updatedAt parent { id identifier title } }
  }
}`;
export const CHILDREN = `query HerdrIssueChildren($id: String!, $after: String) {
  issue(id: $id) {
    children(first: 100, after: $after, includeArchived: false) {
      nodes {
        id identifier title updatedAt priority archivedAt
        state { name type color } assignee { id name displayName }
        team { id name key } project { name }
        cycle { id number name startsAt endsAt isActive }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
export const DETAIL = `query HerdrIssueTask($id: String!) {
  viewer { id }
  issue(id: $id) {
    id identifier title description url priority archivedAt
    assignee { id }
    state { name type color }
    project { name }
    team { id name key }
    cycle { id number name startsAt endsAt isActive }
  }
}`;
export const INSPECT = `query HerdrIssueDetails($id: String!, $before: String) {
  viewer { id }
  issue(id: $id) {
    id identifier title description url priority archivedAt updatedAt dueDate
    assignee { id name displayName }
    state { name type color }
    project { name }
    team { id name key }
    cycle { id number name startsAt endsAt isActive }
    labels { nodes { id name color } }
    parent { id identifier title updatedAt }
    children(first: 100, includeArchived: false) {
      nodes {
        id identifier title updatedAt priority archivedAt
        state { name type color } assignee { id name displayName }
        team { id name key } project { name }
        cycle { id number name startsAt endsAt isActive }
      }
      pageInfo { hasNextPage endCursor }
    }
    comments(last: 30, before: $before) {
      nodes { id body createdAt user { name displayName } }
      pageInfo { hasPreviousPage startCursor }
    }
  }
}`;

export function inScope(issue, userId, now = Date.now()) {
  const cycle = issue.cycle;
  return !!userId && issue.assignee?.id === userId && !issue.archivedAt && !!cycle?.isActive &&
    Date.parse(cycle.startsAt) <= now && now < Date.parse(cycle.endsAt);
}
export function currentIssues(snapshot, now = Date.now()) {
  return (snapshot?.issues ?? []).filter(i => inScope(i, snapshot?.viewer?.id, now));
}
export function sortIssues(issues) {
  const rank = { started: 0, unstarted: 1, backlog: 2, triage: 3, completed: 4, canceled: 5 };
  return [...issues].sort((a, b) => (rank[a.state?.type] ?? 3) - (rank[b.state?.type] ?? 3) ||
    (a.priority || 5) - (b.priority || 5) || a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
}
export function cycleLabel(issue) { return `${issue.team?.key ?? ''} · ${issue.cycle?.name || 'Cycle ' + issue.cycle?.number}`; }
export function issueHierarchy(issues, parents = [], search = '', collapsed = new Set()) {
  const scoped = new Set(issues.map(i => i.id));
  const nodes = new Map([...parents, ...issues].map(i => [i.id, i]));
  const visible = new Set();
  const matches = i => `${i.identifier} ${i.title} ${i.project?.name ?? ''}`.toLowerCase().includes(search);
  for (const issue of issues) {
    let current = issue; const path = new Set(); let matched = !search;
    while (current && !path.has(current.id)) {
      path.add(current.id); matched ||= matches(current);
      const parent = current.parent;
      if (parent && !nodes.has(parent.id)) nodes.set(parent.id, parent);
      current = parent && nodes.get(parent.id);
    }
    if (matched) for (const id of path) visible.add(id);
  }
  const children = new Map(); const roots = [];
  // Break malformed parent cycles rather than losing their tasks or recursing forever.
  const attached = new Map();
  for (const issue of sortIssues([...nodes.values()].filter(i => visible.has(i.id)))) {
    const parent = issue.parent?.id; let cursor = parent; const seen = new Set([issue.id]); let cycle = false;
    while (cursor && attached.has(cursor)) { if (seen.has(cursor)) { cycle = true; break; } seen.add(cursor); cursor = attached.get(cursor); }
    if (cursor === issue.id) cycle = true;
    if (parent && visible.has(parent) && !cycle) {
      attached.set(issue.id, parent);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(issue);
    } else roots.push(issue);
  }
  const rows = [];
  const visit = (issue, depth) => {
    const nested = children.get(issue.id) ?? [];
    rows.push({ issue, depth, hasChildren: nested.length > 0, context: !scoped.has(issue.id) });
    if (search || !collapsed.has(issue.id)) for (const child of nested) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return rows;
}
export async function loadSnapshot(key, identity) {
  identity ??= await query(key, IDENTITY);
  const issues = [];
  let after = null;
  const cursors = new Set();
  for (;;) {
    const page = await query(key, LIST, { after });
    if (!Array.isArray(page.issues?.nodes) || !page.issues.pageInfo) throw new LinearError('Linear returned an incomplete issue list.');
    issues.push(...page.issues.nodes);
    if (!page.issues.pageInfo.hasNextPage) break;
    after = page.issues.pageInfo.endCursor;
    if (!after || cursors.has(after) || cursors.size >= 100) throw new LinearError('Linear could not finish loading the issue list. Please refresh.');
    cursors.add(after);
  }
  if (!identity.viewer?.id || !identity.organization?.id) throw new LinearError('Linear returned an incomplete account.');
  const known = new Set(issues.map(i => i.id)), parents = [];
  let frontier = issues;
  for (;;) {
    const missing = [...new Map(frontier.filter(i => i.parent && !known.has(i.parent.id)).map(i => [i.parent.id, i.parent])).values()];
    if (!missing.length) break;
    frontier = [];
    for (let offset = 0; offset < missing.length; offset += 100) {
      const batch = missing.slice(offset, offset + 100);
      batch.forEach(i => known.add(i.id));
      const data = await query(key, PARENTS, { ids: batch.map(i => i.id) });
      const resolved = new Map((data.issues?.nodes ?? []).map(i => [i.id, i]));
      const found = batch.map(i => resolved.get(i.id) ?? i);
      parents.push(...found); frontier.push(...found);
    }
  }
  return { ...identity, issues: [...new Map(issues.map(i => [i.id, i])).values()], parents, savedAt: Date.now() };
}
export function taskPrompt(issue) {
  return `Work on Linear issue ${issue.identifier}.\nRead the issue and relevant context from Linear before starting.`;
}
