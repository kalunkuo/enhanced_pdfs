import { Comment, CommentComposer, type CommentTone } from '../ui';

export type ViewerComment = { id: string; body: string; tone: CommentTone };

export type ElementCommentsProps = {
  elementId: string;
  comments: ViewerComment[];
  draft: string;
  tone: CommentTone;
  onDraftChange: (value: string) => void;
  onToneChange: (tone: CommentTone) => void;
  onSubmit: (body: string, tone: CommentTone) => void;
  onCommentToneChange: (id: string, tone: CommentTone) => void;
};

export function ElementComments({ elementId, comments, draft, tone, onDraftChange, onToneChange, onSubmit, onCommentToneChange }: ElementCommentsProps) {
  return <section className="inspector-section element-comments" aria-label={`Comments for element ${elementId}`}>
    <h3>Comments <small>REVIEW</small></h3>
    <div className="element-comment-list">{comments.length ? comments.map(comment => <Comment key={comment.id} author="You" body={comment.body} tone={comment.tone} timeLabel="Just now" context={`Element ${elementId}`} onToneChange={next => onCommentToneChange(comment.id, next)} />) : <p>No comments for this element yet.</p>}</div>
    <CommentComposer value={draft} tone={tone} onValueChange={onDraftChange} onToneChange={onToneChange} onSubmit={onSubmit} />
  </section>;
}
