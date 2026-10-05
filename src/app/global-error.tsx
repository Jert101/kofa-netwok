"use client";

import "./globals.css";

/**
 * The boundary above the root layout, so it has to supply its own <html> and <body>. It catches a
 * failure in the root layout itself, where `app/error.tsx` cannot help because the boundary it lives
 * in is the thing that broke.
 *
 * `globals.css` is imported here on purpose: without it the fallback would render unstyled, since the
 * stylesheet normally arrives through the root layout that just failed.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: "28rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>The app could not start</h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", opacity: 0.7 }}>
            Reload the page. If it keeps happening, the server log has the details.
          </p>
          {error.digest ? (
            <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", opacity: 0.6, fontFamily: "monospace" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <a href="/login" style={{ display: "inline-block", marginTop: "1rem", fontSize: "0.875rem" }}>
            Go to sign in
          </a>
        </main>
      </body>
    </html>
  );
}