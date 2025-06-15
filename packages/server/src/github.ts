import type { DB } from "@ragdoll/db";
import type { GenericEndpointContext } from "better-auth";
import { getSessionFromCtx } from "better-auth/api";
import { sql } from "kysely";
import { auth } from "./better-auth";
import { db } from "./db";

export async function handleGithubAccountUpdate(
  {
    accessToken,
    scope,
  }: {
    accessToken: string;
    scope: string;
  },
  ctx: GenericEndpointContext,
) {
  const session = await getSessionFromCtx(ctx, {
    disableRefresh: true,
  });
  if (!session) return;

  const userAccounts = await auth.api.listUserAccounts({
    headers: ctx.request?.headers,
  });
  const githubUserAccount = userAccounts.find(
    (account) => account.provider === "github",
  );
  if (!githubUserAccount) return;

  const vendorData = JSON.stringify({
    provider: "github",
    integrationId: githubUserAccount.accountId,
    payload: {
      accessToken: accessToken,
      scopes: scope.split(","),
    },
  } satisfies DB["externalIntegration"]["vendorData"]["__select__"]);

  await db
    .insertInto("externalIntegration")
    .values({
      userId: session.user.id,
      vendorData,
    })
    .onConflict((oc) =>
      oc
        .expression(
          sql`("vendorData"->>'provider'), ("vendorData"->>'integrationId')`,
        )
        .doUpdateSet({
          userId: session.user.id,
          vendorData,
        }),
    )
    .execute();
  return true;
}
