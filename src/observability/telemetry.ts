/**
 * Browser OpenTelemetry wiring for Honeycomb.
 *
 * One Effect Layer that bundles trace + metric + log export through OTLP
 * over HTTP, talking directly to Honeycomb. Built on top of
 * `@effect/opentelemetry`'s `WebSdk.layer`, which composes the Effect
 * Tracer / Metrics / Logger services around an OTel SDK assembled
 * from the standard browser packages.
 *
 * ─── Why so many `@opentelemetry/*` peer deps? ─────────────────────────
 * The Effect 4 beta of `@effect/opentelemetry` (4.0.0-beta.50) intentionally
 * does NOT include the `Otlp.layer` convenience helper that the Effect 3
 * stable (0.63.x) shipped with. Instead, the beta expects the consumer to
 * supply browser SDK pieces directly:
 *
 *   - `@opentelemetry/sdk-trace-web` + `@opentelemetry/sdk-trace-base`
 *   - `@opentelemetry/sdk-metrics`
 *   - `@opentelemetry/sdk-logs`
 *   - `@opentelemetry/exporter-trace-otlp-http`
 *   - `@opentelemetry/exporter-metrics-otlp-http`
 *   - `@opentelemetry/exporter-logs-otlp-http`
 *   - `@opentelemetry/api`, `@opentelemetry/resources`,
 *     `@opentelemetry/semantic-conventions`
 *
 * They're all peer deps of `@effect/opentelemetry@4.x-beta`, so they MUST
 * be present. We isolate every raw `@opentelemetry/*` import to this file
 * so the rest of the app only ever sees `Effect`, `Effect.fn`, and our
 * own `TelemetryLayer`.
 *
 * ─── Future migration to first-party Effect packages ───────────────────
 * When `@effect/opentelemetry` ships a stable 4.x release, it is expected
 * to bring back a single `Otlp.layer` (or equivalent) that internally
 * pulls in whatever browser SDK pieces it needs through
 * `@effect/platform` (which already plays this role for the Effect 3
 * stable line). At that point we should:
 *
 *   1. Bump `@effect/opentelemetry` and add `@effect/platform` (Effect 4
 *      stable version).
 *   2. Replace the `WebSdk.layer({...})` block below with `Otlp.layer({
 *        baseUrl: "https://api.honeycomb.io",
 *        headers: { "x-honeycomb-team": <key> },
 *        resource: { serviceName, serviceVersion, attributes },
 *      })`.
 *   3. Delete every `@opentelemetry/*` package from `package.json`.
 *      Renovate will auto-flag them as unused once the imports are gone.
 *   4. Keep `Logger.layer({ mergeWithExisting: true })` — that part of
 *      the API is stable across both lineages and is what bridges
 *      `Effect.logInfo` / `Effect.logError` into OTel logs shipped to
 *      Honeycomb.
 *
 * Tracking issue / signal: keep an eye on the `@effect/opentelemetry`
 * release notes — when the 4.x stable line lands, this file should
 * collapse to ~30 lines.
 */
import { WebSdk } from "@effect/opentelemetry";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Layer } from "effect";

const HONEYCOMB_BASE_URL = "https://api.honeycomb.io";

/**
 * Build the Effect Layer that ships traces / metrics / logs to Honeycomb.
 *
 * Returns `Layer.empty` when there's no Honeycomb ingest key in the
 * environment — a safe no-op so local dev without telemetry secrets
 * still runs the app.
 *
 * Also returns `Layer.empty` during SSR (`typeof window === "undefined"`).
 * The `WebSdk` and the `@opentelemetry/sdk-trace-web` packages it pulls
 * in assume a browser global; instantiating them on the Node server
 * during SSR-render of the client component tree would crash. The
 * client re-evaluates this module on first paint with `window`
 * defined, materialising the real layer at that point.
 */
export const TelemetryLayer: Layer.Layer<never> = (() => {
    if (typeof window === "undefined") return Layer.empty;
    const apiKey = process.env["NEXT_PUBLIC_HONEYCOMB_API_KEY"];
    if (!apiKey) return Layer.empty;

    const headers = { "x-honeycomb-team": apiKey };

    const spanProcessor = new BatchSpanProcessor(
        new OTLPTraceExporter({
            url: `${HONEYCOMB_BASE_URL}/v1/traces`,
            headers,
        }),
    );

    const metricReader = new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
            url: `${HONEYCOMB_BASE_URL}/v1/metrics`,
            headers,
        }),
    });

    const logRecordProcessor = new BatchLogRecordProcessor(
        new OTLPLogExporter({
            url: `${HONEYCOMB_BASE_URL}/v1/logs`,
            headers,
        }),
    );

    return WebSdk.layer(() => ({
        resource: {
            serviceName: "effect-clue",
            serviceVersion:
                process.env["NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"] ?? "dev",
            attributes: {
                "deployment.environment":
                    process.env["NEXT_PUBLIC_VERCEL_ENV"] ?? "development",
            },
        },
        spanProcessor,
        metricReader,
        logRecordProcessor,
        // Keep the console pretty-logger alongside OTel so dev logs still
        // show up in DevTools. `Effect.logInfo` etc. fan out to both.
        loggerMergeWithExisting: true,
    }));
})();

