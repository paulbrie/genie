import { executeDomAction } from "./dom-actions";
import type { ContentScriptMessage } from "../shared/types";

// Listen for messages from the background service worker
chrome.runtime.onMessage.addListener(
  (message: ContentScriptMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "dom:get_snapshot": {
        // Synchronous snapshot — execute dom action and respond
        executeDomAction("get_snapshot", {}).then((result) => {
          sendResponse({ type: "dom:snapshot", html: result.result });
        });
        return true; // Keep channel open for async response
      }

      case "dom:action": {
        const { requestId, action, params } = message;
        executeDomAction(action, params).then((result) => {
          sendResponse({
            type: "dom:action_result",
            requestId,
            success: result.success,
            result: result.result,
          });
        });
        return true; // Keep channel open for async response
      }
    }
  },
);
