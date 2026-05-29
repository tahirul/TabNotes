import { Crepe } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useEffect, useRef } from 'react';

interface CrepeEditorInnerProps {
  contextKey: string;
  initialValue: string;
  onMarkdownChange: (contextKey: string, markdown: string) => void;
}

function CrepeEditorInner({ contextKey, initialValue, onMarkdownChange }: CrepeEditorInnerProps) {
  const onChangeRef = useRef(onMarkdownChange);

  useEffect(() => {
    onChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  useEditor((root) => {
    return new Crepe({
      root,
      defaultValue: initialValue,
    }).on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(contextKey, markdown);
      });
    });
  });

  return <Milkdown />;
}

interface CrepeEditorProps {
  contextKey: string;
  value: string;
  onMarkdownChange: (contextKey: string, markdown: string) => void;
}

export function CrepeEditor({ contextKey, value, onMarkdownChange }: CrepeEditorProps) {
  return (
    <MilkdownProvider key={contextKey}>
      <div className="tabnotes-crepe-host" aria-label="Markdown editor">
        <CrepeEditorInner contextKey={contextKey} initialValue={value} onMarkdownChange={onMarkdownChange} />
      </div>
    </MilkdownProvider>
  );
}
