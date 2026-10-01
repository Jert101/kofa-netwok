import { MemberProfile } from "@/features/members/ui/MemberProfile";

export const metadata = { title: "Member" };

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemberProfile memberId={id} />;
}
