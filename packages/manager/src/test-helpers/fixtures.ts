// Compact fixture builders for service tests. Each function inserts a row and
// returns its id. Defaults are chosen to be minimal — pass overrides for any
// field a given test cares about.

import { getTestDb } from "./db.js";
import {
  users,
  organizations,
  orgMembers,
  teams,
  teamMembers,
  projects,
  projectMembers,
  projectTeams,
} from "../db/schema.js";

let counter = 0;
const uniq = (label: string) => `${label}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

export async function makeUser(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<typeof users.$inferSelect> {
  const db = getTestDb();
  const [row] = await db
    .insert(users)
    .values({
      email: overrides.email ?? `${uniq("u")}@test.invalid`,
      name: overrides.name ?? uniq("name"),
      isAgent: false,
      validated: true,
      role: "user",
      ...overrides,
    })
    .returning();
  return row;
}

export async function makeOrg(
  overrides: Partial<typeof organizations.$inferInsert> = {},
): Promise<typeof organizations.$inferSelect> {
  const db = getTestDb();
  const [row] = await db
    .insert(organizations)
    .values({ name: overrides.name ?? uniq("org"), ...overrides })
    .returning();
  return row;
}

export async function addUserToOrg(
  orgId: string,
  userId: string,
  role: "owner" | "admin" | "member" = "member",
): Promise<void> {
  const db = getTestDb();
  await db.insert(orgMembers).values({ orgId, userId, role });
}

export async function makeTeam(
  overrides: Partial<typeof teams.$inferInsert> = {},
): Promise<typeof teams.$inferSelect> {
  const db = getTestDb();
  const [row] = await db
    .insert(teams)
    .values({ name: overrides.name ?? uniq("team"), ...overrides })
    .returning();
  return row;
}

export async function addUserToTeam(
  teamId: string,
  userId: string,
  role: "owner" | "member" | "superadmin" = "member",
): Promise<void> {
  const db = getTestDb();
  await db.insert(teamMembers).values({ teamId, userId, role });
}

export async function makeProject(
  overrides: Partial<typeof projects.$inferInsert> = {},
): Promise<typeof projects.$inferSelect> {
  const db = getTestDb();
  const [row] = await db
    .insert(projects)
    .values({ name: overrides.name ?? uniq("proj"), ...overrides })
    .returning();
  return row;
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: "owner" | "member" = "member",
): Promise<void> {
  const db = getTestDb();
  await db.insert(projectMembers).values({ projectId, userId, role });
}

export async function addProjectTeam(projectId: string, teamId: string): Promise<void> {
  const db = getTestDb();
  await db.insert(projectTeams).values({ projectId, teamId });
}
