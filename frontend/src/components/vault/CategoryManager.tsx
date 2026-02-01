/**
 * Category Manager Component
 * 
 * Allows users to create, edit, and delete categories for organizing secrets.
 * 
 * @module components/vault/CategoryManager
 */

import { useState, useEffect, useCallback } from 'react';
import { useVault } from '../../hooks/useVault';
import { categoriesApi, type Category } from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * Props for CategoryManager component
 */
interface CategoryManagerProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when categories are updated */
  onCategoriesUpdated?: () => void;
}

/** Available category icons */
const CATEGORY_ICONS = [
  { id: 'folder', label: 'Folder', emoji: '📁' },
  { id: 'lock', label: 'Lock', emoji: '🔒' },
  { id: 'key', label: 'Key', emoji: '🔑' },
  { id: 'globe', label: 'Website', emoji: '🌐' },
  { id: 'server', label: 'Server', emoji: '🖥️' },
  { id: 'card', label: 'Card', emoji: '💳' },
  { id: 'mail', label: 'Email', emoji: '📧' },
  { id: 'cloud', label: 'Cloud', emoji: '☁️' },
  { id: 'code', label: 'Development', emoji: '💻' },
  { id: 'shield', label: 'Security', emoji: '🛡️' },
  { id: 'database', label: 'Database', emoji: '🗄️' },
  { id: 'wifi', label: 'Network', emoji: '📶' },
];

/** Available category colors */
const CATEGORY_COLORS = [
  '#6366f1', // Indigo (default)
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6b7280', // Gray
  '#1f2937', // Dark
];

/**
 * Category Manager Component
 * 
 * Modal for managing secret categories - create, edit, delete.
 */
export default function CategoryManager({ isOpen, onClose, onCategoriesUpdated }: CategoryManagerProps) {
  const { currentOrg } = useVault();
  const { success, error: showError } = useToast();
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  
  // Form state
  const [formName, setFormName] = useState('');
  const [formIcon, setFormIcon] = useState('folder');
  const [formColor, setFormColor] = useState('#6366f1');
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Load categories from API
   */
  const loadCategories = useCallback(async () => {
    if (!currentOrg) return;
    
    setIsLoading(true);
    try {
      const data = await categoriesApi.list(currentOrg.id);
      setCategories(data);
    } catch (err) {
      showError('Failed to load categories');
    } finally {
      setIsLoading(false);
    }
  }, [currentOrg, showError]);

  useEffect(() => {
    if (isOpen && currentOrg) {
      loadCategories();
    }
  }, [isOpen, currentOrg, loadCategories]);

  /**
   * Start creating a new category
   */
  const startCreate = () => {
    setEditingCategory(null);
    setIsCreating(true);
    setFormName('');
    setFormIcon('folder');
    setFormColor('#6366f1');
  };

  /**
   * Start editing an existing category
   */
  const startEdit = (category: Category) => {
    setIsCreating(false);
    setEditingCategory(category);
    setFormName(category.name);
    setFormIcon(category.icon);
    setFormColor(category.color);
  };

  /**
   * Cancel form editing
   */
  const cancelForm = () => {
    setIsCreating(false);
    setEditingCategory(null);
    setFormName('');
    setFormIcon('folder');
    setFormColor('#6366f1');
  };

  /**
   * Save category (create or update)
   */
  const handleSave = async () => {
    if (!currentOrg || !formName.trim()) return;
    
    setIsSaving(true);
    try {
      if (isCreating) {
        await categoriesApi.create(currentOrg.id, {
          name: formName.trim(),
          icon: formIcon,
          color: formColor,
        });
        success('Category created');
      } else if (editingCategory) {
        await categoriesApi.update(currentOrg.id, editingCategory.id, {
          name: formName.trim(),
          icon: formIcon,
          color: formColor,
        });
        success('Category updated');
      }
      
      cancelForm();
      await loadCategories();
      onCategoriesUpdated?.();
    } catch (err) {
      showError(isCreating ? 'Failed to create category' : 'Failed to update category');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Delete a category
   */
  const handleDelete = async (category: Category) => {
    if (!currentOrg) return;
    if (!confirm(`Delete category "${category.name}"? Secrets in this category will be uncategorized.`)) {
      return;
    }
    
    try {
      await categoriesApi.delete(currentOrg.id, category.id);
      success('Category deleted');
      await loadCategories();
      onCategoriesUpdated?.();
    } catch (err) {
      showError('Failed to delete category');
    }
  };

  if (!isOpen) return null;

  const showForm = isCreating || editingCategory;
  const iconData = CATEGORY_ICONS.find(i => i.id === formIcon);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-30 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Modal */}
        <div
          className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full"
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-manager-title"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 id="category-manager-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Manage Categories
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin mx-auto w-8 h-8 border-2 border-vault-600 border-t-transparent rounded-full" />
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading categories...</p>
              </div>
            ) : showForm ? (
              /* Create/Edit Form */
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Category name"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-vault-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                    maxLength={50}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Icon
                  </label>
                  <div className="grid grid-cols-6 gap-2">
                    {CATEGORY_ICONS.map((icon) => (
                      <button
                        key={icon.id}
                        type="button"
                        onClick={() => setFormIcon(icon.id)}
                        className={`p-2 rounded-lg text-xl transition-colors ${
                          formIcon === icon.id
                            ? 'bg-vault-100 dark:bg-vault-900 ring-2 ring-vault-500'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                        title={icon.label}
                      >
                        {icon.emoji}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Color
                  </label>
                  <div className="grid grid-cols-6 gap-2">
                    {CATEGORY_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormColor(color)}
                        className={`w-8 h-8 rounded-full transition-transform ${
                          formColor === color ? 'ring-2 ring-offset-2 ring-vault-500 scale-110' : ''
                        }`}
                        style={{ backgroundColor: color }}
                        aria-label={color}
                      />
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Preview</p>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                      style={{ backgroundColor: formColor + '20', color: formColor }}
                    >
                      {iconData?.emoji || '📁'}
                    </div>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {formName || 'Category name'}
                    </span>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={cancelForm}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!formName.trim() || isSaving}
                    className="px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : (isCreating ? 'Create' : 'Save')}
                  </button>
                </div>
              </div>
            ) : (
              /* Category List */
              <div className="space-y-2">
                {categories.length === 0 ? (
                  <p className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No categories yet. Create one to organize your secrets.
                  </p>
                ) : (
                  categories.map((category) => {
                    const icon = CATEGORY_ICONS.find(i => i.id === category.icon);
                    return (
                      <div
                        key={category.id}
                        className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                            style={{ backgroundColor: category.color + '20', color: category.color }}
                          >
                            {icon?.emoji || '📁'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-gray-100">{category.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {category.secretCount} secret{category.secretCount !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(category)}
                            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(category)}
                            className="p-2 text-gray-400 hover:text-red-600"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {!isLoading && !showForm && (
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={startCreate}
                className="w-full px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Category
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
