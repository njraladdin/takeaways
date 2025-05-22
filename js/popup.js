document.addEventListener('DOMContentLoaded', async () => {
  // Load existing API key if any
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
  }

  document.getElementById('save').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const statusElement = document.getElementById('status');
    
    if (!apiKey) {
      statusElement.textContent = 'Please enter an API key';
      statusElement.style.color = 'red';
      return;
    }

    statusElement.textContent = 'Validating API key...';
    statusElement.style.color = 'orange';

    // Send message to validate API key
    chrome.runtime.sendMessage({ type: 'VALIDATE_API_KEY', apiKey }, (response) => {
      if (response.success) {
        statusElement.textContent = 'API key validated and saved successfully!';
        statusElement.style.color = 'green';
      } else {
        statusElement.textContent = `Invalid API key: ${response.error}`;
        statusElement.style.color = 'red';
      }
    });
  });
}); 