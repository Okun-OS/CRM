"use client";

/**
 * Last-resort error boundary: it replaces the whole document, so it brings its
 * own <html> and <body> and must not depend on the root layout.
 *
 * It shows the digest rather than the message — the message can carry internal
 * detail, the digest is the handle that matches the server log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body style={{ margin: 0, minHeight: "100dvh", background: "#0D1117", color: "#E5E7EB", fontFamily: "system-ui, sans-serif" }}>
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Es ist ein unerwarteter Fehler aufgetreten</h1>
          <p style={{ marginTop: "0.5rem", maxWidth: "32rem", fontSize: "0.875rem", lineHeight: 1.6, color: "#9CA3AF" }}>
            Ihre Daten sind unverändert. Bitte versuchen Sie es erneut — besteht der Fehler weiter, nennen Sie der
            Administration die folgende Kennung.
          </p>
          {error.digest ? (
            <code
              style={{
                marginTop: "1rem",
                padding: "0.375rem 0.75rem",
                borderRadius: "0.375rem",
                background: "rgba(255,255,255,0.06)",
                fontSize: "0.75rem",
              }}
            >
              {error.digest}
            </code>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.75rem",
              height: "2.25rem",
              padding: "0 1rem",
              border: 0,
              borderRadius: "0.375rem",
              background: "#2563EB",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Erneut versuchen
          </button>
          <p style={{ marginTop: "4rem", fontSize: "0.6875rem", color: "#6B7280" }}>Powered by OKUN Software</p>
        </main>
      </body>
    </html>
  );
}
