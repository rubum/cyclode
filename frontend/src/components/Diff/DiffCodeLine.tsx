import React, { useMemo } from 'react';
import { highlightDiffLine } from '../../utils/syntaxHighlighter';

export interface DiffCodeLineProps {
  text: string;
  language?: string;
  fileName?: string;
  grepMatcher?: any;
  className?: string;
}

export const DiffCodeLine: React.FC<DiffCodeLineProps> = React.memo(({
  text,
  language,
  fileName,
  grepMatcher,
  className = 'whitespace-pre flex-1 min-w-0'
}) => {
  const html = useMemo(() => {
    return highlightDiffLine(text, { language, fileName, grepMatcher });
  }, [text, language, fileName, grepMatcher]);

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

DiffCodeLine.displayName = 'DiffCodeLine';
