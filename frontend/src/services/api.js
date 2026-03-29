const API_BASE = '/api/v1';

class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

let authFailureCallback = null;

export function setAuthFailureCallback(callback) {
  authFailureCallback = callback;
}

async function request(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  console.debug('[API]', options.method || 'GET', endpoint);

  const response = await fetch(API_BASE + endpoint, {
    ...options,
    headers,
    credentials: 'include', // stuur httpOnly cookie mee
  });

  console.debug('[API] Response:', response.status, endpoint);

  if (response.status === 401) {
    if (authFailureCallback) authFailureCallback();
    throw new ApiError('Niet ingelogd', 401);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.debug('[API] Error:', body);
    throw new ApiError(
      body.detail || 'HTTP ' + response.status,
      response.status,
      body.detail,
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

async function requestFormData(endpoint, formData) {
  const response = await fetch(API_BASE + endpoint, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail || 'HTTP ' + response.status, response.status, body.detail);
  }
  return response.json();
}

export const auth = {
  async register(email, username, password, fullName) {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password, full_name: fullName }),
    });
  },

  async login(username, password) {
    console.debug('[API] Login for:', username);
    // De server zet een httpOnly cookie en geeft ook het token terug
    const response = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
      credentials: 'include',
    });

    console.debug('[API] Login status:', response.status);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(body.detail || 'Login mislukt', response.status, body.detail);
    }

    return response.json();
  },

  async getProfile() {
    return request('/auth/me');
  },

  async updateProfile(data) {
    return request('/auth/me', { method: 'PUT', body: JSON.stringify(data) });
  },

  async logout() {
    await request('/auth/logout', { method: 'POST' }).catch(() => {});
  },

  // isLoggedIn kan niet meer op localStorage steunen — controleer via getProfile
  async isLoggedIn() {
    try {
      await this.getProfile();
      return true;
    } catch {
      return false;
    }
  },
};

export const shops = {
  async create(url, name, notes) {
    return request('/shops/', {
      method: 'POST',
      body: JSON.stringify({ url, name, notes }),
    });
  },
  async list(page = 1, pageSize = 20, search = '', riskLevel = '') {
    const params = new URLSearchParams({ page, page_size: pageSize });
    if (search) params.set('search', search);
    if (riskLevel) params.set('risk_level', riskLevel);
    return request('/shops/?' + params);
  },
  async get(id) { return request('/shops/' + id); },
  async update(id, data) {
    return request('/shops/' + id, { method: 'PUT', body: JSON.stringify(data) });
  },
  async delete(id) { return request('/shops/' + id, { method: 'DELETE' }); },
  async importCSV(file) {
    const formData = new FormData();
    formData.append('file', file);
    return requestFormData('/shops/import-csv', formData);
  },
};

export const scans = {
  async create(shopId, collectors = ['scrape'], maxPages = 50) {
    return request('/scans/', {
      method: 'POST',
      body: JSON.stringify({ shop_id: shopId, collectors, max_pages: maxPages }),
    });
  },
  async get(id) { return request('/scans/' + id); },
  async getProgress(id) { return request('/scans/' + id + '/progress'); },
  async list(shopId = null, limit = 20) {
    const params = new URLSearchParams({ limit });
    if (shopId) params.set('shop_id', shopId);
    return request('/scans/?' + params);
  },
  async pollUntilDone(scanId, onUpdate, onProgress, intervalMs = 1500, shouldAbort = null) {
    while (true) {
      if (shouldAbort && shouldAbort()) {
        console.debug('[API] Polling aborted');
        return null;
      }

      try {
        const progressData = await this.getProgress(scanId);
        if (onProgress) onProgress(progressData);

        if (['completed', 'failed', 'partial'].includes(progressData.status)) {
          const scan = await this.get(scanId);
          if (onUpdate) onUpdate(scan);
          return scan;
        }
      } catch (e) {
        const scan = await this.get(scanId);
        if (onUpdate) onUpdate(scan);
        if (['completed', 'failed', 'partial'].includes(scan.status)) return scan;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }
  },
};

export default { auth, shops, scans };
