import Link from "next/link";
import { SignupForm } from "@/components/signup-form";

export default function RegisterPage() {
  return (
    <div className="flex min-h-svh w-full items-start justify-center p-4 py-8 sm:p-6 md:py-10">
      <div className="w-full max-w-md">
        <SignupForm />
        <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
          Already applied?{" "}
          <Link href="/register/status" className="font-medium text-[var(--brand)] hover:underline">
            Check your status
          </Link>
        </p>
        <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
          Knights of the Altar Attendance Monitoring System&trade; &middot; Created
          by Jerson Catadman &middot; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
