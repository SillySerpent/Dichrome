import {
  isStreamingState,
  isTerminalState
} from "../../shared/contracts.js";

export { isStreamingState, isTerminalState };

export function isRunningRequest(request) {
  return Boolean(request && !isTerminalState(request.state));
}
