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
import { ManagedRuntime } from "effect";
import { TelemetryLayer } from "./telemetry";

export const TelemetryRuntime = ManagedRuntime.make(TelemetryLayer);
