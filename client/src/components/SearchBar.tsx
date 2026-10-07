import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  placeholder?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({ 
  searchTerm, 
  onSearchChange, 
  placeholder = "البحث في المهام..." 
}) => {
  const handleClear = () => {
    onSearchChange('');
  };

  return (
    <div className="relative flex-1 max-w-md">
      <div className="relative">
        <Search 
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" 
          size={20} 
        />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pr-10 pl-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white transition-colors"
        />
        {searchTerm && (
          <button
            onClick={handleClear}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {searchTerm && (
        <div className="absolute top-full left-0 right-0 mt-1 text-sm text-gray-500 dark:text-gray-400">
          البحث عن: "{searchTerm}"
        </div>
      )}
    </div>
  );
};

export default SearchBar;