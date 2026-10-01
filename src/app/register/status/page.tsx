import Link from "next/link";
import { RegistrationStatusForm } from "@/components/registrations/RegistrationStatusForm";

export const metadata = { title: "Application status · KofA AMS" };

export default async function RegisterStatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The confirmation card links straight here with the code it just issued, so the
  // applicant lands on the answer instead of a form they have to fill in again.
  const params = await searchParams;
  const raw = params.code;
  const initialCode = (Array.isArray(raw) ? raw[0] : raw) ?? "";

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">Application status</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--muted)]">
        Check whether your application was approved, without signing in.
      </p>
      <RegistrationStatusForm initialCode={initialCode} />
      <p className="mt-6 text-center text-sm text-[var(--muted)]">
        Have not applied yet?{" "}
        <Link href="/register" className="font-medium text-[var(--accent)] hover:underline">
          Apply now
        </Link>
      </p>
    </main>
  );
}
