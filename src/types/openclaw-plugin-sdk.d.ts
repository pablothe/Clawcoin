/**
 * Type stub for the OpenClaw plugin SDK.
 *
 * The "openclaw" package is not yet published to npm. This declaration
 * provides the minimal API surface used by the Clawcoin plugin entry point.
 */

declare module "openclaw/plugin-sdk" {
  export interface OpenClawPluginApi {
    /** Plugin configuration from openclaw.plugin.json configSchema */
    pluginConfig: Record<string, unknown>;

    /** Structured logger */
    logger: {
      info(message: string, ...args: unknown[]): void;
      warn(message: string, ...args: unknown[]): void;
      error(message: string, ...args: unknown[]): void;
      debug(message: string, ...args: unknown[]): void;
    };

    /** Register an agent tool */
    registerTool(tool: {
      name: string;
      description: string;
      parameters: unknown;
      execute: (params: Record<string, unknown>) => Promise<unknown>;
    }): void;

    /** Register a chat/CLI command */
    registerCommand(command: {
      name: string;
      description: string;
      requireAuth?: boolean;
      handler: (args?: Record<string, unknown>) => Promise<{ text: string }>;
    }): void;

    /** Register CLI extensions */
    registerCli(setup: (context: unknown) => void): void;

    /** Register a background service */
    registerService(service: {
      id: string;
      start: () => Promise<(() => void) | void>;
      stop: () => Promise<void>;
    }): void;
  }
}
