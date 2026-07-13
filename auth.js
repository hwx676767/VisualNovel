/**
 * Client-side access token for Cloudflare Pages deployment.
 * Token is set on login.html and sent as Bearer on /api/* requests.
 */
window.VNAuth = (() => {
  const STORAGE_KEY = 'vn_access_token';

  function getToken() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function setToken(token) {
    sessionStorage.setItem(STORAGE_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function apiHeaders(extra = {}) {
    const headers = { ...extra };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function apiFetch(url, options = {}) {
    const headers = apiHeaders(options.headers || {});
    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && !window.location.pathname.endsWith('login.html')) {
      clearToken();
      window.location.href = '/login.html';
    }

    return response;
  }

  return { getToken, setToken, clearToken, apiHeaders, apiFetch };
})();
