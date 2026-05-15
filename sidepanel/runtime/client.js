export async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    type,
    ...payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || `Message failed: ${type}`);
  }

  return response;
}
