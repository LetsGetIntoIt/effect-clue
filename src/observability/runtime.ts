/**
 * A singleton `ManagedRuntime` carrying the `TelemetryLayer`.
 *
 * Why a singleton: the OTel WebSDK opens HTTP-export workers and
 * batching processors — recreating them per `Effect.runPromise` would
 * leak resources and blow our Honeycomb event budget. One runtime per
 * page session, lazily constructed on first use.
 *
 * How callers use it:
 *
 *   import { TelemetryRuntime } from "src/observability/runtime";
 *
 *   // Effect-native call site (preferred):
 *   TelemetryRuntime.runPromise(
 *       Effect.fn("ui.button.click")(() => Effect.sync(() => doStuff()))()
 *   );
 *
 *   // Existing Effect.runSync sites can swap to the runtime variant
 *   // to inherit telemetry without changing the surrounding code:
 *   TelemetryRuntime.runSync(
 *       Effect.result(deduceWithExplanations(initial)).pipe(
 *           Effect.provide(deduceLayer),
 *       ),
 *   );
 *
 * When `NEXT_PUBLIC_HONEYCOMB_API_KEY` is unset (local dev without
 * telemetry secrets) the layer is `Layer.empty` and the runtime
 * functions identically to a bare `Effect.runSync` / `Effect.runPromise`.
 */
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { UserInteractionInstrumentation } from "@opentelemetry/instrumentation-user-interaction";
import { Effect, ManagedRuntime } from "effect";
import { TelemetryLayer } from "./telemetry";

export const TelemetryRuntime = ManagedRuntime.make(TelemetryLayer);

/**
 * Wake the runtime once at module load (browser only, when the
 * Honeycomb key is present) so the OTel WebSDK becomes the active
 * global tracer BEFORE we register the browser auto-instrumentations.
 *
 * Order matters: if instrumentations create spans against the Noop
 * tracer (because the SDK hasn't materialized yet), those spans are
 * dropped silently — which is exactly the "single span per trace"
 * mode we're trying to fix. By running an empty effect first, we
 * force `WebTracerProvider.register()` to run synchronously so that
 * `tracer.startSpan(...)` calls from `DocumentLoadInstrumentation`
 * and `UserInteractionInstrumentation` reach the real exporter.
 *
 * `DocumentLoadInstrumentation` creates a `documentLoad` span with the
 * navigation-timing waterfall (DNS → connect → response → DOM ready
 * → load → first paint). It also captures resource fetches that
 * happened during the initial load.
 *
 * `UserInteractionInstrumentation` wraps `addEventListener` so each
 * click on a tracked element produces a span linked to the handler
 * timing.
 */
if (
    typeof window !== "undefined" &&
    process.env["NEXT_PUBLIC_HONEYCOMB_API_KEY"]
) {
    TelemetryRuntime.runSync(Effect.void);
    registerInstrumentations({
        instrumentations: [
            new DocumentLoadInstrumentation(),
            new UserInteractionInstrumentation(),
        ],
    });
}
