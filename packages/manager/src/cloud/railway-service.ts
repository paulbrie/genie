import { getGlobalRailwayToken, getGlobalRailwayProjectId } from "../settings-service.js";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

interface RailwayDeployment {
  id: string;
  status: string;
  createdAt: string;
  serviceId: string;
  serviceName: string;
}

interface RailwayLogEntry {
  timestamp: string;
  message: string;
  severity: string;
}

async function railwayGql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const token = await getGlobalRailwayToken();
  if (!token) throw new Error("Railway token is not configured. Set it in Settings.");

  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Railway API error: ${res.status} ${res.statusText}`);
  const json = await res.json() as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data ?? {};
}

export async function getDeployments(limit = 10): Promise<RailwayDeployment[]> {
  const projectId = await getGlobalRailwayProjectId();
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!projectId) throw new Error("Railway project ID is not configured. Set it in Settings.");

  const query = `
    query($projectId: String!, $environmentId: String, $first: Int) {
      deployments(
        input: { projectId: $projectId, environmentId: $environmentId }
        first: $first
      ) {
        edges {
          node {
            id
            status
            createdAt
            service { id name }
          }
        }
      }
    }
  `;

  const data = await railwayGql(query, { projectId, environmentId, first: limit });
  const edges = (data.deployments as { edges: { node: Record<string, unknown> }[] })?.edges ?? [];
  return edges.map((e) => ({
    id: e.node.id as string,
    status: e.node.status as string,
    createdAt: e.node.createdAt as string,
    serviceId: (e.node.service as { id: string })?.id ?? "",
    serviceName: (e.node.service as { name: string })?.name ?? "unknown",
  }));
}

export async function getDeploymentLogs(deploymentId: string, limit = 500): Promise<RailwayLogEntry[]> {
  const query = `
    query($deploymentId: String!, $limit: Int) {
      deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
        timestamp
        message
        severity
      }
    }
  `;

  const data = await railwayGql(query, { deploymentId, limit });
  return (data.deploymentLogs as RailwayLogEntry[]) ?? [];
}

export async function getBuildLogs(deploymentId: string, limit = 500): Promise<RailwayLogEntry[]> {
  const query = `
    query($deploymentId: String!, $limit: Int) {
      buildLogs(deploymentId: $deploymentId, limit: $limit) {
        timestamp
        message
        severity
      }
    }
  `;

  const data = await railwayGql(query, { deploymentId, limit });
  return (data.buildLogs as RailwayLogEntry[]) ?? [];
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await getGlobalRailwayToken();
    if (!token) return { ok: false, message: "Railway token is not configured" };
    const projectId = await getGlobalRailwayProjectId();

    // Simple query to verify token works
    const data = await railwayGql(`query($projectId: String!) { project(id: $projectId) { id name } }`, { projectId: projectId || "dummy" });
    const project = data.project as { id: string; name: string } | undefined;
    if (project?.name) {
      return { ok: true, message: `Connected to project "${project.name}"` };
    }
    return { ok: true, message: "Token is valid" };
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
