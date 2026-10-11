import { AppShell } from "@/components/layout/AppShell";
import { MemberActorGate } from "@/components/auth/MemberActorGate";
import { NAV_GROUPS_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";
import {
  REQUIRE_ACTOR_KEY,
  isActorRequired,
  isMemberActorGateOpen,
} from "@/lib/auth/session-valid";
import { getSettings } from "@/lib/settings/store";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("member");

  // The login dialog asks for a name, but it is client state: after the PIN
  // step the cookie is already set, so opening /member directly skips it.
  // This is the half that cannot be skipped. It honours the same
  // `require_actor_name_member` setting the login dialog reads, so the two
  // agree by construction -- and it only ever gates the member's own role,
  // never an admin browsing these pages.
  const actorSettings = await getSettings([REQUIRE_ACTOR_KEY.member]).catch(
    () => ({} as Record<string, string>),
  );
  if (
    isMemberActorGateOpen(
      session.role,
      session.actor?.id ?? null,
      isActorRequired("member", actorSettings),
    )
  ) {
    return <MemberActorGate />;
  }

  return (
    <AppShell
      role={session.role}
      groups={NAV_GROUPS_BY_ROLE[session.role]}
      actor={session.actor ?? null}
    >
      {children}
    </AppShell>
  );
}
