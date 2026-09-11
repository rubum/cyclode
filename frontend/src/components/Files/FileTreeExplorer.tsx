import React, { useState, useMemo } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  FileText, 
  Search, 
  ChevronRight, 
  ChevronDown,
  ChevronsUpDown,
  File
} from 'lucide-react';

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  type: string;
  size?: number;
  children?: FileNode[];
}

interface FileTreeExplorerProps {
  tree: FileNode[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  title?: string;
  subtitle?: string;
}

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  tree,
  selectedFile,
  onSelectFile,
  title = 'Sandbox Filesystem Explorer',
  subtitle
}) => {
  const [filter, setFilter] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    // Auto-expand root level directories
    const initial: Record<string, boolean> = { '': true };
    tree.forEach((node) => {
      if (node.is_dir) {
        initial[node.path] = true;
      }
    });
    return initial;
  });

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    const traverse = (nodes: FileNode[]) => {
      nodes.forEach((n) => {
        if (n.is_dir) {
          allExpanded[n.path] = true;
          if (n.children) traverse(n.children);
        }
      });
    };
    traverse(tree);
    setExpandedFolders(allExpanded);
  };

  const collapseAll = () => {
    setExpandedFolders({});
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Filter tree nodes
  const filteredTree = useMemo(() => {
    if (!filter.trim()) return tree;
    const query = filter.toLowerCase();

    const filterNode = (node: FileNode): FileNode | null => {
      if (!node.is_dir) {
        return node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)
          ? node
          : null;
      }
      const filteredChildren = (node.children || [])
        .map(filterNode)
        .filter(Boolean) as FileNode[];

      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
        return {
          ...node,
          children: filteredChildren,
        };
      }
      return null;
    };

    return tree.map(filterNode).filter(Boolean) as FileNode[];
  }, [tree, filter]);

  const renderNodes = (nodes: FileNode[], depth = 0) => {
    return (
      <div className="space-y-0.5 select-none">
        {nodes.map((node) => {
          const isExpanded = !!expandedFolders[node.path] || !!filter.trim();
          const isSelected = selectedFile === node.path;
          const childCount = node.children ? node.children.length : 0;

          return (
            <div key={node.path}>
              {node.is_dir ? (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleFolder(node.path)}
                    style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    className="w-full flex items-center space-x-1.5 py-1 pr-2 rounded-md hover:bg-onedark-surface/60 text-xs font-mono text-onedark-fg hover:text-onedark-fgBright transition-colors text-left group cursor-pointer"
                  >
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-onedark-folder flex-shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-onedark-folder flex-shrink-0" />
                    )}
                    <span className="font-semibold text-onedark-fg group-hover:text-onedark-fgBright truncate">
                      {node.name}
                    </span>
                    <span className="text-[10px] text-onedark-muted font-normal ml-1">
                      ({childCount})
                    </span>
                  </button>

                  {isExpanded && node.children && node.children.length > 0 && (
                    <div className="mt-0.5">
                      {renderNodes(node.children, depth + 1)}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectFile(node.path)}
                  style={{ paddingLeft: `${depth * 14 + 8}px` }}
                  className={`w-full flex items-center space-x-1.5 py-1 pr-2.5 rounded-md text-xs font-mono transition-all text-left cursor-pointer ${
                    isSelected
                      ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border border-onedark-accent/40 shadow-xs'
                      : 'hover:bg-onedark-surface text-onedark-fg/90 hover:text-onedark-fgBright'
                  }`}
                >
                  <FileCode className={`w-3.5 h-3.5 flex-shrink-0 ${
                    isSelected ? 'text-onedark-accent' : 'text-onedark-fg/70'
                  }`} />
                  <span className="truncate flex-1 text-[11.5px]">{node.name}</span>
                  {node.size !== undefined && (
                    <span className="text-[10px] text-onedark-muted font-mono flex-shrink-0 ml-2">
                      {formatBytes(node.size)}
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-onedark-darker/60 font-mono text-xs overflow-hidden">
      {/* Explorer Header */}
      <div className="p-3 border-b border-onedark-borderSubtle bg-onedark-darker flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Folder className="w-4 h-4 text-onedark-folder flex-shrink-0" />
            <span className="font-semibold text-onedark-fgBright text-xs truncate">
              {title}
            </span>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={expandAll}
              className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10px]"
              title="Expand all folders"
            >
              Expand
            </button>
            <span className="text-onedark-border">·</span>
            <button
              onClick={collapseAll}
              className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10px]"
              title="Collapse all folders"
            >
              Collapse
            </button>
          </div>
        </div>

        {/* Search / Filter input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2.5 top-2" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            className="w-full bg-onedark-bg border border-onedark-borderSubtle focus:border-onedark-accent rounded-md pl-7 pr-2.5 py-1 text-[11px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted"
          />
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredTree.length === 0 ? (
          <div className="py-8 text-center text-onedark-muted text-[11px]">
            {filter ? 'No files match your filter.' : 'No files in workspace.'}
          </div>
        ) : (
          renderNodes(filteredTree)
        )}
      </div>
    </div>
  );
};
