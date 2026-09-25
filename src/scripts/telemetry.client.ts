// Page entry point for telemetry: starts the anonymous session (production
// site only — see lib/telemetry/config.ts). No feature code lives here.
import { initTelemetry } from '../lib/telemetry';

initTelemetry();
