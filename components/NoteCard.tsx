import type { NoteStatus } from '../shared/types';

export interface NoteCardProps {
  title: string;
  preview: string;
  status: NoteStatus;
  active?: boolean;
  onSelect?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

export function NoteCard({ title, preview, status, active = false, onSelect, onArchive, onDelete }: NoteCardProps) {
  return (
    <article className={`tabnotes-card${active ? ' tabnotes-card-active' : ''}`}>
      <button className="tabnotes-card-main" onClick={onSelect} type="button">
        <span className="tabnotes-card-title">{title}</span>
        <span className="tabnotes-card-preview">{preview || 'Start writing...'}</span>
        <span className="tabnotes-card-meta">{status}</span>
      </button>
      <div className="tabnotes-card-actions">
        <button type="button" onClick={onArchive}>Archive</button>
        <button type="button" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}
