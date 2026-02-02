/**
 * API Client Tests
 * 
 * Tests for the API client functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Import after mocks are set up
import { 
  secretsApi, 
  orgsApi, 
  categoriesApi, 
  preferencesApi,
  // auditApi,  // Commented out - not used in tests yet
  ApiError 
} from '../lib/api';

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    localStorageMock.getItem.mockClear();
    localStorageMock.getItem.mockReturnValue('test-token');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('secretsApi', () => {
    const mockSecret = {
      id: 'secret-1',
      name: 'Test Secret',
      url: 'https://example.com',
      ciphertextBlob: 'encrypted',
      iv: 'iv123',
      version: 1,
      createdBy: 'user-1',
      updatedAt: '2024-01-01T00:00:00Z',
      secretType: 'password',
      isFavorite: false,
    };

    it('should list secrets', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockSecret]),
      });

      const result = await secretsApi.list('org-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations/org-123/secrets'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
      expect(result).toEqual([mockSecret]);
    });

    it('should list secrets with filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockSecret]),
      });

      await secretsApi.list('org-123', {
        categoryId: 'cat-1',
        type: 'password',
        favorites: true,
        search: 'test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('categoryId=cat-1'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('type=password'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('favorites=true'),
        expect.any(Object)
      );
    });

    it('should create a secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSecret),
      });

      const secretData = {
        name: 'New Secret',
        ciphertextBlob: 'encrypted',
        iv: 'iv',
      };

      const result = await secretsApi.create('org-123', secretData);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations/org-123/secrets'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(secretData),
        })
      );
      expect(result).toEqual(mockSecret);
    });

    it('should update a secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockSecret, name: 'Updated' }),
      });

      await secretsApi.update('org-123', 'secret-1', { name: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations/org-123/secrets/secret-1'),
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    it('should delete a secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await secretsApi.delete('org-123', 'secret-1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations/org-123/secrets/secret-1'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should toggle favorite', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockSecret, isFavorite: true }),
      });

      await secretsApi.toggleFavorite('org-123', 'secret-1', true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/secrets/secret-1/favorite'),
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });
  });

  describe('orgsApi', () => {
    const mockOrg = {
      id: 'org-1',
      name: 'Test Org',
      role: 'admin',
      encryptedOrgKey: 'key',
    };

    it('should list organizations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockOrg]),
      });

      const result = await orgsApi.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations'),
        expect.any(Object)
      );
      expect(result).toEqual([mockOrg]);
    });

    it('should create an organization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOrg),
      });

      await orgsApi.create({
        name: 'New Org',
        encryptedOrgKey: 'key',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('categoriesApi', () => {
    const mockCategory = {
      id: 'cat-1',
      name: 'Work',
      icon: 'briefcase',
      color: '#ff0000',
      sortOrder: 0,
      secretCount: 5,
    };

    it('should list categories', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockCategory]),
      });

      const result = await categoriesApi.list('org-123');

      expect(result).toEqual([mockCategory]);
    });

    it('should create a category', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCategory),
      });

      await categoriesApi.create('org-123', { name: 'Work' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/categories'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('preferencesApi', () => {
    const mockPrefs = {
      theme: 'dark',
      sessionTimeout: 15,
      clipboardClear: 30,
      showFavicons: true,
      compactView: false,
    };

    it('should get preferences', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPrefs),
      });

      const result = await preferencesApi.get();

      expect(result).toEqual(mockPrefs);
    });

    it('should update preferences', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockPrefs, theme: 'light' }),
      });

      await preferencesApi.update({ theme: 'light' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/preferences'),
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      await expect(secretsApi.list('org-123')).rejects.toThrow();
    });

    it('should throw ApiError on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found' }),
      });

      await expect(secretsApi.get('org-123', 'nonexistent')).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(secretsApi.list('org-123')).rejects.toThrow('Network error');
    });
  });

  describe('Authentication', () => {
    it('should include auth header when token exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await secretsApi.list('org-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should make request without auth when no token', async () => {
      localStorageMock.getItem.mockReturnValueOnce(null);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await secretsApi.list('org-123');

      // Should still make the request
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});

describe('ApiError', () => {
  it('should create error with status and message', () => {
    const error = new ApiError(404, 'Not found');
    
    expect(error.status).toBe(404);
    expect(error.message).toBe('Not found');
    expect(error instanceof Error).toBe(true);
  });
});
