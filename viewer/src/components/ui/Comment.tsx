import type { FormEvent } from 'react';
import { ActionButton } from './ActionButton';
import { Field } from './Field';
import { Icon, type IconName } from './Icon';

export type CommentTone = 'info' | 'warning' | 'error';

const toneLabels: Record<CommentTone, string> = { info: 'Info', warning: 'Warning', error: 'Error' };
const toneIcons: Record<CommentTone, IconName> = { info: 'info', warning: 'warning', error: 'error' };

export type CommentProps = {
  author: string;
  body: string;
  tone: CommentTone;
  timeLabel?: string;
  dateTime?: string;
  context?: string;
  onToneChange?: (tone: CommentTone) => void;
};

export function Comment({ author, body, tone, timeLabel, dateTime, context, onToneChange }: CommentProps) {
  return <article className={`ui-comment ui-comment--${tone}`} aria-label={`${toneLabels[tone]} comment by ${author}`}>
    <span className="ui-comment-avatar" aria-hidden="true">{author.trim().charAt(0).toUpperCase() || '?'}</span>
    <div className="ui-comment-content">
      <div className="ui-comment-header"><div className="ui-comment-byline"><strong>{author}</strong>{timeLabel && (dateTime ? <time dateTime={dateTime}>{timeLabel}</time> : <span>{timeLabel}</span>)}</div><div className="ui-comment-tone"><Icon name={toneIcons[tone]} />{onToneChange ? <select aria-label={`Tone for ${author}'s comment`} value={tone} onChange={event => onToneChange(event.target.value as CommentTone)}>{Object.entries(toneLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <span>{toneLabels[tone]}</span>}</div></div>
      {context && <span className="ui-comment-context">{context}</span>}
      <p className="ui-comment-body">{body}</p>
    </div>
  </article>;
}

export type CommentComposerProps = {
  value: string;
  tone: CommentTone;
  onValueChange: (value: string) => void;
  onToneChange: (tone: CommentTone) => void;
  onSubmit: (body: string, tone: CommentTone) => void;
  disabled?: boolean;
};

export function CommentComposer({ value, tone, onValueChange, onToneChange, onSubmit, disabled = false }: CommentComposerProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !value.trim()) return;
    onSubmit(value.trim(), tone);
  }

  return <form className="ui-comment-composer" aria-label="Add comment" onSubmit={submit}>
    <Field label="Comment"><textarea rows={3} value={value} onChange={event => onValueChange(event.target.value)} placeholder="Write a comment…" disabled={disabled} /></Field>
    <div className="ui-comment-composer-footer"><Field label="Tone"><select value={tone} onChange={event => onToneChange(event.target.value as CommentTone)} disabled={disabled}>{Object.entries(toneLabels).map(([option, label]) => <option key={option} value={option}>{label}</option>)}</select></Field><ActionButton type="submit" disabled={disabled || !value.trim()}>Post comment</ActionButton></div>
  </form>;
}
