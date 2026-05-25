export async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    type,
    ...payload
  });

  if (!response?.ok) {
    const error = new Error(response?.error || `Message failed: ${type}`);
    error.errorCode = response?.errorCode || "";
    throw error;
  }

  return response;
}
