import React, { useMemo } from 'react';
import { highlightDiffLine } from '../../utils/syntaxHighlighter';

export interface DiffCodeLineProps {
  text: string;
  language?: string;
  fileName?: string;
  grepMatcher?: any;
  className?: string;
  wrap?: boolean;
}

export const DiffCodeLine: React.FC<DiffCodeLineProps> = React.memo(({
  text,
  language,
  fileName,
  grepMatcher,
  className,
  wrap = false,
}) => {
  const html = useMemo(() => {
    return highlightDiffLine(text, { language, fileName, grepMatcher });
  }, [text, language, fileName, grepMatcher]);

  const resolvedClassName = className !== undefined
    ? className
    : wrap
    ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere] flex-1 min-w-0'
    : 'whitespace-pre flex-1 min-w-0';

  return (
    <span
      className={resolvedClassName}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

DiffCodeLine.displayName = 'DiffCodeLine';
