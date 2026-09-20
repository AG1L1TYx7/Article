"use client";

/**
 * The last resort: shown only when the root layout itself fails, so it
 * has to carry its own <html> and <body> and cannot rely on the
 * stylesheet having loaded. Styles are inline for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf8f4",
          color: "#17140f",
          fontFamily: "Georgia, 'Times New Roman', serif",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <p style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#b7271f", fontFamily: "system-ui, sans-serif" }}>
            The Dispatch
          </p>
          <h1 style={{ fontSize: 34, lineHeight: 1.1, margin: "12px 0 0" }}>Something broke on our side.</h1>
          <p style={{ color: "#57524a", fontFamily: "system-ui, sans-serif", fontSize: 15, lineHeight: 1.6 }}>
            The page couldn&apos;t be built. It has been logged
            {error.digest ? ` (reference ${error.digest})` : ""}. Please try again in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 18px",
              borderRadius: 6,
              border: 0,
              background: "#17140f",
              color: "#faf8f4",
              fontFamily: "system-ui, sans-serif",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
