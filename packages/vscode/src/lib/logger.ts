import { window } from "vscode";
export { getLogger } from "@ragdoll/common";
import { attachTransport } from "@ragdoll/common";

const outputChannel = window.createOutputChannel("Pochi", { log: true });

attachTransport((args, meta) => {
  const message =
    typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
  const remainArgs = args.slice(1);

  switch (meta.logLevelName) {
    case "SILLY":
      outputChannel.trace(message, ...remainArgs);
      break;
    case "TRACE":
      outputChannel.trace(message, ...remainArgs);
      break;
    case "DEBUG":
      outputChannel.debug(message, ...remainArgs);
      break;
    case "INFO":
      outputChannel.info(message, ...remainArgs);
      break;
    case "WARN":
      outputChannel.warn(message, ...remainArgs);
      break;
    case "ERROR":
      outputChannel.error(message, ...remainArgs);
      break;
    case "FATAL":
      outputChannel.error(message, ...remainArgs);
      break;
    default:
      throw new Error(`Unknown log level: ${meta.logLevelName}`);
  }
});

export function showOutputPanel(): void {
  outputChannel.show();
}
